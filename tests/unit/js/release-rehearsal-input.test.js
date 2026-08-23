'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    EXACT_GHCR_REPOSITORY,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REF,
    EXACT_SOURCE_REPOSITORY,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    PROVENANCE_PREDICATE,
    SCHEMA_VERSION,
    SIGSTORE_ISSUER,
    SPDX_PREDICATE,
    buildPublicationEvidence
} = require('../../../scripts/i11-publication-evidence');
const {
    ARTIFACT_LIMITS,
    EXACT_PUBLICATION_JOB,
    materializeReleaseRehearsalInput
} = require('../../../scripts/release-rehearsal-input');
const {MANIFEST_FILE, loadStagingRehearsalManifest} =
    require('../../../scripts/staging-rehearsal-manifest');
const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const PREVIOUS_SHA = '1fffab87960c675a053ae814d374cab331fbb14d';
const LOCAL_ID = `sha256:${'a'.repeat(64)}`;
const REGISTRY_DIGEST = `sha256:${'b'.repeat(64)}`;
const [RUN_ID, RUN_ATTEMPT] = ['32670000001', '1'];
const sha256 = (target) => crypto.createHash('sha256')
    .update(fs.readFileSync(target)).digest('hex');
function trueFields(names) {
    return Object.fromEntries(names.map((name) => [name, true]));
}
function attestation(kind) {
    const provenance = kind === 'provenance';
    return {
        id: provenance ? '123456789' : '987654321',
        url: `https://github.com/${EXACT_REPOSITORY_SLUG}/attestations/`
            + (provenance ? '123456789' : '987654321'),
        bundle_sha256: provenance ? 'e'.repeat(64) : 'f'.repeat(64),
        predicate_type: provenance ? PROVENANCE_PREDICATE : SPDX_PREDICATE,
        subject_name: EXACT_GHCR_REPOSITORY,
        subject_digest: REGISTRY_DIGEST,
        signer_repository: EXACT_REPOSITORY_SLUG,
        signer_workflow: EXACT_WORKFLOW_PATH,
        source_ref: EXACT_SOURCE_REF,
        source_digest: SOURCE_SHA,
        push_to_registry: true,
        github_api_verified: true,
        oci_verified: true,
        offline_bundle_verified: true,
        signature_verified: true,
        verification_reason: 'success'
    };
}
function publicationEvidence(artifactRoot) {
    const sbomHash = sha256(path.join(artifactRoot, 'sbom.spdx.json'));
    const grypeHash = sha256(path.join(artifactRoot, 'grype.json'));
    return buildPublicationEvidence({
        schema_version: SCHEMA_VERSION,
        source: {repository: EXACT_SOURCE_REPOSITORY, repository_slug: EXACT_REPOSITORY_SLUG,
            sha: SOURCE_SHA, ref: EXACT_SOURCE_REF},
        workflow: {name: EXACT_WORKFLOW, path: EXACT_WORKFLOW_PATH, run_id: RUN_ID,
            run_attempt: RUN_ATTEMPT, job: EXACT_PUBLICATION_JOB},
        build_inputs: {
            dockerfile_sha256: '1'.repeat(64), package_json_sha256: '2'.repeat(64),
            package_lock_sha256: '3'.repeat(64), platform: 'linux/amd64', build_count: 1
        },
        image: {
            local_id: LOCAL_ID,
            identity_scope: 'run_local_config_digest_not_registry_manifest',
            configured_user: 'slicer', service_uid: '999', service_gid: '999'
        },
        registry: {
            repository: EXACT_GHCR_REPOSITORY, discovery_tag: `candidate-${SOURCE_SHA}`,
            digest: REGISTRY_DIGEST,
            subject: `${EXACT_GHCR_REPOSITORY}@${REGISTRY_DIGEST}`,
            manifest_digest: REGISTRY_DIGEST, config_digest: LOCAL_ID,
            source_revision: SOURCE_SHA, platform: 'linux/amd64',
            configured_user: 'slicer', tag_points_to_digest: true
        },
        sbom: {file_sha256: sbomHash, spdx_version: 'SPDX-2.3'},
        scanner: {
            file_sha256: grypeHash,
            name: 'grype',
            version: '0.110.0',
            database_timestamp: '2026-07-25T06:59:38Z',
            high: 0,
            critical: 0,
            known_swiper_advisory: 0
        },
        gates: trueFields([
            'runtime_identity', 'orca_cli_smoke', 'browser_smoke',
            'live_abort_no_artifact', 'private_peer', 'no_host_port',
            'no_default_route', 'api_egress_denied', 'native_egress_denied',
            'sbom', 'grype', 'artifact_boundary', 'prepublication_complete'
        ]),
        round_trip: {
            ...trueFields([
                'local_image_removed_before_pull', 'pulled_by_digest',
                'pulled_config_matches_build', 'liveness', 'orca_cli_smoke',
                'production_compose_digest', 'tag_digest_match'
            ]),
            pulled_image_id: LOCAL_ID, kernel_uid: '999', kernel_gid: '999'
        },
        attestations: {provenance: attestation('provenance'), sbom: attestation('sbom')},
        verification: {
            issuer: SIGSTORE_ISSUER,
            certificate_identity:
                `${EXACT_SOURCE_REPOSITORY}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`,
            ...trueFields([
                'exact_digest', 'exact_repository', 'exact_workflow', 'exact_ref',
                'exact_source', 'wrong_digest_rejected', 'wrong_repository_rejected'
            ]),
            result: 'success'
        },
        publication: {
            ...trueFields([
                'gate_completed_before_login', 'tag_absent_before_push',
                'same_image_pushed', 'second_build_absent', 'mutable_tag_absent',
                'overwrite_absent', 'remote_digest_preserved',
                'candidate_manifest_write_performed'
            ]),
            status: 'published_attested_verified',
            mode: 'publish_new', existing_exact_digest_verified: false
        },
        cleanup: {
            ...trueFields([
                'containers_removed', 'networks_removed', 'local_tags_removed',
                'local_digest_image_removed', 'temporary_bundles_removed',
                'bounded_evidence_only', 'remote_candidate_preserved'
            ]),
            result: 'success'
        },
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only',
            result: 'I11_MAIN_CANDIDATE_EVIDENCE_READY'
        },
        deployed_digest: 'not_applicable_no_deploy'
    });
}
function metadata() {
    return {
        repository_slug: EXACT_REPOSITORY_SLUG,
        workflow_name: EXACT_WORKFLOW,
        workflow_path: EXACT_WORKFLOW_PATH,
        workflow_id: '24681012',
        event: 'workflow_dispatch',
        conclusion: 'success',
        head_branch: 'main',
        head_sha: SOURCE_SHA,
        run_id: RUN_ID,
        run_attempt: RUN_ATTEMPT,
        artifact_id: '1357911',
        artifact_name: `i11-main-signed-candidate-${SOURCE_SHA}-${RUN_ID}-${RUN_ATTEMPT}`,
        artifact_digest: `sha256:${'c'.repeat(64)}`
    };
}
function compatibilityVerifier(root, previous, candidate) {
    assert.deepEqual([root, previous, candidate], [ROOT, PREVIOUS_SHA, SOURCE_SHA]);
    return {previous_source_sha: previous, candidate_source_sha: candidate,
        previous_is_ancestor: true, configs_unchanged: true, production_compose_unchanged: true};
}
function createFixture() {
    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-input-'));
    const artifactRoot = path.join(runnerTemp, 'publication-artifact');
    const outputRoot = path.join(runnerTemp, 'rehearsal-input');
    fs.mkdirSync(artifactRoot, {mode: 0o700});
    const contents = {
        'image-identity.txt': `candidate_sha=${SOURCE_SHA}\n`,
        'runtime-diagnostics.json': '{"classification":"success"}\n',
        'topology-evidence.json': '{"classification":"success"}\n',
        'sbom.spdx.json': '{"spdxVersion":"SPDX-2.3"}\n',
        'grype.json': '{"descriptor":{"name":"grype"},"matches":[]}\n'
    };
    for (const [name, content] of Object.entries(contents)) {
        fs.writeFileSync(path.join(artifactRoot, name), content);
    }
    fs.writeFileSync(
        path.join(artifactRoot, 'i11-main-candidate-provenance.json'),
        `${JSON.stringify(publicationEvidence(artifactRoot), null, 2)}\n`
    );
    assert.deepEqual(fs.readdirSync(artifactRoot).sort(), Object.keys(ARTIFACT_LIMITS).sort());
    return {artifactRoot, outputRoot, runnerTemp, metadata: metadata()};
}
test('materializer binds the exact successful publication artifact to a tag-free manifest', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    const result = materializeReleaseRehearsalInput({
        repositoryRoot: ROOT,
        runnerTemp: fixture.runnerTemp,
        artifactRoot: fixture.artifactRoot,
        outputRoot: fixture.outputRoot,
        metadata: fixture.metadata,
        compatibilityVerifier
    });
    assert.equal(result.path, path.join(fixture.outputRoot, MANIFEST_FILE));
    const manifest = loadStagingRehearsalManifest(result.path).value;
    assert.equal(manifest.candidate.source_sha, SOURCE_SHA);
    assert.equal(manifest.candidate.digest, REGISTRY_DIGEST);
    assert.equal(manifest.artifact.artifact_id, fixture.metadata.artifact_id);
    assert.equal(manifest.artifact.publication_workflow_id, fixture.metadata.workflow_id);
    assert.equal(Object.hasOwn(manifest.candidate, 'discovery_tag'), false);
    assert.equal(Object.hasOwn(manifest.previous, 'discovery_tag'), false);
});

test('materializer fails closed on artifact, metadata, evidence job, and output drift', async (t) => {
    const cases = [
        ['extra artifact file', (fixture) => {
            fs.writeFileSync(path.join(fixture.artifactRoot, 'extra.txt'), 'unexpected');
        }, 'artifact_allowlist_mismatch'],
        ['SBOM changed after evidence', (fixture) => {
            fs.appendFileSync(path.join(fixture.artifactRoot, 'sbom.spdx.json'), ' ');
        }, 'publication_artifact_hash_mismatch'],
        ['artifact name changed', (fixture) => {
            fixture.metadata.artifact_name += '-wrong';
        }, 'publication_metadata_identity_mismatch'],
        ['publication failed', (fixture) => {
            fixture.metadata.conclusion = 'failure';
        }, 'publication_metadata_identity_mismatch'],
        ['output already exists', (fixture) => {
            fs.mkdirSync(fixture.outputRoot);
        }, 'rehearsal_input_root_boundary_failure'],
        ['publication evidence job changed', (fixture) => {
            const target = path.join(fixture.artifactRoot, 'i11-main-candidate-provenance.json');
            const evidence = JSON.parse(fs.readFileSync(target, 'utf8'));
            evidence.workflow.job = 'publish-candidate';
            fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
        }, 'expected_identity_mismatch']
    ];
    for (const [name, mutate, code] of cases) await t.test(name, () => {
        const fixture = createFixture();
        t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
        mutate(fixture);
        assert.throws(() => materializeReleaseRehearsalInput({
            repositoryRoot: ROOT,
            runnerTemp: fixture.runnerTemp,
            artifactRoot: fixture.artifactRoot,
            outputRoot: fixture.outputRoot,
            metadata: fixture.metadata,
            compatibilityVerifier
        }), (error) => error.code === code);
    });
});
