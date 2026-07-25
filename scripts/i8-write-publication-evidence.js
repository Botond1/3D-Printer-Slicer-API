'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    EXACT_GHCR_REPOSITORY,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REF,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    MAX_EVIDENCE_BYTES,
    buildPublicationEvidence,
    validatePublicationEvidence
} = require('./i8-publication-evidence');
const {
    countScannerFindings,
    scannerIdentity
} = require('./i7-write-provenance');

const INPUT_FILE = 'i8-publication-draft.json';
const OUTPUT_FILE = 'i8-candidate-provenance.json';
const REQUIRED_OUTCOMES = Object.freeze([
    'PREPUBLICATION_GATE_OUTCOME',
    'RUNTIME_IDENTITY_OUTCOME',
    'ORCA_CLI_SMOKE_OUTCOME',
    'SMOKE_OUTCOME',
    'TOPOLOGY_OUTCOME',
    'DIAGNOSTIC_OUTCOME',
    'SBOM_OUTCOME',
    'SBOM_GATE_OUTCOME',
    'SCAN_OUTCOME',
    'SCAN_GATE_OUTCOME',
    'TRIAGE_OUTCOME',
    'ARTIFACT_BOUNDARY_OUTCOME',
    'REGISTRY_PUSH_OUTCOME',
    'REGISTRY_IDENTITY_OUTCOME',
    'DIGEST_PULL_OUTCOME',
    'DIGEST_RUNTIME_OUTCOME',
    'COMPOSE_ROUNDTRIP_OUTCOME',
    'PROVENANCE_ATTESTATION_OUTCOME',
    'SBOM_ATTESTATION_OUTCOME',
    'ATTESTATION_VERIFICATION_OUTCOME',
    'NEGATIVE_VERIFICATION_OUTCOME',
    'FINAL_TAG_IDENTITY_OUTCOME',
    'CLEANUP_OUTCOME'
]);
const MAX_INPUT_BYTES = Object.freeze({
    [INPUT_FILE]: MAX_EVIDENCE_BYTES,
    'sbom.spdx.json': 16 * 1024 * 1024,
    'grype.json': 100 * 1024 * 1024
});

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function sha256(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function regularContainedFile(root, name, limit) {
    const target = path.join(root, name);
    try {
        const details = fs.lstatSync(target);
        const realRoot = fs.realpathSync(root);
        if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
            || details.size > limit || path.dirname(fs.realpathSync(target)) !== realRoot) {
            fail('i8_evidence_input_boundary_failure');
        }
    } catch (error) {
        if (error?.code === 'i8_evidence_input_boundary_failure') throw error;
        fail('i8_evidence_input_boundary_failure');
    }
    return target;
}

function parseJson(target) {
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        fail('i8_evidence_json_parse_failure');
    }
}

function requireSuccessfulOutcomes(environment) {
    if (REQUIRED_OUTCOMES.some((name) => environment[name] !== 'success')) {
        fail('i8_evidence_gate_outcome_failure');
    }
}

function evidenceRootFromEnvironment(environment) {
    if (!environment.RUNNER_TEMP || !environment.EVIDENCE_SUBDIR
        || !environment.EVIDENCE_DIR) {
        fail('i8_evidence_root_mismatch');
    }
    const expected = path.resolve(environment.RUNNER_TEMP, environment.EVIDENCE_SUBDIR);
    let realExpected;
    try {
        realExpected = fs.realpathSync(expected);
    } catch {
        fail('i8_evidence_root_mismatch');
    }
    if (path.resolve(environment.EVIDENCE_DIR) !== expected
        || fs.realpathSync(environment.EVIDENCE_DIR) !== realExpected
        || fs.lstatSync(expected).isSymbolicLink()) {
        fail('i8_evidence_root_mismatch');
    }
    return realExpected;
}

function repositoryInputs(root) {
    return {
        dockerfile: regularContainedFile(root, 'Dockerfile', 1024 * 1024),
        packageJson: regularContainedFile(root, 'package.json', 1024 * 1024),
        packageLock: regularContainedFile(root, 'package-lock.json', 10 * 1024 * 1024)
    };
}

function expectedFromEnvironment(environment, sbomPath, grypePath) {
    if (environment.GITHUB_REPOSITORY !== EXACT_REPOSITORY_SLUG
        || environment.GITHUB_WORKFLOW !== EXACT_WORKFLOW
        || environment.GITHUB_WORKFLOW_REF
            !== `${EXACT_REPOSITORY_SLUG}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`
        || environment.GITHUB_REF !== EXACT_SOURCE_REF
        || environment.REGISTRY_REPOSITORY !== EXACT_GHCR_REPOSITORY) {
        fail('i8_evidence_hosted_identity_mismatch');
    }
    return {
        source_sha: environment.CANDIDATE_SHA,
        source_ref: environment.GITHUB_REF,
        run_id: environment.GITHUB_RUN_ID,
        run_attempt: environment.GITHUB_RUN_ATTEMPT,
        job: environment.GITHUB_JOB,
        local_image_id: environment.EXPECTED_LOCAL_IMAGE_ID,
        registry_digest: environment.REGISTRY_DIGEST,
        discovery_tag: environment.DISCOVERY_TAG,
        sbom_sha256: sha256(sbomPath),
        grype_sha256: sha256(grypePath)
    };
}

function verifyComputedInputs(evidence, inputs, sbomPath, grypePath) {
    const sbom = parseJson(sbomPath);
    const grype = parseJson(grypePath);
    const scannerCounts = countScannerFindings(grype);
    const scanner = scannerIdentity(grype);
    if (evidence.build_inputs.dockerfile_sha256 !== sha256(inputs.dockerfile)
        || evidence.build_inputs.package_json_sha256 !== sha256(inputs.packageJson)
        || evidence.build_inputs.package_lock_sha256 !== sha256(inputs.packageLock)
        || sbom.spdxVersion !== 'SPDX-2.3'
        || evidence.sbom.file_sha256 !== sha256(sbomPath)
        || evidence.scanner.file_sha256 !== sha256(grypePath)
        || evidence.scanner.name !== scanner.name
        || evidence.scanner.version !== scanner.version
        || evidence.scanner.database_timestamp !== scanner.databaseTimestamp
        || evidence.scanner.high !== scannerCounts.high
        || evidence.scanner.critical !== scannerCounts.critical
        || evidence.scanner.known_swiper_advisory !== scannerCounts.knownSwiper) {
        fail('i8_evidence_computed_input_mismatch');
    }
}

function buildFromRepository(environment = process.env) {
    requireSuccessfulOutcomes(environment);
    const root = fs.realpathSync(path.resolve(__dirname, '..'));
    const evidenceRoot = evidenceRootFromEnvironment(environment);
    const inputs = repositoryInputs(root);
    const draftPath = regularContainedFile(
        evidenceRoot, INPUT_FILE, MAX_INPUT_BYTES[INPUT_FILE]
    );
    const sbomPath = regularContainedFile(
        evidenceRoot, 'sbom.spdx.json', MAX_INPUT_BYTES['sbom.spdx.json']
    );
    const grypePath = regularContainedFile(
        evidenceRoot, 'grype.json', MAX_INPUT_BYTES['grype.json']
    );
    const evidence = buildPublicationEvidence(parseJson(draftPath));
    verifyComputedInputs(evidence, inputs, sbomPath, grypePath);
    const expected = expectedFromEnvironment(environment, sbomPath, grypePath);
    const validationError = validatePublicationEvidence(evidence, expected);
    if (validationError) fail(validationError);
    return evidence;
}

function writeEvidence(environment = process.env) {
    const evidence = buildFromRepository(environment);
    const evidenceRoot = evidenceRootFromEnvironment(environment);
    const target = path.join(evidenceRoot, OUTPUT_FILE);
    if (fs.existsSync(target)) fail('i8_evidence_output_boundary_failure');
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) {
        fail('i8_evidence_output_boundary_failure');
    }
    try {
        fs.writeFileSync(target, serialized, {flag: 'wx', mode: 0o600});
        const details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink()
            || path.dirname(fs.realpathSync(target)) !== evidenceRoot) {
            fail('i8_evidence_output_boundary_failure');
        }
    } catch (error) {
        if (error?.code === 'i8_evidence_output_boundary_failure') throw error;
        fail('i8_evidence_output_boundary_failure');
    }
    return target;
}

function main() {
    try {
        writeEvidence();
        console.log('i8_candidate_provenance=PASS');
    } catch (error) {
        const code = /^[a-z0-9_]{1,80}$/.test(error?.code || error?.message || '')
            ? (error.code || error.message) : 'i8_evidence_generation_failure';
        console.error(code);
        process.exitCode = 2;
    }
}

if (require.main === module) main();

module.exports = Object.freeze({
    INPUT_FILE,
    OUTPUT_FILE,
    REQUIRED_OUTCOMES,
    buildFromRepository,
    evidenceRootFromEnvironment,
    verifyComputedInputs,
    writeEvidence
});
