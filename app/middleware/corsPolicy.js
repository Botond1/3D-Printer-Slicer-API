'use strict';

/** Route-aware browser-origin policy with audience-isolated allowlists. */

const {
    ROUTE_AUDIENCES,
    classifyRoute,
    normalizeRequestPath,
    resolveRequestAudience
} = require('../config/route-policy');

const AUDIENCE_ERRORS = Object.freeze({
    slice: Object.freeze({
        code: 'SLICE_CORS_ORIGIN_NOT_ALLOWED',
        message: 'Slice CORS origin is not allowed.'
    }),
    pricing: Object.freeze({
        code: 'PRICING_CORS_ORIGIN_NOT_ALLOWED',
        message: 'Pricing CORS origin is not allowed.'
    }),
    artifact: Object.freeze({
        code: 'ARTIFACT_CORS_ORIGIN_NOT_ALLOWED',
        message: 'Artifact CORS origin is not allowed.'
    }),
    operations: Object.freeze({
        code: 'OPERATIONS_CORS_ORIGIN_NOT_ALLOWED',
        message: 'Operations CORS origin is not allowed.'
    })
});

function parseAllowedOrigins(value) {
    return [...new Set(String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean))];
}

function createOriginError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.status = 403;
    return error;
}

function isAdminRoute(requestPath) {
    const normalized = normalizeRequestPath(requestPath);
    return normalized === '/admin' || normalized.startsWith('/admin/');
}

function isSliceRoute(requestPath) {
    return classifyRoute('POST', requestPath) === ROUTE_AUDIENCES.SLICE;
}

function createCorsOptionsResolver(options = {}) {
    const legacyAdminOrigins = options.adminAllowedOrigins || [];
    const legacyAdminAudience = ['artifact', 'operations', 'pricing'].includes(options.legacyAdminAudience)
        ? options.legacyAdminAudience
        : null;
    const audienceOrigins = (audience, configured) => (
        configured || (legacyAdminAudience === audience ? legacyAdminOrigins : [])
    );
    const allowlists = Object.freeze({
        slice: new Set(options.sliceAllowedOrigins || []),
        pricing: new Set(audienceOrigins('pricing', options.pricingAllowedOrigins)),
        artifact: new Set(audienceOrigins('artifact', options.artifactAllowedOrigins)),
        operations: new Set(audienceOrigins('operations', options.operationsAllowedOrigins))
    });

    return function resolveCorsOptions(req, callback) {
        const requestOrigin = req.header('Origin');
        const audience = resolveRequestAudience(req);
        const hasMethodContext = typeof req.method === 'string';
        if (!requestOrigin) {
            callback(null, hasMethodContext ? { origin: false, credentials: false } : { origin: true });
            return;
        }
        if (audience === ROUTE_AUDIENCES.PUBLIC) {
            callback(null, hasMethodContext
                ? { origin: true, credentials: false, methods: ['GET', 'HEAD', 'OPTIONS'] }
                : { origin: true });
            return;
        }
        if (requestOrigin !== 'null' && allowlists[audience].has(requestOrigin)) {
            callback(null, hasMethodContext
                ? { origin: true, credentials: true }
                : { origin: true });
            return;
        }
        const failure = AUDIENCE_ERRORS[audience];
        callback(createOriginError(failure.code, failure.message));
    };
}

module.exports = {
    AUDIENCE_ERRORS,
    createCorsOptionsResolver,
    isAdminRoute,
    isSliceRoute,
    parseAllowedOrigins
};
