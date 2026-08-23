'use strict';

const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
    EXACT_GHCR_REPOSITORY,
    EXACT_MAIN_REF,
    EXACT_PUBLICATION_WORKFLOW,
    EXACT_PUBLICATION_WORKFLOW_PATH,
    EXACT_REPOSITORY_SLUG,
    MANIFEST_FILE,
    MANIFEST_SCHEMA_VERSION,
    POLICY_KEYS,
    PROVENANCE_PREDICATE,
    SIGSTORE_ISSUER,
    SPDX_PREDICATE,
    buildStagingRehearsalManifest
} = require('./staging-rehearsal-manifest');
const {
    validatePublicationEvidence
} = require('./i11-publication-evidence');

const POLICY_RELATIVE_PATH = '.github/release-rehearsal-policy.json';
const POLICY_SCHEMA_VERSION = 'signed-main-candidate-release-rehearsal-policy-v1';
const MAX_POLICY_BYTES = 16 * 1024;
const EXACT_PUBLICATION_JOB = 'publication';
const PUBLICATION_EVIDENCE_FILE = 'i11-main-candidate-provenance.json';
const ARTIFACT_LIMITS = Object.freeze({
    [PUBLICATION_EVIDENCE_FILE]: 96 * 1024,
    'image-identity.txt': 4 * 1024,
    'runtime-diagnostics.json': 64 * 1024,
    'topology-evidence.json': 16 * 1024,
    'sbom.spdx.json': 16 * 1024 * 1024,
    'grype.json': 100 * 1024 * 1024
});

const POLICY_ROOT_KEYS = Object.freeze([
    'schema_version', 'repository', 'platform', 'previous', 'candidate', 'controls'
]);
const PREVIOUS_KEYS = Object.freeze([
    'role', 'source_sha', 'digest', 'config_digest', 'configured_user', 'attestation'
]);
const CANDIDATE_KEYS = Object.freeze([
    'role', 'source_ref', 'publication_workflow_name',
    'publication_workflow_path', 'publication_evidence_file'
]);
const ATTESTATION_KEYS = Object.freeze([
    'signer_repository', 'signer_workflow', 'source_ref', 'source_digest', 'issuer',
    'provenance_predicate', 'sbom_predicate'
]);
const METADATA_KEYS = Object.freeze([
    'repository_slug', 'workflow_name', 'workflow_path', 'workflow_id', 'event',
    'conclusion', 'head_branch', 'head_sha', 'run_id', 'run_attempt', 'artifact_id',
    'artifact_name', 'artifact_digest'
]);

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const SOURCE_REF = /^refs\/heads\/[A-Za-z0-9._/-]{1,200}$/;

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function exactKeys(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalPositiveInteger(value) {
    return typeof value === 'string' && POSITIVE_DECIMAL.test(value)
        && Number.isSafeInteger(Number(value));
}

function sha256Buffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(target) {
    return sha256Buffer(fs.readFileSync(target));
}

function validatePolicyAttestation(value, sourceSha) {
    return exactKeys(value, ATTESTATION_KEYS)
        && value.signer_repository === EXACT_REPOSITORY_SLUG
        && value.signer_workflow === EXACT_PUBLICATION_WORKFLOW_PATH
        && SOURCE_REF.test(value.source_ref || '')
        && value.source_digest === sourceSha
        && value.issuer === SIGSTORE_ISSUER
        && value.provenance_predicate === PROVENANCE_PREDICATE
        && value.sbom_predicate === SPDX_PREDICATE;
}

function validateReleaseRehearsalPolicy(value) {
    if (!exactKeys(value, POLICY_ROOT_KEYS)) return 'release_policy_schema_mismatch';
    let serialized;
    try {
        serialized = `${JSON.stringify(value, null, 2)}\n`;
    } catch {
        return 'release_policy_not_serializable';
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_POLICY_BYTES) {
        return 'release_policy_size_exceeded';
    }
    if (value.schema_version !== POLICY_SCHEMA_VERSION
        || value.repository !== EXACT_GHCR_REPOSITORY
        || value.platform !== 'linux/amd64') return 'release_policy_identity_mismatch';
    const previous = value.previous;
    if (!exactKeys(previous, PREVIOUS_KEYS)
        || previous.role !== 'previous_signed_candidate'
        || !HEX_40.test(previous.source_sha || '')
        || !DIGEST.test(previous.digest || '') || !DIGEST.test(previous.config_digest || '')
        || previous.digest === previous.config_digest || previous.configured_user !== 'slicer'
        || !validatePolicyAttestation(previous.attestation, previous.source_sha)) {
        return 'release_policy_previous_mismatch';
    }
    const candidate = value.candidate;
    if (!exactKeys(candidate, CANDIDATE_KEYS)
        || candidate.role !== 'signed_main_candidate'
        || candidate.source_ref !== EXACT_MAIN_REF
        || candidate.publication_workflow_name !== EXACT_PUBLICATION_WORKFLOW
        || candidate.publication_workflow_path !== EXACT_PUBLICATION_WORKFLOW_PATH
        || candidate.publication_evidence_file !== PUBLICATION_EVIDENCE_FILE) {
        return 'release_policy_candidate_mismatch';
    }
    if (!exactKeys(value.controls, POLICY_KEYS)
        || POLICY_KEYS.some((key) => value.controls[key] !== true)) {
        return 'release_policy_controls_mismatch';
    }
    return null;
}

function loadReleaseRehearsalPolicy(repositoryRoot = path.resolve(__dirname, '..')) {
    const root = fs.realpathSync(path.resolve(repositoryRoot));
    const target = path.resolve(root, POLICY_RELATIVE_PATH);
    let details;
    try {
        details = fs.lstatSync(target);
    } catch {
        fail('release_policy_file_boundary_failure');
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
        || details.size > MAX_POLICY_BYTES || fs.realpathSync(target) !== target
        || !target.startsWith(`${root}${path.sep}`)) {
        fail('release_policy_file_boundary_failure');
    }
    const raw = fs.readFileSync(target);
    let value;
    try {
        value = JSON.parse(raw.toString('utf8'));
    } catch {
        fail('release_policy_json_parse_failure');
    }
    const error = validateReleaseRehearsalPolicy(value);
    if (error) fail(error);
    return Object.freeze({path: target, raw, sha256: sha256Buffer(raw), value});
}

function directChildDirectory(parent, target, code) {
    const realParent = fs.realpathSync(path.resolve(parent));
    const resolved = path.resolve(target);
    let details;
    try {
        details = fs.lstatSync(resolved);
    } catch {
        fail(code);
    }
    if (path.dirname(resolved) !== realParent || !details.isDirectory()
        || details.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) fail(code);
    return resolved;
}

function artifactFiles(runnerTemp, artifactRoot) {
    const root = directChildDirectory(runnerTemp, artifactRoot, 'artifact_root_boundary_failure');
    const actual = fs.readdirSync(root).sort();
    const expected = Object.keys(ARTIFACT_LIMITS).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('artifact_allowlist_mismatch');
    const files = {};
    for (const [name, maxBytes] of Object.entries(ARTIFACT_LIMITS)) {
        const target = path.join(root, name);
        const details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
            || details.size > maxBytes || path.dirname(fs.realpathSync(target)) !== root) {
            fail('artifact_file_boundary_failure');
        }
        files[name] = Object.freeze({path: target, size: details.size, sha256: sha256File(target)});
    }
    return Object.freeze({root, files: Object.freeze(files)});
}

function artifactContentSha256(files) {
    const hash = crypto.createHash('sha256');
    for (const name of Object.keys(files).sort()) {
        const file = files[name];
        hash.update(name).update('\0').update(String(file.size)).update('\0')
            .update(file.sha256).update('\n');
    }
    return hash.digest('hex');
}

function parsePublicationEvidence(target) {
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        fail('publication_evidence_json_parse_failure');
    }
}

function validateMetadata(metadata, policy, evidence) {
    if (!exactKeys(metadata, METADATA_KEYS)) fail('publication_metadata_schema_mismatch');
    const expectedName = [
        'i11-main-signed-candidate', metadata.head_sha, metadata.run_id,
        metadata.run_attempt
    ].join('-');
    if (metadata.repository_slug !== EXACT_REPOSITORY_SLUG
        || metadata.workflow_name !== EXACT_PUBLICATION_WORKFLOW
        || metadata.workflow_path !== EXACT_PUBLICATION_WORKFLOW_PATH
        || !canonicalPositiveInteger(metadata.workflow_id)
        || metadata.event !== 'workflow_dispatch' || metadata.conclusion !== 'success'
        || metadata.head_branch !== 'main' || !HEX_40.test(metadata.head_sha || '')
        || !canonicalPositiveInteger(metadata.run_id)
        || !canonicalPositiveInteger(metadata.run_attempt)
        || !canonicalPositiveInteger(metadata.artifact_id)
        || metadata.artifact_name !== expectedName
        || !DIGEST.test(metadata.artifact_digest || '')) {
        fail('publication_metadata_identity_mismatch');
    }
    const error = validatePublicationEvidence(evidence, {
        source_sha: metadata.head_sha,
        source_ref: policy.candidate.source_ref,
        run_id: metadata.run_id,
        run_attempt: metadata.run_attempt,
        job: EXACT_PUBLICATION_JOB
    });
    if (error) fail(error);
}

function candidateAttestation(evidence) {
    const provenance = evidence.attestations.provenance;
    const sbom = evidence.attestations.sbom;
    if (provenance.signer_repository !== sbom.signer_repository
        || provenance.signer_workflow !== sbom.signer_workflow
        || provenance.source_ref !== sbom.source_ref
        || provenance.source_digest !== sbom.source_digest) {
        fail('publication_attestation_identity_mismatch');
    }
    return {
        signer_repository: provenance.signer_repository,
        signer_workflow: provenance.signer_workflow,
        source_ref: provenance.source_ref,
        source_digest: provenance.source_digest,
        issuer: evidence.verification.issuer,
        provenance_predicate: provenance.predicate_type,
        sbom_predicate: sbom.predicate_type
    };
}

function verifySourceCompatibility(repositoryRoot, previousSha, candidateSha, execute = execFileSync) {
    const root = fs.realpathSync(path.resolve(repositoryRoot));
    const run = (args) => {
        try {
            return String(execute('git', args, {
                cwd: root,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 30_000,
                maxBuffer: 256 * 1024
            }) || '').trim();
        } catch {
            fail('source_compatibility_verification_failure');
        }
    };
    if (!HEX_40.test(previousSha || '') || !HEX_40.test(candidateSha || '')
        || previousSha === candidateSha) fail('source_compatibility_verification_failure');
    run(['cat-file', '-e', `${previousSha}^{commit}`]);
    run(['cat-file', '-e', `${candidateSha}^{commit}`]);
    if (run(['rev-parse', 'HEAD']) !== candidateSha) {
        fail('source_compatibility_verification_failure');
    }
    run(['merge-base', '--is-ancestor', previousSha, candidateSha]);
    run(['diff', '--quiet', previousSha, candidateSha, '--', 'configs']);
    run([
        'diff', '--quiet', previousSha, candidateSha, '--',
        'docker-compose.production.yml'
    ]);
    return Object.freeze({
        previous_source_sha: previousSha,
        candidate_source_sha: candidateSha,
        previous_is_ancestor: true,
        configs_unchanged: true,
        production_compose_unchanged: true
    });
}

function buildRuntimeManifest(policyRecord, artifact, metadata, evidence, compatibility) {
    const files = artifact.files;
    if (files['sbom.spdx.json'].sha256 !== evidence.sbom.file_sha256
        || files['grype.json'].sha256 !== evidence.scanner.file_sha256) {
        fail('publication_artifact_hash_mismatch');
    }
    return buildStagingRehearsalManifest({
        schema_version: MANIFEST_SCHEMA_VERSION,
        repository: policyRecord.value.repository,
        platform: policyRecord.value.platform,
        artifact: {
            publication_workflow_name: metadata.workflow_name,
            publication_workflow_path: metadata.workflow_path,
            publication_workflow_id: metadata.workflow_id,
            publication_event: metadata.event,
            publication_conclusion: metadata.conclusion,
            publication_run_id: metadata.run_id,
            publication_run_attempt: metadata.run_attempt,
            artifact_id: metadata.artifact_id,
            artifact_name: metadata.artifact_name,
            artifact_digest: metadata.artifact_digest,
            content_sha256: artifactContentSha256(files),
            publication_evidence_sha256: files[PUBLICATION_EVIDENCE_FILE].sha256,
            policy_sha256: policyRecord.sha256
        },
        compatibility,
        policy: {...policyRecord.value.controls},
        previous: JSON.parse(JSON.stringify(policyRecord.value.previous)),
        candidate: {
            role: policyRecord.value.candidate.role,
            source_sha: evidence.source.sha,
            digest: evidence.registry.digest,
            config_digest: evidence.registry.config_digest,
            configured_user: evidence.registry.configured_user,
            attestation: candidateAttestation(evidence)
        }
    });
}

function createOutputDirectory(runnerTemp, outputRoot) {
    const parent = fs.realpathSync(path.resolve(runnerTemp));
    const resolved = path.resolve(outputRoot);
    if (path.dirname(resolved) !== parent || fs.existsSync(resolved)) {
        fail('rehearsal_input_root_boundary_failure');
    }
    try {
        fs.mkdirSync(resolved, {mode: 0o700});
    } catch {
        fail('rehearsal_input_root_boundary_failure');
    }
    return directChildDirectory(parent, resolved, 'rehearsal_input_root_boundary_failure');
}

function writeRuntimeManifest(outputRoot, manifest) {
    const target = path.join(outputRoot, MANIFEST_FILE);
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    try {
        fs.writeFileSync(target, serialized, {flag: 'wx', mode: 0o600});
        const details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
            || path.dirname(fs.realpathSync(target)) !== outputRoot) {
            fail('rehearsal_manifest_output_boundary_failure');
        }
    } catch (error) {
        if (error?.code === 'rehearsal_manifest_output_boundary_failure') throw error;
        fail('rehearsal_manifest_output_boundary_failure');
    }
    return target;
}

function materializeReleaseRehearsalInput(options) {
    const policy = loadReleaseRehearsalPolicy(options.repositoryRoot);
    const artifact = artifactFiles(options.runnerTemp, options.artifactRoot);
    const evidence = parsePublicationEvidence(artifact.files[PUBLICATION_EVIDENCE_FILE].path);
    validateMetadata(options.metadata, policy.value, evidence);
    const verifier = options.compatibilityVerifier || verifySourceCompatibility;
    const compatibility = verifier(
        options.repositoryRoot, policy.value.previous.source_sha, evidence.source.sha
    );
    const manifest = buildRuntimeManifest(
        policy, artifact, options.metadata, evidence, compatibility
    );
    const outputRoot = createOutputDirectory(options.runnerTemp, options.outputRoot);
    return Object.freeze({
        path: writeRuntimeManifest(outputRoot, manifest), manifest, outputRoot,
        policyPath: policy.path, artifactRoot: artifact.root
    });
}

function optionsFromEnvironment(environment = process.env) {
    const runnerTemp = path.resolve(environment.RUNNER_TEMP || '');
    const artifactRoot = path.resolve(runnerTemp, environment.PUBLICATION_ARTIFACT_SUBDIR || '');
    const outputRoot = path.resolve(runnerTemp, environment.REHEARSAL_INPUT_SUBDIR || '');
    if (environment.PUBLICATION_ARTIFACT_DIR !== artifactRoot
        || environment.REHEARSAL_INPUT_DIR !== outputRoot) {
        fail('rehearsal_environment_path_mismatch');
    }
    return {
        repositoryRoot: path.resolve(__dirname, '..'), runnerTemp, artifactRoot, outputRoot,
        metadata: {
            repository_slug: environment.GITHUB_REPOSITORY,
            workflow_name: environment.PUBLICATION_WORKFLOW_NAME,
            workflow_path: environment.PUBLICATION_WORKFLOW_PATH,
            workflow_id: environment.PUBLICATION_WORKFLOW_ID,
            event: environment.PUBLICATION_EVENT,
            conclusion: environment.PUBLICATION_CONCLUSION,
            head_branch: environment.PUBLICATION_HEAD_BRANCH,
            head_sha: environment.PUBLICATION_HEAD_SHA,
            run_id: environment.PUBLICATION_RUN_ID,
            run_attempt: environment.PUBLICATION_RUN_ATTEMPT,
            artifact_id: environment.PUBLICATION_ARTIFACT_ID,
            artifact_name: environment.PUBLICATION_ARTIFACT_NAME,
            artifact_digest: environment.PUBLICATION_ARTIFACT_DIGEST
        }
    };
}

function main() {
    try {
        materializeReleaseRehearsalInput(optionsFromEnvironment());
        console.log('release_rehearsal_input=PASS');
    } catch (error) {
        const code = /^[a-z0-9_]{1,96}$/.test(error?.code || error?.message || '')
            ? (error.code || error.message) : 'release_rehearsal_input_failure';
        console.error(code);
        process.exitCode = 2;
    }
}

if (require.main === module) main();

module.exports = Object.freeze({
    ARTIFACT_LIMITS,
    CANDIDATE_KEYS,
    EXACT_PUBLICATION_JOB,
    MAX_POLICY_BYTES,
    METADATA_KEYS,
    POLICY_RELATIVE_PATH,
    POLICY_ROOT_KEYS,
    POLICY_SCHEMA_VERSION,
    PREVIOUS_KEYS,
    PUBLICATION_EVIDENCE_FILE,
    artifactContentSha256,
    artifactFiles,
    buildRuntimeManifest,
    loadReleaseRehearsalPolicy,
    materializeReleaseRehearsalInput,
    optionsFromEnvironment,
    verifySourceCompatibility,
    validateReleaseRehearsalPolicy
});
