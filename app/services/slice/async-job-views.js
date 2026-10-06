'use strict';

/** Public JSON bodies of asynchronous slice jobs (async contract v1). */

const ASYNC_CONTRACT_VERSION = 1;
const JOB_STATUS_PATH_PREFIX = '/bambu/slice/jobs/';
const POLL_AFTER_MS = 2_000;

function pendingState(job) {
    return job.state === 'running' || job.admission?.getState?.() === 'active' ? 'running' : 'queued';
}

function queuePosition(job, state) {
    if (state !== 'queued') return null;
    const position = job.admission?.getQueuePosition?.();
    return Number.isSafeInteger(position) && position >= 1 ? position : null;
}

/**
 * Status body of a retained job: pending (`queued`/`running`) or `completed`
 * with the captured synchronous status and body.
 * @param {object} job Retained job record.
 * @param {number} nowMs Current time in milliseconds.
 * @returns {object} JSON body.
 */
function jobStatusView(job, nowMs) {
    const base = { success: true, async_contract: ASYNC_CONTRACT_VERSION, job_id: job.id };
    if (job.state === 'completed') {
        const retryAfter = job.result.retryAfterSeconds;
        return {
            ...base,
            status: 'completed',
            elapsed_ms: Math.max(0, job.completedAt - job.acceptedAt),
            result_status: job.result.status,
            ...(Number.isSafeInteger(retryAfter) && retryAfter > 0 ? { result_retry_after_seconds: retryAfter } : {}),
            result: job.result.body
        };
    }
    const state = pendingState(job);
    return {
        ...base,
        status: state,
        queue_position: queuePosition(job, state),
        elapsed_ms: Math.max(0, nowMs - job.acceptedAt),
        deadline_at: new Date(job.deadlineAt).toISOString(),
        poll_after_ms: POLL_AFTER_MS
    };
}

/**
 * 202 body for a freshly admitted job.
 * @param {object} job Admitted job record.
 * @param {number} deadlineMs Configured deadline.
 * @returns {object} JSON body.
 */
function acceptedJobView(job, deadlineMs) {
    return {
        success: true,
        async_contract: ASYNC_CONTRACT_VERSION,
        job_id: job.id,
        status: 'queued',
        status_url: `${JOB_STATUS_PATH_PREFIX}${job.id}`,
        poll_after_ms: POLL_AFTER_MS,
        deadline_at: new Date(job.deadlineAt).toISOString(),
        deadline_ms: deadlineMs
    };
}

module.exports = {
    ASYNC_CONTRACT_VERSION,
    JOB_STATUS_PATH_PREFIX,
    POLL_AFTER_MS,
    acceptedJobView,
    jobStatusView
};
