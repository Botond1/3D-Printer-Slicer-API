'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { createRenderRouter, RENDER_ROUTE_PATH } = require('../../../app/routes/render.routes');
const { createUploadLifecycle, UPLOAD_FIELD_NAME } = require('../../../app/routes/upload-lifecycle');

function fakeUpload(error) {
    return { single: (field) => { assert.equal(field, 'choosenFile'); return (req, res, next) => next(error); } };
}

function passAuthentication(req, res, next) {
    next();
}

function routeLayer(router) {
    const layer = router.stack.find((item) => item.route);
    assert.equal(layer.route.path, '/render');
    assert.deepEqual(layer.route.methods, { post: true });
    return layer.route.stack;
}

test('POST /render is the only route and keeps limiter -> auth -> lifecycle order', () => {
    assert.equal(RENDER_ROUTE_PATH, '/render');
    assert.equal(UPLOAD_FIELD_NAME, 'choosenFile');
    const marks = [];
    const router = createRenderRouter({
        rateLimiter(req, res, next) { marks.push('limiter'); next(); },
        authenticate(req, res, next) { marks.push('auth'); next(); },
        createWorkspace: async () => { marks.push('allocate'); return { directory: os.tmpdir(), cleanup: async () => {} }; },
        upload: fakeUpload(),
        handleRender: async () => { marks.push('handler'); }
    });
    assert.equal(router.stack.filter((item) => item.route).length, 1);
    const stack = routeLayer(router);
    assert.equal(stack.length, 3);
});

test('rate limiter and authentication reject before workspace allocation', async () => {
    for (const rejecting of ['rateLimiter', 'authenticate']) {
        let allocated = false;
        const router = createRenderRouter({
            rateLimiter: rejecting === 'rateLimiter'
                ? (req, res) => { res.status(429).end(); }
                : (req, res, next) => next(),
            authenticate: rejecting === 'authenticate'
                ? (req, res) => { res.status(401).end(); }
                : passAuthentication,
            createWorkspace: async () => { allocated = true; },
            upload: fakeUpload(),
            handleRender: async () => {}
        });
        const stack = routeLayer(router);
        const res = { status() { return this; }, end() {} };
        const index = rejecting === 'rateLimiter' ? 0 : 1;
        await new Promise((resolve) => {
            stack[index].handle({ method: 'POST' }, res, () => assert.fail(`${rejecting} should settle response`));
            setImmediate(resolve);
        });
        assert.equal(allocated, false, rejecting);
    }
});

for (const scenario of ['success', 'throw']) {
    test(`render lifecycle cleans the workspace exactly once after handler ${scenario}`, async () => {
        let cleanups = 0;
        let forwarded;
        let observed;
        const expected = new Error(scenario);
        const workspace = { id: 'job-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', directory: os.tmpdir(), cleanup: async () => { cleanups++; } };
        const router = createRenderRouter({
            rateLimiter(req, res, next) { next(); },
            authenticate: passAuthentication,
            createWorkspace: async () => workspace,
            upload: fakeUpload(),
            handleRender: scenario === 'success' ? async () => {} : async () => { throw expected; },
            onLifecycleSettled(event) { observed = event; }
        });
        const lifecycle = routeLayer(router)[2].handle;
        const req = {};
        await lifecycle(req, {}, (error) => { forwarded = error; });
        assert.equal(cleanups, 1);
        assert.equal(forwarded, scenario === 'success' ? undefined : expected);
        assert.equal(observed.engine, 'render');
        assert.equal(observed.workspace, workspace);
        assert.equal(req.sliceJobId, workspace.id);
    });
}

test('upload failures are normalized through the shared safe upload mapping', async () => {
    const workspace = { directory: os.tmpdir(), cleanup: async () => {} };
    const cases = [
        [Object.assign(new Error('bad'), { code: 'ECONNRESET' }), 'UPLOAD_REQUEST_ABORTED', 400],
        [Object.assign(new Error('nope'), { code: 'UNSUPPORTED_FILE_FORMAT', status: 400 }), 'UNSUPPORTED_FILE_FORMAT', 400],
        [new Error('C:\\private\\multipart-detail'), 'MALFORMED_MULTIPART_REQUEST', 400]
    ];
    for (const [uploadError, code, status] of cases) {
        let forwarded;
        let handled = false;
        const router = createRenderRouter({
            rateLimiter(req, res, next) { next(); },
            authenticate: passAuthentication,
            createWorkspace: async () => workspace,
            upload: fakeUpload(uploadError),
            handleRender: async () => { handled = true; }
        });
        await routeLayer(router)[2].handle({}, {}, (error) => { forwarded = error; });
        assert.equal(forwarded.code, code);
        assert.equal(forwarded.status, status);
        assert.equal(handled, false, code);
        if (code === 'MALFORMED_MULTIPART_REQUEST') assert.doesNotMatch(forwarded.message, /private/);
    }
});

test('workspace allocation failure is reported generically and cleanup failure is surfaced', async () => {
    let forwarded;
    const failingAllocation = createRenderRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate: passAuthentication,
        createWorkspace: async () => { throw new Error('C:\\private\\jobs'); },
        upload: fakeUpload(),
        handleRender: async () => {}
    });
    await routeLayer(failingAllocation)[2].handle({}, {}, (error) => { forwarded = error; });
    assert.equal(forwarded.code, 'WORKSPACE_ALLOCATION_FAILED');
    assert.doesNotMatch(forwarded.message, /private/);

    let report;
    const failingCleanup = createRenderRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate: passAuthentication,
        createWorkspace: async () => ({
            id: 'job-cccccccccccccccccccccccccccccccc',
            directory: os.tmpdir(),
            cleanup: async () => { throw new Error('C:\\private\\workspace'); }
        }),
        upload: fakeUpload(),
        handleRender: async () => {},
        reportCleanupFailure(event) { report = event; }
    });
    await routeLayer(failingCleanup)[2].handle({}, {}, (error) => { forwarded = error; });
    assert.equal(forwarded.code, 'WORKSPACE_CLEANUP_FAILED');
    assert.deepEqual(report, { jobId: 'job-cccccccccccccccccccccccccccccccc', reason: 'cleanup_failed' });
});

test('upload lifecycle factory refuses a missing handler', () => {
    const lifecycle = createUploadLifecycle({ upload: fakeUpload() });
    assert.throws(() => lifecycle(undefined, 'render'), /requires a handler/);
});
