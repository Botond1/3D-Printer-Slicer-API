'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    validateCandidatePair
} = require('../../../scripts/i9-staging-contract');
const {
    loadReleaseRehearsalPolicy
} = require('../../../scripts/release-rehearsal-input');
const {
    EXACT_WORKFLOW,
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

const ROOT = path.resolve(__dirname, '../../..');
const CANDIDATE_SHA = '2'.repeat(40);

function candidateAttestation() {
    return {
        signer_repository: 'Botond1/3D-Printer-Slicer-API',
        signer_workflow: '.github/workflows/candidate-publication.yml',
        source_ref: 'refs/heads/main',
        source_digest: CANDIDATE_SHA,
        issuer: 'https://token.actions.githubusercontent.com',
        provenance_predicate: 'https://slsa.dev/provenance/v1',
        sbom_predicate: 'https://spdx.dev/Document/v2.3'
    };
}

function ready(id, pid, imageId) {
    return {
        container_id: id.repeat(64), pid, image_id: imageId,
        kernel_uid: '999', kernel_gid: '999', consecutive_passes: 2,
        docker_healthy: true, liveness: true, minimal_readiness: true,
        operations_readiness: true, detailed_readiness: true,
        python_available: true, queue_idle: true, auth_rejection: true,
        orca_smoke: true, result: 'success'
    };
}

test('publication identity flows to digest-only runtime and bounded no-deploy evidence', (t) => {
    const policy = loadReleaseRehearsalPolicy(ROOT).value;
    const manifest = buildStagingRehearsalManifest({
        schema_version: MANIFEST_SCHEMA_VERSION,
        repository: policy.repository,
        platform: policy.platform,
        artifact: {
            publication_workflow_name: policy.candidate.publication_workflow_name,
            publication_workflow_path: policy.candidate.publication_workflow_path,
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
            previous_source_sha: policy.previous.source_sha,
            candidate_source_sha: CANDIDATE_SHA,
            previous_is_ancestor: true,
            configs_unchanged: true,
            production_compose_unchanged: true
        },
        policy: {...policy.controls},
        previous: JSON.parse(JSON.stringify(policy.previous)),
        candidate: {
            role: 'signed_main_candidate', source_sha: CANDIDATE_SHA,
            digest: `sha256:${'9'.repeat(64)}`,
            config_digest: `sha256:${'a'.repeat(64)}`,
            configured_user: 'slicer', attestation: candidateAttestation()
        }
    });

    const candidatePair = {
        previous: {
            reference: `${manifest.repository}@${manifest.previous.digest}`,
            config_id: manifest.previous.config_digest,
            source_sha: manifest.previous.source_sha,
            configured_user: manifest.previous.configured_user
        },
        candidate: {
            reference: `${manifest.repository}@${manifest.candidate.digest}`,
            config_id: manifest.candidate.config_digest,
            source_sha: manifest.candidate.source_sha,
            configured_user: manifest.candidate.configured_user
        }
    };
    assert.equal(validateCandidatePair(candidatePair.previous, candidatePair.candidate), null);
    assert.equal(validateCandidatePair(
        candidatePair.previous,
        {...candidatePair.candidate, reference: `${manifest.repository}:latest`}
    ), 'candidate_identity_malformed');

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-rehearsal-'));
    t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
    const manifestPath = path.join(temp, MANIFEST_FILE);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const draft = {
        images: {
            previous: {service_uid: '999', service_gid: '999'},
            candidate: {service_uid: '999', service_gid: '999'}
        },
        previous_initial: ready('b', 101, manifest.previous.config_digest),
        candidate_promoted: ready('c', 202, manifest.candidate.config_digest),
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
                restored_digest: manifest.previous.digest, candidate_removed: true,
                previous_restarted: true, state_mode_restored: true,
                shared_synthetic_state_preserved: true, result: 'success'
            },
            readiness: ready('d', 303, manifest.previous.config_digest)
        },
        cleanup: {
            containers_removed: true, network_removed: true,
            local_digest_refs_removed: true, temporary_state_removed: true,
            remote_digests_preserved: true, result: 'success'
        }
    };
    const evidence = transformDraft(draft, manifestPath, manifest, {
        GITHUB_WORKFLOW: EXACT_WORKFLOW,
        GITHUB_RUN_ID: '32680000001',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'staging-rollback-rehearsal'
    });
    assert.equal(validateStagingRehearsalEvidence(evidence), null);
    assert.equal(evidence.publication.artifact_id, manifest.artifact.artifact_id);
    assert.equal(evidence.images.previous.attestation.source_ref,
        'refs/heads/codex/i8-s3a-ghcr-signed-candidate');
    assert.equal(evidence.images.candidate.attestation.source_ref, 'refs/heads/main');
    assert.equal(evidence.deployed_digest, 'not_applicable_ephemeral_no_deploy');
});
