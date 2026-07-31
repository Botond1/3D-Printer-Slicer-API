'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    EVIDENCE_FILE,
    EVIDENCE_KEYS,
    EXACT_JOB,
    EXACT_PHASE_ORDER,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REF,
    EXACT_SOURCE_REPOSITORY,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildStagingEvidence,
    validateStagingEvidence
} = require('../../../scripts/i9-staging-evidence');
const {
    EXACT_GHCR_REPOSITORY,
    loadStagingManifest
} = require('../../../scripts/i9-staging-manifest');
const {
    INPUT_FILE,
    REQUIRED_OUTCOMES,
    buildFromRepository,
    writeEvidence
} = require('../../../scripts/i9-write-staging-evidence');

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_SHA = '9'.repeat(40);
const manifestRecord = loadStagingManifest(ROOT);
const manifest = manifestRecord.value;
const manifestSha = crypto.createHash('sha256')
    .update(fs.readFileSync(manifestRecord.path)).digest('hex');

function readiness(containerCharacter, pid, image) {
    return {
        container_id: containerCharacter.repeat(64),
        pid,
        image_id: image.config_digest,
        kernel_uid: image.service_uid,
        kernel_gid: image.service_gid,
        consecutive_passes: 2,
        docker_healthy: true,
        liveness: true,
        minimal_readiness: true,
        operations_readiness: true,
        detailed_readiness: true,
        python_available: true,
        queue_idle: true,
        auth_rejection: true,
        orca_smoke: true,
        result: 'success'
    };
}

function image(source, role) {
    return {
        role,
        source_sha: source.source_sha,
        digest: source.digest,
        config_digest: source.config_digest,
        configured_user: 'slicer',
        service_uid: '999',
        service_gid: '999'
    };
}

function validInput() {
    const previous = image(manifest.previous, 'ephemeral_previous_fixture_requalified');
    const candidate = image(manifest.candidate, 'signed_candidate_verified');
    return {
        schema_version: SCHEMA_VERSION,
        source: {
            repository: EXACT_SOURCE_REPOSITORY,
            repository_slug: EXACT_REPOSITORY_SLUG,
            sha: SOURCE_SHA,
            ref: EXACT_SOURCE_REF
        },
        workflow: {
            name: EXACT_WORKFLOW,
            path: EXACT_WORKFLOW_PATH,
            run_id: '30599900001',
            run_attempt: '1',
            job: EXACT_JOB
        },
        manifest: {
            sha256: manifestSha,
            platform: 'linux/amd64',
            previous_requalified: true,
            candidate_verified: true,
            distinct_digests: true
        },
        images: {repository: EXACT_GHCR_REPOSITORY, previous, candidate},
        phase_order: [...EXACT_PHASE_ORDER],
        previous_initial: readiness('a', 1001, previous),
        candidate_promoted: readiness('b', 1002, candidate),
        failure_injection: {
            target: 'pricing_state_writability',
            mode_before: '0700',
            mode_injected: '0500',
            mode_restored: '0700',
            liveness_preserved: true,
            fresh_detailed_503: true,
            storage_probe_failed: true,
            minimal_readiness_503: true,
            operations_readiness_503: true,
            reason_code: 'STORAGE_UNSAFE',
            cache_expiry_bounded: true,
            automatic_rollback_triggered: true,
            result: 'expected_readiness_failure_observed'
        },
        rollback: {
            transition: {
                automatic: true,
                triggered_by: 'candidate_storage_failure_observed',
                restored_digest: previous.digest,
                candidate_removed: true,
                previous_restarted: true,
                state_mode_restored: true,
                shared_synthetic_state_preserved: true,
                result: 'success'
            },
            readiness: readiness('c', 1003, previous)
        },
        cleanup: {
            containers_removed: true,
            network_removed: true,
            local_digest_refs_removed: true,
            temporary_state_removed: true,
            remote_digests_preserved: true,
            result: 'success'
        },
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only',
            result: 'I9_STAGING_REHEARSAL_EVIDENCE_READY'
        },
        deployed_digest: 'not_applicable_ephemeral_no_deploy'
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function rejected(value, expected = {}) {
    const result = validateStagingEvidence(value, expected);
    assert.equal(typeof result, 'string');
    assert.match(result, /^[a-z][a-z0-9_]*$/);
}

test('builder produces a deeply frozen bounded exact-key rehearsal record', () => {
    const value = buildStagingEvidence(validInput());
    assert.equal(validateStagingEvidence(value), null);
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.images.previous));
    assert.ok(Object.isFrozen(value.rollback.readiness));
    assert.ok(Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`) <= MAX_EVIDENCE_BYTES);
    assert.deepEqual(Object.keys(value).sort(), [...EVIDENCE_KEYS.root].sort());
    for (const key of ['source', 'workflow', 'manifest', 'images', 'previous_initial',
        'candidate_promoted', 'failure_injection', 'rollback', 'cleanup', 'aggregator']) {
        assert.deepEqual(Object.keys(value[key]).sort(), [...EVIDENCE_KEYS[key === 'previous_initial'
            || key === 'candidate_promoted' ? 'readiness' : key]].sort(), key);
    }
    assert.deepEqual(Object.keys(value.images.previous).sort(), [...EVIDENCE_KEYS.image].sort());
    assert.deepEqual(
        Object.keys(value.rollback.transition).sort(),
        [...EVIDENCE_KEYS.rollback_transition].sort()
    );
});

test('schema, identities, phase order, and no-deploy boundary fail closed', async (t) => {
    const mutations = [
        ['not object', () => null],
        ['missing root', (x) => { delete x.cleanup; }],
        ['extra root', (x) => { x.raw_logs = []; }],
        ['missing nested', (x) => { delete x.images.candidate.digest; }],
        ['extra nested', (x) => { x.failure_injection.absolute_path = '/tmp'; }],
        ['wrong version', (x) => { x.schema_version += '-next'; }],
        ['wrong source ref', (x) => { x.source.ref = 'refs/heads/main'; }],
        ['wrong workflow', (x) => { x.workflow.name = 'Other'; }],
        ['wrong job', (x) => { x.workflow.job = 'other'; }],
        ['manifest hash malformed', (x) => { x.manifest.sha256 = 'short'; }],
        ['manifest previous unqualified', (x) => { x.manifest.previous_requalified = false; }],
        ['same digest', (x) => { x.images.previous.digest = x.images.candidate.digest; }],
        ['same config', (x) => {
            x.images.previous.config_digest = x.images.candidate.config_digest;
        }],
        ['tag as candidate digest', (x) => { x.images.candidate.digest = 'candidate-latest'; }],
        ['phase reordered', (x) => { x.phase_order.reverse(); }],
        ['phase missing', (x) => { x.phase_order.pop(); }],
        ['production digest claim', (x) => { x.deployed_digest = x.images.candidate.digest; }],
        ['aggregate mislabeled complete', (x) => {
            x.aggregator.result = 'I9_STAGING_ROLLBACK_COMPLETE';
        }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = validInput();
        const replacement = mutate(value);
        rejected(replacement === undefined ? value : replacement);
    });
    const oversized = validInput();
    oversized.source.repository = 'x'.repeat(MAX_EVIDENCE_BYTES);
    rejected(oversized);
});

test('all previous, candidate, and post-rollback readiness proofs are mandatory', async (t) => {
    for (const phase of ['previous_initial', 'candidate_promoted']) {
        for (const key of [
            'docker_healthy', 'liveness', 'minimal_readiness', 'operations_readiness',
            'detailed_readiness', 'python_available', 'queue_idle', 'auth_rejection',
            'orca_smoke'
        ]) {
            await t.test(`${phase} ${key}`, () => {
                const value = validInput();
                value[phase][key] = false;
                rejected(value);
            });
        }
    }
    const cases = [
        ['one pass only', (x) => { x.candidate_promoted.consecutive_passes = 1; }],
        ['candidate image mismatch', (x) => {
            x.candidate_promoted.image_id = x.images.previous.config_digest;
        }],
        ['kernel UID mismatch', (x) => { x.previous_initial.kernel_uid = '1000'; }],
        ['container reused', (x) => {
            x.rollback.readiness.container_id = x.previous_initial.container_id;
        }],
        ['candidate PID reused after rollback', (x) => {
            x.rollback.readiness.pid = x.candidate_promoted.pid;
        }],
        ['previous PID reused after rollback', (x) => {
            x.rollback.readiness.pid = x.previous_initial.pid;
        }],
        ['rollback readiness absent', (x) => { delete x.rollback.readiness; }]
    ];
    for (const [name, mutate] of cases) await t.test(name, () => {
        const value = validInput();
        mutate(value);
        rejected(value);
    });
});

test('controlled storage failure, automatic rollback, and exact cleanup cannot be weakened', async (t) => {
    const mutations = [
        ['wrong target', (x) => { x.failure_injection.target = 'container_pause'; }],
        ['world writable injection', (x) => { x.failure_injection.mode_injected = '0777'; }],
        ['mode not restored', (x) => { x.failure_injection.mode_restored = '0500'; }],
        ['liveness lost', (x) => { x.failure_injection.liveness_preserved = false; }],
        ['fresh detailed not 503', (x) => { x.failure_injection.fresh_detailed_503 = false; }],
        ['storage probe not failed', (x) => { x.failure_injection.storage_probe_failed = false; }],
        ['cache expiry not bounded', (x) => { x.failure_injection.cache_expiry_bounded = false; }],
        ['wrong reason', (x) => { x.failure_injection.reason_code = 'SHUTDOWN'; }],
        ['rollback not automatic', (x) => { x.rollback.transition.automatic = false; }],
        ['wrong rollback digest', (x) => {
            x.rollback.transition.restored_digest = x.images.candidate.digest;
        }],
        ['candidate retained', (x) => { x.rollback.transition.candidate_removed = false; }],
        ['shared state lost', (x) => {
            x.rollback.transition.shared_synthetic_state_preserved = false;
        }],
        ['remote digest removed', (x) => { x.cleanup.remote_digests_preserved = false; }],
        ['temporary state retained', (x) => { x.cleanup.temporary_state_removed = false; }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = validInput();
        mutate(value);
        rejected(value);
    });
});

function environment(runnerTemp, evidenceSubdir) {
    const env = {
        RUNNER_TEMP: runnerTemp,
        EVIDENCE_SUBDIR: evidenceSubdir,
        EVIDENCE_DIR: path.join(runnerTemp, evidenceSubdir),
        GITHUB_REPOSITORY: EXACT_REPOSITORY_SLUG,
        GITHUB_WORKFLOW: EXACT_WORKFLOW,
        GITHUB_WORKFLOW_REF:
            `${EXACT_REPOSITORY_SLUG}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`,
        GITHUB_REF: EXACT_SOURCE_REF,
        GITHUB_JOB: EXACT_JOB,
        GITHUB_RUN_ID: '30599900001',
        GITHUB_RUN_ATTEMPT: '1',
        REHEARSAL_SHA: SOURCE_SHA
    };
    for (const outcome of REQUIRED_OUTCOMES) env[outcome] = 'success';
    return env;
}

function createFixture() {
    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'i9-evidence-'));
    const evidenceSubdir = 'i9-evidence-1';
    const evidenceRoot = path.join(runnerTemp, evidenceSubdir);
    fs.mkdirSync(evidenceRoot, {mode: 0o700});
    fs.writeFileSync(
        path.join(evidenceRoot, INPUT_FILE),
        `${JSON.stringify(validInput(), null, 2)}\n`
    );
    return {runnerTemp, evidenceRoot, env: environment(runnerTemp, evidenceSubdir)};
}

test('writer correlates the runtime draft to manifest and hosted identity, then writes once', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    const evidence = buildFromRepository(fixture.env);
    assert.equal(evidence.manifest.sha256, manifestSha);
    assert.equal(evidence.images.previous.digest, manifest.previous.digest);
    assert.equal(evidence.images.candidate.digest, manifest.candidate.digest);
    const target = writeEvidence(fixture.env);
    assert.equal(target, path.join(fixture.evidenceRoot, EVIDENCE_FILE));
    assert.ok(fs.lstatSync(target).isFile());
    assert.throws(
        () => writeEvidence(fixture.env),
        (error) => error.code === 'i9_evidence_output_boundary_failure'
    );
});

test('writer rejects missing gates, identity drift, manifest drift, and root escape', async (t) => {
    for (const outcome of REQUIRED_OUTCOMES) await t.test(outcome, () => {
        const fixture = createFixture();
        try {
            fixture.env[outcome] = 'failure';
            assert.throws(
                () => buildFromRepository(fixture.env),
                (error) => error.code === 'i9_evidence_gate_outcome_failure'
            );
        } finally {
            fs.rmSync(fixture.runnerTemp, {recursive: true, force: true});
        }
    });
    for (const [name, mutate, code] of [
        ['workflow', (x) => { x.GITHUB_WORKFLOW = 'Other'; }, 'i9_evidence_hosted_identity_mismatch'],
        ['ref', (x) => { x.GITHUB_REF = 'refs/heads/main'; }, 'i9_evidence_hosted_identity_mismatch'],
        ['SHA', (x) => { x.REHEARSAL_SHA = '8'.repeat(40); }, 'expected_identity_mismatch'],
        ['root', (x) => { x.EVIDENCE_SUBDIR = 'other'; }, 'i9_evidence_root_mismatch']
    ]) await t.test(name, () => {
        const fixture = createFixture();
        try {
            mutate(fixture.env);
            assert.throws(() => buildFromRepository(fixture.env), (error) => error.code === code);
        } finally {
            fs.rmSync(fixture.runnerTemp, {recursive: true, force: true});
        }
    });
    await t.test('draft candidate digest', () => {
        const fixture = createFixture();
        try {
            const target = path.join(fixture.evidenceRoot, INPUT_FILE);
            const value = JSON.parse(fs.readFileSync(target, 'utf8'));
            value.images.candidate.digest = `sha256:${'d'.repeat(64)}`;
            fs.writeFileSync(target, JSON.stringify(value));
            assert.throws(
                () => buildFromRepository(fixture.env),
                (error) => error.code === 'expected_identity_mismatch'
            );
        } finally {
            fs.rmSync(fixture.runnerTemp, {recursive: true, force: true});
        }
    });
});
