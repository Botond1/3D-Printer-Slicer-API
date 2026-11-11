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
    const service = {
        NODE_ENV: 'production', PORT: '3000', TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '172.18.0.2/32',
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
