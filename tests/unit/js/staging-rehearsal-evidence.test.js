'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    AGGREGATOR_RESULT,
    EXACT_PHASE_ORDER,
    EXACT_WORKFLOW,
    SCHEMA_VERSION,
    validateStagingRehearsalEvidence
} = require('../../../scripts/staging-rehearsal-evidence');
const {
    MANIFEST_FILE,
    MANIFEST_SCHEMA_VERSION,
    buildStagingRehearsalManifest
} = require('../../../scripts/staging-rehearsal-manifest');
const {
    transformDraft
} = require('../../../scripts/write-staging-rehearsal-evidence');

const PREVIOUS_SHA = '1'.repeat(40);
const CANDIDATE_SHA = '2'.repeat(40);

function attestation(sourceSha, sourceRef) {
    return {
        signer_repository: 'Botond1/3D-Printer-Slicer-API',
        signer_workflow: '.github/workflows/candidate-publication.yml',
        source_ref: sourceRef,
        source_digest: sourceSha,
        issuer: 'https://token.actions.githubusercontent.com',
        provenance_predicate: 'https://slsa.dev/provenance/v1',
        sbom_predicate: 'https://spdx.dev/Document/v2.3'
    };
}

function manifest() {
    return buildStagingRehearsalManifest({
        schema_version: MANIFEST_SCHEMA_VERSION,
        repository: 'ghcr.io/botond1/3d-printer-slicer-api',
        platform: 'linux/amd64',
        artifact: {
            publication_workflow_name: 'Candidate Publication - Signed GHCR (NO DEPLOY)',
            publication_workflow_path: '.github/workflows/candidate-publication.yml',
            publication_workflow_id: '123456',
            publication_event: 'workflow_dispatch',
            publication_conclusion: 'success',
            publication_run_id: '32670000001',
            publication_run_attempt: '1',
            artifact_id: '987654321',
            artifact_name: `i11-main-signed-candidate-${CANDIDATE_SHA}-32670000001-1`,
            artifact_digest: `sha256:${'3'.repeat(64)}`,
            content_sha256: '4'.repeat(64),
            publication_evidence_sha256: '5'.repeat(64),
            policy_sha256: '6'.repeat(64)
        },
        compatibility: {
            previous_source_sha: PREVIOUS_SHA,
            candidate_source_sha: CANDIDATE_SHA,
            previous_is_ancestor: true,
            configs_unchanged: true,
            production_compose_unchanged: true
        },
        policy: {
            distinct_digests_required: true,
            digest_only_runtime_required: true,
            per_image_attestation_verification_required: true,
            source_ancestry_required: true,
            config_compose_compatibility_required: true,
            registry_writes_forbidden: true,
            mutable_tags_forbidden: true,
            deploy_forbidden: true
        },
        previous: {
            role: 'previous_signed_candidate', source_sha: PREVIOUS_SHA,
            digest: `sha256:${'7'.repeat(64)}`,
            config_digest: `sha256:${'8'.repeat(64)}`,
            configured_user: 'slicer',
            attestation: attestation(PREVIOUS_SHA, 'refs/heads/codex/i8-candidate')
        },
        candidate: {
            role: 'signed_main_candidate', source_sha: CANDIDATE_SHA,
            digest: `sha256:${'9'.repeat(64)}`,
            config_digest: `sha256:${'a'.repeat(64)}`,
            configured_user: 'slicer',
            attestation: attestation(CANDIDATE_SHA, 'refs/heads/main')
        }
    });
}

function readiness(id, pid, config) {
    return {
        container_id: id.repeat(64), pid, image_id: config,
        kernel_uid: '999', kernel_gid: '999', consecutive_passes: 2,
        docker_healthy: true, liveness: true, minimal_readiness: true,
        operations_readiness: true, detailed_readiness: true,
        python_available: true, queue_idle: true, auth_rejection: true,
        orca_smoke: true, result: 'success'
    };
}

function draft(value) {
    return {
        images: {
            previous: {service_uid: '999', service_gid: '999'},
            candidate: {service_uid: '999', service_gid: '999'}
        },
        previous_initial: readiness('b', 101, value.previous.config_digest),
        candidate_promoted: readiness('c', 202, value.candidate.config_digest),
        failure_injection: {
            target: 'pricing_state_writability', mode_before: '0700',
            mode_injected: '0500', mode_restored: '0700', liveness_preserved: true,
            fresh_detailed_503: true, storage_probe_failed: true,
            minimal_readiness_503: true, operations_readiness_503: true,
            reason_code: 'STORAGE_UNSAFE', cache_expiry_bounded: true,
            automatic_rollback_triggered: true,
            result: 'expected_readiness_failure_observed'
        },
        rollback: {
            transition: {
                automatic: true, triggered_by: 'candidate_storage_failure_observed',
                restored_digest: value.previous.digest, candidate_removed: true,
                previous_restarted: true, state_mode_restored: true,
                shared_synthetic_state_preserved: true, result: 'success'
            },
            readiness: readiness('d', 303, value.previous.config_digest)
        },
        cleanup: {
            containers_removed: true, network_removed: true,
            local_digest_refs_removed: true, temporary_state_removed: true,
            remote_digests_preserved: true, result: 'success'
        }
    };
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-evidence-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const value = manifest();
    const manifestPath = path.join(root, MANIFEST_FILE);
    fs.writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
    const evidence = transformDraft(draft(value), manifestPath, value, {
        GITHUB_WORKFLOW: EXACT_WORKFLOW,
        GITHUB_RUN_ID: '32680000001',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'staging-rollback-rehearsal'
    });
    return {evidence, manifest: value};
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test('evidence correlates publication, digest-only images, failure, rollback, and cleanup', (t) => {
    const {evidence} = fixture(t);
    assert.equal(evidence.schema_version, SCHEMA_VERSION);
    assert.equal(validateStagingRehearsalEvidence(evidence), null);
    assert.equal(evidence.aggregator.result, AGGREGATOR_RESULT);
    assert.deepEqual(evidence.phase_order, [...EXACT_PHASE_ORDER]);
    assert.equal(evidence.deployed_digest, 'not_applicable_ephemeral_no_deploy');
});

test('evidence mutations fail closed across every security boundary', async (t) => {
    const {evidence} = fixture(t);
    const mutations = [
        ['source ref', (x) => { x.source.ref = 'refs/heads/dev'; }],
        ['publication event', (x) => { x.publication.publication_event = 'push'; }],
        ['artifact name', (x) => { x.publication.artifact_name += '-wrong'; }],
        ['manifest policy hash', (x) => { x.manifest.policy_sha256 = 'f'.repeat(64); }],
        ['source ancestry absent', (x) => { x.manifest.source_ancestry = false; }],
        ['configs drifted', (x) => { x.manifest.configs_unchanged = false; }],
        ['candidate tag', (x) => { x.images.candidate.digest = 'latest'; }],
        ['candidate attestation ref', (x) => {
            x.images.candidate.attestation.source_ref = 'refs/heads/dev';
        }],
        ['previous attestation source', (x) => {
            x.images.previous.attestation.source_digest = CANDIDATE_SHA;
        }],
        ['shared image digest', (x) => { x.images.candidate.digest = x.images.previous.digest; }],
        ['phase removed', (x) => { x.phase_order.pop(); }],
        ['candidate not healthy', (x) => { x.candidate_promoted.docker_healthy = false; }],
        ['storage failure absent', (x) => {
            x.failure_injection.storage_probe_failed = false;
        }],
        ['rollback digest changed', (x) => {
            x.rollback.transition.restored_digest = x.images.candidate.digest;
        }],
        ['runtime generation reused', (x) => {
            x.rollback.readiness.container_id = x.previous_initial.container_id;
        }],
        ['cleanup incomplete', (x) => { x.cleanup.temporary_state_removed = false; }],
        ['aggregate weakened', (x) => { x.aggregator.result = 'success'; }],
        ['deployed digest claimed', (x) => { x.deployed_digest = x.images.candidate.digest; }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(evidence);
        mutate(value);
        assert.notEqual(validateStagingRehearsalEvidence(value), null);
    });
});

test('expected correlation rejects a different publication or candidate identity', async (t) => {
    const {evidence} = fixture(t);
    const expected = {
        repository: evidence.source.repository_slug,
        rehearsal_sha: evidence.source.sha,
        publication_run_id: evidence.publication.publication_run_id,
        publication_artifact_id: evidence.publication.artifact_id,
        candidate_registry_digest: evidence.images.candidate.digest
    };
    assert.equal(validateStagingRehearsalEvidence(evidence, expected), null);
    for (const [key, value] of [
        ['rehearsal_sha', 'f'.repeat(40)],
        ['publication_run_id', '999'],
        ['publication_artifact_id', '998'],
        ['candidate_registry_digest', `sha256:${'f'.repeat(64)}`]
    ]) await t.test(key, () => {
        assert.equal(
            validateStagingRehearsalEvidence(evidence, {...expected, [key]: value}),
            'expected_identity_mismatch'
        );
    });
});
