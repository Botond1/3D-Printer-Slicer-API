'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandRunner } = require('../../../app/services/slice/command');

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

class TrackingSignal extends EventTarget {
    constructor() {
        super();
        this.aborted = false;
        this.reason = undefined;
        this.listenerCount = 0;
    }

    addEventListener(type, listener, options) {
        if (type === 'abort') this.listenerCount += 1;
        super.addEventListener(type, listener, options);
    }

    removeEventListener(type, listener, options) {
        if (type === 'abort' && this.listenerCount > 0) this.listenerCount -= 1;
        super.removeEventListener(type, listener, options);
    }

    abort(reason) {
        if (this.aborted) return;
        this.aborted = true;
        this.reason = reason;
        this.dispatchEvent(new Event('abort'));
    }
}

function fixture(overrides = {}) {
    const state = { executions: [], terminations: 0, clears: 0 };
    const timers = new Map();
    let nextTimer = 1;
    const child = { pid: 43210 };
    const execute = (executable, args, options, callback) => {
        state.executions.push({ executable, args, options, callback });
        return child;
    };
    const runner = createCommandRunner({
        execFile: execute,
        timeoutMs: 50,
        platform: 'linux',
        createChildEnvironment: () => ({ PATH: '/bin' }),
        setTimeout: (callback) => {
            const handle = { id: nextTimer++, unref() {} };
            timers.set(handle, callback);
            return handle;
        },
        clearTimeout: (handle) => {
            state.clears += 1;
            timers.delete(handle);
        },
        createProcessTreeTerminator: () => ({
            terminate: async () => { state.terminations += 1; }
        }),
        ...overrides
    });
    return {
        state,
        timers,
        runner,
        callback: (index = 0) => state.executions[index].callback,
        fireTimer: () => [...timers.values()][0]?.()
    };
}

test('1 pre-aborted signals reject before execFile, timers, or termination', async () => {
    const signal = new TrackingSignal();
    const reason = new Error('already cancelled');
    signal.abort(reason);
    const f = fixture();

    await assert.rejects(f.runner('native-tool', ['--safe'], { signal }), (error) => error === reason);
    assert.equal(f.state.executions.length, 0);
    assert.equal(f.state.terminations, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(signal.listenerCount, 0);
});

test('2 active abort starts the one injected process-tree terminator', async () => {
    const signal = new TrackingSignal();
    const reason = new Error('client disconnected');
    const f = fixture();
    const result = f.runner('native-tool', [], { signal });

    signal.abort(reason);
    f.callback()(Object.assign(new Error('terminated'), { killed: true }), '', '');
    await assert.rejects(result, (error) => error === reason);
    assert.equal(f.state.terminations, 1);
    assert.equal(signal.listenerCount, 0);
    assert.equal(f.timers.size, 0);
});

test('6 timeout and abort share the exact process-tree termination seam', async () => {
    const f = fixture();
    const result = f.runner('native-tool');

    f.fireTimer();
    f.callback()(Object.assign(new Error('terminated'), { killed: true }), '', '');
    await assert.rejects(result, (error) => error.code === 'ETIMEDOUT');
    assert.equal(f.state.terminations, 1);
    assert.equal(f.timers.size, 0);
});

test('7 abort, timeout, and callback races settle exactly once', async () => {
    const signal = new TrackingSignal();
    const gate = deferred();
    const f = fixture({
        createProcessTreeTerminator: () => ({
            terminate: () => {
                f.state.terminations += 1;
                return gate.promise;
            }
        })
    });
    let settlements = 0;
    const result = f.runner('native-tool', [], { signal }).then(
        () => { settlements += 1; },
        (error) => { settlements += 1; throw error; }
    );
    const reason = new Error('race abort');

    signal.abort(reason);
    f.fireTimer();
    f.callback()(null, 'late success', '');
    signal.abort(new Error('duplicate abort'));
    gate.resolve();
    await assert.rejects(result, (error) => error === reason);
    await flush();
    assert.equal(settlements, 1);
    assert.equal(f.state.terminations, 1);
});

test('8 timer and abort listener are removed on success, error, and abort', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        for (const outcome of ['success', 'error', 'abort']) {
            const signal = new TrackingSignal();
            const f = fixture();
            const result = f.runner('native-tool', [], { signal });
            if (outcome === 'success') f.callback()(null, 'ok', '');
            if (outcome === 'error') f.callback()(new Error('failed'), '', 'bounded');
            if (outcome === 'abort') {
                signal.abort(new Error('cancelled'));
                f.callback()(new Error('terminated'), '', '');
            }
            if (outcome === 'success') await result;
            else await assert.rejects(result);
            assert.equal(signal.listenerCount, 0, outcome);
            assert.equal(f.timers.size, 0, outcome);
            assert.equal(f.state.clears, 1, outcome);
        }
    } finally {
        console.error = originalError;
    }
});

test('8 termination failure quarantines the slot without retaining timer or abort listener', async () => {
    const signal = new TrackingSignal();
    const f = fixture({
        createProcessTreeTerminator: () => ({
            terminate: async () => { f.state.terminations += 1; throw new Error('unverified tree'); }
        })
    });
    const originalError = console.error;
    console.error = () => {};
    try {
        const result = f.runner('native-tool', [], { signal });
        signal.abort(new Error('cancelled'));
        f.callback()(new Error('native callback'), '', '');
        const outcome = await Promise.race([result.then(() => 'settled', () => 'settled'), flush().then(() => 'pending')]);
        assert.equal(outcome, 'pending');
        assert.equal(signal.listenerCount, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.state.terminations, 1);
    } finally {
        console.error = originalError;
    }
});

test('9 late abort cannot target a settled command PID', async () => {
    const signal = new TrackingSignal();
    const f = fixture();
    const result = f.runner('native-tool', [], { signal });

    f.callback()(null, 'done', '');
    assert.deepEqual(await result, { stdout: 'done', stderr: '' });
    signal.abort(new Error('too late'));
    await flush();
    assert.equal(f.state.terminations, 0);
    assert.equal(signal.listenerCount, 0);
});

test('failed commands preserve bounded stdout beside an unrelated stderr warning', async () => {
    const f = fixture();
    const result = f.runner('native-tool');
    const error = new Error('native failure');
    f.callback()(error, 'placement diagnostic on stdout', 'unrelated warning');

    await assert.rejects(result, (observed) => {
        assert.equal(observed, error);
        assert.equal(observed.stdout, 'placement diagnostic on stdout');
        assert.equal(observed.stderr, 'unrelated warning');
        return true;
    });
});

test('22 native telemetry stays bounded and never includes command output', async () => {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalError = console.error;
    const lines = [];
    console.log = (line) => lines.push(String(line));
    console.info = (line) => lines.push(String(line));
    console.error = (line) => lines.push(String(line));
    try {
        const quiet = fixture({ debug: false });
        const quietResult = quiet.runner('native-tool');
        quiet.callback()(null, 'secret output', 'secret error');
        await quietResult;
        assert.equal(lines.length, 2);
        assert.deepEqual(lines.map((line) => JSON.parse(line).event),
            ['native.started', 'native.completed']);
        assert.doesNotMatch(lines.join('\n'), /secret output|secret error/);

        lines.length = 0;
        const debug = fixture({ debug: true });
        const debugResult = debug.runner('native-tool');
        debug.callback()(null, 'x'.repeat(200_000), 'y'.repeat(200_000));
        await debugResult;
        assert.equal(lines.length, 2);
        assert.ok(lines.every((line) => line.length < 20_000));
        assert.doesNotMatch(lines.join('\n'), /x{16}|y{16}|truncated/);
        assert.equal(debug.state.executions[0].options.maxBuffer, 10_240_000);
        assert.equal(debug.state.executions[0].options.shell, false);
    } finally {
        console.log = originalLog;
        console.info = originalInfo;
        console.error = originalError;
    }
});
