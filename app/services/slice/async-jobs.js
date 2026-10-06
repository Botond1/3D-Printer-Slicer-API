'use strict';

/**
 * In-memory store for asynchronous slice jobs (`Prefer: respond-async`,
 * async contract v1). A job is admitted to the shared slice queue first; the
 * store then owns its public identity, principal binding, deadline, result
 * retention and eviction. Jobs live in process memory only: a restart loses
 * them and a later status read answers 404.
 */

const { randomBytes } = require('node:crypto');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { emitEvent } = require('../observability/events');
const {
    ASYNC_CONTRACT_VERSION,
    JOB_STATUS_PATH_PREFIX,
    POLL_AFTER_MS,
    acceptedJobView,
    jobStatusView
} = require('./async-job-views');

const JOB_ID_PATTERN = /^sj_[a-f0-9]{32}$/;
const CAPACITY_RETRY_AFTER_SECONDS = 5;
const DEADLINE_RESULT = Object.freeze({
    success: false,
    error: 'Slice job exceeded its asynchronous deadline.',
    errorCode: 'SLICE_DEADLINE_EXCEEDED'
});

function abortError(message, code) {
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = code;
    return error;
}

function createJobId(random = randomBytes) {
    return `sj_${random(16).toString('hex')}`;
}

function isLiveState(state) {
    return state === 'queued' || state === 'running';
}

function retryAfterSeconds(milliseconds) {
    return Math.max(1, Math.ceil(milliseconds / 1000));
}

function resolveLimits(options) {
    const policy = options.policy || resolveResourcePolicy(options.env || process.env);
    return {
        deadlineMs: options.deadlineMs || policy.ASYNC_SLICE_DEADLINE_MS,
        resultTtlMs: options.resultTtlMs || policy.ASYNC_SLICE_RESULT_TTL_MS,
        maxJobs: options.maxJobs || policy.ASYNC_SLICE_MAX_JOBS
    };
}

/**
 * Create an isolated async job store.
 * @param {object} [options] Limits (`deadlineMs`, `resultTtlMs`, `maxJobs` or a
 *   resolved `policy`), clock/timer seams, `createId`, and `emitEvent`.
 * @returns {object} Store operations.
 */
function createAsyncSliceJobStore(options = {}) {
    const limits = resolveLimits(options);
    const now = options.now || Date.now;
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const createId = options.createId || createJobId;
    const publish = options.emitEvent || emitEvent;
    const jobs = new Map();

    function emit(eventName, job, data = {}) {
        try {
            publish(eventName, { request_id: job.requestId, job_id: job.id, audience: 'slice', ...data });
        } catch {
            // Job ownership and settlement never depend on telemetry.
        }
    }

    function stopTimer(job, key) {
        if (job[key] === undefined) return;
        clearTimer(job[key]);
        job[key] = undefined;
    }

    function startTimer(job, key, delayMs, callback) {
        job[key] = setTimer(callback, delayMs);
        job[key]?.unref?.();
    }

    function isRetained(job) {
        return Boolean(job) && jobs.get(job.id) === job;
    }

    function isLive(job) {
        return isRetained(job) && isLiveState(job.state);
    }

    function isExpired(job) {
        return job.state === 'completed' && now() >= job.completedAt + limits.resultTtlMs;
    }

    function remove(job) {
        stopTimer(job, 'deadlineTimer');
        stopTimer(job, 'retentionTimer');
        jobs.delete(job.id);
    }

    function expireRetention(job) {
        if (!isRetained(job) || job.state !== 'completed') return;
        remove(job);
        emit('async.expired', job, { outcome: 'expired', extra: { queue_state: 'completed' } });
    }

    function sweepExpired() {
        for (const job of [...jobs.values()]) if (isExpired(job)) expireRetention(job);
    }

    function oldestFinished(principal = null) {
        let oldest = null;
        for (const job of jobs.values()) {
            if (job.state !== 'completed' || (principal !== null && job.principal !== principal)) continue;
            if (!oldest || job.completedAt < oldest.completedAt) oldest = job;
        }
        return oldest;
    }

    function hasCapacity() {
        sweepExpired();
        return jobs.size < limits.maxJobs || oldestFinished() !== null;
    }

    /**
     * Make room for a new job: the submitting principal's own oldest finished
     * result goes first, so another key family cannot evict unpolled results.
     */
    function evictForAdmission(principal) {
        if (jobs.size < limits.maxJobs) return true;
        const victim = oldestFinished(principal) || oldestFinished();
        if (!victim) return false;
        remove(victim);
        emit('async.evicted', victim, { outcome: 'evicted', extra: { queue_state: 'completed' } });
        return true;
    }

    function uniqueId() {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const id = createId();
            if (JOB_ID_PATTERN.test(id) && !jobs.has(id)) return id;
        }
        throw new Error('Unable to allocate a unique slice job identifier.');
    }

    /**
     * Register a job the slice queue just admitted. Called synchronously from
     * the queue's admission callback, so capacity cannot change in between.
     * @returns {object|null} The job, or null when every retained job is live.
     */
    function admit({ principal, requestId, controller, admission }) {
        sweepExpired();
        if (!evictForAdmission(principal)) return null;
        const acceptedAt = now();
        const job = {
            id: uniqueId(), principal, requestId, controller, admission,
            state: 'queued', acceptedAt, deadlineAt: acceptedAt + limits.deadlineMs,
            captured: false, completedAt: null, result: null, deadlineTimer: undefined, retentionTimer: undefined
        };
        jobs.set(job.id, job);
        startTimer(job, 'deadlineTimer', limits.deadlineMs, () => expireDeadline(job));
        emit('async.accepted', job, { outcome: 'accepted', extra: { queue_state: 'queued' } });
        return job;
    }

    function markRunning(job) {
        if (isLive(job) && job.state === 'queued') job.state = 'running';
    }

    /** The pipeline wrote its answer; the deadline no longer overrides it. */
    function markCaptured(job) {
        if (isLive(job)) job.captured = true;
    }

    /**
     * Record the sync-equivalent answer of a live job and start its retention.
     * @param {object} job Live job.
     * @param {{status: number, body: object, retryAfterSeconds?: number|null}} result Captured answer.
     * @returns {boolean} Whether the job was still live.
     */
    function complete(job, result) {
        if (!isLive(job)) return false;
        stopTimer(job, 'deadlineTimer');
        job.state = 'completed';
        job.completedAt = now();
        job.result = Object.freeze({ ...result });
        // A retained result must not pin the request, its queue task or signal.
        job.controller = null;
        job.admission = null;
        startTimer(job, 'retentionTimer', limits.resultTtlMs, () => expireRetention(job));
        emit('async.completed', job, {
            outcome: result.status < 400 ? 'success' : 'failure',
            error_code: typeof result.body?.errorCode === 'string' ? result.body.errorCode : undefined,
            duration_ms: job.completedAt - job.acceptedAt,
            extra: { queue_state: 'completed' }
        });
        return true;
    }

    function expireDeadline(job) {
        // A captured answer (its artifact may be in promotion) completes as itself.
        if (!isLive(job) || job.captured) return;
        // Aborting the queue signal removes a queued job or terminates the
        // native process tree of a running one, exactly as a disconnect does
        // on the synchronous path; the slot is released when the task settles.
        job.controller.abort(abortError('Slice job exceeded its asynchronous deadline.', 'SLICE_DEADLINE_EXCEEDED'));
        complete(job, { status: 504, body: { ...DEADLINE_RESULT }, retryAfterSeconds: null });
    }

    function lookup(jobId, principal) {
        if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) return null;
        const job = jobs.get(jobId);
        if (!job) return null;
        if (isExpired(job)) {
            expireRetention(job);
            return null;
        }
        return job.principal === principal ? job : null;
    }

    /**
     * Cancel a live job or discard a finished one.
     * @returns {boolean} False when the job is unknown to this principal.
     */
    function cancel(jobId, principal, reason = 'cancelled') {
        const job = lookup(jobId, principal);
        if (!job) return false;
        const previousState = job.state;
        remove(job);
        if (isLiveState(previousState)) {
            job.controller.abort(abortError('Slice job was cancelled.', 'SLICE_JOB_CANCELLED'));
        }
        emit('async.cancelled', job, { outcome: 'cancelled', extra: { queue_state: previousState, reason } });
        return true;
    }

    /** Public status body for a retained job. */
    function view(job) {
        return jobStatusView(job, now());
    }

    /** 202 body for a freshly admitted job. */
    function acceptedView(job) {
        return acceptedJobView(job, limits.deadlineMs);
    }

    function getStatus() {
        sweepExpired();
        let live = 0;
        for (const job of jobs.values()) if (isLiveState(job.state)) live += 1;
        return { retained: jobs.size, live, maxJobs: limits.maxJobs };
    }

    return Object.freeze({
        limits: Object.freeze({ ...limits }),
        hasCapacity,
        admit,
        markRunning,
        markCaptured,
        complete,
        isLive,
        lookup,
        cancel,
        view,
        acceptedView,
        getStatus
    });
}

let defaultStore;

/** Lazily create the process-wide store from the validated resource policy. */
function getDefaultAsyncSliceJobStore() {
    if (!defaultStore) defaultStore = createAsyncSliceJobStore();
    return defaultStore;
}

module.exports = {
    ASYNC_CONTRACT_VERSION,
    CAPACITY_RETRY_AFTER_SECONDS,
    JOB_ID_PATTERN,
    JOB_STATUS_PATH_PREFIX,
    POLL_AFTER_MS,
    createAsyncSliceJobStore,
    createJobId,
    getDefaultAsyncSliceJobStore,
    retryAfterSeconds
};
