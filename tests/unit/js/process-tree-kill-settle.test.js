'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_GRACE_MS,
    DEFAULT_KILL_SETTLE_MS,
    createProcessTreeTerminator
} = require('../../../app/services/slice/process-tree');

function esrch() {
    return Object.assign(new Error('not found'), { code: 'ESRCH' });
}

function posixFixture({ pid = 51001, child = { pid }, graceMs = 20, killSettleMs, dieOn = 'SIGKILL', killsToDie = 1 } = {}) {
    let alive = true;
    let now = 0;
    let kills = 0;
    const signals = [];
    const delays = [];
    const kill = (target, signal) => {
        assert.equal(target, -pid);
        signals.push(signal);
        if (signal === dieOn) {
            kills += 1;
            if (kills >= killsToDie) alive = false;
        }
        if (signal === 0 && !alive) throw esrch();
    };
    const terminator = createProcessTreeTerminator(child, {
        platform: 'linux', ownPid: 999, kill, now: () => now,
        graceMs, pollMs: 5, killSettleMs,
        setTimeout: (callback, delay) => {
            delays.push(delay);
            now += delay;
            queueMicrotask(callback);
            return { unref() {} };
        }
    });
    return { terminator, signals, delays, isAlive: () => alive, elapsed: () => now };
}

test('post-SIGKILL settle polls far longer than the SIGTERM grace and stays below the stop grace', () => {
    assert.equal(DEFAULT_GRACE_MS, 1_000);
    assert.equal(DEFAULT_KILL_SETTLE_MS, 10_000);
    assert.ok(DEFAULT_KILL_SETTLE_MS > DEFAULT_GRACE_MS);
    assert.ok(DEFAULT_KILL_SETTLE_MS * 2 < 30_000, 'two kill passes still fit inside the container stop grace');
});

test('a group that survives the first SIGKILL is re-killed once and then settles', async () => {
    const f = posixFixture({ graceMs: 20, killSettleMs: 40, killsToDie: 2 });
    await f.terminator.terminate();
    assert.equal(f.isAlive(), false);
    assert.deepEqual(f.signals.filter((signal) => signal !== 0), ['SIGTERM', 'SIGKILL', 'SIGKILL']);
    // SIGTERM grace (20 ms) + first kill settle window (40 ms) elapsed before the retry.
    assert.equal(f.elapsed(), 60);
});

test('a group that ignores both forced passes rejects only after two full settle windows', async () => {
    const f = posixFixture({ graceMs: 20, killSettleMs: 40, dieOn: 'never' });
    await assert.rejects(f.terminator.terminate(), /did not settle after forced termination/);
    assert.deepEqual(f.signals.filter((signal) => signal !== 0), ['SIGTERM', 'SIGKILL', 'SIGKILL']);
    assert.equal(f.elapsed(), 20 + 40 + 40);
});

test('the default kill settle is at least the grace and never shorter than ten seconds', async () => {
    const f = posixFixture({ graceMs: 20, dieOn: 'never' });
    await assert.rejects(f.terminator.terminate(), /did not settle/);
    assert.equal(f.elapsed(), 20 + DEFAULT_KILL_SETTLE_MS * 2);
});

test('an exited direct child with a live process group terminates the group instead of refusing', async () => {
    const pid = 51002;
    const f = posixFixture({ pid, child: { pid, exitCode: 0, signalCode: null }, graceMs: 20, killSettleMs: 40 });
    await f.terminator.terminate();
    assert.equal(f.isAlive(), false);
    assert.deepEqual(f.signals.filter((signal) => signal !== 0), ['SIGTERM', 'SIGKILL']);
});

test('an exited direct child whose group is already gone resolves without signals', async () => {
    const pid = 51003;
    const signals = [];
    const terminator = createProcessTreeTerminator({ pid, exitCode: 1, signalCode: null }, {
        platform: 'linux', ownPid: 999, now: () => 0,
        kill: (target, signal) => { signals.push(signal); if (signal === 0) throw esrch(); },
        setTimeout: () => { throw new Error('no timers expected'); }
    });
    await terminator.terminate();
    assert.deepEqual(signals, [0]);
});
