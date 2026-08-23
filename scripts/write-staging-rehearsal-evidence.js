'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    EXACT_GHCR_REPOSITORY,
    EXACT_MAIN_REF,
    MANIFEST_FILE,
    loadStagingRehearsalManifest
} = require('./staging-rehearsal-manifest');
const {
    AGGREGATOR_RESULT,
    EVIDENCE_FILE,
    EXACT_JOB,
    EXACT_PHASE_ORDER,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REPOSITORY,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildStagingRehearsalEvidence,
    validateStagingRehearsalEvidence
} = require('./staging-rehearsal-evidence');

const INPUT_FILE = 'i9-staging-runtime-draft.json';
const LEGACY_DRAFT_SCHEMA = 'i9-s3b-ephemeral-staging-rollback-evidence-v1';
const LEGACY_DRAFT_KEYS = Object.freeze([
    'schema_version', 'source', 'workflow', 'manifest', 'images', 'phase_order',
    'previous_initial', 'candidate_promoted', 'failure_injection', 'rollback',
    'cleanup', 'aggregator', 'deployed_digest'
]);
const REQUIRED_OUTCOMES = Object.freeze([
    'REHEARSAL_INPUT_OUTCOME', 'REGISTRY_IDENTITY_OUTCOME',
    'ATTESTATION_VERIFICATION_OUTCOME', 'VERIFICATION_CLEANUP_OUTCOME',
    'REHEARSAL_OUTCOME', 'REHEARSAL_CLASSIFICATION', 'ROLLBACK_CLASSIFICATION',
    'RUNTIME_CLEANUP_CLASSIFICATION'
]);
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function exactKeys(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sha256(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function requireSuccessfulOutcomes(environment) {
    if (REQUIRED_OUTCOMES.some((name) => environment[name] !== 'success')) {
        fail('staging_evidence_gate_outcome_failure');
    }
}

function serviceIdentityFromEnvironment(environment) {
    const valid = (value) => typeof value === 'string' && POSITIVE_DECIMAL.test(value)
        && Number.isSafeInteger(Number(value));
    if (!valid(environment.SLICER_UID) || !valid(environment.SLICER_GID)) {
        fail('staging_evidence_service_identity_mismatch');
    }
    return Object.freeze({uid: environment.SLICER_UID, gid: environment.SLICER_GID});
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

function evidenceRootFromEnvironment(environment) {
    if (!environment.RUNNER_TEMP || !environment.EVIDENCE_SUBDIR
        || !environment.EVIDENCE_DIR
        || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(environment.EVIDENCE_SUBDIR)) {
        fail('staging_evidence_root_mismatch');
    }
    const expected = path.resolve(environment.RUNNER_TEMP, environment.EVIDENCE_SUBDIR);
    if (path.resolve(environment.EVIDENCE_DIR) !== expected) {
        fail('staging_evidence_root_mismatch');
    }
    return directChildDirectory(
        environment.RUNNER_TEMP, expected, 'staging_evidence_root_mismatch'
    );
}

function regularContainedFile(root, name, maxBytes) {
    const target = path.join(root, name);
    let details;
    try {
        details = fs.lstatSync(target);
    } catch {
        fail('staging_evidence_input_boundary_failure');
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
        || details.size > maxBytes || path.dirname(fs.realpathSync(target)) !== root) {
        fail('staging_evidence_input_boundary_failure');
    }
    return target;
}

function loadRuntimeManifest(environment) {
    if (!environment.REHEARSAL_INPUT_DIR || !environment.STAGING_REHEARSAL_MANIFEST) {
        fail('staging_manifest_path_mismatch');
    }
    const inputRoot = directChildDirectory(
        environment.RUNNER_TEMP, environment.REHEARSAL_INPUT_DIR,
        'staging_manifest_path_mismatch'
    );
    const expected = path.join(inputRoot, MANIFEST_FILE);
    if (path.resolve(environment.STAGING_REHEARSAL_MANIFEST) !== expected) {
        fail('staging_manifest_path_mismatch');
    }
    return loadStagingRehearsalManifest(expected);
}

function parseJson(target) {
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        fail('staging_evidence_json_parse_failure');
    }
}

function matchingLegacyImage(actual, expected, role, serviceIdentity) {
    const keys = [
        'role', 'source_sha', 'digest', 'config_digest', 'configured_user',
        'service_uid', 'service_gid'
    ];
    return exactKeys(actual, keys) && actual.role === role
        && actual.source_sha === expected.source_sha && actual.digest === expected.digest
        && actual.config_digest === expected.config_digest
        && actual.configured_user === expected.configured_user
        && actual.service_uid === serviceIdentity?.uid
        && actual.service_gid === serviceIdentity?.gid;
}

function requireLegacyDraft(draft, manifestPath, manifest, serviceIdentity) {
    if (!exactKeys(draft, LEGACY_DRAFT_KEYS)
        || draft.schema_version !== LEGACY_DRAFT_SCHEMA
        || draft.source?.sha !== manifest.candidate.source_sha
        || draft.images?.repository !== EXACT_GHCR_REPOSITORY
        || !matchingLegacyImage(
            draft.images?.previous, manifest.previous,
            'ephemeral_previous_fixture_requalified', serviceIdentity
        )
        || !matchingLegacyImage(
            draft.images?.candidate, manifest.candidate, 'signed_candidate_verified',
            serviceIdentity
        )
        || draft.images.previous.service_uid !== draft.images.candidate.service_uid
        || draft.images.previous.service_gid !== draft.images.candidate.service_gid
        || draft.manifest?.sha256 !== sha256(manifestPath)
        || JSON.stringify(draft.phase_order) !== JSON.stringify(EXACT_PHASE_ORDER)
        || draft.aggregator?.evidence_boundary !== 'bounded_allowlist_only'
        || draft.aggregator?.result !== 'I9_STAGING_REHEARSAL_EVIDENCE_READY'
        || draft.deployed_digest !== 'not_applicable_ephemeral_no_deploy') {
        fail('staging_runtime_draft_identity_mismatch');
    }
}

function evidenceImage(draftImage, manifestImage, role) {
    return {
        role,
        source_sha: manifestImage.source_sha,
        digest: manifestImage.digest,
        config_digest: manifestImage.config_digest,
        configured_user: manifestImage.configured_user,
        service_uid: draftImage.service_uid,
        service_gid: draftImage.service_gid,
        attestation: JSON.parse(JSON.stringify(manifestImage.attestation))
    };
}

function expectedFromEnvironment(environment, manifestPath, manifest) {
    serviceIdentityFromEnvironment(environment);
    if (environment.GITHUB_REPOSITORY !== EXACT_REPOSITORY_SLUG
        || environment.GITHUB_WORKFLOW !== EXACT_WORKFLOW
        || environment.GITHUB_WORKFLOW_REF
            !== `${EXACT_REPOSITORY_SLUG}/${EXACT_WORKFLOW_PATH}@${EXACT_MAIN_REF}`
        || environment.GITHUB_REF !== EXACT_MAIN_REF
        || environment.GITHUB_JOB !== EXACT_JOB
        || environment.CANDIDATE_SHA !== manifest.candidate.source_sha) {
        fail('staging_evidence_hosted_identity_mismatch');
    }
    return {
        repository: environment.GITHUB_REPOSITORY,
        rehearsal_sha: environment.CANDIDATE_SHA,
        run_id: environment.GITHUB_RUN_ID,
        run_attempt: environment.GITHUB_RUN_ATTEMPT,
        job: environment.GITHUB_JOB,
        manifest_sha256: sha256(manifestPath),
        policy_sha256: manifest.artifact.policy_sha256,
        publication_evidence_sha256: manifest.artifact.publication_evidence_sha256,
        artifact_content_sha256: manifest.artifact.content_sha256,
        publication_run_id: manifest.artifact.publication_run_id,
        publication_run_attempt: manifest.artifact.publication_run_attempt,
        publication_artifact_id: manifest.artifact.artifact_id,
        publication_artifact_digest: manifest.artifact.artifact_digest,
        previous_source_sha: manifest.previous.source_sha,
        previous_registry_digest: manifest.previous.digest,
        previous_config_digest: manifest.previous.config_digest,
        candidate_source_sha: manifest.candidate.source_sha,
        candidate_registry_digest: manifest.candidate.digest,
        candidate_config_digest: manifest.candidate.config_digest
    };
}

function transformDraft(draft, manifestPath, manifest, environment) {
    const previous = evidenceImage(
        draft.images.previous, manifest.previous, 'previous_signed_candidate_requalified'
    );
    const candidate = evidenceImage(
        draft.images.candidate, manifest.candidate, 'signed_main_candidate_verified'
    );
    return buildStagingRehearsalEvidence({
        schema_version: SCHEMA_VERSION,
        source: {
            repository: EXACT_SOURCE_REPOSITORY,
            repository_slug: EXACT_REPOSITORY_SLUG,
            sha: manifest.candidate.source_sha,
            ref: EXACT_MAIN_REF
        },
        workflow: {
            name: environment.GITHUB_WORKFLOW,
            path: EXACT_WORKFLOW_PATH,
            run_id: environment.GITHUB_RUN_ID,
            run_attempt: environment.GITHUB_RUN_ATTEMPT,
            job: environment.GITHUB_JOB
        },
        publication: JSON.parse(JSON.stringify(manifest.artifact)),
        manifest: {
            sha256: sha256(manifestPath),
            policy_sha256: manifest.artifact.policy_sha256,
            publication_evidence_sha256: manifest.artifact.publication_evidence_sha256,
            artifact_content_sha256: manifest.artifact.content_sha256,
            platform: 'linux/amd64',
            previous_requalified: true,
            candidate_verified: true,
            distinct_digests: true,
            digest_only: true,
            source_ancestry: manifest.compatibility.previous_is_ancestor,
            configs_unchanged: manifest.compatibility.configs_unchanged,
            production_compose_unchanged: manifest.compatibility.production_compose_unchanged
        },
        images: {repository: EXACT_GHCR_REPOSITORY, previous, candidate},
        phase_order: [...EXACT_PHASE_ORDER],
        previous_initial: draft.previous_initial,
        candidate_promoted: draft.candidate_promoted,
        failure_injection: draft.failure_injection,
        rollback: draft.rollback,
        cleanup: draft.cleanup,
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only', result: AGGREGATOR_RESULT
        },
        deployed_digest: 'not_applicable_ephemeral_no_deploy'
    });
}

function buildFromRepository(environment = process.env) {
    requireSuccessfulOutcomes(environment);
    const evidenceRoot = evidenceRootFromEnvironment(environment);
    const {path: manifestPath, value: manifest} = loadRuntimeManifest(environment);
    const expected = expectedFromEnvironment(environment, manifestPath, manifest);
    const serviceIdentity = {
        uid: environment.SLICER_UID, gid: environment.SLICER_GID
    };
    const draftPath = regularContainedFile(evidenceRoot, INPUT_FILE, 48 * 1024);
    const draft = parseJson(draftPath);
    requireLegacyDraft(draft, manifestPath, manifest, serviceIdentity);
    const evidence = transformDraft(draft, manifestPath, manifest, environment);
    const error = validateStagingRehearsalEvidence(evidence, expected);
    if (error) fail(error);
    return evidence;
}

function writeEvidence(environment = process.env) {
    const evidence = buildFromRepository(environment);
    const evidenceRoot = evidenceRootFromEnvironment(environment);
    const target = path.join(evidenceRoot, EVIDENCE_FILE);
    if (fs.existsSync(target)) fail('staging_evidence_output_boundary_failure');
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) {
        fail('staging_evidence_output_boundary_failure');
    }
    try {
        fs.writeFileSync(target, serialized, {flag: 'wx', mode: 0o600});
        const details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
            || details.size > MAX_EVIDENCE_BYTES
            || path.dirname(fs.realpathSync(target)) !== evidenceRoot) {
            fail('staging_evidence_output_boundary_failure');
        }
    } catch (error) {
        if (error?.code === 'staging_evidence_output_boundary_failure') throw error;
        fail('staging_evidence_output_boundary_failure');
    }
    return target;
}

function main() {
    try {
        writeEvidence();
        console.log('signed_main_candidate_staging_rehearsal_evidence=PASS');
    } catch (error) {
        const code = /^[a-z0-9_]{1,96}$/.test(error?.code || error?.message || '')
            ? (error.code || error.message) : 'staging_evidence_generation_failure';
        console.error(code);
        process.exitCode = 2;
    }
}

if (require.main === module) main();

module.exports = Object.freeze({
    INPUT_FILE,
    LEGACY_DRAFT_KEYS,
    LEGACY_DRAFT_SCHEMA,
    REQUIRED_OUTCOMES,
    buildFromRepository,
    evidenceRootFromEnvironment,
    expectedFromEnvironment,
    requireLegacyDraft,
    serviceIdentityFromEnvironment,
    transformDraft,
    writeEvidence
});
