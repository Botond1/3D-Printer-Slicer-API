#!/usr/bin/env bash
# Slicer 3.10.0 production cutover (speed release).
#
# UNLIKE 3.9.0 THIS RELEASE CHANGES THE BAMBU measurement_generation BY DESIGN
# (five of the 23 hashed processing files changed). The post-checks therefore
# require: the NEW generation everywhere, every catalogue row otherwise equal
# to the capture, and every priced fact and identity object of the control
# slices equal to the capture (speed work must not move a price).
#
# Only SLICER_API_IMAGE changes; no service env value is written.
# Derived from deploy-383.sh (pull + revision label, bounded id, retention
# tags, compose contract, atomic env rewrite, compose up, runtime identity)
# with the in-container request helpers of deploy-390.sh: keys are read
# inside the container from its own environment and are never printed.
#
# DRY-RUN BY DEFAULT: without --execute nothing is pulled, written or restarted.
#
# Usage: deploy-310.sh [--execute] <subcommand> [arguments]
#   capture                      control dir, catalogue v2/v3 and two control slices (cube, block),
#                                each twice, from the RUNNING container (the 3.9.0 baseline)
#   checks <generation>          the post-checks alone against the running container and the
#                                capture (rehearsal on the private container; writes only *-after files)
#   deploy <ref> <sha> <generation>
#                                cutover to the signed image, then the post-checks; a failed
#                                post-check prints STOP and the rollback command (no automatic rollback)
#   rollback                     both env files back from the deploy's backup, compose up, old generation proven
#
# Rehearsal overrides (never on the live names): R3D_CONTAINER, R3D_CONTROL_DIR.
set -euo pipefail

EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; shift; fi
CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

REPO="ghcr.io/botond1/3d-printer-slicer-api"
CUR_REF="$REPO@sha256:f4aafd5c14f3e149f71e8f7736aedb05451477dde31cbd54895576372e94c50b"   # 3.9.0, the rollback target
CUR_SHA="abe899791d69618ba29e75dfb32501d4b8d2c776"
OLD_GENERATION="0af5bd3e2fb980f41e754064b7f869038500f1523bbbb48a5d00b406aa394e27"
NEW_VERSION="3.10.0"
PACK="${R3D_PACK:-/opt/rocket3d/slicer-api-5794efad764af0eb79a52747ce123c5e60c5ac44}"
ENVDIR="${R3D_ENVDIR:-/etc/rocket3d/slicer-api/5794efad764af0eb79a52747ce123c5e60c5ac44}"
ENV_FILE="$ENVDIR/compose-n1-exact-configs.env"
SVC_FILE="$ENVDIR/service-n1.env"
CONTROL_DIR="${R3D_CONTROL_DIR:-/root/r3d-310-control-20261116}"
BACKUP="$CONTROL_DIR/env-backup"
LIVE_NAME="3d-psa-backend-server"
NAME="${R3D_CONTAINER:-$LIVE_NAME}"
MODELS="$CONTROL_DIR/models"
CONTROL_SLICES="cube:orientationMode=auto block:orientationMode=preserve,rotationX=90,rotationY=0,rotationZ=0"
COMMON_FIELDS="material=PLA layerHeight=0.2 infill=20 printerProfile=P1S"

die() { echo "STOP $*" >&2; exit 1; }
say() { echo "== $*"; }
run() { if [ "$EXECUTE" -eq 1 ]; then "$@"; else echo "DRY-RUN would run: $*"; fi; }
is_hex64() { case "$1" in *[!0-9a-f]*|'') return 1 ;; esac; [ "${#1}" -eq 64 ]; }

IN_GET='const http=require("http");const [p,keyName,header]=process.argv.slice(1);const headers={};if(keyName){headers[header||"x-slicer-api-key"]=process.env[keyName]||"";}
http.get({host:"127.0.0.1",port:3000,path:p,headers},(r)=>{const c=[];r.on("data",(d)=>c.push(d));r.on("end",()=>{process.stdout.write(Buffer.concat(c));process.exitCode=r.statusCode===200?0:3;});}).on("error",()=>{process.exitCode=4;});'
IN_STATUS='const [method,p,keyMode]=process.argv.slice(1);const headers={};if(keyMode==="wrong"){headers["x-slicer-api-key"]="0".repeat(64);}
fetch("http://127.0.0.1:3000"+p,{method,headers}).then((r)=>{console.log(r.status);},()=>{console.log("error");});'
IN_HAS_ENV='process.stdout.write(process.env[process.argv[1]]?"yes":"no");'
IN_SLICE='const chunks=[];process.stdin.on("data",(d)=>chunks.push(d));process.stdin.on("end",async()=>{const f=new FormData();f.append("choosenFile",new Blob([Buffer.concat(chunks)]),"control.stl");
const args=process.argv.slice(1);const prefer=args[0]==="async";for(const pair of args.slice(1)){const i=pair.indexOf("=");f.append(pair.slice(0,i),pair.slice(i+1));}
const key=process.env.SLICE_SERVICE_WOOCOMMERCE_API_KEY||"";const headers={"x-slicer-api-key":key};if(prefer){headers.Prefer="respond-async";}
let r=await fetch("http://127.0.0.1:3000/bambu/slice",{method:"POST",headers,body:f});
if(!prefer){process.stdout.write(Buffer.from(await r.arrayBuffer()));process.exitCode=r.status===200?0:3;return;}
if(r.status!==202){process.stdout.write(JSON.stringify({accepted_status:r.status}));process.exitCode=3;return;}
const job=(await r.json()).job_id;let body={};
for(let i=0;i<90;i+=1){await new Promise((ok)=>setTimeout(ok,2000));r=await fetch("http://127.0.0.1:3000/bambu/slice/jobs/"+job,{headers:{"x-slicer-api-key":key}});body=await r.json();if(body.status==="completed"||body.status==="failed"||body.status==="expired"){break;}}
process.stdout.write(JSON.stringify({status:body.status,result_status:body.result_status,success:body.result&&body.result.success,generation:body.result&&body.result.technical_receipt&&body.result.technical_receipt.measurement_generation}));
process.exitCode=body.status==="completed"&&body.result_status===200?0:3;});'

in_node() { docker exec -i "$NAME" node -e "$@"; }
control_slice() { # control_slice <sync|async> <model> <comma-separated fields> <out>
  local extra; extra="$(echo "$3" | tr ',' ' ')"
  # shellcheck disable=SC2086
  in_node "$IN_SLICE" "$1" $COMMON_FIELDS $extra < "$MODELS/$2.stl" > "$4"
}
wait_ready() {
  local i=0
  until [ "$(in_node "$IN_STATUS" GET /ready none 2>/dev/null)" = "200" ]; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "/ready is not 200 after 120 s"
    sleep 2
  done
  echo "ready 200 after $((i * 2)) s"
}
wait_healthy() {
  local i=0
  until [ "$(docker inspect --format '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = "healthy" ]; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then docker logs --tail 30 "$NAME" 2>&1 | cut -c1-300; die "not healthy after 180 s"; fi
    sleep 2
  done
  echo "healthy after $((i * 2)) s"
}
verify_runtime() { # verify_runtime <ref>
  local want_id got
  want_id="$(docker image inspect --format '{{.Id}}' "$1")"
  got="$(docker inspect --format '{{.Config.Image}} {{.Image}} {{.State.Status}} {{.State.Running}} {{.RestartCount}} {{.State.OOMKilled}}' "$NAME")"
  [ "$got" = "$1 $want_id running true 0 false" ] || die "runtime identity mismatch: $got"
  [ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$NAME")" = "slicer-api" ] || die "compose project mismatch"
  [ "$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' "$NAME")" = "12884901888 4000000000" ] || die "resource envelope changed"
  echo "runtime identity ok: $got"
}
compose_up() {
  [ "$NAME" = "$LIVE_NAME" ] || die "compose is only ever run for the live service"
  ( cd "$PACK" && docker compose -p slicer-api --env-file "$ENV_FILE" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api )
}
set_image() { # atomic rewrite of the one SLICER_API_IMAGE line; the file is never printed
  local tmp; grep -q '^SLICER_API_IMAGE=' "$ENV_FILE" || die "SLICER_API_IMAGE missing"
  tmp="$(mktemp "$ENVDIR/.r3d.XXXXXX")"
  sed "s#^SLICER_API_IMAGE=.*#SLICER_API_IMAGE=$1#" "$ENV_FILE" > "$tmp"
  grep -q "^SLICER_API_IMAGE=$1\$" "$tmp" || { rm -f "$tmp"; die "rewrite of SLICER_API_IMAGE failed"; }
  chmod 600 "$tmp"; mv -f "$tmp" "$ENV_FILE"
  echo "compose env: SLICER_API_IMAGE=$1"
}
retain() { # retain <source sha> <digest ref>
  local tag="local/rocket3d-slicer-api:retained-$1" signed kept
  signed="$(docker image inspect --format '{{.Id}}' "$2")"
  if kept="$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null)"; then
    [ "$kept" = "$signed" ] || die "retention tag $tag points elsewhere"
  else
    docker image tag "$2" "$tag"
  fi
  echo "retained $tag"
}

cmd_capture() {
  docker inspect "$NAME" >/dev/null 2>&1 || die "container $NAME not found"
  for model in cube block; do [ -f "$MODELS/$model.stl" ] || die "control model $MODELS/$model.stl missing"; done
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would read the catalogue twice and run 4 control slices on $NAME into $CONTROL_DIR"; return 0; fi
  [ ! -e "$CONTROL_DIR/capture-complete" ] || die "a capture already exists in $CONTROL_DIR"
  docker inspect --format '{{.Config.Image}} {{.Image}}' "$NAME" > "$CONTROL_DIR/image-before.txt"
  in_node "$IN_GET" /profiles > "$CONTROL_DIR/profiles-v2-before.json"
  in_node "$IN_GET" '/profiles?contract=material-v1' > "$CONTROL_DIR/profiles-v3-before.json"
  local spec model fields run
  for run in 1 2; do
    for spec in $CONTROL_SLICES; do
      model="${spec%%:*}"; fields="${spec#*:}"
      control_slice sync "$model" "$fields" "$CONTROL_DIR/control-$model-before-$run.json" || die "control slice $model failed on the baseline"
    done
  done
  python3 - "$CONTROL_DIR" "$OLD_GENERATION" <<'PY'
import json, sys
d, old = sys.argv[1], sys.argv[2]
v3 = json.load(open(f"{d}/profiles-v3-before.json"))
gens = sorted({r["measurement_generation"] for r in v3["profiles"] if "measurement_generation" in r})
print("baseline generation", gens, "rows", len(v3["profiles"]))
if gens != [old]:
    sys.exit("STOP the baseline is not the 3.9.0 generation")
for model in ("cube", "block"):
    for run in (1, 2):
        body = json.load(open(f"{d}/control-{model}-before-{run}.json"))
        print(model, run, body["stats"]["print_time_seconds"], body["stats"]["material_used_g"])
PY
  touch "$CONTROL_DIR/capture-complete"
  say "capture complete in $CONTROL_DIR"
}

cmd_checks() {
  local generation="${1:-}"
  is_hex64 "$generation" || die "usage: checks <expected measurement_generation (64 hex)>"
  [ "$generation" != "$OLD_GENERATION" ] || die "the expected generation is the old one"
  [ -f "$CONTROL_DIR/capture-complete" ] || die "no capture in $CONTROL_DIR"
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would run the post-checks against $NAME with the capture in $CONTROL_DIR"; return 0; fi
  say "1. readiness"
  wait_ready
  say "2. catalogue: same rows, every Bambu row on the new generation"
  in_node "$IN_GET" /profiles > "$CONTROL_DIR/profiles-v2-after.json"
  in_node "$IN_GET" '/profiles?contract=material-v1' > "$CONTROL_DIR/profiles-v3-after.json"
  say "3. capabilities, the active key and the shop's key"
  in_node "$IN_GET" /capabilities SLICE_SERVICE_WOOCOMMERCE_API_KEY > "$CONTROL_DIR/capabilities-active-after.json" || die "/capabilities refused the active key"
  if [ "$(in_node "$IN_HAS_ENV" SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS)" = "yes" ]; then
    in_node "$IN_GET" /capabilities SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS > "$CONTROL_DIR/capabilities-previous-after.json" \
      || die "/capabilities refused the previous key (the key the live shop sends)"
  else
    rm -f "$CONTROL_DIR/capabilities-previous-after.json"
    echo "no previous key in this container (rehearsal): that check is skipped"
  fi
  say "4. negative authentication"
  [ "$(in_node "$IN_STATUS" POST /bambu/slice none)" = "401" ] || die "POST /bambu/slice without a key is not 401"
  [ "$(in_node "$IN_STATUS" POST /bambu/slice wrong)" = "401" ] || die "POST /bambu/slice with a wrong key is not 401"
  [ "$(in_node "$IN_STATUS" GET /bambu/slice/jobs/sj_00000000000000000000000000000000 none)" = "401" ] || die "a job read without a key is not 401"
  echo "401 x 3"
  say "5. control slices"
  local spec model fields
  for spec in $CONTROL_SLICES; do
    model="${spec%%:*}"; fields="${spec#*:}"
    control_slice sync "$model" "$fields" "$CONTROL_DIR/control-$model-after.json" || die "control slice $model failed"
  done
  control_slice async cube "orientationMode=auto" "$CONTROL_DIR/control-async-after.json" || die "the asynchronous control slice did not complete"
  docker logs --since 15m "$NAME" > "$CONTROL_DIR/log-after.txt" 2>&1 || true
  python3 - "$CONTROL_DIR" "$generation" "$OLD_GENERATION" "$NEW_VERSION" <<'PY'
import json, os, sys
d, new, old, version = sys.argv[1:5]
fail = []
def load(name):
    return json.load(open(f"{d}/{name}"))
for tag in ("v2", "v3"):
    before, after = load(f"profiles-{tag}-before.json"), load(f"profiles-{tag}-after.json")
    rows_b = {r["id"]: r for r in before["profiles"]}
    rows_a = {r["id"]: r for r in after["profiles"]}
    if list(rows_b) != list(rows_a):
        fail.append(f"{tag}: the row set or order changed")
    moved = 0
    for key, row in rows_a.items():
        was = dict(rows_b.get(key, {}))
        now = dict(row)
        if "measurement_generation" in was or "measurement_generation" in now:
            if was.get("measurement_generation") != old or now.get("measurement_generation") != new:
                fail.append(f"{tag}: {key} generation {was.get('measurement_generation')} -> {now.get('measurement_generation')}")
            was.pop("measurement_generation", None); now.pop("measurement_generation", None)
            moved += 1
        if was != now:
            fail.append(f"{tag}: {key} differs beyond the generation: {sorted(k for k in set(was) | set(now) if was.get(k) != now.get(k))}")
    rest_b = {k: v for k, v in before.items() if k not in ("profiles", "catalogue_sha256")}
    rest_a = {k: v for k, v in after.items() if k not in ("profiles", "catalogue_sha256")}
    if rest_b != rest_a:
        fail.append(f"{tag}: catalogue fields outside the rows changed")
    print(f"catalogue {tag}: rows {len(rows_a)}, on the new generation {moved}, catalogue_sha256 {before['catalogue_sha256'][:12]} -> {after['catalogue_sha256'][:12]}")
cap = load("capabilities-active-after.json")
if cap.get("service_version") != version: fail.append(f"service_version {cap.get('service_version')}")
if (cap.get("measurement_generation") or {}).get("bambu") != new: fail.append("capabilities generation is not the expected one")
lane = cap.get("fast_lane") or {}
if lane.get("max_concurrent") != 1 or "enabled" not in lane: fail.append("capabilities has no fast_lane")
if (cap.get("authenticated_as") or {}).get("principal") != "woocommerce": fail.append("active key principal")
print("capabilities:", cap.get("service_version"), "fast_lane", lane, "as", cap.get("authenticated_as"))
if os.path.exists(f"{d}/capabilities-previous-after.json"):
    prev = load("capabilities-previous-after.json").get("authenticated_as") or {}
    print("previous key (the shop's):", prev)
    if prev != {"principal": "woocommerce", "rotation": "previous"}: fail.append("the previous key is not woocommerce/previous")
IDENTITY = ("source", "engine", "profiles", "applied", "geometry", "scope", "identity")
for model in ("cube", "block"):
    befores = [load(f"control-{model}-before-{run}.json") for run in (1, 2)]
    after = load(f"control-{model}-after.json")
    receipt = after.get("technical_receipt") or {}
    if after.get("success") is not True: fail.append(f"{model}: not successful"); continue
    if receipt.get("measurement_generation") != new: fail.append(f"{model}: receipt generation")
    base = befores[0]
    for path in IDENTITY:
        if base["technical_receipt"].get(path) != receipt.get(path):
            fail.append(f"{model}: technical_receipt.{path} differs from the capture")
    if base.get("model_transform") != after.get("model_transform"): fail.append(f"{model}: model_transform differs")
    for fact in ("print_time_seconds", "material_used_g"):
        seen = [b["stats"][fact] for b in befores]
        low, high = min(seen) * 0.99, max(seen) * 1.01
        value = after["stats"][fact]
        exact = value in seen
        print(f"control {model}: {fact} {value} (capture {seen}) {'equal' if exact else 'inside 1 %' if low <= value <= high else 'OUTSIDE'}")
        if not low <= value <= high: fail.append(f"{model}: {fact} {value} outside the capture {seen}")
    print(f"control {model}: identity objects equal, job_sha256 {receipt.get('identity', {}).get('job_sha256', '')[:12]}")
asynchronous = load("control-async-after.json")
print("async control:", asynchronous)
if asynchronous.get("status") != "completed" or asynchronous.get("generation") != new: fail.append("async control slice")
log = open(f"{d}/log-after.txt", encoding="utf-8", errors="replace").read()
sized = log.count('"event":"slice.model_inspected"')
named = log.count('"native_kind":"inspect_mesh"')
print("log: slice.model_inspected", sized, "| native steps named inspect_mesh", named)
if sized < 3 or named < 3: fail.append("the new log lines are missing")
if fail:
    print("STOP post-checks failed:")
    for line in fail: print("  -", line)
    sys.exit(3)
print("PASS post-checks")
PY
}

cmd_deploy() {
  local ref="${1:-}" sha="${2:-}" generation="${3:-}"
  case "$ref" in "$REPO"@sha256:*) ;; *) die "usage: deploy <digest ref> <source sha> <expected generation>" ;; esac
  case "$sha" in *[!0-9a-f]*|'') die "bad source sha" ;; esac
  [ "${#sha}" -eq 40 ] || die "bad source sha"
  is_hex64 "$generation" || die "bad expected generation"
  [ "$NAME" = "$LIVE_NAME" ] || die "deploy is only for the live service; use checks for a rehearsal"
  [ -f "$CONTROL_DIR/capture-complete" ] || die "run capture first"
  say "0. before"
  docker inspect "$NAME" --format '{{.Config.Image}} restarts={{.RestartCount}} state={{.State.Status}} health={{.State.Health.Status}}'
  [ "$(sed -n 's/^SLICER_API_IMAGE=//p' "$ENV_FILE")" = "$CUR_REF" ] || die "the current image is not the 3.9.0 rollback target"
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would pull $ref, prove it, back up both env files to $BACKUP, rewrite SLICER_API_IMAGE, compose up and run the post-checks"; return 0; fi
  say "1. pull and prove the candidate"
  docker pull "$ref" | tail -2
  [ "$(docker inspect "$ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$sha" ] || die "revision label differs from $sha"
  local ids
  ids="$(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 16 --memory 64m --memory-swap 64m --cpus 0.25 --entrypoint /usr/bin/id "$ref" -u):$(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 16 --memory 64m --memory-swap 64m --cpus 0.25 --entrypoint /usr/bin/id "$ref" -g)"
  [ "$ids" = "999:999" ] || die "service identity drift: $ids"
  retain "$CUR_SHA" "$CUR_REF"
  retain "$sha" "$ref"
  ( cd "$PACK" && SLICER_API_IMAGE="$ref" node scripts/i7-production-compose-contract.js )
  [ "$(cd "$PACK" && SLICER_API_IMAGE="$ref" docker compose -p slicer-api --env-file "$ENV_FILE" -f docker-compose.production.yml config --images)" = "$ref" ] || die "rendered image differs"
  say "2. backup and rewrite"
  mkdir -m 700 -p "$BACKUP"
  [ -f "$BACKUP/compose-n1-exact-configs.env" ] || install -m 600 "$ENV_FILE" "$BACKUP/compose-n1-exact-configs.env"
  [ -f "$BACKUP/service-n1.env" ] || install -m 600 "$SVC_FILE" "$BACKUP/service-n1.env"
  set_image "$ref"
  say "3. cutover $(date -u +%H:%M:%SZ)"
  compose_up
  wait_healthy
  verify_runtime "$ref"
  say "4. post-checks"
  if ! cmd_checks "$generation"; then
    echo "STOP the new container runs but a post-check failed. Rollback: bash $0 --execute rollback" >&2
    exit 3
  fi
  say "PASS 3.10.0 is live as $ref. Rollback: bash $0 --execute rollback"
}

cmd_rollback() {
  [ "$NAME" = "$LIVE_NAME" ] || die "rollback is only for the live service"
  [ -f "$BACKUP/compose-n1-exact-configs.env" ] && [ -f "$BACKUP/service-n1.env" ] || die "no env backup in $BACKUP"
  [ "$(sed -n 's/^SLICER_API_IMAGE=//p' "$BACKUP/compose-n1-exact-configs.env")" = "$CUR_REF" ] || die "the backup does not name the 3.9.0 image"
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would restore both env files from $BACKUP and compose up $CUR_REF"; return 0; fi
  say "ROLLBACK to $CUR_REF $(date -u +%H:%M:%SZ)"
  install -m 600 "$BACKUP/compose-n1-exact-configs.env" "$ENV_FILE"
  install -m 600 "$BACKUP/service-n1.env" "$SVC_FILE"
  compose_up
  wait_healthy
  verify_runtime "$CUR_REF"
  wait_ready
  in_node "$IN_GET" '/profiles?contract=material-v1' > "$CONTROL_DIR/profiles-v3-rollback.json"
  python3 - "$CONTROL_DIR/profiles-v3-rollback.json" "$OLD_GENERATION" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))["profiles"]
gens = sorted({r["measurement_generation"] for r in rows if "measurement_generation" in r})
print("generation after rollback", gens)
sys.exit(0 if gens == [sys.argv[2]] else "STOP the old generation is not back")
PY
  say "PASS rollback: 3.9.0 runs with the old generation"
}

case "$CMD" in
  capture) cmd_capture ;;
  checks) cmd_checks "$@" ;;
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  *) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
