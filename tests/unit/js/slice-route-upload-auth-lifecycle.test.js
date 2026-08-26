'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const cors = require('cors');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { createSliceRouter } = require('../../../app/routes/slice.routes');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const {
    AUTHENTICATION_FAILURE,
    createRequireSliceService
} = require('../../../app/middleware/requireSliceService');
const { createCorsOptionsResolver } = require('../../../app/middleware/corsPolicy');
const errorHandler = require('../../../app/middleware/errorHandler');

const SERVICE_KEY = 'S'.repeat(40);
const WRONG_EQUAL_LENGTH_KEY = 'T'.repeat(40);

function passAuthentication(req, res, next) {
    next();
}
test('real Multer file-first nested-field rejection cleans persisted bytes before forwarding', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 's1a-route-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let settledResolve;
    const settled = new Promise((resolve) => { settledResolve = resolve; });
    const app = express();
    app.use(createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate: passAuthentication,
        createWorkspace: () => createJobWorkspace({ jobsRoot: path.join(root, 'jobs'), outputRoot: path.join(root, 'output') }),
        handlePrusa: async (req, res) => res.json({ ok: true }),
        onLifecycleSettled: settledResolve
    }));
    app.use(errorHandler);
    const server = app.listen(0);
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await fs.mkdir(path.join(root, 'output'));
    const boundary = 's1a-boundary';
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="choosenFile"; filename="tiny.stl"\r\nContent-Type: application/octet-stream\r\n\r\nsolid x\r\n--${boundary}\r\nContent-Disposition: form-data; name="a[b]"\r\n\r\nx\r\n--${boundary}--\r\n`);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/prusa/slice`, {
        method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, 'UPLOAD_FIELD_NESTING_TOO_DEEP');
    await settled;
    assert.deepEqual(await fs.readdir(path.join(root, 'jobs')), []);
});

async function listOrEmpty(directory) {
    try {
        return await fs.readdir(directory);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

const EMPTY_EFFECTS = Object.freeze({
    allocations: 0,
    uploads: 0,
    handlers: 0,
    cleanups: 0,
    queueAdmissions: 0,
    timers: 0,
    listeners: 0,
    nativeProcesses: 0,
    artifacts: 0
});

function createInstrumentedAuthentication(events, warnings) {
    const rateLimiter = (req, res, next) => {
        events.push('limiter');
        next();
    };
    const liveAuth = createRequireSliceService({
        apiKey: SERVICE_KEY,
        logger: { warn(...args) { warnings.push(args); } }
    });
    const authenticate = (req, res, next) => {
        events.push('auth');
        liveAuth(req, res, next);
    };
    return { authenticate, rateLimiter };
}

function createSuccessfulHandler(engine, outputRoot, effects) {
    return async (req, res) => {
        effects.handlers += 1;
        effects.queueAdmissions += 1;
        effects.timers += 1;
        effects.listeners += 1;
        effects.nativeProcesses += 1;
        await fs.writeFile(path.join(outputRoot, `${engine}.gcode`), 'synthetic');
        effects.artifacts += 1;
        return res.status(200).json({ success: true, engine });
    };
}

function assertRouteOrder(router, engine, rateLimiter, authenticate) {
    assert.deepEqual(
        router.stack.filter((layer) => layer.route).map((layer) => layer.route.path).sort(),
        ['/orca/slice', '/prusa/slice']
    );
    const route = router.stack.find((layer) => layer.route.path === `/${engine}/slice`).route;
    assert.equal(route.stack.length, 3);
    assert.equal(route.stack[0].handle, rateLimiter);
    assert.equal(route.stack[1].handle, authenticate);
}

async function createRouteHarness(engine, root) {
    const jobsRoot = path.join(root, 'jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot);
    const events = [];
    const warnings = [];
    const effects = { ...EMPTY_EFFECTS };
    let settleLifecycle;
    const lifecycleSettled = new Promise((resolve) => { settleLifecycle = resolve; });
    const { authenticate, rateLimiter } = createInstrumentedAuthentication(events, warnings);
    const handler = createSuccessfulHandler(engine, outputRoot, effects);
    const router = createSliceRouter({
        rateLimiter,
        authenticate,
        async createWorkspace() {
            events.push('lifecycle');
            effects.allocations += 1;
            return createJobWorkspace({ jobsRoot, outputRoot });
        },
        upload: {
            single: () => (req, res, next) => {
                effects.uploads += 1;
                next();
            }
        },
        async cleanupWorkspace(workspace) {
            effects.cleanups += 1;
            await workspace.cleanup();
        },
        onLifecycleSettled: settleLifecycle,
        handlePrusa: handler,
        handleOrca: handler
    });
    assertRouteOrder(router, engine, rateLimiter, authenticate);
    return { effects, events, jobsRoot, lifecycleSettled, outputRoot, router, warnings };
}

async function startRouteServer(t, root, engine, router) {
    const app = express();
    app.use(cors(createCorsOptionsResolver()));
    app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(root, { recursive: true, force: true });
    });
    return `http://127.0.0.1:${server.address().port}/${engine}/slice`;
}

async function assertUnauthorizedCalls(url, harness) {
    const unauthorizedHeaders = [
        {},
        { 'x-slicer-api-key': WRONG_EQUAL_LENGTH_KEY },
        { 'x-slicer-api-key': 'short' },
        { 'x-api-key': SERVICE_KEY }
    ];
    for (const headers of unauthorizedHeaders) {
        const response = await fetch(url, { method: 'POST', headers });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), AUTHENTICATION_FAILURE);
    }
    assert.deepEqual(harness.events, [
        'limiter', 'auth',
        'limiter', 'auth',
        'limiter', 'auth',
        'limiter', 'auth'
    ]);
    assert.equal(harness.warnings.length, 4);
    assert.deepEqual(harness.effects, EMPTY_EFFECTS);
    assert.deepEqual(await listOrEmpty(harness.jobsRoot), []);
    assert.deepEqual(await fs.readdir(harness.outputRoot), []);
}

async function assertAuthorizedCall(url, engine, harness) {
    harness.events.length = 0;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'x-slicer-api-key': SERVICE_KEY }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, engine });
    await harness.lifecycleSettled;
    assert.deepEqual(harness.events, ['limiter', 'auth', 'lifecycle']);
    assert.equal(harness.effects.allocations, 1);
    assert.equal(harness.effects.uploads, 1);
    assert.equal(harness.effects.handlers, 1);
    assert.equal(harness.effects.cleanups, 1);
    assert.deepEqual(await listOrEmpty(harness.jobsRoot), []);
}

for (const engine of ['prusa', 'orca']) {
    test(`${engine} route is limiter -> auth -> lifecycle; unauthorized calls allocate nothing`, async (t) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), `i3-auth-${engine}-`));
        const harness = await createRouteHarness(engine, root);
        const url = await startRouteServer(t, root, engine, harness.router);
        await assertUnauthorizedCalls(url, harness);
        await assertAuthorizedCall(url, engine, harness);
    });
}
