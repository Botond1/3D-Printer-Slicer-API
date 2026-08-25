'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { loadCommonJsFromSource } = require('./helpers/load-commonjs-from-source');

const ROOT = path.resolve(__dirname, '../../..');
const ROUTE_PATH = path.join(ROOT, 'app/routes/slice.routes.js');
const AUTH_PATH = path.join(ROOT, 'app/middleware/requireAudience.js');
const INERT_KEY = 'i3-inert-service-key-000000000000000000000000';
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

function readSource(filename) {
    return fs.readFileSync(filename, 'utf8');
}

function mutate(source, pattern, replacement, name) {
    const changed = source.replace(pattern, replacement);
    assert.notEqual(changed, source, `Missing mutation seam: ${name}`);
    return changed;
}

async function observeAuthOrder(createSliceRouter) {
    let allocations = 0;
    let handlers = 0;
    const app = express();
    app.use(createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate(req, res) {
            res.status(401).json({
                success: false,
                error: 'Slice service authentication is required.',
                errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
            });
        },
        createWorkspace: async () => {
            allocations += 1;
            return { cleanup: async () => {} };
        },
        upload: { single: () => (req, res, next) => next() },
        handlePrusa: async (req, res) => {
            handlers += 1;
            res.status(200).json({ success: true });
        }
    }));
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await onceWithTimeout(server, 'listening');
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/prusa/slice`, {
            method: 'POST'
        });
        return { status: response.status, allocations, handlers };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function onceWithTimeout(emitter, eventName) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            emitter.removeListener(eventName, onEvent);
            reject(new Error(`${eventName} was not observed within 2000ms.`));
        }, 2_000);
        timer.unref?.();
        function onEvent(...args) {
            clearTimeout(timer);
            resolve(args);
        }
        emitter.once(eventName, onEvent);
    });
}

async function assertAuthBeforeAllocation(createSliceRouter) {
    assert.deepEqual(await observeAuthOrder(createSliceRouter), {
        status: 401,
        allocations: 0,
        handlers: 0
    });
}

function invokeAuth(middleware, suppliedKey) {
    let status = null;
    let nextCalls = 0;
    middleware({
        requestId: 'i3-mutation-request',
        ip: '127.0.0.1',
        header(name) {
            assert.equal(name, 'x-slicer-api-key');
            return suppliedKey;
        }
    }, {
        status(code) {
            status = code;
            return this;
        },
        json() {
            return this;
        }
    }, () => {
        nextCalls += 1;
    });
    return { status, nextCalls };
}

function observeTimingSafePrimitive(createRequireAudience) {
    const original = crypto.timingSafeEqual;
    let timingSafeCalls = 0;
    crypto.timingSafeEqual = (left, right) => {
        timingSafeCalls += 1;
        return original(left, right);
    };
    try {
        const middleware = createRequireAudience({
            audience: 'slice',
            headerName: 'x-slicer-api-key',
            keyRing: { audiences: { slice: { active: INERT_KEY } } },
            failure: { success: false },
            logger: { warn() {} },
            alwaysComparePrevious: false
        });
        return {
            accepted: invokeAuth(middleware, INERT_KEY),
            rejected: invokeAuth(middleware, 'short'),
            timingSafeCalls
        };
    } finally {
        crypto.timingSafeEqual = original;
    }
}

function assertTimingSafePrimitive(createRequireAudience) {
    assert.deepEqual(observeTimingSafePrimitive(createRequireAudience), {
        accepted: { status: null, nextCalls: 1 },
        rejected: { status: 401, nextCalls: 0 },
        timingSafeCalls: 2
    });
}

test('mutation rejects authentication moved after request lifecycle allocation', async () => {
    const source = readSource(ROUTE_PATH);
    const liveModule = require(ROUTE_PATH);
    await assertAuthBeforeAllocation(liveModule.createSliceRouter);

    const mutatedSource = mutate(
        source,
        "router.post('/prusa/slice', rateLimiter, authenticate, lifecycle('prusa'));",
        "router.post('/prusa/slice', rateLimiter, lifecycle('prusa'), authenticate);",
        'authentication moved after lifecycle'
    );
    const mutatedModule = loadCommonJsFromSource(ROUTE_PATH, mutatedSource);
    await assert.rejects(
        () => assertAuthBeforeAllocation(mutatedModule.createSliceRouter),
        assert.AssertionError
    );
});

test('mutation rejects direct credential equality that bypasses timingSafeEqual', () => {
    const source = readSource(AUTH_PATH);
    const liveModule = require(AUTH_PATH);
    assertTimingSafePrimitive(liveModule.createRequireAudience);

    const mutatedSource = mutate(
        source,
        'compareDigests(suppliedDigest, expectedDigest) && Boolean(slotSecrets[index])',
        'supplied === slotSecrets[index] && Boolean(slotSecrets[index])',
        'direct credential equality'
    );
    assert.match(mutatedSource, /crypto\.timingSafeEqual/);
    const mutatedModule = loadCommonJsFromSource(AUTH_PATH, mutatedSource);
    assert.throws(
        () => assertTimingSafePrimitive(mutatedModule.createRequireAudience),
        assert.AssertionError
    );
});
