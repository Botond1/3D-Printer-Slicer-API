'use strict';

const {
    ARTIFACT_KEYS,
    ATTESTATION_KEYS,
    EXACT_GHCR_REPOSITORY,
    EXACT_MAIN_REF,
    EXACT_PUBLICATION_WORKFLOW,
    EXACT_PUBLICATION_WORKFLOW_PATH,
    EXACT_REPOSITORY_SLUG,
    PROVENANCE_PREDICATE,
    SIGSTORE_ISSUER,
    SPDX_PREDICATE
} = require('./staging-rehearsal-manifest');

const SCHEMA_VERSION = 'signed-main-candidate-ephemeral-staging-rollback-evidence-v1';
const EVIDENCE_FILE = 'signed-main-candidate-staging-rollback-evidence.json';
const MAX_EVIDENCE_BYTES = 64 * 1024;
const EXACT_SOURCE_REPOSITORY = 'https://github.com/Botond1/3D-Printer-Slicer-API';
const EXACT_WORKFLOW = 'Signed Main Candidate Ephemeral Rehearsal (NO DEPLOY)';
const EXACT_WORKFLOW_PATH = '.github/workflows/staging-rollback-rehearsal.yml';
const EXACT_JOB = 'staging-rollback-rehearsal';
const AGGREGATOR_RESULT = 'SIGNED_MAIN_CANDIDATE_REHEARSAL_EVIDENCE_READY';
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
        'schema_version', 'source', 'workflow', 'publication', 'manifest', 'images',
        'phase_order', 'previous_initial', 'candidate_promoted', 'failure_injection',
        'rollback', 'cleanup', 'aggregator', 'deployed_digest'
    ]),
    source: Object.freeze(['repository', 'repository_slug', 'sha', 'ref']),
    workflow: Object.freeze(['name', 'path', 'run_id', 'run_attempt', 'job']),
    publication: ARTIFACT_KEYS,
    manifest: Object.freeze([
        'sha256', 'policy_sha256', 'publication_evidence_sha256',
        'artifact_content_sha256', 'platform', 'previous_requalified',
        'candidate_verified', 'distinct_digests', 'digest_only', 'source_ancestry',
        'configs_unchanged', 'production_compose_unchanged'
    ]),
    images: Object.freeze(['repository', 'previous', 'candidate']),
    image: Object.freeze([
        'role', 'source_sha', 'digest', 'config_digest', 'configured_user',
        'service_uid', 'service_gid', 'attestation'
    ]),
    attestation: ATTESTATION_KEYS,
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

const EXPECTED_KEYS = Object.freeze([
    'repository', 'rehearsal_sha', 'run_id', 'run_attempt', 'job',
    'manifest_sha256', 'policy_sha256', 'publication_evidence_sha256',
    'artifact_content_sha256', 'publication_run_id', 'publication_run_attempt',
    'publication_artifact_id', 'publication_artifact_digest',
    'candidate_source_sha', 'candidate_registry_digest', 'candidate_config_digest',
    'previous_source_sha', 'previous_registry_digest', 'previous_config_digest'
]);

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const SOURCE_REF = /^refs\/heads\/[A-Za-z0-9._/-]{1,200}$/;

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
        || !HEX_40.test(value.sha || '') || value.ref !== EXACT_MAIN_REF) {
        return 'source_identity_mismatch';
    }
    return null;
}

function validateWorkflow(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.workflow)) return 'workflow_schema_mismatch';
    if (value.name !== EXACT_WORKFLOW || value.path !== EXACT_WORKFLOW_PATH
        || value.job !== EXACT_JOB || !canonicalPositiveInteger(value.run_id)
        || !canonicalPositiveInteger(value.run_attempt)) return 'workflow_identity_mismatch';
    return null;
}

function validatePublication(value, candidate) {
    if (!exactKeys(value, EVIDENCE_KEYS.publication)) return 'publication_schema_mismatch';
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
        || value.artifact_name !== expectedName || !DIGEST.test(value.artifact_digest || '')
        || !HEX_64.test(value.content_sha256 || '')
        || !HEX_64.test(value.publication_evidence_sha256 || '')
        || !HEX_64.test(value.policy_sha256 || '')) {
        return 'publication_identity_mismatch';
    }
    return null;
}

function validateManifest(value, publication) {
    if (!exactKeys(value, EVIDENCE_KEYS.manifest)) return 'manifest_schema_mismatch';
    if (!HEX_64.test(value.sha256 || '') || value.policy_sha256 !== publication.policy_sha256
        || value.publication_evidence_sha256 !== publication.publication_evidence_sha256
        || value.artifact_content_sha256 !== publication.content_sha256
        || value.platform !== 'linux/amd64'
        || !allTrue(value, [
            'previous_requalified', 'candidate_verified', 'distinct_digests', 'digest_only',
            'source_ancestry', 'configs_unchanged', 'production_compose_unchanged'
        ])) return 'manifest_proof_mismatch';
    return null;
}

function validateAttestation(value, image, requireMain) {
    if (!exactKeys(value, EVIDENCE_KEYS.attestation)) {
        return 'image_attestation_schema_mismatch';
    }
    if (value.signer_repository !== EXACT_REPOSITORY_SLUG
        || value.signer_workflow !== EXACT_PUBLICATION_WORKFLOW_PATH
        || !SOURCE_REF.test(value.source_ref || '')
        || (requireMain && value.source_ref !== EXACT_MAIN_REF)
        || value.source_digest !== image.source_sha || value.issuer !== SIGSTORE_ISSUER
        || value.provenance_predicate !== PROVENANCE_PREDICATE
        || value.sbom_predicate !== SPDX_PREDICATE) {
        return 'image_attestation_identity_mismatch';
    }
    return null;
}

function validateImage(value, role, requireMain) {
    if (!exactKeys(value, EVIDENCE_KEYS.image)) return 'image_schema_mismatch';
    if (value.role !== role || !HEX_40.test(value.source_sha || '')
        || !DIGEST.test(value.digest || '') || !DIGEST.test(value.config_digest || '')
        || value.digest === value.config_digest || value.configured_user !== 'slicer'
        || !canonicalPositiveInteger(value.service_uid)
        || !canonicalPositiveInteger(value.service_gid)) return 'image_identity_mismatch';
    return validateAttestation(value.attestation, value, requireMain);
}

function validateImages(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.images)) return 'images_schema_mismatch';
    if (value.repository !== EXACT_GHCR_REPOSITORY) return 'image_repository_mismatch';
    const error = validateImage(
        value.previous, 'previous_signed_candidate_requalified', false
    ) || validateImage(value.candidate, 'signed_main_candidate_verified', true);
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
    const booleans = [
        'docker_healthy', 'liveness', 'minimal_readiness', 'operations_readiness',
        'detailed_readiness', 'python_available', 'queue_idle', 'auth_rejection',
        'orca_smoke'
    ];
    if (!CONTAINER_ID.test(value.container_id || '')
        || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || value.image_id !== image.config_digest
        || value.kernel_uid !== image.service_uid || value.kernel_gid !== image.service_gid
        || value.consecutive_passes !== 2 || !allTrue(value, booleans)
        || value.result !== 'success') return 'readiness_proof_mismatch';
    return null;
}

function validateFailureInjection(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.failure_injection)) {
        return 'failure_injection_schema_mismatch';
    }
    const booleans = [
        'liveness_preserved', 'fresh_detailed_503', 'storage_probe_failed',
        'minimal_readiness_503', 'operations_readiness_503',
        'cache_expiry_bounded', 'automatic_rollback_triggered'
    ];
    if (value.target !== 'pricing_state_writability'
        || value.mode_before !== '0700' || value.mode_injected !== '0500'
        || value.mode_restored !== '0700' || value.reason_code !== 'STORAGE_UNSAFE'
        || !allTrue(value, booleans)
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
        ]) || transition.result !== 'success') return 'rollback_transition_mismatch';
    return validateReadiness(value.readiness, images.previous);
}

function validateCleanup(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.cleanup)) return 'cleanup_schema_mismatch';
    const booleans = EVIDENCE_KEYS.cleanup.filter((key) => key !== 'result');
    return allTrue(value, booleans) && value.result === 'success'
        ? null : 'cleanup_proof_mismatch';
}

function validateExpected(value, expected) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)
        || Object.keys(expected).some((key) => !EXPECTED_KEYS.includes(key))) {
        return 'expected_identity_malformed';
    }
    const comparisons = [
        ['repository', value.source.repository_slug],
        ['rehearsal_sha', value.source.sha],
        ['run_id', value.workflow.run_id],
        ['run_attempt', value.workflow.run_attempt],
        ['job', value.workflow.job],
        ['manifest_sha256', value.manifest.sha256],
        ['policy_sha256', value.manifest.policy_sha256],
        ['publication_evidence_sha256', value.manifest.publication_evidence_sha256],
        ['artifact_content_sha256', value.manifest.artifact_content_sha256],
        ['publication_run_id', value.publication.publication_run_id],
        ['publication_run_attempt', value.publication.publication_run_attempt],
        ['publication_artifact_id', value.publication.artifact_id],
        ['publication_artifact_digest', value.publication.artifact_digest],
        ['previous_source_sha', value.images.previous.source_sha],
        ['previous_registry_digest', value.images.previous.digest],
        ['previous_config_digest', value.images.previous.config_digest],
        ['candidate_source_sha', value.images.candidate.source_sha],
        ['candidate_registry_digest', value.images.candidate.digest],
        ['candidate_config_digest', value.images.candidate.config_digest]
    ];
    for (const [key, actual] of comparisons) {
        if (Object.hasOwn(expected, key) && expected[key] !== actual) {
            return 'expected_identity_mismatch';
        }
    }
    return null;
}

function validateStagingRehearsalEvidence(value, expected = {}) {
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
    const identityError = validateSource(value.source) || validateWorkflow(value.workflow)
        || validateImages(value.images) || validatePublication(
            value.publication, value.images.candidate
        ) || validateManifest(value.manifest, value.publication);
    if (identityError) return identityError;
    if (JSON.stringify(value.phase_order) !== JSON.stringify(EXACT_PHASE_ORDER)) {
        return 'phase_order_mismatch';
    }
    const proofError = validateReadiness(value.previous_initial, value.images.previous)
        || validateReadiness(value.candidate_promoted, value.images.candidate)
        || validateFailureInjection(value.failure_injection)
        || validateRollback(value.rollback, value.images)
        || validateCleanup(value.cleanup);
    if (proofError) return proofError;
    if (!exactKeys(value.aggregator, EVIDENCE_KEYS.aggregator)
        || value.aggregator.evidence_boundary !== 'bounded_allowlist_only'
        || value.aggregator.result !== AGGREGATOR_RESULT) return 'aggregator_proof_mismatch';
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

function buildStagingRehearsalEvidence(input) {
    let value;
    try {
        value = JSON.parse(JSON.stringify(input));
    } catch {
        throw new TypeError('staging rehearsal evidence input must be JSON serializable');
    }
    const error = validateStagingRehearsalEvidence(value);
    if (error) throw new TypeError(error);
    const freeze = (item) => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
        for (const child of Object.values(item)) freeze(child);
        return Object.freeze(item);
    };
    return freeze(value);
}

module.exports = Object.freeze({
    AGGREGATOR_RESULT,
    EVIDENCE_FILE,
    EVIDENCE_KEYS,
    EXACT_JOB,
    EXACT_PHASE_ORDER,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REPOSITORY,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    EXPECTED_KEYS,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildStagingRehearsalEvidence,
    validateStagingRehearsalEvidence
});
