'use strict';

/** Request lifecycle telemetry that cannot affect HTTP settlement. */

const { resolveRequestAudience } = require('../config/route-policy');
const { emitEvent } = require('../services/observability/events');
const { incrementRequest } = require('../services/observability/metrics');

function safeTelemetry(callback) {
    try {
        callback();
    } catch {
        // Request handling and settlement never depend on telemetry.
    }
}

function elapsedMilliseconds(clock, started) {
    try {
        return Number(clock() - started) / 1e6;
    } catch {
        return 0;
    }
}

function resolveOrFallback(callback, fallback) {
    try {
        return callback();
    } catch {
        return fallback;
    }
}

function createRequestObservabilityMiddleware(options = {}) {
    const clock = options.clock || process.hrtime.bigint;
    const publish = options.emitEvent || emitEvent;
    const countRequest = options.incrementRequest || incrementRequest;
    const resolveAudience = options.resolveRequestAudience || resolveRequestAudience;

    return function observeRequest(req, res, next) {
        const started = resolveOrFallback(clock, 0n);
        const audience = resolveOrFallback(() => resolveAudience(req), 'public');
        let settled = false;

        safeTelemetry(() => publish('request.accepted', {
            request_id: req.requestId,
            audience,
            outcome: 'accepted'
        }));

        const settle = (closed) => {
            if (settled) return;
            settled = true;
            res.removeListener('finish', onFinish);
            res.removeListener('close', onClose);

            const aborted = closed && res.writableFinished !== true;
            const outcome = aborted
                ? 'rejected'
                : res.statusCode >= 500
                    ? 'server_error'
                    : res.statusCode >= 400 ? 'client_error' : 'success';
            const errorCode = aborted
                ? 'REQUEST_ABORTED'
                : res.statusCode >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
            const durationMs = elapsedMilliseconds(clock, started);

            safeTelemetry(() => countRequest(audience, outcome));
            if (aborted || res.statusCode >= 400) {
                safeTelemetry(() => publish('request.rejected', {
                    request_id: req.requestId,
                    job_id: req.sliceJobId,
                    audience,
                    outcome: 'rejected',
                    error_code: errorCode,
                    duration_ms: durationMs
                }));
            }
            safeTelemetry(() => publish('request.completed', {
                request_id: req.requestId,
                job_id: req.sliceJobId,
                audience,
                outcome,
                duration_ms: durationMs
            }));
        };
        const onFinish = () => settle(false);
        const onClose = () => settle(true);

        res.once('finish', onFinish);
        res.once('close', onClose);
        return next();
    };
}

module.exports = {
    createRequestObservabilityMiddleware
};
