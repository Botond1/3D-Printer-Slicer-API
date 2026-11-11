#!/usr/bin/env bash
# Slicer VPS host hardening (3.9.0 §5 PREPARED row, owner decision §10.3).
# PREPARED ONLY: the owner runs it. DRY-RUN BY DEFAULT: every subcommand prints
# its steps and changes nothing unless the first argument is --execute.
# Read CHECKLIST.md first; keep the hPanel VNC console open as break-glass.
#
# Usage: r3d-host-hardening.sh [--execute] <subcommand>
#   plan            print every step in order (default)
#   precheck        read-only: key login in use, sshd Include, at/atd, fail2ban, reads
#   sshd-apply      write 00-r3d-hardening.conf, sshd -t, arm a 10-minute dead-man `at`
#                   job that restores the previous config, then reload sshd
#   sshd-confirm    run from a SECOND, FRESH key login: proves the new login and the
#                   effective settings, then cancels the dead-man job
#   fail2ban        sshd jail (r3d-sshd.local), reload fail2ban
#   old-traefik     docker rm traefik-traefik-1 (only when exited; the letsencrypt volume is kept)
#   diag-keys       chmod 600 /opt/rocket3d/j1-diag/keys*.env
#   keep-list       read-only: release trees mounted by running containers (never delete them)
#   reads           read-only: core_pattern, /var/crash, sshd -T excerpt, fail2ban status
set -euo pipefail

EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; shift; fi
CMD="${1:-plan}"

DROPIN_DIR="/etc/ssh/sshd_config.d"
DROPIN="$DROPIN_DIR/00-r3d-hardening.conf"
STATE_DIR="/root/r3d-host-hardening"
DEADMAN_MINUTES=10
TS="$(date -u +%Y%m%dT%H%M%SZ)"
KEEP_TREES="slicer-api-5794efad764af0eb79a52747ce123c5e60c5ac44 slicer-api-9e9621a3f6110192aeb77a5c182da5aad79c80e7"

die() { echo "STOP $*" >&2; exit 1; }
step() { echo "-- $*"; }
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }
need_root() { [ "$(id -u)" -eq 0 ] || die "run as root"; }

DROPIN_CONTENT='# r3d host hardening (slicer 3.9.0 §5). Remove this file and reload sshd to undo.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30'

JAIL_CONTENT='# r3d sshd jail (slicer 3.9.0 §5)
[sshd]
enabled = true
mode = aggressive
port = ssh
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h'

ssh_unit() {
  if systemctl list-unit-files ssh.service >/dev/null 2>&1 && systemctl cat ssh.service >/dev/null 2>&1; then echo ssh
  elif systemctl cat sshd.service >/dev/null 2>&1; then echo sshd
  else die "no ssh/sshd systemd unit"; fi
}

cmd_plan() {
  cat <<'PLAN'
Host hardening, in order (each is its own subcommand; all default to dry-run):
 1. precheck      you are on a KEY login; sshd_config includes sshd_config.d/*.conf; `at` and atd work;
                  open the hPanel VNC console in another tab (break-glass); check the hPanel terminal
                  works BEFORE any `passwd -l` (this script never locks a password)
 2. sshd-apply    00-r3d-hardening.conf (PasswordAuthentication no, KbdInteractiveAuthentication no,
                  PermitRootLogin prohibit-password, X11Forwarding no, MaxAuthTries 3, LoginGraceTime 30),
                  sshd -t, a dead-man `at` job in 10 minutes that restores the previous config and
                  reloads sshd, then reload sshd (existing sessions stay open)
 3. sshd-confirm  from a SECOND, FRESH key login within 10 minutes: cancels the dead-man job.
                  If you cannot log in, do nothing: the job restores the old config by itself.
 4. fail2ban      sshd jail, reload
 5. old-traefik   docker rm traefik-traefik-1 (exited; keeps the letsencrypt volume)
 6. diag-keys     chmod 600 /opt/rocket3d/j1-diag/keys*.env
 7. keep-list     the release trees in use (5794efad, 9e9621a3 are never deleted)
 8. reads         core_pattern and /var/crash, for the evidence
Then CHECKLIST.md: Docker upgrade, Traefik access-log X-Request-Id=keep, LeadPilot removal (both
layers, owner decision 2), workstation key passphrase.
PLAN
}

cmd_precheck() {
  step "session: ${SSH_CONNECTION:+an SSH session}${SSH_CONNECTION:-no SSH_CONNECTION (console?)}"
  if [ "$(id -u)" -eq 0 ] && command -v journalctl >/dev/null; then
    journalctl -u "$(ssh_unit)" --since "-2h" 2>/dev/null | grep -c 'Accepted publickey' | sed 's/^/accepted key logins in the last 2 h: /' || true
  fi
  grep -Eq '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config \
    && echo "sshd_config includes sshd_config.d/*.conf" || echo "MISSING: Include /etc/ssh/sshd_config.d/*.conf (sshd-apply will refuse)"
  [ -s /root/.ssh/authorized_keys ] && echo "root authorized_keys present ($(grep -c . /root/.ssh/authorized_keys) lines)" || echo "MISSING: /root/.ssh/authorized_keys"
  command -v at >/dev/null && echo "at present" || echo "MISSING: at (apt-get install at); sshd-apply refuses without it"
  systemctl is-active atd >/dev/null 2>&1 && echo "atd active" || echo "atd not active"
  command -v fail2ban-client >/dev/null && echo "fail2ban present" || echo "fail2ban absent (apt-get install fail2ban)"
  [ -e "$DROPIN" ] && echo "NOTE: $DROPIN already exists" || true
}

cmd_sshd_apply() {
  if [ "$EXECUTE" -ne 1 ]; then
    step "DRY-RUN would back up $DROPIN_DIR to $STATE_DIR/sshd-$TS/ and write $DROPIN:"
    echo "$DROPIN_CONTENT" | sed 's/^/     /'
    step "DRY-RUN would run sshd -t; refuse on any error (nothing reloaded)"
    step "DRY-RUN would arm: at now + $DEADMAN_MINUTES minutes -> restore the backup, sshd -t, reload sshd"
    step "DRY-RUN would record the job id and this session's SSH_CONNECTION, then reload sshd"
    step "next: open a NEW terminal, log in with the key, run: $0 --execute sshd-confirm"
    return 0
  fi
  need_root
  [ -n "${SSH_CONNECTION:-}" ] || die "run sshd-apply from an SSH key session (the confirm step compares sessions)"
  grep -Eq '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config || die "sshd_config does not include sshd_config.d/*.conf"
  command -v at >/dev/null && systemctl is-active atd >/dev/null 2>&1 || die "at/atd unavailable: no dead-man, no change"
  [ -s /root/.ssh/authorized_keys ] || die "no root authorized_keys"
  [ ! -e "$STATE_DIR/deadman.job" ] || die "a dead-man job is already armed ($STATE_DIR/deadman.job)"
  local unit backup; unit="$(ssh_unit)"; backup="$STATE_DIR/sshd-$TS"
  mkdir -p -m 700 "$backup/dropins"
  cp -a "$DROPIN_DIR/." "$backup/dropins/"
  cat > "$backup/restore.sh" <<EOF
#!/bin/sh
# dead-man revert written by r3d-host-hardening.sh at $TS
rm -f "$DROPIN"
[ -e "$backup/dropins/00-r3d-hardening.conf" ] && cp -a "$backup/dropins/00-r3d-hardening.conf" "$DROPIN"
sshd -t && systemctl reload $unit
echo "dead-man restored the previous sshd config at \$(date -u)" >> "$STATE_DIR/deadman.log"
rm -f "$STATE_DIR/deadman.job"
EOF
  chmod 700 "$backup/restore.sh"
  umask 022
  printf '%s\n' "$DROPIN_CONTENT" > "$DROPIN.r3d-new"
  chmod 644 "$DROPIN.r3d-new"
  mv -f "$DROPIN.r3d-new" "$DROPIN"
  if ! sshd -t; then sh "$backup/restore.sh" || true; die "sshd -t refused the new config; restored"; fi
  local job
  job="$(echo "sh $backup/restore.sh" | at now + "$DEADMAN_MINUTES" minutes 2>&1 | sed -n 's/^job \([0-9][0-9]*\) .*/\1/p')"
  [ -n "$job" ] || { sh "$backup/restore.sh" || true; die "could not arm the dead-man job; restored"; }
  printf '%s\n%s\n%s\n' "$job" "$SSH_CONNECTION" "$(date +%s)" > "$STATE_DIR/deadman.job"
  chmod 600 "$STATE_DIR/deadman.job"
  systemctl reload "$unit"
  echo "applied; dead-man job $job restores the previous config in $DEADMAN_MINUTES minutes"
  echo "NOW: keep this session open, log in again with the key in a NEW terminal and run: $0 --execute sshd-confirm"
}

cmd_sshd_confirm() {
  [ -f "$STATE_DIR/deadman.job" ] || die "no armed dead-man job"
  if [ "$EXECUTE" -ne 1 ]; then
    step "DRY-RUN would check: a different SSH session than the one that applied, logged in after the apply,"
    step "  sshd -T shows passwordauthentication no / kbdinteractiveauthentication no / permitrootlogin without-password,"
    step "  then atrm the dead-man job"
    return 0
  fi
  need_root
  local job applied_conn applied_at
  job="$(sed -n 1p "$STATE_DIR/deadman.job")"; applied_conn="$(sed -n 2p "$STATE_DIR/deadman.job")"; applied_at="$(sed -n 3p "$STATE_DIR/deadman.job")"
  [ -n "${SSH_CONNECTION:-}" ] || die "not an SSH session"
  [ "$SSH_CONNECTION" != "$applied_conn" ] || die "this is the session that applied; log in again in a NEW terminal"
  # The login of this session must be after the apply: the sshd session process of this shell.
  local sid_start pid=$$ ppid
  while ppid="$(ps -o ppid= -p "$pid" | tr -d ' ')" && [ -n "$ppid" ] && [ "$ppid" -gt 1 ]; do
    case "$(ps -o comm= -p "$ppid")" in sshd*) sid_start="$(stat -c %Y "/proc/$ppid")"; break ;; esac
    pid="$ppid"
  done
  [ -n "${sid_start:-}" ] && [ "$sid_start" -ge "$applied_at" ] || die "cannot prove this login is newer than the apply"
  journalctl -u "$(ssh_unit)" --since "@$applied_at" 2>/dev/null | grep -q 'Accepted publickey' || die "no key login accepted since the apply"
  local effective; effective="$(sshd -T 2>/dev/null)"
  for want in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin without-password' 'x11forwarding no' 'maxauthtries 3' 'logingracetime 30'; do
    echo "$effective" | grep -qx "$want" || die "effective sshd setting missing: $want"
  done
  atrm "$job"
  mv "$STATE_DIR/deadman.job" "$STATE_DIR/deadman.job.confirmed-$TS"
  echo "confirmed from a second fresh key login; dead-man job $job cancelled"
}

cmd_fail2ban() {
  if [ "$EXECUTE" -ne 1 ]; then
    step "DRY-RUN would install fail2ban if absent (apt-get install -y fail2ban) and write /etc/fail2ban/jail.d/r3d-sshd.local:"
    echo "$JAIL_CONTENT" | sed 's/^/     /'
    step "DRY-RUN would reload fail2ban and print fail2ban-client status sshd"
    return 0
  fi
  need_root
  command -v fail2ban-client >/dev/null || apt-get install -y fail2ban
  printf '%s\n' "$JAIL_CONTENT" > /etc/fail2ban/jail.d/r3d-sshd.local
  systemctl enable --now fail2ban
  fail2ban-client reload
  fail2ban-client status sshd
}

cmd_old_traefik() {
  local state
  state="$(docker inspect --format '{{.State.Status}} {{.State.Running}}' traefik-traefik-1 2>/dev/null || echo absent)"
  case "$state" in
    absent) echo "traefik-traefik-1 is already gone"; return 0 ;;
    "exited false") ;;
    *) die "traefik-traefik-1 is not exited ($state); refusing" ;;
  esac
  docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}}{{println}}{{end}}' traefik-traefik-1 | sed 's/^/kept mount: /'
  if [ "$EXECUTE" -ne 1 ]; then step "DRY-RUN would run: docker rm traefik-traefik-1 (no -v: the letsencrypt volume stays)"; return 0; fi
  docker rm traefik-traefik-1
}

cmd_diag_keys() {
  local files; files="$(ls -1 /opt/rocket3d/j1-diag/keys*.env 2>/dev/null || true)"
  [ -n "$files" ] || { echo "no /opt/rocket3d/j1-diag/keys*.env"; return 0; }
  echo "$files" | while read -r f; do
    if [ "$EXECUTE" -eq 1 ]; then chmod 600 "$f"; stat -c '%a %n' "$f"; else echo "DRY-RUN would chmod 600 $f (now $(stat -c %a "$f"))"; fi
  done
}

cmd_keep_list() {
  echo "never delete: $KEEP_TREES"
  docker ps -q | while read -r id; do
    docker inspect --format '{{.Name}}{{range .Mounts}} {{.Source}}{{end}}' "$id"
  done | tr ' ' '\n' | grep -o '/opt/rocket3d/slicer-api-[0-9a-f]*' | sort -u | sed 's/^/in use: /'
}

cmd_reads() {
  echo "core_pattern: $(cat /proc/sys/kernel/core_pattern)"
  ls -la /var/crash 2>/dev/null | sed 's/^/var-crash: /' || echo "no /var/crash"
  sshd -T 2>/dev/null | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|x11forwarding|maxauthtries|logingracetime) ' || true
  command -v fail2ban-client >/dev/null && fail2ban-client status sshd 2>/dev/null || true
}

case "$CMD" in
  plan) cmd_plan ;;
  precheck) cmd_precheck ;;
  sshd-apply) cmd_sshd_apply ;;
  sshd-confirm) cmd_sshd_confirm ;;
  fail2ban) cmd_fail2ban ;;
  old-traefik) cmd_old_traefik ;;
  diag-keys) cmd_diag_keys ;;
  keep-list) cmd_keep_list ;;
  reads) cmd_reads ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown subcommand" ;;
esac
