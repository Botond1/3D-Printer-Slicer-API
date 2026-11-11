#!/usr/bin/env bash
# §8 step 1: private A/B container for slicer 3.9.0 (project r3d-s390, night
# window 00:00-05:00 Budapest). PREPARED; DRY-RUN BY DEFAULT: nothing is made,
# started, killed or removed unless the first argument is --execute.
#
# Usage: run-private-ab.sh [--execute] <subcommand> [arguments]
#   plan                          print the whole procedure (default)
#   prepare                       data dirs /srv/r3d-s390-private/{input,output,pricing-state},
#                                 a 0600 env file with throwaway keys (openssl rand -hex 32, never
#                                 printed) and the live tuning allowlist except the private overrides
#   up <A|B> <digest-ref>         start r3d-s390-private (A = 3.8.3, B = 3.9.0; B adds CHILD_OOM_SCORE_ADJ=1000)
#   heavy-gate                    exit 0 only when the live queue is idle and live memory.current < 2 GiB
#   heavy <seconds>               raise the private container to 6 GiB is NOT done here: run `up` with
#                                 R3D_S390_MEMORY_BYTES=6442450944 first; this runs the 1 s watcher for
#                                 <seconds> and docker-kills r3d-s390-private the moment live
#                                 memory.current passes 4 GiB or the live queue becomes non-empty
#   down                          stop and remove the private project and its network, then the data dirs
#
# Live admission is never paused. Secrets are never printed. Evidence goes to
# docs/repairs/evidence/slicer-3.9.0/private-ab/ in the plugin repository.
set -euo pipefail

EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; shift; fi
CMD="${1:-plan}"
[ "$#" -gt 0 ] && shift

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="r3d-s390"
PRIVATE="r3d-s390-private"
LIVE="3d-psa-backend-server"
DATA="/srv/r3d-s390-private"
KEYDIR="${R3D_S390_KEYDIR:-/root/r3d-s390-keys}"
ENV_FILE="$KEYDIR/private.env"
LIVE_SERVICE_ENV="${R3D_LIVE_SERVICE_ENV:-/etc/rocket3d/slicer-api/5794efad764af0eb79a52747ce123c5e60c5ac44/service-n1.env}"
CONFIGS="${R3D_S390_CONFIGS_DIR:-/opt/rocket3d/slicer-api-5794efad764af0eb79a52747ce123c5e60c5ac44/configs}"
GIB=1073741824

die() { echo "STOP $*" >&2; exit 1; }
run() { if [ "$EXECUTE" -eq 1 ]; then "$@"; else echo "DRY-RUN would run: $*"; fi; }
usage() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; }
compose() {
  R3D_S390_ENV_FILE="$ENV_FILE" R3D_S390_CONFIGS_DIR="$CONFIGS" \
    docker compose -p "$PROJECT" -f "$HERE/compose.private.yml" "$@"
}

live_memory() { docker exec "$LIVE" cat /sys/fs/cgroup/memory.current; }
live_queue_idle() { # reads /operations/metrics inside the live container with its own operations key
  docker exec "$LIVE" node -e 'const http=require("http");http.get({host:"127.0.0.1",port:3000,path:"/operations/metrics",headers:{"x-api-key":process.env.OPERATIONS_API_KEY||""}},(r)=>{let b="";r.on("data",(d)=>b+=d);r.on("end",()=>{const g=(n)=>{const m=b.match(new RegExp("^"+n+" ([0-9.]+)$","m"));return m?Number(m[1]):NaN;};const a=g("slicer_queue_active_jobs"),q=g("slicer_queue_queued_jobs");console.log(a===0&&q===0?"idle":"busy");});}).on("error",()=>console.log("unknown"));'
}

cmd_plan() {
  cat <<'PLAN'
Private A/B procedure (spec §8 step 1), in order:
 1. prepare             data dirs + 0600 throwaway-key env file (live tuning except: 3 GiB, 2 CPU,
                        MAX_CONCURRENT_SLICES=1); configs read-only from the SAME 5794efad tree
 2. up A <3.8.3 ref>    three runs of the corpus (A/A spread); read memory.peak after each case
 3. up B <3.9.0 ref>    three runs (B adds CHILD_OOM_SCORE_ADJ=1000; choom -n 1000 is a raise-to-equal)
 4. heavy cases         A-side memory.peak > 2.5 GiB: R3D_S390_MEMORY_BYTES=6442450944 up …,
                        only after `heavy-gate` passes, with `heavy <seconds>` watching (1 s);
                        a killed case is "not measured" and re-run from scratch after a restart
 5. evidence            catalogue body equality vs the live capture, contract fixtures (A) and
                        B bodies for the oracle, T-EXP, T-RET-4, /ready p99 < 100 ms with one native,
                        key-ring migration on a fixture env, rollback rehearsal B -> A -> B with
                        deploy-390.sh against the private project, findmnt / ulimit -c / oom_score_adj
 6. down                remove project, network and data dirs; keep the signed images
PLAN
}

cmd_prepare() {
  [ -f "$LIVE_SERVICE_ENV" ] || die "live service env not found"
  [ -d "$CONFIGS" ] || die "configs dir not found"
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would create $DATA/{input,output,pricing-state} (owner 999:999, 0700) and $ENV_FILE (0600)"
    echo "DRY-RUN would copy the live tuning NAMES' values (no key) and write fresh throwaway keys (never printed)"
    return 0
  fi
  [ ! -e "$ENV_FILE" ] || die "$ENV_FILE exists; refusing to overwrite"
  mkdir -p -m 700 "$KEYDIR" "$DATA/input" "$DATA/output" "$DATA/pricing-state"
  chown 999:999 "$DATA/input" "$DATA/output" "$DATA/pricing-state"
  umask 077
  {
    grep -E '^(NODE_ENV|PORT|MAX_SLICE_QUEUE_LENGTH|MAX_SLICE_QUEUE_PER_IP|MAX_SLICE_QUEUE_WAIT_MS|ASYNC_SLICE_DEADLINE_MS|PYTHON_HELPER_TIMEOUT_MS|ORIENTATION_HELPER_TIMEOUT_MS|SLICE_RATE_LIMIT_MAX_REQUESTS|SLICE_RATE_LIMIT_BURST_CAPACITY)=' "$LIVE_SERVICE_ENV"
    echo "SLICE_SERVICE_AUTH_MODE=principals"
    for name in SLICE_SERVICE_WOOCOMMERCE_API_KEY SLICE_SERVICE_LEADPILOT_API_KEY OPERATIONS_API_KEY ARTIFACT_API_KEY PRICING_API_KEY ADMIN_API_KEY; do
      printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
    done
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "prepared: data dirs and $ENV_FILE ($(cut -d= -f1 "$ENV_FILE" | tr '\n' ' '))"
}

cmd_up() {
  local side="${1:-}" ref="${2:-}"
  case "$side" in A|B) ;; *) die "usage: up <A|B> <digest-ref>" ;; esac
  case "$ref" in ghcr.io/botond1/3d-printer-slicer-api@sha256:*|local/*) ;; *) die "digest ref required" ;; esac
  [ "$EXECUTE" -ne 1 ] || [ -f "$ENV_FILE" ] || die "run prepare first"
  local adj=0; [ "$side" = "B" ] && adj=1000
  if [ "$EXECUTE" -eq 1 ]; then
    R3D_S390_IMAGE="$ref" R3D_S390_CHILD_OOM_SCORE_ADJ="$adj" compose up --detach --pull never
    docker inspect --format '{{.HostConfig.OomScoreAdj}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' "$PRIVATE"
    [ "$(docker inspect --format '{{.HostConfig.OomScoreAdj}}' "$PRIVATE")" = "1000" ] || die "oom_score_adj is not 1000"
    [ "$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$PRIVATE")" = "{}" ] || die "a port is published"
  else
    echo "DRY-RUN would start $PRIVATE ($side = $ref) with oom_score_adj 1000, CHILD_OOM_SCORE_ADJ=$adj, internal network only"
  fi
}

cmd_heavy_gate() {
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would require: live queue idle and live memory.current < 2 GiB"; return 0; fi
  local mem state
  mem="$(live_memory)"; state="$(live_queue_idle)"
  [ "$state" = "idle" ] || die "live queue is not idle ($state)"
  [ "$mem" -lt $((2 * GIB)) ] || die "live memory.current is not below 2 GiB"
  echo "heavy gate open (live idle, memory below 2 GiB)"
}

cmd_heavy() {
  local seconds="${1:-}"
  case "$seconds" in ''|*[!0-9]*) die "usage: heavy <seconds>" ;; esac
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would watch every 1 s for ${seconds}s and docker kill $PRIVATE when live memory.current > 4 GiB or the live queue is non-empty"
    return 0
  fi
  cmd_heavy_gate
  local end=$(( $(date +%s) + seconds ))
  while [ "$(date +%s)" -lt "$end" ]; do
    if [ "$(live_memory)" -gt $((4 * GIB)) ] || [ "$(live_queue_idle)" != "idle" ]; then
      docker kill "$PRIVATE" >/dev/null 2>&1 || true
      echo "KILLED $PRIVATE: live memory or queue gate tripped; record the case as not measured" >&2
      exit 2
    fi
    sleep 1
  done
  echo "heavy watch ended clean after ${seconds}s"
}

cmd_down() {
  run env R3D_S390_ENV_FILE="$ENV_FILE" R3D_S390_CONFIGS_DIR="$CONFIGS" R3D_S390_IMAGE=unused \
    docker compose -p "$PROJECT" -f "$HERE/compose.private.yml" down --volumes --timeout 30
  # compose down already removes the project-defined network; remove it only if it is left.
  if [ "$EXECUTE" -eq 1 ]; then
    if docker network inspect r3d-s390-internal >/dev/null 2>&1; then docker network rm r3d-s390-internal; fi
  else
    echo "DRY-RUN would remove the network r3d-s390-internal if compose down left it"
  fi
  case "$DATA" in /srv/r3d-s390-private) ;; *) die "refusing to remove an unexpected data path" ;; esac
  run rm -r -- "$DATA"
  echo "kept: the signed images and $KEYDIR (shred the throwaway env file when the evidence is filed)"
}

case "$CMD" in
  plan) cmd_plan ;;
  prepare) cmd_prepare ;;
  up) cmd_up "$@" ;;
  heavy-gate) cmd_heavy_gate ;;
  heavy) cmd_heavy "$@" ;;
  down) cmd_down ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown subcommand" ;;
esac
