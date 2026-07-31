'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_RELATIVE_PATH = '.github/i9-staging-rehearsal.json';
const MANIFEST_SCHEMA_VERSION = 'i9-s3b-ephemeral-staging-rehearsal-manifest-v1';
const MAX_MANIFEST_BYTES = 16 * 1024;
const EXACT_GHCR_REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const IMAGE_KEYS = Object.freeze([
    'role', 'source_sha', 'digest', 'config_digest', 'discovery_tag'
]);
const POLICY_KEYS = Object.freeze([
    'platform', 'distinct_digests_required',
    'previous_fresh_attestation_verification_required',
    'candidate_fresh_attestation_verification_required', 'mutable_tags_forbidden',
    'registry_writes_forbidden', 'deploy_forbidden'
]);
const MANIFEST_KEYS = Object.freeze([
    'schema_version', 'repository', 'previous', 'candidate', 'policy'
]);
const HEX_40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function exactKeys(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateImage(value, role) {
    if (!exactKeys(value, IMAGE_KEYS)) return 'manifest_image_schema_mismatch';
    if (value.role !== role || !HEX_40.test(value.source_sha)
        || !DIGEST.test(value.digest) || !DIGEST.test(value.config_digest)
        || value.digest === value.config_digest
        || value.discovery_tag !== `candidate-${value.source_sha}`) {
        return 'manifest_image_identity_malformed';
    }
    return null;
}

function validateStagingManifest(value) {
    if (!exactKeys(value, MANIFEST_KEYS)) return 'manifest_schema_mismatch';
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
        || value.repository !== EXACT_GHCR_REPOSITORY) {
        return 'manifest_identity_mismatch';
    }
    const imageError = validateImage(
        value.previous, 'ephemeral_previous_fixture_requalification_required'
    ) || validateImage(value.candidate, 'signed_candidate');
    if (imageError) return imageError;
    if (value.previous.source_sha === value.candidate.source_sha
        || value.previous.digest === value.candidate.digest
        || value.previous.config_digest === value.candidate.config_digest) {
        return 'manifest_images_not_distinct';
    }
    if (!exactKeys(value.policy, POLICY_KEYS)) return 'manifest_policy_schema_mismatch';
    if (value.policy.platform !== 'linux/amd64'
        || POLICY_KEYS.filter((key) => key !== 'platform')
            .some((key) => value.policy[key] !== true)) {
        return 'manifest_policy_mismatch';
    }
    return null;
}

function loadStagingManifest(repositoryRoot = path.resolve(__dirname, '..')) {
    const realRoot = fs.realpathSync(repositoryRoot);
    const target = path.resolve(realRoot, MANIFEST_RELATIVE_PATH);
    let details;
    try {
        details = fs.lstatSync(target);
    } catch {
        throw new Error('manifest_file_boundary_failure');
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
        || details.size > MAX_MANIFEST_BYTES || fs.realpathSync(target) !== target
        || !target.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error('manifest_file_boundary_failure');
    }
    let value;
    try {
        value = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        throw new Error('manifest_json_parse_failure');
    }
    const error = validateStagingManifest(value);
    if (error) throw new Error(error);
    const freeze = (item) => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
        for (const child of Object.values(item)) freeze(child);
        return Object.freeze(item);
    };
    return Object.freeze({path: target, value: freeze(value)});
}

module.exports = Object.freeze({
    EXACT_GHCR_REPOSITORY,
    IMAGE_KEYS,
    MANIFEST_KEYS,
    MANIFEST_RELATIVE_PATH,
    MANIFEST_SCHEMA_VERSION,
    MAX_MANIFEST_BYTES,
    POLICY_KEYS,
    loadStagingManifest,
    validateStagingManifest
});
