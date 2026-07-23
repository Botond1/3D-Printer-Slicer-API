'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const cors = require('cors');
const {
    createCorsOptionsResolver,
    isAdminRoute,
    isSliceRoute,
    parseAllowedOrigins
} = require('../../../app/middleware/corsPolicy');
const errorHandler = require('../../../app/middleware/errorHandler');

const SLICE_ORIGIN = 'https://slice.example.test';
const PRICING_ORIGIN = 'https://pricing.example.test';
const ARTIFACT_ORIGIN = 'https://artifact.example.test';
const OPERATIONS_ORIGIN = 'https://operations.example.test';
const LEGACY_ORIGIN = 'https://legacy-admin.example.test';

function resolvePolicy(resolver, method, requestPath, origin) {
    return new Promise((resolve) => {
        resolver({
            method,
            path: requestPath,
            header(name) {
                assert.equal(name, 'Origin');
                return origin;
            }
        }, (error, options) => resolve({ error, options }));
    });
}

test('origin parsing and protected-route classification remain exact', () => {
    assert.deepEqual(
        parseAllowedOrigins(` ${ARTIFACT_ORIGIN},, ${SLICE_ORIGIN} `),
        [ARTIFACT_ORIGIN, SLICE_ORIGIN]
    );
    assert.deepEqual(parseAllowedOrigins(undefined), []);

    for (const [requestPath, admin, slice] of [
        ['/admin', true, false],
        ['/admin/output-files', true, false],
        ['/administrator', false, false],
        ['/prusa/slice', false, true],
        ['/prusa/slice/', false, true],
        ['/orca/slice', false, true],
        ['/orca/slice/extra', false, false],
        ['/pricing', false, false]
    ]) {
        assert.equal(isAdminRoute(requestPath), admin, requestPath);
        assert.equal(isSliceRoute(requestPath), slice, requestPath);
    }
});

test('CORS policy isolates every protected audience and permits requests without Origin', async () => {
    const resolver = createCorsOptionsResolver({
        sliceAllowedOrigins: [SLICE_ORIGIN],
        pricingAllowedOrigins: [PRICING_ORIGIN],
        artifactAllowedOrigins: [ARTIFACT_ORIGIN],
        operationsAllowedOrigins: [OPERATIONS_ORIGIN]
    });
    const cases = [
        ['slice allowlist', 'POST', '/prusa/slice', SLICE_ORIGIN, null],
        ['pricing allowlist', 'PATCH', '/pricing/FDM/PLA', PRICING_ORIGIN, null],
        ['artifact allowlist', 'GET', '/admin/output-files', ARTIFACT_ORIGIN, null],
        ['operations allowlist', 'GET', '/operations/metrics', OPERATIONS_ORIGIN, null],
        ['artifact cannot enter slice', 'POST', '/orca/slice', ARTIFACT_ORIGIN, 'SLICE_CORS_ORIGIN_NOT_ALLOWED'],
        ['slice cannot enter pricing', 'POST', '/pricing/FDM', SLICE_ORIGIN, 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
        ['pricing cannot enter artifact', 'GET', '/admin/download/file.gcode', PRICING_ORIGIN, 'ARTIFACT_CORS_ORIGIN_NOT_ALLOWED'],
        ['artifact cannot enter operations', 'GET', '/health/detailed', ARTIFACT_ORIGIN, 'OPERATIONS_CORS_ORIGIN_NOT_ALLOWED'],
        ['slice without Origin', 'POST', '/prusa/slice', undefined, null],
        ['artifact without Origin', 'GET', '/admin/output-files', undefined, null],
        ['public route remains public', 'GET', '/health', 'https://unknown.example.test', null]
    ];

    for (const [name, method, requestPath, origin, expectedCode] of cases) {
        const { error, options } = await resolvePolicy(resolver, method, requestPath, origin);
        if (expectedCode) {
            assert.equal(error?.code, expectedCode, name);
            assert.equal(error?.status, 403, name);
            assert.equal(options, undefined, name);
        } else {
            assert.equal(error, null, name);
            assert.equal(options.origin, origin !== undefined, name);
            assert.equal(options.credentials, origin !== undefined && requestPath !== '/health', name);
        }
    }
});

test('legacy admin Origin migration is finite and grants exactly one configured audience', async () => {
    for (const legacyAdminAudience of ['pricing', 'artifact', 'operations']) {
        const resolver = createCorsOptionsResolver({
            adminAllowedOrigins: [LEGACY_ORIGIN],
            legacyAdminAudience
        });
        for (const [audience, method, requestPath, errorCode] of [
            ['pricing', 'POST', '/pricing/FDM', 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
            ['artifact', 'GET', '/admin/output-files', 'ARTIFACT_CORS_ORIGIN_NOT_ALLOWED'],
            ['operations', 'GET', '/operations/readiness', 'OPERATIONS_CORS_ORIGIN_NOT_ALLOWED']
        ]) {
            const result = await resolvePolicy(resolver, method, requestPath, LEGACY_ORIGIN);
            assert.equal(result.error?.code || null,
                audience === legacyAdminAudience ? null : errorCode,
                `${legacyAdminAudience} migration cannot grant ${audience}`);
        }
    }

    const disabled = createCorsOptionsResolver({ adminAllowedOrigins: [LEGACY_ORIGIN] });
    const result = await resolvePolicy(disabled, 'GET', '/admin/output-files', LEGACY_ORIGIN);
    assert.equal(result.error?.code, 'ARTIFACT_CORS_ORIGIN_NOT_ALLOWED');
});

test('live CORS middleware enforces scoped allowlists with stable errors', async (t) => {
    const resolver = createCorsOptionsResolver({
        sliceAllowedOrigins: [SLICE_ORIGIN],
        pricingAllowedOrigins: [PRICING_ORIGIN],
        artifactAllowedOrigins: [ARTIFACT_ORIGIN],
        operationsAllowedOrigins: [OPERATIONS_ORIGIN]
    });
    const handlerCalls = new Map();
    const app = express();
    app.use(cors(resolver));
    for (const [method, requestPath] of [
        ['post', '/prusa/slice'],
        ['post', '/pricing/FDM'],
        ['get', '/admin/output-files'],
        ['get', '/operations/metrics'],
        ['get', '/health']
    ]) {
        app[method](requestPath, (req, res) => {
            handlerCalls.set(requestPath, (handlerCalls.get(requestPath) || 0) + 1);
            res.status(200).json({ success: true, path: requestPath });
        });
    }
    app.use(errorHandler);

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cases = [
        ['allowed Prusa browser call', 'POST', '/prusa/slice', SLICE_ORIGIN, 200, null],
        ['allowed pricing browser call', 'POST', '/pricing/FDM', PRICING_ORIGIN, 200, null],
        ['slice rejected from pricing', 'POST', '/pricing/FDM', SLICE_ORIGIN, 403, 'PRICING_CORS_ORIGIN_NOT_ALLOWED'],
        ['allowed artifact browser call', 'GET', '/admin/output-files', ARTIFACT_ORIGIN, 200, null],
        ['slice rejected from artifact', 'GET', '/admin/output-files', SLICE_ORIGIN, 403, 'ARTIFACT_CORS_ORIGIN_NOT_ALLOWED'],
        ['allowed operations browser call', 'GET', '/operations/metrics', OPERATIONS_ORIGIN, 200, null],
        ['Prusa service call without Origin', 'POST', '/prusa/slice', undefined, 200, null],
        ['artifact service call without Origin', 'GET', '/admin/output-files', undefined, 200, null],
        ['public route accepts unrelated Origin', 'GET', '/health', 'https://unknown.example.test', 200, null]
    ];

    for (const [name, method, requestPath, origin, status, errorCode] of cases) {
        const before = handlerCalls.get(requestPath) || 0;
        const headers = origin === undefined ? {} : { Origin: origin };
        const response = await fetch(`${baseUrl}${requestPath}`, { method, headers });
        assert.equal(response.status, status, name);
        const body = await response.json();
        if (errorCode) {
            assert.equal(body.errorCode, errorCode, name);
            assert.equal(handlerCalls.get(requestPath) || 0, before, name);
        } else {
            assert.deepEqual(body, { success: true, path: requestPath }, name);
            assert.equal(handlerCalls.get(requestPath), before + 1, name);
            if (origin !== undefined) {
                assert.equal(response.headers.get('access-control-allow-origin'), origin, name);
            }
        }
    }
});
