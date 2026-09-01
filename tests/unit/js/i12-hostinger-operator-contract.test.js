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
    PRIVATE_ROLLBACK_DIRECTORY,
    PRIVATE_RUNTIME_DIRECTORY,
    PRIVATE_RUNTIME_IGNORE_PATTERN,
    PRIVATE_STAGING_DIRECTORY,
    ACTIVE_ROUTER_IGNORE_PATTERN,
    TRAEFIK_COMMANDS,
    TRAEFIK_HEALTHCHECK,
    TRAEFIK_IMAGE,
    TRAEFIK_INGRESS_NETWORK_BLOCK,
    TRAEFIK_PRIVATE_NETWORK_BLOCK,
    TRAEFIK_SERVICE_NETWORKS_BLOCK,
    activateRouter,
    assertRouterDark,
    disableRouter,
    loadOperatorPack,
    recoverRouterDark,
    renderRouterSource,
    validateActiveRouter,
    validateActiveDynamicDirectory,
    validateCapacityProducerSource,
    validateDarkDynamicDirectory,
    validateOperatorPack,
    validateRouterSource,
    validComposeVersion
} = require('../../../scripts/i12-hostinger-operator-contract');

const ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_CIDRS = Object.freeze(['192.0.2.10/32']);

function activeRouterSource(hostname) {
    const rendered = renderRouterSource(loadOperatorPack().routerTemplate, hostname, SAMPLE_CIDRS);
    assert.equal(rendered.error, null);
    return rendered.source;
}

function metadataView(stat, overrides) {
    return new Proxy(stat, {
        get(target, property) {
            if (Object.prototype.hasOwnProperty.call(overrides, property)) {
                return overrides[property];
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

function withRootRouterMetadata(
    fixture, callback, drift = () => ({}), descriptorDrift = () => ({})
) {
    const originalLstatSync = fs.lstatSync;
    const originalFstatSync = fs.fstatSync;
    const parentPaths = [
        fixture.runtimeRoot, fixture.staging, fixture.retainedParent, fixture.dynamic
    ]
        .filter(Boolean).map((target) => path.resolve(target));
    const filePaths = [
        fixture.staged, fixture.live, fixture.retained,
        fixture.dynamic && path.join(fixture.dynamic, '.gitkeep')
    ]
        .filter(Boolean).map((target) => path.resolve(target));
    fs.lstatSync = function patchedLstatSync(target, ...args) {
        const stat = originalLstatSync.call(fs, target, ...args);
        const resolved = path.resolve(target);
        if (parentPaths.includes(resolved)) {
            return metadataView(stat, {
                uid: 0, gid: 0, mode: 0o700, ...drift(resolved, 'parent')
            });
        }
        if (filePaths.includes(resolved)) {
            return metadataView(stat, {
                uid: 0, gid: 0, mode: 0o600, ...drift(resolved, 'file')
            });
        }
        return stat;
    };
    fs.fstatSync = function patchedFstatSync(descriptor, ...args) {
        const stat = originalFstatSync.call(fs, descriptor, ...args);
        return metadataView(stat, {
            uid: 0, gid: 0, mode: 0o600, ...descriptorDrift(stat)
        });
    };
    try { return callback(); } finally {
        fs.lstatSync = originalLstatSync;
        fs.fstatSync = originalFstatSync;
    }
}

function createRouterRepository(prefix) {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const packRoot = path.join(repositoryRoot, 'ops', 'hostinger');
    const dynamic = path.join(packRoot, 'dynamic');
    const runtimeRoot = path.join(packRoot, PRIVATE_RUNTIME_DIRECTORY);
    const staging = path.join(runtimeRoot, PRIVATE_STAGING_DIRECTORY);
    const retainedParent = path.join(runtimeRoot, PRIVATE_ROLLBACK_DIRECTORY);
    fs.mkdirSync(dynamic, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(retainedParent, { recursive: true });
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    fs.writeFileSync(
        path.join(repositoryRoot, '.gitignore'),
        `${PRIVATE_RUNTIME_IGNORE_PATTERN}\n${ACTIVE_ROUTER_IGNORE_PATTERN}\n`,
        { encoding: 'utf8', flag: 'wx' }
    );
    for (const args of [
        ['init', '--quiet'],
        ['add', '--', '.gitignore', 'ops/hostinger/dynamic/.gitkeep'],
        [
            '-c', 'user.name=J2 Fixture', '-c', 'user.email=j2-fixture@example.invalid',
            'commit', '--quiet', '-m', 'fixture'
        ]
    ]) {
        const result = spawnSync('git', args, {
            cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000, windowsHide: true
        });
        assert.equal(result.status, 0, result.stderr);
    }
    return {
        cleanupRoot: repositoryRoot, dynamic, packRoot, retainedParent,
        root: packRoot, runtimeRoot, staging
    };
}

function createActiveRouterFixture(prefix) {
    const fixture = createRouterRepository(prefix);
    const { dynamic, retainedParent, root } = fixture;
    const hostname = 'slicer.example.test';
    const source = activeRouterSource(hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const live = path.join(dynamic, 'slicer-api.yml');
    const retained = path.join(retainedParent, 'slicer-api-contract.yml.disabled');
    fs.writeFileSync(live, source, { encoding: 'utf8', flag: 'wx' });
    return { ...fixture, digest, hostname, live, retained, root, source };
}

function createDarkRouterFixture(prefix) {
    const fixture = createRouterRepository(prefix);
    const { dynamic, root, staging } = fixture;
    const hostname = 'slicer.example.test';
    const source = activeRouterSource(hostname);
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const staged = path.join(staging, 'slicer-api-contract.yml.tmp');
    const live = path.join(dynamic, 'slicer-api.yml');
    fs.writeFileSync(staged, source, { encoding: 'utf8', flag: 'wx' });
    return { ...fixture, digest, hostname, live, root, source, staged };
}

test('committed Hostinger pack satisfies the bounded operator contract', () => {
    const sources = loadOperatorPack();
    assert.equal(validateOperatorPack(sources), null);
    assert.equal(validateCapacityProducerSource(sources.capacityProducerExec), null);
    assert.match(sources.compose, new RegExp(TRAEFIK_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal((sources.compose.match(/^      - --/gm) || []).length, TRAEFIK_COMMANDS.length);
    assert.doesNotMatch(sources.compose, /providers\.docker|docker\.sock/);
    assert.match(sources.compose, /--providers\.file=true/);
    assert.match(sources.compose, /--entryPoints\.web\.http\.redirections\.entryPoint\.to=:443/);
    assert.doesNotMatch(
        sources.compose,
        /--entryPoints\.web\.http\.redirections\.entryPoint\.to=(?:websecure|:8443)/
    );
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
    assert.match(sources.runbook, /exactly one unique IPv4 `\/32` line/);
    assert.match(sources.runbook, /Only phase `leadpilot-only` exists/);
    assert.match(sources.runbook, /machine-level perimeter control/);
    assert.match(sources.runbook, /no verified provider reservation/);
    assert.match(sources.runbook, /consumer must notify the owner before any rebuild or migration/);
    assert.match(sources.runbook, /--check-live-dynamic-source "\$live_dynamic_source"/);
    assert.match(sources.runbook, /STOP_LIVE_DYNAMIC_RELEASE_MISMATCH/);
    assert.match(sources.runbook, /Published Docker ports can bypass UFW/);
    assert.match(sources.runbook, /second hostname is therefore a\nstop/);
    assert.match(sources.runbook, /API-image source commit[\s\S]+operator-pack source commit/);
    assert.equal(fs.existsSync(path.join(PACK_ROOT, 'traefik.yml')), false);
});

test('router is inert by default and uses only the exact private backend', () => {
    const sources = loadOperatorPack();
    assert.equal(validateRouterSource(sources.routerTemplate), null);
    assert.equal((sources.routerTemplate.match(new RegExp(BACKEND_URL, 'g')) || []).length, 1);
    assert.match(sources.routerTemplate, new RegExp(`Host\\(\\\`${DISABLED_HOST}\\\`\\)`));
    assert.match(sources.routerTemplate, /certResolver: letsencrypt/);
    assert.equal((sources.routerTemplate.match(/ipAllowList:/g) || []).length, 1);
    assert.match(sources.routerTemplate, /sourceRange:\n          - "__J2_SOURCE_RANGE__"/);
    assert.doesNotMatch(sources.routerTemplate, /ipWhiteList|ipStrategy|forwardedHeaders/);
    assert.deepEqual(fs.readdirSync(path.join(PACK_ROOT, 'dynamic')), ['.gitkeep']);
    assert.ok(!path.resolve(PACK_ROOT, 'templates', 'slicer-api-router.yml.disabled')
        .startsWith(`${path.resolve(PACK_ROOT, 'dynamic')}${path.sep}`));
});

test('dark dynamic directory rejects stale routers and sentinel drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-dark-dynamic-'));
    const dynamic = path.join(root, 'dynamic');
    fs.mkdirSync(dynamic);
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    const fixture = { dynamic };
    try {
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(root)
        ), null);
        fs.writeFileSync(path.join(dynamic, 'stale-router.yml'), 'http: {}\n', { flag: 'wx' });
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(root)
        ), 'traefik_dark_router_residue');
        fs.unlinkSync(path.join(dynamic, 'stale-router.yml'));
        fs.writeFileSync(path.join(dynamic, '.gitkeep'), 'drift\n');
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(root)
        ), 'traefik_dynamic_sentinel_invalid');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('dynamic root and sentinel owner, mode, link, and swap mutations fail closed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-dynamic-metadata-'));
    const dynamic = path.join(root, 'dynamic');
    const sentinel = path.join(dynamic, '.gitkeep');
    fs.mkdirSync(dynamic);
    fs.writeFileSync(sentinel, '\n', { flag: 'wx' });
    const fixture = { dynamic };
    const cases = [
        ['dynamic uid', dynamic, 'uid', 1000, 'traefik_dynamic_directory_unsafe'],
        ['dynamic gid', dynamic, 'gid', 1000, 'traefik_dynamic_directory_unsafe'],
        ['dynamic mode', dynamic, 'mode', 0o750, 'traefik_dynamic_directory_unsafe'],
        ['sentinel uid', sentinel, 'uid', 1000, 'traefik_dynamic_sentinel_invalid'],
        ['sentinel gid', sentinel, 'gid', 1000, 'traefik_dynamic_sentinel_invalid'],
        ['sentinel mode', sentinel, 'mode', 0o640, 'traefik_dynamic_sentinel_invalid'],
        ['sentinel nlink', sentinel, 'nlink', 2, 'traefik_dynamic_sentinel_invalid']
    ];
    try {
        for (const [name, target, property, value, expected] of cases) {
            assert.equal(withRootRouterMetadata(
                fixture,
                () => validateDarkDynamicDirectory(root),
                (candidate) => candidate === path.resolve(target) ? { [property]: value } : {}
            ), expected, name);
        }
        for (const [name, target] of [['dynamic swap', dynamic], ['sentinel swap', sentinel]]) {
            let observations = 0;
            assert.equal(withRootRouterMetadata(
                fixture,
                () => validateDarkDynamicDirectory(root),
                (candidate) => candidate === path.resolve(target)
                    ? { ino: 10_000 + ++observations } : {}
            ), 'traefik_dynamic_state_changed', name);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('exported dynamic validators cannot opt out of the root metadata invariant', () => {
    const dark = createDarkRouterFixture('i12-dark-policy-bypass-');
    const active = createActiveRouterFixture('i12-active-policy-bypass-');
    const weakPolicy = { requireRootMetadata: false, metadataPolicy: {
        fileUid: 1000, fileGid: 1000, fileMode: 0o666,
        parentUid: 1000, parentGid: 1000, parentMode: 0o777
    } };
    try {
        assert.equal(withRootRouterMetadata(
            dark,
            () => validateDarkDynamicDirectory(dark.root, weakPolicy),
            (target, kind) => kind === 'parent' && target === path.resolve(dark.dynamic)
                ? { uid: 1000, gid: 1000, mode: 0o777 } : {}
        ), 'traefik_dynamic_directory_unsafe');
        assert.equal(withRootRouterMetadata(
            active,
            () => validateActiveDynamicDirectory(
                active.hostname, active.digest, active.root, null, 1, weakPolicy
            ),
            (target, kind) => kind === 'file' && target === path.resolve(active.live)
                ? { uid: 1000, gid: 1000, mode: 0o666 } : {}
        ), 'traefik_active_router_metadata_unsafe');
    } finally {
        fs.rmSync(dark.cleanupRoot, { recursive: true, force: true });
        fs.rmSync(active.cleanupRoot, { recursive: true, force: true });
    }
});

test('active router validation binds rendered bytes, hostname, hash, and staging boundary', () => {
    const fixture = createDarkRouterFixture('i12-active-router-validation-');
    try {
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveRouter(
            fixture.staged, fixture.hostname, fixture.digest, fixture.root
        )), null);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveRouter(
            fixture.staged, fixture.hostname, '0'.repeat(64), fixture.root
        )), 'active_router_hash_mismatch');
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveRouter(
            fixture.staged, 'other.example.test', fixture.digest, fixture.root
        )), 'traefik_router_identity_mismatch');
        assert.equal(
            validateActiveRouter(
                path.join(fixture.root, 'dynamic', 'slicer-api.yml'),
                fixture.hostname, fixture.digest, fixture.root
            ),
            'active_router_path_invalid'
        );
        assert.equal(
            validateActiveRouter(
                path.join(fixture.root, 'docker-compose.production.yml'),
                fixture.hostname, fixture.digest, fixture.root
            ),
            'active_router_path_invalid'
        );
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('private router validation re-proves the final pathname identity after descriptor read', () => {
    const fixture = createDarkRouterFixture('i12-private-final-path-identity-');
    let targetStats = 0;
    try {
        assert.equal(withRootRouterMetadata(
            fixture,
            () => validateActiveRouter(
                fixture.staged, fixture.hostname, fixture.digest, fixture.root
            ),
            (target, kind) => {
                if (kind !== 'file' || target !== path.resolve(fixture.staged)) return {};
                targetStats += 1;
                return targetStats === 3 ? { ino: 90_003 } : {};
            }
        ), 'active_router_file_changed');
        assert.equal(targetStats, 3);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('active dynamic validation binds the descriptor-read inode to both directory snapshots', () => {
    const fixture = createActiveRouterFixture('i12-active-descriptor-path-identity-');
    let liveStats = 0;
    try {
        assert.equal(withRootRouterMetadata(
            fixture,
            () => validateActiveDynamicDirectory(
                fixture.hostname, fixture.digest, fixture.root
            ),
            (target, kind) => {
                if (kind !== 'file' || target !== path.resolve(fixture.live)) return {};
                liveStats += 1;
                return [2, 3].includes(liveStats) ? { ino: 90_004 } : {};
            },
            () => ({ ino: 90_004 })
        ), 'traefik_dynamic_state_changed');
        assert.equal(liveStats, 4);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('active router hashes exact descriptor bytes rather than decoded text aliases', () => {
    const fixture = createDarkRouterFixture('i12-active-raw-byte-hash-');
    const bytes = Buffer.concat([
        Buffer.from(fixture.source, 'utf8'),
        Buffer.from([0x23, 0x20, 0xc0, 0xaf, 0x0a])
    ]);
    const rawDigest = crypto.createHash('sha256').update(bytes).digest('hex');
    const decodedDigest = crypto.createHash('sha256')
        .update(bytes.toString('utf8'), 'utf8').digest('hex');
    try {
        fs.writeFileSync(fixture.staged, bytes);
        assert.notEqual(rawDigest, decodedDigest);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveRouter(
            fixture.staged, fixture.hostname, rawDigest, fixture.root
        )), null);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveRouter(
            fixture.staged, fixture.hostname, decodedDigest, fixture.root
        )), 'active_router_hash_mismatch');
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('router helper proves dark-active-dark retained-replay-active-dark identities', () => {
    const fixture = createDarkRouterFixture('i12-router-mutation-');
    fixture.retained = path.join(
        fixture.retainedParent, 'slicer-api-contract.yml.disabled'
    );
    const options = {
        expectedCidrs: SAMPLE_CIDRS,
        packRoot: fixture.root,
        platform: 'linux',
        fsync: () => {}
    };
    try {
        assert.equal(withRootRouterMetadata(
            fixture, () => activateRouter(
                fixture.staged, fixture.hostname, fixture.digest, options
            )
        ), null);
        assert.equal(fs.existsSync(fixture.staged), false);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateActiveDynamicDirectory(
                fixture.hostname, fixture.digest, fixture.root
            )
        ), null);
        assert.equal(withRootRouterMetadata(
            fixture, () => activateRouter(
                fixture.staged, fixture.hostname, fixture.digest, options
            )
        ), 'traefik_dark_router_residue');

        assert.equal(withRootRouterMetadata(
            fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, options
            )
        ), null);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(fixture.root)
        ), null);
        assert.equal(fs.readFileSync(fixture.retained, 'utf8'), activeRouterSource(fixture.hostname));
        const firstRetained = fixture.retained;
        assert.equal(withRootRouterMetadata(
            fixture, () => activateRouter(
                firstRetained, fixture.hostname, fixture.digest, options
            )
        ), null);
        assert.equal(fs.existsSync(firstRetained), false);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateActiveDynamicDirectory(
                fixture.hostname, fixture.digest, fixture.root
            )
        ), null);
        fixture.retained = path.join(
            fixture.retainedParent, 'slicer-api-contract-second.yml.disabled'
        );
        assert.equal(withRootRouterMetadata(
            fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, options
            )
        ), null);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(fixture.root)
        ), null);
        assert.equal(fs.readFileSync(fixture.retained, 'utf8'), fixture.source);
        assert.equal(withRootRouterMetadata(
            fixture, () => assertRouterDark(
                fixture.retained, 'rollback', fixture.hostname, options
            )
        ), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('known staging and rollback interrupted hardlink states recover only to exact dark', () => {
    const cases = [
        ['staging', () => {
            const fixture = createDarkRouterFixture('i12-recover-staging-');
            fs.linkSync(fixture.staged, fixture.live);
            return { ...fixture, sourceTarget: fixture.staged };
        }],
        ['rollback', () => {
            const fixture = createActiveRouterFixture('i12-recover-rollback-');
            fs.linkSync(fixture.live, fixture.retained);
            return { ...fixture, sourceTarget: fixture.retained };
        }]
    ];
    for (const [sourceKind, createFixture] of cases) {
        const fixture = createFixture();
        const options = {
            expectedCidrs: SAMPLE_CIDRS,
            packRoot: fixture.root,
            platform: 'linux',
            fsync: () => {}
        };
        try {
            assert.equal(fs.statSync(fixture.sourceTarget).nlink, 2, sourceKind);
            assert.equal(withRootRouterMetadata(
                fixture, () => recoverRouterDark(
                    fixture.sourceTarget, sourceKind, fixture.hostname, options
                )
            ), null, sourceKind);
            assert.equal(fs.existsSync(fixture.live), false, sourceKind);
            assert.equal(fs.statSync(fixture.sourceTarget).nlink, 1, sourceKind);
            assert.equal(fs.readFileSync(fixture.sourceTarget, 'utf8'), fixture.source, sourceKind);
            assert.equal(withRootRouterMetadata(
                fixture, () => validateDarkDynamicDirectory(fixture.root)
            ), null, sourceKind);
        } finally {
            fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
        }
    }
});

test('dark recovery never scans either private source directory', () => {
    const fixture = createDarkRouterFixture('i12-recover-no-directory-scan-');
    fs.linkSync(fixture.staged, fixture.live);
    const originalReaddirSync = fs.readdirSync;
    const forbidden = new Set([
        path.resolve(fixture.staging), path.resolve(fixture.retainedParent)
    ]);
    let privateReads = 0;
    let dynamicReads = 0;
    fs.readdirSync = function patchedReaddirSync(target, ...args) {
        const resolved = path.resolve(target);
        if (forbidden.has(resolved)) {
            privateReads += 1;
            throw new Error('private_router_directory_scan_forbidden');
        }
        if (resolved === path.resolve(fixture.dynamic)) dynamicReads += 1;
        return originalReaddirSync.call(fs, target, ...args);
    };
    try {
        assert.equal(withRootRouterMetadata(
            fixture, () => recoverRouterDark(
                fixture.staged, 'staging', fixture.hostname, {
                    expectedCidrs: SAMPLE_CIDRS,
                    packRoot: fixture.root,
                    platform: 'linux',
                    fsync: () => {}
                }
            )
        ), null);
        assert.equal(privateReads, 0);
        assert.ok(dynamicReads > 0);
        assert.equal(fs.existsSync(fixture.live), false);
    } finally {
        fs.readdirSync = originalReaddirSync;
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('dark recovery is idempotent for an exact single-link source and dark directory', () => {
    const fixture = createDarkRouterFixture('i12-recover-idempotent-');
    const options = {
        expectedCidrs: SAMPLE_CIDRS,
        packRoot: fixture.root,
        platform: 'linux',
        fsync: () => {}
    };
    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            assert.equal(withRootRouterMetadata(
                fixture, () => recoverRouterDark(
                    fixture.staged, 'staging', fixture.hostname, options
                )
            ), null, `attempt ${attempt + 1}`);
            assert.equal(fs.statSync(fixture.staged).nlink, 1);
            assert.equal(withRootRouterMetadata(
                fixture, () => validateDarkDynamicDirectory(fixture.root)
            ), null);
        }
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('every pre-unlink and post-unlink recovery fsync cutpoint resumes to dark', () => {
    const expectedFsyncOrder = ['source', 'parent', 'source', 'parent', 'dynamic'];
    for (let cutpoint = 0; cutpoint < expectedFsyncOrder.length; cutpoint += 1) {
        const fixture = createDarkRouterFixture(`i12-recover-cut-${cutpoint}-`);
        fs.linkSync(fixture.staged, fixture.live);
        const observed = [];
        let injected = false;
        const labels = new Map([
            [path.resolve(fixture.staged), 'source'],
            [path.resolve(fixture.staging), 'parent'],
            [path.resolve(fixture.dynamic), 'dynamic']
        ]);
        const options = {
            expectedCidrs: SAMPLE_CIDRS,
            packRoot: fixture.root,
            platform: 'linux',
            fsync: (target) => {
                observed.push(labels.get(path.resolve(target)) || 'unexpected');
                if (!injected && observed.length === cutpoint + 1) {
                    injected = true;
                    throw new Error(`injected_recovery_cutpoint_${cutpoint}`);
                }
            }
        };
        try {
            assert.equal(withRootRouterMetadata(
                fixture, () => recoverRouterDark(
                    fixture.staged, 'staging', fixture.hostname, options
                )
            ), 'router_dark_recovery_uncertain', `cutpoint ${cutpoint}`);
            assert.deepEqual(
                observed,
                expectedFsyncOrder.slice(0, cutpoint + 1),
                `cutpoint ${cutpoint}`
            );
            assert.equal(injected, true, `cutpoint ${cutpoint}`);
            if (cutpoint < 2) {
                assert.equal(fs.existsSync(fixture.live), true, `cutpoint ${cutpoint}`);
                assert.equal(fs.statSync(fixture.staged).nlink, 2, `cutpoint ${cutpoint}`);
            } else {
                assert.equal(fs.existsSync(fixture.live), false, `cutpoint ${cutpoint}`);
                assert.equal(fs.statSync(fixture.staged).nlink, 1, `cutpoint ${cutpoint}`);
            }
            assert.equal(withRootRouterMetadata(
                fixture, () => recoverRouterDark(
                    fixture.staged, 'staging', fixture.hostname, options
                )
            ), null, `retry ${cutpoint}`);
            assert.equal(fs.existsSync(fixture.live), false, `retry ${cutpoint}`);
            assert.equal(fs.statSync(fixture.staged).nlink, 1, `retry ${cutpoint}`);
            assert.equal(withRootRouterMetadata(
                fixture, () => validateDarkDynamicDirectory(fixture.root)
            ), null, `retry ${cutpoint}`);
        } finally {
            fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
        }
    }
});

test('consumed activation source is never guessed and normal exact disable reaches dark', () => {
    const fixture = createDarkRouterFixture('i12-recover-consumed-source-');
    fixture.retained = path.join(
        fixture.retainedParent, 'slicer-api-consumed-source.yml.disabled'
    );
    fs.linkSync(fixture.staged, fixture.live);
    fs.unlinkSync(fixture.staged);
    const options = {
        expectedCidrs: SAMPLE_CIDRS,
        packRoot: fixture.root,
        platform: 'linux',
        fsync: () => {}
    };
    try {
        assert.equal(withRootRouterMetadata(
            fixture, () => recoverRouterDark(
                fixture.staged, 'staging', fixture.hostname, options
            )
        ), 'router_dark_recovery_source_unavailable');
        assert.equal(fs.existsSync(fixture.live), true);
        assert.equal(fs.statSync(fixture.live).nlink, 1);
        assert.equal(withRootRouterMetadata(
            fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, options
            )
        ), null);
        assert.equal(fs.existsSync(fixture.live), false);
        assert.equal(fs.statSync(fixture.retained).nlink, 1);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(fixture.root)
        ), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('dark recovery rejects wrong kind, inode, link topology, and identity without scanning', () => {
    const wrongKind = createDarkRouterFixture('i12-recover-wrong-kind-');
    fs.linkSync(wrongKind.staged, wrongKind.live);
    try {
        assert.equal(withRootRouterMetadata(
            wrongKind, () => recoverRouterDark(
                wrongKind.staged, 'rollback', wrongKind.hostname, {
                    expectedCidrs: SAMPLE_CIDRS,
                    packRoot: wrongKind.root,
                    platform: 'linux',
                    fsync: () => {}
                }
            )
        ), 'router_dark_recovery_argument_invalid');
        assert.equal(fs.existsSync(wrongKind.live), true);
        assert.equal(fs.statSync(wrongKind.staged).nlink, 2);
    } finally {
        fs.rmSync(wrongKind.cleanupRoot, { recursive: true, force: true });
    }

    const noScan = createDarkRouterFixture('i12-recover-no-scan-');
    noScan.retained = path.join(
        noScan.retainedParent, 'slicer-api-other-source.yml.disabled'
    );
    fs.writeFileSync(noScan.live, noScan.source, { encoding: 'utf8', flag: 'wx' });
    fs.linkSync(noScan.live, noScan.retained);
    try {
        assert.equal(withRootRouterMetadata(
            noScan, () => recoverRouterDark(
                noScan.staged, 'staging', noScan.hostname, {
                    expectedCidrs: SAMPLE_CIDRS,
                    packRoot: noScan.root,
                    platform: 'linux',
                    fsync: () => {}
                }
            )
        ), 'router_dark_recovery_state_invalid');
        assert.notEqual(fs.statSync(noScan.staged).ino, fs.statSync(noScan.live).ino);
        assert.equal(fs.statSync(noScan.live).ino, fs.statSync(noScan.retained).ino);
        assert.equal(fs.statSync(noScan.live).nlink, 2);
    } finally {
        fs.rmSync(noScan.cleanupRoot, { recursive: true, force: true });
    }

    const linkThree = createDarkRouterFixture('i12-recover-link-three-');
    const extra = path.join(linkThree.staging, 'source-extra-hardlink');
    fs.linkSync(linkThree.staged, linkThree.live);
    fs.linkSync(linkThree.staged, extra);
    try {
        assert.equal(withRootRouterMetadata(
            linkThree, () => recoverRouterDark(
                linkThree.staged, 'staging', linkThree.hostname, {
                    expectedCidrs: SAMPLE_CIDRS,
                    packRoot: linkThree.root,
                    platform: 'linux',
                    fsync: () => {}
                }
            )
        ), 'router_staging_metadata_unsafe');
        assert.equal(fs.existsSync(linkThree.live), true);
        assert.equal(fs.statSync(linkThree.staged).nlink, 3);
    } finally {
        fs.rmSync(linkThree.cleanupRoot, { recursive: true, force: true });
    }

    const wrongIdentity = createDarkRouterFixture('i12-recover-wrong-identity-');
    fs.linkSync(wrongIdentity.staged, wrongIdentity.live);
    try {
        const options = {
            expectedCidrs: SAMPLE_CIDRS,
            packRoot: wrongIdentity.root,
            platform: 'linux',
            fsync: () => {}
        };
        assert.equal(withRootRouterMetadata(
            wrongIdentity, () => recoverRouterDark(
                wrongIdentity.staged, 'staging', 'other.example.test', options
            )
        ), 'traefik_router_identity_mismatch');
        assert.equal(withRootRouterMetadata(
            wrongIdentity, () => recoverRouterDark(
                wrongIdentity.staged, 'staging', wrongIdentity.hostname,
                { ...options, expectedCidrs: ['198.51.100.20/32'] }
            )
        ), 'traefik_allowlist_identity_mismatch');
        assert.equal(fs.existsSync(wrongIdentity.live), true);
        assert.equal(fs.statSync(wrongIdentity.staged).nlink, 2);
    } finally {
        fs.rmSync(wrongIdentity.cleanupRoot, { recursive: true, force: true });
    }
});

test('activation rejects staged owner, mode, parent, and link-count drift while remaining dark', () => {
    const cases = [
        ['file uid', 'file', 'uid', 1000],
        ['file gid', 'file', 'gid', 1000],
        ['file mode', 'file', 'mode', 0o640],
        ['parent uid', 'parent', 'uid', 1000],
        ['parent gid', 'parent', 'gid', 1000],
        ['parent mode', 'parent', 'mode', 0o750]
    ];
    for (const [name, kind, property, value] of cases) {
        const fixture = createDarkRouterFixture(`i12-router-metadata-${property}-`);
        try {
            const result = withRootRouterMetadata(fixture, () => activateRouter(
                fixture.staged, fixture.hostname, fixture.digest, {
                    packRoot: fixture.root, platform: 'linux', fsync: () => {}
                }
            ), (target, targetKind) => targetKind === kind
                && target === path.resolve(kind === 'file' ? fixture.staged : fixture.staging)
                ? { [property]: value } : {});
            assert.equal(result, 'router_staging_metadata_unsafe', name);
            assert.equal(withRootRouterMetadata(
                fixture, () => validateDarkDynamicDirectory(fixture.root)
            ), null, name);
            assert.equal(fs.existsSync(fixture.staged), true, name);
        } finally {
            fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
        }
    }

    const linkedFixture = createDarkRouterFixture('i12-router-metadata-nlink-');
    const foreignLink = path.join(linkedFixture.staging, 'foreign-link.yml');
    try {
        fs.linkSync(linkedFixture.staged, foreignLink);
        assert.equal(withRootRouterMetadata(linkedFixture, () => activateRouter(
            linkedFixture.staged, linkedFixture.hostname, linkedFixture.digest, {
                packRoot: linkedFixture.root, platform: 'linux', fsync: () => {}
            }
        )), 'router_staging_metadata_unsafe');
        assert.equal(withRootRouterMetadata(
            linkedFixture, () => validateDarkDynamicDirectory(linkedFixture.root)
        ), null);
    } finally {
        fs.rmSync(linkedFixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('activation reports uncertainty when linked-inode metadata changes before acceptance', () => {
    const fixture = createDarkRouterFixture('i12-router-linked-metadata-drift-');
    let mutated = false;
    try {
        assert.equal(withRootRouterMetadata(fixture, () => activateRouter(
            fixture.staged, fixture.hostname, fixture.digest, {
                packRoot: fixture.root,
                platform: 'linux',
                fsync: (target) => {
                    if (!mutated && path.resolve(target) === path.resolve(fixture.live)) {
                        mutated = true;
                    }
                }
            }
        ), (target, kind) => mutated && kind === 'file'
            && [path.resolve(fixture.staged), path.resolve(fixture.live)].includes(target)
            ? { mode: 0o640 } : {}),
        'active_router_activation_rollback_uncertain');
        assert.equal(mutated, true);
        assert.equal(fs.existsSync(fixture.live), true);
        assert.equal(fs.existsSync(fixture.staged), true);
        assert.equal(fs.statSync(fixture.live).ino, fs.statSync(fixture.staged).ino);
        assert.equal(fs.statSync(fixture.live).nlink, 2);
        assert.equal(withRootRouterMetadata(
            fixture,
            () => validateActiveDynamicDirectory(fixture.hostname, fixture.digest, fixture.root)
        ), 'traefik_active_router_metadata_unsafe');
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('activation fsync failure rolls back the exact live identity and proves dark state', () => {
    const fixture = createDarkRouterFixture('i12-router-activation-rollback-');
    const { digest, dynamic, hostname, live, root, staged, staging } = fixture;
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
            withRootRouterMetadata(
                fixture,
                () => activateRouter(staged, hostname, digest, options)
            ),
            'active_router_activation_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [path.resolve(live), path.resolve(dynamic)]);
        assert.equal(fs.existsSync(live), false);
        assert.equal(fs.existsSync(staged), true);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(root)
        ), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('late staging fsync failure still rolls the live route back to exact dark state', () => {
    const fixture = createDarkRouterFixture('i12-router-activation-late-rollback-');
    const { digest, dynamic, hostname, live, root, staged, staging } = fixture;
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
            withRootRouterMetadata(
                fixture,
                () => activateRouter(staged, hostname, digest, options)
            ),
            'active_router_activation_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(live), path.resolve(dynamic), path.resolve(live),
            path.resolve(staging), path.resolve(dynamic)
        ]);
        assert.equal(fs.existsSync(live), false);
        assert.equal(fs.existsSync(staged), false);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(root)
        ), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('activation reports bounded uncertainty when rollback fsync cannot be proven', () => {
    const fixture = createDarkRouterFixture('i12-router-activation-uncertain-');
    const { digest, dynamic, hostname, live, root, staged, staging } = fixture;
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
            withRootRouterMetadata(
                fixture,
                () => activateRouter(staged, hostname, digest, options)
            ),
            'active_router_activation_rollback_uncertain'
        );
        assert.deepEqual(fsyncTargets, [path.resolve(live), path.resolve(dynamic)]);
        assert.equal(fs.existsSync(live), false);
        assert.equal(fs.existsSync(staged), true);
        assert.equal(withRootRouterMetadata(
            fixture, () => validateDarkDynamicDirectory(root)
        ), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('activation cannot claim rollback proof after a dynamic-root swap at the link boundary', () => {
    const fixture = createDarkRouterFixture('i12-router-dynamic-swap-');
    let swapped = false;
    try {
        const result = withRootRouterMetadata(fixture, () => activateRouter(
            fixture.staged, fixture.hostname, fixture.digest, {
                packRoot: fixture.root,
                platform: 'linux',
                fsync: (target) => {
                    if (path.resolve(target) === path.resolve(fixture.dynamic)) swapped = true;
                }
            }
        ), (target, kind) => swapped && kind === 'parent'
            && target === path.resolve(fixture.dynamic) ? { ino: 90_001 } : {});
        assert.equal(result, 'active_router_activation_rollback_uncertain');
        assert.equal(swapped, true);
        assert.equal(fs.existsSync(fixture.live), false);
        assert.equal(fs.existsSync(fixture.staged), true);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('disable rejects live-file and retained-parent metadata drift while preserving the route', () => {
    const cases = [
        ['live uid', 'file', 'uid', 1000],
        ['live gid', 'file', 'gid', 1000],
        ['live mode', 'file', 'mode', 0o640],
        ['parent uid', 'parent', 'uid', 1000],
        ['parent gid', 'parent', 'gid', 1000],
        ['parent mode', 'parent', 'mode', 0o750]
    ];
    for (const [name, kind, property, value] of cases) {
        const fixture = createActiveRouterFixture(`i12-router-retained-metadata-${property}-`);
        try {
            const result = withRootRouterMetadata(fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, {
                    packRoot: fixture.root, platform: 'linux', fsync: () => {}
                }
            ), (target, targetKind) => targetKind === kind
                && target === path.resolve(kind === 'file'
                    ? fixture.live : fixture.retainedParent)
                ? { [property]: value } : {});
            assert.equal(result, kind === 'file'
                ? 'traefik_active_router_metadata_unsafe'
                : 'retained_router_target_invalid', name);
            assert.equal(fs.existsSync(fixture.retained), false, name);
            assert.equal(withRootRouterMetadata(fixture, () => validateActiveDynamicDirectory(
                fixture.hostname, fixture.digest, fixture.root
            )), null, name);
        } finally {
            fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
        }
    }

    const linkedFixture = createActiveRouterFixture('i12-router-live-nlink-');
    const foreignLink = path.join(linkedFixture.retainedParent, 'foreign-live-link.yml');
    try {
        fs.linkSync(linkedFixture.live, foreignLink);
        assert.equal(withRootRouterMetadata(linkedFixture, () => disableRouter(
            linkedFixture.retained, linkedFixture.hostname, linkedFixture.digest, {
                packRoot: linkedFixture.root, platform: 'linux', fsync: () => {}
            }
        )), 'traefik_active_router_metadata_unsafe');
        assert.equal(fs.existsSync(linkedFixture.retained), false);
        assert.equal(withRootRouterMetadata(
            linkedFixture, () => validateActiveDynamicDirectory(
                linkedFixture.hostname, linkedFixture.digest, linkedFixture.root
            )
        ), 'traefik_active_router_metadata_unsafe');
    } finally {
        fs.rmSync(linkedFixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('disable reports uncertainty if retained-link metadata drifts before live unlink', () => {
    const fixture = createActiveRouterFixture('i12-router-retained-link-drift-');
    let mutated = false;
    try {
        const result = withRootRouterMetadata(fixture, () => disableRouter(
            fixture.retained, fixture.hostname, fixture.digest, {
                packRoot: fixture.root,
                platform: 'linux',
                fsync: (target) => {
                    if (path.resolve(target) === path.resolve(fixture.retained)) mutated = true;
                }
            }
        ), (target, kind) => mutated && kind === 'file'
            && target === path.resolve(fixture.retained) ? { mode: 0o640 } : {});
        assert.equal(result, 'retained_router_prepare_rollback_uncertain');
        assert.equal(mutated, true);
        assert.equal(fs.existsSync(fixture.retained), true);
        assert.equal(fs.statSync(fixture.live).ino, fs.statSync(fixture.retained).ino);
        assert.equal(fs.statSync(fixture.live).nlink, 2);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveDynamicDirectory(
            fixture.hostname, fixture.digest, fixture.root
        )), 'traefik_active_router_metadata_unsafe');
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
    }
});

test('disable cannot claim final dark identity after a dynamic-root swap at live unlink', () => {
    const fixture = createActiveRouterFixture('i12-router-disable-dynamic-swap-');
    let swapped = false;
    try {
        const result = withRootRouterMetadata(fixture, () => disableRouter(
            fixture.retained, fixture.hostname, fixture.digest, {
                packRoot: fixture.root,
                platform: 'linux',
                fsync: (target) => {
                    if (path.resolve(target) === path.resolve(fixture.dynamic)) swapped = true;
                }
            }
        ), (target, kind) => swapped && kind === 'parent'
            && target === path.resolve(fixture.dynamic) ? { ino: 90_002 } : {});
        assert.equal(result, 'active_router_disable_uncertain');
        assert.equal(swapped, true);
        assert.equal(fs.existsSync(fixture.live), false);
        assert.equal(fs.existsSync(fixture.retained), true);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
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
            withRootRouterMetadata(fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, options
            )),
            'retained_router_prepare_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(fixture.retained), path.resolve(fixture.live),
            path.resolve(fixture.retainedParent)
        ]);
        assert.equal(fs.existsSync(fixture.retained), false);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveDynamicDirectory(
            fixture.hostname, fixture.digest, fixture.root
        )), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
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
            withRootRouterMetadata(fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, options
            )),
            'retained_router_prepare_rolled_back'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(fixture.retained), path.resolve(fixture.retainedParent),
            path.resolve(fixture.live),
            path.resolve(fixture.retainedParent)
        ]);
        assert.equal(fs.existsSync(fixture.retained), false);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveDynamicDirectory(
            fixture.hostname, fixture.digest, fixture.root
        )), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
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
            withRootRouterMetadata(fixture, () => disableRouter(
                fixture.retained, fixture.hostname, fixture.digest, options
            )),
            'retained_router_prepare_rollback_uncertain'
        );
        assert.deepEqual(fsyncTargets, [
            path.resolve(fixture.retained), path.resolve(fixture.live)
        ]);
        assert.equal(fs.existsSync(fixture.retained), false);
        assert.equal(withRootRouterMetadata(fixture, () => validateActiveDynamicDirectory(
            fixture.hostname, fixture.digest, fixture.root
        )), null);
    } finally {
        fs.rmSync(fixture.cleanupRoot, { recursive: true, force: true });
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
