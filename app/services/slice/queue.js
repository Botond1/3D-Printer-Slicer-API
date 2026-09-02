/**
 * In-memory FIFO queue for bounded concurrent slicing jobs.
 */

const { DEFAULTS, MAX_CONCURRENT_SLICES_RANGE } = require('../../config/constants');
const { parsePositiveInt, parseBoundedPositiveInt } = require('./number-utils');
const { createQueueScheduler } = require('./queue-scheduler');
const {
    getNativeRuntimeStatus,
    subscribeToNativeRuntimeQuarantine
} = require('./native-runtime-status');
const { recordQueueRejection } = require('../observability/metrics');
const { emitEvent } = require('../observability/events');
const {
    captureCorrelationContext,
    runWithCorrelationContext
} = require('../observability/context');

const MAX_SLICE_QUEUE_LENGTH = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_LENGTH || `${DEFAULTS.MAX_SLICE_QUEUE_LENGTH}`,
    DEFAULTS.MAX_SLICE_QUEUE_LENGTH
);
const MAX_SLICE_QUEUE_PER_IP = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_PER_IP || `${DEFAULTS.MAX_SLICE_QUEUE_PER_IP}`,
    DEFAULTS.MAX_SLICE_QUEUE_PER_IP
);
const MAX_SLICE_QUEUE_WAIT_MS = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_WAIT_MS || `${DEFAULTS.MAX_SLICE_QUEUE_WAIT_MS}`,
    DEFAULTS.MAX_SLICE_QUEUE_WAIT_MS
);
const MAX_CONCURRENT_SLICES = parseBoundedPositiveInt(
    process.env.MAX_CONCURRENT_SLICES,
    DEFAULTS.MAX_CONCURRENT_SLICES,
    MAX_CONCURRENT_SLICES_RANGE
);

/**
 * Base queue-domain error carrying stable API mapping metadata.
 */
class SliceQueueError extends Error {
    /**
     * @param {string} message User-facing error message.
     * @param {number} status HTTP status code.
     * @param {string} errorCode Stable API error code.
     */
    constructor(message, status, errorCode) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.errorCode = errorCode;
    }
}

/**
 * Queue overflow error.
 */
class SliceQueueFullError extends SliceQueueError {
    constructor() {
        super('Slice queue is full. Please retry later.', 503, 'SLICE_QUEUE_FULL');
    }
}

/**
 * Queue wait-time timeout error.
 */
class SliceQueueTimeoutError extends SliceQueueError {
    constructor() {
        super('Slice job timed out while waiting in queue.', 503, 'SLICE_QUEUE_TIMEOUT');
    }
}

/**
 * Retry hint carried by per-client 429 rejections. The cap is released as
 * soon as one of the client's own jobs settles, so a short hint is honest.
 */
const CLIENT_LIMIT_RETRY_AFTER_SECONDS = 5;

/**
 * Per-client fairness cap error.
 */
class SliceQueueClientLimitError extends SliceQueueError {
    constructor(retryAfterSeconds = CLIENT_LIMIT_RETRY_AFTER_SECONDS) {
        super('Too many queued slice jobs for this client. Please wait and retry.', 429, 'SLICE_QUEUE_CLIENT_LIMIT');
        this.retryAfterSeconds = Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds
            : CLIENT_LIMIT_RETRY_AFTER_SECONDS;
    }
}

/**
 * Queue shutdown admission/drain error.
 */
class SliceQueueShutdownError extends SliceQueueError {
    constructor() {
        super('Slice queue is shutting down. Please retry later.', 503, 'SLICE_QUEUE_SHUTDOWN');
    }
}

const LEGACY_QUEUE_ERROR_PREFIXES = Object.freeze({
    'QUEUE_FULL|': { status: 503, errorCode: 'SLICE_QUEUE_FULL' },
    'QUEUE_TIMEOUT|': { status: 503, errorCode: 'SLICE_QUEUE_TIMEOUT' },
    'QUEUE_CLIENT_LIMIT|': { status: 429, errorCode: 'SLICE_QUEUE_CLIENT_LIMIT' }
});

/**
 * Convert legacy prefixed queue error messages into response metadata.
 * @param {Error} err Queue error.
 * @returns {{status: number, errorCode: string, error: string} | null} Normalized mapping when recognized.
 */
function parseLegacyQueueError(err) {
    const message = typeof err?.message === 'string' ? err.message : '';

    for (const [prefix, metadata] of Object.entries(LEGACY_QUEUE_ERROR_PREFIXES)) {
        if (message.startsWith(prefix)) {
            const errorText = message.slice(prefix.length).trim() || 'Queue processing failed.';
            return {
                status: metadata.status,
                errorCode: metadata.errorCode,
                error: errorText
            };
        }
    }

    return null;
}

/**
 * Attach the retry hint every 429 queue rejection must carry, mirroring the
 * rate limiter's `Retry-After` header plus `retryAfterSeconds` body field.
 * @param {{status: number, body: Record<string, unknown>, headers?: Record<string, string>}} mapping Response mapping.
 * @param {number} retryAfterSeconds Retry hint in seconds.
 * @returns {{status: number, body: Record<string, unknown>, headers: Record<string, string>}} Mapping with retry metadata.
 */
function withRetryAfter(mapping, retryAfterSeconds) {
    if (mapping.status !== 429) return { ...mapping, headers: {} };
    const seconds = Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds
        : CLIENT_LIMIT_RETRY_AFTER_SECONDS;
    return {
        ...mapping,
        body: { ...mapping.body, retryAfterSeconds: seconds },
        headers: { 'Retry-After': String(seconds) }
    };
}

/**
 * Normalize queue-domain errors into stable API response payload metadata.
 * A 429 mapping always carries `headers['Retry-After']` and
 * `body.retryAfterSeconds`; callers must apply `headers` before sending.
 * @param {Error} err Queue error.
 * @returns {{status: number, body: {success: boolean, error: string, errorCode: string, retryAfterSeconds?: number}, headers: Record<string, string>} | null} Queue response mapping.
 */
function toQueueErrorResponse(err) {
    if (err instanceof SliceQueueError) {
        return withRetryAfter({
            status: err.status,
            body: {
                success: false,
                error: err.message,
                errorCode: err.errorCode
            }
        }, err.retryAfterSeconds);
    }

    const legacy = parseLegacyQueueError(err);
    if (legacy) {
        return withRetryAfter({
            status: legacy.status,
            body: {
                success: false,
                error: legacy.error,
                errorCode: legacy.errorCode
            }
        }, CLIENT_LIMIT_RETRY_AFTER_SECONDS);
    }

    return null;
}

/**
 * Send a mapped queue error, applying any retry headers it carries.
 * @param {import('express').Response} res Express response object.
 * @param {{status: number, body: Record<string, unknown>, headers?: Record<string, string>}} mapping Queue response mapping.
 * @returns {import('express').Response} Sent response.
 */
function sendQueueErrorResponse(res, mapping) {
    for (const [name, value] of Object.entries(mapping.headers || {})) res.setHeader(name, value);
    return res.status(mapping.status).json(mapping.body);
}

/** Resolve a safe positive factory limit. */
function finiteLimit(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Resolve a factory concurrency value inside the application safety range. */
function finiteConcurrency(value, fallback) {
    return Number.isSafeInteger(value)
        && value >= MAX_CONCURRENT_SLICES_RANGE.min
        && value <= MAX_CONCURRENT_SLICES_RANGE.max
        ? value
        : fallback;
}

/**
 * Create an isolated deterministic slice queue.
 * @param {object} [options] Limits and clock/timer dependencies.
 * @returns {object} Queue facade.
 */
function createSliceQueue(options = {}) {
    const eventEmitter = options.emitEvent || emitEvent;
    const rejectionRecorder = options.recordQueueRejection || recordQueueRejection;
    const readContext = options.captureContext || captureCorrelationContext;
    return createQueueScheduler({
        maxConcurrent: finiteConcurrency(options.maxConcurrent, MAX_CONCURRENT_SLICES),
        maxQueueLength: finiteLimit(options.maxQueueLength, MAX_SLICE_QUEUE_LENGTH),
        maxQueuePerClient: finiteLimit(options.maxQueuePerClient, MAX_SLICE_QUEUE_PER_IP),
        maxWaitMs: finiteLimit(options.maxWaitMs, MAX_SLICE_QUEUE_WAIT_MS),
        now: options.now || Date.now,
        setTimeout: options.setTimeout || setTimeout,
        clearTimeout: options.clearTimeout || clearTimeout,
        createFullError: () => new SliceQueueFullError(),
        createTimeoutError: () => new SliceQueueTimeoutError(),
        createClientLimitError: () => new SliceQueueClientLimitError(),
        createShutdownError: () => new SliceQueueShutdownError(),
        emitEvent: eventEmitter,
        recordQueueRejection: rejectionRecorder,
        captureContext: readContext,
        runWithContext: options.runWithContext || runWithCorrelationContext,
        isRuntimeAvailable: options.isRuntimeAvailable,
        subscribeToRuntimeQuarantine: options.subscribeToRuntimeQuarantine
    });
}

const defaultQueue = createSliceQueue({
    isRuntimeAvailable: () => getNativeRuntimeStatus().available,
    subscribeToRuntimeQuarantine: subscribeToNativeRuntimeQuarantine
});
const enqueueSliceJob = defaultQueue.enqueueSliceJob;
const getQueueStatus = defaultQueue.getQueueStatus;
const beginSliceQueueShutdown = defaultQueue.beginSliceQueueShutdown;
const shutdownSliceQueue = defaultQueue.shutdownSliceQueue;

module.exports = {
    CLIENT_LIMIT_RETRY_AFTER_SECONDS,
    enqueueSliceJob,
    getQueueStatus,
    beginSliceQueueShutdown,
    shutdownSliceQueue,
    createSliceQueue,
    sendQueueErrorResponse,
    toQueueErrorResponse,
    SliceQueueError,
    SliceQueueFullError,
    SliceQueueTimeoutError,
    SliceQueueClientLimitError,
    SliceQueueShutdownError
};
