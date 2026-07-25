'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    EXPECTED_CLASSIFICATIONS,
    EXPECTED_OUTCOMES,
    buildFromRepository,
    countScannerFindings,
    scannerIdentity,
    verifyPinnedInputs
} = require('../../../scripts/i7-write-provenance');

const ROOT = path.resolve(__dirname, '../../..');
const SHA = '8daf6ee39be562336ab7b15510b1ac374c366dc1';
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;

function environment(root, subdir) {
    const values = {
        RUNNER_TEMP: root,
        EVIDENCE_SUBDIR: subdir,
        EVIDENCE_DIR: path.resolve(root, subdir),
        GITHUB_REPOSITORY: 'Botond1/3D-Printer-Slicer-API',
        GITHUB_WORKFLOW: 'Image Validation - Build Once (NO PUSH / NO DEPLOY)',
        GITHUB_RUN_ID: '30158571816',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'validate-image',
        CANDIDATE_SHA: SHA,
        IMAGE_REF: `local/slicer-api-validation:${SHA}`,
        EXPECTED_IMAGE_ID: IMAGE_ID,
        CONFIGURED_USER: 'slicer',
        SERVICE_UID: '999',
        SERVICE_GID: '999'
    };
    for (const name of EXPECTED_OUTCOMES) values[name] = 'success';
    for (const [name, value] of Object.entries(EXPECTED_CLASSIFICATIONS)) values[name] = value;
    return values;
}

function identity(env, overrides = {}) {
    const values = {
        candidate_sha: env.CANDIDATE_SHA,
        local_image_ref: env.IMAGE_REF,
        local_image_id: env.EXPECTED_IMAGE_ID,
        build_action_image_id: env.EXPECTED_IMAGE_ID,
        identity_scope: 'run_local_not_registry_digest',
        registry_digest: 'not_created',
        signature: 'not_created',
        attestation: 'not_created',
        configured_user: env.CONFIGURED_USER,
        service_uid: env.SERVICE_UID,
        service_gid: env.SERVICE_GID,
        kernel_uid: env.SERVICE_UID,
        kernel_gid: env.SERVICE_GID,
        ...overrides
    };
    return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

function createFixture(identityOverrides = {}) {
    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'i7-provenance-'));
    const subdir = 'evidence-1';
    const evidenceRoot = path.join(runnerTemp, subdir);
    fs.mkdirSync(evidenceRoot, {mode: 0o700});
    const env = environment(runnerTemp, subdir);
    fs.writeFileSync(path.join(evidenceRoot, 'image-identity.txt'), identity(env, identityOverrides));
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
    fs.writeFileSync(path.join(evidenceRoot, 'topology-evidence.json'), JSON.stringify({
        version: 'i6-s5-private-peer-v1',
        classification: 'success',
        contractReason: 'success',
        privatePeerIngress: true,
        authenticatedReadiness: true,
        authRejectionProof: true,
        apiEgressDenied: true,
        nativeEgressDenied: true,
        hostPortAbsent: true,
        apiNoDefaultRoute: true,
        internalNetwork: true,
        sentinelOperational: true
    }));
    return {env, runnerTemp};
}

test('writer correlates exact identity, scanner database, topology, and successful cleanup', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    const evidence = buildFromRepository(fixture.env);
    assert.equal(evidence.source_sha, SHA);
    assert.equal(evidence.image.id, IMAGE_ID);
    assert.equal(evidence.scanner.database_timestamp, '2026-07-25T06:59:38Z');
    assert.equal(evidence.aggregator.cleanup, 'success');
    assert.equal(evidence.proofs.live_abort_no_artifact_process_settlement, true);
});

test('writer rejects inconsistent identity file fields even when all earlier outcomes say success', (t) => {
    for (const [name, overrides] of [
        ['source SHA', {candidate_sha: 'b'.repeat(40)}],
        ['build image', {build_action_image_id: `sha256:${'b'.repeat(64)}`}],
        ['identity scope', {identity_scope: 'registry_digest'}],
        ['registry status', {registry_digest: 'sha256:created'}],
        ['kernel identity', {kernel_uid: '1000'}]
    ]) {
        const fixture = createFixture(overrides);
        t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
        assert.throws(
            () => buildFromRepository(fixture.env),
            (error) => error.code === 'provenance_image_identity_correlation_failure',
            name
        );
    }
});

test('writer rejects inconsistent gate classifications and uses DB build time, not scan time', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.runnerTemp, {recursive: true, force: true}));
    fixture.env.CLEANUP_CLASSIFICATION = 'cleanup_failure';
    assert.throws(
        () => buildFromRepository(fixture.env),
        (error) => error.code === 'provenance_aggregator_classification_failure'
    );
    assert.deepEqual(scannerIdentity({
        descriptor: {
            name: 'grype',
            version: '0.110.0',
            timestamp: '2026-07-25T12:53:22.374981675Z',
            db: {status: {built: '2026-07-25T06:59:38Z'}}
        }
    }), {
        name: 'grype',
        version: '0.110.0',
        databaseTimestamp: '2026-07-25T06:59:38Z'
    });
    assert.equal(scannerIdentity({
        descriptor: {
            name: 'grype',
            version: '0.110.0',
            db: {built: '2026-07-25T06:59:38Z'}
        }
    }).databaseTimestamp, undefined);
});

test('writer rejects malformed scanner matches instead of treating them as zero findings', () => {
    for (const report of [
        {matches: [{}]},
        {matches: [{vulnerability: {id: 'CVE-1'}, artifact: {name: 'pkg'}}]},
        {matches: [{vulnerability: {id: 'CVE-1', severity: 'urgent'}, artifact: {name: 'pkg'}}]},
        {matches: [{
            vulnerability: {id: 'CVE-1', severity: 'medium'},
            artifact: {name: 'pkg'},
            relatedVulnerabilities: {}
        }]}
    ]) {
        assert.throws(
            () => countScannerFindings(report),
            (error) => error.code === 'provenance_scanner_schema_failure'
        );
    }
});

test('writer binds pin metadata to exact active assignments, not comments or later overrides', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const installer = fs.readFileSync(path.join(ROOT, 'scripts/install-swiper-vendor.py'), 'utf8');
    assert.doesNotThrow(() => verifyPinnedInputs(dockerfile, installer));
    const expectedLine = 'ARG PRUSA_APPIMAGE_SHA256="565f2f4bd4dbb05904a459d54db1916b6932124709c1d17b5aacfe9f5f2f1b03"';
    const decoy = dockerfile.replace(expectedLine, 'ARG PRUSA_APPIMAGE_SHA256="malformed"')
        + `\n# ${expectedLine}\n`;
    assert.throws(
        () => verifyPinnedInputs(decoy, installer),
        (error) => error.code === 'provenance_pinned_input_mismatch'
    );
    assert.throws(
        () => verifyPinnedInputs(`${dockerfile}\nARG PRUSA_APPIMAGE_SHA256="malformed"\n`, installer),
        (error) => error.code === 'provenance_pinned_input_mismatch'
    );
});
