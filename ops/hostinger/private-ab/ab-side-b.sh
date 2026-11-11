#!/usr/bin/env bash
# Driver for side B (3.9.0) of the private A/B run. Usage: ab-side-b.sh <image-ref>
# Runs on the VPS detached; log: /root/r3d-390-control-20261111/side-B.log. No secret is printed.
set -uo pipefail
IMG="$1"
CTL=/root/r3d-390-control-20261111
AB=$CTL/pack/private-ab
KEYS=/root/r3d-s390-keys/private.env
WORK=/srv/r3d-s390-ab
PRIV=r3d-s390-private
abc() {
  docker run --rm --name "r3d-s390-ab-client-$$-$RANDOM" \
    --network r3d-s390-internal \
    --env-file "$KEYS" \
    --read-only --user 999:999 --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --memory 512m --cpus 0.5 --pids-limit 64 --oom-score-adj 1000 \
    -v "$AB":/client:ro -v "$WORK/corpus":/corpus:ro -v "$WORK/out":/out \
    --entrypoint node "$IMG" /client/ab-client.js "$@"
}
step() { echo "=== $(date -u +%H:%M:%S) $*"; "$@"; echo "=== exit $? ($*)"; }
state() { docker inspect -f '{{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' $PRIV; }
wait_healthy() { for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' $PRIV 2>/dev/null)" = "healthy" ] && return 0; sleep 5; done; return 1; }

# Export must be on for T-EXP; the live TTL and upload cap are exercised too.
grep -q '^EXPORT_ROUTE_ENABLED=' "$KEYS" || printf 'EXPORT_ROUTE_ENABLED=true\nARTIFACT_TTL_MS=3600000\nMAX_UPLOAD_BYTES=125829120\n' >> "$KEYS"

step bash "$AB/run-private-ab.sh" --execute up B "$IMG"
wait_healthy || { echo "STOP private container not healthy"; docker logs --tail 40 $PRIV 2>&1 | cut -c1-400; exit 1; }
echo "image: $(docker inspect -f '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' $PRIV)"
step abc ready 60 B
step abc catalogue B
step abc capabilities B

# corpus run 1 with the /ready latency probe beside it, plus process reads while a native runs
( sleep 6; abc ready 150 B > "$CTL/ready-busy-B.log" 2>&1; echo "ready-busy exit $?" >> "$CTL/ready-busy-B.log" ) &
READY_PID=$!
( for n in $(seq 1 40); do
    sleep 3
    PIDS="$(docker top $PRIV -o pid,args 2>/dev/null | awk 'NR>1 && ($0 ~ /bambu-studio|python|node /) {print $1}' | head -12)"
    [ -n "$PIDS" ] || continue
    if docker top $PRIV -o pid,args | grep -qE 'bambu-studio|python'; then
      { echo "--- sample $n $(date -u +%T)"; docker top $PRIV -o pid,args | cut -c1-150
        for p in $PIDS; do echo "$p oom_score_adj=$(cat /proc/$p/oom_score_adj 2>/dev/null) core=$(grep 'Max core file size' /proc/$p/limits 2>/dev/null | awk '{print $5,$6}')"; done
      } >> "$CTL/proc-reads-B.log" 2>&1
      break
    fi
  done ) &
step abc corpus B 1 --skip bomb3mf-auto
echo "state: $(state)"
wait $READY_PID 2>/dev/null
step abc corpus B 1 --only bomb3mf-auto
echo "state after bomb: $(state)"
for run in 2 3; do
  step abc corpus B $run --skip bomb3mf-auto
  step abc corpus B $run --only bomb3mf-auto
  echo "state run $run: $(state)"
done
step abc export 1

# deletion of the slicer's copy with T-RET-4 in the middle
rm -f "$WORK/out/go-delete"
( abc delete-artifact > "$CTL/delete-artifact-B.log" 2>&1; echo "delete-artifact exit $?" >> "$CTL/delete-artifact-B.log" ) &
DEL_PID=$!
for i in $(seq 1 60); do sleep 3; ls /srv/r3d-s390-private/output/*.gcode.3mf >/dev/null 2>&1 && grep -q 'NOW on the host' "$CTL/delete-artifact-B.log" 2>/dev/null && break; done
echo "--- output dir before DELETE"; ls -la /srv/r3d-s390-private/output/ | cut -c1-200
ART="$(ls -t /srv/r3d-s390-private/output/*.gcode.3mf 2>/dev/null | head -1)"
if [ -n "$ART" ]; then
  cp "$ART" "$CTL/tret4-cube.gcode.3mf"
  echo "--- T-RET-4: parts of our own cube artifact"; unzip -l "$CTL/tret4-cube.gcode.3mf" | cut -c1-160
  for m in $(unzip -Z1 "$CTL/tret4-cube.gcode.3mf" | grep -i '\.model$'); do
    echo "model part $m: bytes=$(unzip -p "$CTL/tret4-cube.gcode.3mf" "$m" | wc -c) vertices=$(unzip -p "$CTL/tret4-cube.gcode.3mf" "$m" | grep -o '<vertex ' | wc -l) triangles=$(unzip -p "$CTL/tret4-cube.gcode.3mf" "$m" | grep -o '<triangle ' | wc -l)"
  done
fi
install -o 999 -g 999 -m 0600 /dev/null "$WORK/out/go-delete"
wait $DEL_PID 2>/dev/null
sleep 2
echo "--- output dir after DELETE"; ls -la /srv/r3d-s390-private/output/ | cut -c1-200
echo "--- delete-artifact log"; cut -c1-300 "$CTL/delete-artifact-B.log"
step abc auth B
echo "--- mounts"; findmnt --task "$(docker inspect -f '{{.State.Pid}}' $PRIV)" -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | grep -E '/app|/tmp' | cut -c1-200
echo "--- node limits"; NP="$(docker top $PRIV -o pid,args | awk '/node .*server/ {print $1; exit}')"; echo "node pid $NP oom_score_adj=$(cat /proc/$NP/oom_score_adj) core=$(grep 'Max core file size' /proc/$NP/limits | awk '{print $5,$6}')"
echo "--- service events of interest"; docker logs $PRIV 2>&1 | grep -E '"event":"(runtime\.|identity\.|auth\.slot|artifact\.sweep|workspace\.purge|export\.|archive\.)' | cut -c1-260 | awk '!seen[substr($0,1,60)]++' | head -40
step abc compare
echo "SIDE-B-DONE $(date -u +%FT%TZ)"
