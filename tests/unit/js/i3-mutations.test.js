'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const express = require('express');
const {
    loadCommonJsFromSource
} = require('./helpers/load-commonjs-from-source');

const ROOT = path.resolve(__dirname, '../../..');
const ROUTE_PATH = path.join(ROOT, 'app/routes/slice.routes.js');
const AUTH_PATH = path.join(ROOT, 'app/middleware/requireSliceService.js');
const HTTP_SERVER_PATH = path.join(ROOT, 'app/services/http-server.js');
const RUNTIME_PATH = path.join(ROOT, 'app/services/runtime-lifecycle.js');
const SERVER_PATH = path.join(ROOT, 'app/server.js');
const INERT_KEY = 'i3-inert-service-key-000000000000000000000000';

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

function observeTimingSafePrimitive(createRequireSliceService) {
    const original = crypto.timingSafeEqual;
    let timingSafeCalls = 0;
    crypto.timingSafeEqual = (left, right) => {
        timingSafeCalls += 1;
        return original(left, right);
    };
    try {
        const middleware = createRequireSliceService({
            apiKey: INERT_KEY,
            logger: { warn() {} }
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

function assertTimingSafePrimitive(createRequireSliceService) {
    assert.deepEqual(observeTimingSafePrimitive(createRequireSliceService), {
        accepted: { status: null, nextCalls: 1 },
        rejected: { status: 401, nextCalls: 0 },
        timingSafeCalls: 2
    });
}

function removeStartupServiceKeyGuard(source) {
    const guardStart = source.indexOf('let sliceServiceApiKey;');
    const guardEnd = source.indexOf('// Initialize required directories and load pricing data');
    assert.notEqual(guardStart, -1, 'Missing startup service-key guard start.');
    assert.ok(guardEnd > guardStart, 'Missing startup service-key guard end.');
    return `${source.slice(0, guardStart)}let sliceServiceApiKey;\n${source.slice(guardEnd)}`;
}

function observeMissingKeyStartup(source) {
    const startupMarker = '// Initialize required directories and load pricing data';
    const instrumented = mutate(
        source,
        startupMarker,
        `process.stdout.write('I3_BOOTSTRAP_REACHED\\n');\nprocess.exit(42);\n${startupMarker}`,
        'startup observation marker'
    );
    const runner = [
        "const fs = require('node:fs');",
        "const Module = require('node:module');",
        "const path = require('node:path');",
        "const source = fs.readFileSync(0, 'utf8');",
        "const filename = process.env.I3_SERVER_PATH;",
        "const loaded = new Module(filename, module);",
        "loaded.filename = filename;",
        "loaded.paths = Module._nodeModulePaths(path.dirname(filename));",
        "loaded._compile(source, filename);"
    ].join('\n');
    const env = {
        ...process.env,
        ADMIN_API_KEY: 'i3-inert-admin-key',
        DOTENV_CONFIG_QUIET: 'true',
        I3_SERVER_PATH: SERVER_PATH,
        SLICE_SERVICE_API_KEY: ''
    };
    const result = spawnSync(process.execPath, ['-e', runner], {
        cwd: ROOT,
        encoding: 'utf8',
        env,
        input: instrumented,
        timeout: 5_000
    });
    assert.equal(result.error, undefined);
    return result;
}

function assertMissingKeyFailsClosed(observation) {
    assert.equal(observation.status, 1);
    assert.match(observation.stderr, /Service authentication configuration is invalid/);
    assert.doesNotMatch(observation.stdout, /I3_BOOTSTRAP_REACHED/);
}

function assertRequestTimeoutUpperBound(httpServerModule) {
    const resolved = httpServerModule.resolveHttpServerOptions({
        HTTP_REQUEST_TIMEOUT_MS: '600001'
    });
    assert.equal(resolved.requestTimeout, 600_000);
}

async function observeGracefulHttpClose(createRuntimeLifecycle) {
    let queueShutdownCalls = 0;
    let closeCalls = 0;
    let closeIdleCalls = 0;
    const processRef = new EventEmitter();
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown() {
            queueShutdownCalls += 1;
        }
    });
    await lifecycle.run(async () => ({
        close(callback) {
            closeCalls += 1;
            callback();
        },
        closeIdleConnections() {
            closeIdleCalls += 1;
        }
    }));
    await lifecycle.shutdown();
    return { queueShutdownCalls, closeCalls, closeIdleCalls };
}

async function assertGracefulHttpClose(createRuntimeLifecycle) {
    assert.deepEqual(await observeGracefulHttpClose(createRuntimeLifecycle), {
        queueShutdownCalls: 1,
        closeCalls: 1,
        closeIdleCalls: 1
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
    assertTimingSafePrimitive(liveModule.createRequireSliceService);

    const mutatedSource = mutate(
        source,
        '&& timingSafeCompare(suppliedApiKey, configuredApiKey);',
        '&& suppliedApiKey === configuredApiKey;',
        'direct credential equality'
    );
    assert.match(mutatedSource, /crypto\.timingSafeEqual/);
    const mutatedModule = loadCommonJsFromSource(AUTH_PATH, mutatedSource);
    assert.throws(
        () => assertTimingSafePrimitive(mutatedModule.createRequireSliceService),
        assert.AssertionError
    );
});

test('mutation rejects removal of the missing service-key startup guard', () => {
    const source = readSource(SERVER_PATH);
    assertMissingKeyFailsClosed(observeMissingKeyStartup(source));

    const mutatedSource = removeStartupServiceKeyGuard(source);
    const observation = observeMissingKeyStartup(mutatedSource);
    assert.equal(observation.status, 42, 'The mutation must reach bootstrap without a service key.');
    assert.match(observation.stdout, /I3_BOOTSTRAP_REACHED/);
    assert.throws(() => assertMissingKeyFailsClosed(observation), assert.AssertionError);
});

test('mutation rejects a relaxed request-timeout upper bound', () => {
    const source = readSource(HTTP_SERVER_PATH);
    const liveModule = require(HTTP_SERVER_PATH);
    assertRequestTimeoutUpperBound(liveModule);

    const mutatedSource = mutate(
        source,
        'HTTP_REQUEST_TIMEOUT_MS: Object.freeze({ minimum: 60_000, maximum: 600_000 })',
        'HTTP_REQUEST_TIMEOUT_MS: Object.freeze({ minimum: 60_000, maximum: 600_001 })',
        'relaxed request-timeout upper bound'
    );
    const mutatedModule = loadCommonJsFromSource(HTTP_SERVER_PATH, mutatedSource);
    assert.throws(() => assertRequestTimeoutUpperBound(mutatedModule), assert.AssertionError);
});

test('mutation rejects removal of graceful HTTP close during shutdown', async () => {
    const source = readSource(RUNTIME_PATH);
    const liveModule = require(RUNTIME_PATH);
    await assertGracefulHttpClose(liveModule.createRuntimeLifecycle);

    const mutatedSource = mutate(
        source,
        '? closeHttpServer(readyServer)',
        '? Promise.resolve()',
        'graceful HTTP close removal'
    );
    const mutatedModule = loadCommonJsFromSource(RUNTIME_PATH, mutatedSource);
    await assert.rejects(
        () => assertGracefulHttpClose(mutatedModule.createRuntimeLifecycle),
        assert.AssertionError
    );
});
