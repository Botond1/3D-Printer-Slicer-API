'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PHASE_ORDER,
    validateCandidatePair,
    validateDegradedObservation,
    validateHealthyObservation,
    validateRuntimeInspect
} = require('../../../scripts/i9-staging-contract');

const ROOT = path.resolve(__dirname, '../../..');
const RUNTIME = fs.readFileSync(
    path.join(ROOT, 'scripts/i9-staging-rollback-rehearsal.js'), 'utf8'
);
const DOCKER = fs.readFileSync(path.join(ROOT, 'scripts/i9-staging-docker.js'), 'utf8');
const IMPLEMENTATION = `${RUNTIME}\n${DOCKER}`;
const PROBES = fs.readFileSync(path.join(ROOT, 'scripts/i9-staging-peer-probes.js'), 'utf8');
const DIGEST = (character) =>
    `ghcr.io/botond1/3d-printer-slicer-api@sha256:${character.repeat(64)}`;
const CONFIG = (character) => `sha256:${character.repeat(64)}`;

function candidate(character) {
    return {
        reference: DIGEST(character),
        config_id: CONFIG(character),
        source_sha: character.repeat(40),
        configured_user: 'slicer'
    };
}

function response(status, body) {
    return { status, body };
}

function queue() {
    return {
        queueLength: 0, activeJobs: 0, maxConcurrent: 1, maxQueueLength: 100,
        maxQueuePerClient: 5, acceptingJobs: true
    };
}

function operations(ready) {
    return {
        checkedAt: '2026-07-31T10:00:00.000Z',
        ready,
        admissionOpen: true,
        probes: {
            queue: true, native: true, storage: ready, retention: true, pricing: true, config: true,
            bambu: true, commonDependencies: true
        },
        reasonCodes: ready ? [] : ['STORAGE_UNSAFE'],
        queue: queue(),
        legacyMigration: { enabled: false, audience: null, expiresAt: null },
        slicerRuntime: {
            bambuReady: true, commonDependenciesReady: true,
            dependencyEvidence: 'startup_import_and_fresh_file_presence',
            engines: {
                bambu: { available: true, version: '02.08.02.61', required_for_bambu: true },
                prusa: { available: true, version: '2.8.1', required_for_bambu: false },
                orca: { available: true, version: '2.3.1', required_for_bambu: false }
            }
        }
    };
}

function detailed(ready) {
    return {
        timestamp: '2026-07-31T10:00:00.000Z',
        status: ready ? 'OK' : 'DEGRADED',
        uptime: 10,
        subsystems: {
            queue: queue(), native: true, storage: ready, retention: true, pricing: true,
            config: true, bambu: true, commonDependencies: true,
            python: { available: true, version: 'Python 3.12.11' }
        }
    };
}

const rejection = {
    success: false,
    error: 'Operations authentication is required.',
    errorCode: 'OPERATIONS_AUTH_REQUIRED'
};

function observation(ready) {
    const status = ready ? 200 : 503;
    return {
        health: response(200, { status: 'OK', uptime: 10 }),
        ready: response(status, { status: ready ? 'READY' : 'NOT_READY' }),
        operations: response(status, operations(ready)),
        detailed: response(status, detailed(ready)),
        ...(ready ? { missing: response(401, rejection), wrong: response(401, rejection) } : {})
    };
}

test('candidate identities are immutable, distinct and non-root scoped', () => {
    assert.equal(validateCandidatePair(candidate('a'), candidate('b')), null);
    assert.equal(validateCandidatePair(candidate('a'), candidate('a')),
        'distinct_candidate_identity_required');
    assert.equal(validateCandidatePair(
        { ...candidate('a'), reference: 'ghcr.io/botond1/3d-printer-slicer-api:latest' },
        candidate('b')
    ), 'candidate_identity_malformed');
    assert.equal(validateCandidatePair(
        { ...candidate('a'), configured_user: 'root' }, candidate('b')
    ), 'candidate_identity_malformed');
});

test('healthy readiness requires liveness, two readiness surfaces, Python and auth rejection', () => {
    const value = observation(true);
    assert.equal(validateHealthyObservation(value), null);
    assert.equal(validateHealthyObservation({
        ...value, detailed: response(200, {
            ...detailed(true),
            subsystems: { ...detailed(true).subsystems, python: { available: false, version: null } }
        })
    }), 'healthy_readiness_contract_mismatch');
    assert.equal(validateHealthyObservation({
        ...value, wrong: response(200, { status: 'READY' })
    }), 'healthy_readiness_contract_mismatch');
});

test('controlled storage degradation preserves liveness and yields only STORAGE_UNSAFE', () => {
    const value = observation(false);
    assert.equal(validateDegradedObservation(value), null);
    assert.equal(validateDegradedObservation({
        ...value,
        operations: response(503, { ...operations(false), reasonCodes: ['CONFIG_UNSAFE'] })
    }), 'storage_readiness_failure_not_observed');
});

for (const ready of [true, false]) {
    const validate = ready ? validateHealthyObservation : validateDegradedObservation;
    test(`Bambu readiness accepts independently unavailable optional engines (ready=${ready})`, () => {
        for (const unavailable of [[], ['prusa'], ['orca'], ['prusa', 'orca']]) {
            const value = observation(ready);
            for (const engine of unavailable) Object.assign(value.operations.body.slicerRuntime.engines[engine], {
                available: false, version: null
            });
            assert.equal(validate(value), null, unavailable.join(','));
        }
    });
    test(`Bambu readiness rejects missing, malformed and unrelated failure evidence (ready=${ready})`, async (t) => {
        const mutations = [
            ['runtime missing', (o) => { delete o.slicerRuntime; }],
            ['runtime extra', (o) => { o.slicerRuntime.extra = true; }],
            ['Bambu not ready', (o) => { o.slicerRuntime.bambuReady = false; }],
            ['dependencies not ready', (o) => { o.slicerRuntime.commonDependenciesReady = false; }],
            ['unverified dependencies', (o) => { o.slicerRuntime.dependencyEvidence = 'startup_only'; }],
            ['engine missing', (o) => { delete o.slicerRuntime.engines.orca; }],
            ['engine extra', (o) => { o.slicerRuntime.engines.other = {}; }],
            ['engine field extra', (o) => { o.slicerRuntime.engines.bambu.extra = true; }],
            ['Bambu unavailable', (o) => { Object.assign(o.slicerRuntime.engines.bambu, { available: false, version: null }); }],
            ['availability mistyped', (o) => { o.slicerRuntime.engines.orca.available = 'true'; }],
            ['Bambu not required', (o) => { o.slicerRuntime.engines.bambu.required_for_bambu = false; }],
            ['optional required', (o) => { o.slicerRuntime.engines.prusa.required_for_bambu = true; }],
            ['Bambu version malformed', (o) => { o.slicerRuntime.engines.bambu.version = 'Bambu Studio'; }],
            ['optional version malformed', (o) => { o.slicerRuntime.engines.prusa.version = 'unknown'; }],
            ['unavailable version retained', (o) => { o.slicerRuntime.engines.orca.available = false; }],
            ['available version null', (o) => { o.slicerRuntime.engines.orca.version = null; }],
            ['timestamp malformed', (o) => { o.checkedAt = 'unknown'; }],
            ['operations field extra', (o) => { o.extra = true; }],
            ['probe extra', (o) => { o.probes.extra = true; }],
            ['detailed field extra', (_, d) => { d.subsystems.extra = true; }],
            ['wrong storage state', (o) => { o.probes.storage = !ready; }],
            ['extra reason', (o) => { o.reasonCodes.push('COMMON_DEPENDENCIES_UNAVAILABLE'); }]
        ];
        for (const key of ['bambu', 'commonDependencies']) {
            mutations.push([`${key} probe missing`, (o) => { delete o.probes[key]; }],
                [`${key} probe failed`, (o) => { o.probes[key] = false; }],
                [`${key} detailed missing`, (_, d) => { delete d.subsystems[key]; }],
                [`${key} detailed failed`, (_, d) => { d.subsystems[key] = false; }]);
        }
        for (const [name, mutate] of mutations) await t.test(name, () => {
            const value = observation(ready);
            mutate(value.operations.body, value.detailed.body);
            assert.equal(validate(value), ready
                ? 'healthy_readiness_contract_mismatch' : 'storage_readiness_failure_not_observed');
        });
    });
}

test('runtime inspect requires exact digest/config, private network and no port binding', () => {
    const previous = candidate('a');
    const value = {
        id: 'c'.repeat(64),
        imageId: previous.config_id,
        configuredImage: previous.reference,
        running: true,
        paused: false,
        restarting: false,
        oomKilled: false,
        health: 'healthy',
        pid: 1234,
        user: '999:999',
        portBindings: {},
        networks: ['slicer-api-private']
    };
    const expected = {
        configId: previous.config_id, reference: previous.reference, uid: '999', gid: '999'
    };
    assert.equal(validateRuntimeInspect(value, expected), null);
    assert.equal(validateRuntimeInspect({
        ...value, portBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3000' }] }
    }, expected), 'runtime_identity_or_envelope_mismatch');
});

test('orchestrator preserves exact failure, rollback, cleanup and phase contracts', () => {
    for (const fragment of [
        "sudoChmod('0500'", "sudoChmod('0700'",
        "observeStorageFailure(stage.peerId",
        "startStage(manifest.previous, values, 'rollback')",
        "proveNoDefaultRoute(inspect.id",
        "rollback = 'success_after_failure'",
        'removeImages([manifest.candidate, manifest.previous])',
        "requireAbsent();", "remote_digests_preserved: true",
        "deployed_digest: 'not_applicable_ephemeral_no_deploy'"
    ]) assert.ok(IMPLEMENTATION.includes(fragment), fragment);
    assert.deepEqual(PHASE_ORDER, [
        'previous_qualified', 'previous_ready', 'previous_synthetic_slice',
        'candidate_ready', 'candidate_synthetic_slice', 'readiness_failure_injected',
        'readiness_failure_observed', 'previous_rollback_ready',
        'previous_rollback_synthetic_slice', 'runtime_cleanup_complete'
    ]);
    assert.match(PROBES, /size>32768/);
    assert.match(PROBES, /timeout:2500/);
});

test('runtime security mutations are observable', () => {
    const mutations = [
        ["'--cap-drop', 'ALL'", "'--cap-add', 'ALL'"],
        ["'--read-only'", "'--privileged'"],
        ["'--network', NETWORK_NAME", "'--network', 'bridge'"],
        ["'--pull', 'never'", "'--pull', 'always'"],
        ["'--no-build'", "'--build'"],
        ["sleep(6500)", "sleep(100)"],
        ["state.readiness.rollback = true", "state.readiness.rollback = false"],
        ["removeImages([manifest.candidate, manifest.previous])", 'removeImages([])']
    ];
    for (const [needle, replacement] of mutations) {
        assert.ok(IMPLEMENTATION.includes(needle), needle);
        assert.notEqual(IMPLEMENTATION.replace(needle, replacement), IMPLEMENTATION);
    }
});
