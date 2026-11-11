#!/usr/bin/env bash
# Slicer 3.9.0 production cutover (spec docs/release/3.9.0-specification.md §6, §8).
# Derived from /root/r3d-383-control-20261026/deploy-383.sh (pull + revision label,
# retention tags, atomic env rewrite, compose up, runtime identity, readiness,
# catalogue checks, control slices). Generation-neutral: the catalogue bodies and
# every identity field of the control slices must equal the 3.8.3 capture.
#
# DRY-RUN BY DEFAULT. Nothing is written, pulled, restarted or swapped unless the
# first argument is --execute. Secrets are never printed: env values are compared
# by sha256 inside the script, keys are read inside the container from its own
# environment, and every diff is printed as NAMES only.
#
# Usage: deploy-390.sh [--execute] <subcommand> [arguments]
#   check-env                         read both env files, prove the 3.9.0 rewrite in a
#                                     private temp dir (must-survive lists, key-ring move)
#   capture                           §8 step 2: control dir, both env files, limits, catalogue,
#                                     live router copy, two control slices run twice, retention tag
#   slot-prefixes                     optional C5 check: first 12 hex of sha256 per key slot
#   deploy <ref> <sha> --export-route true|false [--aa-spread <fraction>]
#                                     §8 step 4 (cutover); automatic rollback only on an idle queue
#   rollback <ref> <sha> [--backup <env-backup-dir>]
#                                     §8 step 6: both env files back, key-ring move re-applied
#   keyring-only                      §10.1 fallback on 3.8.3: the key-ring move alone
#   traefik                           §8 step 5: render from the live file, T-TRF, swap, 60 s auto-restore
#   traefik-watch --orig <file> [--seconds N] [--no-restore]
#                                     the access-log watch alone (restore on a shop 403/404/unrouted)
#
# Paths default to the live layout; R3D_* variables override them (fixtures only):
#   R3D_COMPOSE_ENV, R3D_PACK, R3D_DYNAMIC_DIR, R3D_CONTROL_DIR, R3D_RELEASE_TREE,
#   R3D_ACCESS_LOG_FILE (read instead of `docker logs 3d-psa-traefik`), R3D_WATCH_SECONDS.
set -euo pipefail

EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; shift; fi
CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACK="${R3D_PACK:-/opt/rocket3d/slicer-api-5794efad764af0eb79a52747ce123c5e60c5ac44}"
COMPOSE_ENV="${R3D_COMPOSE_ENV:-/etc/rocket3d/slicer-api/5794efad764af0eb79a52747ce123c5e60c5ac44/compose-n1-exact-configs.env}"
DYNAMIC_DIR="${R3D_DYNAMIC_DIR:-/opt/rocket3d/slicer-api-9e9621a3f6110192aeb77a5c182da5aad79c80e7/ops/hostinger/dynamic}"
CONTROL_DIR="${R3D_CONTROL_DIR:-/root/r3d-390-control-$(date -u +%Y%m%d)}"
RELEASE_TREE="${R3D_RELEASE_TREE:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
WATCH_SECONDS="${R3D_WATCH_SECONDS:-60}"
NAME="3d-psa-backend-server"
TRAEFIK_NAME="3d-psa-traefik"
HOST="api.rocket3d.hu"
ALLOWLIST_PHASE="production-two-range"
REPO="ghcr.io/botond1/3d-printer-slicer-api"
OLD_SHA="dbc539e98fb5105b522578dffcb2d93a77fff8b9"   # 3.8.3, the rollback target's revision label
TS="$(date -u +%Y%m%dT%H%M%SZ)"

die() { echo "STOP $*" >&2; exit 1; }
say() { echo "== $*"; }
# run: executes with --execute, prints the command otherwise.
run() { if [ "$EXECUTE" -eq 1 ]; then "$@"; else echo "DRY-RUN would run: $*"; fi; }
usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

TOOLDIR="$(mktemp -d "${TMPDIR:-/tmp}/r3d-390.XXXXXX")"
chmod 700 "$TOOLDIR"
trap 'rm -rf -- "$TOOLDIR"' EXIT
TOOL="$TOOLDIR/envtool.js"

# ---------------------------------------------------------------------------
# envtool: env files, limits, logs and slice facts. Never prints a value.
# ---------------------------------------------------------------------------
cat > "$TOOL" <<'NODE'
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COMPOSE_NAMES = ['SLICER_API_IMAGE', 'SLICER_ENV_FILE', 'SLICER_MEMORY_BYTES', 'SLICER_CPU_LIMIT',
  'SLICER_PIDS_LIMIT', 'SLICER_UID', 'SLICER_GID', 'SLICER_LOG_MAX_SIZE', 'SLICER_LOG_MAX_FILES',
  'SLICER_STOP_GRACE_PERIOD', 'SLICER_INPUT_DIR', 'SLICER_OUTPUT_DIR', 'SLICER_CONFIGS_DIR',
  'SLICER_PRICING_STATE_DIR'];
// §6 live values (12 GiB / 4.0 CPU / pids 512 / 30 s grace); compared by hash.
const COMPOSE_PINS = { SLICER_MEMORY_BYTES: '12884901888', SLICER_CPU_LIMIT: '4.0', SLICER_PIDS_LIMIT: '512',
  SLICER_STOP_GRACE_PERIOD: '30s' };
const SERVICE_PINS = { MAX_CONCURRENT_SLICES: '2', MAX_SLICE_QUEUE_LENGTH: '24', MAX_SLICE_QUEUE_PER_IP: '20',
  MAX_SLICE_QUEUE_WAIT_MS: '240000', ASYNC_SLICE_DEADLINE_MS: '900000', PYTHON_HELPER_TIMEOUT_MS: '300000',
  ORIENTATION_HELPER_TIMEOUT_MS: '60000', SLICE_RATE_LIMIT_MAX_REQUESTS: '30',
  SLICE_RATE_LIMIT_BURST_CAPACITY: '20', NODE_ENV: 'production', PORT: '3000', TRUST_PROXY: 'true' };
const SERVICE_PRESENT = ['TRUST_PROXY_CIDRS'];
const LEGACY = 'SLICE_SERVICE_API_KEY';
const LEGACY_PREVIOUS = 'SLICE_SERVICE_API_KEY_PREVIOUS';
const LEGACY_UNTIL = 'SLICE_SERVICE_LEGACY_MIGRATION_UNTIL';
const WOO_PREVIOUS = 'SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS';
const RELEASE_VALUES = { ARTIFACT_TTL_MS: '3600000', MAX_UPLOAD_BYTES: '125829120' };
const IMAGE_REF = /^ghcr\.io\/botond1\/3d-printer-slicer-api@sha256:[0-9a-f]{64}$/;

const sha = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const fail = (message) => { console.error(`STOP ${message}`); process.exit(1); };

function parseEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { fail(`${path.basename(file)} unreadable`); }
  if (text.includes('\r') || text.includes('\0')) fail(`${path.basename(file)} has CR or NUL bytes`);
  const lines = text.split('\n');
  const trailing = lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  const entries = new Map();
  lines.forEach((line, index) => {
    if (/^\s*(#|$)/.test(line)) return;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) fail(`${path.basename(file)} line ${index + 1} is not NAME=value`);
    if (entries.has(match[1])) fail(`${path.basename(file)} names ${match[1]} twice`);
    entries.set(match[1], { index, value: match[2] });
  });
  return { lines, trailing, entries };
}
function serialize(env) { return env.lines.join('\n') + (env.trailing ? '\n' : ''); }
function setValue(env, name, value) {
  const line = `${name}=${value}`;
  if (env.entries.has(name)) { env.lines[env.entries.get(name).index] = line; }
  else { env.lines.push(line); env.entries.set(name, { index: env.lines.length - 1 }); }
  env.entries.get(name).value = value;
}
function removeName(env, name) {
  if (!env.entries.has(name)) return;
  env.lines[env.entries.get(name).index] = null;
  env.entries.delete(name);
}
function compact(env) {
  const lines = []; const entries = new Map();
  for (const line of env.lines) {
    if (line === null) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !/^\s*#/.test(line)) entries.set(match[1], { index: lines.length, value: match[2] });
    lines.push(line);
  }
  return { lines, trailing: env.trailing, entries };
}
function writePrivate(file, text) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function checkCompose(file) {
  const env = parseEnv(file);
  const missing = COMPOSE_NAMES.filter((name) => !env.entries.has(name) || env.entries.get(name).value === '');
  if (missing.length) fail(`compose env lacks ${missing.join(', ')}`);
  const drift = Object.keys(COMPOSE_PINS).filter((name) => sha(env.entries.get(name).value) !== sha(COMPOSE_PINS[name]));
  if (drift.length) fail(`compose env limit differs from the live value: ${drift.join(', ')}`);
  if (!IMAGE_REF.test(env.entries.get('SLICER_API_IMAGE').value)) fail('SLICER_API_IMAGE is not a digest-pinned slicer ref');
  return env;
}
function checkService(file, mode) {
  const env = parseEnv(file);
  const missing = [...Object.keys(SERVICE_PINS), ...SERVICE_PRESENT].filter((name) => !env.entries.has(name));
  if (missing.length) fail(`service env lacks ${missing.join(', ')}`);
  const drift = Object.keys(SERVICE_PINS).filter((name) => sha(env.entries.get(name).value) !== sha(SERVICE_PINS[name]));
  if (drift.length) fail(`service env tuning value differs from the live value: ${drift.join(', ')}`);
  if (env.entries.get('TRUST_PROXY_CIDRS').value === '') fail('TRUST_PROXY_CIDRS is empty');
  if (mode !== 'none') {
    if (env.entries.has(WOO_PREVIOUS) && env.entries.get(WOO_PREVIOUS).value !== '') {
      fail(`${WOO_PREVIOUS} is already non-empty (the key-ring move ran before; refusing a second move)`);
    }
    if (!env.entries.has(LEGACY) || env.entries.get(LEGACY).value === '') fail(`${LEGACY} is absent or empty`);
    if (!env.entries.has('SLICE_SERVICE_WOOCOMMERCE_API_KEY') || env.entries.get('SLICE_SERVICE_WOOCOMMERCE_API_KEY').value === '') {
      fail('SLICE_SERVICE_WOOCOMMERCE_API_KEY is absent or empty');
    }
  }
  return env;
}

// rewrite <mode> <composeIn> <serviceIn> <outDir> [image] [exportRoute]
// mode: deploy | keyring-only | rollback-keyring
function rewrite(mode, composeIn, serviceIn, outDir, image, exportRoute) {
  const compose = checkCompose(composeIn);
  const service = checkService(serviceIn, 'keyring');
  const composeBefore = parseEnv(composeIn);
  const serviceBefore = parseEnv(serviceIn);
  if (mode === 'deploy') {
    if (!IMAGE_REF.test(image || '')) fail('the new image ref is not a digest-pinned slicer ref');
    if (!['true', 'false'].includes(exportRoute)) fail('--export-route must be true or false');
    if (sha(compose.entries.get('SLICER_API_IMAGE').value) === sha(image)) fail('the compose env already names the new image');
    setValue(compose, 'SLICER_API_IMAGE', image);
  } else if (!['keyring-only', 'rollback-keyring'].includes(mode)) {
    fail('unknown rewrite mode');
  }
  // §6 key-ring move, by NAME: WOOCOMMERCE_PREVIOUS := legacy value; three names removed; principals.
  setValue(service, WOO_PREVIOUS, service.entries.get(LEGACY).value);
  removeName(service, LEGACY); removeName(service, LEGACY_PREVIOUS); removeName(service, LEGACY_UNTIL);
  setValue(service, 'SLICE_SERVICE_AUTH_MODE', 'principals');
  if (mode === 'deploy') {
    for (const [name, value] of Object.entries(RELEASE_VALUES)) setValue(service, name, value);
    setValue(service, 'EXPORT_ROUTE_ENABLED', exportRoute);
  }
  const composeAfter = compact(compose);
  const serviceAfter = compact(service);
  // Must-survive: compose lines other than SLICER_API_IMAGE byte-identical.
  const imageIndex = composeBefore.entries.get('SLICER_API_IMAGE').index;
  if (composeAfter.lines.length !== composeBefore.lines.length
      || composeAfter.lines.some((line, i) => i !== imageIndex && sha(line) !== sha(composeBefore.lines[i]))) {
    fail('compose rewrite touched a line other than SLICER_API_IMAGE');
  }
  if (mode !== 'deploy' && sha(composeAfter.lines[imageIndex]) !== sha(composeBefore.lines[imageIndex])) {
    fail('compose image changed outside deploy');
  }
  // Must-survive: every service name survives with its value, except the moved and the changed ones.
  const removed = [LEGACY, LEGACY_PREVIOUS, LEGACY_UNTIL];
  const changedAllowed = new Set([WOO_PREVIOUS, 'SLICE_SERVICE_AUTH_MODE',
    ...(mode === 'deploy' ? [...Object.keys(RELEASE_VALUES), 'EXPORT_ROUTE_ENABLED'] : [])]);
  const changed = []; const added = []; const gone = [];
  for (const [name, entry] of serviceBefore.entries) {
    if (!serviceAfter.entries.has(name)) { gone.push(name); continue; }
    if (sha(serviceAfter.entries.get(name).value) !== sha(entry.value)) changed.push(name);
  }
  for (const name of serviceAfter.entries.keys()) if (!serviceBefore.entries.has(name)) added.push(name);
  if (gone.some((name) => !removed.includes(name))) fail(`service rewrite removed ${gone.filter((n) => !removed.includes(n)).join(', ')}`);
  if ([...changed, ...added].some((name) => !changedAllowed.has(name))) fail('service rewrite changed a name outside the 3.9.0 list');
  if (sha(serviceAfter.entries.get(WOO_PREVIOUS).value) !== sha(serviceBefore.entries.get(LEGACY).value)) fail('moved key bytes differ');
  // A second check of the pins on the result.
  for (const [name, value] of Object.entries(SERVICE_PINS)) if (sha(serviceAfter.entries.get(name).value) !== sha(value)) fail(`${name} drifted`);
  for (const [name, value] of Object.entries(COMPOSE_PINS)) if (sha(composeAfter.entries.get(name).value) !== sha(value)) fail(`${name} drifted`);
  writePrivate(path.join(outDir, 'compose.env'), serialize(composeAfter));
  writePrivate(path.join(outDir, 'service.env'), serialize(serviceAfter));
  console.log(`compose env: changed ${mode === 'deploy' ? 'SLICER_API_IMAGE' : '(none)'}; ${composeAfter.lines.length} lines, all others byte-identical`);
  console.log(`service env: changed ${changed.sort().join(', ') || '(none)'}; added ${added.sort().join(', ') || '(none)'}; removed ${gone.sort().join(', ') || '(none)'}`);
  console.log(`service env: ${Object.keys(SERVICE_PINS).length} tuning values and ${serviceAfter.entries.size} names checked (values compared by sha256, never printed)`);
}

function install(src, dst) {
  const dir = path.dirname(dst);
  const tmp = path.join(dir, `.r3d-390.${process.pid}.${Date.now()}`);
  const data = fs.readFileSync(src);
  writePrivate(tmp, data);
  fs.renameSync(tmp, dst);
  try { const fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); } catch { /* directory fsync is best effort on some filesystems */ }
  if (!fs.readFileSync(dst).equals(data)) fail(`install of ${path.basename(dst)} did not read back`);
  console.log(`installed ${path.basename(dst)} (atomic rename, 0600)`);
}

function isInside(child, parent) {
  const c = path.resolve(child); const p = path.resolve(parent);
  const real = (target) => { let cur = target; const rest = []; for (;;) { try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { rest.push(path.basename(cur)); const up = path.dirname(cur); if (up === cur) return target; cur = up; } } };
  const rc = real(c); const rp = real(p);
  return rc === rp || rc.startsWith(rp + path.sep) || c === p || c.startsWith(p + path.sep);
}

function composeLimits(capture) {
  const doc = JSON.parse(fs.readFileSync(0, 'utf8'));
  const svc = (doc.services || {})['slicer-api'] || Object.values(doc.services || {})[0] || {};
  const env = svc.environment || {};
  const expected = Object.fromEntries(Object.keys(env).filter((k) => k.startsWith('EXPECTED_')).sort().map((k) => [k, String(env[k])]));
  const limits = { mem_limit: String(svc.mem_limit ?? ''), memswap_limit: String(svc.memswap_limit ?? ''),
    cpus: String(svc.cpus ?? ''), pids_limit: String(svc.pids_limit ?? ''), expected };
  if (capture === '-') { process.stdout.write(JSON.stringify(limits, null, 2) + '\n'); return; }
  const before = JSON.parse(fs.readFileSync(capture, 'utf8'));
  const differ = ['mem_limit', 'memswap_limit', 'cpus', 'pids_limit'].filter((k) => before[k] !== limits[k]);
  if (JSON.stringify(before.expected) !== JSON.stringify(limits.expected)) differ.push('EXPECTED_*');
  if (differ.length) fail(`docker compose config differs from the capture: ${differ.join(', ')}`);
  console.log('docker compose config: limits and EXPECTED_* identical to the capture');
}

function routerRanges(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.indexOf('        sourceRange:');
  const out = [];
  for (let i = start + 1; start >= 0 && i < lines.length; i += 1) {
    const m = lines[i].match(/^ {10}- "([0-9.]+)\/32"$/); if (!m) break; out.push(m[1]);
  }
  return out;
}

// access-log-scan <orig-router-file>: stdin = Traefik JSON access log lines.
function accessLogScan(orig) {
  const ranges = routerRanges(orig);
  if (ranges.length !== 2) fail('the original router does not carry two ranges');
  const shop = ranges[1]; // shop-position address (2nd)
  let shopRequests = 0; let bad = 0; let other403 = 0;
  for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
    const start = line.indexOf('{'); if (start < 0) continue;
    let entry; try { entry = JSON.parse(line.slice(start)); } catch { continue; }
    if (!entry || typeof entry.ClientHost !== 'string') continue;
    const status = Number(entry.DownstreamStatus);
    if (entry.ClientHost === shop) {
      shopRequests += 1;
      if (status === 403 || status === 404 || !entry.RouterName) bad += 1;
    } else if (status === 403) { other403 += 1; }
  }
  console.log(`${bad > 0 ? 'restore' : 'clean'} shop_requests=${shopRequests} shop_403_404_or_unrouted=${bad} other_403=${other403}`);
}

function queueIdle() {
  const text = fs.readFileSync(0, 'utf8');
  const read = (name) => { const m = text.match(new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.]+)$`, 'm')); return m ? Number(m[1]) : NaN; };
  const active = read('slicer_queue_active_jobs'); const queued = read('slicer_queue_queued_jobs');
  if (!Number.isFinite(active) || !Number.isFinite(queued)) { console.log('unknown'); return; }
  console.log(active === 0 && queued === 0 ? 'idle' : `busy active=${active} queued=${queued}`);
}

// slice-compare <before-run1> <before-run2> <after> <aa-spread>
const IDENTITY_PATHS = ['technical_receipt.measurement_generation', 'technical_receipt.effective_profile_sha256',
  'technical_receipt.engine.build_sha256', 'technical_receipt.profiles.bundle_sha256', 'technical_receipt.source',
  'technical_receipt.configuration_sha256', 'technical_receipt.model_transform'];
function dig(object, dotted) { return dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object); }
function sliceCompare(a, b, after, spreadArg) {
  const runs = [a, b, after].map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  runs.forEach((run, i) => { if (run.success !== true) fail(`control run ${i + 1} did not succeed`); });
  for (const p of IDENTITY_PATHS) {
    const values = runs.map((run) => JSON.stringify(dig(run, p)));
    if (values[0] === undefined) fail(`identity field ${p} missing`);
    if (values[0] !== values[1] || values[0] !== values[2]) fail(`identity field ${p} differs`);
  }
  const spread = Math.max(Number(spreadArg) || 0, 0.01);
  for (const field of ['print_time_seconds', 'material_used_g']) {
    const v = runs.map((run) => Number(dig(run, `stats.${field}`)));
    if (!v.every(Number.isFinite)) fail(`${field} missing`);
    const lo = Math.min(v[0], v[1]) * (1 - spread); const hi = Math.max(v[0], v[1]) * (1 + spread);
    if (v[2] < lo || v[2] > hi) fail(`${field} outside the old container's range widened by ${spread}`);
  }
  console.log(`control slice: ${IDENTITY_PATHS.length} identity fields byte-equal; time and grams inside the widened range (${spread})`);
}

function slotPrefixes(file) {
  const env = parseEnv(file);
  for (const [name, entry] of env.entries) {
    if (/^SLICE_SERVICE_[A-Z_]*API_KEY(?:_PREVIOUS)?$/.test(name) && entry.value !== '') {
      console.log(`${name} ${sha(entry.value).slice(0, 12)}`);
    }
  }
}

const [op, ...args] = process.argv.slice(2);
switch (op) {
  case 'compose-check': checkCompose(args[0]); console.log('compose env: 14 SLICER_* names present; limits equal the live values'); break;
  case 'compose-get': { const env = checkCompose(args[0]); const name = args[1];
    if (!['SLICER_ENV_FILE', 'SLICER_API_IMAGE'].includes(name)) fail('compose-get reads only SLICER_ENV_FILE or SLICER_API_IMAGE');
    console.log(env.entries.get(name).value); break; }
  case 'service-check': checkService(args[0], args[1] || 'keyring'); console.log('service env: tuning values equal the live values; key-ring preconditions hold'); break;
  case 'rewrite': rewrite(...args); break;
  case 'install': install(args[0], args[1]); break;
  case 'outside': if (isInside(args[0], args[1])) fail(`${args[2] || 'path'} lies inside the watched dynamic dir`); break;
  case 'compose-limits': composeLimits(args[0]); break;
  case 'access-log-scan': accessLogScan(args[0]); break;
  case 'queue-idle': queueIdle(); break;
  case 'slice-compare': sliceCompare(...args); break;
  case 'slot-prefixes': slotPrefixes(args[0]); break;
  default: fail('unknown envtool operation');
}
NODE

envtool() { node "$TOOL" "$@"; }

# ---------------------------------------------------------------------------
# In-container helpers (run inside the backend with `docker exec -i`): the keys
# come from the container's own environment and never cross a process boundary.
# ---------------------------------------------------------------------------
IN_GET='const http=require("http");const [p,keyName,header]=process.argv.slice(1);const headers={};if(keyName){headers[header||"x-api-key"]=process.env[keyName]||"";}
http.get({host:"127.0.0.1",port:3000,path:p,headers},(r)=>{const c=[];r.on("data",(d)=>c.push(d));r.on("end",()=>{process.stdout.write(Buffer.concat(c));process.exitCode=r.statusCode===200?0:3;});}).on("error",()=>{process.exitCode=4;});'
IN_SLICE='const chunks=[];process.stdin.on("data",(d)=>chunks.push(d));process.stdin.on("end",async()=>{const f=new FormData();f.append("choosenFile",new Blob([Buffer.concat(chunks)]),"control.stl");
for(const pair of process.argv.slice(1)){const i=pair.indexOf("=");f.append(pair.slice(0,i),pair.slice(i+1));}
const r=await fetch("http://127.0.0.1:3000/bambu/slice",{method:"POST",headers:{"x-slicer-api-key":process.env.SLICE_SERVICE_WOOCOMMERCE_API_KEY||""},body:f});process.stdout.write(Buffer.from(await r.arrayBuffer()));process.exitCode=r.status===200?0:3;});'
IN_READY_POLL='const http=require("http");const n=Number(process.argv[1]||60);const t=[];let i=0;
function one(){const s=process.hrtime.bigint();http.get({host:"127.0.0.1",port:3000,path:"/ready"},(r)=>{r.resume();r.on("end",()=>{t.push(Number(process.hrtime.bigint()-s)/1e6);next(r.statusCode);});}).on("error",()=>next(0));}
function next(code){if(code!==200){console.log("ready_non_200 "+code);process.exitCode=3;}if(++i<n){setTimeout(one,1000);}else{t.sort((a,b)=>a-b);console.log("ready_polls="+t.length+" p99_ms="+t[Math.min(t.length-1,Math.ceil(t.length*0.99)-1)].toFixed(1)+" max_ms="+t[t.length-1].toFixed(1));}}one();'

CONTROL_SLICES="cube:orientationMode=auto block:orientationMode=preserve,rotationX=90,rotationY=0,rotationZ=0"
in_get() { docker exec -i "$NAME" node -e "$IN_GET" "$@"; }
control_slice() { # control_slice <model-file> <comma-separated fields> <out>
  local fields; fields="$(echo "$2" | tr ',' ' ')"
  # shellcheck disable=SC2086
  docker exec -i "$NAME" node -e "$IN_SLICE" material=PLA layerHeight=0.2 infill=20 printerProfile=P1S $fields < "$1" > "$3"
}
queue_state() { in_get /operations/metrics OPERATIONS_API_KEY x-api-key | envtool queue-idle; }

compose() { # compose <args...> against the live pack with the compose env
  (cd "$PACK" && docker compose -p slicer-api --env-file "$COMPOSE_ENV" -f docker-compose.production.yml "$@")
}

resolve_service_env() {
  [ -f "$COMPOSE_ENV" ] || die "compose env file missing"
  SERVICE_ENV="$(envtool compose-get "$COMPOSE_ENV" SLICER_ENV_FILE)"
  case "$SERVICE_ENV" in /*) ;; *) die "SLICER_ENV_FILE is not an absolute path" ;; esac
  [ -f "$SERVICE_ENV" ] && [ ! -L "$SERVICE_ENV" ] || die "service env file missing or a link"
}

prove_rewrite() { # prove_rewrite <mode> [image] [export] -> $TOOLDIR/rewrite/{compose,service}.env
  rm -rf -- "$TOOLDIR/rewrite"; mkdir "$TOOLDIR/rewrite" # inside the 0700 tool dir
  envtool rewrite "$1" "$COMPOSE_ENV" "$SERVICE_ENV" "$TOOLDIR/rewrite" "${2:-}" "${3:-}"
}

backup_env() { # backup_env -> BACKUP_DIR (both files together, before either is written)
  BACKUP_DIR="$CONTROL_DIR/env-backup-$TS"
  if [ "$EXECUTE" -eq 1 ]; then
    mkdir -p -m 700 "$CONTROL_DIR"; mkdir -m 700 "$BACKUP_DIR"
    install -m 600 "$COMPOSE_ENV" "$BACKUP_DIR/compose-n1-exact-configs.env"
    install -m 600 "$SERVICE_ENV" "$BACKUP_DIR/service-n1.env"
    cmp -s "$COMPOSE_ENV" "$BACKUP_DIR/compose-n1-exact-configs.env" && cmp -s "$SERVICE_ENV" "$BACKUP_DIR/service-n1.env" \
      || die "backup did not read back"
    echo "both env files backed up to $BACKUP_DIR (0600)"
  else
    echo "DRY-RUN would back up both env files together to $BACKUP_DIR (0600) before writing either"
  fi
}

install_rewrite() { # atomic: compose first, then service; a failed second write restores the first
  if [ "$EXECUTE" -eq 1 ]; then
    envtool install "$TOOLDIR/rewrite/compose.env" "$COMPOSE_ENV"
    if ! envtool install "$TOOLDIR/rewrite/service.env" "$SERVICE_ENV"; then
      envtool install "$BACKUP_DIR/compose-n1-exact-configs.env" "$COMPOSE_ENV"
      die "service env write failed; compose env restored"
    fi
  else
    echo "DRY-RUN would install both rewritten files (temp + fsync + rename, 0600); the real files are unchanged"
  fi
}

assert_compose_config() {
  [ -f "$CONTROL_DIR/compose-limits.json" ] || die "no step-2 capture of compose limits ($CONTROL_DIR/compose-limits.json)"
  if [ "$EXECUTE" -eq 1 ]; then
    compose config --format json | envtool compose-limits "$CONTROL_DIR/compose-limits.json"
  else
    echo "DRY-RUN would compare docker compose config (limits, EXPECTED_*) with $CONTROL_DIR/compose-limits.json"
  fi
}

wait_healthy() {
  local i=0
  until [ "$(docker inspect --format '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = "healthy" ]; do
    i=$((i + 1)); [ "$i" -le 90 ] || { echo "not healthy after 180 s" >&2; return 1; }
    sleep 2
  done
  echo "healthy after $((i * 2)) s"
}

verify_runtime() { # verify_runtime <ref> <sha>
  local want_id got
  want_id="$(docker image inspect --format '{{.Id}}' "$1")"
  got="$(docker inspect --format '{{.Config.Image}} {{.Image}} {{.State.Status}} {{.State.Running}} {{.RestartCount}} {{.State.OOMKilled}}' "$NAME")"
  [ "$got" = "$1 $want_id running true 0 false" ] || { echo "runtime identity mismatch" >&2; return 1; }
  [ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1")" = "$2" ] || { echo "revision label mismatch" >&2; return 1; }
  [ "$(docker exec "$NAME" cat /sys/fs/cgroup/memory.max)" = "12884901888" ] || { echo "memory.max mismatch" >&2; return 1; }
  [ "$(docker exec "$NAME" cat /sys/fs/cgroup/cpu.max)" = "400000 100000" ] || { echo "cpu.max mismatch" >&2; return 1; }
  [ "$(docker exec "$NAME" cat /sys/fs/cgroup/pids.max)" = "512" ] || { echo "pids.max mismatch" >&2; return 1; }
  echo "runtime identity, revision label and cgroup limits (12 GiB / 4 CPU / pids 512) ok"
}

verify_tuning_runtime() { # the container's tuning values equal the service env file (hash compare)
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME" \
    | grep -E '^(MAX_CONCURRENT_SLICES|MAX_SLICE_QUEUE_LENGTH|MAX_SLICE_QUEUE_PER_IP|MAX_SLICE_QUEUE_WAIT_MS|ASYNC_SLICE_DEADLINE_MS|PYTHON_HELPER_TIMEOUT_MS|ORIENTATION_HELPER_TIMEOUT_MS|SLICE_RATE_LIMIT_MAX_REQUESTS|SLICE_RATE_LIMIT_BURST_CAPACITY|NODE_ENV|PORT|TRUST_PROXY)=' \
    | sort | sha256sum | cut -c1-64 > "$TOOLDIR/tuning-runtime"
  grep -E '^(MAX_CONCURRENT_SLICES|MAX_SLICE_QUEUE_LENGTH|MAX_SLICE_QUEUE_PER_IP|MAX_SLICE_QUEUE_WAIT_MS|ASYNC_SLICE_DEADLINE_MS|PYTHON_HELPER_TIMEOUT_MS|ORIENTATION_HELPER_TIMEOUT_MS|SLICE_RATE_LIMIT_MAX_REQUESTS|SLICE_RATE_LIMIT_BURST_CAPACITY|NODE_ENV|PORT|TRUST_PROXY)=' "$SERVICE_ENV" \
    | sort | sha256sum | cut -c1-64 > "$TOOLDIR/tuning-file"
  cmp -s "$TOOLDIR/tuning-runtime" "$TOOLDIR/tuning-file" || { echo "tuning allowlist differs in the container" >&2; return 1; }
  echo "tuning allowlist identical in the container"
}

post_checks() { # post_checks <ref> <sha> <aa-spread>
  verify_runtime "$1" "$2" || return 1
  verify_tuning_runtime || return 1
  in_get /health > /dev/null || { echo "/health not 200" >&2; return 1; }
  in_get /ready > /dev/null || { echo "/ready not 200" >&2; return 1; }
  in_get /profiles > "$CONTROL_DIR/profiles-v2-after.json" || return 1
  in_get '/profiles?contract=material-v1' > "$CONTROL_DIR/profiles-v3-after.json" || return 1
  cmp -s "$CONTROL_DIR/profiles-v2-after.json" "$CONTROL_DIR/profiles-v2-before.json" || { echo "catalogue v2 body differs" >&2; return 1; }
  cmp -s "$CONTROL_DIR/profiles-v3-after.json" "$CONTROL_DIR/profiles-v3-before.json" || { echo "catalogue v3 body differs" >&2; return 1; }
  echo "catalogue v2 and v3 bodies byte-equal to the capture"
  local spec model fields
  for spec in $CONTROL_SLICES; do
    model="${spec%%:*}"; fields="${spec#*:}"
    control_slice "$CONTROL_DIR/models/$model.stl" "$fields" "$CONTROL_DIR/control-$model-after.json" || { echo "control slice $model failed" >&2; return 1; }
    envtool slice-compare "$CONTROL_DIR/control-$model-before-1.json" "$CONTROL_DIR/control-$model-before-2.json" \
      "$CONTROL_DIR/control-$model-after.json" "$3" || return 1
    sleep 21
  done
  local ready
  ready="$(docker exec -i "$NAME" node -e "$IN_READY_POLL" 60)" || { echo "/ready not 200 during the poll" >&2; return 1; }
  echo "$ready"
  node -e 'const m=process.argv[1].match(/p99_ms=([0-9.]+)/);process.exit(m&&Number(m[1])<100?0:1)' "$ready" || { echo "/ready p99 >= 100 ms" >&2; return 1; }
  docker logs --since 10m "$NAME" 2>&1 | grep -q '"event":"auth.slot_summary"' || { echo "no auth.slot_summary line" >&2; return 1; }
  echo "auth.slot_summary present"
}

automatic_rollback() { # only on an idle queue; jobs in flight -> hold and page
  local state
  state="$(queue_state || echo unknown)"
  if [ "$state" != "idle" ]; then
    echo "HOLD: a check failed but the queue is not idle ($state). The new container stays; page the operator." >&2
    echo "Decide, then run: $0 --execute rollback $NEW_REF $NEW_SHA --backup $BACKUP_DIR" >&2
    exit 3
  fi
  echo "a check failed and the queue is idle: automatic rollback" >&2
  "$0" --execute rollback "$NEW_REF" "$NEW_SHA" --backup "$BACKUP_DIR"
  exit 2
}

retain() { # retain <sha> <ref>
  local tag="local/rocket3d-slicer-api:retained-$1" want got
  want="$(docker image inspect --format '{{.Id}}' "$2")"
  if got="$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null)"; then
    [ "$got" = "$want" ] || die "retention tag $tag points elsewhere"
  else
    docker image tag "$2" "$tag"
  fi
  echo "retained $tag"
}

# ---------------------------------------------------------------------------
cmd_check_env() {
  say "check-env (read-only; the rewrite is proved in a private temp dir)"
  envtool compose-check "$COMPOSE_ENV"
  resolve_service_env
  envtool service-check "$SERVICE_ENV" keyring
  prove_rewrite deploy "$REPO@sha256:$(printf '0%.0s' $(seq 1 64))" false
  echo "check-env PASS (no file written)"
}

cmd_slot_prefixes() {
  resolve_service_env
  say "first 12 hex of sha256 per non-empty key slot (compare with the shop's own prefix; values never printed)"
  envtool slot-prefixes "$SERVICE_ENV"
}

cmd_capture() {
  say "§8 step 2 capture into $CONTROL_DIR"
  envtool compose-check "$COMPOSE_ENV"
  resolve_service_env
  envtool service-check "$SERVICE_ENV" keyring
  envtool outside "$CONTROL_DIR" "$DYNAMIC_DIR" "control dir"
  [ -f "$CONTROL_DIR/models/cube.stl" ] && [ -f "$CONTROL_DIR/models/block.stl" ] \
    || die "control models missing: $CONTROL_DIR/models/cube.stl (40 mm cube) and block.stl (9,5 x 9,5 x 14,3 mm)"
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would: docker logs + inspect (mounts, labels, env NAMES), tuning values, catalogue v2/v3 bodies,"
    echo "  cgroup memory.peak/memory.events, docker compose config limits, byte copies of both env files (0600),"
    echo "  the live slicer-api.yml copied OUT of the dynamic dir, cube auto + block preserve 90/0/0 twice each,"
    echo "  and docker image tag <3.8.3 ref> local/slicer-api:retained-dbc539e9"
    return 0
  fi
  mkdir -p -m 700 "$CONTROL_DIR" "$CONTROL_DIR/traefik"
  local cur_ref; cur_ref="$(envtool compose-get "$COMPOSE_ENV" SLICER_API_IMAGE)"
  [ "$(docker inspect --format '{{.Config.Image}}' "$NAME")" = "$cur_ref" ] || die "running image differs from the compose env"
  [ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$cur_ref")" = "$OLD_SHA" ] || die "running image is not 3.8.3"
  echo "$cur_ref" > "$CONTROL_DIR/rollback-image-ref"
  docker logs "$NAME" > "$CONTROL_DIR/backend-$TS.log" 2>&1 || true
  docker inspect --format '{{json .Mounts}}' "$NAME" > "$CONTROL_DIR/mounts.json"
  docker inspect --format '{{json .Config.Labels}}' "$NAME" > "$CONTROL_DIR/labels.json"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$NAME" | cut -d= -f1 | sort > "$CONTROL_DIR/env-names.txt"
  docker exec "$NAME" sh -c 'cat /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events' > "$CONTROL_DIR/cgroup-memory.txt" 2>&1 || true
  compose config --format json | envtool compose-limits - > "$CONTROL_DIR/compose-limits.json"
  install -m 600 "$COMPOSE_ENV" "$CONTROL_DIR/compose-n1-exact-configs.env.capture"
  install -m 600 "$SERVICE_ENV" "$CONTROL_DIR/service-n1.env.capture"
  install -m 600 "$DYNAMIC_DIR/slicer-api.yml" "$CONTROL_DIR/traefik/slicer-api.yml.capture-$TS.orig"
  in_get /profiles > "$CONTROL_DIR/profiles-v2-before.json"
  in_get '/profiles?contract=material-v1' > "$CONTROL_DIR/profiles-v3-before.json"
  local spec model fields run
  for spec in $CONTROL_SLICES; do
    model="${spec%%:*}"; fields="${spec#*:}"
    for run in 1 2; do
      control_slice "$CONTROL_DIR/models/$model.stl" "$fields" "$CONTROL_DIR/control-$model-before-$run.json" || die "control slice $model run $run failed"
      sleep 21
    done
  done
  docker image tag "$cur_ref" "local/slicer-api:retained-dbc539e9"
  chmod -R go-rwx "$CONTROL_DIR"
  echo "capture complete"
}

cmd_deploy() {
  NEW_REF="${1:-}"; NEW_SHA="${2:-}"; shift 2 || die "usage: deploy <ref> <sha> --export-route true|false"
  local export_route="" aa_spread="0.01"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --export-route) export_route="${2:-}"; shift 2 ;;
      --aa-spread) aa_spread="${2:-}"; shift 2 ;;
      *) die "unknown deploy argument" ;;
    esac
  done
  case "$NEW_REF" in "$REPO"@sha256:*) ;; *) die "the new ref must be $REPO@sha256:<digest>" ;; esac
  case "$NEW_SHA" in *[!0-9a-f]*|'') die "bad source sha" ;; esac
  [ "${#NEW_SHA}" -eq 40 ] || die "source sha must have 40 hex digits"
  case "$export_route" in true|false) ;; *) die "--export-route true|false is required (T-EXP decides it)" ;; esac
  say "§8 step 4 deploy (execute=$EXECUTE)"
  envtool compose-check "$COMPOSE_ENV"
  resolve_service_env
  envtool service-check "$SERVICE_ENV" keyring
  envtool outside "$CONTROL_DIR" "$DYNAMIC_DIR" "control dir"
  prove_rewrite deploy "$NEW_REF" "$export_route"
  if [ "$EXECUTE" -eq 1 ]; then
    [ "$(queue_state)" = "idle" ] || die "the live queue is not idle"
    docker pull "$NEW_REF" | tail -2
    [ "$(docker inspect "$NEW_REF" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$NEW_SHA" ] || die "revision label mismatch"
    echo "signature and attestations: verify with gh attestation verify (SLSA + SPDX) before this step; see RUNBOOK §8"
    retain "$OLD_SHA" "$(envtool compose-get "$COMPOSE_ENV" SLICER_API_IMAGE)"
    retain "$NEW_SHA" "$NEW_REF"
  else
    echo "DRY-RUN would: require an idle queue, docker pull $NEW_REF, check its revision label, retain both images"
  fi
  backup_env
  install_rewrite
  if [ "$EXECUTE" -eq 1 ]; then
    envtool compose-check "$COMPOSE_ENV"
    envtool service-check "$SERVICE_ENV" none
  fi
  assert_compose_config
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would: compose up -d; check digest, label, cgroup limits, tuning, /health, /ready, catalogue bodies,"
    echo "  two control slices (identity byte-equal, time and grams inside the widened range), 60 /ready polls p99 < 100 ms,"
    echo "  auth.slot_summary; any failure -> rollback only on an idle queue, else HOLD and page"
    echo "deploy dry-run PASS"
    return 0
  fi
  compose up --detach --no-deps --pull never slicer-api
  wait_healthy || automatic_rollback
  post_checks "$NEW_REF" "$NEW_SHA" "$aa_spread" || automatic_rollback
  echo "deploy PASS. Rollback: $0 --execute rollback $NEW_REF $NEW_SHA --backup $BACKUP_DIR"
}

cmd_rollback() {
  NEW_REF="${1:-}"; NEW_SHA="${2:-}"; shift 2 || die "usage: rollback <ref> <sha> [--backup <dir>]"
  local backup=""
  while [ "$#" -gt 0 ]; do
    case "$1" in --backup) backup="${2:-}"; shift 2 ;; *) die "unknown rollback argument" ;; esac
  done
  if [ -z "$backup" ]; then
    backup="$(ls -1d "$CONTROL_DIR"/env-backup-* 2>/dev/null | sort | tail -1 || true)"
  fi
  [ -n "$backup" ] && [ -f "$backup/compose-n1-exact-configs.env" ] && [ -f "$backup/service-n1.env" ] || die "no env backup with both files"
  say "§8 step 6 rollback from $backup (execute=$EXECUTE)"
  # The restored service file gets only the key-ring move (3.8.3 accepts principals mode).
  local saved_compose="$COMPOSE_ENV" saved_service
  resolve_service_env; saved_service="$SERVICE_ENV"
  COMPOSE_ENV="$backup/compose-n1-exact-configs.env"; SERVICE_ENV="$backup/service-n1.env"
  envtool compose-check "$COMPOSE_ENV"
  local old_ref; old_ref="$(envtool compose-get "$COMPOSE_ENV" SLICER_API_IMAGE)"
  [ "$old_ref" != "$NEW_REF" ] || die "the backup already names the new image"
  prove_rewrite rollback-keyring
  COMPOSE_ENV="$saved_compose"; SERVICE_ENV="$saved_service"
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would restore both env files (compose image back to the backup's ref), re-apply the key-ring move,"
    echo "  assert the must-survive lists and docker compose config, compose up -d, verify runtime identity"
    echo "rollback dry-run PASS"
    return 0
  fi
  local before="$CONTROL_DIR/env-before-rollback-$TS"
  mkdir -p -m 700 "$CONTROL_DIR"; mkdir -m 700 "$before"
  install -m 600 "$COMPOSE_ENV" "$before/compose-n1-exact-configs.env"
  install -m 600 "$SERVICE_ENV" "$before/service-n1.env"
  envtool install "$TOOLDIR/rewrite/compose.env" "$COMPOSE_ENV"
  envtool install "$TOOLDIR/rewrite/service.env" "$SERVICE_ENV"
  envtool compose-check "$COMPOSE_ENV"; envtool service-check "$SERVICE_ENV" none
  assert_compose_config
  compose up --detach --no-deps --pull never slicer-api
  wait_healthy
  verify_runtime "$old_ref" "$OLD_SHA"
  echo "rollback PASS"
}

cmd_keyring_only() {
  say "key-ring move alone on the running image (execute=$EXECUTE)"
  envtool compose-check "$COMPOSE_ENV"
  resolve_service_env
  envtool service-check "$SERVICE_ENV" keyring
  envtool outside "$CONTROL_DIR" "$DYNAMIC_DIR" "control dir"
  prove_rewrite keyring-only
  if [ "$EXECUTE" -eq 1 ]; then [ "$(queue_state)" = "idle" ] || die "the live queue is not idle"; fi
  backup_env
  install_rewrite
  assert_compose_config
  if [ "$EXECUTE" -ne 1 ]; then echo "DRY-RUN would compose up -d (same digest) and verify runtime + /ready"; echo "keyring-only dry-run PASS"; return 0; fi
  local ref; ref="$(envtool compose-get "$COMPOSE_ENV" SLICER_API_IMAGE)"
  compose up --detach --no-deps --pull never slicer-api
  wait_healthy
  verify_runtime "$ref" "$OLD_SHA"
  in_get /ready > /dev/null || die "/ready not 200"
  echo "keyring-only PASS"
}

restore_router() { # restore_router <orig>
  local tmp="$DYNAMIC_DIR/.slicer-api.tmp-restore-$TS"
  if [ "$EXECUTE" -eq 1 ]; then
    install -m 600 "$1" "$tmp"
    mv -f "$tmp" "$DYNAMIC_DIR/slicer-api.yml"
    cmp -s "$1" "$DYNAMIC_DIR/slicer-api.yml" || die "restore did not read back"
    echo "RESTORED the original router (atomic rename)"
  else
    echo "DRY-RUN would restore the original router (atomic rename)"
  fi
}

watch_log() { # watch_log <orig> <seconds> <auto_restore 0|1> <since>
  local orig="$1" seconds="$2" auto="$3" since="$4" end verdict
  end=$(( $(date +%s) + seconds ))
  while :; do
    if [ -n "${R3D_ACCESS_LOG_FILE:-}" ]; then
      verdict="$(envtool access-log-scan "$orig" < "$R3D_ACCESS_LOG_FILE")"
    else
      verdict="$(docker logs --since "$since" "$TRAEFIK_NAME" 2>&1 | envtool access-log-scan "$orig")"
    fi
    case "$verdict" in
      restore*)
        echo "shop-position address got 403/404/unrouted: $verdict" >&2
        if [ "$auto" -eq 1 ]; then restore_router "$orig"; fi
        return 1 ;;
    esac
    [ "$(date +%s)" -lt "$end" ] || break
    sleep 1
  done
  echo "watch clean for ${seconds}s: $verdict"
}

cmd_traefik_watch() {
  local orig="" seconds="$WATCH_SECONDS" auto=1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --orig) orig="${2:-}"; shift 2 ;;
      --seconds) seconds="${2:-}"; shift 2 ;;
      --no-restore) auto=0; shift ;;
      *) die "unknown traefik-watch argument" ;;
    esac
  done
  [ -f "$orig" ] || die "--orig <file> is required"
  envtool outside "$orig" "$DYNAMIC_DIR" "original router copy"
  watch_log "$orig" "$seconds" "$auto" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" || exit 1
}

cmd_traefik() {
  local live="$DYNAMIC_DIR/slicer-api.yml" tdir="$CONTROL_DIR/traefik"
  say "§8 step 5 Traefik (execute=$EXECUTE)"
  [ -f "$live" ] && [ ! -L "$live" ] || die "live router file missing"
  envtool outside "$CONTROL_DIR" "$DYNAMIC_DIR" "control dir (backups)"
  envtool outside "$tdir" "$DYNAMIC_DIR" "traefik backup dir"
  local contract="$RELEASE_TREE/scripts/i12-hostinger-operator-contract.js"
  [ -f "$contract" ] || die "release tree lacks the operator contract"
  node "$contract" --reproduce-live "$live" --host "$HOST" --phase "$ALLOWLIST_PHASE"
  local work="$TOOLDIR/traefik"; mkdir "$work" # inside the 0700 tool dir
  local rendered="$work/slicer-api.rendered-$TS"
  node "$contract" --render-from-live "$live" --host "$HOST" --phase "$ALLOWLIST_PHASE" --output "$rendered"
  if [ "$EXECUTE" -eq 1 ]; then
    mkdir -p -m 700 "$tdir"
    bash "$RELEASE_TREE/ops/hostinger/traefik-matrix/run-matrix.sh" run --rendered "$rendered" --evidence "$tdir/t-trf-$TS"
    install -m 600 "$rendered" "$tdir/slicer-api.yml.$TS.new"
  else
    bash "$RELEASE_TREE/ops/hostinger/traefik-matrix/run-matrix.sh" plan --rendered "$rendered"
  fi
  local orig="$tdir/slicer-api.yml.$TS.orig"
  if [ "$EXECUTE" -ne 1 ]; then
    echo "DRY-RUN would copy the live file to $orig (outside the dynamic dir), write $DYNAMIC_DIR/.slicer-api.tmp-$TS,"
    echo "  rename it over slicer-api.yml, then watch the access log ${WATCH_SECONDS}s and restore on a shop 403/404/unrouted;"
    echo "  then the 30-minute watch (no automatic restore; restore = $0 --execute traefik-watch --orig $orig --seconds 0)"
    echo "traefik dry-run PASS"
    return 0
  fi
  install -m 600 "$live" "$orig"; cmp -s "$live" "$orig" || die "backup did not read back"
  local since; since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  install -m 600 "$rendered" "$DYNAMIC_DIR/.slicer-api.tmp-$TS"
  mv -f "$DYNAMIC_DIR/.slicer-api.tmp-$TS" "$live"
  echo "swapped (atomic rename); watching ${WATCH_SECONDS}s"
  watch_log "$orig" "$WATCH_SECONDS" 1 "$since" || die "automatic restore after the swap"
  echo "60 s clean. 30-minute watch (report only):"
  watch_log "$orig" 1800 0 "$since" || { echo "a shop 403/404 in the 30-minute watch: restore with $0 --execute traefik-watch --orig $orig --seconds 0" >&2; exit 1; }
  docker logs --since "$since" "$TRAEFIK_NAME" 2>&1 | grep -c 'Health check failed' | sed 's/^/traefik health-check failures: /'
  echo "traefik PASS. Rollback at any time: the same atomic restore of $orig"
}

case "$CMD" in
  help|-h|--help) usage ;;
  check-env) cmd_check_env ;;
  slot-prefixes) cmd_slot_prefixes ;;
  capture) cmd_capture ;;
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback "$@" ;;
  keyring-only) cmd_keyring_only ;;
  traefik) cmd_traefik ;;
  traefik-watch) cmd_traefik_watch "$@" ;;
  *) usage >&2; die "unknown subcommand" ;;
esac
