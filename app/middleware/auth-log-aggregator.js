'use strict';

/**
 * Aggregated authentication log (3.9.0).
 *
 * `auth.rejected`: the first rejection of a (client IP, audience) pair is
 * written at once with its attribution (server id `srv-<16hex>` as
 * `request_id`, the caller's own `X-Request-Id` as `client_request_id`, the
 * client IP and a reason); further rejections of that pair are counted and
 * written as one line per minute with `count`. A flood therefore no longer
 * rotates the operator's log window away.
 *
 * `auth.slot_summary`: the first accepted request of an (audience, slot,
 * rotation, client IP) tuple is written at once, then one line per minute
 * with `count`. Labels only: never key material, digests or request bodies.
 *
 * `slicer_auth_rejections_total` keeps counting every rejection (the event
 * emitter counts each written line; the aggregator counts the folded ones),
 * and `slicer_auth_accepted_total{audience,slot,rotation}` counts every
 * accepted request.
 *
 * Wiring (integrator, `server.js`): `createRequireSliceService({ keyRing,
 * logger: aggregator.logger, onAccepted: aggregator.onAccepted })` for the
 * slice routes, `logger: aggregator.logger` for the admin audiences,
 * `aggregator.start()` at startup and `aggregator.stop()` (which flushes) at
 * shutdown.
 */

const { emitEvent } = require('../services/observability/events');
const metrics = require('../services/observability/metrics');
const { createServerRequestId } = require('./requireAudience');

const DEFAULT_WINDOW_MS = 60_000;
/** Bound on distinct tuples held between flushes; the rest fold into one overflow entry. */
const DEFAULT_MAX_ENTRIES = 1_024;
const OVERFLOW = '__overflow__';
const AUDIENCE_PATTERN = /^[a-z]{1,16}$/;
const SLOT_PATTERN = /^[a-z]{1,32}$/;
const ROTATIONS = Object.freeze(['active', 'previous']);
const REASON_PATTERN = /^[a-z_]{1,32}$/;

function label(value, pattern, fallback) {
    return typeof value === 'string' && pattern.test(value) ? value : fallback;
}

/**
 * @param {{emit?: Function, metrics?: {incrementAuthRejection: Function, incrementAuthAccepted: Function},
 *   windowMs?: number, maxEntries?: number, createServerId?: () => string,
 *   setInterval?: Function, clearInterval?: Function}} [options] Seams.
 * @returns {{logger: {warn(message: string, metadata?: object): void},
 *   onAccepted(event: {audience: string, slot: string, rotation: string, clientIp: string}): void,
 *   flush(): void, start(): void, stop(): void, size(): number}} Aggregator.
 */
function createAuthLogAggregator(options = {}) {
    const emit = options.emit || emitEvent;
    const counters = options.metrics || metrics;
    const windowMs = Number.isSafeInteger(options.windowMs) && options.windowMs > 0
        ? options.windowMs
        : DEFAULT_WINDOW_MS;
    const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
        ? options.maxEntries
        : DEFAULT_MAX_ENTRIES;
    const createServerId = options.createServerId || createServerRequestId;
    const startTimer = options.setInterval || setInterval;
    const stopTimer = options.clearInterval || clearInterval;
    /** @type {Map<string, {audience: string, clientIp: string|undefined, count: number}>} */
    const rejected = new Map();
    /** @type {Map<string, {audience: string, slot: string, rotation: string, clientIp: string|undefined, count: number}>} */
    const accepted = new Map();
    let timer = null;

    function safeEmit(name, data) {
        try {
            emit(name, data);
        } catch {
            // Logging never owns a request.
        }
    }

    function safeCount(fn, ...args) {
        try {
            fn(...args);
        } catch {
            // A metric never owns a request.
        }
    }

    function entryKey(map, key) {
        if (map.has(key) || map.size < maxEntries) return key;
        return OVERFLOW;
    }

    const logger = Object.freeze({
        warn(message, metadata = {}) {
            void message;
            const audience = label(metadata.audience, AUDIENCE_PATTERN, 'slice');
            const clientIp = typeof metadata.clientIp === 'string' ? metadata.clientIp : undefined;
            const reason = label(metadata.reason, REASON_PATTERN, 'invalid_key');
            const key = entryKey(rejected, `${clientIp || 'unknown'}|${audience}`);
            const existing = rejected.get(key);
            if (existing) {
                existing.count += 1;
                // The first folded rejection of a window is counted by its
                // summary line's own emission; later ones are counted here.
                if (existing.count > 1) safeCount(counters.incrementAuthRejection, audience);
                return;
            }
            if (key === OVERFLOW) {
                rejected.set(key, { audience, clientIp: undefined, count: 1 });
                return;
            }
            rejected.set(key, { audience, clientIp, count: 0 });
            const extra = { reason, count: 1 };
            if (clientIp) extra.client_ip = clientIp;
            if (typeof metadata.clientRequestId === 'string') extra.client_request_id = metadata.clientRequestId;
            safeEmit('auth.rejected', {
                request_id: typeof metadata.serverRequestId === 'string'
                    ? metadata.serverRequestId
                    : createServerId(),
                audience,
                outcome: 'rejected',
                error_code: 'AUTH_REQUIRED',
                extra
            });
        }
    });

    function onAccepted(event = {}) {
        const audience = label(event.audience, AUDIENCE_PATTERN, 'slice');
        const slot = label(event.slot, SLOT_PATTERN, 'shared');
        const rotation = ROTATIONS.includes(event.rotation) ? event.rotation : 'active';
        const clientIp = typeof event.clientIp === 'string' ? event.clientIp : undefined;
        safeCount(counters.incrementAuthAccepted, audience, slot, rotation);
        const key = entryKey(accepted, `${audience}|${slot}|${rotation}|${clientIp || 'unknown'}`);
        const existing = accepted.get(key);
        if (existing) {
            existing.count += 1;
            return;
        }
        if (key === OVERFLOW) {
            accepted.set(key, { audience, slot, rotation, clientIp: undefined, count: 1 });
            return;
        }
        accepted.set(key, { audience, slot, rotation, clientIp, count: 0 });
        writeSlotSummary({ audience, slot, rotation, clientIp, count: 1 });
    }

    function writeSlotSummary({ audience, slot, rotation, clientIp, count }) {
        const extra = { slot, rotation, count };
        if (clientIp) extra.client_ip = clientIp;
        safeEmit('auth.slot_summary', { audience, outcome: 'accepted', extra });
    }

    /** Write one line per tuple that saw traffic since the last flush; idle tuples are forgotten. */
    function flush() {
        for (const [key, entry] of rejected) {
            if (entry.count === 0) {
                rejected.delete(key);
                continue;
            }
            const extra = { reason: key === OVERFLOW ? 'overflow' : 'window_summary', count: entry.count };
            if (entry.clientIp) extra.client_ip = entry.clientIp;
            safeEmit('auth.rejected', {
                request_id: createServerId(),
                audience: entry.audience,
                outcome: 'rejected',
                error_code: 'AUTH_REQUIRED',
                extra
            });
            if (key === OVERFLOW) rejected.delete(key);
            else entry.count = 0;
        }
        for (const [key, entry] of accepted) {
            if (entry.count === 0) {
                accepted.delete(key);
                continue;
            }
            writeSlotSummary(entry);
            if (key === OVERFLOW) accepted.delete(key);
            else entry.count = 0;
        }
    }

    function start() {
        if (timer) return;
        timer = startTimer(flush, windowMs);
        timer?.unref?.();
    }

    function stop() {
        if (timer) stopTimer(timer);
        timer = null;
        flush();
    }

    return Object.freeze({
        logger,
        onAccepted,
        flush,
        start,
        stop,
        size: () => rejected.size + accepted.size
    });
}

module.exports = {
    DEFAULT_MAX_ENTRIES,
    DEFAULT_WINDOW_MS,
    createAuthLogAggregator
};
