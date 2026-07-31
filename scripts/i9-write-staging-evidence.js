'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    EVIDENCE_FILE,
    EXACT_JOB,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REF,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    MAX_EVIDENCE_BYTES,
    buildStagingEvidence,
    validateStagingEvidence
} = require('./i9-staging-evidence');
const {
    loadStagingManifest
} = require('./i9-staging-manifest');

const INPUT_FILE = 'i9-staging-runtime-draft.json';
const REQUIRED_OUTCOMES = Object.freeze([
    'MANIFEST_OUTCOME',
    'REGISTRY_IDENTITY_OUTCOME',
    'ATTESTATION_VERIFICATION_OUTCOME',
    'VERIFICATION_CLEANUP_OUTCOME',
    'REHEARSAL_OUTCOME',
    'REHEARSAL_CLASSIFICATION',
    'ROLLBACK_CLASSIFICATION',
    'RUNTIME_CLEANUP_CLASSIFICATION'
]);

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function sha256(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function requireSuccessfulOutcomes(environment) {
    if (REQUIRED_OUTCOMES.some((name) => environment[name] !== 'success')) {
        fail('i9_evidence_gate_outcome_failure');
    }
}

function evidenceRootFromEnvironment(environment) {
    if (!environment.RUNNER_TEMP || !environment.EVIDENCE_SUBDIR
        || !environment.EVIDENCE_DIR
        || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(environment.EVIDENCE_SUBDIR)) {
        fail('i9_evidence_root_mismatch');
    }
    const runnerTemp = path.resolve(environment.RUNNER_TEMP);
    const expected = path.resolve(runnerTemp, environment.EVIDENCE_SUBDIR);
    if (path.dirname(expected) !== runnerTemp || path.resolve(environment.EVIDENCE_DIR) !== expected) {
        fail('i9_evidence_root_mismatch');
    }
    let details;
    try {
        details = fs.lstatSync(expected);
    } catch {
        fail('i9_evidence_root_mismatch');
    }
    if (!details.isDirectory() || details.isSymbolicLink()
        || fs.realpathSync(expected) !== expected) {
        fail('i9_evidence_root_mismatch');
    }
    return expected;
}

function regularContainedFile(root, name, maxBytes) {
    const target = path.join(root, name);
    let details;
    try {
        details = fs.lstatSync(target);
    } catch {
        fail('i9_evidence_input_boundary_failure');
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
        || details.size > maxBytes || path.dirname(fs.realpathSync(target)) !== root) {
        fail('i9_evidence_input_boundary_failure');
    }
    return target;
}

function parseJson(target) {
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        fail('i9_evidence_json_parse_failure');
    }
}

function expectedFromEnvironment(environment, manifestPath, manifest) {
    if (environment.GITHUB_REPOSITORY !== EXACT_REPOSITORY_SLUG
        || environment.GITHUB_WORKFLOW !== EXACT_WORKFLOW
        || environment.GITHUB_WORKFLOW_REF
            !== `${EXACT_REPOSITORY_SLUG}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`
        || environment.GITHUB_REF !== EXACT_SOURCE_REF
        || environment.GITHUB_JOB !== EXACT_JOB) {
        fail('i9_evidence_hosted_identity_mismatch');
    }
    return {
        repository: environment.GITHUB_REPOSITORY,
        rehearsal_sha: environment.REHEARSAL_SHA,
        run_id: environment.GITHUB_RUN_ID,
        run_attempt: environment.GITHUB_RUN_ATTEMPT,
        job: environment.GITHUB_JOB,
        manifest_sha256: sha256(manifestPath),
        previous_source_sha: manifest.previous.source_sha,
        previous_registry_digest: manifest.previous.digest,
        previous_config_digest: manifest.previous.config_digest,
        current_source_sha: manifest.candidate.source_sha,
        current_registry_digest: manifest.candidate.digest,
        current_config_digest: manifest.candidate.config_digest
    };
}

function buildFromRepository(environment = process.env) {
    requireSuccessfulOutcomes(environment);
    const repositoryRoot = fs.realpathSync(path.resolve(__dirname, '..'));
    const evidenceRoot = evidenceRootFromEnvironment(environment);
    const {path: manifestPath, value: manifest} = loadStagingManifest(repositoryRoot);
    const draftPath = regularContainedFile(evidenceRoot, INPUT_FILE, MAX_EVIDENCE_BYTES);
    const evidence = buildStagingEvidence(parseJson(draftPath));
    const expected = expectedFromEnvironment(environment, manifestPath, manifest);
    const error = validateStagingEvidence(evidence, expected);
    if (error) fail(error);
    return evidence;
}

function writeEvidence(environment = process.env) {
    const evidence = buildFromRepository(environment);
    const evidenceRoot = evidenceRootFromEnvironment(environment);
    const target = path.join(evidenceRoot, EVIDENCE_FILE);
    if (fs.existsSync(target)) fail('i9_evidence_output_boundary_failure');
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) {
        fail('i9_evidence_output_boundary_failure');
    }
    try {
        fs.writeFileSync(target, serialized, {flag: 'wx', mode: 0o600});
        const details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
            || details.size > MAX_EVIDENCE_BYTES
            || path.dirname(fs.realpathSync(target)) !== evidenceRoot) {
            fail('i9_evidence_output_boundary_failure');
        }
    } catch (error) {
        if (error?.code === 'i9_evidence_output_boundary_failure') throw error;
        fail('i9_evidence_output_boundary_failure');
    }
    return target;
}

function main() {
    try {
        writeEvidence();
        console.log('i9_staging_rollback_evidence=PASS');
    } catch (error) {
        const code = /^[a-z0-9_]{1,80}$/.test(error?.code || error?.message || '')
            ? (error.code || error.message) : 'i9_evidence_generation_failure';
        console.error(code);
        process.exitCode = 2;
    }
}

if (require.main === module) main();

module.exports = Object.freeze({
    INPUT_FILE,
    REQUIRED_OUTCOMES,
    buildFromRepository,
    evidenceRootFromEnvironment,
    expectedFromEnvironment,
    writeEvidence
});
