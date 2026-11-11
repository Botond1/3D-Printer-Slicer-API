'use strict';

/**
 * Pre-queue archive preflight for a direct `.3mf` upload (3.9.0 §4.4).
 *
 * Runs the 3.8.3 package checks plus the build-expansion pre-scan BEFORE the
 * request takes a queue place, so a refusal is answered synchronously (also
 * with `Prefer: respond-async`). The work runs off the event loop and
 * serialised: one `worker_threads` worker, FIFO, one archive at a time, at
 * most `MAX_SLICE_QUEUE_LENGTH` requests waiting; beyond that the request
 * gets today's queue-full answer (503 `SLICE_QUEUE_FULL`, plus
 * `Retry-After`). A worker crash refuses only the request it was serving
 * (400 `INVALID_SOURCE_ARCHIVE`, `archive_rule: ARCHIVE_UNREADABLE`) and the
 * next request gets a new worker.
 *
 * On success a verdict `{realpath, dev, ino, size, mtimeNs, counts}` is
 * registered for the file; the job's own `inspectThreeMfArchive` consumes it
 * once and skips only the tokenizer, never the package checks.
 *
 * An inspection error that is not a labelled refusal (an archive yauzl
 * cannot open, which 3.8.3 answers from the job as 500) is not answered
 * here: the request is admitted without a verdict and the job answers it
 * exactly as 3.8.3 did.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DEFAULTS } = require('../../config/constants');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { parsePositiveInt } = require('./number-utils');
const { SliceResourceError, invalidArchive, labelArchiveError } = require('./resource-errors');
const { defaultExpansionLimits, registerExpansionVerdict } = require('./three-mf-expansion');
const {
    CLIENT_LIMIT_RETRY_AFTER_SECONDS,
    SliceQueueFullError,
    SliceQueueShutdownError,
    sendQueueErrorResponse,
    toQueueErrorResponse
} = require('./queue');
const { getRequestWorkspace } = require('./workspace');
const { handleProcessingError } = require('./errors');
const { getSupportedInputExtensionsText } = require('./common');
const { recordArchivePreflightWait } = require('../observability/metrics');

const WORKER_PATH = path.join(__dirname, 'archive-preflight-worker.js');
/**
 * Heap ceiling of the preflight worker. The scan's own state is bounded by
 * the expansion limits (a few hundred MB at the policy maxima); a worker
 * that runs out of it exits, which refuses only the request it was serving
 * (`ARCHIVE_UNREADABLE`), instead of growing beside the live slices.
 */
const WORKER_RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 64 });

/** Same resolution as the slice queue's own `MAX_SLICE_QUEUE_LENGTH`. */
function resolveMaxWaiting(env = process.env) {
    return parsePositiveInt(
        env.MAX_SLICE_QUEUE_LENGTH || `${DEFAULTS.MAX_SLICE_QUEUE_LENGTH}`,
        DEFAULTS.MAX_SLICE_QUEUE_LENGTH
    );
}

function abortError() {
    const error = new Error('Archive preflight was aborted.');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

function workerCrashError() {
    return labelArchiveError(invalidArchive('3MF archive could not be inspected.'), 'ARCHIVE_UNREADABLE');
}

/**
 * Rebuild the refusal the worker described.
 * @param {object} described Worker error description.
 * @returns {SliceResourceError} Labelled refusal.
 */
function reviveError(described) {
    const error = new SliceResourceError(described.code, described.message, described.status);
    if (described.archiveRule) labelArchiveError(error, described.archiveRule, described.archiveLimit);
    if (described.expansion) error.expansion = described.expansion;
    return error;
}

/**
 * Create one serialised preflight. The application uses the default
 * instance through `preflightArchive`; tests create their own.
 * @param {{maxWaiting?: number, workerPath?: string, workerResourceLimits?: object, resourcePolicy?: object, expansionLimits?: object, now?: () => number, recordWait?: (seconds: number) => void}} [options] Options.
 * @returns {{run: (file: string, runOptions?: {signal?: AbortSignal}) => Promise<object>, stats: () => object, terminateActiveWorker: () => Promise<void>, close: () => Promise<void>}} Preflight.
 */
function createArchivePreflight(options = {}) {
    const maxWaiting = Number.isSafeInteger(options.maxWaiting) && options.maxWaiting >= 0
        ? options.maxWaiting
        : resolveMaxWaiting();
    const workerPath = options.workerPath || WORKER_PATH;
    const workerResourceLimits = options.workerResourceLimits || WORKER_RESOURCE_LIMITS;
    const now = options.now || Date.now;
    const recordWait = options.recordWait || recordArchivePreflightWait;
    const resolvePolicy = () => options.resourcePolicy || resolveResourcePolicy(process.env);
    const resolveLimits = () => options.expansionLimits || defaultExpansionLimits();
    const waiting = [];
    let worker = null;
    let active = null;
    let nextId = 1;
    let closed = false;
    const counters = { running: 0, maxRunning: 0, completed: 0, crashed: 0, workersCreated: 0, refusedFull: 0 };

    function ensureWorker() {
        if (worker) return worker;
        const created = new Worker(workerPath, { resourceLimits: { ...workerResourceLimits } });
        counters.workersCreated += 1;
        created.unref();
        created.on('message', (message) => {
            if (worker !== created || !active || message?.id !== active.id) return;
            settle(active, message);
        });
        const lost = () => {
            if (worker !== created) return;
            worker = null;
            if (active) {
                counters.crashed += 1;
                settle(active, { id: active.id, ok: false, crashed: true });
            }
        };
        created.on('error', lost);
        created.on('exit', lost);
        worker = created;
        return created;
    }

    function settle(task, message) {
        if (active !== task) return;
        active = null;
        // Idle again: an idle worker never holds the process open (pump refs it for the next task).
        worker?.unref();
        counters.running -= 1;
        counters.completed += 1;
        task.finish(message);
        pump();
    }

    function pump() {
        if (active || closed) return;
        const task = waiting.shift();
        if (!task) return;
        task.detachAbort();
        active = task;
        counters.running += 1;
        counters.maxRunning = Math.max(counters.maxRunning, counters.running);
        try {
            recordWait(Math.max(0, now() - task.enqueuedAt) / 1000);
        } catch {
            // A metrics failure never refuses an upload.
        }
        try {
            const current = ensureWorker();
            // While a request waits on it the worker keeps the event loop alive:
            // unreferenced, a scan that holds no other handle (a heap that runs
            // out, a long tokenizer pass) let the loop drain with the request's
            // promise never settled.
            current.ref();
            current.postMessage({
                id: task.id,
                file: task.file,
                resourcePolicy: resolvePolicy(),
                expansionLimits: resolveLimits()
            });
        } catch {
            settle(task, { id: task.id, ok: false, crashed: true });
        }
    }

    /**
     * Preflight one file.
     * @param {string} file Absolute path of the upload.
     * @param {{signal?: AbortSignal}} [runOptions] Abort while waiting.
     * @returns {Promise<{admitted: true, counts: object|null, verdict: boolean}>} Admission; rejects with the refusal.
     */
    function run(file, runOptions = {}) {
        if (closed) return Promise.reject(new SliceQueueShutdownError());
        if (runOptions.signal?.aborted) return Promise.reject(abortError());
        if (active && waiting.length >= maxWaiting) {
            counters.refusedFull += 1;
            return Promise.reject(new SliceQueueFullError());
        }
        return new Promise((resolve, reject) => {
            const task = {
                id: nextId++,
                file,
                enqueuedAt: now(),
                detachAbort: () => {},
                finish: (message) => {
                    if (message.ok) {
                        registerVerdict(file, message.counts).then(
                            (verdict) => resolve({ admitted: true, counts: message.counts, verdict }),
                            () => resolve({ admitted: true, counts: message.counts, verdict: false })
                        );
                    } else if (message.shutdown) {
                        reject(new SliceQueueShutdownError());
                    } else if (message.crashed) {
                        reject(workerCrashError());
                    } else if (message.error?.raw) {
                        // Not a labelled refusal: the job answers it as 3.8.3 did.
                        resolve({ admitted: true, counts: null, verdict: false });
                    } else {
                        reject(reviveError(message.error));
                    }
                }
            };
            const signal = runOptions.signal;
            if (signal) {
                const onAbort = () => {
                    const index = waiting.indexOf(task);
                    if (index >= 0) {
                        waiting.splice(index, 1);
                        reject(abortError());
                    }
                };
                signal.addEventListener('abort', onAbort, { once: true });
                task.detachAbort = () => signal.removeEventListener('abort', onAbort);
            }
            waiting.push(task);
            pump();
        });
    }

    async function registerVerdict(file, counts) {
        if (!counts) return false;
        const [realpath, stats] = await Promise.all([fs.realpath(file), fs.lstat(file, { bigint: true })]);
        registerExpansionVerdict({
            realpath,
            dev: stats.dev,
            ino: stats.ino,
            size: stats.size,
            mtimeNs: stats.mtimeNs,
            counts
        });
        return true;
    }

    return {
        run,
        stats: () => ({ ...counters, waiting: waiting.length, maxWaiting }),
        /** Test seam: kill the worker serving the current request. */
        async terminateActiveWorker() {
            if (worker && active) await worker.terminate();
        },
        async close() {
            closed = true;
            for (const task of waiting.splice(0)) task.finish({ id: task.id, ok: false, shutdown: true });
            if (active) settle(active, { id: active.id, ok: false, shutdown: true });
            const current = worker;
            worker = null;
            if (current) await current.terminate();
        }
    };
}

let defaultPreflight = null;

function getDefaultArchivePreflight() {
    if (!defaultPreflight) defaultPreflight = createArchivePreflight();
    return defaultPreflight;
}

/**
 * The upload this preflight applies to: a `choosenFile` whose original
 * name ends in `.3mf`, inside the request's workspace.
 * @param {import('express').Request} req Express request.
 * @returns {string|null} Contained upload path, or null.
 */
function resolveDirectThreeMfUpload(req) {
    const file = req?.file;
    if (!file || file.fieldname !== 'choosenFile' || typeof file.path !== 'string') return null;
    if (path.extname(String(file.originalname || '')).toLowerCase() !== '.3mf') return null;
    const workspace = getRequestWorkspace(req);
    if (!workspace) return null;
    return workspace.assertContainedPath(file.path);
}

/**
 * Preflight the request's direct `.3mf` upload. Resolves `null` when the
 * request carries no direct 3MF (nothing to check), an admission object
 * when it may be queued; rejects with a labelled `SliceResourceError`
 * (answer it with `sendPreflightRefusal`) or a `SliceQueueFullError`.
 * @param {import('express').Request} req Express request.
 * @param {{signal?: AbortSignal, preflight?: object}} [options] Abort signal and instance seam.
 * @returns {Promise<null|{admitted: true, counts: object|null, verdict: boolean}>} Admission.
 */
async function preflightArchive(req, options = {}) {
    const file = resolveDirectThreeMfUpload(req);
    if (!file) return null;
    return (options.preflight || getDefaultArchivePreflight()).run(file, { signal: options.signal });
}

/**
 * Answer a preflight refusal with the same status, code and body the job
 * would give (plus `Retry-After` on the queue-full answer).
 * @param {Error} error Rejection of `preflightArchive`.
 * @param {import('express').Response} res Express response.
 * @returns {import('express').Response} Sent response.
 */
function sendPreflightRefusal(error, res) {
    const queueMapping = toQueueErrorResponse(error);
    if (queueMapping) {
        return sendQueueErrorResponse(res, {
            ...queueMapping,
            headers: { 'Retry-After': String(CLIENT_LIMIT_RETRY_AFTER_SECONDS), ...queueMapping.headers }
        });
    }
    return handleProcessingError(error, res, null, null, getSupportedInputExtensionsText);
}

async function closeDefaultArchivePreflight() {
    const current = defaultPreflight;
    defaultPreflight = null;
    if (current) await current.close();
}

module.exports = {
    WORKER_RESOURCE_LIMITS,
    closeDefaultArchivePreflight,
    createArchivePreflight,
    getDefaultArchivePreflight,
    preflightArchive,
    resolveDirectThreeMfUpload,
    sendPreflightRefusal
};
