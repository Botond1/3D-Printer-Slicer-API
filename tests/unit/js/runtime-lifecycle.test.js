'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    createRuntimeLifecycle
} = require('../../../app/services/runtime-lifecycle');
const {
    createSliceQueue,
    SliceQueueShutdownError
} = require('../../../app/services/slice/queue');

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

class SyntheticProcess extends EventEmitter {
    constructor() {
        super();
        this.exitCode = undefined;
    }
}

class ControlledServer {
    constructor(events, closeGate = null) {
        this.events = events;
        this.closeGate = closeGate;
        this.closeCalls = 0;
        this.closeIdleCalls = 0;
    }

    close(callback) {
        this.closeCalls += 1;
        this.events.push('http-close');
        if (this.closeGate) this.closeGate.promise.then(() => callback());
        else callback();
    }

    closeIdleConnections() {
        this.closeIdleCalls += 1;
    }
}

test('SIGTERM and SIGINT share graceful queue-first shutdown semantics', async (t) => {
    for (const signal of ['SIGTERM', 'SIGINT']) {
        await t.test(signal, async () => {
            const events = [];
            const processRef = new SyntheticProcess();
            const queueGate = deferred();
            const closeGate = deferred();
            const server = new ControlledServer(events, closeGate);
            const lifecycle = createRuntimeLifecycle({
                processRef,
                beginQueueShutdown() {
                    events.push('queue-shutdown');
                    return queueGate.promise;
                }
            });
            await lifecycle.run(async () => server);

            processRef.emit(signal);
            const shutdown = lifecycle.shutdown();
            assert.deepEqual(events, ['queue-shutdown', 'http-close']);
            await flush();
            assert.deepEqual(events, ['queue-shutdown', 'http-close']);
            assert.equal(server.closeCalls, 1);
            assert.equal(server.closeIdleCalls, 1);

            queueGate.resolve();
            closeGate.resolve();
            await shutdown;
            assert.equal(processRef.listenerCount('SIGTERM'), 0);
            assert.equal(processRef.listenerCount('SIGINT'), 0);
            assert.equal(processRef.exitCode, undefined);
        });
    }
});

test('repeated and mixed signals keep abort, close, and cleanup single-flight', async () => {
    const processRef = new SyntheticProcess();
    const queueGate = deferred();
    const closeGate = deferred();
    const server = new ControlledServer([], closeGate);
    let queueShutdownCalls = 0;
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown() {
            queueShutdownCalls += 1;
            return queueGate.promise;
        }
    });
    await lifecycle.run(async () => server);

    processRef.emit('SIGTERM');
    const first = lifecycle.shutdown();
    processRef.emit('SIGINT');
    processRef.emit('SIGTERM');
    const repeated = lifecycle.shutdown();
    await flush();

    assert.equal(first, repeated);
    assert.equal(queueShutdownCalls, 1);
    assert.equal(server.closeCalls, 1);
    queueGate.resolve();
    closeGate.resolve();
    await first;
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
    assert.equal(processRef.listenerCount('SIGINT'), 0);
});

test('shutdown awaits both queue drain and HTTP close regardless of settlement order', async () => {
    const processRef = new SyntheticProcess();
    const queueGate = deferred();
    const closeGate = deferred();
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown: () => queueGate.promise
    });
    await lifecycle.run(async () => new ControlledServer([], closeGate));

    let settled = false;
    const shutdown = lifecycle.shutdown().then(() => { settled = true; });
    closeGate.resolve();
    await flush();
    assert.equal(settled, false);
    queueGate.resolve();
    await shutdown;
    assert.equal(settled, true);
});

test('signal during startup rejects admission immediately and closes a late server', async () => {
    const processRef = new SyntheticProcess();
    const startupGate = deferred();
    const queueGate = deferred();
    const server = new ControlledServer([]);
    let accepting = true;
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown() {
            accepting = false;
            return queueGate.promise;
        }
    });
    const startup = lifecycle.run(async () => {
        await startupGate.promise;
        return server;
    });

    processRef.emit('SIGTERM');
    assert.equal(accepting, false);
    assert.equal(lifecycle.isShuttingDown(), true);
    startupGate.resolve();
    await startup;
    await flush();
    assert.equal(server.closeCalls, 1);
    queueGate.resolve();
    await lifecycle.shutdown();
});

test('queue-owned abort drains queued work but retains active slot until late settlement', async () => {
    const processRef = new SyntheticProcess();
    const activeGate = deferred();
    const timerHandles = new Set();
    let nextTimer = 0;
    const queue = createSliceQueue({
        maxConcurrent: 1,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 60_000,
        setTimeout() {
            const handle = { id: ++nextTimer, unref() {} };
            timerHandles.add(handle);
            return handle;
        },
        clearTimeout(handle) { timerHandles.delete(handle); }
    });
    let activeSignal;
    let queuedRuns = 0;
    const active = outcome(queue.enqueueSliceJob(async (signal) => {
        activeSignal = signal;
        await activeGate.promise;
        return 'late-success';
    }, { queueKey: 'active' }));
    const queued = outcome(queue.enqueueSliceJob(async () => {
        queuedRuns += 1;
    }, { queueKey: 'queued' }));
    await flush();

    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown: queue.beginSliceQueueShutdown
    });
    await lifecycle.run(async () => new ControlledServer([]));
    processRef.emit('SIGINT');
    const shutdown = lifecycle.shutdown();
    const queuedResult = await queued;
    const admission = await outcome(queue.enqueueSliceJob(async () => {}, { queueKey: 'new' }));

    assert.equal(activeSignal.aborted, true);
    assert.ok(queuedResult.reason instanceof SliceQueueShutdownError);
    assert.ok(admission.reason instanceof SliceQueueShutdownError);
    assert.equal(queuedRuns, 0);
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    assert.equal(queue.getQueueStatus().queueLength, 0);
    assert.equal(timerHandles.size, 0);

    activeGate.resolve();
    const activeResult = await active;
    assert.ok(activeResult.reason instanceof SliceQueueShutdownError);
    await shutdown;
    assert.equal(queue.getQueueStatus().activeJobs, 0);
    assert.equal(timerHandles.size, 0);
});

test('startup failure performs queue cleanup and removes signal listeners once', async () => {
    const processRef = new SyntheticProcess();
    const startupError = new Error('audit failed');
    let cleanupCalls = 0;
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown() {
            cleanupCalls += 1;
            return Promise.resolve();
        }
    });

    await assert.rejects(lifecycle.run(async () => { throw startupError; }), startupError);
    assert.equal(cleanupCalls, 1);
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
    assert.equal(processRef.listenerCount('SIGINT'), 0);
    assert.equal(lifecycle.isShuttingDown(), true);
});
