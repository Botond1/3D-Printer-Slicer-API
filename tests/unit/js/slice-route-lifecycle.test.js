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
const { createSliceRouter } = require('../../../app/routes/slice.routes');

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
