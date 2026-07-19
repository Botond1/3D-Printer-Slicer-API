'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSliceRouter } = require('../../../app/routes/slice.routes');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const errorHandler = require('../../../app/middleware/errorHandler');

function fakeUpload(error) {
    return { single: () => (req, res, next) => next(error) };
}

test('rate limiter runs before allocation', async () => {
    let allocated = false;
    const router = createSliceRouter({
        rateLimiter(req, res) { res.status(429).end(); },
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
        const router = createSliceRouter({ rateLimiter(req, res, next) { next(); }, createWorkspace: async () => workspace,
            upload: fakeUpload(), handlePrusa: handler });
        const lifecycle = router.stack.find((item) => item.route).route.stack[1].handle;
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
        createWorkspace: async () => workspace,
        upload: fakeUpload(),
        handlePrusa: async () => { throw original; },
        reportCleanupFailure(event) { report = event; }
    });
    const lifecycle = router.stack.find((item) => item.route).route.stack[1].handle;
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
