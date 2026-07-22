'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProcessTreeTerminator } = require('../../../app/services/slice/process-tree');

test('9 an exited child identity cannot target a later process that reused its PID', async () => {
    const reusedPid = 48761;
    const signals = [];
    const child = { pid: reusedPid, exitCode: 0, signalCode: null };
    const terminator = createProcessTreeTerminator(child, {
        platform: 'linux',
        ownPid: process.pid,
        kill: (...args) => { signals.push(args); }
    });

    await assert.rejects(terminator.terminate(), /identity was lost/);
    assert.deepEqual(signals, [[-reusedPid, 0]]);
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
