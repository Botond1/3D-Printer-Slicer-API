'use strict';

const { randomUUID } = require('node:crypto');
const { runWithRequestContext } = require('../services/observability/context');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function resolveRequestId(value, createId = randomUUID) {
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
        ? value
        : createId();
}

function createRequestIdMiddleware(options = {}) {
    const createId = options.createId || randomUUID;
    return function requestIdMiddleware(req, res, next) {
        const requestId = resolveRequestId(req.header('x-request-id'), createId);
        req.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);
        runWithRequestContext(requestId, next);
    };
}

module.exports = {
    REQUEST_ID_PATTERN,
    createRequestIdMiddleware,
    resolveRequestId
};
