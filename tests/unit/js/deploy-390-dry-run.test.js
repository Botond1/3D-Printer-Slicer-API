'use strict';

// WP8 acceptance (3.9.0 §9): deploy-390.sh on a fixture tree. Dry-run by
// default; both env files; refusals for a missing SLICER_MEMORY_BYTES, a
// changed tuning value, a non-empty WOOCOMMERCE_PREVIOUS, a third CIDR in the
// rendered file and a backup path inside the dynamic dir; the 60 s
// auto-restore fires on a fixture access log with one 403 from the shop's
// address. No fake key value may reach stdout or stderr.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { realAnswer, skeleton } = require('./fixtures/deploy-390-real-answer');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'ops', 'hostinger', 'cutover', 'deploy-390.sh');
const LIVE_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'hostinger', 'live-slicer-api-3.8.3.yml');
const BASH = (() => {
    const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    return probe.status === 0 && probe.stdout.trim() === 'ok' ? 'bash' : null;
})();
const OLD_REF = `ghcr.io/botond1/3d-printer-slicer-api@sha256:${'a'.repeat(64)}`;
const NEW_REF = `ghcr.io/botond1/3d-printer-slicer-api@sha256:${'b'.repeat(64)}`;
const NEW_SHA = 'c'.repeat(40);
const SECRETS = Object.freeze({
    SLICE_SERVICE_API_KEY: 'FAKE-legacy-key-value-7f3a9c',
    SLICE_SERVICE_WOOCOMMERCE_API_KEY: 'FAKE-woo-key-value-91be04',
    SLICE_SERVICE_LEADPILOT_API_KEY: 'FAKE-leadpilot-key-value-5d21',
    OPERATIONS_API_KEY: 'FAKE-operations-key-value-a0c7',
    ADMIN_API_KEY: 'FAKE-admin-key-value-77e1'
});

function bashPath(target) {
    // Git Bash on Windows: C:\x\y -> /c/x/y; POSIX paths unchanged.
    if (process.platform !== 'win32') return target;
    return target.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replace(/\\/g, '/');
}

function makeTree(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-390-fixture-'));
    const envDir = path.join(root, 'etc');
    const dynamic = path.join(root, 'dynamic');
    const control = overrides.controlInsideDynamic ? path.join(dynamic, 'control') : path.join(root, 'control');
    fs.mkdirSync(envDir); fs.mkdirSync(dynamic); fs.mkdirSync(control, { recursive: true });
    const serviceFile = path.join(envDir, 'service-n1.env');
    const compose = {
        SLICER_API_IMAGE: OLD_REF, SLICER_ENV_FILE: bashPath(serviceFile),
        SLICER_MEMORY_BYTES: '12884901888', SLICER_CPU_LIMIT: '4.0', SLICER_PIDS_LIMIT: '512',
        SLICER_UID: '999', SLICER_GID: '999', SLICER_LOG_MAX_SIZE: '20m', SLICER_LOG_MAX_FILES: '5',
        SLICER_STOP_GRACE_PERIOD: '30s', SLICER_INPUT_DIR: '/srv/rocket3d/slicer-api/input',
        SLICER_OUTPUT_DIR: '/srv/rocket3d/slicer-api/output', SLICER_CONFIGS_DIR: '/opt/x/configs',
        SLICER_PRICING_STATE_DIR: '/srv/rocket3d/slicer-api/pricing-state', ...(overrides.compose || {})
    };
    // As the live service env file (read on 2026-11-11): NODE_ENV is NOT in it;
    // the container gets NODE_ENV=production from the image's ENV.
    const service = {
        PORT: '3000', TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '172.18.0.2/32',
        MAX_CONCURRENT_SLICES: '2', MAX_SLICE_QUEUE_LENGTH: '24', MAX_SLICE_QUEUE_PER_IP: '20',
        MAX_SLICE_QUEUE_WAIT_MS: '240000', ASYNC_SLICE_DEADLINE_MS: '900000', PYTHON_HELPER_TIMEOUT_MS: '300000',
        ORIENTATION_HELPER_TIMEOUT_MS: '60000', SLICE_RATE_LIMIT_MAX_REQUESTS: '30',
        SLICE_RATE_LIMIT_BURST_CAPACITY: '20', SLICE_SERVICE_AUTH_MODE: 'migration',
        SLICE_SERVICE_API_KEY: SECRETS.SLICE_SERVICE_API_KEY, SLICE_SERVICE_API_KEY_PREVIOUS: '',
        SLICE_SERVICE_LEGACY_MIGRATION_UNTIL: '2026-11-30T00:00:00Z',
        SLICE_SERVICE_WOOCOMMERCE_API_KEY: SECRETS.SLICE_SERVICE_WOOCOMMERCE_API_KEY,
        SLICE_SERVICE_LEADPILOT_API_KEY: SECRETS.SLICE_SERVICE_LEADPILOT_API_KEY,
        OPERATIONS_API_KEY: SECRETS.OPERATIONS_API_KEY, ADMIN_API_KEY: SECRETS.ADMIN_API_KEY,
        ...(overrides.service || {})
    };
    const write = (file, entries) => fs.writeFileSync(file, `# fixture\n${Object.entries(entries)
        .filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
    const composeFile = path.join(envDir, 'compose-n1-exact-configs.env');
    write(composeFile, compose);
    write(serviceFile, service);
    fs.writeFileSync(path.join(control, 'compose-limits.json'), '{}\n');
    let live = fs.readFileSync(LIVE_FIXTURE, 'utf8');
    if (overrides.thirdCidr) {
        live = live.replace('          - "45.84.204.13/32"\n', '          - "45.84.204.13/32"\n          - "192.0.2.7/32"\n');
    }
    fs.writeFileSync(path.join(dynamic, 'slicer-api.yml'), live);
    return { root, composeFile, serviceFile, dynamic, control };
}

function runScript(tree, args, extraEnv = {}) {
    const env = {
        ...process.env,
        R3D_COMPOSE_ENV: bashPath(tree.composeFile),
        R3D_PACK: bashPath(tree.root),
        R3D_DYNAMIC_DIR: bashPath(tree.dynamic),
        R3D_CONTROL_DIR: bashPath(tree.control),
        R3D_RELEASE_TREE: bashPath(ROOT),
        ...extraEnv
    };
    const result = spawnSync(BASH, [bashPath(SCRIPT), ...args], { encoding: 'utf8', env, timeout: 60000 });
    for (const value of Object.values(SECRETS)) {
        assert.equal(`${result.stdout}${result.stderr}`.includes(value), false, 'a key value was printed');
    }
    return result;
}

const skip = BASH ? false : 'bash is not available';

test('bash -n: every WP8 shell script parses', { skip }, () => {
    for (const relative of [
        'ops/hostinger/cutover/deploy-390.sh',
        'ops/hostinger/cutover/rehearse-checks.sh',
        'ops/hostinger/traefik-matrix/run-matrix.sh',
        'ops/hostinger/private-ab/run-private-ab.sh',
        'ops/hostinger/host-hardening/r3d-host-hardening.sh',
        'ops/hostinger/keyring/provision-staging-key.sh'
    ]) {
        const result = spawnSync(BASH, ['-n', bashPath(path.join(ROOT, relative))], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${relative}: ${result.stderr}`);
    }
});

test('no subcommand prints the usage and changes nothing', { skip }, () => {
    const tree = makeTree();
    try {
        const before = fs.readFileSync(tree.serviceFile, 'utf8');
        const result = runScript(tree, []);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /DRY-RUN BY DEFAULT/);
        assert.equal(fs.readFileSync(tree.serviceFile, 'utf8'), before);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('check-env and the deploy dry-run prove the rewrite on both files and write nothing', { skip }, () => {
    const tree = makeTree();
    try {
        const compose = fs.readFileSync(tree.composeFile, 'utf8');
        const service = fs.readFileSync(tree.serviceFile, 'utf8');
        const check = runScript(tree, ['check-env']);
        assert.equal(check.status, 0, check.stderr);
        assert.match(check.stdout, /check-env PASS/);
        const deploy = runScript(tree, ['deploy', NEW_REF, NEW_SHA, '--export-route', 'false']);
        assert.equal(deploy.status, 0, deploy.stderr);
        assert.match(deploy.stdout, /compose env: changed SLICER_API_IMAGE; \d+ lines, all others byte-identical/);
        assert.match(deploy.stdout, /service env: changed SLICE_SERVICE_AUTH_MODE; added ARTIFACT_TTL_MS, EXPORT_ROUTE_ENABLED, MAX_UPLOAD_BYTES, SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS; removed SLICE_SERVICE_API_KEY, SLICE_SERVICE_API_KEY_PREVIOUS, SLICE_SERVICE_LEGACY_MIGRATION_UNTIL/);
        assert.match(deploy.stdout, /DRY-RUN would back up both env files together/);
        assert.match(deploy.stdout, /deploy dry-run PASS/);
        assert.equal(fs.readFileSync(tree.composeFile, 'utf8'), compose);
        assert.equal(fs.readFileSync(tree.serviceFile, 'utf8'), service);
        assert.deepEqual(fs.readdirSync(tree.control), ['compose-limits.json']);
        const noFlag = runScript(tree, ['deploy', NEW_REF, NEW_SHA]);
        assert.notEqual(noFlag.status, 0);
        assert.match(noFlag.stderr, /--export-route true\|false is required/);
        const keyring = runScript(tree, ['keyring-only']);
        assert.equal(keyring.status, 0, keyring.stderr);
        assert.match(keyring.stdout, /compose env: changed \(none\)/);
        assert.match(keyring.stdout, /keyring-only dry-run PASS/);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('refuses a compose env without SLICER_MEMORY_BYTES', { skip }, () => {
    const tree = makeTree({ compose: { SLICER_MEMORY_BYTES: null } });
    try {
        const result = runScript(tree, ['deploy', NEW_REF, NEW_SHA, '--export-route', 'false']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /STOP compose env lacks SLICER_MEMORY_BYTES/);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('refuses a changed tuning value and a changed compose limit', { skip }, () => {
    for (const [overrides, pattern] of [
        [{ service: { MAX_CONCURRENT_SLICES: '3' } }, /tuning value differs from the live value: MAX_CONCURRENT_SLICES/],
        [{ service: { ORIENTATION_HELPER_TIMEOUT_MS: null } }, /service env lacks ORIENTATION_HELPER_TIMEOUT_MS/],
        [{ compose: { SLICER_CPU_LIMIT: '2.0' } }, /limit differs from the live value: SLICER_CPU_LIMIT/]
    ]) {
        const tree = makeTree(overrides);
        try {
            const result = runScript(tree, ['deploy', NEW_REF, NEW_SHA, '--export-route', 'true']);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, pattern);
            assert.doesNotMatch(result.stdout, /DRY-RUN would back up/);
        } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
    }
});

test('refuses a non-empty WOOCOMMERCE_PREVIOUS (no second key-ring move)', { skip }, () => {
    const tree = makeTree({ service: { SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: 'FAKE-legacy-key-value-7f3a9c' } });
    try {
        for (const args of [['deploy', NEW_REF, NEW_SHA, '--export-route', 'false'], ['keyring-only'], ['check-env']]) {
            const result = runScript(tree, args);
            assert.notEqual(result.status, 0, args[0]);
            assert.match(result.stderr, /SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS is already non-empty/);
        }
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('traefik dry-run renders from the live file and plans T-TRF', { skip }, () => {
    const tree = makeTree();
    try {
        const before = fs.readFileSync(path.join(tree.dynamic, 'slicer-api.yml'), 'utf8');
        const result = runScript(tree, ['traefik']);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /router_reproduce_live=PASS phase=production-two-range entries=2 byte_identical=true/);
        assert.match(result.stdout, /router_render_from_live=PASS phase=production-two-range entries=2 differing_lines=rule/);
        assert.match(result.stdout, /throwaway router ready: ranges substituted by position=2 differing_lines=2/);
        assert.match(result.stdout, /traefik dry-run PASS/);
        assert.doesNotMatch(`${result.stdout}${result.stderr}`, /31\.97\.75\.126|45\.84\.204\.13/);
        assert.equal(fs.readFileSync(path.join(tree.dynamic, 'slicer-api.yml'), 'utf8'), before);
        assert.deepEqual(fs.readdirSync(tree.dynamic), ['slicer-api.yml']);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('traefik refuses a third CIDR in the rendered file', { skip }, () => {
    const tree = makeTree({ thirdCidr: true });
    try {
        const result = runScript(tree, ['traefik']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /j2_allowlist_cidr_invalid/);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('traefik refuses a backup path inside the dynamic dir', { skip }, () => {
    const tree = makeTree({ controlInsideDynamic: true });
    try {
        const result = runScript(tree, ['traefik']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /lies inside the watched dynamic dir/);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

function watchTree(logLines) {
    const tree = makeTree();
    const orig = path.join(tree.control, 'slicer-api.yml.orig');
    fs.copyFileSync(path.join(tree.dynamic, 'slicer-api.yml'), orig);
    fs.writeFileSync(path.join(tree.dynamic, 'slicer-api.yml'), '# the swapped-in 3.9.0 router\n');
    const log = path.join(tree.root, 'access.log');
    fs.writeFileSync(log, `${logLines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { tree, orig, log };
}

test('the auto-restore fires on one 403 from the shop-position address', { skip }, () => {
    const { tree, orig, log } = watchTree([
        { level: 'info', msg: 'Configuration loaded' },
        { ClientHost: '45.84.204.13', DownstreamStatus: 202, RouterName: 'slicer-api@file', RequestPath: '/bambu/slice' },
        { ClientHost: '45.84.204.13', DownstreamStatus: 403, RouterName: 'slicer-api@file', RequestPath: '/bambu/slice' }
    ]);
    try {
        const dry = runScript(tree, ['traefik-watch', '--orig', bashPath(orig), '--seconds', '1'],
            { R3D_ACCESS_LOG_FILE: bashPath(log) });
        assert.notEqual(dry.status, 0);
        assert.match(dry.stdout, /DRY-RUN would restore the original router/);
        assert.equal(fs.readFileSync(path.join(tree.dynamic, 'slicer-api.yml'), 'utf8'), '# the swapped-in 3.9.0 router\n');
        const real = runScript(tree, ['--execute', 'traefik-watch', '--orig', bashPath(orig), '--seconds', '60'],
            { R3D_ACCESS_LOG_FILE: bashPath(log) });
        assert.notEqual(real.status, 0);
        assert.match(real.stderr, /restore shop_requests=2 shop_403_404_or_unrouted=1/);
        assert.match(real.stdout, /RESTORED the original router \(atomic rename\)/);
        assert.equal(fs.readFileSync(path.join(tree.dynamic, 'slicer-api.yml'), 'utf8'), fs.readFileSync(orig, 'utf8'));
        assert.deepEqual(fs.readdirSync(tree.dynamic), ['slicer-api.yml']);
        assert.doesNotMatch(`${real.stdout}${real.stderr}`, /45\.84\.204\.13/);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('an unrouted shop request also restores; a clean log and a stranger 403 do not', { skip }, () => {
    const unrouted = watchTree([{ ClientHost: '45.84.204.13', DownstreamStatus: 200, RequestPath: '/x' }]);
    try {
        const result = runScript(unrouted.tree, ['--execute', 'traefik-watch', '--orig', bashPath(unrouted.orig), '--seconds', '1'],
            { R3D_ACCESS_LOG_FILE: bashPath(unrouted.log) });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /RESTORED/);
    } finally { fs.rmSync(unrouted.tree.root, { recursive: true, force: true }); }
    const clean = watchTree([
        { ClientHost: '45.84.204.13', DownstreamStatus: 202, RouterName: 'slicer-api@file' },
        { ClientHost: '45.84.204.13', DownstreamStatus: 200, RouterName: 'slicer-api@file' },
        { ClientHost: '198.51.100.9', DownstreamStatus: 403, RouterName: 'slicer-api@file' }
    ]);
    try {
        const result = runScript(clean.tree, ['--execute', 'traefik-watch', '--orig', bashPath(clean.orig), '--seconds', '1'],
            { R3D_ACCESS_LOG_FILE: bashPath(clean.log) });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /watch clean for 1s: clean shop_requests=2 shop_403_404_or_unrouted=0 other_403=1/);
        assert.equal(fs.readFileSync(path.join(clean.tree.dynamic, 'slicer-api.yml'), 'utf8'), '# the swapped-in 3.9.0 router\n');
    } finally { fs.rmSync(clean.tree.root, { recursive: true, force: true }); }
});

test('rollback dry-run restores from the backup and re-applies only the key-ring move', { skip }, () => {
    const tree = makeTree();
    try {
        const backup = path.join(tree.control, 'env-backup-20261112T020000Z');
        fs.mkdirSync(backup);
        fs.copyFileSync(tree.composeFile, path.join(backup, 'compose-n1-exact-configs.env'));
        fs.copyFileSync(tree.serviceFile, path.join(backup, 'service-n1.env'));
        const result = runScript(tree, ['rollback', NEW_REF, NEW_SHA]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /compose env: changed \(none\)/);
        assert.match(result.stdout, /service env: changed SLICE_SERVICE_AUTH_MODE; added SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS; removed SLICE_SERVICE_API_KEY, SLICE_SERVICE_API_KEY_PREVIOUS, SLICE_SERVICE_LEGACY_MIGRATION_UNTIL/);
        assert.match(result.stdout, /rollback dry-run PASS/);
    } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// --execute paths against a fake `docker` on PATH (no real container is touched).
// ---------------------------------------------------------------------------
const FAKE_DOCKER = [
    '#!/usr/bin/env bash',
    'state="${FAKE_STATE:?}"',
    'echo "$*" >> "$state/calls"',
    'args="$*"',
    // After the FIRST up, FAKE_RUNNING describes the new container; a container that is
    // not "true false" (restarting, exited) cannot be exec-ed into, as with real docker.
    'ups=$(cat "$state/ups" 2>/dev/null || echo 0)',
    'running="true false"; if [ "$ups" -eq 1 ]; then running="${FAKE_RUNNING:-true false}"; fi',
    'case "$1" in',
    '  exec)',
    '    [ "$running" = "true false" ] || { echo "Error response from daemon: container is restarting" >&2; exit 1; }',
    '    case "$args" in',
    '      *"cat /sys/fs/cgroup/memory.max"*) echo 12884901888; exit 0 ;;',
    '      *"cat /sys/fs/cgroup/cpu.max"*) echo "400000 100000"; exit 0 ;;',
    '      *"cat /sys/fs/cgroup/pids.max"*) echo 512; exit 0 ;;',
    '      *"/operations/metrics"*)',
    '        n=$(( $(cat "$state/queue-reads" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$state/queue-reads"',
    '        if [ "$n" -gt "${FAKE_QUEUE_BUSY_AFTER:-99}" ]; then active=1; else active=0; fi',
    '        printf "slicer_queue_active_jobs %s\\nslicer_queue_queued_jobs 0\\n" "$active"; exit 0 ;;',
    // The control slice (IN_SLICE posts to /bambu/slice): the answer file per model.
    '      *"/bambu/slice"*"orientationMode=auto"*) cat > /dev/null; cat "$state/slice-cube.json" 2>/dev/null; exit 0 ;;',
    '      *"/bambu/slice"*) cat > /dev/null; cat "$state/slice-block.json" 2>/dev/null; exit 0 ;;',
    '      *" /profiles?contract=material-v1") cat "$state/profiles-v3.json" 2>/dev/null; exit 0 ;;',
    '      *" /profiles") cat "$state/profiles-v2.json" 2>/dev/null; exit 0 ;;',
    '      *\'path:"/ready"\'*) echo "ready_polls=60 p99_ms=4.2 max_ms=7.9"; exit 0 ;;',
    '    esac',
    '    exit 0 ;;',
    '  pull) echo "pulled"; exit 0 ;;',
    '  image)',
    '    case "$2" in',
    '      inspect) case "$args" in *local/*) exit 1 ;; esac; echo "sha256:fakeimage"; exit 0 ;;',
    '      *) exit 0 ;;',
    '    esac ;;',
    '  compose)',
    '    case "$args" in',
    '      *" config "*|*" config") echo \'{"services":{"slicer-api":{"mem_limit":"12884901888","memswap_limit":"12884901888","cpus":4,"pids_limit":512,"environment":{}}}}\'; exit 0 ;;',
    '      *" up "*) touch "$state/up"; echo $((ups + 1)) > "$state/ups"; exit 0 ;;',
    '    esac',
    '    exit 0 ;;',
    '  inspect)',
    '    case "$args" in',
    '      *org.opencontainers.image.revision*"${FAKE_OLD_REF:?}"*) echo "dbc539e98fb5105b522578dffcb2d93a77fff8b9"; exit 0 ;;',
    '      *org.opencontainers.image.revision*) echo "${FAKE_NEW_SHA:?}"; exit 0 ;;',
    // The container env as docker builds it: the image ENV (NODE_ENV, PATH, ...),
    // the compose `environment:` (EXPECTED_*), then the service env file.
    '      *"range .Config.Env"*)',
    '        printf "NODE_ENV=production\\nPATH=/opt/venv/bin:/usr/local/bin:/usr/bin:/bin\\nHOME=/tmp/slicer-home\\nEXPECTED_PIDS_LIMIT=512\\n"',
    '        grep -E "^[A-Za-z_][A-Za-z0-9_]*=" "${FAKE_SERVICE_ENV:?}"; exit 0 ;;',
    // After the first up the container runs FAKE_NEW_REF when the test names one.
    '      *"{{.Config.Image}} {{.Image}}"*)',
    '        if [ "$ups" -eq 1 ] && [ -n "${FAKE_NEW_REF:-}" ]; then echo "${FAKE_NEW_REF} sha256:fakeimage running true 0 false"; exit 0; fi',
    '        echo "${FAKE_OLD_REF} sha256:fakeimage running true 0 false"; exit 0 ;;',
    '      *State.Health.Status*) echo healthy; exit 0 ;;',
    '      *"{{.State.Running}} {{.State.Restarting}}"*) echo "$running"; exit 0 ;;',
    '      *" {{.State.Running}} "*) echo "${running%% *}"; exit 0 ;;',
    '      *) echo "not-the-expected-identity"; exit 0 ;;',
    '    esac ;;',
    // FAKE_LOG_FLOOD: the real 10 minutes of log after the line (a reader that stops early
    // kills the writer with SIGPIPE, as it kills a real `docker logs`).
    '  logs) [ -z "${FAKE_LOG_LINE:-}" ] || echo "$FAKE_LOG_LINE"',
    '    if [ -n "${FAKE_LOG_FLOOD:-}" ]; then for i in $(seq 1 "$FAKE_LOG_FLOOD"); do echo "{\\"event\\":\\"request.completed\\",\\"n\\":$i}"; done; fi',
    '    exit 0 ;;',
    'esac',
    'exit 0',
    ''
].join('\n');

const PATH_KEY = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';

function executeTree(t) {
    const tree = makeTree();
    t.after(() => fs.rmSync(tree.root, { recursive: true, force: true }));
    const bin = path.join(tree.root, 'bin');
    const state = path.join(tree.root, 'state');
    fs.mkdirSync(bin); fs.mkdirSync(state);
    fs.writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
    // The post-checks pause 21 s between the control slices and 2 s per health read.
    fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    if (process.platform === 'win32') {
        // Git Bash cannot chmod a new directory on NTFS; the mode is the Linux host's concern.
        fs.writeFileSync(path.join(bin, 'mkdir'), [
            '#!/usr/bin/env bash',
            'args=()',
            'while [ "$#" -gt 0 ]; do case "$1" in -m) shift 2 ;; *) args+=("$1"); shift ;; esac; done',
            'exec /usr/bin/mkdir "${args[@]}"',
            ''
        ].join('\n'), { mode: 0o755 });
    }
    // A complete step-2 capture whose limits equal what the fake compose config prints.
    fs.writeFileSync(path.join(tree.control, 'compose-limits.json'), `${JSON.stringify({
        mem_limit: '12884901888', memswap_limit: '12884901888', cpus: '4', pids_limit: '512', expected: {}
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(tree.control, 'capture-complete'), '2026-11-11T16:40:00Z\n');
    // The capture's catalogue bodies; the fake container answers the same bytes.
    const catalogue = { 'profiles-v2': '{"catalogue_version":2,"printers":[]}', 'profiles-v3': '{"catalogue_version":3,"printers":[]}' };
    for (const [name, body] of Object.entries(catalogue)) {
        fs.writeFileSync(path.join(tree.control, `${name}-before.json`), body);
        fs.writeFileSync(path.join(state, `${name}.json`), body);
    }
    // The control models the capture sliced (post_checks slices them again).
    fs.mkdirSync(path.join(tree.control, 'models'));
    for (const model of ['cube', 'block']) fs.writeFileSync(path.join(tree.control, 'models', `${model}.stl`), `solid ${model}\nendsolid ${model}\n`);
    // The capture's two runs per model on 3.8.3, in the service's own answer shape.
    for (const model of ['cube', 'block']) {
        for (const run of [1, 2]) {
            fs.writeFileSync(path.join(tree.control, `control-${model}-before-${run}.json`), JSON.stringify(
                realAnswer(model, { id: `${model}-before-${run}`, seconds: 2460 + run, grams: 52.3 + run / 100 })));
        }
    }
    // What the new container answers by default: a 3.9.0 run (new ids, 1 h retention).
    for (const model of ['cube', 'block']) {
        fs.writeFileSync(path.join(state, `slice-${model}.json`), JSON.stringify(
            realAnswer(model, { id: `${model}-after`, retention: 3600, seconds: 2461, grams: 52.31 })));
    }
    const digest = NEW_REF.split('@sha256:')[1];
    const evidence = path.join(tree.root, 'attestations.json');
    fs.writeFileSync(evidence, JSON.stringify([
        { verificationResult: { statement: { predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: digest } }] } } },
        { verificationResult: { statement: { predicateType: 'https://spdx.dev/Document/v2.3', subject: [{ digest: { sha256: digest } }] } } }
    ]));
    const env = {
        [PATH_KEY]: `${bin}${path.delimiter}${process.env[PATH_KEY]}`,
        FAKE_STATE: bashPath(state), FAKE_NEW_SHA: NEW_SHA, FAKE_OLD_REF: OLD_REF,
        FAKE_SERVICE_ENV: bashPath(tree.serviceFile),
        R3D_PROJECT: 'r3d-rehearsal', R3D_CONTAINER: 'r3d-rehearsal-backend'
    };
    const snapshot = () => [fs.readFileSync(tree.composeFile, 'utf8'), fs.readFileSync(tree.serviceFile, 'utf8')];
    return { tree, state, evidence, env, snapshot };
}

const deployArgs = (evidence) => ['--execute', 'deploy', NEW_REF, NEW_SHA, '--export-route', 'false', '--attested', bashPath(evidence)];

test('OPS-2: an incomplete step-2 capture is refused before either env file is written', { skip }, (t) => {
    const ctx = executeTree(t);
    fs.rmSync(path.join(ctx.tree.control, 'control-block-before-2.json'));
    const before = ctx.snapshot();
    const result = runScript(ctx.tree, deployArgs(ctx.evidence), ctx.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lacks control-block-before-2\.json/);
    assert.deepEqual(ctx.snapshot(), before);
    assert.equal(fs.existsSync(path.join(ctx.state, 'calls')), false, 'no docker call before the capture check');
    // A missing control model is refused before the restart, not discovered by the post-check after it.
    fs.writeFileSync(path.join(ctx.tree.control, 'control-block-before-2.json'), '{}\n');
    fs.rmSync(path.join(ctx.tree.control, 'models', 'block.stl'));
    const noModel = runScript(ctx.tree, deployArgs(ctx.evidence), ctx.env);
    assert.notEqual(noModel.status, 0);
    assert.match(noModel.stderr, /lacks models\/block\.stl/);
    assert.deepEqual(ctx.snapshot(), before);
    assert.equal(fs.existsSync(path.join(ctx.state, 'calls')), false, 'no docker call before the capture check');
    // A control dir of another date (no capture at all) names the override.
    const missing = runScript(ctx.tree, ['deploy', NEW_REF, NEW_SHA, '--export-route', 'false'],
        { ...ctx.env, R3D_CONTROL_DIR: bashPath(path.join(ctx.tree.root, 'control-other-date')) });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /pass R3D_CONTROL_DIR=<that dir>/);
});

test('OPS-4: an overridden pack with the live project or container is refused before any docker call', { skip }, (t) => {
    const ctx = executeTree(t);
    const before = ctx.snapshot();
    for (const unset of ['R3D_PROJECT', 'R3D_CONTAINER']) {
        const env = { ...ctx.env, [unset]: '' };
        const result = runScript(ctx.tree, deployArgs(ctx.evidence), env);
        assert.notEqual(result.status, 0, unset);
        assert.match(result.stderr, /set R3D_PROJECT and R3D_CONTAINER/);
    }
    assert.deepEqual(ctx.snapshot(), before);
    assert.equal(fs.existsSync(path.join(ctx.state, 'calls')), false);
});

test('OPS-8: attestation evidence for another digest stops the deploy before the env files', { skip }, (t) => {
    const ctx = executeTree(t);
    fs.writeFileSync(ctx.evidence, JSON.stringify([
        { verificationResult: { statement: { predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: 'd'.repeat(64) } }] } } }
    ]));
    const before = ctx.snapshot();
    const result = runScript(ctx.tree, deployArgs(ctx.evidence), ctx.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not name this digest/);
    assert.deepEqual(ctx.snapshot(), before);
    assert.equal(fs.existsSync(path.join(ctx.state, 'up')), false);
});

test('OPS-6: a job admitted after the pull keeps the old container; both env files are restored', { skip }, (t) => {
    const ctx = executeTree(t);
    const before = ctx.snapshot();
    const result = runScript(ctx.tree, deployArgs(ctx.evidence), { ...ctx.env, FAKE_QUEUE_BUSY_AFTER: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /the live queue is no longer idle/);
    assert.match(result.stderr, /both env files restored/);
    assert.deepEqual(ctx.snapshot(), before, 'the live env files are back byte for byte');
    assert.equal(fs.existsSync(path.join(ctx.state, 'up')), false, 'nothing was restarted');
});

test('OPS-1: a failed check with the new container not running rolls back at once (no HOLD)', { skip }, (t) => {
    const ctx = executeTree(t);
    const result = runScript(ctx.tree, deployArgs(ctx.evidence), { ...ctx.env, FAKE_RUNNING: 'false true' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /new container is not running \(false true\): automatic rollback/);
    assert.doesNotMatch(result.stderr, /HOLD/);
    assert.match(result.stdout, /§8 step 6 rollback from/);
    assert.match(result.stdout, /rollback PASS/);
});

test('OPS-3: deploy accepts an env the key-ring move already ran on, and only that', { skip }, () => {
    const migrated = makeTree({ service: {
        SLICE_SERVICE_API_KEY: null, SLICE_SERVICE_API_KEY_PREVIOUS: null, SLICE_SERVICE_LEGACY_MIGRATION_UNTIL: null,
        SLICE_SERVICE_AUTH_MODE: 'principals', SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: 'FAKE-legacy-key-value-7f3a9c'
    } });
    try {
        for (const args of [['check-env'], ['deploy', NEW_REF, NEW_SHA, '--export-route', 'true']]) {
            const result = runScript(migrated, args);
            assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`);
            assert.match(result.stdout, /the key-ring move already ran/);
        }
        const deploy = runScript(migrated, ['deploy', NEW_REF, NEW_SHA, '--export-route', 'true']);
        assert.match(deploy.stdout, /service env: changed \(none\); added ARTIFACT_TTL_MS, EXPORT_ROUTE_ENABLED, MAX_UPLOAD_BYTES; removed \(none\)/);
        const keyring = runScript(migrated, ['keyring-only']);
        assert.notEqual(keyring.status, 0, 'a second key-ring move is still refused');
    } finally { fs.rmSync(migrated.root, { recursive: true, force: true }); }
    // The half state (the move ran but a legacy key is back) is refused.
    const half = makeTree({ service: { SLICE_SERVICE_AUTH_MODE: 'principals',
        SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: 'FAKE-legacy-key-value-7f3a9c' } });
    try {
        const result = runScript(half, ['deploy', NEW_REF, NEW_SHA, '--export-route', 'false']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /already non-empty/);
    } finally { fs.rmSync(half.root, { recursive: true, force: true }); }
});

test('OPS-5: the watch fails closed on a scanner failure and on a log with no access line; shop_requests=0 is UNPROVEN', { skip }, () => {
    const empty = watchTree([{ level: 'info', msg: 'Configuration loaded' }]);
    try {
        const result = runScript(empty.tree, ['--execute', 'traefik-watch', '--orig', bashPath(empty.orig), '--seconds', '1'],
            { R3D_ACCESS_LOG_FILE: bashPath(empty.log) });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /UNPROVEN: no access-log line at all/);
        assert.match(result.stdout, /RESTORED/);
    } finally { fs.rmSync(empty.tree.root, { recursive: true, force: true }); }
    const broken = watchTree([{ ClientHost: '45.84.204.13', DownstreamStatus: 202, RouterName: 'slicer-api@file' }]);
    try {
        fs.writeFileSync(broken.orig, '# not a router\n');
        const result = runScript(broken.tree, ['--execute', 'traefik-watch', '--orig', bashPath(broken.orig), '--seconds', '1'],
            { R3D_ACCESS_LOG_FILE: bashPath(broken.log) });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /the access-log read or scan failed/);
    } finally { fs.rmSync(broken.tree.root, { recursive: true, force: true }); }
    const quiet = watchTree([{ ClientHost: '198.51.100.9', DownstreamStatus: 200, RouterName: 'slicer-api@file' }]);
    try {
        const result = runScript(quiet.tree, ['--execute', 'traefik-watch', '--orig', bashPath(quiet.orig), '--seconds', '1'],
            { R3D_ACCESS_LOG_FILE: bashPath(quiet.log) });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /UNPROVEN for the shop \(shop_requests=0\)/);
        assert.doesNotMatch(result.stdout, /RESTORED/);
    } finally { fs.rmSync(quiet.tree.root, { recursive: true, force: true }); }
});

test('OPS-10: the private A/B teardown removes its data dir although compose down already removed the network', { skip }, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-s390-down-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const calls = path.join(root, 'calls');
    fs.writeFileSync(path.join(bin, 'docker'), [
        '#!/usr/bin/env bash',
        'echo "docker $*" >> "$FAKE_CALLS"',
        // compose down removes the project-defined network, so it is gone afterwards.
        'case "$1 $2" in "network inspect"|"network rm") echo "network r3d-s390-internal not found" >&2; exit 1 ;; esac',
        'exit 0',
        ''
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'rm'), ['#!/usr/bin/env bash', 'echo "rm $*" >> "$FAKE_CALLS"', 'exit 0', ''].join('\n'), { mode: 0o755 });
    const script = path.join(ROOT, 'ops', 'hostinger', 'private-ab', 'run-private-ab.sh');
    const result = spawnSync(BASH, [bashPath(script), '--execute', 'down'], {
        encoding: 'utf8', timeout: 60000,
        env: { ...process.env, [PATH_KEY]: `${bin}${path.delimiter}${process.env[PATH_KEY]}`, FAKE_CALLS: bashPath(calls) }
    });
    assert.equal(result.status, 0, result.stderr);
    const log = fs.readFileSync(calls, 'utf8');
    assert.match(log, /docker compose -p r3d-s390 .* down/);
    assert.doesNotMatch(log, /docker network rm/, 'no removal of a network that is already gone');
    assert.match(log, /rm -r -- \/srv\/r3d-s390-private/, 'the data dir is removed');
});

// ---------------------------------------------------------------------------
// Post-checks against the service's OWN answer shape (the 2026-11-11 lesson):
// the first live cutover rolled back on two false failures that no test above
// could see, because every compared answer was hand-written. The tuning list
// named NODE_ENV (the image's ENV, never in the service env file) and the
// control-slice comparison read three receipt paths the service never wrote.
// ---------------------------------------------------------------------------
const SCRIPT_TEXT = fs.readFileSync(SCRIPT, 'utf8');
const literal = (pattern, what) => {
    const match = pattern.exec(SCRIPT_TEXT);
    assert.ok(match, `deploy-390.sh declares ${what}`);
    return Function(`"use strict"; return (${match[1]});`)();
};
const IDENTITY_PATHS = literal(/const IDENTITY_PATHS = (\[[\s\S]*?\]);/, 'IDENTITY_PATHS');
const SERVICE_PINS = literal(/const SERVICE_PINS = (\{[\s\S]*?\});/, 'SERVICE_PINS');
const dig = (object, dotted) => dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);

function envtoolFile(t) {
    const open = "cat > \"$TOOL\" <<'NODE'\n";
    const start = SCRIPT_TEXT.indexOf(open);
    const end = SCRIPT_TEXT.indexOf('\nNODE\n', start);
    assert.ok(start > 0 && end > start, 'deploy-390.sh carries the envtool heredoc');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-390-envtool-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'envtool.js');
    fs.writeFileSync(file, SCRIPT_TEXT.slice(start + open.length, end + 1));
    return { dir, file };
}

function sliceCompare(t, before1, before2, after, spread = '0.01') {
    const tool = envtoolFile(t);
    const files = [before1, before2, after].map((answer, index) => {
        const file = path.join(tool.dir, `run-${index}.json`);
        fs.writeFileSync(file, JSON.stringify(answer));
        return file;
    });
    return spawnSync(process.execPath, [tool.file, 'slice-compare', ...files, spread], { encoding: 'utf8' });
}

test('IDENTITY_PATHS: every entry exists in a real 3.8.3 answer (the skeleton recorded from dbc539e)', () => {
    const answer = realAnswer('cube');
    assert.ok(IDENTITY_PATHS.length > 0);
    for (const dotted of IDENTITY_PATHS) {
        assert.notEqual(dig(answer, dotted), undefined, `${dotted} is not in the service's answer`);
    }
    // The three paths the first cutover read: absent from the service's answer.
    for (const invented of ['technical_receipt.effective_profile_sha256', 'technical_receipt.configuration_sha256',
        'technical_receipt.model_transform']) {
        assert.equal(dig(answer, invented), undefined, `${invented} would have to be read where the service writes it`);
        assert.equal(IDENTITY_PATHS.includes(invented), false);
    }
    // The skeleton itself is the recorded one, not this file's invention.
    assert.equal(skeleton().fields.technical_receipt.fields.applied.fields.configuration_sha256.type, 'string');
});

test('IDENTITY_PATHS covers the spec §8 step-4 identity fields and no run-varying field', () => {
    const covered = (field) => IDENTITY_PATHS.some((dotted) => field === dotted || field.startsWith(`${dotted}.`));
    for (const field of ['technical_receipt.measurement_generation', 'technical_receipt.profiles.effective_profile_sha256',
        'technical_receipt.engine.build_sha256', 'technical_receipt.profiles.bundle_sha256',
        'technical_receipt.source.sha256', 'technical_receipt.source.normalized_geometry_sha256',
        'technical_receipt.source.sliced_geometry_sha256', 'technical_receipt.applied.configuration_sha256',
        'technical_receipt.geometry.model_transform', 'model_transform']) {
        assert.ok(covered(field), `${field} is not compared`);
    }
    // Ids, the artifact (its retention_seconds follows ARTIFACT_TTL_MS, changed by 3.9.0),
    // the receipt hash and the estimates differ legitimately between runs.
    for (const field of ['job_id', 'artifact_id', 'technical_receipt.request_id', 'technical_receipt.job_id',
        'technical_receipt.artifact.retention_seconds', 'technical_receipt.receipt_sha256',
        'technical_receipt.estimates.print_time_seconds', 'stats.print_time_seconds']) {
        assert.equal(covered(field), false, `${field} varies per run and must not be byte-compared`);
    }
});

test('slice-compare: a 3.9.0 run in the real shape passes; a changed identity, a missing path and a time outside the range fail', (t) => {
    const before1 = realAnswer('cube', { id: 'b1', seconds: 2460, grams: 52.3 });
    const before2 = realAnswer('cube', { id: 'b2', seconds: 2462, grams: 52.31 });
    const after = realAnswer('cube', { id: 'a', retention: 3600, seconds: 2461, grams: 52.305 });
    const pass = sliceCompare(t, before1, before2, after);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, new RegExp(`control slice: ${IDENTITY_PATHS.length} identity fields byte-equal`));

    const changed = sliceCompare(t, before1, before2, realAnswer('cube', { id: 'a' },
        { 'technical_receipt.applied.configuration_sha256': 'another-configuration' }));
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /identity field technical_receipt\.applied differs/);

    const generation = sliceCompare(t, before1, before2, realAnswer('cube', { id: 'a' },
        { 'technical_receipt.measurement_generation': 'another-generation' }));
    assert.match(generation.stderr, /identity field technical_receipt\.measurement_generation differs/);

    const pose = sliceCompare(t, before1, before2, realAnswer('cube', { id: 'a' }, { 'model_transform.orientation_outcome': 'other' }));
    assert.match(pose.stderr, /identity field model_transform differs/);

    const missing = realAnswer('cube', { id: 'b1' });
    delete missing.technical_receipt.applied;
    const absent = sliceCompare(t, missing, before2, after);
    assert.match(absent.stderr, /identity field technical_receipt\.applied missing/);

    const slow = sliceCompare(t, before1, before2, realAnswer('cube', { id: 'a', seconds: 2600 }));
    assert.match(slow.stderr, /print_time_seconds outside the old container's range/);
});

test('tuning allowlist: both grep lists are the service env pins, none comes from the image or compose', () => {
    const body = SCRIPT_TEXT.slice(SCRIPT_TEXT.indexOf('verify_tuning_runtime() {'), SCRIPT_TEXT.indexOf('\npost_checks() {'));
    const lists = [...body.matchAll(/grep -E '\^\(([A-Z0-9_|]+)\)='/g)].map((match) => match[1].split('|').sort());
    assert.equal(lists.length, 2, 'the container side and the file side');
    assert.deepEqual(lists[0], lists[1], 'the two sides compare the same names');
    // checkService() refuses a service env file without each SERVICE_PINS name, so these
    // are exactly the names the file is known to hold.
    assert.deepEqual(lists[0], Object.keys(SERVICE_PINS).sort());
    // Names the image (Dockerfile runtime stage ENV) or the compose `environment:` set
    // reach the container without the service env file.
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
    const imageNames = new Set();
    let inEnv = false;
    for (const line of runtime.split('\n')) {
        if (/^ENV\s/.test(line)) inEnv = true;
        if (inEnv) for (const match of line.matchAll(/(?:^ENV\s+|^\s+|\s)([A-Z_][A-Z0-9_]*)=/g)) imageNames.add(match[1]);
        if (inEnv && !/\\\s*$/.test(line)) inEnv = false;
    }
    assert.ok(imageNames.has('NODE_ENV'), 'the image ENV parse finds NODE_ENV');
    const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.production.yml'), 'utf8');
    const composeNames = new Set([...compose.matchAll(/^ {6}([A-Z_][A-Z0-9_]*): /gm)].map((match) => match[1]));
    assert.ok(composeNames.has('EXPECTED_PIDS_LIMIT'), 'the compose environment parse finds EXPECTED_*');
    for (const name of lists[0]) {
        assert.equal(imageNames.has(name), false, `${name} is set by the image`);
        assert.equal(composeNames.has(name), false, `${name} is set by the compose environment`);
    }
    assert.equal(lists[0].includes('NODE_ENV'), false);
});

const SLOT_SUMMARY = JSON.stringify({ timestamp: '2026-11-11T17:38:00.000Z', level: 'info', event: 'auth.slot_summary',
    audience: 'woocommerce', outcome: 'accepted', slot: 'woocommerce', rotation: 'active' });

test('post-checks: a deploy whose new container answers like the service passes every check', { skip }, (t) => {
    const ctx = executeTree(t);
    const result = runScript(ctx.tree, deployArgs(ctx.evidence), { ...ctx.env, FAKE_NEW_REF: NEW_REF, FAKE_LOG_LINE: SLOT_SUMMARY });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /runtime identity, revision label and cgroup limits/);
    assert.match(result.stdout, /tuning allowlist identical in the container/);
    assert.match(result.stdout, /catalogue v2 and v3 bodies byte-equal to the capture/);
    assert.equal([...result.stdout.matchAll(/control slice: \d+ identity fields byte-equal/g)].length, 2);
    assert.match(result.stdout, /auth\.slot_summary present/);
    assert.match(result.stdout, /deploy PASS/);
});

test('post-checks: an auth.slot_summary line followed by a long log is still found (no SIGPIPE false failure)', { skip }, (t) => {
    const ctx = executeTree(t);
    const result = runScript(ctx.tree, deployArgs(ctx.evidence),
        { ...ctx.env, FAKE_NEW_REF: NEW_REF, FAKE_LOG_LINE: SLOT_SUMMARY, FAKE_LOG_FLOOD: '20000' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /auth\.slot_summary present/);
    const other = executeTree(t);
    const none = runScript(other.tree, deployArgs(other.evidence), { ...other.env, FAKE_NEW_REF: NEW_REF, FAKE_LOG_FLOOD: '10' });
    assert.equal(none.status, 2, none.stderr);
    assert.match(none.stderr, /no auth\.slot_summary line/);
});

const REHEARSE = path.join(ROOT, 'ops', 'hostinger', 'cutover', 'rehearse-checks.sh');
function rehearse(ctx, args = [], extra = {}) {
    const result = spawnSync(BASH, [bashPath(REHEARSE), ...args], {
        encoding: 'utf8', timeout: 120000,
        env: { ...process.env, R3D_COMPOSE_ENV: bashPath(ctx.tree.composeFile), R3D_CONTROL_DIR: bashPath(ctx.tree.control),
            R3D_DYNAMIC_DIR: bashPath(ctx.tree.dynamic), ...ctx.env, R3D_PROJECT: '', R3D_CONTAINER: '', ...extra }
    });
    for (const value of Object.values(SECRETS)) {
        assert.equal(`${result.stdout}${result.stderr}`.includes(value), false, 'a key value was printed');
    }
    return result;
}

test('rehearse-checks.sh runs deploy-390.sh\'s own checks on real-shaped answers and writes only its own dir', { skip }, (t) => {
    const ctx = executeTree(t);
    const before = ctx.snapshot();
    const controlBefore = fs.readdirSync(ctx.tree.control).sort();
    const out = path.join(ctx.tree.root, 'rehearsal');
    const result = rehearse(ctx, ['--out', bashPath(out)], { FAKE_LOG_LINE: SLOT_SUMMARY });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    for (const label of [/PASS tuning/, /PASS catalogue/, /PASS control slice cube/, /PASS control slice block/, /PASS ready/, /PASS log/]) {
        assert.match(result.stdout, label);
    }
    assert.match(result.stdout, /rehearsal PASS/);
    assert.deepEqual(ctx.snapshot(), before, 'no env file written');
    assert.deepEqual(fs.readdirSync(ctx.tree.control).sort(), controlBefore, 'the capture is only read');
    const calls = fs.readFileSync(path.join(ctx.state, 'calls'), 'utf8');
    assert.doesNotMatch(calls, /^(?:compose|pull|image tag|kill|rm|stop|restart)\b/m, 'nothing pulled, restarted or tagged');
    assert.doesNotMatch(calls, /^exec -i 3d-psa-backend-server /m, 'the live container gets no request');
    assert.match(calls, /^exec -i r3d-s390-private /m);
});

test('rehearse-checks.sh reports a changed identity and refuses the live container as the private one', { skip }, (t) => {
    const ctx = executeTree(t);
    fs.writeFileSync(path.join(ctx.state, 'slice-block.json'), JSON.stringify(realAnswer('block', { id: 'private' },
        { 'technical_receipt.engine.build_sha256': 'another-engine' })));
    const result = rehearse(ctx, ['--out', bashPath(path.join(ctx.tree.root, 'rehearsal')), '--skip-ready'], { FAKE_LOG_LINE: SLOT_SUMMARY });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /identity field technical_receipt\.engine differs/);
    assert.match(result.stderr, /FAIL control slice block/);
    assert.match(result.stdout, /PASS control slice cube/);
    assert.match(result.stdout, /PASS tuning/);
    const live = rehearse(ctx, ['--private', '3d-psa-backend-server']);
    assert.equal(live.status, 1);
    assert.match(live.stderr, /never 3d-psa-backend-server/);
});

test('post-checks: a changed identity field in a real-shaped answer rolls back on an idle queue', { skip }, (t) => {
    const ctx = executeTree(t);
    fs.writeFileSync(path.join(ctx.state, 'slice-block.json'), JSON.stringify(realAnswer('block', { id: 'block-after', retention: 3600 },
        { 'technical_receipt.profiles.effective_profile_sha256': 'another-profile' })));
    const result = runScript(ctx.tree, deployArgs(ctx.evidence), { ...ctx.env, FAKE_NEW_REF: NEW_REF, FAKE_LOG_LINE: SLOT_SUMMARY });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /identity field technical_receipt\.profiles differs/);
    assert.match(result.stderr, /the queue is idle: automatic rollback/);
    assert.match(result.stdout, /rollback PASS/);
});
