'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    createSliceQueue,
    SliceQueueShutdownError,
    toQueueErrorResponse
} = require('../../../app/services/slice/queue');
const {
    bindRequestAbort
} = require('../../../app/services/slice/request-abort');
const {
    createSliceHandlers,
    writeJsonAndWaitForFinish,
    setResponseSettlement,
    setResponseAbortSignal
} = require('../../../app/services/slice.service');
const { createSliceRouter } = require('../../../app/routes/slice.routes');

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function outcome(promise) {
    return promise.then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason })
    );
}

async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

class SyntheticRequest extends EventEmitter {
    constructor() {
        super();
        this.socket = new EventEmitter();
        this.aborted = false;
        this.destroyed = false;
    }
}

class SyntheticResponse extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.closed = false;
        this.writableEnded = false;
        this.writableFinished = false;
        this.headersSent = false;
        this.statusCode = 200;
        this.jsonWrites = 0;
    }

    status(statusCode) {
        this.statusCode = statusCode;
        return this;
    }

    json(payload) {
        this.headersSent = true;
        this.jsonWrites += 1;
        this.payload = payload;
        return this;
    }
}

function assertNoAbortBindingListeners(req, res) {
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(req.listenerCount('error'), 0);
    assert.equal(req.socket.listenerCount('error'), 0);
    assert.equal(res.listenerCount('finish'), 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
}

test('request, socket, and unfinished-response disconnects abort exactly once and remove listeners', async (t) => {
    const cases = [
        ['request aborted', (req) => req.emit('aborted'), true],
        ['socket error', (req) => req.socket.emit('error', new Error('socket failed')), false],
        ['unfinished response close', (_req, res) => res.emit('close'), true]
    ];

    for (const [name, trigger, repeat] of cases) {
        await t.test(name, () => {
            const req = new SyntheticRequest();
            const res = new SyntheticResponse();
            const binding = bindRequestAbort(req, res);
            let abortEvents = 0;
            binding.signal.addEventListener('abort', () => { abortEvents += 1; });

            trigger(req, res);
            if (repeat) trigger(req, res);
            assert.equal(binding.signal.aborted, true);
            assert.equal(abortEvents, 1);
            assertNoAbortBindingListeners(req, res);
            binding.dispose();
            assertNoAbortBindingListeners(req, res);
        });
    }
});

test('normal finish and successful close are not aborts, while a pre-destroyed request fails fast', () => {
    const completedReq = new SyntheticRequest();
    const completedRes = new SyntheticResponse();
    completedReq.destroyed = true;
    completedReq.complete = true;
    const completedBinding = bindRequestAbort(completedReq, completedRes);
    assert.equal(completedBinding.signal.aborted, false);
    completedBinding.dispose();
    assertNoAbortBindingListeners(completedReq, completedRes);

    const req = new SyntheticRequest();
    const res = new SyntheticResponse();
    const binding = bindRequestAbort(req, res);
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');
    assert.equal(binding.signal.aborted, false);
    assertNoAbortBindingListeners(req, res);

    const destroyedReq = new SyntheticRequest();
    const destroyedRes = new SyntheticResponse();
    destroyedReq.destroyed = true;
    const destroyedBinding = bindRequestAbort(destroyedReq, destroyedRes);
    assert.equal(destroyedBinding.signal.aborted, true);
    assertNoAbortBindingListeners(destroyedReq, destroyedRes);
});

test('shutdown rejects queued and new work, aborts active work, and drains only after task settlement', async () => {
    const queue = createSliceQueue({
        maxConcurrent: 1,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 60_000
    });
    const activeGate = deferred();
    let activeSignal;
    let queuedRuns = 0;
    const active = outcome(queue.enqueueSliceJob(async (signal) => {
        activeSignal = signal;
        await activeGate.promise;
        return 'ignored-success';
    }, { queueKey: 'active' }));
    const queued = outcome(queue.enqueueSliceJob(async () => {
        queuedRuns += 1;
        return 'queued';
    }, { queueKey: 'queued' }));
    await flush();

    let drained = false;
    const firstShutdown = queue.beginSliceQueueShutdown();
    const secondShutdown = queue.beginSliceQueueShutdown();
    firstShutdown.then(() => { drained = true; });
    const queuedResult = await queued;
    const admission = await outcome(queue.enqueueSliceJob(async () => 'new', { queueKey: 'new' }));

    assert.equal(activeSignal.aborted, true);
    assert.equal(queuedRuns, 0);
    assert.ok(queuedResult.reason instanceof SliceQueueShutdownError);
    assert.ok(admission.reason instanceof SliceQueueShutdownError);
    assert.equal(toQueueErrorResponse(admission.reason).status, 503);
    assert.equal(toQueueErrorResponse(admission.reason).body.errorCode, 'SLICE_QUEUE_SHUTDOWN');
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    assert.equal(queue.getQueueStatus().queueLength, 0);
    assert.equal(drained, false);

    activeGate.resolve();
    const activeResult = await active;
    assert.ok(activeResult.reason instanceof SliceQueueShutdownError);
    await Promise.all([firstShutdown, secondShutdown]);
    assert.equal(drained, true);
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('an aborted active request cannot write success and route cleanup waits for task settlement', async () => {
    const queue = createSliceQueue({
        maxConcurrent: 1,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 60_000
    });
    const taskStarted = deferred();
    const taskGate = deferred();
    let cleanupCalls = 0;
    let taskSignal;
    const handlers = createSliceHandlers({
        getClientIpImpl: () => 'client',
        enqueueSliceJobImpl: queue.enqueueSliceJob,
        processSliceImpl: async (request, res, options) => {
            taskSignal = options.signal;
            taskStarted.resolve();
            await taskGate.promise;
            setResponseSettlement(request, writeJsonAndWaitForFinish(res, { success: true }));
            return res;
        }
    });
    const workspace = { directory: process.cwd(), cleanup: async () => { cleanupCalls += 1; } };
    const router = createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        createWorkspace: async () => workspace,
        cleanupWorkspace: (owned) => owned.cleanup(),
        upload: { single: () => (req, res, next) => next() },
        handlePrusa: handlers.handleSlicePrusa
    });
    const lifecycle = router.stack.find((layer) => layer.route).route.stack[1].handle;
    const req = new SyntheticRequest();
    const res = new SyntheticResponse();
    let forwarded;
    const lifecycleDone = lifecycle(req, res, (error) => { forwarded = error; });

    await taskStarted.promise;
    req.emit('aborted');
    await flush();
    assert.equal(taskSignal.aborted, true);
    assert.equal(cleanupCalls, 0);
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    taskGate.resolve();
    await lifecycleDone;

    assert.equal(res.jsonWrites, 0);
    assert.equal(cleanupCalls, 1);
    assert.equal(forwarded, undefined);
    assert.equal(queue.getQueueStatus().activeJobs, 0);
    assertNoAbortBindingListeners(req, res);
});

test('response abort guard removes listeners and prevents release-path success', async () => {
    const res = new SyntheticResponse();
    const controller = new AbortController();
    setResponseAbortSignal(res, controller.signal);
    controller.abort(new Error('response aborted'));

    await assert.rejects(writeJsonAndWaitForFinish(res, { success: true }), /aborted/i);
    assert.equal(res.jsonWrites, 0);
    assert.equal(res.listenerCount('finish'), 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
});
