/**
 * In-memory FIFO queue for bounded concurrent slicing jobs.
 */

const { DEFAULTS } = require('../../config/constants');
const { parsePositiveInt } = require('./number-utils');
const { createQueueScheduler } = require('./queue-scheduler');
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
const MAX_CONCURRENT_SLICES = parsePositiveInt(
    process.env.MAX_CONCURRENT_SLICES || `${DEFAULTS.MAX_CONCURRENT_SLICES}`,
    DEFAULTS.MAX_CONCURRENT_SLICES
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
 * Per-client fairness cap error.
 */
class SliceQueueClientLimitError extends SliceQueueError {
    constructor() {
        super('Too many queued slice jobs for this client. Please wait and retry.', 429, 'SLICE_QUEUE_CLIENT_LIMIT');
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
 * Normalize queue-domain errors into stable API response payload metadata.
 * @param {Error} err Queue error.
 * @returns {{status: number, body: {success: boolean, error: string, errorCode: string}} | null} Queue response mapping.
 */
function toQueueErrorResponse(err) {
    if (err instanceof SliceQueueError) {
        return {
            status: err.status,
            body: {
                success: false,
                error: err.message,
                errorCode: err.errorCode
            }
        };
    }

    const legacy = parseLegacyQueueError(err);
    if (legacy) {
        return {
            status: legacy.status,
            body: {
                success: false,
                error: legacy.error,
                errorCode: legacy.errorCode
            }
        };
    }

    return null;
}

/** Resolve a safe positive factory limit. */
function finiteLimit(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
        maxConcurrent: finiteLimit(options.maxConcurrent, MAX_CONCURRENT_SLICES),
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
        runWithContext: options.runWithContext || runWithCorrelationContext
    });
}

const defaultQueue = createSliceQueue();
const enqueueSliceJob = defaultQueue.enqueueSliceJob;
const getQueueStatus = defaultQueue.getQueueStatus;
const beginSliceQueueShutdown = defaultQueue.beginSliceQueueShutdown;
const shutdownSliceQueue = defaultQueue.shutdownSliceQueue;

module.exports = {
    enqueueSliceJob,
    getQueueStatus,
    beginSliceQueueShutdown,
    shutdownSliceQueue,
    createSliceQueue,
    toQueueErrorResponse,
    SliceQueueError,
    SliceQueueFullError,
    SliceQueueTimeoutError,
    SliceQueueClientLimitError,
    SliceQueueShutdownError
};
