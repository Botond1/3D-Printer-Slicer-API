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

const ADMIN_ORIGIN = 'https://admin.example.test';
const SLICE_ORIGIN = 'https://slice.example.test';

function resolvePolicy(resolver, requestPath, origin) {
    return new Promise((resolve) => {
        resolver({
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
        parseAllowedOrigins(` ${ADMIN_ORIGIN},, ${SLICE_ORIGIN} `),
        [ADMIN_ORIGIN, SLICE_ORIGIN]
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

test('CORS policy keeps admin and slice allowlists separate and permits requests without Origin', async () => {
    const resolver = createCorsOptionsResolver({
        adminAllowedOrigins: [ADMIN_ORIGIN],
        sliceAllowedOrigins: [SLICE_ORIGIN]
    });
    const cases = [
        ['slice allowlist on Prusa', '/prusa/slice', SLICE_ORIGIN, null],
        ['slice allowlist on Orca', '/orca/slice', SLICE_ORIGIN, null],
        ['admin allowlist', '/admin/output-files', ADMIN_ORIGIN, null],
        ['admin origin cannot enter slice', '/prusa/slice', ADMIN_ORIGIN, 'SLICE_CORS_ORIGIN_NOT_ALLOWED'],
        ['slice origin cannot enter admin', '/admin/output-files', SLICE_ORIGIN, 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'],
        ['unknown slice origin', '/orca/slice', 'https://unknown.example.test', 'SLICE_CORS_ORIGIN_NOT_ALLOWED'],
        ['unknown admin origin', '/admin/download/file.gcode', 'https://unknown.example.test', 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'],
        ['slice without Origin', '/prusa/slice', undefined, null],
        ['admin without Origin', '/admin/output-files', undefined, null],
        ['unprotected route remains public', '/health', 'https://unknown.example.test', null]
    ];

    for (const [name, requestPath, origin, expectedCode] of cases) {
        const { error, options } = await resolvePolicy(resolver, requestPath, origin);
        if (expectedCode) {
            assert.equal(error?.code, expectedCode, name);
            assert.equal(error?.status, 403, name);
            assert.equal(options, undefined, name);
        } else {
            assert.equal(error, null, name);
            assert.deepEqual(options, { origin: true }, name);
        }
    }
});

test('live CORS middleware enforces disjoint allowlists with stable errors and no-Origin support', async (t) => {
    const resolver = createCorsOptionsResolver({
        adminAllowedOrigins: [ADMIN_ORIGIN],
        sliceAllowedOrigins: [SLICE_ORIGIN]
    });
    const handlerCalls = new Map();
    const app = express();
    app.use(cors(resolver));
    for (const [method, requestPath] of [
        ['post', '/prusa/slice'],
        ['post', '/orca/slice'],
        ['get', '/admin/output-files'],
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
        ['allowed Orca browser call', 'POST', '/orca/slice', SLICE_ORIGIN, 200, null],
        ['admin origin rejected from slice', 'POST', '/prusa/slice', ADMIN_ORIGIN, 403, 'SLICE_CORS_ORIGIN_NOT_ALLOWED'],
        ['allowed admin browser call', 'GET', '/admin/output-files', ADMIN_ORIGIN, 200, null],
        ['slice origin rejected from admin', 'GET', '/admin/output-files', SLICE_ORIGIN, 403, 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'],
        ['Prusa service call without Origin', 'POST', '/prusa/slice', undefined, 200, null],
        ['admin service call without Origin', 'GET', '/admin/output-files', undefined, 200, null],
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
