'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createSliceQueue,
    SliceQueueTimeoutError
} = require('../../../app/services/slice/queue');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function outcome(promise) {
    return promise.then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason })
    );
}

function fakeRuntime() {
    let now = 0;
    let nextId = 1;
    let unrefCalls = 0;
    const timers = new Map();

    function setTimeout(callback, delay) {
        const handle = {
            id: nextId++,
            unref() { unrefCalls += 1; }
        };
        timers.set(handle, { callback, dueAt: now + delay });
        return handle;
    }

    function clearTimeout(handle) {
        timers.delete(handle);
    }

    function advance(milliseconds) {
        now += milliseconds;
        while (true) {
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.dueAt <= now)
                .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0].id - right[0].id);
            if (due.length === 0) return;
            const [handle, timer] = due[0];
            timers.delete(handle);
            timer.callback();
        }
    }

    return {
        now: () => now,
        setTimeout,
        clearTimeout,
        advance,
        timerCount: () => timers.size,
        unrefCalls: () => unrefCalls
    };
}

function queueFixture(overrides = {}) {
    const runtime = fakeRuntime();
    const queue = createSliceQueue({
        maxConcurrent: 1,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 50,
        now: runtime.now,
        setTimeout: runtime.setTimeout,
        clearTimeout: runtime.clearTimeout,
        ...overrides
    });
    return { queue, runtime };
}

async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

test('a queued deadline rejects while the active worker remains blocked', async () => {
    const { queue, runtime } = queueFixture();
    const activeGate = deferred();
    const active = outcome(queue.enqueueSliceJob(() => activeGate.promise, { queueKey: 'active' }));
    let waitingRuns = 0;
    const waiting = outcome(queue.enqueueSliceJob(() => {
        waitingRuns += 1;
        return Promise.resolve('unexpected');
    }, { queueKey: 'waiting' }));

    runtime.advance(50);
    await flush();
    const timedOut = await waiting;

    assert.equal(timedOut.status, 'rejected');
    assert.ok(timedOut.reason instanceof SliceQueueTimeoutError);
    assert.equal(waitingRuns, 0);
    assert.deepEqual(queue.getQueueStatus(), {
        queueLength: 0, activeJobs: 1, maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10
    });
    assert.equal(runtime.timerCount(), 0);
    assert.ok(runtime.unrefCalls() >= 1);

    activeGate.resolve('active-result');
    assert.deepEqual(await active, { status: 'fulfilled', value: 'active-result' });
    await flush();
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('aborting a middle queued job preserves survivor FIFO and exact counters', async () => {
    const { queue, runtime } = queueFixture({ maxWaitMs: 500 });
    const activeGate = deferred();
    const starts = [];
    const controller = new AbortController();
    const active = queue.enqueueSliceJob(async () => {
        starts.push('active');
        await activeGate.promise;
        return 'active';
    }, { queueKey: 'a' });
    const first = queue.enqueueSliceJob(async () => { starts.push('first'); return 'first'; }, { queueKey: 'b' });
    const middle = outcome(queue.enqueueSliceJob(async () => {
        starts.push('middle');
        return 'middle';
    }, { queueKey: 'c', signal: controller.signal }));
    const last = queue.enqueueSliceJob(async () => { starts.push('last'); return 'last'; }, { queueKey: 'd' });

    const abortReason = new Error('synthetic queued abort');
    controller.abort(abortReason);
    assert.deepEqual(queue.getQueueStatus(), {
        queueLength: 2, activeJobs: 1, maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10
    });
    assert.deepEqual(await middle, { status: 'rejected', reason: abortReason });
    activeGate.resolve();
    assert.deepEqual(await Promise.all([active, first, last]), ['active', 'first', 'last']);
    await flush();
    assert.deepEqual(starts, ['active', 'first', 'last']);
    assert.equal(runtime.timerCount(), 0);
});

test('timeout/dequeue races produce exactly one terminal outcome', async (t) => {
    await t.test('timeout wins before dequeue', async () => {
        const { queue, runtime } = queueFixture();
        const gate = deferred();
        const active = queue.enqueueSliceJob(() => gate.promise, { queueKey: 'a' });
        let runs = 0;
        const waiting = outcome(queue.enqueueSliceJob(async () => { runs += 1; }, { queueKey: 'b' }));
        runtime.advance(50);
        gate.resolve();
        await active;
        assert.equal((await waiting).reason.errorCode, 'SLICE_QUEUE_TIMEOUT');
        assert.equal(runs, 0);
    });

    await t.test('dequeue wins before the stale timer callback', async () => {
        const { queue, runtime } = queueFixture();
        const gate = deferred();
        const active = queue.enqueueSliceJob(() => gate.promise, { queueKey: 'a' });
        let runs = 0;
        const waiting = queue.enqueueSliceJob(async () => { runs += 1; return 'ran'; }, { queueKey: 'b' });
        gate.resolve();
        await active;
        await flush();
        runtime.advance(50);
        assert.equal(await waiting, 'ran');
        assert.equal(runs, 1);
        assert.equal(runtime.timerCount(), 0);
    });
});

test('active abort reaches the task but retains its slot until actual task settlement', async () => {
    const { queue } = queueFixture({ maxWaitMs: 500 });
    const controller = new AbortController();
    const activeGate = deferred();
    let observedSignal;
    let replacementRuns = 0;
    const active = outcome(queue.enqueueSliceJob(async (signal) => {
        observedSignal = signal;
        await activeGate.promise;
        return 'ignored-success';
    }, { queueKey: 'same', signal: controller.signal }));
    const replacement = queue.enqueueSliceJob(async () => {
        replacementRuns += 1;
        return 'replacement';
    }, { queueKey: 'other' });

    const abortReason = new Error('active aborted');
    controller.abort(abortReason);
    await flush();
    assert.equal(observedSignal.aborted, true);
    assert.equal(replacementRuns, 0);
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    activeGate.resolve();
    assert.deepEqual(await active, { status: 'rejected', reason: abortReason });
    assert.equal(await replacement, 'replacement');
    await flush();
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('a pre-aborted signal creates no timer, listener-owned work, or counter state', async () => {
    const { queue, runtime } = queueFixture();
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);
    let runs = 0;
    const result = await outcome(queue.enqueueSliceJob(async () => { runs += 1; }, {
        queueKey: 'client', signal: controller.signal
    }));

    assert.deepEqual(result, { status: 'rejected', reason });
    assert.equal(runs, 0);
    assert.equal(runtime.timerCount(), 0);
    assert.equal(runtime.unrefCalls(), 0);
    assert.equal(queue.getQueueStatus().queueLength, 0);
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('late abort cannot overwrite an already settled success', async () => {
    const { queue, runtime } = queueFixture();
    const controller = new AbortController();
    const job = queue.enqueueSliceJob(async () => 'success', {
        queueKey: 'client', signal: controller.signal
    });
    assert.equal(await job, 'success');
    await flush();
    controller.abort(new Error('too late'));
    assert.equal(queue.getQueueStatus().activeJobs, 0);
    assert.equal(runtime.timerCount(), 0);
});
