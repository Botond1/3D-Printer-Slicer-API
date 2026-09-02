'use strict';

/** Versioned, allowlisted, redacted JSON event emission. */

const { randomUUID } = require('node:crypto');
const metrics = require('./metrics');
const { captureCorrelationContext } = require('./context');

const EVENT_VERSION = 1;
const EVENT_NAMES = Object.freeze([
    'artifact.accessed',
    'artifact.cleanup',
    'artifact.downloaded',
    'artifact.evicted',
    'artifact.lease_acquired',
    'artifact.lease_released',
    'artifact.promoted',
    'auth.rejected',
    'native.completed',
    'native.quarantined',
    'native.started',
    'native.termination_settled',
    'orientation.fallback',
    'pricing.mutated',
    'profile_catalogue.changed',
    'queue.admitted',
    'queue.expired',
    'queue.rejected',
    'queue.shutdown',
    'readiness.changed',
    'resource.rejected',
    'request.accepted',
    'request.completed',
    'request.rejected',
    'shutdown.started',
    'startup.completed'
]);
const JOB_ID = /^job-[a-f0-9]{32}$/;
const ARTIFACT_ID = /^artifact-[a-f0-9]{32}$/;
const SAFE_LABEL = /^[A-Za-z0-9_.:-]+$/;
const REDACTED_KEY = /(?:authorization|cookie|credential|key|password|secret|token)/i;
const SUSPICIOUS_VALUE = /(?:bearer\s+|basic\s+|api[_-]?key\s*[=:]|eyJ[A-Za-z0-9_-]{12,}\.|sk-[A-Za-z0-9_-]{12,})/i;
const EXTRA_KEYS = Object.freeze([
    'action', 'bytes', 'count', 'native_kind', 'queue_state', 'reason', 'technology'
]);
let eventWriter = (entry) => console.info(JSON.stringify(entry));

function boundedToken(value, maximum = 64) {
    if (typeof value !== 'string') return undefined;
    const neutralized = value.replace(/[^\x20-\x7e]/g, '?').slice(0, maximum);
    return neutralized && SAFE_LABEL.test(neutralized) ? neutralized : undefined;
}

function boundedDuration(value) {
    const duration = Number(value);
    return Number.isFinite(duration) && duration >= 0
        ? Math.min(Math.round(duration), 24 * 60 * 60 * 1000)
        : undefined;
}

function safeIdentifier(value, pattern) {
    return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function redactValue(key, value) {
    if (REDACTED_KEY.test(key)) return '[REDACTED]';
    if (typeof value === 'string') {
        if (SUSPICIOUS_VALUE.test(value)) return '[REDACTED]';
        return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 128);
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'boolean') return value;
    return undefined;
}

function sanitizeExtra(extra) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
    const safe = {};
    for (const [key, value] of Object.entries(extra).slice(0, 8)) {
        const safeKey = boundedToken(key, 32);
        if (!safeKey || !EXTRA_KEYS.includes(safeKey)) continue;
        const redacted = redactValue(safeKey, value);
        if (redacted !== undefined) safe[safeKey] = redacted;
    }
    return Object.keys(safe).length ? safe : undefined;
}

function createEventEmitter(options = {}) {
    const writer = options.writer || ((entry) => eventWriter(entry));
    const clock = options.clock || (() => new Date());
    const createId = options.createId || randomUUID;
    const readContext = options.readContext || captureCorrelationContext;

    return function emitEvent(eventName, data = {}) {
        if (!EVENT_NAMES.includes(eventName)) return false;
        try {
            const context = readContext() || {};
            const entry = {
                version: EVENT_VERSION,
                event: eventName,
                timestamp: clock().toISOString(),
                request_id: boundedToken(data.request_id, 128)
                    || boundedToken(context.requestId, 128)
                    || createId()
            };
            const optional = {
                job_id: safeIdentifier(data.job_id, JOB_ID)
                    || safeIdentifier(context.jobId, JOB_ID),
                artifact_id: safeIdentifier(data.artifact_id, ARTIFACT_ID)
                    || safeIdentifier(context.artifactId, ARTIFACT_ID),
                audience: boundedToken(data.audience, 16),
                outcome: boundedToken(data.outcome, 32),
                error_code: boundedToken(data.error_code, 64),
                duration_ms: boundedDuration(data.duration_ms),
                extra: sanitizeExtra(data.extra)
            };
            for (const [key, value] of Object.entries(optional)) {
                if (value !== undefined) entry[key] = value;
            }
            writer(Object.freeze(entry));
            if (eventName === 'auth.rejected') metrics.incrementAuthRejection(entry.audience);
            return true;
        } catch {
            return false;
        }
    };
}

const emitEvent = createEventEmitter();

function setEventWriter(writer) {
    eventWriter = typeof writer === 'function' ? writer : () => {};
}

module.exports = {
    EVENT_NAMES,
    EVENT_VERSION,
    createEventEmitter,
    emitEvent,
    setEventWriter
};
