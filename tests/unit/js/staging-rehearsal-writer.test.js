'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {loadReleaseRehearsalPolicy} = require('../../../scripts/release-rehearsal-input');
const {EVIDENCE_FILE, EXACT_WORKFLOW, EXACT_WORKFLOW_PATH} =
    require('../../../scripts/staging-rehearsal-evidence');
const {MANIFEST_FILE, MANIFEST_SCHEMA_VERSION, buildStagingRehearsalManifest} =
    require('../../../scripts/staging-rehearsal-manifest');
const {INPUT_FILE, LEGACY_DRAFT_SCHEMA, REQUIRED_OUTCOMES, buildFromRepository,
    writeEvidence} = require('../../../scripts/write-staging-rehearsal-evidence');
const ROOT = path.resolve(__dirname, '../../..');
const CANDIDATE_SHA = '2'.repeat(40);
const sha256 = (target) => crypto.createHash('sha256')
    .update(fs.readFileSync(target)).digest('hex');
function candidateAttestation() {
    return {
        signer_repository: 'Botond1/3D-Printer-Slicer-API',
        signer_workflow: '.github/workflows/candidate-publication.yml',
        source_ref: 'refs/heads/main', source_digest: CANDIDATE_SHA,
        issuer: 'https://token.actions.githubusercontent.com',
        provenance_predicate: 'https://slsa.dev/provenance/v1',
        sbom_predicate: 'https://spdx.dev/Document/v2.3'
    };
}
function createManifest() {
    const policy = loadReleaseRehearsalPolicy(ROOT).value;
    return buildStagingRehearsalManifest({
        schema_version: MANIFEST_SCHEMA_VERSION,
        repository: policy.repository,
        platform: policy.platform,
        artifact: {
            publication_workflow_name: policy.candidate.publication_workflow_name,
            publication_workflow_path: policy.candidate.publication_workflow_path,
            publication_workflow_id: '123456', publication_event: 'workflow_dispatch',
            publication_conclusion: 'success', publication_run_id: '32670000001',
            publication_run_attempt: '1', artifact_id: '987654321',
            artifact_name: `i11-main-signed-candidate-${CANDIDATE_SHA}-32670000001-1`,
            artifact_digest: `sha256:${'3'.repeat(64)}`, content_sha256: '4'.repeat(64),
            publication_evidence_sha256: '5'.repeat(64), policy_sha256: '6'.repeat(64)
        },
        compatibility: {
            previous_source_sha: policy.previous.source_sha,
            candidate_source_sha: CANDIDATE_SHA, previous_is_ancestor: true,
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
function legacyImage(value, role) {
    return {
        role, source_sha: value.source_sha, digest: value.digest,
        config_digest: value.config_digest, configured_user: value.configured_user,
        service_uid: '999', service_gid: '999'
    };
}
function legacyDraft(value, manifestPath) {
    return {
        schema_version: LEGACY_DRAFT_SCHEMA,
        source: {
            repository: 'https://github.com/Botond1/3D-Printer-Slicer-API',
            repository_slug: 'Botond1/3D-Printer-Slicer-API', sha: value.candidate.source_sha,
            ref: 'refs/heads/codex/i9-s3b-staging-rollback-foundation'
        },
        workflow: {
            name: 'S3b Ephemeral Staging and Rollback Rehearsal (NO DEPLOY)',
            path: '.github/workflows/staging-rollback-rehearsal.yml',
            run_id: '32680000001', run_attempt: '1', job: 'staging-rollback-rehearsal'
        },
        manifest: {
            sha256: sha256(manifestPath), platform: 'linux/amd64',
            previous_requalified: true, candidate_verified: true, distinct_digests: true
        },
        images: {
            repository: value.repository,
            previous: legacyImage(
                value.previous, 'ephemeral_previous_fixture_requalified'
            ),
            candidate: legacyImage(value.candidate, 'signed_candidate_verified')
        },
        phase_order: [
            'previous_initial_ready', 'candidate_promoted_ready',
            'candidate_storage_failure_observed', 'automatic_rollback_started',
            'previous_restored_ready', 'runtime_cleanup_complete'
        ],
        previous_initial: ready('b', 101, value.previous.config_digest),
        candidate_promoted: ready('c', 202, value.candidate.config_digest),
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
            readiness: ready('d', 303, value.previous.config_digest)
        },
        cleanup: {
            containers_removed: true, network_removed: true,
            local_digest_refs_removed: true, temporary_state_removed: true,
            remote_digests_preserved: true, result: 'success'
        },
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only',
            result: 'I9_STAGING_REHEARSAL_EVIDENCE_READY'
        },
        deployed_digest: 'not_applicable_ephemeral_no_deploy'
    };
}

function mutateDraft(fixture, mutate) {
    const target = path.join(fixture.evidenceRoot, INPUT_FILE);
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    mutate(value);
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture() {
    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-writer-'));
    const inputRoot = path.join(runnerTemp, 'rehearsal-input');
    const evidenceRoot = path.join(runnerTemp, 'staging-evidence');
    fs.mkdirSync(inputRoot, {mode: 0o700});
    fs.mkdirSync(evidenceRoot, {mode: 0o700});
    const value = createManifest();
    const manifestPath = path.join(inputRoot, MANIFEST_FILE);
    fs.writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.writeFileSync(
        path.join(evidenceRoot, INPUT_FILE),
        `${JSON.stringify(legacyDraft(value, manifestPath), null, 2)}\n`
    );
    const environment = {
        RUNNER_TEMP: runnerTemp,
        REHEARSAL_INPUT_DIR: inputRoot,
        STAGING_REHEARSAL_MANIFEST: manifestPath,
        EVIDENCE_SUBDIR: path.basename(evidenceRoot),
        EVIDENCE_DIR: evidenceRoot,
        GITHUB_REPOSITORY: 'Botond1/3D-Printer-Slicer-API',
        GITHUB_WORKFLOW: EXACT_WORKFLOW,
        GITHUB_WORKFLOW_REF:
            `Botond1/3D-Printer-Slicer-API/${EXACT_WORKFLOW_PATH}@refs/heads/main`,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_JOB: 'staging-rollback-rehearsal',
        GITHUB_RUN_ID: '32680000001',
        GITHUB_RUN_ATTEMPT: '1',
        CANDIDATE_SHA,
        SLICER_UID: '999', SLICER_GID: '999'
    };
    for (const name of REQUIRED_OUTCOMES) environment[name] = 'success';
    return {environment, evidenceRoot, inputRoot, manifestPath, runnerTemp, value};
}

test('writer transforms the compatibility draft into stable artifact-bound evidence', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    const evidence = buildFromRepository(fixture.environment);
    assert.equal(evidence.source.ref, 'refs/heads/main');
    assert.equal(evidence.publication.artifact_id, fixture.value.artifact.artifact_id);
    assert.equal(evidence.images.candidate.attestation.source_ref, 'refs/heads/main');
    assert.deepEqual([evidence.images.previous.service_uid,
        evidence.images.previous.service_gid, evidence.images.candidate.service_uid,
        evidence.images.candidate.service_gid], ['999', '999', '999', '999']);
    const target = writeEvidence(fixture.environment);
    assert.equal(target, path.join(fixture.evidenceRoot, EVIDENCE_FILE));
    assert.throws(
        () => writeEvidence(fixture.environment),
        (error) => error.code === 'staging_evidence_output_boundary_failure'
    );
});
test('writer rejects failed gates and compatibility-draft identity drift', async (t) => {
    const cases = [
        ['failed gate', (fixture) => {
            fixture.environment.ATTESTATION_VERIFICATION_OUTCOME = 'failure';
        }, 'staging_evidence_gate_outcome_failure'],
        ['candidate digest drift', (fixture) => {
            mutateDraft(fixture, (value) => {
                value.images.candidate.digest = `sha256:${'f'.repeat(64)}`;
            });
        }, 'staging_runtime_draft_identity_mismatch'],
        ['candidate UID drift', (fixture) => {
            mutateDraft(fixture, (value) => { value.images.candidate.service_uid = '1000'; });
        }, 'staging_runtime_draft_identity_mismatch'],
        ['previous GID drift', (fixture) => {
            mutateDraft(fixture, (value) => { value.images.previous.service_gid = '1000'; });
        }, 'staging_runtime_draft_identity_mismatch'],
        ['both draft identities drift from the environment', (fixture) => {
            mutateDraft(fixture, (value) => {
                for (const image of [value.images.previous, value.images.candidate]) {
                    image.service_uid = '1000'; image.service_gid = '1000';
                }
            });
        }, 'staging_runtime_draft_identity_mismatch'],
        ['missing UID environment', (fixture) => {
            delete fixture.environment.SLICER_UID;
        }, 'staging_evidence_service_identity_mismatch'],
        ['malformed GID environment', (fixture) => {
            fixture.environment.SLICER_GID = '0999';
        }, 'staging_evidence_service_identity_mismatch'],
        ['root UID environment', (fixture) => {
            fixture.environment.SLICER_UID = '0';
        }, 'staging_evidence_service_identity_mismatch'],
        ['root GID environment', (fixture) => {
            fixture.environment.SLICER_GID = '0';
        }, 'staging_evidence_service_identity_mismatch'],
        ['manifest path drift', (fixture) => {
            fixture.environment.STAGING_REHEARSAL_MANIFEST = fixture.manifestPath + '-other';
        }, 'staging_manifest_path_mismatch'],
        ['hosted workflow drift', (fixture) => {
            fixture.environment.GITHUB_WORKFLOW = 'Other';
        }, 'staging_evidence_hosted_identity_mismatch']
    ];
    for (const [name, mutate, code] of cases) await t.test(name, () => {
        const fixture = createFixture();
        t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
        mutate(fixture);
        assert.throws(
            () => buildFromRepository(fixture.environment),
            (error) => error.code === code
        );
    });
});
