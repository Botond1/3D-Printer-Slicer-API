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

function fakeUpload(error) {
    return { single: () => (req, res, next) => next(error) };
}

function passAuthentication(req, res, next) {
    next();
}

test('rate limiter runs before allocation', async () => {
    let allocated = false;
    const router = createSliceRouter({
        rateLimiter(req, res) { res.status(429).end(); },
        authenticate: passAuthentication,
        createWorkspace: async () => { allocated = true; }, upload: fakeUpload(), handlePrusa: async () => {}
    });
    const layer = router.stack.find((item) => item.route).route.stack;
    const req = { method: 'POST' };
    const res = { status() { return this; }, end() {} };
    layer[0].handle(req, res, () => assert.fail('limiter should settle response'));
    assert.equal(allocated, false);
});

for (const scenario of ['success', 'throw', 'queue rejection']) {
    test(`cleans once after handler ${scenario}`, async () => {
        let cleanups = 0;
        let forwarded;
        const expected = new Error(scenario);
        const handler = scenario === 'success' ? async () => {} : async () => { throw expected; };
        const workspace = { directory: os.tmpdir(), cleanup: async () => { cleanups++; } };
        const router = createSliceRouter({ rateLimiter(req, res, next) { next(); },
            authenticate: passAuthentication, createWorkspace: async () => workspace,
            upload: fakeUpload(), handlePrusa: handler });
        const lifecycle = router.stack.find((item) => item.route).route.stack[2].handle;
        await lifecycle({}, {}, (error) => { forwarded = error; });
        assert.equal(cleanups, 1);
        assert.equal(forwarded, scenario === 'success' ? undefined : expected);
    });
}

test('cleanup failure is reported without hiding or disclosing the original handler error', async () => {
    const original = new Error('original request failure');
    const workspace = {
        id: 'job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        directory: os.tmpdir(),
        cleanup: async () => { throw new Error('C:\\private\\workspace'); }
    };
    let forwarded;
    let report;
    const router = createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate: passAuthentication,
        createWorkspace: async () => workspace,
        upload: fakeUpload(),
        handlePrusa: async () => { throw original; },
        reportCleanupFailure(event) { report = event; }
    });
    const lifecycle = router.stack.find((item) => item.route).route.stack[2].handle;
    await lifecycle({}, {}, (error) => { forwarded = error; });
    assert.equal(forwarded, original);
    assert.deepEqual(report, { jobId: workspace.id, reason: 'cleanup_failed' });
    assert.doesNotMatch(JSON.stringify(report), /private|original request/);
});

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

for (const engine of ['prusa', 'orca']) {
    test(`${engine} route is limiter -> auth -> lifecycle; unauthorized calls allocate nothing`, async (t) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), `i3-auth-${engine}-`));
        const jobsRoot = path.join(root, 'jobs');
        const outputRoot = path.join(root, 'output');
        await fs.mkdir(outputRoot);
        const events = [];
        const warnings = [];
        let lifecycleSettledResolve;
        const lifecycleSettled = new Promise((resolve) => { lifecycleSettledResolve = resolve; });
        const effects = {
            allocations: 0,
            uploads: 0,
            handlers: 0,
            cleanups: 0,
            queueAdmissions: 0,
            timers: 0,
            listeners: 0,
            nativeProcesses: 0,
            artifacts: 0
        };
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
        const handler = async (req, res) => {
            effects.handlers += 1;
            effects.queueAdmissions += 1;
            effects.timers += 1;
            effects.listeners += 1;
            effects.nativeProcesses += 1;
            await fs.writeFile(path.join(outputRoot, `${engine}.gcode`), 'synthetic');
            effects.artifacts += 1;
            return res.status(200).json({ success: true, engine });
        };
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
            onLifecycleSettled: lifecycleSettledResolve,
            handlePrusa: handler,
            handleOrca: handler
        });
        const route = router.stack.find((layer) => layer.route.path === `/${engine}/slice`).route;
        assert.equal(route.stack.length, 3);
        assert.equal(route.stack[0].handle, rateLimiter);
        assert.equal(route.stack[1].handle, authenticate);

        const app = express();
        app.use(cors(createCorsOptionsResolver()));
        app.use(router);
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        t.after(async () => {
            await new Promise((resolve) => server.close(resolve));
            await fs.rm(root, { recursive: true, force: true });
        });
        const url = `http://127.0.0.1:${server.address().port}/${engine}/slice`;

        for (const candidate of [undefined, WRONG_EQUAL_LENGTH_KEY, 'short']) {
            const headers = candidate === undefined ? {} : { 'x-slicer-api-key': candidate };
            const response = await fetch(url, { method: 'POST', headers });
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), AUTHENTICATION_FAILURE);
        }
        assert.deepEqual(events, [
            'limiter', 'auth',
            'limiter', 'auth',
            'limiter', 'auth'
        ]);
        assert.equal(warnings.length, 3);
        assert.deepEqual(effects, {
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
        assert.deepEqual(await listOrEmpty(jobsRoot), []);
        assert.deepEqual(await fs.readdir(outputRoot), []);

        events.length = 0;
        const accepted = await fetch(url, {
            method: 'POST',
            headers: { 'x-slicer-api-key': SERVICE_KEY }
        });
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), { success: true, engine });
        await lifecycleSettled;
        assert.deepEqual(events, ['limiter', 'auth', 'lifecycle']);
        assert.equal(effects.allocations, 1);
        assert.equal(effects.uploads, 1);
        assert.equal(effects.handlers, 1);
        assert.equal(effects.cleanups, 1);
        assert.deepEqual(await listOrEmpty(jobsRoot), []);
    });
}
