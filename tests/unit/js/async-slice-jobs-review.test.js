'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { createAsyncHarness, deferred, send } = require('./helpers/async-slice-harness');
const { createQueueScheduler } = require('../../../app/services/slice/queue-scheduler');
const { createSliceQueue } = require('../../../app/services/slice/queue');
const { createAsyncSliceJobStore } = require('../../../app/services/slice/async-jobs');
const { createSliceHandlers } = require('../../../app/services/slice.service');
const { createLimiterMiddleware, TokenBucketRateLimiter } = require('../../../app/middleware/rateLimit');
const { DEFAULTS } = require('../../../app/config/constants');

const OK = Object.freeze({ status: 200, body: { success: true }, retryAfterSeconds: null });

function scheduler(overrides = {}) {
    return createQueueScheduler({
        maxConcurrent: 1, maxQueueLength: 20, maxQueuePerClient: 20, maxWaitMs: 60_000,
        now: Date.now, setTimeout, clearTimeout,
        createFullError: () => new Error('full'),
        createTimeoutError: () => new Error('timeout'),
        createClientLimitError: () => new Error('limit'),
        createShutdownError: () => new Error('shutdown'),
        ...overrides
    });
}

function fakeClock() {
    let current = Date.parse('2026-10-06T08:00:00.000Z');
    const timers = new Map();
    let sequence = 0;
    return {
        now: () => current,
        setTimeout(callback, delay) {
            const handle = { id: (sequence += 1), unref() { return this; } };
            timers.set(handle, { at: current + delay, callback });
            return handle;
        },
        clearTimeout(handle) { timers.delete(handle); },
        advance(ms) {
            current += ms;
            for (const [handle, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
                if (timer.at <= current && timers.has(handle)) {
                    timers.delete(handle);
                    timer.callback();
                }
            }
        }
    };
}

class SyntheticRequest extends EventEmitter {
    constructor(headers = {}) {
        super();
        this.socket = new EventEmitter();
        this.aborted = false;
        this.destroyed = false;
        this.headers = headers;
        this.requestId = 'req-review-1';
        this.slicePrincipal = Object.freeze({ audience: 'slice', slot: 'woocommerce' });
    }
}

class SyntheticResponse extends EventEmitter {
    constructor(onJson) {
        super();
        this.destroyed = false;
        this.closed = false;
        this.writableEnded = false;
        this.headersSent = false;
        this.statusCode = 200;
        this.headers = {};
        this.onJson = onJson;
    }
    status(code) { this.statusCode = code; return this; }
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
    json(payload) {
        this.onJson?.(this);
        this.headersSent = true;
        this.writableEnded = true;
        this.payload = payload;
        return this;
    }
}

test('item 1: a waiting synchronous request starts before waiting async jobs, FIFO within each class', async () => {
    const queue = scheduler();
    const started = [];
    const gates = {};
    const job = (name) => async () => {
        started.push(name);
        gates[name] = deferred();
        await gates[name].promise;
        return name;
    };
    const handles = {};
    const asyncJob = (name) => queue.enqueueSliceJob(job(name), {
        queueKey: 'shop', ignoreQueueWait: true, onAdmitted: (handle) => { handles[name] = handle; }
    });
    const settled = [queue.enqueueSliceJob(job('blocker'), { queueKey: 'shop' }),
        asyncJob('async-1'), asyncJob('async-2'),
        queue.enqueueSliceJob(job('sync-1'), { queueKey: 'other' }),
        queue.enqueueSliceJob(job('sync-2'), { queueKey: 'other' })];
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['blocker']);
    assert.equal(handles['async-1'].getQueuePosition(), 3, 'both synchronous waiters start first');
    assert.equal(handles['async-2'].getQueuePosition(), 4);
    for (const name of ['blocker', 'sync-1', 'sync-2', 'async-1']) {
        gates[name].resolve();
        await new Promise((resolve) => setImmediate(resolve));
        if (name === 'sync-2') assert.equal(handles['async-1'].getQueuePosition(), null);
    }
    gates['async-2'].resolve();
    await Promise.all(settled);
    assert.deepEqual(started, ['blocker', 'sync-1', 'sync-2', 'async-1', 'async-2']);
    // Without async jobs the order is the historical FIFO.
    const plain = scheduler();
    const order = [];
    await Promise.all(['a', 'b', 'c'].map((name) => plain.enqueueSliceJob(async () => { order.push(name); }, { queueKey: name })));
    assert.deepEqual(order, ['a', 'b', 'c']);
});

test('item 1: over HTTP a synchronous slice overtakes a queued async job and does not time out', async (t) => {
    const harness = await createAsyncHarness(t, { queue: { maxWaitMs: 2_000 } });
    const gate = deferred();
    harness.pipeline.state.gate = gate;
    const running = (await harness.submit()).headers.location;
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    const queuedAsync = (await harness.submit()).headers.location;
    const synchronous = harness.submit({ prefer: '' });
    await harness.waitFor(async () => (await harness.status(queuedAsync)).json.queue_position === 2);
    gate.resolve();
    assert.equal((await synchronous).status, 200);
    await harness.pollCompleted(queuedAsync);
    await harness.pollCompleted(running);
    assert.deepEqual(harness.pipeline.state.runs.map((run) => run.prefer), ['respond-async', '', 'respond-async'],
        'the synchronous slice started before the async job that was queued first');
    await harness.assertDrained();
});

test('item 2: a throw after admission cancels the job and settles it before the request fails', async () => {
    const queue = createSliceQueue({ maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10, maxWaitMs: 60_000 });
    const store = createAsyncSliceJobStore({ deadlineMs: 60_000, resultTtlMs: 60_000, maxJobs: 5, emitEvent: () => {} });
    let taskSignal;
    const handlers = createSliceHandlers({
        asyncJobStore: store,
        enqueueSliceJobImpl: queue.enqueueSliceJob,
        getClientIpImpl: () => '203.0.113.9',
        processSliceImpl: (req, res, options) => new Promise((resolve, reject) => {
            taskSignal = options.signal;
            if (options.signal.aborted) reject(options.signal.reason);
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        })
    });
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        const req = new SyntheticRequest({ prefer: 'respond-async' });
        const res = new SyntheticResponse((response) => {
            if (response.statusCode === 202) throw new Error('socket write exploded');
        });
        await assert.rejects(handlers.handleSliceBambu(req, res), /socket write exploded/);
        assert.equal(queue.getQueueStatus().activeJobs, 0, 'the task settled before the request failed');
        assert.equal(queue.getQueueStatus().queueLength, 0);
        assert.equal(taskSignal.reason.code, 'SLICE_JOB_CANCELLED');
        assert.equal(store.getStatus().retained, 0);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
    }
});

test('item 3: a store that throws on admission leaves no ownerless job and the POST is answered', async (t) => {
    const real = createAsyncSliceJobStore({ deadlineMs: 60_000, resultTtlMs: 60_000, maxJobs: 5, emitEvent: () => {} });
    const throwing = Object.freeze({ ...real, admit() { throw new Error('store exploded'); } });
    const broken = await createAsyncHarness(t, { asyncJobStore: throwing });
    const response = await broken.submit();
    assert.equal(response.status, 500);
    assert.deepEqual(response.json, { success: false, error: 'Queue processing failed.', errorCode: 'QUEUE_INTERNAL_ERROR' });
    assert.equal(broken.pipeline.state.runs.length, 0, 'the ownerless job never ran');
    await broken.assertDrained();
});

test('item 4: a throwing pre-validation answers exactly like the synchronous request', async (t) => {
    const harness = await createAsyncHarness(t, { validate: () => { throw new Error('validator exploded'); } });
    const synchronous = await harness.submit({ prefer: '' });
    const asynchronous = await harness.submit();
    assert.equal(synchronous.status, 500);
    assert.equal(asynchronous.status, synchronous.status);
    assert.equal(asynchronous.text, synchronous.text);
    assert.equal(harness.store.getStatus().retained, 0);
    await harness.assertDrained();
});

test('item 5: the deadline never overrides an answer the pipeline already captured', async (t) => {
    const clock = fakeClock();
    const store = createAsyncSliceJobStore({
        deadlineMs: 60_000, resultTtlMs: 60_000, maxJobs: 5, emitEvent: () => {},
        now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
    });
    const controller = new AbortController();
    const job = store.admit({ principal: 'slice:shared', requestId: 'r', controller, admission: null });
    store.markRunning(job);
    store.markCaptured(job);
    clock.advance(120_000);
    assert.equal(controller.signal.aborted, false);
    assert.equal(store.isLive(job), true);
    assert.equal(store.complete(job, OK), true);
    assert.equal(store.view(job).result_status, 200);

    const harness = await createAsyncHarness(t, { store: { deadlineMs: 300 } });
    harness.pipeline.state.releaseGate = deferred();
    const location = (await harness.submit()).headers.location;
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal((await harness.status(location)).json.status, 'running', 'artifact promotion outlived the deadline');
    harness.pipeline.state.releaseGate.resolve();
    const done = await harness.pollCompleted(location);
    assert.equal(done.json.result_status, 200);
    assert.equal(harness.pipeline.state.released, 1);
    await harness.assertDrained();
});

test('item 6: eviction takes the submitting principal\'s oldest result before another family\'s', () => {
    const clock = fakeClock();
    const store = createAsyncSliceJobStore({
        deadlineMs: 60_000, resultTtlMs: 600_000, maxJobs: 3, emitEvent: () => {},
        now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
    });
    const admit = (principal) => store.admit({ principal, requestId: 'r', controller: new AbortController(), admission: null });
    const shopOld = admit('slice:woocommerce');
    clock.advance(10);
    store.complete(shopOld, OK);
    const leadOld = admit('slice:leadpilot');
    clock.advance(10);
    store.complete(leadOld, OK);
    const leadLive = admit('slice:leadpilot');
    const leadNew = admit('slice:leadpilot');
    assert.ok(leadNew);
    assert.ok(store.lookup(shopOld.id, 'slice:woocommerce'), 'the shop result survives another family\'s submission');
    assert.equal(store.lookup(leadOld.id, 'slice:leadpilot'), null);
    // A family with no finished result of its own falls back to the oldest overall.
    store.complete(leadLive, OK);
    const other = admit('slice:shared');
    assert.ok(other);
    assert.equal(store.lookup(shopOld.id, 'slice:woocommerce'), null);
    assert.ok(store.lookup(leadLive.id, 'slice:leadpilot'));
});

test('item 7: the job poll limiter defaults to 1200 requests per 60 s', () => {
    assert.equal(DEFAULTS.SLICE_JOB_RATE_LIMIT_MAX_REQUESTS, 1_200);
    assert.equal(DEFAULTS.SLICE_JOB_RATE_LIMIT_WINDOW_MS, 60_000);
    assert.equal(DEFAULTS.SLICE_JOB_RATE_LIMIT_BURST_CAPACITY, 60);
});

test('item 8: every job-route answer is no-store and the status read never carries an ETag or becomes 304', async (t) => {
    let blocked = false;
    const limiter = createLimiterMiddleware({
        limiter: { allow: () => (blocked ? { allowed: false, retryAfterSeconds: 7 } : { allowed: true }) },
        resolveKey: () => 'job-route-test'
    });
    assert.ok(new TokenBucketRateLimiter({ windowMs: 60_000, maxRequests: 1, burstCapacity: 1 }).allow('k', 0).allowed);
    const harness = await createAsyncHarness(t, { jobRateLimiter: limiter });
    const location = (await harness.submit()).headers.location;
    const done = await harness.pollCompleted(location);
    assert.equal(done.headers.etag, undefined);
    assert.equal(done.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(done.headers['cache-control'], 'no-store');
    const revalidated = await harness.status(location, { 'if-none-match': '*' });
    assert.equal(revalidated.status, 200, 'never 304');
    assert.equal(revalidated.text, done.text);
    const unauthenticated = await harness.status(location, { 'x-test-principal': '' });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers['cache-control'], 'no-store');
    blocked = true;
    const limited = await send(harness.port, { path: location });
    blocked = false;
    assert.equal(limited.status, 429);
    assert.equal(limited.json.errorCode, 'RATE_LIMIT_EXCEEDED');
    assert.equal(limited.headers['cache-control'], 'no-store');
    assert.equal(limited.headers['retry-after'], '7');
    const deleted = await send(harness.port, { method: 'DELETE', path: '/bambu/slice/jobs/not-a-job' });
    assert.equal(deleted.headers['cache-control'], 'no-store');
    await harness.assertDrained();
});
