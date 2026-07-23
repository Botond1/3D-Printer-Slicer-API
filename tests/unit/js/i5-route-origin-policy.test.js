'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ROUTE_AUDIENCES,
    classifyRoute,
    normalizeRequestPath,
    resolveRequestAudience
} = require('../../../app/config/route-policy');
const {
    createCorsOptionsResolver
} = require('../../../app/middleware/corsPolicy');

const ORIGINS = Object.freeze({
    slice: 'https://slice.example.invalid',
    pricing: 'https://pricing.example.invalid',
    artifact: 'https://artifact.example.invalid',
    operations: 'https://operations.example.invalid'
});

function resolveCors(resolver, {
    method = 'GET',
    path = '/health',
    origin,
    requestedMethod
}) {
    return new Promise((resolve) => {
        resolver({
            method,
            path,
            originalUrl: path,
            header(name) {
                if (name === 'Origin') return origin;
                if (name === 'Access-Control-Request-Method') return requestedMethod;
                return undefined;
            }
        }, (error, options) => resolve({ error, options }));
    });
}

test('route classification is method-aware, normalized, and complete for protected operations', () => {
    const cases = [
        ['POST', '/prusa/slice', ROUTE_AUDIENCES.SLICE],
        ['POST', '/prusa/slice/?trace=inert', ROUTE_AUDIENCES.SLICE],
        ['POST', '/orca//slice', ROUTE_AUDIENCES.SLICE],
        ['POST', '/pricing/FDM', ROUTE_AUDIENCES.PRICING],
        ['POST', '/pricing/sla/', ROUTE_AUDIENCES.PRICING],
        ['PATCH', '/pricing/FDM/PLA?trace=inert', ROUTE_AUDIENCES.PRICING],
        ['DELETE', '/pricing/SLA/RESIN/', ROUTE_AUDIENCES.PRICING],
        ['GET', '/admin/output-files', ROUTE_AUDIENCES.ARTIFACT],
        ['GET', '/admin/download/ALL?download=1', ROUTE_AUDIENCES.ARTIFACT],
        ['GET', '/health/detailed', ROUTE_AUDIENCES.OPERATIONS],
        ['GET', '/operations/readiness/', ROUTE_AUDIENCES.OPERATIONS],
        ['GET', '/operations/metrics', ROUTE_AUDIENCES.OPERATIONS],
        ['GET', '/pricing', ROUTE_AUDIENCES.PUBLIC],
        ['POST', '/pricing', ROUTE_AUDIENCES.PUBLIC],
        ['GET', '/pricing/FDM', ROUTE_AUDIENCES.PUBLIC],
        ['PUT', '/pricing/FDM/PLA', ROUTE_AUDIENCES.PUBLIC],
        ['GET', '/admin/download', ROUTE_AUDIENCES.PUBLIC],
        ['POST', '/operations/metrics', ROUTE_AUDIENCES.PUBLIC],
        ['POST', '/prusa/slice/extra', ROUTE_AUDIENCES.PUBLIC]
    ];
    for (const [method, requestPath, expected] of cases) {
        assert.equal(classifyRoute(method, requestPath), expected, `${method} ${requestPath}`);
    }
    assert.equal(normalizeRequestPath('pricing///FDM/?x=1#fragment'), '/pricing/FDM');
});

test('OPTIONS classification uses the requested method and cannot bypass the actual route audience', () => {
    const request = {
        method: 'OPTIONS',
        path: '/pricing/FDM',
        header(name) {
            assert.equal(name, 'Access-Control-Request-Method');
            return 'POST';
        }
    };
    assert.equal(resolveRequestAudience(request), ROUTE_AUDIENCES.PRICING);
    assert.equal(resolveRequestAudience({
        ...request,
        path: '/admin/download/file.gcode',
        header: () => 'GET'
    }), ROUTE_AUDIENCES.ARTIFACT);
});

test('protected Origin policy uses exact audience allowlists and permits no-Origin service clients', async () => {
    const resolver = createCorsOptionsResolver({
        sliceAllowedOrigins: [ORIGINS.slice],
        pricingAllowedOrigins: [ORIGINS.pricing],
        artifactAllowedOrigins: [ORIGINS.artifact],
        operationsAllowedOrigins: [ORIGINS.operations]
    });
    const protectedCases = [
        ['slice', 'POST', '/prusa/slice', ORIGINS.slice, null],
        ['pricing', 'PATCH', '/pricing/FDM/PLA', ORIGINS.pricing, null],
        ['artifact', 'GET', '/admin/output-files', ORIGINS.artifact, null],
        ['operations', 'GET', '/operations/metrics', ORIGINS.operations, null],
        ['cross audience', 'POST', '/pricing/FDM', ORIGINS.artifact, 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
        ['wrong scheme', 'POST', '/pricing/FDM', 'http://pricing.example.invalid', 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
        ['wrong host case', 'POST', '/pricing/FDM', 'https://PRICING.example.invalid', 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
        ['wrong port', 'POST', '/pricing/FDM', `${ORIGINS.pricing}:444`, 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
        ['opaque origin', 'GET', '/operations/metrics', 'null', 'OPERATIONS_CORS_ORIGIN_NOT_ALLOWED']
    ];
    for (const [name, method, path, origin, expectedCode] of protectedCases) {
        const result = await resolveCors(resolver, { method, path, origin });
        assert.equal(result.error?.code || null, expectedCode, name);
        if (!expectedCode) assert.equal(result.options?.origin, true, name);
    }
    for (const [method, path] of [
        ['POST', '/prusa/slice'],
        ['POST', '/pricing/FDM'],
        ['GET', '/admin/output-files'],
        ['GET', '/operations/metrics']
    ]) {
        const result = await resolveCors(resolver, { method, path });
        assert.equal(result.error, null, `${method} ${path}`);
    }
});

test('preflight is audience-bound and public unsupported methods never gain credentials', async () => {
    const resolver = createCorsOptionsResolver({
        sliceAllowedOrigins: [ORIGINS.slice],
        pricingAllowedOrigins: [ORIGINS.pricing],
        artifactAllowedOrigins: [ORIGINS.artifact],
        operationsAllowedOrigins: [ORIGINS.operations]
    });
    const accepted = await resolveCors(resolver, {
        method: 'OPTIONS',
        path: '/pricing/FDM/',
        origin: ORIGINS.pricing,
        requestedMethod: 'POST'
    });
    assert.equal(accepted.error, null);
    assert.equal(accepted.options.origin, true);

    const confused = await resolveCors(resolver, {
        method: 'OPTIONS',
        path: '/pricing/FDM',
        origin: ORIGINS.slice,
        requestedMethod: 'POST'
    });
    assert.equal(confused.error?.code, 'PRICING_CORS_ORIGIN_NOT_ALLOWED');

    const unsupported = await resolveCors(resolver, {
        method: 'PUT',
        path: '/pricing/FDM',
        origin: 'https://untrusted.example.invalid'
    });
    assert.equal(unsupported.error, null);
    assert.equal(unsupported.options.credentials, false);
});
