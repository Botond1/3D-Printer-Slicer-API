'use strict';

/**
 * 3.9.0 §4.7 / §11 K2-B9: the shared upload lifecycle after a 202. Once a
 * handler answered 202 and handed the work to an asynchronous job, nothing is
 * written to the response and `next` is never called; a workspace transferred
 * to the job is the job's to clean. Without a hand-off the lifecycle is the
 * one the render route has always used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const {
    createUploadLifecycle,
    isHandedOff,
    markAsyncHandoff,
    transferRequestWorkspace
} = require('../../../app/routes/upload-lifecycle');
const { getRequestWorkspace } = require('../../../app/services/slice/workspace');

function fakeUpload() {
    return { single: () => (req, res, next) => next() };
}

/** A response that fails the test on any write after the 202. */
function guardedResponse() {
    const writes = [];
    const res = {
        headersSent: false,
        statusCode: 200,
        status(code) { writes.push(['status', code]); this.statusCode = code; return this; },
        json(body) { writes.push(['json', body]); this.headersSent = true; return this; },
        end(body) { writes.push(['end', body]); this.headersSent = true; return this; },
        setHeader(name, value) { writes.push(['header', name, value]); return this; }
    };
    return { res, writes };
}

function workspaceStub() {
    let cleanups = 0;
    return {
        workspace: {
            id: 'job-cccccccccccccccccccccccccccccccc',
            directory: os.tmpdir(),
            cleanup: async () => { cleanups += 1; }
        },
        cleanups: () => cleanups
    };
}

function lifecycleWith(stub, extra = {}) {
    return createUploadLifecycle({
        createWorkspace: async () => stub.workspace,
        upload: fakeUpload(),
        ...extra
    });
}

test('after a 202 a handler failure is never answered and next is never called', async () => {
    const stub = workspaceStub();
    const { res, writes } = guardedResponse();
    const wrapped = lifecycleWith(stub)(async (req, response) => {
        response.status(202).json({ success: true });
        markAsyncHandoff(req);
        throw new Error('late failure after the 202');
    }, 'export');
    const req = {};
    let nextCalls = 0;
    await wrapped(req, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 0);
    assert.deepEqual(writes, [['status', 202], ['json', { success: true }]]);
    assert.equal(isHandedOff(req), true);
    // Not transferred: the lifecycle still cleans the request's workspace.
    assert.equal(stub.cleanups(), 1);
});

test('after a 202 a cleanup failure is reported, never answered', async () => {
    const stub = workspaceStub();
    stub.workspace.cleanup = async () => { throw new Error('cleanup failed'); };
    const reported = [];
    const { res, writes } = guardedResponse();
    const wrapped = lifecycleWith(stub, { reportCleanupFailure: (event) => reported.push(event) })(
        async (req, response) => {
            response.status(202).json({ ok: 1 });
            markAsyncHandoff(req);
        },
        'export'
    );
    let nextCalls = 0;
    await wrapped({}, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 0);
    assert.deepEqual(writes, [['status', 202], ['json', { ok: 1 }]]);
    assert.deepEqual(reported, [{ jobId: stub.workspace.id, reason: 'cleanup_failed' }]);
});

test('a workspace transferred to the accepted job is not cleaned by the lifecycle, only detached', async () => {
    const stub = workspaceStub();
    const { res } = guardedResponse();
    let transferred;
    const req = {};
    const wrapped = lifecycleWith(stub)(async (request, response) => {
        transferred = transferRequestWorkspace(request);
        response.status(202).json({});
        markAsyncHandoff(request);
    }, 'export');
    await wrapped(req, res, () => assert.fail('next must not be called'));
    assert.equal(transferred, stub.workspace);
    assert.equal(stub.cleanups(), 0);
    assert.equal(getRequestWorkspace(req), null);
    // The job now owns it and cleans it itself.
    await transferred.cleanup();
    assert.equal(stub.cleanups(), 1);
});

test('the async slice path is honoured too (isAsyncAccepted), and without a hand-off errors reach next', async () => {
    const stub = workspaceStub();
    const { res } = guardedResponse();
    const expected = new Error('sync failure');
    let forwarded;
    await lifecycleWith(stub)(async () => { throw expected; }, 'render')({}, res, (error) => { forwarded = error; });
    assert.equal(forwarded, expected);
    assert.equal(stub.cleanups(), 1);
    assert.equal(isHandedOff({}), false);
    assert.equal(transferRequestWorkspace({}), null);
});
