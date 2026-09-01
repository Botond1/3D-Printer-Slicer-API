#!/bin/sh
# r3d-perimeter -- network-layer allowlist for the public HTTPS listener.
#
# WHY conntrack ORIGINAL-DESTINATION MATCHING AND NOT A PLAIN PORT MATCH:
#   DOCKER-USER sits in the FORWARD chain, which runs AFTER nat/PREROUTING.
#   Docker has already DNATed host 443 -> 172.16.x.x:8443 by the time packets
#   arrive, so a rule written against --dport 443 matches NOTHING and yields a
#   silent false sense of protection. Matching --dport 8443 works but binds the
#   policy to Traefik's internal port, which is an implementation detail that
#   can change under us. --ctorigdst/--ctorigdstport match the ORIGINAL public
#   destination the caller actually addressed, which is what the policy is
#   really about. Verified on this host: DNAT tcp dpt:443 to 8443.
#
# WHY PORT 80/8080 IS NEVER FILTERED HERE:
#   The Let's Encrypt certificate renews via ACME HTTP-01, which requires port
#   80 to be reachable from Let's Encrypt's validators. Their addresses are not
#   fixed and are never the allowlisted peer. Filtering 8080 would not fail now
#   -- it would fail at the next renewal, roughly 30 days before expiry, and
#   take the endpoint down about 30 days after that. The assertion below makes
#   that mistake fail loudly at apply time instead of silently months later.
#
# SCOPE WARNING -- read before adding a second hostname to this Traefik:
#   iptables cannot see SNI. This is a WHOLE-LISTENER control: every hostname
#   served by this Traefik inherits it. If a second consumer with a different
#   source address is ever added, either extend the allow set here as well, or
#   delete this layer entirely and let Traefik's per-router ipAllowList be the
#   single authority. Do not leave the two disagreeing.
set -eu

: "${R3D_ALLOWLIST_FILE:?Set R3D_ALLOWLIST_FILE to the absolute root-private allowlist path}"
: "${R3D_PUBLIC_IPV4_FILE:?Set R3D_PUBLIC_IPV4_FILE to the absolute root-private public-IPv4 path}"
ALLOWLIST_FILE="$R3D_ALLOWLIST_FILE"
IFACE="${R3D_PUBLIC_IFACE:-eth0}"
PUBIP_FILE="$R3D_PUBLIC_IPV4_FILE"
HTTPS_CPORT=8443
HTTP_CPORT=8080
TAG_ALLOW=r3d-perimeter-allow
TAG_DENY=r3d-perimeter-deny
TAG_LOG=r3d-perimeter-log
TAG_V6DENY=r3d-perimeter-v6deny

log() { echo "r3d-perimeter: $*"; }

case "$ALLOWLIST_FILE" in
    /*) ;;
    *) log "FATAL R3D_ALLOWLIST_FILE must be an absolute path"; exit 1 ;;
esac
case "$PUBIP_FILE" in
    /*) ;;
    *) log "FATAL R3D_PUBLIC_IPV4_FILE must be an absolute path"; exit 1 ;;
esac

[ -r "$ALLOWLIST_FILE" ] || { log "FATAL allowlist file unreadable: $ALLOWLIST_FILE"; exit 1; }

# Single source of truth: the same root-private file that renders the Traefik
# ipAllowList. Never hand-edit the rules; edit the file and re-run this.
entries=$(grep -cvE '^[[:space:]]*($|#)' "$ALLOWLIST_FILE" || true)
[ "$entries" -ge 1 ] || { log "FATAL allowlist file has no entries"; exit 1; }

# The public destination address is operator input, not something the script
# guesses, and it is verified against the interface before use. It stays in a
# root-private file so it never reaches the repository, logs, or evidence.
[ -r "$PUBIP_FILE" ] || { log "FATAL public IPv4 file unreadable: $PUBIP_FILE"; exit 1; }
PUBIP=$(grep -vE '^[[:space:]]*($|#)' "$PUBIP_FILE" | head -1 | tr -d '[:space:]')
[ -n "$PUBIP" ] || { log "FATAL public IPv4 file is empty"; exit 1; }
ip -4 addr show "$IFACE" | grep -qw "inet $PUBIP" || {
    log "FATAL supplied public IPv4 is not configured on $IFACE"; exit 1; }

# Remove only our own previously applied rules, identified by comment, so an
# unrelated rule added later by someone else is never silently discarded.
#
# Deleted BY RULE NUMBER, highest first -- not by reconstructing the rule text
# from `iptables -S`. That reconstruction breaks on the LOG rule, whose
# --log-prefix contains a space inside quotes: unquoted word splitting turns it
# into a stray `"` argument and iptables exits 2. Measured, not theorised.
clean_v4() {
    for n in $(iptables -L DOCKER-USER -n --line-numbers | awk '/r3d-perimeter-/ {print $1}' | sort -rn); do
        iptables -D DOCKER-USER "$n"
    done
}
clean_v4

pos=1
grep -vE '^[[:space:]]*($|#)' "$ALLOWLIST_FILE" | while IFS= read -r cidr; do
    iptables -I DOCKER-USER "$pos" -i "$IFACE" -p tcp -m conntrack --ctorigdst "$PUBIP" --ctorigdstport 443 \
        -s "$cidr" -m comment --comment "$TAG_ALLOW" -j RETURN
    pos=$((pos + 1))
done

# MEASURED BEHAVIOUR, AND A CORRECTION TO THE ORIGINAL DESIGN INTENT:
#   The intent was REJECT rather than DROP, so a blocked caller would get an
#   immediate refusal instead of a hang. That intent CANNOT BE SATISFIED AT
#   THIS LAYER, and pretending otherwise would be worse than not trying.
#
#   Measured here THREE ways, all with the same outcome -- the external client
#   waits the full timeout and receives nothing:
#     1. --dport 8443 with REJECT --reject-with icmp-admin-prohibited
#     2. --dport 8443 with REJECT --reject-with tcp-reset
#     3. conntrack --ctorigdst/--ctorigdstport 443 with REJECT tcp-reset
#   The rule itself is working in every case (the deny counter increments on
#   every SYN, and the allowlisted caller is served in ~0.1s), but the
#   rejection never reaches the client. The reason is structural: DOCKER-USER
#   runs in FORWARD, AFTER Docker's DNAT has rewritten the destination to
#   172.16.x.x:8443. A rejection generated there carries that private address
#   as its source and is not translated back, so it is discarded in transit or
#   by the client's stack.
#
#   Consequence you must design around: FROM THE CALLER'S POINT OF VIEW THIS
#   BEHAVES AS A DROP. A non-allowlisted caller sees a connection timeout, not
#   a refusal and not an HTTP status. Anyone whose address falls out of the
#   allowlist will experience "the API is down", not "I was refused". The
#   consumer's documented 403/401 ladder does not cover this state; they were
#   told separately. Do not re-litigate REJECT vs DROP here without new
#   evidence -- it was tried and measured.
# DIAGNOSTIC LOG, IMMEDIATELY BEFORE THE DENY.
#   Because the deny behaves as a drop (see above), a caller who falls out of
#   the allowlist experiences a silent hang. The consumer measured what that
#   costs them: their client wraps the whole call in a single 310s timeout with
#   no separate connect phase, so a dropped connection is a five-minute stall
#   per attempt, surfacing as "the slicer is unreachable" with nothing pointing
#   at the perimeter. There is otherwise NO detector on this side at all.
#
#   This line is that detector. It does not prevent the failure; it converts an
#   undiagnosable hang into a one-command answer: grep the journal for the
#   prefix and the denied source address is right there. Rate-limited, because
#   this origin is continuously scanned and unlimited logging would bury the
#   signal and fill the disk.
iptables -A DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdst "$PUBIP" --ctorigdstport 443 \
    -m limit --limit 6/min --limit-burst 10 \
    -m comment --comment "$TAG_LOG" -j LOG --log-prefix "r3d-perimeter-deny: " --log-level 6

iptables -A DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdst "$PUBIP" --ctorigdstport 443 \
    -m comment --comment "$TAG_DENY" -j REJECT --reject-with tcp-reset

# IPV6 SEAM -- WITHOUT THIS THE WHOLE IPv4 RULE ABOVE IS HALF A CONTROL.
#   Docker binds [::]:443 through docker-proxy and there is NO IPv6 DNAT on
#   this host, so IPv6 traffic never traverses DOCKER-USER at all: it arrives
#   as INPUT to the host. An IPv4-only DOCKER-USER rule therefore leaves the
#   entire TLS pre-auth surface reachable over IPv6, which is exactly the
#   surface the network layer exists to remove.
#
#   Measured before this rule existed: an arbitrary IPv6 client completed the
#   TLS handshake and received Traefik's 403. The application layer caught it;
#   the network layer did not even see it. That is why this is in INPUT and not
#   in DOCKER-USER -- putting it in DOCKER-USER would look right and do nothing.
#
#   There is no AAAA record for the service name and no approved IPv6 caller,
#   so the policy is to refuse ALL new inbound IPv6 to the HTTPS port. If an
#   IPv6 caller is ever approved, this becomes an allow/deny pair like the IPv4
#   side, not a deletion.
#
#   Port 80 over IPv6 is deliberately untouched: ACME validates over IPv4
#   because there is no AAAA, so filtering it buys nothing and risks renewal.
clean_v6() {
    for n in $(ip6tables -L INPUT -n --line-numbers | awk '/r3d-perimeter-/ {print $1}' | sort -rn); do
        ip6tables -D INPUT "$n"
    done
}
clean_v6
ip6tables -I INPUT 1 -p tcp --dport 443 -m conntrack --ctstate NEW \
    -m comment --comment "$TAG_V6DENY" -j REJECT --reject-with tcp-reset

# Structural ACME guard. A comment is not a control; this is.
if iptables -S DOCKER-USER | grep -qE -- "--dport $HTTP_CPORT|--ctorigdstport 80"; then
    log "FATAL a DOCKER-USER rule matches host port 80 (dport $HTTP_CPORT or ctorigdstport 80)."
    log "FATAL that breaks ACME HTTP-01 renewal. Refusing to leave this state."
    clean_v4
    exit 1
fi

log "applied: $entries allow entry/entries on $IFACE for original destination 443; all other IPv4 denied (behaves as a DROP to the caller -- see notes); all new inbound IPv6 to 443 refused"
log "host port 80 deliberately unfiltered for ACME HTTP-01"
