'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
    DEFAULTS,
    MAX_CONCURRENT_SLICES_RANGE
} = require('../../../app/config/constants');
const {
    RESOURCE_DEFINITIONS,
    resolveResourcePolicy
} = require('../../../app/config/resource-policy');
const {
    createSliceQueue,
    getQueueStatus,
    SliceQueueShutdownError
} = require('../../../app/services/slice/queue');
const { createReadinessService } = require('../../../app/services/readiness.service');
const {
    quarantineNativeRuntime,
    resetNativeRuntimeStatusForTests,
    subscribeToNativeRuntimeQuarantine
} = require('../../../app/services/slice/native-runtime-status');

const ROOT = path.resolve(__dirname, '../../..');
const QUEUE_MODULE = path.join(ROOT, 'app/services/slice/queue.js');

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

test('MAX_CONCURRENT_SLICES is canonical startup policy with default 1 and inclusive range 1..3', () => {
    assert.deepEqual(MAX_CONCURRENT_SLICES_RANGE, { min: 1, max: 3 });
    assert.equal(DEFAULTS.MAX_CONCURRENT_SLICES, 1);
    assert.deepEqual(RESOURCE_DEFINITIONS.MAX_CONCURRENT_SLICES, {
        default: 1, min: 1, max: 3
    });
    assert.equal(resolveResourcePolicy({}).MAX_CONCURRENT_SLICES, 1);
    for (const value of [1, 2, 3]) {
        assert.equal(resolveResourcePolicy({ MAX_CONCURRENT_SLICES: String(value) })
            .MAX_CONCURRENT_SLICES, value);
    }
    for (const value of ['', '0', '-1', '4', '1.0', '1e0', '+1', '01', ' 1', '9007199254740992']) {
        assert.throws(
            () => resolveResourcePolicy({ MAX_CONCURRENT_SLICES: value }),
            /MAX_CONCURRENT_SLICES/
        );
    }
});

test('queue module preserves valid 1..3 environment values and bounds malformed pre-start state to 1', () => {
    const script = `const queue = require(${JSON.stringify(QUEUE_MODULE)});`
        + 'process.stdout.write(String(queue.getQueueStatus().maxConcurrent));';
    function observed(value) {
        const child = spawnSync(process.execPath, ['-e', script], {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, MAX_CONCURRENT_SLICES: value }
        });
        assert.equal(child.status, 0, child.stderr);
        return Number(child.stdout);
    }
    for (const value of ['1', '2', '3']) assert.equal(observed(value), Number(value));
    for (const value of ['', '0', '4', '3junk', '1.5', '01', '9007199254740992']) {
        assert.equal(observed(value), 1);
    }
});

test('queue factory rejects concurrency outside 1..3 and runs at most three tasks', async () => {
    for (const invalid of [0, 4, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
        const status = createSliceQueue({ maxConcurrent: invalid }).getQueueStatus();
        assert.ok(status.maxConcurrent >= 1 && status.maxConcurrent <= 3);
        assert.notEqual(status.maxConcurrent, invalid);
    }

    const queue = createSliceQueue({
        maxConcurrent: 3,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 60_000
    });
    const gates = Array.from({ length: 4 }, deferred);
    let active = 0;
    let peak = 0;
    const starts = [];
    const jobs = gates.map((gate, index) => queue.enqueueSliceJob(async () => {
        active += 1;
        peak = Math.max(peak, active);
        starts.push(index);
        await gate.promise;
        active -= 1;
        return index;
    }, { queueKey: `client-${index}` }));

    await flush();
    assert.deepEqual(queue.getQueueStatus(), {
        queueLength: 1,
        activeJobs: 3,
        maxConcurrent: 3,
        maxQueueLength: 10,
        maxQueuePerClient: 10
    });
    assert.deepEqual(starts, [0, 1, 2]);

    gates[0].resolve();
    assert.equal(await jobs[0], 0);
    await flush();
    assert.deepEqual(starts, [0, 1, 2, 3]);
    assert.equal(peak, 3);
    for (const gate of gates.slice(1)) gate.resolve();
    assert.deepEqual(await Promise.all(jobs.slice(1)), [1, 2, 3]);
    await flush();
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('runtime quarantine closes admission, rejects queued work, and retains the active slot until settlement', async () => {
    let available = true;
    let notifyQuarantine;
    const queue = createSliceQueue({
        maxConcurrent: 1,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 60_000,
        isRuntimeAvailable: () => available,
        subscribeToRuntimeQuarantine(subscriber) {
            notifyQuarantine = subscriber;
        }
    });
    const activeGate = deferred();
    let activeSignal;
    let queuedRuns = 0;
    const active = outcome(queue.enqueueSliceJob(async (signal) => {
        activeSignal = signal;
        await activeGate.promise;
        return 'must-not-succeed-after-quarantine';
    }, { queueKey: 'active' }));
    const queued = outcome(queue.enqueueSliceJob(async () => {
        queuedRuns += 1;
        return 'must-not-run';
    }, { queueKey: 'queued' }));
    await flush();

    available = false;
    notifyQuarantine();
    assert.equal(activeSignal.aborted, true);
    assert.equal(queue.getQueueStatus().acceptingJobs, false);
    assert.equal(queue.getQueueStatus().queueLength, 0);
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    const queuedResult = await queued;
    assert.equal(queuedResult.status, 'rejected');
    assert.ok(queuedResult.reason instanceof SliceQueueShutdownError);
    assert.equal(queuedResult.reason.errorCode, 'SLICE_QUEUE_SHUTDOWN');
    assert.equal(queuedRuns, 0);

    const later = await outcome(queue.enqueueSliceJob(async () => 'must-not-run', {
        queueKey: 'later'
    }));
    assert.equal(later.status, 'rejected');
    assert.ok(later.reason instanceof SliceQueueShutdownError);
    assert.equal(queue.getQueueStatus().activeJobs, 1);

    activeGate.resolve();
    const activeResult = await active;
    assert.equal(activeResult.status, 'rejected');
    assert.ok(activeResult.reason instanceof SliceQueueShutdownError);
    await queue.beginSliceQueueShutdown();
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('runtime availability polling fails closed even when no quarantine notification is delivered', async () => {
    let runs = 0;
    const queue = createSliceQueue({
        maxConcurrent: 1,
        isRuntimeAvailable: () => false
    });
    const result = await outcome(queue.enqueueSliceJob(async () => {
        runs += 1;
    }));
    assert.equal(result.status, 'rejected');
    assert.ok(result.reason instanceof SliceQueueShutdownError);
    assert.equal(runs, 0);
    assert.equal(queue.getQueueStatus().acceptingJobs, false);
});

test('queue releases its quarantine subscription only after active settlement', async () => {
    const gate = deferred();
    let unsubscribeCalls = 0;
    const queue = createSliceQueue({
        maxConcurrent: 1,
        subscribeToRuntimeQuarantine() {
            return () => { unsubscribeCalls += 1; };
        }
    });
    const active = outcome(queue.enqueueSliceJob(async () => {
        await gate.promise;
        return 'settled';
    }));
    await flush();

    const shutdown = queue.beginSliceQueueShutdown();
    assert.equal(unsubscribeCalls, 0);
    gate.resolve();
    const result = await active;
    assert.equal(result.status, 'rejected');
    await shutdown;
    assert.equal(unsubscribeCalls, 1);
    await queue.beginSliceQueueShutdown();
    assert.equal(unsubscribeCalls, 1);
});

test('already-quarantined synchronous subscription return is released exactly once', async () => {
    let unsubscribeCalls = 0;
    const queue = createSliceQueue({
        subscribeToRuntimeQuarantine(subscriber) {
            subscriber();
            return () => { unsubscribeCalls += 1; };
        }
    });
    await queue.beginSliceQueueShutdown();
    assert.equal(unsubscribeCalls, 1);
    assert.equal(queue.getQueueStatus().acceptingJobs, false);
});

test('reentrant quarantine cannot admit work or report stale acceptance', async () => {
    let notifyQuarantine;
    let triggerDuringProbe = false;
    let runs = 0;
    const queue = createSliceQueue({
        maxConcurrent: 1,
        isRuntimeAvailable() {
            if (triggerDuringProbe) {
                triggerDuringProbe = false;
                notifyQuarantine();
            }
            return true;
        },
        subscribeToRuntimeQuarantine(subscriber) {
            notifyQuarantine = subscriber;
        }
    });

    triggerDuringProbe = true;
    const result = await outcome(queue.enqueueSliceJob(async () => {
        runs += 1;
    }));
    assert.equal(result.status, 'rejected');
    assert.ok(result.reason instanceof SliceQueueShutdownError);
    assert.equal(runs, 0);
    assert.equal(queue.getQueueStatus().queueLength, 0);
    assert.equal(queue.getQueueStatus().activeJobs, 0);

    let statusNotification;
    const statusQueue = createSliceQueue({
        isRuntimeAvailable() {
            statusNotification();
            return true;
        },
        subscribeToRuntimeQuarantine(subscriber) {
            statusNotification = subscriber;
        }
    });
    assert.equal(statusQueue.getQueueStatus().acceptingJobs, false);
    await statusQueue.beginSliceQueueShutdown();
});

test('native runtime quarantine subscribers are synchronous, idempotent, and removable', () => {
    resetNativeRuntimeStatusForTests();
    let calls = 0;
    const unsubscribe = subscribeToNativeRuntimeQuarantine(() => { calls += 1; });
    quarantineNativeRuntime();
    quarantineNativeRuntime();
    assert.equal(calls, 1);
    assert.equal(getQueueStatus().acceptingJobs, false);
    assert.equal(unsubscribe(), true);
    resetNativeRuntimeStatusForTests();
    quarantineNativeRuntime();
    assert.equal(calls, 1);
    resetNativeRuntimeStatusForTests();
});

function readinessFor(queue) {
    return createReadinessService({
        clock: () => 0,
        getQueueStatus: () => queue,
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        probes: {
            storage: () => true,
            retention: () => true,
            pricing: () => true,
            config: () => true
        }
    }).getFreshStatus();
}

test('readiness requires maxConcurrent 1..3 and activeJobs not above the configured maximum', () => {
    const healthy = {
        queueLength: 0,
        activeJobs: 3,
        maxConcurrent: 3,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        acceptingJobs: true
    };
    assert.equal(readinessFor(healthy).ready, true);
    for (const queue of [
        { ...healthy, maxConcurrent: 0, activeJobs: 0 },
        { ...healthy, maxConcurrent: 4 },
        { ...healthy, maxConcurrent: 3, activeJobs: 4 },
        { ...healthy, maxConcurrent: 3, activeJobs: -1 }
    ]) {
        const status = readinessFor(queue);
        assert.equal(status.ready, false);
        assert.deepEqual(status.reasonCodes, ['QUEUE_UNAVAILABLE']);
    }
});
