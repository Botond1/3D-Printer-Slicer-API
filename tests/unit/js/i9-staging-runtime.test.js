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
            queue: true, native: true, storage: ready, retention: true, pricing: true, config: true
        },
        reasonCodes: ready ? [] : ['STORAGE_UNSAFE'],
        queue: queue(),
        legacyMigration: { enabled: false, audience: null, expiresAt: null }
    };
}

function detailed(ready) {
    return {
        timestamp: '2026-07-31T10:00:00.000Z',
        status: ready ? 'OK' : 'DEGRADED',
        uptime: 10,
        subsystems: {
            queue: queue(), native: true, storage: ready, retention: true, pricing: true,
            config: true, python: { available: true, version: 'Python 3.12.11' }
        }
    };
}

const rejection = {
    success: false,
    error: 'Operations authentication is required.',
    errorCode: 'OPERATIONS_AUTH_REQUIRED'
};

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
    const value = {
        health: response(200, { status: 'OK', uptime: 10 }),
        ready: response(200, { status: 'READY' }),
        operations: response(200, operations(true)),
        detailed: response(200, detailed(true)),
        missing: response(401, rejection),
        wrong: response(401, rejection)
    };
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
    const value = {
        health: response(200, { status: 'OK', uptime: 11 }),
        ready: response(503, { status: 'NOT_READY' }),
        operations: response(503, operations(false)),
        detailed: response(503, detailed(false))
    };
    assert.equal(validateDegradedObservation(value), null);
    assert.equal(validateDegradedObservation({
        ...value,
        operations: response(503, { ...operations(false), reasonCodes: ['CONFIG_UNSAFE'] })
    }), 'storage_readiness_failure_not_observed');
});

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
