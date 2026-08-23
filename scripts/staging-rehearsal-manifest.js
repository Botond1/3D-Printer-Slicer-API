'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_SCHEMA_VERSION = 'signed-main-candidate-staging-rehearsal-manifest-v1';
const MANIFEST_FILE = 'signed-main-candidate-staging-rehearsal-manifest.json';
const MAX_MANIFEST_BYTES = 32 * 1024;
const EXACT_GHCR_REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const EXACT_REPOSITORY_SLUG = 'Botond1/3D-Printer-Slicer-API';
const EXACT_PUBLICATION_WORKFLOW = 'Candidate Publication - Signed GHCR (NO DEPLOY)';
const EXACT_PUBLICATION_WORKFLOW_PATH = '.github/workflows/candidate-publication.yml';
const EXACT_MAIN_REF = 'refs/heads/main';
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const SPDX_PREDICATE = 'https://spdx.dev/Document/v2.3';
const SIGSTORE_ISSUER = 'https://token.actions.githubusercontent.com';

const ROOT_KEYS = Object.freeze([
    'schema_version', 'repository', 'platform', 'artifact', 'compatibility', 'policy',
    'previous', 'candidate'
]);
const ARTIFACT_KEYS = Object.freeze([
    'publication_workflow_name', 'publication_workflow_path', 'publication_workflow_id',
    'publication_event', 'publication_conclusion', 'publication_run_id',
    'publication_run_attempt', 'artifact_id', 'artifact_name', 'artifact_digest',
    'content_sha256', 'publication_evidence_sha256', 'policy_sha256'
]);
const IMAGE_KEYS = Object.freeze([
    'role', 'source_sha', 'digest', 'config_digest', 'configured_user', 'attestation'
]);
const ATTESTATION_KEYS = Object.freeze([
    'signer_repository', 'signer_workflow', 'source_ref', 'source_digest', 'issuer',
    'provenance_predicate', 'sbom_predicate'
]);
const POLICY_KEYS = Object.freeze([
    'distinct_digests_required', 'digest_only_runtime_required',
    'per_image_attestation_verification_required', 'source_ancestry_required',
    'config_compose_compatibility_required', 'registry_writes_forbidden',
    'mutable_tags_forbidden', 'deploy_forbidden'
]);
const COMPATIBILITY_KEYS = Object.freeze([
    'previous_source_sha', 'candidate_source_sha', 'previous_is_ancestor',
    'configs_unchanged', 'production_compose_unchanged'
]);

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const SOURCE_REF = /^refs\/heads\/[A-Za-z0-9._/-]{1,200}$/;

function exactKeys(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalPositiveInteger(value) {
    return typeof value === 'string' && POSITIVE_DECIMAL.test(value)
        && Number.isSafeInteger(Number(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function validateAttestation(value, image, requireMain) {
    if (!exactKeys(value, ATTESTATION_KEYS)) return 'manifest_attestation_schema_mismatch';
    if (value.signer_repository !== EXACT_REPOSITORY_SLUG
        || value.signer_workflow !== EXACT_PUBLICATION_WORKFLOW_PATH
        || !SOURCE_REF.test(value.source_ref || '')
        || (requireMain && value.source_ref !== EXACT_MAIN_REF)
        || value.source_digest !== image.source_sha
        || value.issuer !== SIGSTORE_ISSUER
        || value.provenance_predicate !== PROVENANCE_PREDICATE
        || value.sbom_predicate !== SPDX_PREDICATE) {
        return 'manifest_attestation_identity_mismatch';
    }
    return null;
}

function validateImage(value, role, requireMain) {
    if (!exactKeys(value, IMAGE_KEYS)) return 'manifest_image_schema_mismatch';
    if (value.role !== role || !HEX_40.test(value.source_sha || '')
        || !DIGEST.test(value.digest || '') || !DIGEST.test(value.config_digest || '')
        || value.digest === value.config_digest || value.configured_user !== 'slicer') {
        return 'manifest_image_identity_mismatch';
    }
    return validateAttestation(value.attestation, value, requireMain);
}

function validateArtifact(value, candidate) {
    if (!exactKeys(value, ARTIFACT_KEYS)) return 'manifest_artifact_schema_mismatch';
    const expectedName = [
        'i11-main-signed-candidate', candidate.source_sha,
        value.publication_run_id, value.publication_run_attempt
    ].join('-');
    if (value.publication_workflow_name !== EXACT_PUBLICATION_WORKFLOW
        || value.publication_workflow_path !== EXACT_PUBLICATION_WORKFLOW_PATH
        || !canonicalPositiveInteger(value.publication_workflow_id)
        || value.publication_event !== 'workflow_dispatch'
        || value.publication_conclusion !== 'success'
        || !canonicalPositiveInteger(value.publication_run_id)
        || !canonicalPositiveInteger(value.publication_run_attempt)
        || !canonicalPositiveInteger(value.artifact_id)
        || value.artifact_name !== expectedName
        || !DIGEST.test(value.artifact_digest || '')
        || !HEX_64.test(value.content_sha256 || '')
        || !HEX_64.test(value.publication_evidence_sha256 || '')
        || !HEX_64.test(value.policy_sha256 || '')) {
        return 'manifest_artifact_identity_mismatch';
    }
    return null;
}

function validatePolicy(value) {
    if (!exactKeys(value, POLICY_KEYS)) return 'manifest_policy_schema_mismatch';
    return POLICY_KEYS.every((key) => value[key] === true)
        ? null : 'manifest_policy_mismatch';
}

function validateCompatibility(value, previous, candidate) {
    if (!exactKeys(value, COMPATIBILITY_KEYS)) {
        return 'manifest_compatibility_schema_mismatch';
    }
    if (value.previous_source_sha !== previous.source_sha
        || value.candidate_source_sha !== candidate.source_sha
        || value.previous_is_ancestor !== true || value.configs_unchanged !== true
        || value.production_compose_unchanged !== true) {
        return 'manifest_compatibility_mismatch';
    }
    return null;
}

function validateStagingRehearsalManifest(value) {
    if (!exactKeys(value, ROOT_KEYS)) return 'manifest_schema_mismatch';
    let serialized;
    try {
        serialized = `${JSON.stringify(value, null, 2)}\n`;
    } catch {
        return 'manifest_not_serializable';
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) {
        return 'manifest_size_exceeded';
    }
    if (value.schema_version !== MANIFEST_SCHEMA_VERSION
        || value.repository !== EXACT_GHCR_REPOSITORY
        || value.platform !== 'linux/amd64') {
        return 'manifest_identity_mismatch';
    }
    const nestedError = validateImage(
        value.previous, 'previous_signed_candidate', false
    ) || validateImage(value.candidate, 'signed_main_candidate', true)
        || validateArtifact(value.artifact, value.candidate)
        || validateCompatibility(value.compatibility, value.previous, value.candidate)
        || validatePolicy(value.policy);
    if (nestedError) return nestedError;
    if (value.previous.source_sha === value.candidate.source_sha
        || value.previous.digest === value.candidate.digest
        || value.previous.config_digest === value.candidate.config_digest) {
        return 'manifest_images_not_distinct';
    }
    return null;
}

function buildStagingRehearsalManifest(input) {
    let value;
    try {
        value = JSON.parse(JSON.stringify(input));
    } catch {
        throw new TypeError('staging rehearsal manifest input must be JSON serializable');
    }
    const error = validateStagingRehearsalManifest(value);
    if (error) throw new TypeError(error);
    return deepFreeze(value);
}

function loadStagingRehearsalManifest(target) {
    const resolved = path.resolve(target);
    let details;
    try {
        details = fs.lstatSync(resolved);
    } catch {
        throw new Error('manifest_file_boundary_failure');
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
        || details.size > MAX_MANIFEST_BYTES || fs.realpathSync(resolved) !== resolved) {
        throw new Error('manifest_file_boundary_failure');
    }
    let value;
    try {
        value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch {
        throw new Error('manifest_json_parse_failure');
    }
    const error = validateStagingRehearsalManifest(value);
    if (error) throw new Error(error);
    return Object.freeze({path: resolved, value: deepFreeze(value)});
}

module.exports = Object.freeze({
    ARTIFACT_KEYS,
    ATTESTATION_KEYS,
    COMPATIBILITY_KEYS,
    EXACT_GHCR_REPOSITORY,
    EXACT_MAIN_REF,
    EXACT_PUBLICATION_WORKFLOW,
    EXACT_PUBLICATION_WORKFLOW_PATH,
    EXACT_REPOSITORY_SLUG,
    IMAGE_KEYS,
    MANIFEST_FILE,
    MANIFEST_SCHEMA_VERSION,
    MAX_MANIFEST_BYTES,
    POLICY_KEYS,
    PROVENANCE_PREDICATE,
    ROOT_KEYS,
    SIGSTORE_ISSUER,
    SPDX_PREDICATE,
    buildStagingRehearsalManifest,
    loadStagingRehearsalManifest,
    validateStagingRehearsalManifest
});
