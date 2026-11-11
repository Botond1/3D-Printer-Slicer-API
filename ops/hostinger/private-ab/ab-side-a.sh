#!/usr/bin/env bash
# Driver for one side of the private A/B run. Usage: ab-side.sh <A|B> <image-ref>
# Runs on the VPS under nohup; log in /srv/r3d-s390-ab/out/side-<side>.log. No secret is printed.
set -uo pipefail
SIDE="$1"; IMG="$2"
AB=/root/r3d-390-control-20261111/pack/private-ab
KEYS=/root/r3d-s390-keys/private.env
WORK=/srv/r3d-s390-ab
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
state() { docker inspect -f '{{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' r3d-s390-private; }
peak() { cat "/sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' r3d-s390-private).scope/memory.peak" 2>/dev/null; }

if [ ! -f "$KEYS" ]; then step bash "$AB/run-private-ab.sh" --execute prepare; fi
install -d -o 999 -g 999 -m 0700 "$WORK" "$WORK/corpus" "$WORK/out"
if [ ! -f "$WORK/corpus/cases.json" ]; then
  docker run --rm --network none --read-only --user 999:999 --cap-drop ALL \
    -v "$AB":/client:ro -v "$WORK/corpus":/corpus \
    --entrypoint node "$IMG" /client/make-corpus.js /corpus
  ( cd "$WORK/corpus" && sha256sum * ) > "$WORK/out/corpus.sha256"
fi
step bash "$AB/run-private-ab.sh" --execute up "$SIDE" "$IMG"
for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' r3d-s390-private 2>/dev/null)" = "healthy" ] && break; sleep 5; done
step abc ready 5 "$SIDE"
step abc catalogue "$SIDE"
step abc capabilities "$SIDE"
for run in 1 2 3; do
  step abc corpus "$SIDE" "$run" --skip bomb3mf-auto
  echo "state: $(state) memory.peak=$(peak)"
  step abc corpus "$SIDE" "$run" --only bomb3mf-auto
  echo "state after bomb: $(state) memory.peak=$(peak)"
  if [ "$(docker inspect -f '{{.State.Running}}' r3d-s390-private)" != "true" ]; then
    step bash "$AB/run-private-ab.sh" --execute up "$SIDE" "$IMG"
    for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' r3d-s390-private 2>/dev/null)" = "healthy" ] && break; sleep 5; done
  fi
done
step abc auth "$SIDE"
echo "SIDE-$SIDE-DONE $(date -u +%FT%TZ)"
