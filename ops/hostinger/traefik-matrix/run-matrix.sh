#!/usr/bin/env bash
# T-TRF (slicer 3.9.0, spec §7 / §8 step 5): proves a RENDERED slicer-api.yml on
# a throwaway Traefik of the live digest, offline, before it is swapped in.
#
#   run-matrix.sh plan --rendered <file>                     (default; no docker)
#   run-matrix.sh run  --rendered <file> --evidence <dir>    (needs docker)
#
# The throwaway router file is the rendered file with the live ranges replaced
# BY POSITION (1st = LeadPilot position -> 172.31.239.12, 2nd = shop position
# -> 172.31.239.11); the script proves that only those lines differ. Cases
# (cases.json): every method x path from the shop- and LeadPilot-position
# addresses (rule match -> whoami 200, else Traefik 404) and from the unlisted
# 172.31.239.13 (rule match -> ipAllowList 403, else 404); plus the health
# check: the file's block is /ready 10s/8s and whoami sees Traefik's GET /ready.
#
# Never prints an address of the input file or a digest. Evidence holds only
# the test-network addresses. The compose project is r3d-trf-<ts>, internal
# network only, removed at the end (also on failure).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$HERE/compose.yml"
CASES_FILE="$HERE/cases.json"
HOST="api.rocket3d.hu"
TRAEFIK_IP="172.31.239.2"

die() { echo "STOP $*" >&2; exit 1; }
usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

MODE="${1:-plan}"
[ "$#" -gt 0 ] && shift
RENDERED=""
EVIDENCE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rendered) RENDERED="${2:-}"; shift 2 ;;
    --evidence) EVIDENCE="${2:-}"; shift 2 ;;
    *) usage >&2; die "unknown argument" ;;
  esac
done
case "$MODE" in plan|run) ;; help|-h|--help) usage; exit 0 ;; *) usage >&2; die "unknown subcommand" ;; esac
[ -n "$RENDERED" ] && [ -f "$RENDERED" ] && [ ! -L "$RENDERED" ] || die "--rendered must name a regular file"
command -v node >/dev/null || die "node is required"
[ -f "$CASES_FILE" ] && [ -f "$COMPOSE_FILE" ] || die "matrix pack incomplete"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/r3d-trf.XXXXXX")"
chmod 700 "$WORK"
PROJECT="r3d-trf-$(date -u +%Y%m%dT%H%M%SZ | tr 'A-Z' 'a-z')"
cleanup() {
  if [ "$MODE" = "run" ] && [ -n "${STARTED:-}" ]; then
    R3D_TRF_DYNAMIC_DIR="$WORK/dynamic" docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down --volumes --timeout 5 >/dev/null 2>&1 || true
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT
mkdir "$WORK/dynamic" # inside the 0700 work dir

# Build the throwaway file and prove the diff (only the two range lines).
node - "$RENDERED" "$WORK/dynamic/slicer-api.yml" <<'NODE'
const fs = require('node:fs');
const [rendered, out] = process.argv.slice(2);
const source = fs.readFileSync(rendered, 'utf8');
const lines = source.split('\n');
const start = lines.indexOf('        sourceRange:');
if (start < 0) { console.error('STOP no sourceRange block'); process.exit(1); }
const items = [];
for (let i = start + 1; i < lines.length && /^ {10}- "/.test(lines[i]); i += 1) items.push(i);
if (items.length !== 2 || !items.every((i) => /^ {10}- "(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/32"$/.test(lines[i]))) {
  console.error('STOP the rendered file must carry exactly two /32 ranges (LeadPilot, shop)');
  process.exit(1);
}
const health = '        healthCheck:\n          path: /ready\n          interval: 10s\n          timeout: 8s\n';
if (!source.includes(health)) { console.error('STOP healthCheck block is not /ready 10s/8s'); process.exit(1); }
if (!/^ {6}rule: "Host\(`api\.rocket3d\.hu`\) && \(/m.test(source)) {
  console.error('STOP the rendered rule is not the 3.9.0 public-routes rule'); process.exit(1);
}
const copy = lines.slice();
copy[items[0]] = '          - "172.31.239.12/32"';
copy[items[1]] = '          - "172.31.239.11/32"';
const differing = copy.map((line, i) => (line === lines[i] ? -1 : i)).filter((i) => i >= 0);
if (differing.join(',') !== items.join(',')) { console.error('STOP throwaway differs beyond the ranges'); process.exit(1); }
fs.writeFileSync(out, copy.join('\n'), { mode: 0o600 });
console.log(`throwaway router ready: ranges substituted by position=2 differing_lines=${differing.length}`);
NODE

CASE_COUNT="$(node -e 'console.log(require(process.argv[1]).cases.length)' "$CASES_FILE")"
if [ "$MODE" = "plan" ]; then
  echo "DRY-RUN (plan): nothing started. Steps 'run' would take:"
  echo "  1. docker compose -p $PROJECT -f $COMPOSE_FILE up --detach --wait (internal network 172.31.239.0/24)"
  echo "  2. wait for Traefik to load the router (shop-position GET /health = 200, <= 30 s)"
  echo "  3. $CASE_COUNT cases x 3 clients (shop .11, LeadPilot .12, unlisted .13) with curl --resolve $HOST:8443:$TRAEFIK_IP"
  echo "  4. health check: block /ready 10s/8s (proved above) and whoami logs a GET /ready"
  echo "  5. results to <evidence>/t-trf-results.tsv, then docker compose down --volumes of $PROJECT"
  exit 0
fi

command -v docker >/dev/null || die "docker is required for run"
[ -n "$EVIDENCE" ] || die "--evidence <dir> is required for run"
mkdir -p "$EVIDENCE"
export R3D_TRF_DYNAMIC_DIR="$WORK/dynamic"
STARTED=1
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up --detach --wait >/dev/null

probe() { # probe <client> <method> <path> -> http code
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T "$1" \
    curl -sk -o /dev/null -w '%{http_code}' --max-time 5 -X "$2" -H "Host: $HOST" \
    --resolve "$HOST:8443:$TRAEFIK_IP" "https://$HOST:8443$3" || echo "000"
}
i=0
until [ "$(probe client-shop GET /health)" = "200" ]; do
  i=$((i + 1)); [ "$i" -le 30 ] || die "router not loaded after 30 s"
  sleep 1
done

RESULTS="$EVIDENCE/t-trf-results.tsv"
printf 'method\tpath\tclient\texpected\tgot\n' > "$RESULTS"
FAILURES=0
while IFS=$'\t' read -r method path router; do
  for client in client-shop client-leadpilot client-unlisted; do
    if [ "$router" = "true" ]; then
      [ "$client" = "client-unlisted" ] && expected=403 || expected=200
    else
      expected=404
    fi
    got="$(probe "$client" "$method" "$path")"
    printf '%s\t%s\t%s\t%s\t%s\n' "$method" "$path" "$client" "$expected" "$got" >> "$RESULTS"
    [ "$got" = "$expected" ] || FAILURES=$((FAILURES + 1))
  done
done < <(node -e 'for (const c of require(process.argv[1]).cases) console.log([c.method, c.path, c.router].join("\t"))' "$CASES_FILE")

sleep 11 # one health-check interval
if docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs backend 2>/dev/null | grep -q 'GET /ready'; then
  echo "health check: Traefik probes /ready" | tee "$EVIDENCE/t-trf-health.txt"
else
  echo "health check: no GET /ready seen" | tee "$EVIDENCE/t-trf-health.txt"; FAILURES=$((FAILURES + 1))
fi
echo "T-TRF cases=$CASE_COUNT probes=$((CASE_COUNT * 3)) failures=$FAILURES" | tee "$EVIDENCE/t-trf-summary.txt"
[ "$FAILURES" -eq 0 ] || exit 1
