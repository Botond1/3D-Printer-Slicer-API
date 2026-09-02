'use strict';

const ROUTE_AUDIENCES = Object.freeze({
    PUBLIC: 'public',
    SLICE: 'slice',
    PRICING: 'pricing',
    ARTIFACT: 'artifact',
    OPERATIONS: 'operations'
});

function normalizeRequestPath(value) {
    const raw = String(value || '/').split(/[?#]/, 1)[0].replace(/\\/g, '/');
    const collapsed = raw.replace(/\/{2,}/g, '/');
    const prefixed = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
    return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed;
}

function classifyRoute(methodValue, pathValue) {
    const method = String(methodValue || 'GET').toUpperCase();
    const requestPath = normalizeRequestPath(pathValue);
    if (method === 'POST' && /^(?:\/prusa\/slice|\/orca\/slice|\/bambu\/slice|\/render)$/.test(requestPath)) {
        return ROUTE_AUDIENCES.SLICE;
    }
    if (
        ['POST', 'PATCH', 'DELETE'].includes(method)
        && /^\/pricing\/(?:FDM|SLA)(?:\/[^/]+)?$/i.test(requestPath)
    ) {
        return ROUTE_AUDIENCES.PRICING;
    }
    if (
        method === 'GET'
        && (requestPath === '/admin/output-files' || requestPath.startsWith('/admin/download/'))
    ) {
        return ROUTE_AUDIENCES.ARTIFACT;
    }
    if (
        method === 'GET'
        && ['/health/detailed', '/operations/readiness', '/operations/metrics'].includes(requestPath)
    ) {
        return ROUTE_AUDIENCES.OPERATIONS;
    }
    return ROUTE_AUDIENCES.PUBLIC;
}

function resolveRequestAudience(req) {
    const requestedMethod = String(req.method || '').toUpperCase() === 'OPTIONS'
        ? req.header?.('Access-Control-Request-Method')
        : req.method;
    return classifyRoute(requestedMethod, req.path || req.originalUrl || req.url);
}

module.exports = {
    ROUTE_AUDIENCES,
    classifyRoute,
    normalizeRequestPath,
    resolveRequestAudience
};
