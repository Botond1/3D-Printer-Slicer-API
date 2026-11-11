'use strict';

/**
 * T-OOM (3.9.0 §4.6). Every slice child runs as `choom -n <CHILD_OOM_SCORE_ADJ>
 * -- <file> <args…>` so a cgroup OOM kills the largest child and never Node,
 * which holds every job. The budget is still chosen from the ORIGINAL argv
 * (orient.py 60 s, other helpers 300 s, native 600 s), with and without the
 * wrapper. The wrapper turns itself off (one `runtime.limits_unavailable`)
 * when `choom` is missing, the platform is not Linux, or the startup
 * self-test does not print the configured score; 0 means no wrapper.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The live budgets: helpers 300 s by env, orient.py and native at their defaults.
const saved = {};
for (const key of ['PYTHON_HELPER_TIMEOUT_MS', 'ORIENTATION_HELPER_TIMEOUT_MS', 'SLICE_COMMAND_TIMEOUT_MS',
    'PYTHON_EXECUTABLE', 'CHILD_OOM_SCORE_ADJ']) {
    saved[key] = process.env[key];
}
process.env.PYTHON_HELPER_TIMEOUT_MS = '300000';
delete process.env.ORIENTATION_HELPER_TIMEOUT_MS;
delete process.env.SLICE_COMMAND_TIMEOUT_MS;
delete process.env.CHILD_OOM_SCORE_ADJ;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

const command = require('../../../app/services/slice/command');
const {
    CHILD_OOM_SCORE_ADJ,
    OOM_WRAPPER_REASONS,
    ORIENTATION_HELPER_PATH,
    createCommandRunner,
    createOomWrapper,
    findExecutableOnPath,
    getChildOomWrapperStatus,
    verifyChildOomWrapper,
    wrapCommand
} = command;
const { wrapperExecFailure } = require('../../../app/services/slice/spawn-file');
const { resolvePythonHelper } = require('../../../app/services/slice/helper-paths');

const CHOOM = '/usr/bin/choom';
const ACTIVE = Object.freeze({ active: true, scoreAdj: 500, choomPath: CHOOM, reason: null });

function recordingEvents() {
    const events = [];
    return { events, emitEvent: (name, data) => { events.push({ name, data }); return true; } };
}

/** A runner with fake spawn, timers and terminator; `oomWrapper` as given. */
function fixture(oomWrapper, budgets = {}) {
    const state = { executions: [], timers: [] };
    const runner = createCommandRunner({
        execFile: (file, args, options, callback) => {
            state.executions.push({ file, args: [...args], options, callback });
            return { pid: 4321 };
        },
        platform: 'linux',
        telemetry: 'none',
        createChildEnvironment: () => ({ PATH: '/usr/bin:/bin' }),
        setTimeout: (callback, delay) => {
            const handle = { callback, delay, unref() {} };
            state.timers.push(handle);
            return handle;
        },
        clearTimeout: () => {},
        createProcessTreeTerminator: () => ({ async terminate() {} }),
        oomWrapper,
        ...budgets
    });
    return { state, runner };
}

test('the configured score defaults to 500 from the release policy', () => {
    assert.equal(CHILD_OOM_SCORE_ADJ, 500);
    assert.deepEqual([...OOM_WRAPPER_REASONS], [
        'disabled', 'unsupported_platform', 'choom_missing',
        'self_test_failed', 'self_test_mismatch', 'self_test_timeout'
    ]);
});

test('T-OOM: argv per stage with and without the wrapper; the budget comes from the original argv', async (t) => {
    const python = process.execPath;
    const stages = [
        {
            name: 'orient.py',
            args: [ORIENTATION_HELPER_PATH, 'in.stl', 'out.stl'],
            helper: true,
            expectedMs: 60_000
        },
        {
            name: 'other helper (mesh2stl.py)',
            args: [resolvePythonHelper('mesh2stl.py'), 'in.obj', 'out.stl'],
            helper: true,
            expectedMs: 300_000
        },
        {
            name: 'native slice',
            file: '/opt/bambu/bambu-studio',
            args: ['--slice', '0', 'model.3mf'],
            helper: false,
            expectedMs: 600_000
        }
    ];
    for (const wrapped of [false, true]) {
        for (const stage of stages) {
            await t.test(`${stage.name} ${wrapped ? 'under choom' : 'without the wrapper'}`, async () => {
                const budgets = stage.helper ? { timeoutMs: command.PYTHON_HELPER_TIMEOUT_MS } : {};
                const { state, runner } = fixture(wrapped ? { resolve: () => ACTIVE } : null, budgets);
                const file = stage.file || python;
                const running = runner(file, stage.args);
                assert.equal(state.executions.length, 1, 'a decided wrapper spawns synchronously');
                const [execution] = state.executions;
                if (wrapped) {
                    assert.equal(execution.file, CHOOM);
                    assert.deepEqual(execution.args, ['-n', '500', '--', file, ...stage.args]);
                    assert.deepEqual(execution.options.wrapped, { file, args: stage.args });
                } else {
                    assert.equal(execution.file, file);
                    assert.deepEqual(execution.args, stage.args);
                    assert.equal('wrapped' in execution.options, false, 'unwrapped spawn options are unchanged');
                }
                assert.equal(execution.options.detached, true);
                assert.equal(execution.options.shell, false);
                assert.equal(state.timers[0].delay, stage.expectedMs);
                execution.callback(null, 'ok', '');
                assert.deepEqual(await running, { stdout: 'ok', stderr: '' });
            });
        }
    }
});

test('a wrapper still deciding delays only the spawn, then wraps it', async () => {
    let release;
    const verdict = new Promise((resolve) => { release = resolve; });
    const { state, runner } = fixture({ resolve: () => verdict });
    const running = runner('/opt/native', ['a']);
    assert.equal(state.executions.length, 0);
    release(ACTIVE);
    await verdict;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.executions.length, 1);
    assert.deepEqual(state.executions[0].args, ['-n', '500', '--', '/opt/native', 'a']);
    state.executions[0].callback(null, '', '');
    await running;
});

test('an abort while the wrapper decides rejects without spawning', async () => {
    let release;
    const verdict = new Promise((resolve) => { release = resolve; });
    const { state, runner } = fixture({ resolve: () => verdict });
    const controller = new AbortController();
    const running = runner('/opt/native', [], { signal: controller.signal });
    controller.abort();
    release(ACTIVE);
    await assert.rejects(running, (error) => error.name === 'AbortError');
    assert.equal(state.executions.length, 0);
});

test('an injected spawn seam is never wrapped unless the test asks for it', () => {
    const state = { executions: [] };
    const runner = createCommandRunner({
        execFile: (file, args, options) => { state.executions.push({ file, args, options }); return { pid: 1 }; },
        platform: 'linux',
        telemetry: 'none',
        createChildEnvironment: () => ({}),
        setTimeout: () => ({ unref() {} }),
        clearTimeout: () => {},
        createProcessTreeTerminator: () => ({ async terminate() {} })
    });
    runner('/opt/native', ['x']).catch(() => {});
    assert.equal(state.executions[0].file, '/opt/native');
    assert.deepEqual(state.executions[0].args, ['x']);
});

test('wrapCommand leaves an inactive verdict alone', () => {
    assert.deepEqual(wrapCommand(null, '/a', ['b']), { file: '/a', args: ['b'], wrapped: null });
    assert.deepEqual(wrapCommand({ active: false, reason: 'choom_missing' }, '/a', ['b']),
        { file: '/a', args: ['b'], wrapped: null });
});

test('CHILD_OOM_SCORE_ADJ=0 means no wrapper and no event', () => {
    const { events, emitEvent } = recordingEvents();
    const wrapper = createOomWrapper({ scoreAdj: 0, platform: 'linux', locate: () => CHOOM, emitEvent });
    const verdict = wrapper.resolve();
    assert.equal(verdict.active, false);
    assert.equal(verdict.reason, 'disabled');
    assert.equal(wrapper.status().state, 'disabled');
    assert.deepEqual(events, []);
});

test('a non-Linux host keeps the wrapper off without an event', () => {
    const { events, emitEvent } = recordingEvents();
    const wrapper = createOomWrapper({ scoreAdj: 500, platform: 'win32', locate: () => CHOOM, emitEvent });
    assert.equal(wrapper.resolve().reason, 'unsupported_platform');
    assert.deepEqual(events, []);
});

test('wrapper off when choom is missing: one runtime.limits_unavailable, synchronous verdict', () => {
    const { events, emitEvent } = recordingEvents();
    let spawned = 0;
    const wrapper = createOomWrapper({
        scoreAdj: 500, platform: 'linux', locate: () => null, emitEvent,
        execute: () => { spawned += 1; return {}; }
    });
    const verdict = wrapper.resolve();
    assert.equal(typeof verdict.then, 'undefined', 'decided without a child');
    assert.equal(verdict.active, false);
    assert.equal(verdict.reason, 'choom_missing');
    assert.equal(spawned, 0);
    assert.deepEqual(wrapper.status(), { state: 'off', active: false, oom_score_adj: 500, reason: 'choom_missing' });
    assert.equal(wrapper.resolve(), verdict, 'decided once');
    assert.deepEqual(events, [{
        name: 'runtime.limits_unavailable',
        data: { outcome: 'wrapper_off', extra: { reason: 'choom_missing', limit: 500 } }
    }]);
    // A missing choom then runs every command unwrapped.
    const { state, runner } = fixture(wrapper);
    runner('/opt/native', ['x']).catch(() => {});
    assert.equal(state.executions[0].file, '/opt/native');
});

test('the self-test runs choom once with the configured score and activates on an exact read-back', async () => {
    const { events, emitEvent } = recordingEvents();
    const spawns = [];
    const wrapper = createOomWrapper({
        scoreAdj: 700,
        platform: 'linux',
        locate: () => CHOOM,
        emitEvent,
        createChildEnvironment: () => ({ PATH: '/usr/bin' }),
        execute: (file, args, options, callback) => {
            spawns.push({ file, args, options });
            setImmediate(() => callback(null, '700\n', ''));
            return { kill() {} };
        }
    });
    assert.equal(wrapper.status().state, 'pending');
    const first = wrapper.resolve();
    const second = wrapper.resolve();
    assert.equal(first, second, 'one shared self-test');
    const verdict = await first;
    assert.deepEqual({ ...verdict }, { active: true, scoreAdj: 700, choomPath: CHOOM, reason: null });
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].file, CHOOM);
    assert.deepEqual(spawns[0].args, ['-n', '700', '--', '/bin/sh', '-c', 'cat /proc/self/oom_score_adj']);
    assert.equal(spawns[0].options.shell, false);
    assert.equal(wrapper.resolve(), verdict, 'synchronous after the self-test');
    assert.equal(wrapper.status().state, 'active');
    assert.deepEqual(events, []);
});

for (const [name, behaviour, reason] of [
    ['a different read-back', (callback) => callback(null, '0\n', ''), 'self_test_mismatch'],
    ['a failing choom', (callback) => callback(Object.assign(new Error('Command failed'), { code: 1 }), '', ''),
        'self_test_failed'],
    ['a spawn that throws', () => { throw new Error('EAGAIN'); }, 'self_test_failed']
]) {
    test(`the wrapper stays off after ${name}`, async () => {
        const { events, emitEvent } = recordingEvents();
        const wrapper = createOomWrapper({
            scoreAdj: 500, platform: 'linux', locate: () => CHOOM, emitEvent,
            execute: (file, args, options, callback) => {
                behaviour(callback);
                return { kill() {} };
            }
        });
        const verdict = await wrapper.resolve();
        assert.equal(verdict.active, false);
        assert.equal(verdict.reason, reason);
        assert.deepEqual(events.map((event) => [event.name, event.data.extra]),
            [['runtime.limits_unavailable', { reason, limit: 500 }]]);
    });
}

test('a hung self-test is killed and leaves the wrapper off', async () => {
    const { events, emitEvent } = recordingEvents();
    const kills = [];
    const wrapper = createOomWrapper({
        scoreAdj: 500, platform: 'linux', locate: () => CHOOM, emitEvent, selfTestTimeoutMs: 10,
        execute: () => ({ kill: (signal) => kills.push(signal) })
    });
    const verdict = await wrapper.resolve();
    assert.equal(verdict.reason, 'self_test_timeout');
    assert.deepEqual(kills, ['SIGKILL']);
    assert.equal(events.length, 1);
});

test('the process-wide wrapper reports a closed verdict for readiness', async () => {
    const verdict = await verifyChildOomWrapper();
    const status = getChildOomWrapperStatus();
    assert.equal(status.active, verdict.active);
    assert.equal(status.oom_score_adj, CHILD_OOM_SCORE_ADJ);
    assert.ok(status.reason === null || OOM_WRAPPER_REASONS.includes(status.reason));
    if (process.platform !== 'linux') assert.equal(status.reason, 'unsupported_platform');
});

test('findExecutableOnPath finds an executable regular file and skips everything else', (t) => {
    if (process.platform === 'win32') {
        t.skip('POSIX PATH semantics only');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'choom-path-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const empty = path.join(root, 'empty');
    const plain = path.join(root, 'plain');
    const good = path.join(root, 'good');
    for (const directory of [empty, plain, good]) fs.mkdirSync(directory);
    fs.writeFileSync(path.join(plain, 'choom'), '', { mode: 0o644 });
    fs.mkdirSync(path.join(empty, 'choom'));
    fs.writeFileSync(path.join(good, 'choom'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(findExecutableOnPath('choom', `relative:${empty}:${plain}:${good}`), path.join(good, 'choom'));
    assert.equal(findExecutableOnPath('choom', `${empty}:${plain}`), null);
});

test('a failed exec under choom reads as the spawn error Node would give', () => {
    const wrapped = { file: '/nope/native', args: ['-x'] };
    const missing = wrapperExecFailure(wrapped, 127, null,
        'choom: failed to execute /nope/native: No such file or directory\n');
    assert.equal(missing.code, 'ENOENT');
    assert.equal(missing.message, 'spawn /nope/native ENOENT');
    assert.equal(missing.syscall, 'spawn /nope/native');
    assert.equal(missing.path, '/nope/native');
    assert.deepEqual(missing.spawnargs, ['-x']);
    const denied = wrapperExecFailure(wrapped, 126, null, 'choom: failed to execute /nope/native: Permission denied');
    assert.equal(denied.code, 'EACCES');
    // The program's own 127/126 and every signal stay the program's.
    assert.equal(wrapperExecFailure(wrapped, 127, null, 'sh: 1: foo: not found\n'), null);
    assert.equal(wrapperExecFailure(wrapped, 1, null, 'choom: failed to execute x'), null);
    assert.equal(wrapperExecFailure(wrapped, null, 'SIGKILL', 'choom: failed to execute x'), null);
});
