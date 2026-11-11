'use strict';

/** Fixed-cardinality in-process metrics registry. */

const AUDIENCES = Object.freeze(['public', 'slice', 'pricing', 'artifact', 'operations']);
const OUTCOMES = Object.freeze(['success', 'client_error', 'server_error', 'rejected']);
const NATIVE_OUTCOMES = Object.freeze(['success', 'failure', 'timeout', 'aborted', 'quarantined']);
const QUEUE_REASONS = Object.freeze(['full', 'client_limit', 'timeout', 'shutdown']);
const RESOURCE_REASONS = Object.freeze(['limit', 'invalid_output', 'invalid_stats']);
const DURATION_BUCKETS = Object.freeze([1000, 5000, 30000, 120000, 600000, Infinity]);
// 3.9.0 families (fixed label sets; no file names, ids or free text).
const EVENT_LOOP_STATS = Object.freeze(['p50', 'p99', 'max']);
const IDENTITY_FAILURE_METRIC_REASONS = Object.freeze(['changed', 'read_error', 'timeout', 'unstable', 'other']);
const AUTH_SLOTS = Object.freeze(['shared', 'woocommerce', 'leadpilot', 'staging']);
const AUTH_ROTATIONS = Object.freeze(['active', 'previous']);
const EXPORT_RESULTS = Object.freeze([
    'exact', 'unverified', 'mismatch', 'failed', 'deadline', 'cancelled', 'expired'
]);
const ARCHIVE_RULES = Object.freeze([
    'ARCHIVE_UNREADABLE', 'ARCHIVE_ENCRYPTED', 'ARCHIVE_UNSAFE_PATH', 'ARCHIVE_NESTED',
    'ARCHIVE_DISALLOWED_PART', 'ARCHIVE_TOO_MANY_ENTRIES', 'ARCHIVE_TOO_LARGE',
    'ARCHIVE_RATIO_EXCEEDED', 'ARCHIVE_EXPANSION_EXCEEDED'
]);
const SWEEP_VERDICTS = Object.freeze(['satisfied', 'exceeded', 'incomplete']);
const counters = new Map();
const gauges = new Map();

function seconds(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Register every 3.9.0 family at zero so a scrape shows it before its first
 * use. `slicer_auth_accepted_total` is pre-registered for the `slice`
 * audience's slots; other audiences appear on first use.
 */
function registerReleaseFamilies() {
    for (const stat of EVENT_LOOP_STATS) gauges.set(`slicer_event_loop_delay_seconds{stat="${stat}"}`, 0);
    gauges.set('slicer_identity_verification_seconds', 0);
    gauges.set('slicer_identity_stale', 0);
    gauges.set('slicer_artifact_sweep_seconds', 0);
    gauges.set('slicer_archive_preflight_wait_seconds', 0);
    for (const reason of IDENTITY_FAILURE_METRIC_REASONS) {
        counters.set(`slicer_identity_verification_failures_total{reason="${reason}"}`, 0);
    }
    counters.set('slicer_artifact_sweep_incomplete_total', 0);
    for (const slot of AUTH_SLOTS) {
        for (const rotation of AUTH_ROTATIONS) {
            counters.set(`slicer_auth_accepted_total{audience="slice",slot="${slot}",rotation="${rotation}"}`, 0);
        }
    }
    counters.set('slicer_auth_failure_limited_total', 0);
    for (const result of EXPORT_RESULTS) counters.set(`slicer_export_jobs_total{result="${result}"}`, 0);
    for (const rule of ARCHIVE_RULES) counters.set(`slicer_archive_rejections_total{rule="${rule}"}`, 0);
}

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

/**
 * Event-loop delay over the last window, in seconds.
 * @param {{p50?: number, p99?: number, max?: number}} stats
 */
function setEventLoopDelay(stats = {}) {
    for (const stat of EVENT_LOOP_STATS) {
        gauges.set(`slicer_event_loop_delay_seconds{stat="${stat}"}`, seconds(stats[stat]));
    }
}

/** Duration of the last completed native identity verification, in seconds. */
function recordIdentityVerification(durationSeconds) {
    gauges.set('slicer_identity_verification_seconds', seconds(durationSeconds));
}

/** One failed background identity verification (unknown reasons → `other`). */
function recordIdentityVerificationFailure(reason) {
    const safeReason = enumValue(reason, IDENTITY_FAILURE_METRIC_REASONS, 'other');
    increment(`slicer_identity_verification_failures_total{reason="${safeReason}"}`);
}

function setIdentityStale(isStale) {
    gauges.set('slicer_identity_stale', isStale ? 1 : 0);
}

/**
 * One finished artifact sweep: its duration and verdict
 * (`satisfied` | `exceeded` | `incomplete`; only `incomplete` is counted).
 */
function recordArtifactSweep(durationSeconds, verdict) {
    gauges.set('slicer_artifact_sweep_seconds', seconds(durationSeconds));
    if (enumValue(verdict, SWEEP_VERDICTS, null) === 'incomplete') {
        increment('slicer_artifact_sweep_incomplete_total');
    }
}

/** One accepted authentication, labelled by audience, slot and rotation. */
function incrementAuthAccepted(audience, slot, rotation) {
    const safeAudience = enumValue(audience, AUDIENCES, 'operations');
    const safeSlot = enumValue(slot, AUTH_SLOTS, 'shared');
    const safeRotation = enumValue(rotation, AUTH_ROTATIONS, 'active');
    increment(`slicer_auth_accepted_total{audience="${safeAudience}",slot="${safeSlot}",rotation="${safeRotation}"}`);
}

/** A failed authentication answered after its source's failure bucket was spent. */
function incrementAuthFailureLimited() {
    increment('slicer_auth_failure_limited_total');
}

/** One settled export job (unknown results → `failed`). */
function incrementExportJob(result) {
    const safeResult = enumValue(result, EXPORT_RESULTS, 'failed');
    increment(`slicer_export_jobs_total{result="${safeResult}"}`);
}

/** One archive refusal by `archive_rule` (unknown rules → `ARCHIVE_UNREADABLE`). */
function incrementArchiveRejection(rule) {
    const safeRule = enumValue(rule, ARCHIVE_RULES, 'ARCHIVE_UNREADABLE');
    increment(`slicer_archive_rejections_total{rule="${safeRule}"}`);
}

/** Time the last archive spent waiting for the preflight worker, in seconds. */
function recordArchivePreflightWait(durationSeconds) {
    gauges.set('slicer_archive_preflight_wait_seconds', seconds(durationSeconds));
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
    registerReleaseFamilies();
}

registerReleaseFamilies();

module.exports = {
    ARCHIVE_RULES,
    AUDIENCES,
    AUTH_ROTATIONS,
    AUTH_SLOTS,
    EVENT_LOOP_STATS,
    EXPORT_RESULTS,
    IDENTITY_FAILURE_METRIC_REASONS,
    OUTCOMES,
    SWEEP_VERDICTS,
    incrementArchiveRejection,
    incrementAuthAccepted,
    incrementAuthFailureLimited,
    incrementAuthRejection,
    incrementExportJob,
    incrementRequest,
    incrementResourceFailure,
    nativeFinished,
    nativeStarted,
    recordArchivePreflightWait,
    recordArtifactCleanup,
    recordArtifactSweep,
    recordIdentityVerification,
    recordIdentityVerificationFailure,
    recordNativeQuarantine,
    recordQueueRejection,
    renderMetrics,
    resetMetricsForTests,
    setArtifactStatus,
    setEventLoopDelay,
    setIdentityStale,
    setQueueStatus,
    setReadiness,
    setShutdownState
};
