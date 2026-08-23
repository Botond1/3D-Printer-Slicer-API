'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    MANIFEST_FILE,
    MANIFEST_SCHEMA_VERSION,
    buildStagingRehearsalManifest,
    loadStagingRehearsalManifest,
    validateStagingRehearsalManifest
} = require('../../../scripts/staging-rehearsal-manifest');

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

function controls() {
    return {
        distinct_digests_required: true,
        digest_only_runtime_required: true,
        per_image_attestation_verification_required: true,
        source_ancestry_required: true,
        config_compose_compatibility_required: true,
        registry_writes_forbidden: true,
        mutable_tags_forbidden: true,
        deploy_forbidden: true
    };
}

function validManifest() {
    return {
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
        policy: controls(),
        previous: {
            role: 'previous_signed_candidate',
            source_sha: PREVIOUS_SHA,
            digest: `sha256:${'7'.repeat(64)}`,
            config_digest: `sha256:${'8'.repeat(64)}`,
            configured_user: 'slicer',
            attestation: attestation(PREVIOUS_SHA, 'refs/heads/codex/i8-candidate')
        },
        candidate: {
            role: 'signed_main_candidate',
            source_sha: CANDIDATE_SHA,
            digest: `sha256:${'9'.repeat(64)}`,
            config_digest: `sha256:${'a'.repeat(64)}`,
            configured_user: 'slicer',
            attestation: attestation(CANDIDATE_SHA, 'refs/heads/main')
        }
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test('manifest is immutable, digest-only, artifact-bound, and per-image attested', () => {
    const manifest = buildStagingRehearsalManifest(validManifest());
    assert.ok(Object.isFrozen(manifest));
    assert.ok(Object.isFrozen(manifest.candidate.attestation));
    assert.equal(validateStagingRehearsalManifest(manifest), null);
    assert.equal(Object.hasOwn(manifest.candidate, 'discovery_tag'), false);
    assert.equal(Object.hasOwn(manifest.previous, 'discovery_tag'), false);
    assert.notEqual(manifest.previous.attestation.source_ref, manifest.candidate.attestation.source_ref);
});

test('manifest rejects artifact, digest, identity, attestation, and policy mutations', async (t) => {
    const mutations = [
        ['publication tag injected', (x) => { x.candidate.discovery_tag = 'latest'; }],
        ['artifact SHA mismatch', (x) => { x.artifact.artifact_name += '-wrong'; }],
        ['artifact digest malformed', (x) => { x.artifact.artifact_digest = 'sha256:short'; }],
        ['publication event changed', (x) => { x.artifact.publication_event = 'push'; }],
        ['publication failed', (x) => { x.artifact.publication_conclusion = 'failure'; }],
        ['candidate tag reference', (x) => { x.candidate.digest = 'candidate-latest'; }],
        ['candidate ref changed', (x) => { x.candidate.attestation.source_ref = 'refs/heads/dev'; }],
        ['source digest changed', (x) => { x.candidate.attestation.source_digest = PREVIOUS_SHA; }],
        ['images share digest', (x) => { x.candidate.digest = x.previous.digest; }],
        ['images share config', (x) => { x.candidate.config_digest = x.previous.config_digest; }],
        ['digest-only disabled', (x) => { x.policy.digest_only_runtime_required = false; }],
        ['attestation verification disabled', (x) => {
            x.policy.per_image_attestation_verification_required = false;
        }],
        ['source ancestry absent', (x) => { x.compatibility.previous_is_ancestor = false; }],
        ['configs drifted', (x) => { x.compatibility.configs_unchanged = false; }],
        ['Compose drifted', (x) => { x.compatibility.production_compose_unchanged = false; }],
        ['compatibility disabled', (x) => {
            x.policy.config_compose_compatibility_required = false;
        }],
        ['registry writes enabled', (x) => { x.policy.registry_writes_forbidden = false; }],
        ['unknown root key', (x) => { x.deploy = true; }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(validManifest());
        mutate(value);
        assert.notEqual(validateStagingRehearsalManifest(value), null);
    });
});

test('loader accepts one bounded regular file and rejects malformed input', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-manifest-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const target = path.join(root, MANIFEST_FILE);
    fs.writeFileSync(target, `${JSON.stringify(validManifest(), null, 2)}\n`);
    assert.equal(loadStagingRehearsalManifest(target).value.candidate.source_sha, CANDIDATE_SHA);
    fs.writeFileSync(target, '{');
    assert.throws(() => loadStagingRehearsalManifest(target), /manifest_json_parse_failure/);
});
