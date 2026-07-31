'use strict';

const {
    EXACT_GHCR_REPOSITORY
} = require('./i9-staging-manifest');

const SCHEMA_VERSION = 'i9-s3b-ephemeral-staging-rollback-evidence-v1';
const EVIDENCE_FILE = 'i9-staging-rollback-evidence.json';
const MAX_EVIDENCE_BYTES = 64 * 1024;
const EXACT_SOURCE_REPOSITORY = 'https://github.com/Botond1/3D-Printer-Slicer-API';
const EXACT_REPOSITORY_SLUG = 'Botond1/3D-Printer-Slicer-API';
const EXACT_SOURCE_REF = 'refs/heads/codex/i9-s3b-staging-rollback-foundation';
const EXACT_WORKFLOW = 'S3b Ephemeral Staging and Rollback Rehearsal (NO DEPLOY)';
const EXACT_WORKFLOW_PATH = '.github/workflows/staging-rollback-rehearsal.yml';
const EXACT_JOB = 'staging-rollback-rehearsal';
const EXACT_PHASE_ORDER = Object.freeze([
    'previous_initial_ready',
    'candidate_promoted_ready',
    'candidate_storage_failure_observed',
    'automatic_rollback_started',
    'previous_restored_ready',
    'runtime_cleanup_complete'
]);

const EVIDENCE_KEYS = Object.freeze({
    root: Object.freeze([
        'schema_version', 'source', 'workflow', 'manifest', 'images', 'phase_order',
        'previous_initial', 'candidate_promoted', 'failure_injection', 'rollback',
        'cleanup', 'aggregator', 'deployed_digest'
    ]),
    source: Object.freeze(['repository', 'repository_slug', 'sha', 'ref']),
    workflow: Object.freeze(['name', 'path', 'run_id', 'run_attempt', 'job']),
    manifest: Object.freeze([
        'sha256', 'platform', 'previous_requalified', 'candidate_verified',
        'distinct_digests'
    ]),
    images: Object.freeze(['repository', 'previous', 'candidate']),
    image: Object.freeze([
        'role', 'source_sha', 'digest', 'config_digest', 'configured_user',
        'service_uid', 'service_gid'
    ]),
    readiness: Object.freeze([
        'container_id', 'pid', 'image_id', 'kernel_uid', 'kernel_gid',
        'consecutive_passes', 'docker_healthy', 'liveness', 'minimal_readiness',
        'operations_readiness', 'detailed_readiness', 'python_available',
        'queue_idle', 'auth_rejection', 'orca_smoke', 'result'
    ]),
    failure_injection: Object.freeze([
        'target', 'mode_before', 'mode_injected', 'mode_restored',
        'liveness_preserved', 'fresh_detailed_503', 'storage_probe_failed',
        'minimal_readiness_503', 'operations_readiness_503', 'reason_code',
        'cache_expiry_bounded', 'automatic_rollback_triggered', 'result'
    ]),
    rollback: Object.freeze(['transition', 'readiness']),
    rollback_transition: Object.freeze([
        'automatic', 'triggered_by', 'restored_digest', 'candidate_removed',
        'previous_restarted', 'state_mode_restored',
        'shared_synthetic_state_preserved', 'result'
    ]),
    cleanup: Object.freeze([
        'containers_removed', 'network_removed', 'local_digest_refs_removed',
        'temporary_state_removed', 'remote_digests_preserved', 'result'
    ]),
    aggregator: Object.freeze(['evidence_boundary', 'result'])
});

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const EXPECTED_KEYS = Object.freeze([
    'repository', 'rehearsal_sha', 'run_id', 'run_attempt', 'job',
    'manifest_sha256', 'current_source_sha', 'current_registry_digest',
    'current_config_digest', 'previous_source_sha', 'previous_registry_digest',
    'previous_config_digest'
]);

function exactKeys(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalPositiveInteger(value) {
    return typeof value === 'string' && POSITIVE_DECIMAL.test(value)
        && Number.isSafeInteger(Number(value));
}

function allTrue(value, keys) {
    return keys.every((key) => value[key] === true);
}

function validateSource(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.source)) return 'source_schema_mismatch';
    if (value.repository !== EXACT_SOURCE_REPOSITORY
        || value.repository_slug !== EXACT_REPOSITORY_SLUG
        || !HEX_40.test(value.sha) || value.ref !== EXACT_SOURCE_REF) {
        return 'source_identity_mismatch';
    }
    return null;
}

function validateWorkflow(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.workflow)) return 'workflow_schema_mismatch';
    if (value.name !== EXACT_WORKFLOW || value.path !== EXACT_WORKFLOW_PATH
        || value.job !== EXACT_JOB || !canonicalPositiveInteger(value.run_id)
        || !canonicalPositiveInteger(value.run_attempt)) {
        return 'workflow_identity_mismatch';
    }
    return null;
}

function validateManifest(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.manifest)) return 'manifest_schema_mismatch';
    if (!HEX_64.test(value.sha256) || value.platform !== 'linux/amd64'
        || !allTrue(value, [
            'previous_requalified', 'candidate_verified', 'distinct_digests'
        ])) {
        return 'manifest_proof_mismatch';
    }
    return null;
}

function validateImage(value, role) {
    if (!exactKeys(value, EVIDENCE_KEYS.image)) return 'image_schema_mismatch';
    if (value.role !== role || !HEX_40.test(value.source_sha)
        || !DIGEST.test(value.digest) || !DIGEST.test(value.config_digest)
        || value.digest === value.config_digest || value.configured_user !== 'slicer'
        || !canonicalPositiveInteger(value.service_uid)
        || !canonicalPositiveInteger(value.service_gid)) {
        return 'image_identity_mismatch';
    }
    return null;
}

function validateImages(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.images)) return 'images_schema_mismatch';
    if (value.repository !== EXACT_GHCR_REPOSITORY) return 'image_repository_mismatch';
    const error = validateImage(
        value.previous, 'ephemeral_previous_fixture_requalified'
    ) || validateImage(value.candidate, 'signed_candidate_verified');
    if (error) return error;
    if (value.previous.source_sha === value.candidate.source_sha
        || value.previous.digest === value.candidate.digest
        || value.previous.config_digest === value.candidate.config_digest) {
        return 'images_not_distinct';
    }
    return null;
}

function validateReadiness(value, image) {
    if (!exactKeys(value, EVIDENCE_KEYS.readiness)) return 'readiness_schema_mismatch';
    const booleanKeys = [
        'docker_healthy', 'liveness', 'minimal_readiness', 'operations_readiness',
        'detailed_readiness', 'python_available', 'queue_idle', 'auth_rejection',
        'orca_smoke'
    ];
    if (!CONTAINER_ID.test(value.container_id)
        || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || value.image_id !== image.config_digest
        || value.kernel_uid !== image.service_uid || value.kernel_gid !== image.service_gid
        || value.consecutive_passes !== 2 || !allTrue(value, booleanKeys)
        || value.result !== 'success') {
        return 'readiness_proof_mismatch';
    }
    return null;
}

function validateFailureInjection(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.failure_injection)) {
        return 'failure_injection_schema_mismatch';
    }
    const booleanKeys = [
        'liveness_preserved', 'fresh_detailed_503', 'storage_probe_failed',
        'minimal_readiness_503', 'operations_readiness_503',
        'cache_expiry_bounded', 'automatic_rollback_triggered'
    ];
    if (value.target !== 'pricing_state_writability'
        || value.mode_before !== '0700' || value.mode_injected !== '0500'
        || value.mode_restored !== '0700' || value.reason_code !== 'STORAGE_UNSAFE'
        || !allTrue(value, booleanKeys)
        || value.result !== 'expected_readiness_failure_observed') {
        return 'failure_injection_proof_mismatch';
    }
    return null;
}

function validateRollback(value, images) {
    if (!exactKeys(value, EVIDENCE_KEYS.rollback)
        || !exactKeys(value.transition, EVIDENCE_KEYS.rollback_transition)) {
        return 'rollback_schema_mismatch';
    }
    const transition = value.transition;
    if (transition.automatic !== true
        || transition.triggered_by !== 'candidate_storage_failure_observed'
        || transition.restored_digest !== images.previous.digest
        || !allTrue(transition, [
            'candidate_removed', 'previous_restarted', 'state_mode_restored',
            'shared_synthetic_state_preserved'
        ]) || transition.result !== 'success') {
        return 'rollback_transition_mismatch';
    }
    return validateReadiness(value.readiness, images.previous);
}

function validateCleanup(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.cleanup)) return 'cleanup_schema_mismatch';
    const booleans = EVIDENCE_KEYS.cleanup.filter((key) => key !== 'result');
    if (!allTrue(value, booleans) || value.result !== 'success') {
        return 'cleanup_proof_mismatch';
    }
    return null;
}

function validateAggregator(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.aggregator)) return 'aggregator_schema_mismatch';
    if (value.evidence_boundary !== 'bounded_allowlist_only'
        || value.result !== 'I9_STAGING_REHEARSAL_EVIDENCE_READY') {
        return 'aggregator_proof_mismatch';
    }
    return null;
}

function validateExpected(value, expected) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
        return 'expected_identity_malformed';
    }
    if (Object.keys(expected).some((key) => !EXPECTED_KEYS.includes(key))) {
        return 'expected_identity_malformed';
    }
    const comparisons = [
        ['repository', value.source.repository_slug],
        ['rehearsal_sha', value.source.sha],
        ['run_id', value.workflow.run_id],
        ['run_attempt', value.workflow.run_attempt],
        ['job', value.workflow.job],
        ['manifest_sha256', value.manifest.sha256],
        ['previous_source_sha', value.images.previous.source_sha],
        ['previous_registry_digest', value.images.previous.digest],
        ['previous_config_digest', value.images.previous.config_digest],
        ['current_source_sha', value.images.candidate.source_sha],
        ['current_registry_digest', value.images.candidate.digest],
        ['current_config_digest', value.images.candidate.config_digest]
    ];
    for (const [key, actual] of comparisons) {
        if (Object.hasOwn(expected, key) && expected[key] !== actual) {
            return 'expected_identity_mismatch';
        }
    }
    return null;
}

function validateStagingEvidence(value, expected = {}) {
    if (!exactKeys(value, EVIDENCE_KEYS.root)) return 'evidence_schema_mismatch';
    let serialized;
    try {
        serialized = `${JSON.stringify(value, null, 2)}\n`;
    } catch {
        return 'evidence_not_serializable';
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) {
        return 'evidence_size_exceeded';
    }
    if (value.schema_version !== SCHEMA_VERSION) return 'evidence_version_mismatch';
    const nestedError = validateSource(value.source)
        || validateWorkflow(value.workflow)
        || validateManifest(value.manifest)
        || validateImages(value.images);
    if (nestedError) return nestedError;
    if (JSON.stringify(value.phase_order) !== JSON.stringify(EXACT_PHASE_ORDER)) {
        return 'phase_order_mismatch';
    }
    const proofError = validateReadiness(value.previous_initial, value.images.previous)
        || validateReadiness(value.candidate_promoted, value.images.candidate)
        || validateFailureInjection(value.failure_injection)
        || validateRollback(value.rollback, value.images)
        || validateCleanup(value.cleanup)
        || validateAggregator(value.aggregator);
    if (proofError) return proofError;
    if (value.previous_initial.container_id === value.candidate_promoted.container_id
        || value.previous_initial.container_id === value.rollback.readiness.container_id
        || value.candidate_promoted.container_id === value.rollback.readiness.container_id
        || value.previous_initial.pid === value.candidate_promoted.pid
        || value.previous_initial.pid === value.rollback.readiness.pid
        || value.candidate_promoted.pid === value.rollback.readiness.pid) {
        return 'runtime_generations_not_distinct';
    }
    if (value.deployed_digest !== 'not_applicable_ephemeral_no_deploy') {
        return 'deployment_boundary_mismatch';
    }
    return validateExpected(value, expected);
}

function buildStagingEvidence(input) {
    let value;
    try {
        value = JSON.parse(JSON.stringify(input));
    } catch {
        throw new TypeError('staging evidence input must be JSON serializable');
    }
    const error = validateStagingEvidence(value);
    if (error) throw new TypeError(error);
    const freeze = (item) => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
        for (const child of Object.values(item)) freeze(child);
        return Object.freeze(item);
    };
    return freeze(value);
}

module.exports = Object.freeze({
    EVIDENCE_FILE,
    EVIDENCE_KEYS,
    EXPECTED_KEYS,
    EXACT_JOB,
    EXACT_PHASE_ORDER,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REF,
    EXACT_SOURCE_REPOSITORY,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildStagingEvidence,
    validateStagingEvidence
});
