'use strict';

/**
 * Asynchronous slice submission (`Prefer: respond-async`, async contract v1).
 *
 * Every check that runs before the native pipeline (rate limit, auth, upload,
 * option/profile validation, queue admission) answers synchronously exactly as
 * the synchronous request does. Once the shared slice queue admits the job the
 * client receives 202 and the job runs through the SAME queue and pipeline,
 * writing into a captured response instead of the socket. The captured status
 * and JSON body are the job's `result_status` and `result`.
 *
 * A native killed by the system (the cgroup OOM killer beside a sibling
 * slice) is run once more, alone: the job holds the queue until every other
 * active slice settled, and its stored answer is the second run's (3.8.2).
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { isResponseWritable } = require('./request-abort');
const { emitEvent } = require('../observability/events');
const { CAPACITY_RETRY_AFTER_SECONDS, POLL_AFTER_MS, retryAfterSeconds } = require('./async-jobs');

const ASYNC_ACCEPTED = Symbol('asyncSliceAccepted');
const INTERNAL_SERVER_ERROR = Object.freeze({
    success: false,
    error: 'Internal server error.',
    errorCode: 'INTERNAL_SERVER_ERROR'
});

/**
 * RFC 7240: true when any `Prefer` preference token is `respond-async`.
 * @param {import('express').Request} req Express request.
 * @returns {boolean} Whether the client asked for an asynchronous answer.
 */
function prefersRespondAsync(req) {
    const raw = typeof req?.get === 'function' ? req.get('prefer') : req?.headers?.prefer;
    const values = Array.isArray(raw) ? raw : [raw];
    return values.some((value) => typeof value === 'string' && value.split(',').some((preference) => (
        preference.split(/[=;]/, 1)[0].trim().toLowerCase() === 'respond-async'
    )));
}

/**
 * Authenticated identity a job is bound to: the slice audience and the
 * rotation family (`shared`, `woocommerce`, `leadpilot`) that authorized it,
 * so a key rotation inside one family keeps access to its jobs.
 */
function resolveJobPrincipal(req) {
    const principal = req?.slicePrincipal;
    const audience = typeof principal?.audience === 'string' ? principal.audience : 'slice';
    const slot = typeof principal?.slot === 'string' ? principal.slot : 'anonymous';
    return `${audience}:${slot}`;
}

function markAsyncAccepted(req) {
    if (req) req[ASYNC_ACCEPTED] = true;
}

/** True once a 202 was written: the socket no longer belongs to this job. */
function isAsyncAccepted(req) {
    return req?.[ASYNC_ACCEPTED] === true;
}

/**
 * A response stand-in for the pipeline. It honours the subset of the Express
 * response the slice pipeline uses and keeps the JSON exactly as `res.json`
 * would serialize it. `onWrite` runs once the answer is captured.
 */
function createCapturedResponse(onWrite = () => {}) {
    const headers = new Map();
    return {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        writableFinished: false,
        destroyed: false,
        closed: false,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            headers.set(String(name).toLowerCase(), String(value));
            return this;
        },
        set(name, value) {
            return this.setHeader(name, value);
        },
        getHeader(name) {
            return headers.get(String(name).toLowerCase());
        },
        json(payload) {
            if (this.headersSent) throw new Error('Captured slice response was already written.');
            const serialized = JSON.stringify(payload);
            this.body = serialized === undefined ? null : JSON.parse(serialized);
            this.headersSent = true;
            this.writableEnded = true;
            this.writableFinished = true;
            onWrite();
            return this;
        }
    };
}

function capturedRetryAfter(capture) {
    const value = capture.getHeader('retry-after');
    return typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}

/**
 * Convert the captured response into the stored result. A task rejection with
 * nothing written is mapped exactly like the synchronous handler maps it.
 */
function captureResult(capture, taskError, mapQueueError) {
    if (taskError && !capture.headersSent) mapQueueError(taskError, capture);
    if (!capture.headersSent) capture.status(500).json({ ...INTERNAL_SERVER_ERROR });
    return { status: capture.statusCode, body: capture.body, retryAfterSeconds: capturedRetryAfter(capture) };
}

function isResponseDisconnected(res) {
    return Boolean(res?.destroyed || res?.closed || res?.writableEnded);
}

/** Answer a failure before admission exactly as the synchronous handler does. */
function answerLikeSync(error, res, binding, ctx) {
    if (isResponseWritable(res) && !binding.signal.aborted) return ctx.createQueueErrorResponse(error, res);
    if (!binding.signal.aborted && !isResponseDisconnected(res)) throw error;
    return undefined;
}

function sendCapacityResponse(res) {
    res.setHeader('Retry-After', String(CAPACITY_RETRY_AFTER_SECONDS));
    return res.status(429).json({
        success: false,
        error: 'Too many asynchronous slice jobs are retained. Please wait and retry.',
        errorCode: 'SLICE_ASYNC_JOBS_FULL',
        retryAfterSeconds: CAPACITY_RETRY_AFTER_SECONDS
    });
}

function sendAccepted(res, store, job) {
    const body = store.acceptedView(job);
    res.setHeader('Location', body.status_url);
    res.setHeader('Preference-Applied', 'respond-async');
    res.setHeader('Retry-After', String(retryAfterSeconds(POLL_AFTER_MS)));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(202).json(body);
}

/** Await the task and its response settlement, then store the result. */
async function runToCompletion(admitted, req, ctx) {
    let taskError = null;
    try {
        await admitted.settled;
    } catch (error) {
        taskError = error;
    }
    try {
        // Promotion/release of the artifact, exactly as after a synchronous write.
        await ctx.awaitResponseSettlement(req);
    } catch {
        // The synchronous client had already received this body when a
        // release failure surfaced; the stored result mirrors that answer.
    }
    if (!ctx.store.isLive(admitted.job)) return;
    ctx.store.complete(admitted.job, captureResult(admitted.capture, taskError, ctx.createQueueErrorResponse));
}

function admitIntoStore(admitted, req, ctx, controller, admission) {
    admitted.handle = admission;
    try {
        admitted.job = ctx.store.admit({
            principal: resolveJobPrincipal(req), requestId: req.requestId, controller, admission
        });
    } catch (error) {
        admitted.job = null;
        admitted.admitError = error;
    }
    // An ownerless job never runs: the abort removes it from the queue.
    if (!admitted.job) controller.abort(admitted.admitError || new Error('Asynchronous slice job capacity is exhausted.'));
}

/** True when the pipeline answered the generic 500 for a native the system killed. */
function wasKilledBySystem(capture) {
    return capture?.statusCode === 500 && capture.body?.native?.killed_by_system === true;
}

/**
 * Point the request back at the upload so the pipeline can run again. The
 * first run renamed `X` to `X<ext>` (`appendOriginalExtensionToUpload`);
 * with `req.file.path = X<ext>` the second rename is `X<ext>` to
 * `X<ext><ext>` inside the same workspace, and every converted, oriented,
 * scaled and output path derives from that new name or is freshly drawn.
 * @returns {Promise<boolean>} Whether the upload is in place for a second run.
 */
async function prepareUploadForRetry(req) {
    const file = req?.file;
    if (!file || typeof file.path !== 'string' || typeof file.originalname !== 'string') return false;
    const originalExt = path.extname(file.originalname).toLowerCase();
    for (const candidate of [`${file.path}${originalExt}`, file.path]) {
        try {
            const stats = await fs.lstat(candidate);
            if (!stats.isFile() || stats.isSymbolicLink()) continue;
            file.path = candidate;
            return true;
        } catch {
            // Not this name; try the next.
        }
    }
    return false;
}

/**
 * Run the pipeline once more, alone, after the system killed the native.
 * Returns null (keeping the first answer) when the retry cannot start.
 */
async function retryAlone(admitted, req, ctx, signal, options) {
    const emit = ctx.emitEvent || emitEvent;
    emit('async.retry_alone', {
        audience: 'slice', outcome: 'retrying', job_id: admitted.job?.id,
        extra: { queue_state: 'running', reason: 'native_killed' }
    });
    try {
        await admitted.handle.awaitSolo(signal);
    } catch (error) {
        if (signal.aborted) throw error;
        return null;
    }
    if (signal.aborted || !(await prepareUploadForRetry(req))) return null;
    const capture = createCapturedResponse(() => ctx.store.markCaptured(admitted.job));
    ctx.setAbortSignal(capture, signal);
    admitted.capture = capture;
    const result = await ctx.process(req, capture, options);
    if (wasKilledBySystem(capture)) capture.body = { ...capture.body, retried_alone: true };
    return { result };
}

async function runAsyncTask(admitted, req, ctx, signal) {
    ctx.setAbortSignal(admitted.capture, signal);
    ctx.store.markRunning(admitted.job);
    const options = { forcedTechnology: ctx.forcedTechnology, engine: ctx.engine, signal };
    const first = await ctx.process(req, admitted.capture, options);
    if (!wasKilledBySystem(admitted.capture)) return first;
    if (!signal.aborted && typeof admitted.handle?.awaitSolo === 'function') {
        const retried = await retryAlone(admitted, req, ctx, signal, options);
        if (retried) return retried.result;
    }
    // No second run: the first answer stands and the deadline no longer overrides it.
    ctx.store.markCaptured(admitted.job);
    return first;
}

function enqueueAsyncJob(req, ctx) {
    const controller = new AbortController();
    const admitted = { handle: null, job: null, admitError: null, settled: null, capture: null };
    // A system-killed native's 500 is not final yet: it may be retried alone,
    // and the deadline must still be able to end that second run.
    admitted.capture = createCapturedResponse(() => {
        if (!wasKilledBySystem(admitted.capture)) ctx.store.markCaptured(admitted.job);
    });
    admitted.settled = ctx.enqueue((effectiveSignal) => (
        runAsyncTask(admitted, req, ctx, effectiveSignal || controller.signal)
    ), {
        queueKey: ctx.queueKey,
        signal: controller.signal,
        ignoreQueueWait: true,
        onAdmitted: (admission) => admitIntoStore(admitted, req, ctx, controller, admission)
    });
    // Every path below awaits it; this only keeps a late rejection from ever being unhandled.
    admitted.settled.catch(() => {});
    return admitted;
}

/** Answer an admission that produced no job, exactly as the synchronous path would. */
async function answerUnadmitted(admitted, res, binding, ctx) {
    try {
        await admitted.settled;
    } catch (error) {
        if (admitted.handle && !admitted.admitError) {
            return isResponseWritable(res) && !binding.signal.aborted ? sendCapacityResponse(res) : undefined;
        }
        return answerLikeSync(admitted.admitError || error, res, binding, ctx);
    }
    return undefined;
}

function cancelQuietly(store, job, reason) {
    try {
        store.cancel(job.id, job.principal, reason);
    } catch {
        // Cancellation is best effort on an already failing path.
    }
}

/**
 * Submit one asynchronous slice. Resolves once the job finished (or nothing
 * was admitted), so the request-owned workspace outlives the job.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {object} ctx Store plus the synchronous handler's own seams.
 * @returns {Promise<import('express').Response|undefined>} Settled synchronous answer, if any.
 */
async function submitAsyncSlice(req, res, ctx) {
    const binding = ctx.bindAbort(req, res);
    let admitted = null;
    try {
        let earlyResponse;
        try {
            earlyResponse = ctx.preValidate(req, res, { forcedTechnology: ctx.forcedTechnology, engine: ctx.engine });
        } catch (error) {
            return answerLikeSync(error, res, binding, ctx);
        }
        if (earlyResponse) return earlyResponse;
        // A request that disconnected before admission never becomes a job.
        if (binding.signal.aborted) return undefined;
        if (!ctx.store.hasCapacity()) return sendCapacityResponse(res);
        admitted = enqueueAsyncJob(req, ctx);
        if (!admitted.job) return await answerUnadmitted(admitted, res, binding, ctx);
        if (!isResponseWritable(res) || binding.signal.aborted) {
            cancelQuietly(ctx.store, admitted.job, 'client_gone');
        } else {
            sendAccepted(res, ctx.store, admitted.job);
            markAsyncAccepted(req);
        }
    } catch (error) {
        if (!admitted?.job) throw error;
        // The job must not outlive its request workspace: cancel it and wait
        // for the task to settle before the route cleans the workspace.
        binding.dispose();
        cancelQuietly(ctx.store, admitted.job, 'submission_failed');
        await runToCompletion(admitted, req, ctx);
        throw error;
    } finally {
        binding.dispose();
    }
    await runToCompletion(admitted, req, ctx);
    return res;
}

module.exports = {
    createCapturedResponse,
    captureResult,
    isAsyncAccepted,
    prefersRespondAsync,
    resolveJobPrincipal,
    submitAsyncSlice
};
