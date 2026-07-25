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
    SPDX_PREDICATE
} = require('../../../scripts/i8-publication-evidence');
const {
    OUTPUT_FILE,
    REQUIRED_OUTCOMES,
    buildFromRepository,
    writeEvidence
} = require('../../../scripts/i8-write-publication-evidence');

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const LOCAL_ID = `sha256:${'a'.repeat(64)}`;
const REGISTRY_DIGEST = `sha256:${'b'.repeat(64)}`;
const DISCOVERY_TAG = `candidate-${SOURCE_SHA}`;

function sha256(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function environment(runnerTemp, subdir) {
    const env = {
        RUNNER_TEMP: runnerTemp,
        EVIDENCE_SUBDIR: subdir,
        EVIDENCE_DIR: path.resolve(runnerTemp, subdir),
        GITHUB_REPOSITORY: EXACT_REPOSITORY_SLUG,
        GITHUB_WORKFLOW: EXACT_WORKFLOW,
        GITHUB_WORKFLOW_REF:
            `${EXACT_REPOSITORY_SLUG}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`,
        GITHUB_REF: EXACT_SOURCE_REF,
        GITHUB_RUN_ID: '30160000001',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'publish-candidate',
        CANDIDATE_SHA: SOURCE_SHA,
        EXPECTED_LOCAL_IMAGE_ID: LOCAL_ID,
        REGISTRY_REPOSITORY: EXACT_GHCR_REPOSITORY,
        REGISTRY_DIGEST,
        DISCOVERY_TAG
    };
    for (const name of REQUIRED_OUTCOMES) env[name] = 'success';
    return env;
}

function attestation(kind) {
    const provenance = kind === 'provenance';
    return {
        id: provenance ? '123456789' : '987654321',
        url: `https://github.com/${EXACT_REPOSITORY_SLUG}/attestations/${
            provenance ? '123456789' : '987654321'
        }`,
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

function draft(env, evidenceRoot) {
    const dockerfile = path.join(ROOT, 'Dockerfile');
    const packageJson = path.join(ROOT, 'package.json');
    const packageLock = path.join(ROOT, 'package-lock.json');
    const sbom = path.join(evidenceRoot, 'sbom.spdx.json');
    const grype = path.join(evidenceRoot, 'grype.json');
    return {
        schema_version: SCHEMA_VERSION,
        source: {
            repository: EXACT_SOURCE_REPOSITORY,
            repository_slug: EXACT_REPOSITORY_SLUG,
            sha: env.CANDIDATE_SHA,
            ref: env.GITHUB_REF
        },
        workflow: {
            name: env.GITHUB_WORKFLOW,
            path: EXACT_WORKFLOW_PATH,
            run_id: env.GITHUB_RUN_ID,
            run_attempt: env.GITHUB_RUN_ATTEMPT,
            job: env.GITHUB_JOB
        },
        build_inputs: {
            dockerfile_sha256: sha256(dockerfile),
            package_json_sha256: sha256(packageJson),
            package_lock_sha256: sha256(packageLock),
            platform: 'linux/amd64',
            build_count: 1
        },
        image: {
            local_id: env.EXPECTED_LOCAL_IMAGE_ID,
            identity_scope: 'run_local_config_digest_not_registry_manifest',
            configured_user: 'slicer',
            service_uid: '999',
            service_gid: '999'
        },
        registry: {
            repository: env.REGISTRY_REPOSITORY,
            discovery_tag: env.DISCOVERY_TAG,
            digest: env.REGISTRY_DIGEST,
            subject: `${env.REGISTRY_REPOSITORY}@${env.REGISTRY_DIGEST}`,
            manifest_digest: env.REGISTRY_DIGEST,
            config_digest: env.EXPECTED_LOCAL_IMAGE_ID,
            source_revision: env.CANDIDATE_SHA,
            platform: 'linux/amd64',
            configured_user: 'slicer',
            tag_points_to_digest: true
        },
        sbom: {file_sha256: sha256(sbom), spdx_version: 'SPDX-2.3'},
        scanner: {
            file_sha256: sha256(grype),
            name: 'grype',
            version: '0.110.0',
            database_timestamp: '2026-07-25T06:59:38Z',
            high: 0,
            critical: 0,
            known_swiper_advisory: 0
        },
        gates: {
            runtime_identity: true,
            orca_cli_smoke: true,
            browser_smoke: true,
            live_abort_no_artifact: true,
            private_peer: true,
            no_host_port: true,
            no_default_route: true,
            api_egress_denied: true,
            native_egress_denied: true,
            sbom: true,
            grype: true,
            artifact_boundary: true,
            prepublication_complete: true
        },
        round_trip: {
            local_image_removed_before_pull: true,
            pulled_by_digest: true,
            pulled_image_id: env.EXPECTED_LOCAL_IMAGE_ID,
            pulled_config_matches_build: true,
            kernel_uid: '999',
            kernel_gid: '999',
            liveness: true,
            orca_cli_smoke: true,
            production_compose_digest: true,
            tag_digest_match: true
        },
        attestations: {
            provenance: attestation('provenance'),
            sbom: attestation('sbom')
        },
        verification: {
            issuer: SIGSTORE_ISSUER,
            certificate_identity:
                `${EXACT_SOURCE_REPOSITORY}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`,
            exact_digest: true,
            exact_repository: true,
            exact_workflow: true,
            exact_ref: true,
            exact_source: true,
            wrong_digest_rejected: true,
            wrong_repository_rejected: true,
            result: 'success'
        },
        publication: {
            gate_completed_before_login: true,
            tag_absent_before_push: true,
            same_image_pushed: true,
            second_build_absent: true,
            mutable_tag_absent: true,
            overwrite_absent: true,
            remote_digest_preserved: true,
            status: 'published_attested_verified'
        },
        cleanup: {
            containers_removed: true,
            networks_removed: true,
            local_tags_removed: true,
            local_digest_image_removed: true,
            temporary_bundles_removed: true,
            bounded_evidence_only: true,
            remote_candidate_preserved: true,
            result: 'success'
        },
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only',
            result: 'I8_SIGNED_CANDIDATE_COMPLETE'
        },
        deployed_digest: 'not_applicable_no_deploy'
    };
}

function createFixture() {
    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'i8-publication-'));
    const subdir = 'evidence-1';
    const evidenceRoot = path.join(runnerTemp, subdir);
    fs.mkdirSync(evidenceRoot, {mode: 0o700});
    fs.writeFileSync(path.join(evidenceRoot, 'sbom.spdx.json'), JSON.stringify({
        spdxVersion: 'SPDX-2.3',
        SPDXID: 'SPDXRef-DOCUMENT',
        packages: []
    }));
    fs.writeFileSync(path.join(evidenceRoot, 'grype.json'), JSON.stringify({
        descriptor: {
            name: 'grype',
            version: '0.110.0',
            db: {status: {built: '2026-07-25T06:59:38Z'}}
        },
        matches: []
    }));
    const env = environment(runnerTemp, subdir);
    fs.writeFileSync(
        path.join(evidenceRoot, 'i8-publication-draft.json'),
        `${JSON.stringify(draft(env, evidenceRoot), null, 2)}\n`
    );
    return {env, evidenceRoot, runnerTemp};
}

function rewriteDraft(fixture, mutate) {
    const target = path.join(fixture.evidenceRoot, 'i8-publication-draft.json');
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    mutate(value);
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

test('writer correlates repository files, SBOM, Grype, hosted identity, and all outcomes', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    const evidence = buildFromRepository(fixture.env);
    assert.equal(evidence.source.sha, SOURCE_SHA);
    assert.equal(evidence.image.local_id, LOCAL_ID);
    assert.equal(evidence.registry.digest, REGISTRY_DIGEST);
    assert.equal(evidence.sbom.file_sha256, sha256(path.join(
        fixture.evidenceRoot, 'sbom.spdx.json'
    )));
    assert.equal(evidence.scanner.file_sha256, sha256(path.join(
        fixture.evidenceRoot, 'grype.json'
    )));
});

test('writer rejects a failed or missing gate despite a successful-looking draft', (t) => {
    for (const outcome of REQUIRED_OUTCOMES) {
        const fixture = createFixture();
        t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
        fixture.env[outcome] = outcome === 'CLEANUP_OUTCOME' ? 'failure' : '';
        assert.throws(
            () => buildFromRepository(fixture.env),
            (error) => error.code === 'i8_evidence_gate_outcome_failure',
            outcome
        );
    }
});

test('writer rejects hosted workflow, ref, repository, SHA, build, digest, and tag mismatch', (t) => {
    const cases = [
        ['repository', (fixture) => { fixture.env.GITHUB_REPOSITORY = 'other/repo'; },
            'i8_evidence_hosted_identity_mismatch'],
        ['workflow', (fixture) => { fixture.env.GITHUB_WORKFLOW = 'Other'; },
            'i8_evidence_hosted_identity_mismatch'],
        ['workflow ref', (fixture) => { fixture.env.GITHUB_WORKFLOW_REF += '-wrong'; },
            'i8_evidence_hosted_identity_mismatch'],
        ['source ref', (fixture) => { fixture.env.GITHUB_REF = 'refs/heads/main'; },
            'i8_evidence_hosted_identity_mismatch'],
        ['source SHA', (fixture) => { fixture.env.CANDIDATE_SHA = '9'.repeat(40); },
            'expected_identity_mismatch'],
        ['local image', (fixture) => {
            fixture.env.EXPECTED_LOCAL_IMAGE_ID = `sha256:${'c'.repeat(64)}`;
        }, 'expected_identity_mismatch'],
        ['registry digest', (fixture) => {
            fixture.env.REGISTRY_DIGEST = `sha256:${'c'.repeat(64)}`;
        }, 'expected_identity_mismatch'],
        ['tag', (fixture) => {
            fixture.env.DISCOVERY_TAG = `candidate-${'9'.repeat(40)}`;
        }, 'expected_identity_mismatch']
    ];
    for (const [name, mutate, code] of cases) {
        const fixture = createFixture();
        t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
        mutate(fixture);
        assert.throws(() => buildFromRepository(fixture.env), (error) => error.code === code, name);
    }
});

test('writer recomputes lock, SBOM, Grype hashes and scanner findings', (t) => {
    const cases = [
        ['lock draft hash', (fixture) => rewriteDraft(fixture, (value) => {
            value.build_inputs.package_lock_sha256 = '9'.repeat(64);
        })],
        ['SBOM file changed', (fixture) => fs.appendFileSync(
            path.join(fixture.evidenceRoot, 'sbom.spdx.json'), ' '
        )],
        ['Grype file changed', (fixture) => fs.appendFileSync(
            path.join(fixture.evidenceRoot, 'grype.json'), ' '
        )],
        ['Grype finding hidden', (fixture) => {
            const target = path.join(fixture.evidenceRoot, 'grype.json');
            const report = JSON.parse(fs.readFileSync(target, 'utf8'));
            report.matches.push({
                vulnerability: {id: 'CVE-TEST', severity: 'high'},
                artifact: {name: 'test-package'}
            });
            fs.writeFileSync(target, JSON.stringify(report));
            rewriteDraft(fixture, (value) => {
                value.scanner.file_sha256 = sha256(target);
            });
        }]
    ];
    for (const [name, mutate] of cases) {
        const fixture = createFixture();
        t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
        mutate(fixture);
        assert.throws(
            () => buildFromRepository(fixture.env),
            (error) => error.code === 'i8_evidence_computed_input_mismatch',
            name
        );
    }
});

test('writer creates one bounded exclusive output and rejects overwrite', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    const target = writeEvidence(fixture.env);
    assert.equal(target, path.join(fixture.evidenceRoot, OUTPUT_FILE));
    const details = fs.lstatSync(target);
    assert.ok(details.isFile());
    assert.ok(!details.isSymbolicLink());
    assert.ok(details.size > 0 && details.size < 96 * 1024);
    assert.throws(
        () => writeEvidence(fixture.env),
        (error) => error.code === 'i8_evidence_output_boundary_failure'
    );
});

test('writer rejects evidence roots outside the exact runner temp subdirectory', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    fixture.env.EVIDENCE_SUBDIR = 'other';
    assert.throws(
        () => buildFromRepository(fixture.env),
        (error) => error.code === 'i8_evidence_root_mismatch'
    );
});
