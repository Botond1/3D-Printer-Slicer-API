#!/usr/bin/env bash
# Staging principal key (3.9.0 H11, owner decision §10.4). PREPARED: run only at
# the owner's word. DRY-RUN BY DEFAULT; nothing is generated or written unless
# the first argument is --execute. No key value is ever printed: the owner
# copies the generated file's content into the staging sites' key files himself.
#
# Usage: provision-staging-key.sh [--execute] <subcommand>
#   plan         print the steps (default)
#   hash-check   first 12 hex of sha256 for each non-empty key slot of the service env,
#                to compare with the same prefix printed on a staging site (does a
#                staging site hold a copy of the live key?)
#   generate     write a fresh key (openssl rand -hex 32) into a new root-only 0600 file
#   stage-env    add SLICE_SERVICE_STAGING_API_KEY from that file to the service env
#                (backup first, atomic rename); takes effect at the next container recreate
set -euo pipefail

EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; shift; fi
CMD="${1:-plan}"

SERVICE_ENV="${R3D_SERVICE_ENV:-/etc/rocket3d/slicer-api/5794efad764af0eb79a52747ce123c5e60c5ac44/service-n1.env}"
KEY_FILE="${R3D_STAGING_KEY_FILE:-/root/r3d-keys/slicer-staging-api-key}"
BACKUP_DIR="${R3D_KEY_BACKUP_DIR:-/root/r3d-390-control-$(date -u +%Y%m%d)}"
NAME="SLICE_SERVICE_STAGING_API_KEY"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

die() { echo "STOP $*" >&2; exit 1; }
usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }
prefix() { printf '%s' "$1" | sha256sum | cut -c1-12; }

cmd_plan() {
  cat <<'PLAN'
Staging slicer key (§10.4), in order:
 1. hash-check   compare the printed prefixes with the one a staging site prints for its own key
                 file (on that site: the first 12 hex of sha256 of the key, nothing else)
 2. generate     a fresh 64-hex key in a root-only 0600 file (never printed)
 3. stage-env    SLICE_SERVICE_STAGING_API_KEY into the service env (backup + atomic rename);
                 it takes effect at the next container recreate (the 3.9.0 cutover, or keyring-only)
 4. the owner pastes the file's content into the staging sites' key files himself, then
    shreds the file: shred -u <key file>
Revoke: remove the line from the service env and recreate the container; the shop's key is untouched.
PLAN
}

cmd_hash_check() {
  [ -f "$SERVICE_ENV" ] || die "service env not found"
  local name value
  while IFS= read -r line; do
    case "$line" in \#*|'') continue ;; esac
    name="${line%%=*}"; value="${line#*=}"
    case "$name" in SLICE_SERVICE_*API_KEY|SLICE_SERVICE_*API_KEY_PREVIOUS)
      [ -n "$value" ] && echo "$name $(prefix "$value")" ;;
    esac
  done < "$SERVICE_ENV"
  unset value
}

cmd_generate() {
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would write a fresh key to $KEY_FILE (umask 077, 0600, refuses if it exists)"; return 0; fi
  [ "$(id -u)" -eq 0 ] || die "run as root"
  [ ! -e "$KEY_FILE" ] || die "$KEY_FILE exists; refusing to overwrite"
  command -v openssl >/dev/null || die "openssl missing"
  mkdir -p -m 700 "$(dirname "$KEY_FILE")"
  ( umask 077; openssl rand -hex 32 > "$KEY_FILE" )
  chmod 600 "$KEY_FILE"
  [ "$(tr -d '\n' < "$KEY_FILE" | wc -c)" -eq 64 ] || { rm -f "$KEY_FILE"; die "generated key has the wrong length"; }
  echo "generated $KEY_FILE (0600, 64 hex, prefix $(prefix "$(tr -d '\n' < "$KEY_FILE")"))"
}

cmd_stage_env() {
  [ -f "$SERVICE_ENV" ] || die "service env not found"
  [ -f "$KEY_FILE" ] || die "no key file; run generate first"
  if grep -q "^$NAME=." "$SERVICE_ENV"; then die "$NAME is already set; revoke it first"; fi
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would back up the service env to $BACKUP_DIR/service-n1.env.before-staging-key-$TS (0600)"
    echo "DRY-RUN would add $NAME (value from $KEY_FILE, never printed) by temp file + rename"
    return 0
  fi
  mkdir -p -m 700 "$BACKUP_DIR"
  install -m 600 "$SERVICE_ENV" "$BACKUP_DIR/service-n1.env.before-staging-key-$TS"
  local tmp; tmp="$(mktemp "$(dirname "$SERVICE_ENV")/.r3d-staging-key.XXXXXX")"
  chmod 600 "$tmp"
  { grep -v "^$NAME=" "$SERVICE_ENV"; printf '%s=%s\n' "$NAME" "$(tr -d '\n' < "$KEY_FILE")"; } > "$tmp"
  [ "$(grep -c "^$NAME=" "$tmp")" -eq 1 ] || { rm -f "$tmp"; die "rewrite failed"; }
  mv -f "$tmp" "$SERVICE_ENV"
  echo "added $NAME to $(basename "$SERVICE_ENV"); recreate the container to load it"
}

case "$CMD" in
  plan) cmd_plan ;;
  hash-check) cmd_hash_check ;;
  generate) cmd_generate ;;
  stage-env) cmd_stage_env ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown subcommand" ;;
esac
