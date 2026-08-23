'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const {
    createProcessTreeTerminator,
    isSafeChildPid
} = require('../../../app/services/slice/process-tree');

function esrch() {
    return Object.assign(new Error('not found'), { code: 'ESRCH' });
}

function isAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

async function waitForExit(pid, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (isAlive(pid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return !isAlive(pid);
}

function killExact(pid) {
    if (!isAlive(pid)) return;
    try {
        process.kill(pid, 'SIGKILL');
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}

function readPidRecord(child) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => reject(new Error('inert process fixture did not report PIDs')), 3000);
        const cleanup = () => {
            clearTimeout(timer);
            child.stdout.removeListener('data', onData);
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
        };
        const onError = (error) => { cleanup(); reject(error); };
        const onExit = () => { cleanup(); reject(new Error('inert process fixture exited early')); };
        const onData = (chunk) => {
            buffer += chunk;
            const newline = buffer.indexOf('\n');
            if (newline < 0) return;
            cleanup();
            try {
                resolve(JSON.parse(buffer.slice(0, newline)));
            } catch (error) {
                reject(error);
            }
        };
        child.stdout.on('data', onData);
        child.once('error', onError);
        child.once('exit', onExit);
    });
}

function windowsFixture({ gracefulStops = false, gracefulFails = false, forceStops = true } = {}) {
    const pid = 8765;
    const graceMs = 15;
    let alive = true;
    let now = 0;
    let livenessChecks = 0;
    const calls = [];
    const delays = [];
    const terminator = createProcessTreeTerminator({ pid }, {
        platform: 'win32', ownPid: 999, graceMs, pollMs: 5,
        taskkillPath: 'C:\\Windows\\System32\\taskkill.exe',
        childEnvironment: { SystemRoot: 'C:\\Windows' },
        now: () => now,
        kill: (target, signal) => {
            assert.equal(target, pid);
            assert.equal(signal, 0);
            livenessChecks += 1;
            if (!alive) throw esrch();
        },
        execFile: (executable, args, options, callback) => {
            calls.push({ executable, args, options });
            if (args.includes('/F') && forceStops) alive = false;
            if (!args.includes('/F') && gracefulStops) alive = false;
            callback(!args.includes('/F') && gracefulFails ? new Error('graceful failed') : null);
        },
        setTimeout: (callback, delay) => {
            delays.push(delay);
            now += delay;
            queueMicrotask(callback);
            return { unref() {} };
        }
    });
    return { terminator, calls, delays, graceMs, checks: () => livenessChecks };
}

test('3 a POSIX tree that exits on TERM never receives KILL', async () => {
    const pid = 41001;
    let alive = true;
    const signals = [];
    let timers = 0;
    const kill = (target, signal) => {
        assert.equal(target, -pid);
        signals.push(signal);
        if (signal === 'SIGTERM') alive = false;
        if (signal === 0 && !alive) throw esrch();
    };
    const terminator = createProcessTreeTerminator({ pid }, {
        platform: 'linux', ownPid: 999, kill, now: () => 0,
        setTimeout: () => { timers += 1; }, graceMs: 25, pollMs: 5
    });

    await terminator.terminate();
    assert.deepEqual(signals, ['SIGTERM', 0]);
    assert.equal(timers, 0);
});

test('4 a TERM-ignoring POSIX group receives bounded KILL escalation', async () => {
    const pid = 41002;
    let alive = true;
    let now = 0;
    const signals = [];
    const delays = [];
    const kill = (target, signal) => {
        assert.equal(target, -pid);
        signals.push(signal);
        if (signal === 'SIGKILL') alive = false;
        if (signal === 0 && !alive) throw esrch();
    };
    const terminator = createProcessTreeTerminator({ pid }, {
        platform: 'linux', ownPid: 999, kill, now: () => now,
        graceMs: 20, pollMs: 5,
        setTimeout: (callback, delay) => {
            delays.push(delay);
            now += delay;
            queueMicrotask(callback);
            return { unref() {} };
        }
    });

    await terminator.terminate();
    assert.deepEqual(signals, ['SIGTERM', 0, 0, 0, 0, 0, 'SIGKILL', 0]);
    assert.deepEqual(delays, [5, 5, 5, 5]);
    assert.equal(alive, false);
});

test('5 an exact inert child and grandchild are both gone after tree settlement', async (t) => {
    const script = [
        "const { spawn } = require('node:child_process');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
        "    { stdio: 'ignore', windowsHide: true });",
        "process.stdout.write(JSON.stringify({ parent: process.pid, grandchild: child.pid }) + '\\n');",
        "setInterval(() => {}, 1000);"
    ].join('\n');
    const child = spawn(process.execPath, ['-e', script], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
    });
    const trackedPids = new Set([child.pid]);
    t.after(async () => {
        for (const pid of trackedPids) killExact(pid);
        await Promise.all([...trackedPids].map((pid) => waitForExit(pid, 1000)));
    });
    const record = await readPidRecord(child);
    assert.equal(record.parent, child.pid);
    assert.ok(isSafeChildPid(record.grandchild));
    trackedPids.add(record.grandchild);

    const liveOverrides = process.platform === 'win32' ? {
        platform: 'win32',
        ownPid: process.pid,
        graceMs: 250,
        taskkillPath: 'C:\\Windows\\System32\\taskkill.exe',
        childEnvironment: { SystemRoot: 'C:\\Windows' },
        execFile: (_executable, args, options, callback) => {
            assert.deepEqual(args, ['/PID', String(record.parent), '/T']);
            assert.equal(options.shell, false);
            killExact(record.grandchild);
            killExact(record.parent);
            callback(null);
        }
    } : { graceMs: 250, pollMs: 10 };
    await createProcessTreeTerminator(child, liveOverrides).terminate();
    assert.equal(await waitForExit(record.parent), true, `parent PID ${record.parent} survived`);
    assert.equal(await waitForExit(record.grandchild), true, `grandchild PID ${record.grandchild} survived`);
});

test('23 unsafe PIDs are inert and never reach a process signal seam', async () => {
    const unsafe = [undefined, 0, -1, 1.5, process.pid];
    let killCalls = 0;
    for (const pid of unsafe) {
        assert.equal(isSafeChildPid(pid), false);
        const terminator = createProcessTreeTerminator({ pid }, {
            platform: 'linux', ownPid: process.pid,
            kill: () => { killCalls += 1; }
        });
        await assert.rejects(terminator.terminate(), /unverified process tree/);
    }
    assert.equal(killCalls, 0);
});

test('Windows taskkill success is accepted only after exact root-PID settlement', async () => {
    const scenarios = [
        { name: 'graceful-live', options: {}, expectedCalls: 2, rejects: false },
        { name: 'graceful-dead', options: { gracefulStops: true }, expectedCalls: 1, rejects: false },
        { name: 'unproved-dead', options: { gracefulStops: true, gracefulFails: true }, expectedCalls: 1, rejects: true },
        { name: 'force-live', options: { forceStops: false }, expectedCalls: 2, rejects: true }
    ];
    for (const scenario of scenarios) {
        const f = windowsFixture(scenario.options);
        const first = f.terminator.terminate();
        assert.equal(f.terminator.terminate(), first, `${scenario.name}: idempotence`);
        if (scenario.rejects) {
            await assert.rejects(first, /did not settle|forced termination|identity was lost/i, scenario.name);
        } else {
            await first;
        }
        assert.equal(f.calls.length, scenario.expectedCalls, scenario.name);
        assert.deepEqual(f.calls[0].args, ['/PID', '8765', '/T'], scenario.name);
        if (scenario.expectedCalls === 2) {
            assert.deepEqual(f.calls[1].args, ['/PID', '8765', '/T', '/F'], scenario.name);
            assert.ok(f.delays.reduce((sum, delay) => sum + delay, 0) <= f.graceMs * 2, scenario.name);
        }
        assert.ok(f.checks() > 0, `${scenario.name}: root PID was never verified`);
        assert.ok(f.calls.every((call) => call.executable.endsWith('taskkill.exe')));
        assert.ok(f.calls.every((call) => call.options.shell === false));
    }
});
