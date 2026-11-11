#!/usr/bin/env bash
# Rehearse deploy-390.sh's post-checks against REAL answers before a cutover.
#
# The first 3.9.0 cutover (2026-11-11) rolled itself back on two false failures
# that the dry-run tests could not see, because they compared fabricated answers:
# the tuning list named NODE_ENV (the image's ENV, never in the service env file)
# and the control-slice comparison read receipt paths the service never wrote.
# This script runs the SAME code as the cutover (it sources deploy-390.sh's
# helpers and envtool, so IDENTITY_PATHS and the tuning list are the script's
# own) against real answers:
#
#   1. tuning     the LIVE container's environment vs the live service env file
#                 (verify_tuning_runtime; docker inspect + a file read only)
#   2. slices     the two control slices (cube auto, block preserve 90/0/0) on the
#                 PRIVATE container, compared with the step-2 captures of the
#                 control dir by envtool slice-compare (IDENTITY_PATHS, time, grams)
#   3. catalogue  /profiles and /profiles?contract=material-v1 of the private
#                 container vs the captured bodies (byte compare)
#   4. ready      60 one-second /ready polls on the private container, p99 < 100 ms
#   5. log        an auth.slot_summary line in the private container's log
#
# DRY BY NATURE: there is no --execute. No env file is written, nothing is pulled,
# restarted, swapped or tagged, and the live container receives no request (only
# `docker inspect`). The private container's answers go to a new 0700 rehearsal
# dir; the control dir is only read. No key value is read outside a container.
#
# Usage: rehearse-checks.sh [--private <container>] [--aa-spread <fraction>]
#                           [--out <new dir>] [--skip-ready]
#   --private    the private 3.9.0 container (default r3d-s390-private, §8 step 1)
#   --aa-spread  the step-1 A/A relative spread (default 0.01, as deploy-390.sh)
#   --out        where the private answers are written (default
#                /root/r3d-390-rehearsal-<UTC timestamp>; must not exist)
# Environment: R3D_CONTROL_DIR (the step-2 capture; default as deploy-390.sh),
#   R3D_COMPOSE_ENV (the live compose env, read to find the service env file).
# Exit 0 = every check passed; 1 = a check failed (the cutover would roll back).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/deploy-390.sh"
PRIVATE_NAME="r3d-s390-private"
SPREAD="0.01"
OUT=""
SKIP_READY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --private) PRIVATE_NAME="${2:-}"; shift 2 ;;
    --aa-spread) SPREAD="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --skip-ready) SKIP_READY=1; shift ;;
    -h|--help) sed -n '2,37p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "STOP unknown argument (see --help)" >&2; exit 1 ;;
  esac
done

[ -f "$DEPLOY" ] || { echo "STOP deploy-390.sh not found beside this script" >&2; exit 1; }

# deploy-390.sh's own definitions: everything above its first subcommand (the
# variables, envtool with IDENTITY_PATHS, in-container helpers, verify_tuning_runtime).
# With no argument it is in dry-run mode, and nothing in that part acts on its own.
PREFIX="$(mktemp "${TMPDIR:-/tmp}/r3d-390-rehearse.XXXXXX")"
sed -n '1,/^cmd_check_env() {$/p' "$DEPLOY" | sed '$d' > "$PREFIX"
grep -q '^const IDENTITY_PATHS = ' "$PREFIX" && grep -q '^verify_tuning_runtime() {' "$PREFIX" \
  || { rm -f -- "$PREFIX"; echo "STOP deploy-390.sh's helpers were not found where expected" >&2; exit 1; }
set --
# shellcheck disable=SC1090
source "$PREFIX"
rm -f -- "$PREFIX"
[ "$EXECUTE" -eq 0 ] || die "the sourced helpers are not in dry-run mode"

[ -n "$PRIVATE_NAME" ] && [ "$PRIVATE_NAME" != "$LIVE_NAME" ] || die "--private must name the private container, never $LIVE_NAME"
[ "$(docker inspect -f '{{.State.Running}}' "$PRIVATE_NAME" 2>/dev/null || echo missing)" = "true" ] \
  || die "the private container $PRIVATE_NAME is not running (run-private-ab.sh up B <3.9.0 ref>)"
[ -z "$(docker port "$PRIVATE_NAME" 2>/dev/null)" ] || die "$PRIVATE_NAME publishes a port; it is not the private container"

for file in profiles-v2-before.json profiles-v3-before.json capture-complete; do
  [ -s "$CONTROL_DIR/$file" ] || die "no step-2 capture in $CONTROL_DIR ($file missing); pass R3D_CONTROL_DIR=<capture dir>"
done
for model in cube block; do
  [ -s "$CONTROL_DIR/models/$model.stl" ] || die "the capture lacks models/$model.stl"
  for run in 1 2; do
    [ -s "$CONTROL_DIR/control-$model-before-$run.json" ] || die "the capture lacks control-$model-before-$run.json"
  done
done

OUT="${OUT:-/root/r3d-390-rehearsal-$TS}"
[ ! -e "$OUT" ] || die "$OUT exists; the rehearsal writes only into a new dir"
envtool outside "$OUT" "$DYNAMIC_DIR" "rehearsal dir"
mkdir -p -m 700 "$OUT"

failed=0
check() { # check <label> <command...>: runs one check, records PASS/FAIL, never stops the others
  local label="$1"; shift
  if "$@"; then echo "PASS $label"; else echo "FAIL $label" >&2; failed=1; fi
}

say "rehearsal of deploy-390.sh post-checks (live: $LIVE_NAME inspect only; private: $PRIVATE_NAME)"
echo "private container revision: $(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$PRIVATE_NAME" 2>/dev/null || echo unknown)"

tuning_on_live() { NAME="$LIVE_NAME"; resolve_service_env; verify_tuning_runtime; }
check "tuning: live container env equals the service env file on deploy-390.sh's list" tuning_on_live

NAME="$PRIVATE_NAME"
catalogue() {
  in_get /profiles > "$OUT/profiles-v2-private.json" || { echo "/profiles not 200" >&2; return 1; }
  in_get '/profiles?contract=material-v1' > "$OUT/profiles-v3-private.json" || { echo "/profiles v3 not 200" >&2; return 1; }
  cmp -s "$OUT/profiles-v2-private.json" "$CONTROL_DIR/profiles-v2-before.json" || { echo "catalogue v2 body differs" >&2; return 1; }
  cmp -s "$OUT/profiles-v3-private.json" "$CONTROL_DIR/profiles-v3-before.json" || { echo "catalogue v3 body differs" >&2; return 1; }
}
check "catalogue: private v2 and v3 bodies byte-equal to the capture" catalogue

one_slice() { # one_slice <model> <fields>
  control_slice "$CONTROL_DIR/models/$1.stl" "$2" "$OUT/control-$1-private.json" || { echo "control slice $1 failed" >&2; return 1; }
  envtool slice-compare "$CONTROL_DIR/control-$1-before-1.json" "$CONTROL_DIR/control-$1-before-2.json" \
    "$OUT/control-$1-private.json" "$SPREAD"
}
first=1
for spec in $CONTROL_SLICES; do
  model="${spec%%:*}"; fields="${spec#*:}"
  [ "$first" -eq 1 ] || sleep 21 # as post_checks: the slice limiter's burst
  first=0
  check "control slice $model: identity paths byte-equal, time and grams in range" one_slice "$model" "$fields"
done

if [ "$SKIP_READY" -eq 0 ]; then
  ready_poll() {
    local ready
    ready="$(docker exec -i "$NAME" node -e "$IN_READY_POLL" 60)" || { echo "/ready not 200 during the poll" >&2; return 1; }
    echo "$ready"
    node -e 'const m=process.argv[1].match(/p99_ms=([0-9.]+)/);process.exit(m&&Number(m[1])<100?0:1)' "$ready"
  }
  check "ready: 60 /ready polls on the private container, p99 < 100 ms" ready_poll
fi

slot_summary() {
  # A tuple the private container already saw (e.g. during the corpus runs) is not
  # written at once but folded into the next once-a-minute line: wait up to 70 s.
  local i
  for i in $(seq 1 15); do
    docker logs --since 30m "$NAME" > "$OUT/private-30m.log" 2>&1 || { echo "docker logs failed" >&2; return 1; }
    grep -q '"event":"auth.slot_summary"' "$OUT/private-30m.log" && return 0
    [ "$i" -eq 15 ] || sleep 5
  done
  echo "no auth.slot_summary line in 30 min of the private log" >&2
  return 1
}
check "log: auth.slot_summary present in the private container's log" slot_summary
chmod -R go-rwx "$OUT"

if [ "$failed" -ne 0 ]; then
  echo "rehearsal FAILED: a post-check would fail on real answers; fix deploy-390.sh before the cutover (answers in $OUT)" >&2
  exit 1
fi
echo "rehearsal PASS: every post-check passed against real answers (answers in $OUT)"
