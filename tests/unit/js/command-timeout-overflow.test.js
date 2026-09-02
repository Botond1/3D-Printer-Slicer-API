'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS } = require('../../../app/config/constants');
const {
    PYTHON_HELPER_TIMEOUT_MS,
    SLICE_COMMAND_TIMEOUT_RANGE_MS,
    createCommandRunner,
    createPythonHelperRunner,
    resolveCommandTimeoutMs
} = require('../../../app/services/slice/command');
const { EVENT_NAMES, createEventEmitter } = require('../../../app/services/observability/events');

const SLICE_DIR = path.resolve(__dirname, '../../../app/services/slice');
const COMMAND_PATH = path.join(SLICE_DIR, 'command.js');
const INPUT_PATH = path.join(SLICE_DIR, 'input-processing.js');

function fixture(overrides = {}) {
    const state = { executions: [], delays: [], terminations: 0 };
    const timers = new Map();
    let nextTimer = 1;
    const runner = createCommandRunner({
        execFile: (executable, args, options, callback) => {
            state.executions.push({ executable, args, options, callback });
            return { pid: 4321 };
        },
        timeoutMs: DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        platform: 'linux',
        createChildEnvironment: () => ({ PATH: '/bin' }),
        setTimeout: (callback, delay) => {
            const handle = { id: nextTimer++, unref() {} };
            state.delays.push(delay);
            timers.set(handle, callback);
            return handle;
        },
        clearTimeout: (handle) => { timers.delete(handle); },
        createProcessTreeTerminator: () => ({
            terminate: async () => { state.terminations += 1; }
        }),
        ...overrides
    });
    return { state, timers, runner, callback: (index = 0) => state.executions[index].callback };
}

function captureEvents(callback) {
    const lines = [];
    const original = { info: console.info, log: console.log, error: console.error };
    console.info = (line) => lines.push(String(line));
    console.log = (line) => lines.push(String(line));
    console.error = (line) => lines.push(String(line));
    return Promise.resolve()
        .then(callback)
        .finally(() => Object.assign(console, original))
        .then(() => lines.map((line) => JSON.parse(line)));
}

test('SLICE_COMMAND_TIMEOUT_MS is parsed as a bounded positive integer with a safe fallback', () => {
    assert.deepEqual(SLICE_COMMAND_TIMEOUT_RANGE_MS, { min: 1_000, max: 3_600_000 });
    assert.equal(resolveCommandTimeoutMs({}), DEFAULTS.SLICE_COMMAND_TIMEOUT_MS);
    assert.equal(resolveCommandTimeoutMs({ SLICE_COMMAND_TIMEOUT_MS: '120000' }), 120_000);
    assert.equal(resolveCommandTimeoutMs({ SLICE_COMMAND_TIMEOUT_MS: '1000' }), 1_000);
    assert.equal(resolveCommandTimeoutMs({ SLICE_COMMAND_TIMEOUT_MS: '3600000' }), 3_600_000);
    for (const garbage of ['0', '-1', '-600000', 'abc', '1.5', '1e5', '', ' 1000', '01000', '999', '3600001', 'NaN']) {
        assert.equal(
            resolveCommandTimeoutMs({ SLICE_COMMAND_TIMEOUT_MS: garbage }),
            DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
            `garbage ${JSON.stringify(garbage)} must fall back`
        );
    }
});

test('maxBuffer overflow keeps its own NATIVE_OUTPUT_OVERFLOW code instead of timeout wording', async () => {
    const f = fixture();
    const events = await captureEvents(async () => {
        const result = f.runner('native-tool', ['--verbose']);
        const overflow = Object.assign(new Error('stdout maxBuffer length exceeded'), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            killed: true
        });
        f.callback()(overflow, 'partial', '');
        await assert.rejects(result, (error) => {
            assert.equal(error.code, 'NATIVE_OUTPUT_OVERFLOW');
            assert.doesNotMatch(error.message, /timed out/i);
            assert.match(error.message, /more output than the bounded buffer/);
            assert.equal(error.stdout, 'partial');
            return true;
        });
    });
    const completed = events.find((entry) => entry.event === 'native.completed');
    assert.equal(completed.outcome, 'failure');
    assert.equal(completed.error_code, 'NATIVE_OUTPUT_OVERFLOW');
    assert.equal(f.state.terminations, 0);
});

test('a killed child whose termination was not the timeout keeps its original message', async () => {
    const f = fixture();
    await captureEvents(async () => {
        const result = f.runner('native-tool');
        const external = Object.assign(new Error('Command failed: native-tool'), { killed: true, signal: 'SIGKILL' });
        f.callback()(external, '', 'oom');
        await assert.rejects(result, (error) => {
            assert.equal(error.message, 'Command failed: native-tool');
            assert.notEqual(error.code, 'ETIMEDOUT');
            return true;
        });
    });
});

test('the timeout path still reports the timeout wording with ETIMEDOUT', async () => {
    const f = fixture({ timeoutMs: 120_000 });
    await captureEvents(async () => {
        const result = f.runner('native-tool');
        [...f.timers.values()][0]();
        f.callback()(Object.assign(new Error('terminated'), { killed: true }), '', '');
        await assert.rejects(result, (error) => {
            assert.equal(error.code, 'ETIMEDOUT');
            assert.equal(error.message, 'The slicing process timed out after 2 minutes.');
            return true;
        });
    });
    assert.equal(f.state.terminations, 1);
});

test('Python helpers receive the shorter 120 s budget and can never extend the native budget', async () => {
    assert.equal(PYTHON_HELPER_TIMEOUT_MS, 120_000);
    assert.ok(PYTHON_HELPER_TIMEOUT_MS < DEFAULTS.SLICE_COMMAND_TIMEOUT_MS);

    const f = fixture();
    await captureEvents(async () => {
        const helper = f.runner('python', ['orient.py'], { timeoutMs: PYTHON_HELPER_TIMEOUT_MS });
        const native = f.runner('prusa-slicer', ['--export-gcode']);
        const extended = f.runner('python', ['scale_model.py'], { timeoutMs: DEFAULTS.SLICE_COMMAND_TIMEOUT_MS * 10 });
        const garbage = f.runner('python', ['mesh2stl.py'], { timeoutMs: -5 });
        for (let index = 0; index < 4; index += 1) f.callback(index)(null, 'ok', '');
        await Promise.all([helper, native, extended, garbage]);
    });
    assert.deepEqual(f.state.delays, [
        PYTHON_HELPER_TIMEOUT_MS,
        DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        DEFAULTS.SLICE_COMMAND_TIMEOUT_MS
    ]);

    const delays = [];
    const helperRunner = createPythonHelperRunner({
        execFile: (_executable, _args, _options, callback) => { queueMicrotask(() => callback(null, '', '')); return { pid: 99 }; },
        timeoutMs: 999_999_999,
        platform: 'linux',
        createChildEnvironment: () => ({}),
        setTimeout: (callback, delay) => { delays.push(delay); return { unref() {} }; },
        clearTimeout: () => {}
    });
    await captureEvents(() => helperRunner('python', ['cad2stl.py']));
    assert.deepEqual(delays, [PYTHON_HELPER_TIMEOUT_MS]);
});

test('helper invocations in input processing and transform pass the bounded helper budget', async () => {
    const source = await fsp.readFile(INPUT_PATH, 'utf8');
    const helperCalls = source.match(/resolvePythonHelper\('(?:mesh2stl|cad2stl|orient)\.py'\)[\s\S]*?\{ signal, \.\.\.HELPER_COMMAND_OPTIONS \}/g) || [];
    assert.equal(helperCalls.length, 3, 'every Python helper call in input-processing carries the helper budget');
    const transformSource = await fsp.readFile(path.join(SLICE_DIR, 'transform.js'), 'utf8');
    assert.match(transformSource, /scale_model\.py'\)[\s\S]*?timeoutMs: PYTHON_HELPER_TIMEOUT_MS/);
});

function installCommandMock(runCommand) {
    const previous = require.cache[COMMAND_PATH];
    const previousInput = require.cache[INPUT_PATH];
    require.cache[COMMAND_PATH] = {
        id: COMMAND_PATH, filename: COMMAND_PATH, loaded: true,
        exports: {
            runCommand,
            PYTHON_HELPER_TIMEOUT_MS,
            throwIfAborted(signal) { if (signal?.aborted) throw signal.reason; },
            isAbortError(error, signal) { return Boolean(signal?.aborted || error?.name === 'AbortError'); }
        }
    };
    delete require.cache[INPUT_PATH];
    return () => {
        if (previous) require.cache[COMMAND_PATH] = previous; else delete require.cache[COMMAND_PATH];
        if (previousInput) require.cache[INPUT_PATH] = previousInput; else delete require.cache[INPUT_PATH];
    };
}

test('orientation helper failures keep the honest fallback and emit one bounded orientation.fallback event', async (t) => {
    assert.ok(EVENT_NAMES.includes('orientation.fallback'));
    const originalPython = process.env.PYTHON_EXECUTABLE;
    process.env.PYTHON_EXECUTABLE = process.execPath;
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'orientation-fallback-'));
    const restore = installCommandMock(async (_executable, args, options) => {
        assert.equal(options.timeoutMs, PYTHON_HELPER_TIMEOUT_MS);
        assert.ok(args[0].endsWith('orient.py'));
        const failure = Object.assign(new Error('The slicing process timed out after 2 minutes.'), {
            code: 'ETIMEDOUT', name: 'TimeoutError', killed: true
        });
        throw failure;
    });
    t.after(async () => {
        restore();
        if (originalPython === undefined) delete process.env.PYTHON_EXECUTABLE;
        else process.env.PYTHON_EXECUTABLE = originalPython;
        await fsp.rm(root, { recursive: true, force: true });
    });
    const { classifyOrientationFailure, tryOptimizeOrientation } = require(INPUT_PATH);
    const workspace = { assertContainedPath: (candidate) => candidate };
    const input = path.join(root, 'model.stl');
    await fsp.writeFile(input, 'solid t\nendsolid t\n');

    const emitted = [];
    const writer = (entry) => emitted.push(entry);
    const emitEvent = createEventEmitter({ writer, readContext: () => ({}) });

    const preserve = await tryOptimizeOrientation(input, 'FDM', 'preserve', workspace, undefined, { emitEvent });
    assert.equal(preserve.processableFile, input);
    assert.equal(preserve.orientation.outcome, 'preserved');
    const auto = await tryOptimizeOrientation(input, 'SLA', 'auto', workspace, undefined, { emitEvent });
    assert.equal(auto.processableFile, input);
    assert.equal(auto.orientation.outcome, 'fallback_unmodified');

    assert.equal(emitted.length, 2);
    assert.deepEqual(emitted.map((entry) => [entry.event, entry.outcome, entry.error_code, entry.extra]), [
        ['orientation.fallback', 'preserved', 'ORIENTATION_HELPER_TIMEOUT', { reason: 'preserve', technology: 'FDM' }],
        ['orientation.fallback', 'fallback_unmodified', 'ORIENTATION_HELPER_TIMEOUT', { reason: 'auto', technology: 'SLA' }]
    ]);
    assert.doesNotMatch(JSON.stringify(emitted), /model\.stl|orientation-fallback-/);

    assert.equal(classifyOrientationFailure(null), 'ORIENTATION_OUTPUT_MISSING');
    assert.equal(classifyOrientationFailure({ code: 'NATIVE_OUTPUT_OVERFLOW' }), 'ORIENTATION_HELPER_OUTPUT_OVERFLOW');
    assert.equal(classifyOrientationFailure(new Error('Orientation metadata file is unsafe or oversized.')), 'ORIENTATION_METADATA_INVALID');
    assert.equal(classifyOrientationFailure(new Error('exit 1')), 'ORIENTATION_HELPER_FAILED');
});
