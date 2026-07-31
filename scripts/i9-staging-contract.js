'use strict';

const EXACT_GHCR_REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const DIGEST_REFERENCE = new RegExp(
    `^${EXACT_GHCR_REPOSITORY.replace(/[./-]/g, '\\$&')}@sha256:[0-9a-f]{64}$`
);
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const PHASE_ORDER = Object.freeze([
    'previous_qualified',
    'previous_ready',
    'previous_synthetic_slice',
    'candidate_ready',
    'candidate_synthetic_slice',
    'readiness_failure_injected',
    'readiness_failure_observed',
    'previous_rollback_ready',
    'previous_rollback_synthetic_slice',
    'runtime_cleanup_complete'
]);

function exactKeys(value, keys) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function positiveDecimal(value) {
    return typeof value === 'string' && POSITIVE_DECIMAL.test(value)
        && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
}

function validateDigestReference(value) {
    return typeof value === 'string' && DIGEST_REFERENCE.test(value);
}

function validateCandidatePair(previous, candidate) {
    if (!previous || !candidate) return 'candidate_pair_missing';
    for (const value of [previous, candidate]) {
        if (!validateDigestReference(value.reference)
            || !IMAGE_ID.test(value.config_id || '')
            || !/^[0-9a-f]{40}$/.test(value.source_sha || '')
            || value.configured_user !== 'slicer') {
            return 'candidate_identity_malformed';
        }
    }
    if (previous.reference === candidate.reference
        || previous.config_id === candidate.config_id
        || previous.source_sha === candidate.source_sha) {
        return 'distinct_candidate_identity_required';
    }
    return null;
}

function validHealth(result) {
    return result?.status === 200
        && exactKeys(result.body, ['status', 'uptime'])
        && result.body.status === 'OK'
        && Number.isFinite(result.body.uptime) && result.body.uptime >= 0;
}

function validReady(result, expectedReady = true) {
    return result?.status === (expectedReady ? 200 : 503)
        && exactKeys(result.body, ['status'])
        && result.body.status === (expectedReady ? 'READY' : 'NOT_READY');
}

function validQueue(queue) {
    const keys = [
        'queueLength', 'activeJobs', 'maxConcurrent', 'maxQueueLength',
        'maxQueuePerClient', 'acceptingJobs'
    ];
    return exactKeys(queue, keys)
        && queue.acceptingJobs === true
        && ['queueLength', 'activeJobs', 'maxConcurrent', 'maxQueueLength', 'maxQueuePerClient']
            .every((key) => Number.isSafeInteger(queue[key]) && queue[key] >= 0)
        && queue.queueLength === 0 && queue.activeJobs === 0;
}

function validOperations(result, ready) {
    const body = result?.body;
    const keys = [
        'checkedAt', 'ready', 'admissionOpen', 'probes', 'reasonCodes',
        'queue', 'legacyMigration'
    ];
    if (result?.status !== (ready ? 200 : 503) || !exactKeys(body, keys)
        || body.ready !== ready || body.admissionOpen !== true
        || !exactKeys(body.probes, ['queue', 'native', 'storage', 'retention', 'pricing', 'config'])
        || !validQueue(body.queue)
        || !exactKeys(body.legacyMigration, ['enabled', 'audience', 'expiresAt'])
        || body.legacyMigration.enabled !== false
        || body.legacyMigration.audience !== null
        || body.legacyMigration.expiresAt !== null) return false;
    const expectedReasons = ready ? [] : ['STORAGE_UNSAFE'];
    if (JSON.stringify(body.reasonCodes) !== JSON.stringify(expectedReasons)) return false;
    return Object.entries(body.probes).every(([key, value]) => (
        key === 'storage' && !ready ? value === false : value === true
    ));
}

function validDetailed(result, ready) {
    const body = result?.body;
    if (result?.status !== (ready ? 200 : 503)
        || !exactKeys(body, ['timestamp', 'status', 'uptime', 'subsystems'])
        || body.status !== (ready ? 'OK' : 'DEGRADED')
        || typeof body.timestamp !== 'string' || Number.isNaN(Date.parse(body.timestamp))
        || !Number.isFinite(body.uptime) || body.uptime < 0
        || !exactKeys(body.subsystems, [
            'queue', 'native', 'storage', 'retention', 'pricing', 'config', 'python'
        ])
        || !validQueue(body.subsystems.queue)
        || !exactKeys(body.subsystems.python, ['available', 'version'])
        || body.subsystems.python.available !== true
        || typeof body.subsystems.python.version !== 'string'
        || body.subsystems.python.version.length < 1
        || body.subsystems.python.version.length > 128) return false;
    return ['native', 'retention', 'pricing', 'config'].every(
        (key) => body.subsystems[key] === true
    ) && body.subsystems.storage === ready;
}

function validAuthRejection(result) {
    return result?.status === 401
        && exactKeys(result.body, ['success', 'error', 'errorCode'])
        && result.body.success === false
        && result.body.error === 'Operations authentication is required.'
        && result.body.errorCode === 'OPERATIONS_AUTH_REQUIRED';
}

function validateHealthyObservation(value) {
    if (!exactKeys(value, ['health', 'ready', 'operations', 'detailed', 'missing', 'wrong'])) {
        return 'readiness_observation_schema_mismatch';
    }
    return validHealth(value.health)
        && validReady(value.ready, true)
        && validOperations(value.operations, true)
        && validDetailed(value.detailed, true)
        && validAuthRejection(value.missing)
        && validAuthRejection(value.wrong)
        ? null : 'healthy_readiness_contract_mismatch';
}

function validateDegradedObservation(value) {
    if (!exactKeys(value, ['health', 'ready', 'operations', 'detailed'])) {
        return 'degraded_observation_schema_mismatch';
    }
    return validHealth(value.health)
        && validReady(value.ready, false)
        && validOperations(value.operations, false)
        && validDetailed(value.detailed, false)
        ? null : 'storage_readiness_failure_not_observed';
}

function validateRuntimeInspect(value, expected) {
    if (!exactKeys(value, [
        'id', 'imageId', 'configuredImage', 'running', 'paused', 'restarting',
        'oomKilled', 'health', 'pid', 'user', 'portBindings', 'networks'
    ])) return 'runtime_inspect_schema_mismatch';
    if (!CONTAINER_ID.test(value.id || '') || value.imageId !== expected.configId
        || value.configuredImage !== expected.reference || value.running !== true
        || value.paused !== false || value.restarting !== false || value.oomKilled !== false
        || value.health !== 'healthy' || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || value.user !== `${expected.uid}:${expected.gid}`
        || !exactKeys(value.portBindings, [])
        || JSON.stringify(value.networks) !== JSON.stringify(['slicer-api-private'])) {
        return 'runtime_identity_or_envelope_mismatch';
    }
    return null;
}

function validatePhaseOrder(value) {
    return Array.isArray(value)
        && JSON.stringify(value) === JSON.stringify(PHASE_ORDER)
        ? null : 'phase_order_mismatch';
}

module.exports = Object.freeze({
    CONTAINER_ID,
    DIGEST_REFERENCE,
    EXACT_GHCR_REPOSITORY,
    IMAGE_ID,
    PHASE_ORDER,
    exactKeys,
    positiveDecimal,
    validateCandidatePair,
    validateDegradedObservation,
    validateDigestReference,
    validateHealthyObservation,
    validatePhaseOrder,
    validateRuntimeInspect
});
