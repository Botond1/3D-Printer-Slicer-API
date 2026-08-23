'use strict';

/** Fixed-cardinality in-process metrics registry. */

const AUDIENCES = Object.freeze(['public', 'slice', 'pricing', 'artifact', 'operations']);
const OUTCOMES = Object.freeze(['success', 'client_error', 'server_error', 'rejected']);
const NATIVE_OUTCOMES = Object.freeze(['success', 'failure', 'timeout', 'aborted', 'quarantined']);
const QUEUE_REASONS = Object.freeze(['full', 'client_limit', 'timeout', 'shutdown']);
const RESOURCE_REASONS = Object.freeze(['limit', 'invalid_output', 'invalid_stats']);
const DURATION_BUCKETS = Object.freeze([1000, 5000, 30000, 120000, 600000, Infinity]);
const counters = new Map();
const gauges = new Map();

function enumValue(value, values, fallback) {
    return values.includes(value) ? value : fallback;
}

function increment(key, amount = 1) {
    counters.set(key, (counters.get(key) || 0) + amount);
}

function incrementRequest(audience, outcome) {
    const safeAudience = enumValue(audience, AUDIENCES, 'public');
    const safeOutcome = enumValue(outcome, OUTCOMES, 'server_error');
    increment(`slicer_http_requests_total{audience="${safeAudience}",outcome="${safeOutcome}"}`);
}

function incrementAuthRejection(audience) {
    const safeAudience = enumValue(audience, AUDIENCES, 'operations');
    increment(`slicer_auth_rejections_total{audience="${safeAudience}"}`);
}

function recordQueueRejection(reason) {
    const safeReason = enumValue(reason, QUEUE_REASONS, 'shutdown');
    increment(`slicer_queue_rejections_total{reason="${safeReason}"}`);
}

function nativeStarted() {
    gauges.set('slicer_native_active', (gauges.get('slicer_native_active') || 0) + 1);
}

function nativeFinished(outcome, durationMs) {
    const safeOutcome = enumValue(outcome, NATIVE_OUTCOMES, 'failure');
    gauges.set('slicer_native_active', Math.max(0, (gauges.get('slicer_native_active') || 0) - 1));
    increment(`slicer_native_outcomes_total{outcome="${safeOutcome}"}`);
    const duration = Math.max(0, Number(durationMs) || 0);
    for (const bucket of DURATION_BUCKETS) {
        if (duration <= bucket) {
            const label = bucket === Infinity ? '+Inf' : String(bucket);
            increment(`slicer_native_duration_ms_bucket{le="${label}"}`);
        }
    }
}

function recordNativeQuarantine() {
    increment('slicer_native_outcomes_total{outcome="quarantined"}');
}

function incrementResourceFailure(reason) {
    const safeReason = enumValue(reason, RESOURCE_REASONS, 'limit');
    increment(`slicer_resource_failures_total{reason="${safeReason}"}`);
}

function setArtifactStatus(count, bytes) {
    gauges.set('slicer_artifacts_retained', Math.max(0, Number(count) || 0));
    gauges.set('slicer_artifact_bytes_retained', Math.max(0, Number(bytes) || 0));
}

function recordArtifactCleanup(outcome, removedCount = 0, removedBytes = 0) {
    const safeOutcome = outcome === 'success' ? 'success' : 'failure';
    increment(`slicer_artifact_cleanup_runs_total{outcome="${safeOutcome}"}`);
    increment('slicer_artifact_cleanup_removed_total', Math.max(0, Number(removedCount) || 0));
    increment('slicer_artifact_cleanup_removed_bytes_total', Math.max(0, Number(removedBytes) || 0));
}

function setReadiness(isReady) {
    gauges.set('slicer_readiness', isReady ? 1 : 0);
}

function setShutdownState(isShuttingDown) {
    gauges.set('slicer_shutdown', isShuttingDown ? 1 : 0);
}

function setQueueStatus(status = {}) {
    gauges.set('slicer_queue_active_jobs', Math.max(0, Number(status.activeJobs) || 0));
    gauges.set('slicer_queue_queued_jobs', Math.max(0, Number(status.queueLength) || 0));
    gauges.set('slicer_queue_accepting_jobs', status.acceptingJobs === true ? 1 : 0);
}

function renderMetrics() {
    const lines = [
        '# HELP slicer_readiness Whether the API currently accepts slice admission.',
        '# TYPE slicer_readiness gauge'
    ];
    for (const [key, value] of [...gauges.entries()].sort()) lines.push(`${key} ${value}`);
    for (const [key, value] of [...counters.entries()].sort()) lines.push(`${key} ${value}`);
    return `${lines.join('\n')}\n`;
}

function resetMetricsForTests() {
    counters.clear();
    gauges.clear();
}

module.exports = {
    AUDIENCES,
    OUTCOMES,
    incrementAuthRejection,
    incrementRequest,
    incrementResourceFailure,
    nativeFinished,
    nativeStarted,
    recordArtifactCleanup,
    recordNativeQuarantine,
    recordQueueRejection,
    renderMetrics,
    resetMetricsForTests,
    setArtifactStatus,
    setQueueStatus,
    setReadiness,
    setShutdownState
};
