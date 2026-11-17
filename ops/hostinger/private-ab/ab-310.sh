#!/usr/bin/env bash
# Private A/B of slicer 3.10.0 before publication. A = the live 3.9.0 image as it is;
# B = the same image with the changed application files bind-mounted read-only over
# /app (patch/MAP). No published port, internal network, throwaway keys. No secret is printed.
# Usage: ab-310.sh <prepare|side A|side B|heavy A|heavy B|lane A|lane B|compare|down>
set -uo pipefail
IMG="ghcr.io/botond1/3d-printer-slicer-api@sha256:f4aafd5c14f3e149f71e8f7736aedb05451477dde31cbd54895576372e94c50b"
CTL=/root/r3d-310-control-20261116
AB=$CTL/pack/private-ab
KEYS=/root/r3d-s390-keys/private.env
WORK=/srv/r3d-s310-ab
PRIV=r3d-s390-private
CONFIGS=/opt/rocket3d/slicer-api-5794efad764af0eb79a52747ce123c5e60c5ac44/configs
HEAVY="ellipsoid540k-auto,ellipsoid540k-open-preserve,ellipsoid540k-open-auto,pillars900-open-preserve"
MEM="${R3D_S390_MEMORY_BYTES:-3221225472}"

abc() {
  docker run --rm --name "r3d-s390-ab-client-$$-$RANDOM" \
    --network r3d-s390-internal --env-file "$KEYS" \
    --read-only --user 999:999 --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --memory 512m --cpus 0.5 --pids-limit 64 --oom-score-adj 1000 \
    -v "$AB":/client:ro -v "$WORK/corpus":/corpus:ro -v "$WORK/out":/out \
    --entrypoint node "$IMG" "$@"
}
step() { echo "=== $(date -u +%H:%M:%S) $*"; "$@"; echo "=== exit $? ($1 $2 $3 $4)"; }
state() { docker inspect -f '{{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' $PRIV; }
peak() { cat "/sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' $PRIV).scope/memory.peak" 2>/dev/null; }
wait_healthy() { for _ in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' $PRIV 2>/dev/null)" = "healthy" ] && return 0; sleep 5; done; return 1; }
up() { # up A|B
  local files=(-f "$AB/compose.private.yml")
  [ "$1" = "B" ] && files+=(-f "$CTL/compose.patch.yml")
  R3D_S390_IMAGE="$IMG" R3D_S390_CHILD_OOM_SCORE_ADJ=1000 R3D_S390_ENV_FILE="$KEYS" R3D_S390_CONFIGS_DIR="$CONFIGS" \
    R3D_S390_MEMORY_BYTES="$MEM" docker compose -p r3d-s390 "${files[@]}" up --detach --pull never --force-recreate
  [ "$(docker inspect --format '{{.HostConfig.OomScoreAdj}}' $PRIV)" = "1000" ] || { echo "STOP oom_score_adj"; exit 1; }
  [ -z "$(docker port $PRIV)" ] || { echo "STOP a port is published"; exit 1; }
  wait_healthy || { echo "STOP not healthy"; docker logs --tail 30 $PRIV 2>&1 | cut -c1-300; exit 1; }
  echo "up $1: $(docker inspect -f '{{.Config.Image}} mem={{.HostConfig.Memory}}' $PRIV) mounts=$(docker inspect -f '{{len .Mounts}}' $PRIV)"
}

case "${1:-}" in
  prepare)
    bash "$AB/run-private-ab.sh" --execute prepare || exit 1
    printf 'EXPORT_ROUTE_ENABLED=true\nARTIFACT_TTL_MS=3600000\nMAX_UPLOAD_BYTES=125829120\nSLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS=%s\n' "$(openssl rand -hex 32)" >> "$KEYS"
    install -d -o 999 -g 999 -m 0700 "$WORK/out"
    chmod -R a+rX "$WORK/corpus" "$WORK/patch"
    { echo "services:"; echo "  private:"; echo "    volumes:"
      while read -r name target; do
        [ -f "$WORK/patch/$name" ] || { echo "missing patch $name" >&2; exit 1; }
        printf '      - type: bind\n        source: %s\n        target: %s\n        read_only: true\n' "$WORK/patch/$name" "$target"
      done < "$WORK/patch/MAP"; } > "$CTL/compose.patch.yml"
    grep -c 'type: bind' "$CTL/compose.patch.yml"
    ;;
  side)
    S="$2"; up "$S"
    step abc /client/ab-client.js ready 5 "$S"
    step abc /client/ab-client.js catalogue "$S"
    step abc /client/ab-client.js capabilities "$S"
    for run in 1 2; do
      step abc /client/ab-client.js corpus "$S" "$run" --skip "bomb3mf-auto,$HEAVY"
      echo "state run $run: $(state) peak=$(peak)"
    done
    docker logs $PRIV > "$CTL/log-side-$S.txt" 2>&1
    ;;
  heavy)
    S="$2"
    for id in ${HEAVY//,/ }; do
      up "$S"
      step abc /client/ab-client.js corpus "$S" 1 --only "$id"
      echo "heavy $S $id: $(state) peak=$(peak)"
      docker logs $PRIV > "$CTL/log-heavy-$S-$id.txt" 2>&1
    done
    ;;
  lane)
    S="$2"; up "$S"
    step abc /client/lane-probe.js "$S"
    docker logs $PRIV > "$CTL/log-lane-$S.txt" 2>&1
    ;;
  compare)
    docker run --rm --network none --read-only --user 999:999 --cap-drop ALL \
      -v "$AB":/client:ro -v "$WORK/corpus":/corpus:ro -v "$WORK/out":/out \
      --entrypoint node "$IMG" /client/ab-client.js compare; echo "compare exit=$?"
    ;;
  down)
    R3D_S390_IMAGE=unused R3D_S390_ENV_FILE="$KEYS" R3D_S390_CONFIGS_DIR="$CONFIGS" \
      docker compose -p r3d-s390 -f "$AB/compose.private.yml" down --volumes --timeout 30
    docker network inspect r3d-s390-internal >/dev/null 2>&1 && docker network rm r3d-s390-internal
    rm -r -- /srv/r3d-s390-private "$WORK"
    shred -u "$KEYS" && rmdir /root/r3d-s390-keys
    docker ps -a --format '{{.Names}}' | grep -c 'r3d-s390' || true
    ;;
  *) echo "usage: ab-310.sh <prepare|side A|side B|heavy A|heavy B|lane A|lane B|compare|down>"; exit 2 ;;
esac
