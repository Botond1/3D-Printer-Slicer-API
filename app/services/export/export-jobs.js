'use strict';

/**
 * In-memory store of asynchronous production-model export jobs (3.9.0 §2.3,
 * §4.7). Never `async-jobs.js`: ids are `ex_<32 hex>` (never the slice job
 * pattern `sj_`), a job belongs to the principal that created it, at most
 * `EXPORT_MAX_JOBS` exports are queued or running service-wide (synchronous
 * exports included), a completed job and its result file live
 * `EXPORT_RESULT_TTL_MS` (15 min) after completion, and `DELETE` aborts a
 * running job or discards a finished one together with its file. Nothing
 * survives a restart.
 */

const crypto = require('node:crypto');
const { export: exportPolicy } = require('../../config/release-policy');
const { emitEvent: defaultEmitEvent } = require('../observability/events');
const { incrementExportJob: defaultIncrementExportJob } = require('../observability/metrics');
const { EXPORT_JOB_ID, defaultExportFiles } = require('./export-files');

const EXPORT_CONTRACT = 1;
const POLL_AFTER_MS = 2000;
const STATUS_URL_PREFIX = '/bambu/export/jobs/';

/** Abort reason of a job whose deadline passed (sync or async). */
class ExportDeadlineError extends Error {
    constructor(message = 'The export did not finish within its deadline.') {
        super(message);
        this.name = 'ExportDeadlineError';
        this.code = 'EXPORT_DEADLINE_EXCEEDED';
    }
}

/** Abort reason of a job deleted by its owner. */
class ExportCancelledError extends Error {
    constructor() {
        super('The export job was deleted.');
        this.name = 'AbortError';
        this.code = 'EXPORT_CANCELLED';
    }
}

function createExportJobId() {
    return `ex_${crypto.randomBytes(16).toString('hex')}`;
}

function swallow(callback) {
    try {
        callback();
    } catch {
        // Telemetry and timers never own a job's outcome.
    }
}

/**
 * Create an isolated export job store.
 * @param {object} [options] Limits, clock, timers, id factory and file store.
 * @returns {object} Store operations.
 */
function createExportJobStore(options = {}) {
    const maxJobs = options.maxJobs ?? exportPolicy.EXPORT_MAX_JOBS;
    const resultTtlMs = options.resultTtlMs ?? exportPolicy.EXPORT_RESULT_TTL_MS;
    const deadlineMs = options.deadlineMs ?? exportPolicy.EXPORT_ASYNC_DEADLINE_MS;
    // Completed records are bounded too, so a flood of finished-but-unfetched
    // results cannot grow memory or disk without limit before their TTL.
    const maxRetained = options.maxRetained ?? Math.max(64, maxJobs * 16);
    const now = options.now || Date.now;
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const createId = options.createId || createExportJobId;
    const files = options.files || defaultExportFiles;
    const emit = options.emitEvent || defaultEmitEvent;
    const countOutcome = options.incrementExportJob || defaultIncrementExportJob;
    const jobs = new Map();
    let syncInFlight = 0;

    function inFlight() {
        let count = syncInFlight;
        for (const job of jobs.values()) if (job.state !== 'completed') count += 1;
        return count;
    }

    function hasCapacity() {
        return inFlight() < maxJobs && jobs.size < maxRetained;
    }

    /**
     * Count a synchronous export toward the service-wide limit.
     * @returns {(() => void)|null} Release function, or null at capacity.
     */
    function reserveSync() {
        if (inFlight() >= maxJobs) return null;
        syncInFlight += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            syncInFlight -= 1;
        };
    }

    function clearTimers(job) {
        if (job.deadlineTimer !== undefined) clearTimer(job.deadlineTimer);
        if (job.ttlTimer !== undefined) clearTimer(job.ttlTimer);
        job.deadlineTimer = undefined;
        job.ttlTimer = undefined;
    }

    function emitDeleted(job, reason, action) {
        swallow(() => emit('export.deleted', {
            job_id: job.id,
            request_id: job.requestId,
            audience: 'slice',
            outcome: 'deleted',
            extra: { reason, action }
        }));
    }

    function removeFiles(job) {
        if (!job.file) return Promise.resolve();
        return Promise.resolve()
            .then(() => files.removeResult(job.id))
            .catch(() => {
                // The TTL purge at the next start is the backstop.
            });
    }

    /**
     * Admit one asynchronous export. The record starts `queued`; its deadline
     * runs from now and aborts `controller` when it passes.
     * @param {{principal: string, requestId?: string, format: string, fidelity: string}} input Owner and labels.
     * @returns {object|null} The job, or null at capacity.
     */
    function admit(input) {
        if (!hasCapacity()) return null;
        let id;
        do id = createId(); while (jobs.has(id));
        if (!EXPORT_JOB_ID.test(id)) throw new Error('Export job id factory produced an invalid id.');
        const acceptedAt = now();
        const job = {
            id,
            principal: String(input.principal),
            requestId: input.requestId,
            format: input.format,
            fidelity: input.fidelity,
            state: 'queued',
            acceptedAt,
            deadlineAt: acceptedAt + deadlineMs,
            controller: new AbortController(),
            admission: null,
            result: null,
            file: null,
            completedAt: null,
            deadlineTimer: undefined,
            ttlTimer: undefined
        };
        job.deadlineTimer = setTimer(() => {
            job.deadlineTimer = undefined;
            if (job.state !== 'completed' && !job.controller.signal.aborted) {
                job.controller.abort(new ExportDeadlineError());
            }
        }, deadlineMs);
        job.deadlineTimer?.unref?.();
        jobs.set(id, job);
        return job;
    }

    function isLive(job) {
        return Boolean(job) && jobs.get(job.id) === job;
    }

    function attachAdmission(job, admission) {
        if (isLive(job)) job.admission = admission;
    }

    function markRunning(job) {
        if (isLive(job) && job.state === 'queued') job.state = 'running';
    }

    /** Drop a job that never reached the queue (its answer was given synchronously). */
    function discard(job) {
        if (!isLive(job)) return;
        clearTimers(job);
        jobs.delete(job.id);
    }

    function expire(job) {
        if (!isLive(job)) return;
        clearTimers(job);
        jobs.delete(job.id);
        swallow(() => countOutcome('expired'));
        emitDeleted(job, 'expired', 'ttl');
        void removeFiles(job);
    }

    /**
     * Store a job's settled result. A job that is no longer live (deleted
     * meanwhile) keeps nothing: its file, if any, is removed.
     * @param {object} job Job record.
     * @param {{status: number, body?: object, file?: object, headers?: object}} result Settled result.
     * @returns {boolean} Whether the result was stored.
     */
    function complete(job, result) {
        if (!isLive(job) || job.state === 'completed') {
            if (result?.file) void Promise.resolve().then(() => files.removeResult(job.id)).catch(() => {});
            return false;
        }
        clearTimers(job);
        job.state = 'completed';
        job.completedAt = now();
        job.fileExpiresAt = job.completedAt + resultTtlMs;
        job.file = result?.file || null;
        // The stored view may depend on the completion time (`file_expires_at`).
        job.result = { ...result, view: typeof result?.view === 'function' ? result.view(job) : result?.view };
        job.ttlTimer = setTimer(() => {
            job.ttlTimer = undefined;
            expire(job);
        }, resultTtlMs);
        job.ttlTimer?.unref?.();
        return true;
    }

    /**
     * The owner's job, or null (unknown, deleted, expired, another principal's).
     * @param {unknown} id Path parameter.
     * @param {string} principal Requesting principal.
     * @returns {object|null} Job record.
     */
    function lookup(id, principal) {
        if (typeof id !== 'string' || !EXPORT_JOB_ID.test(id)) return null;
        const job = jobs.get(id);
        if (!job || job.principal !== String(principal)) return null;
        return job;
    }

    /**
     * DELETE: abort a queued/running job or discard a completed one, and
     * delete its file and record.
     * @returns {boolean} False when the owner has no such job.
     */
    function cancel(id, principal) {
        const job = lookup(id, principal);
        if (!job) return false;
        const running = job.state !== 'completed';
        clearTimers(job);
        jobs.delete(job.id);
        if (running && !job.controller.signal.aborted) job.controller.abort(new ExportCancelledError());
        if (running) swallow(() => countOutcome('cancelled'));
        emitDeleted(job, running ? 'cancelled' : 'deleted', running ? 'abort' : 'discard');
        void removeFiles(job);
        return true;
    }

    function iso(ms) {
        return new Date(ms).toISOString();
    }

    function acceptedView(job) {
        return {
            success: true,
            export_contract: EXPORT_CONTRACT,
            job_id: job.id,
            status: 'queued',
            status_url: `${STATUS_URL_PREFIX}${job.id}`,
            poll_after_ms: POLL_AFTER_MS,
            deadline_at: iso(job.deadlineAt),
            deadline_ms: deadlineMs
        };
    }

    function queuePosition(job) {
        try {
            const position = job.admission?.getQueuePosition?.();
            return Number.isSafeInteger(position) && position >= 1 ? position : null;
        } catch {
            return null;
        }
    }

    /** GET view of one job (§2.3). */
    function view(job) {
        if (job.state === 'completed') {
            return {
                success: true,
                export_contract: EXPORT_CONTRACT,
                job_id: job.id,
                status: 'completed',
                elapsed_ms: Math.max(0, job.completedAt - job.acceptedAt),
                result_status: job.result.status,
                result: job.result.view
            };
        }
        // A pre-empted export is queued again (its position reappears).
        const position = queuePosition(job);
        const queued = job.state === 'queued' || position !== null;
        const body = {
            success: true,
            export_contract: EXPORT_CONTRACT,
            job_id: job.id,
            status: queued ? 'queued' : 'running'
        };
        // As on the slice job poll: the key is always there, null while running.
        body.queue_position = queued ? (position ?? 1) : null;
        body.elapsed_ms = Math.max(0, now() - job.acceptedAt);
        body.deadline_at = iso(job.deadlineAt);
        body.poll_after_ms = POLL_AFTER_MS;
        return body;
    }

    function size() {
        return jobs.size;
    }

    return {
        acceptedView,
        admit,
        attachAdmission,
        cancel,
        complete,
        discard,
        hasCapacity,
        inFlight,
        isLive,
        lookup,
        markRunning,
        reserveSync,
        size,
        view,
        deadlineMs,
        resultTtlMs,
        maxJobs
    };
}

let defaultStore = null;

/** The process-wide export store, created on first use from the release policy. */
function getDefaultExportJobStore() {
    if (!defaultStore) defaultStore = createExportJobStore();
    return defaultStore;
}

module.exports = {
    EXPORT_CONTRACT,
    POLL_AFTER_MS,
    STATUS_URL_PREFIX,
    ExportCancelledError,
    ExportDeadlineError,
    createExportJobId,
    createExportJobStore,
    getDefaultExportJobStore
};
