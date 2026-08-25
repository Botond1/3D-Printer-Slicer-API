'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    BACKEND_URL,
    CAPACITY_PRODUCER_EXEC,
    DISABLED_HOST,
    PACK_ROOT,
    TRAEFIK_COMMANDS,
    TRAEFIK_HEALTHCHECK,
    TRAEFIK_IMAGE,
    TRAEFIK_INGRESS_NETWORK_BLOCK,
    TRAEFIK_PRIVATE_NETWORK_BLOCK,
    TRAEFIK_SERVICE_NETWORKS_BLOCK,
    activateRouter,
    disableRouter,
    loadOperatorPack,
    validateActiveRouter,
    validateActiveDynamicDirectory,
    validateCapacityProducerSource,
    validateDarkDynamicDirectory,
    validateOperatorPack,
    validateRouterSource,
    validComposeVersion
} = require('../../../scripts/i12-hostinger-operator-contract');

const ROOT = path.resolve(__dirname, '../../..');

function createActiveRouterFixture(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dynamic = path.join(root, 'dynamic');
    const retainedParent = path.join(root, 'rollback');
    fs.mkdirSync(dynamic);
    fs.mkdirSync(retainedParent);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    const hostname = 'slicer.example.test';
    const source = loadOperatorPack().routerTemplate.replaceAll(DISABLED_HOST, hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const live = path.join(dynamic, 'slicer-api.yml');
    const retained = path.join(retainedParent, 'slicer-api.yml.disabled');
    fs.writeFileSync(live, source, { encoding: 'utf8', flag: 'wx' });
    return { digest, dynamic, hostname, live, retained, retainedParent, root };
}

test('committed Hostinger pack satisfies the bounded operator contract', () => {
    const sources = loadOperatorPack();
    assert.equal(validateOperatorPack(sources), null);
    assert.equal(validateCapacityProducerSource(sources.capacityProducerExec), null);
    assert.match(sources.compose, new RegExp(TRAEFIK_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal((sources.compose.match(/^      - --/gm) || []).length, TRAEFIK_COMMANDS.length);
    assert.doesNotMatch(sources.compose, /providers\.docker|docker\.sock/);
    assert.match(sources.compose, /--providers\.file=true/);
    assert.match(sources.compose, /--entryPoints\.web\.http\.redirections\.entryPoint\.to=websecure/);
    assert.match(sources.compose, /--certificatesResolvers\.letsencrypt\.acme\.storage=\/letsencrypt\/acme\.json/);
    assert.equal(sources.compose.split('\n').filter((line) => line === TRAEFIK_HEALTHCHECK).length, 1);
    assert.equal(sources.compose.split(TRAEFIK_SERVICE_NETWORKS_BLOCK).length - 1, 1);
    assert.equal(sources.compose.split(TRAEFIK_INGRESS_NETWORK_BLOCK).length - 1, 1);
    assert.equal(sources.compose.split(TRAEFIK_PRIVATE_NETWORK_BLOCK).length - 1, 1);
    assert.equal((sources.compose.match(/^        gw_priority: [01]$/gm) || []).length, 2);
    assert.match(sources.compose, /slicer-api-private:[\s\S]+external: true/);
    assert.match(sources.compose, /TRAEFIK_ACME_VOLUME[\s\S]+external: true/);
    assert.match(sources.runbook, /STOP_EXISTING_PROXY_PARITY_UNPROVEN/);
    assert.match(sources.runbook, /stopped-old rollback retention/);
    assert.match(sources.runbook, /STOP_CLEANUP_CONSUMER_UNAVAILABLE/);
    assert.match(sources.runbook, /scripts\/i12-capacity-artifact-cleanup\.js/);
    assert.match(sources.runbook, /scripts\/i12-capacity-producer-exec\.py/);
    assert.doesNotMatch(
        sources.runbook,
        /(?:SLICER_BASE_URL|SLICE_SERVICE_API_KEY|OPERATIONS_API_KEY|ARTIFACT_API_KEY)="\$/
    );
    assert.match(sources.capacityProducerExec, /runtime\.execve\(PYTHON_EXECUTABLE/);
    assert.equal(fs.existsSync(path.join(ROOT, CAPACITY_PRODUCER_EXEC)), true);
    assert.match(sources.runbook, /\/run\/i12-capacity-artifact-cleanup\.js/);
    assert.match(sources.runbook, /--expected-max-concurrent[\s\S]+--cleanup-manifest/);
    assert.match(sources.runbook, /Run the consumer even when the qualification runner exits nonzero/);
    assert.match(sources.runbook, /Compose `2\.33\.1` or newer/);
    assert.match(sources.runbook, /non-internal `traefik-ingress`/);
    assert.match(sources.runbook, /actual default\nroute uses `traefik-ingress`/);
    assert.match(sources.runbook, /effective `RW=false`/);
    assert.match(sources.runbook, /`Mode=""` or `Mode="ro"`/);
    assert.match(sources.runbook, /API-image source commit[\s\S]+operator-pack source commit/);
    assert.equal(fs.existsSync(path.join(PACK_ROOT, 'traefik.yml')), false);
});

test('router is inert by default and uses only the exact private backend', () => {
    const sources = loadOperatorPack();
    assert.equal(validateRouterSource(sources.routerTemplate), null);
    assert.equal((sources.routerTemplate.match(new RegExp(BACKEND_URL, 'g')) || []).length, 1);
    assert.match(sources.routerTemplate, new RegExp(`Host\\(\\\`${DISABLED_HOST}\\\`\\)`));
    assert.match(sources.routerTemplate, /certResolver: letsencrypt/);
    assert.deepEqual(fs.readdirSync(path.join(PACK_ROOT, 'dynamic')), ['.gitkeep']);
    assert.ok(!path.resolve(PACK_ROOT, 'templates', 'slicer-api-router.yml.disabled')
        .startsWith(`${path.resolve(PACK_ROOT, 'dynamic')}${path.sep}`));
});

test('dark dynamic directory rejects stale routers and sentinel drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-dark-dynamic-'));
    const dynamic = path.join(root, 'dynamic');
    fs.mkdirSync(dynamic);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    try {
        assert.equal(validateDarkDynamicDirectory(root), null);
        fs.writeFileSync(path.join(dynamic, 'stale-router.yml'), 'http: {}\n', { flag: 'wx' });
        assert.equal(validateDarkDynamicDirectory(root), 'traefik_dark_router_residue');
        fs.unlinkSync(path.join(dynamic, 'stale-router.yml'));
        fs.writeFileSync(path.join(dynamic, '.gitkeep'), 'drift\n');
        assert.equal(validateDarkDynamicDirectory(root), 'traefik_dynamic_sentinel_invalid');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('active router validation binds rendered bytes, hostname, hash, and staging boundary', () => {
    const hostname = 'slicer.example.test';
    const source = loadOperatorPack().routerTemplate.replaceAll(DISABLED_HOST, hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const staging = fs.mkdtempSync(path.join(PACK_ROOT, '.i12-contract-'));
    const target = path.join(staging, 'slicer-api.yml.tmp');
    try {
        fs.writeFileSync(target, source, { encoding: 'utf8', flag: 'wx' });
        assert.equal(validateActiveRouter(target, hostname, digest), null);
        assert.equal(validateActiveRouter(target, hostname, '0'.repeat(64)), 'active_router_hash_mismatch');
        assert.equal(validateActiveRouter(target, 'other.example.test', digest), 'traefik_router_identity_mismatch');
        assert.equal(
            validateActiveRouter(path.join(PACK_ROOT, 'dynamic', 'slicer-api.yml'), hostname, digest),
            'active_router_path_invalid'
        );
        assert.equal(
            validateActiveRouter(path.join(ROOT, 'docker-compose.production.yml'), hostname, digest),
            'active_router_path_invalid'
        );
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
});

test('router helper activates and disables through exact no-clobber identities', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-router-mutation-'));
    const dynamic = path.join(root, 'dynamic');
    const staging = path.join(root, 'staging');
    const rollback = path.join(root, 'rollback');
    fs.mkdirSync(dynamic);
    fs.mkdirSync(staging);
    fs.mkdirSync(rollback);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    const hostname = 'slicer.example.test';
    const source = loadOperatorPack().routerTemplate.replaceAll(DISABLED_HOST, hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const staged = path.join(staging, 'slicer-api.yml.tmp');
    const retained = path.join(rollback, 'slicer-api.yml.disabled');
    fs.writeFileSync(staged, source, { encoding: 'utf8', flag: 'wx' });
    const options = { packRoot: root, platform: 'linux', fsync: () => {} };
    try {
        assert.equal(activateRouter(staged, hostname, digest, options), null);
        assert.equal(fs.existsSync(staged), false);
        assert.equal(validateActiveDynamicDirectory(hostname, digest, root), null);
        assert.equal(activateRouter(staged, hostname, digest, options), 'traefik_dark_router_residue');

        assert.equal(disableRouter(retained, hostname, digest, options), null);
        assert.equal(validateDarkDynamicDirectory(root), null);
        assert.equal(fs.readFileSync(retained, 'utf8'), source);
        assert.equal(disableRouter(retained, hostname, digest, options), 'traefik_active_router_set_invalid');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('activation fsync failure rolls back the exact live identity and proves dark state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-router-activation-rollback-'));
    const dynamic = path.join(root, 'dynamic');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(dynamic);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    const hostname = 'slicer.example.test';
    const source = loadOperatorPack().routerTemplate.replaceAll(DISABLED_HOST, hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const staged = path.join(staging, 'slicer-api.yml.tmp');
    const live = path.join(dynamic, 'slicer-api.yml');
    fs.writeFileSync(staged, source, { encoding: 'utf8', flag: 'wx' });
    const fsyncTargets = [];
    const options = {
        packRoot: root,
        platform: 'linux',
        fsync: (target) => {
            fsyncTargets.push(path.resolve(target));
            if (fsyncTargets.length === 1) throw new Error('injected_activation_fsync_failure');
        }
    };
    try {
        assert.equal(
            activateRouter(staged, hostname, digest, options),
            'active_router_activation_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [path.resolve(live), path.resolve(dynamic)]);
        assert.equal(fs.existsSync(live), false);
        assert.equal(fs.existsSync(staged), true);
        assert.equal(validateDarkDynamicDirectory(root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('late staging fsync failure still rolls the live route back to exact dark state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-router-activation-late-rollback-'));
    const dynamic = path.join(root, 'dynamic');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(dynamic);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    const hostname = 'slicer.example.test';
    const source = loadOperatorPack().routerTemplate.replaceAll(DISABLED_HOST, hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const staged = path.join(staging, 'slicer-api.yml.tmp');
    const live = path.join(dynamic, 'slicer-api.yml');
    fs.writeFileSync(staged, source, { encoding: 'utf8', flag: 'wx' });
    const fsyncTargets = [];
    const options = {
        packRoot: root,
        platform: 'linux',
        fsync: (target) => {
            const resolved = path.resolve(target);
            fsyncTargets.push(resolved);
            if (resolved === path.resolve(staging)) throw new Error('injected_staging_fsync_failure');
        }
    };
    try {
        assert.equal(
            activateRouter(staged, hostname, digest, options),
            'active_router_activation_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(live), path.resolve(dynamic), path.resolve(staging), path.resolve(dynamic)
        ]);
        assert.equal(fs.existsSync(live), false);
        assert.equal(fs.existsSync(staged), false);
        assert.equal(validateDarkDynamicDirectory(root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('activation reports bounded uncertainty when rollback fsync cannot be proven', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-router-activation-uncertain-'));
    const dynamic = path.join(root, 'dynamic');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(dynamic);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    const hostname = 'slicer.example.test';
    const source = loadOperatorPack().routerTemplate.replaceAll(DISABLED_HOST, hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const staged = path.join(staging, 'slicer-api.yml.tmp');
    const live = path.join(dynamic, 'slicer-api.yml');
    fs.writeFileSync(staged, source, { encoding: 'utf8', flag: 'wx' });
    const fsyncTargets = [];
    const options = {
        packRoot: root,
        platform: 'linux',
        fsync: (target) => {
            fsyncTargets.push(path.resolve(target));
            throw new Error('injected_unprovable_fsync_failure');
        }
    };
    try {
        assert.equal(
            activateRouter(staged, hostname, digest, options),
            'active_router_activation_rollback_uncertain'
        );
        assert.deepEqual(fsyncTargets, [path.resolve(live), path.resolve(dynamic)]);
        assert.equal(fs.existsSync(live), false);
        assert.equal(fs.existsSync(staged), true);
        assert.equal(validateDarkDynamicDirectory(root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('disable early fsync failure removes only the retained identity and preserves the live route', () => {
    const fixture = createActiveRouterFixture('i12-router-disable-early-rollback-');
    const fsyncTargets = [];
    const options = {
        packRoot: fixture.root,
        platform: 'linux',
        fsync: (target) => {
            fsyncTargets.push(path.resolve(target));
            if (fsyncTargets.length === 1) throw new Error('injected_retained_fsync_failure');
        }
    };
    try {
        assert.equal(
            disableRouter(fixture.retained, fixture.hostname, fixture.digest, options),
            'retained_router_prepare_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(fixture.retained), path.resolve(fixture.retainedParent)
        ]);
        assert.equal(fs.existsSync(fixture.retained), false);
        assert.equal(
            validateActiveDynamicDirectory(fixture.hostname, fixture.digest, fixture.root),
            null
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('disable late parent fsync failure rolls preparation back before live unlink', () => {
    const fixture = createActiveRouterFixture('i12-router-disable-late-rollback-');
    const fsyncTargets = [];
    let injected = false;
    const options = {
        packRoot: fixture.root,
        platform: 'linux',
        fsync: (target) => {
            const resolved = path.resolve(target);
            fsyncTargets.push(resolved);
            if (!injected && resolved === path.resolve(fixture.retainedParent)) {
                injected = true;
                throw new Error('injected_retained_parent_fsync_failure');
            }
        }
    };
    try {
        assert.equal(
            disableRouter(fixture.retained, fixture.hostname, fixture.digest, options),
            'retained_router_prepare_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(fixture.retained), path.resolve(fixture.retainedParent),
            path.resolve(fixture.retainedParent)
        ]);
        assert.equal(fs.existsSync(fixture.retained), false);
        assert.equal(
            validateActiveDynamicDirectory(fixture.hostname, fixture.digest, fixture.root),
            null
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('disable reports bounded uncertainty when retained rollback fsync cannot be proven', () => {
    const fixture = createActiveRouterFixture('i12-router-disable-uncertain-');
    const fsyncTargets = [];
    const options = {
        packRoot: fixture.root,
        platform: 'linux',
        fsync: (target) => {
            fsyncTargets.push(path.resolve(target));
            throw new Error('injected_retained_rollback_fsync_failure');
        }
    };
    try {
        assert.equal(
            disableRouter(fixture.retained, fixture.hostname, fixture.digest, options),
            'retained_router_prepare_rollback_uncertain'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(fixture.retained), path.resolve(fixture.retainedParent)
        ]);
        assert.equal(fs.existsSync(fixture.retained), false);
        assert.equal(
            validateActiveDynamicDirectory(fixture.hostname, fixture.digest, fixture.root),
            null
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('operator contract CLI reports only the bounded PASS classification', () => {
    const result = spawnSync(process.execPath, ['scripts/i12-hostinger-operator-contract.js'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'i12_hostinger_operator_contract=PASS');
    assert.equal(result.stderr, '');
});

test('Compose version gate accepts only canonical versions at or above 2.33.1', () => {
    for (const version of ['2.33.1', '2.33.2', '2.34.0', '3.0.0', '5.1.4']) {
        assert.equal(validComposeVersion(version), true, version);
    }
    for (const version of ['', '2.33.0', '2.32.99', '1.99.99', '02.33.1', '2.033.1',
        '2.33.01', '2.33', '2.33.1-rc1', 'v2.33.1', '5.1.4\n']) {
        assert.equal(validComposeVersion(version), false, JSON.stringify(version));
    }
    const pass = spawnSync(process.execPath, [
        'scripts/i12-hostinger-operator-contract.js', '--check-compose-version', '5.1.4'
    ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(pass.stdout.trim(), 'compose_version_contract=PASS');
    assert.equal(pass.stderr, '');
    const reject = spawnSync(process.execPath, [
        'scripts/i12-hostinger-operator-contract.js', '--check-compose-version', '2.33.0'
    ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(reject.status, 2);
    assert.equal(reject.stdout, '');
    assert.equal(reject.stderr.trim(), 'compose_version_unsupported');
});
