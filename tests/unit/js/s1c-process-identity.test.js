'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProcessTreeTerminator } = require('../../../app/services/slice/process-tree');

test('9 an exited child whose POSIX group is still alive terminates the group instead of refusing', async () => {
    // A PID is only reused after its whole process group is gone, so a live
    // group id still names the child's own orphaned descendants. Signals go to
    // the group (-pid), never to the bare PID that could have been reused.
    const pid = 48761;
    const signals = [];
    let alive = true;
    let now = 0;
    const child = { pid, exitCode: 0, signalCode: null };
    const terminator = createProcessTreeTerminator(child, {
        platform: 'linux',
        ownPid: process.pid,
        graceMs: 20,
        killSettleMs: 40,
        pollMs: 5,
        now: () => now,
        setTimeout: (callback, delay) => { now += delay; queueMicrotask(callback); return { unref() {} }; },
        kill: (target, signal) => {
            assert.equal(target, -pid, 'only the process group is ever targeted');
            signals.push(signal);
            if (signal === 'SIGKILL') alive = false;
            if (signal === 0 && !alive) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        }
    });

    await terminator.terminate();
    assert.deepEqual(signals.filter((signal) => signal !== 0), ['SIGTERM', 'SIGKILL']);
    assert.equal(alive, false);
});

test('9 an exited child with a gone POSIX group settles without a termination signal', async () => {
    const pid = 48762;
    const signals = [];
    const notFound = Object.assign(new Error('gone'), { code: 'ESRCH' });
    const terminator = createProcessTreeTerminator({ pid, exitCode: 0, signalCode: null }, {
        platform: 'linux', ownPid: process.pid,
        kill: (...args) => { signals.push(args); throw notFound; }
    });

    await terminator.terminate();
    assert.deepEqual(signals, [[-pid, 0]]);
});

test('9 an exited Windows root quarantines its unverifiable descendant tree', async () => {
    let taskkillCalls = 0;
    const terminator = createProcessTreeTerminator({ pid: 48763, exitCode: 0, signalCode: null }, {
        platform: 'win32', ownPid: process.pid,
        childEnvironment: { SystemRoot: 'C:\\Windows' },
        taskkillPath: 'C:\\Windows\\System32\\taskkill.exe',
        execFile: () => { taskkillCalls += 1; }
    });

    await assert.rejects(terminator.terminate(), /identity was lost/);
    assert.equal(taskkillCalls, 0);
});
