'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    QUARANTINE_DRAIN_MS,
    createRuntimeLifecycle
} = require('../../../app/services/runtime-lifecycle');
const {
    QUARANTINE_EXIT_CODE,
    quarantineNativeRuntime,
    resetNativeRuntimeStatusForTests
} = require('../../../app/services/slice/native-runtime-status');

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

class SyntheticProcess extends EventEmitter {
    constructor() {
        super();
        this.exitCalls = [];
    }

    exit(code) {
        this.exitCalls.push(code);
    }
}

class ControlledServer {
    constructor() { this.closeCalls = 0; }

    close(callback) { this.closeCalls += 1; callback(); }

    closeIdleConnections() {}
}

function timerSeam() {
    const timers = new Map();
    let next = 1;
    return {
        timers,
        setTimeout(callback, delay) {
            const handle = { id: next++, delay, unref() {} };
            timers.set(handle, callback);
            return handle;
        },
        clearTimeout(handle) { timers.delete(handle); },
        fire() {
            const [handle, callback] = [...timers.entries()][0];
            timers.delete(handle);
            callback();
        }
    };
}

function lifecycleFixture({ queueGate = deferred() } = {}) {
    const processRef = new SyntheticProcess();
    const seam = timerSeam();
    const exits = [];
    const events = [];
    let subscriber;
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown() { events.push('queue-shutdown'); return queueGate.promise; },
        onShutdownStart() { events.push('admission-closed'); },
        onQuarantine() { events.push('quarantine'); },
        subscribeToRuntimeQuarantine(callback) { subscriber = callback; return () => { events.push('unsubscribed'); }; },
        exit(code, reason) { exits.push({ code, reason }); },
        setTimeout: seam.setTimeout,
        clearTimeout: seam.clearTimeout
    });
    return { lifecycle, processRef, seam, exits, events, queueGate, quarantine: () => subscriber() };
}

test('quarantine closes admission, drains for a bounded window, then exits 70 through the seam', async () => {
    assert.equal(QUARANTINE_EXIT_CODE, 70);
    assert.equal(QUARANTINE_DRAIN_MS, 10_000);
    assert.ok(QUARANTINE_DRAIN_MS < 30_000, 'drain must complete before the container stop grace');

    const f = lifecycleFixture();
    const server = new ControlledServer();
    await f.lifecycle.run(async () => server);
    assert.equal(f.lifecycle.getQuarantineExit(), null);

    f.quarantine();
    await flush();
    assert.deepEqual(f.events, ['quarantine', 'admission-closed', 'queue-shutdown']);
    assert.equal(f.lifecycle.isShuttingDown(), true);
    assert.equal(server.closeCalls, 1);
    assert.deepEqual(f.exits, [], 'the exit waits for the bounded drain');
    assert.equal(f.seam.timers.size, 1);
    assert.equal([...f.seam.timers.keys()][0].delay, QUARANTINE_DRAIN_MS);

    f.seam.fire();
    assert.deepEqual(f.exits, [{ code: 70, reason: 'drain_timeout' }]);
    assert.deepEqual(f.lifecycle.getQuarantineExit(), { code: 70, reason: 'drain_timeout' });

    // A late drain completion after the exit decision never exits twice.
    f.queueGate.resolve();
    await flush();
    assert.equal(f.exits.length, 1);
    assert.equal(f.processRef.exitCalls.length, 0, 'the injected seam replaces process.exit');
});

test('a drain that completes inside the window exits 70 immediately and clears the timer', async () => {
    const f = lifecycleFixture();
    await f.lifecycle.run(async () => new ControlledServer());
    f.quarantine();
    f.quarantine();
    f.queueGate.resolve();
    await flush();
    assert.deepEqual(f.exits, [{ code: 70, reason: 'drained' }]);
    assert.equal(f.seam.timers.size, 0);
    assert.equal(f.events.filter((event) => event === 'quarantine').length, 1);
    assert.ok(f.events.includes('unsubscribed'));
});

test('the default subscription binds the real native-runtime quarantine and the default exit uses the process seam', async () => {
    resetNativeRuntimeStatusForTests();
    const processRef = new SyntheticProcess();
    const seam = timerSeam();
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown: () => new Promise(() => {}),
        setTimeout: seam.setTimeout,
        clearTimeout: seam.clearTimeout
    });
    try {
        await lifecycle.run(async () => new ControlledServer());
        quarantineNativeRuntime();
        await flush();
        assert.equal(lifecycle.isShuttingDown(), true);
        assert.deepEqual(processRef.exitCalls, []);
        seam.fire();
        assert.deepEqual(processRef.exitCalls, [70]);
    } finally {
        lifecycle.removeSignalListeners();
        resetNativeRuntimeStatusForTests();
    }
});

test('quarantine drain windows cannot be extended past the bounded default', async () => {
    const processRef = new SyntheticProcess();
    const seam = timerSeam();
    const exits = [];
    let subscriber;
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown: () => new Promise(() => {}),
        subscribeToRuntimeQuarantine(callback) { subscriber = callback; return () => {}; },
        exit(code, reason) { exits.push({ code, reason }); },
        quarantineDrainMs: 60_000,
        setTimeout: seam.setTimeout,
        clearTimeout: seam.clearTimeout
    });
    await lifecycle.run(async () => new ControlledServer());
    lifecycle.shutdown();
    assert.equal(seam.timers.size, 0, 'a signal shutdown arms no quarantine timer');
    subscriber();
    await flush();
    assert.equal(seam.timers.size, 1);
    assert.equal([...seam.timers.keys()][0].delay, QUARANTINE_DRAIN_MS, 'requested 60 s is clamped to the bounded default');
    seam.fire();
    assert.deepEqual(exits, [{ code: 70, reason: 'drain_timeout' }]);
});
