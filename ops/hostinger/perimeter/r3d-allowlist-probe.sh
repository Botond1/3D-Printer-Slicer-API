#!/bin/sh
# r3d-allowlist-probe -- assert the TRAEFIK-layer ipAllowList still refuses a
# non-allowlisted caller.
#
# WHY THIS EXISTS, AND WHY IT MATTERS MORE THAN THE IPTABLES LAYER:
#   The only risk the network layer genuinely insures against is Traefik
#   failing open -- a router edited without its middleware, a bad reload, an
#   entrypoint default -- where the allowlist silently stops existing while the
#   service keeps returning 200. Nothing detects that on its own. This does.
#
# WHY 127.0.0.1 AND NOT THE PUBLIC NAME:
#   Loopback traffic reaches Traefik through OUTPUT/nat, not through FORWARD,
#   so it never traverses DOCKER-USER. That is deliberate: it means this probe
#   measures the Traefik allowlist ALONE. A probe over the public path would be
#   refused at the network layer first and could no longer tell a working
#   Traefik allowlist apart from a broken one -- the iptables layer would blind
#   the very check that justifies it.
set -eu

HOST="${R3D_PROBE_HOST:-slicer-api.invalid}"
PATH_="${R3D_PROBE_PATH:-/health}"

[ "$HOST" != "slicer-api.invalid" ] || {
    echo "r3d-allowlist-probe: FATAL -- set R3D_PROBE_HOST to the approved hostname"
    exit 1
}

code=$(curl -sS -m 15 --resolve "$HOST:443:127.0.0.1" \
    -o /dev/null -w '%{http_code}' "https://$HOST$PATH_" 2>/dev/null || echo 000)

case "$code" in
    403)
        echo "r3d-allowlist-probe: OK (403) -- Traefik allowlist is refusing non-allowlisted callers"
        exit 0
        ;;
    200)
        echo "r3d-allowlist-probe: FAIL (200) -- THE TRAEFIK ALLOWLIST HAS FAILED OPEN."
        echo "r3d-allowlist-probe: a non-allowlisted source reached the service. Check that the"
        echo "r3d-allowlist-probe: router still references the ipAllowList middleware."
        exit 1
        ;;
    000)
        echo "r3d-allowlist-probe: FAIL (no response) -- Traefik not answering on 443 locally"
        exit 1
        ;;
    *)
        echo "r3d-allowlist-probe: FAIL ($code) -- unexpected status; expected 403"
        exit 1
        ;;
esac
