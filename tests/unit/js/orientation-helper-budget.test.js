'use strict';

/**
 * `orient.py` has its own budget (3.8.3). Live on 3.8.2 the stable-pose
 * heuristic that follows a refused Bambu reference pose looped without end on
 * eight jobs and held a slice slot for the whole 300 s Python helper budget,
 * while every heuristic run that finished took at most 27 s. The orientation
 * budget (`ORIENTATION_HELPER_TIMEOUT_MS`, default 60 s, never above the helper
 * budget) ends such a run with the outcome it always had: the job continues
 * unrotated (`fallback_unmodified`). Every other helper, the Bambu
 * reference-pose export and every native slice keep their own budgets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PATH = path.join(ROOT, 'app/services/slice/command.js');
const INPUT_PATH = path.join(ROOT, 'app/services/slice/input-processing.js');
const PYTHON_PATH = path.join(ROOT, 'app/config/python.js');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const { DEFAULTS } = require('../../../app/config/constants');
const command = require(COMMAND_PATH);
const {
    ORIENTATION_HELPER_PATH,
    ORIENTATION_HELPER_TIMEOUT_MS,
    PYTHON_HELPER_TIMEOUT_MIN_MS,
    PYTHON_HELPER_TIMEOUT_MS,
    createCommandRunner,
    createPythonHelperRunner,
    isOrientationHelperCommand,
    resolveOrientationHelperTimeoutMs,
    resolvePythonHelperTimeoutMs
} = command;
const { resolvePythonHelper } = require('../../../app/services/slice/helper-paths');
const { resolveSlicerExecutable } = require('../../../app/services/slice/engine');

const LIVE_HELPER_BUDGET_MS = 300_000;
const ORIENTATION_BUDGET_MS = 45_000;

/** A runner whose spawn, timers and tree terminator are all fakes. */
function fixture(overrides = {}) {
    const state = { executions: [], timers: [], terminations: 0 };
    const runner = createCommandRunner({
        execFile: (executable, args, options, callback) => {
            state.executions.push({ executable, args: [...args], callback });
            return { pid: 4321 };
        },
        timeoutMs: DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        orientationTimeoutMs: ORIENTATION_BUDGET_MS,
        platform: 'linux',
        telemetry: 'none',
        createChildEnvironment: () => ({ PATH: '/bin' }),
        setTimeout: (callback, delay) => {
            const handle = { callback, delay, unref() {} };
            state.timers.push(handle);
            return handle;
        },
        clearTimeout: () => {},
        createProcessTreeTerminator: () => ({
            async terminate() { state.terminations += 1; }
        }),
        ...overrides
    });
    return { state, runner };
}

function helperArgs(name, ...rest) {
    return [resolvePythonHelper(name), ...rest];
}

test('ORIENTATION_HELPER_TIMEOUT_MS is bounded 10 s..PYTHON_HELPER_TIMEOUT_MS with an invalid-to-default fallback', () => {
    assert.equal(DEFAULTS.ORIENTATION_HELPER_TIMEOUT_MS, 60_000);
    assert.equal(resolveOrientationHelperTimeoutMs({}), 60_000);
    // The live helper budget (300 s since 2026-10-12) leaves the orientation default at 60 s.
    const live = { PYTHON_HELPER_TIMEOUT_MS: String(LIVE_HELPER_BUDGET_MS) };
    assert.equal(resolveOrientationHelperTimeoutMs(live), 60_000);
    assert.equal(resolveOrientationHelperTimeoutMs({ ...live, ORIENTATION_HELPER_TIMEOUT_MS: '45000' }), 45_000);
    assert.equal(resolveOrientationHelperTimeoutMs({ ...live, ORIENTATION_HELPER_TIMEOUT_MS: '10000' }), 10_000);
    // Equal to the helper budget restores the 3.8.2 behaviour.
    assert.equal(resolveOrientationHelperTimeoutMs({ ...live, ORIENTATION_HELPER_TIMEOUT_MS: '300000' }), 300_000);
    for (const garbage of ['9999', '0', '-1', '300001', '1e5', '60000.0', ' 60000', '060000', 'abc', '', 'Infinity', 'NaN']) {
        assert.equal(resolveOrientationHelperTimeoutMs({ ...live, ORIENTATION_HELPER_TIMEOUT_MS: garbage }), 60_000, garbage);
    }
    // The ceiling and the default both follow the configured helper budget.
    assert.equal(resolveOrientationHelperTimeoutMs({ PYTHON_HELPER_TIMEOUT_MS: '30000' }), 30_000);
    assert.equal(resolveOrientationHelperTimeoutMs({ PYTHON_HELPER_TIMEOUT_MS: '30000', ORIENTATION_HELPER_TIMEOUT_MS: '20000' }), 20_000);
    assert.equal(resolveOrientationHelperTimeoutMs({ PYTHON_HELPER_TIMEOUT_MS: '30000', ORIENTATION_HELPER_TIMEOUT_MS: '45000' }), 30_000);
    assert.equal(resolveOrientationHelperTimeoutMs({ SLICE_COMMAND_TIMEOUT_MS: '5000' }), 5_000);
    for (const env of [{}, live, { PYTHON_HELPER_TIMEOUT_MS: '30000' }, { SLICE_COMMAND_TIMEOUT_MS: '5000' },
        { ...live, ORIENTATION_HELPER_TIMEOUT_MS: '999999999' }]) {
        assert.ok(resolveOrientationHelperTimeoutMs(env) <= resolvePythonHelperTimeoutMs(env), JSON.stringify(env));
    }
    // The process-wide value is resolved once from the environment, like the helper budget.
    assert.equal(ORIENTATION_HELPER_TIMEOUT_MS, resolveOrientationHelperTimeoutMs(process.env));
    assert.ok(ORIENTATION_HELPER_TIMEOUT_MS <= PYTHON_HELPER_TIMEOUT_MS);
    assert.ok(ORIENTATION_HELPER_TIMEOUT_MS >= Math.min(PYTHON_HELPER_TIMEOUT_MIN_MS, PYTHON_HELPER_TIMEOUT_MS));
});

test('only a command whose first argument is the resolved orient.py path is the orientation helper', () => {
    assert.equal(ORIENTATION_HELPER_PATH, resolvePythonHelper('orient.py'));
    assert.equal(path.isAbsolute(ORIENTATION_HELPER_PATH), true);
    assert.equal(isOrientationHelperCommand(helperArgs('orient.py', 'in.stl', 'out.stl', 'FDM', 'auto', 'meta.json')), true);
    assert.equal(isOrientationHelperCommand(helperArgs('orient.py', 'in.stl', 'out.stl', 'FDM', 'auto', 'meta.json', 'ref.stl')), true);
    for (const args of [
        ['orient.py'],
        [path.join(os.tmpdir(), 'orient.py')],
        [`${ORIENTATION_HELPER_PATH}.bak`],
        helperArgs('mesh2stl.py', 'in.3mf', 'out.stl'),
        helperArgs('inspect_mesh.py', '--3mf-scope', 'in.3mf'),
        helperArgs('scale_model.py', 'in.stl', 'out.stl'),
        helperArgs('cad2stl.py', 'in.step', 'out.stl'),
        ['--orient', '1', '--arrange', '0', '--export-stl', '--outputdir', 'dir', ORIENTATION_HELPER_PATH],
        [],
        undefined,
        null,
        ORIENTATION_HELPER_PATH
    ]) {
        assert.equal(isOrientationHelperCommand(args), false, JSON.stringify(args));
    }
});

test('orient.py runs under the orientation budget while every other command keeps its own', async () => {
    const { state, runner } = fixture();
    const helperCall = { timeoutMs: LIVE_HELPER_BUDGET_MS };
    const runs = [
        runner(process.execPath, helperArgs('orient.py', 'in.stl', 'out.stl', 'FDM', 'auto', 'meta.json'), helperCall),
        runner(process.execPath, helperArgs('orient.py', 'in.stl', 'out.stl', 'FDM', 'auto', 'meta.json', 'ref.stl'), helperCall),
        runner(process.execPath, helperArgs('mesh2stl.py', 'in.3mf', 'out.stl'), helperCall),
        runner(process.execPath, helperArgs('inspect_mesh.py', '--3mf-scope', 'in.3mf'), helperCall),
        runner(process.execPath, helperArgs('cad2stl.py', 'in.step', 'out.stl'), helperCall),
        runner(process.execPath, helperArgs('scale_model.py', 'in.stl', 'out.stl'), helperCall),
        runner('bambu-studio', ['--orient', '1', '--arrange', '0', '--export-stl', '--outputdir', 'dir', 'in.stl'], helperCall),
        runner('bambu-studio', ['--slice', '0', '--export-3mf', 'result.gcode.3mf', 'in.stl']),
        // A shorter per-call budget still wins on the orientation helper.
        runner(process.execPath, helperArgs('orient.py', 'in.stl', 'out.stl', 'FDM', 'auto', 'meta.json'), { timeoutMs: 20_000 }),
        // A bare basename is not the resolved helper and keeps the per-call budget.
        runner(process.execPath, ['orient.py'], helperCall)
    ];
    for (const execution of state.executions) execution.callback(null, '', '');
    await Promise.all(runs);
    assert.deepEqual(state.timers.map((timer) => timer.delay), [
        ORIENTATION_BUDGET_MS,
        ORIENTATION_BUDGET_MS,
        LIVE_HELPER_BUDGET_MS,
        LIVE_HELPER_BUDGET_MS,
        LIVE_HELPER_BUDGET_MS,
        LIVE_HELPER_BUDGET_MS,
        LIVE_HELPER_BUDGET_MS,
        DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        20_000,
        LIVE_HELPER_BUDGET_MS
    ]);
});

test('the orientation budget never extends a shorter runner budget and defaults to the resolved value', async () => {
    const short = fixture({ timeoutMs: 30_000 });
    const shortRun = short.runner(process.execPath, helperArgs('orient.py', 'a', 'b', 'FDM', 'auto', 'm'), { timeoutMs: LIVE_HELPER_BUDGET_MS });
    short.state.executions[0].callback(null, '', '');
    await shortRun;
    assert.deepEqual(short.state.timers.map((timer) => timer.delay), [30_000]);

    const defaulted = fixture({ orientationTimeoutMs: undefined });
    const defaultRun = defaulted.runner(process.execPath, helperArgs('orient.py', 'a', 'b', 'FDM', 'auto', 'm'), { timeoutMs: LIVE_HELPER_BUDGET_MS });
    defaulted.state.executions[0].callback(null, '', '');
    await defaultRun;
    assert.deepEqual(defaulted.state.timers.map((timer) => timer.delay), [Math.min(ORIENTATION_HELPER_TIMEOUT_MS, LIVE_HELPER_BUDGET_MS)]);

    const delays = [];
    const helperRunner = createPythonHelperRunner({
        execFile: (_executable, _args, _options, callback) => { queueMicrotask(() => callback(null, '', '')); return { pid: 99 }; },
        platform: 'linux',
        telemetry: 'none',
        createChildEnvironment: () => ({}),
        setTimeout: (callback, delay) => { delays.push(delay); return { unref() {} }; },
        clearTimeout: () => {}
    });
    await helperRunner(process.execPath, helperArgs('orient.py', 'a', 'b', 'FDM', 'auto', 'm'));
    await helperRunner(process.execPath, helperArgs('mesh2stl.py', 'a', 'b'));
    assert.deepEqual(delays, [Math.min(ORIENTATION_HELPER_TIMEOUT_MS, PYTHON_HELPER_TIMEOUT_MS), PYTHON_HELPER_TIMEOUT_MS]);
});

test('an orientation run past its budget is terminated as a timeout the input pipeline already classifies', async () => {
    const { state, runner } = fixture({
        createProcessTreeTerminator: () => ({
            async terminate() {
                state.terminations += 1;
                state.executions[0].callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }), '', '');
            }
        })
    });
    const run = runner(process.execPath, helperArgs('orient.py', 'in.stl', 'out.stl', 'FDM', 'auto', 'meta.json'), { timeoutMs: LIVE_HELPER_BUDGET_MS });
    assert.equal(state.timers.length, 1);
    assert.equal(state.timers[0].delay, ORIENTATION_BUDGET_MS);
    state.timers[0].callback();
    const error = await run.then(() => assert.fail('the hung helper must not resolve'), (failure) => failure);
    assert.equal(error.code, 'ETIMEDOUT');
    assert.equal(error.name, 'TimeoutError');
    assert.equal(state.terminations, 1);
    const { classifyOrientationFailure } = require(INPUT_PATH);
    assert.equal(classifyOrientationFailure(error), 'ORIENTATION_HELPER_TIMEOUT');
});

/**
 * Drive the real input pipeline through a real command runner whose spawn,
 * timers and terminator are fakes: the Bambu export succeeds, the helper
 * refuses the reference as another mesh, and the heuristic never answers.
 */
function installRunnerBehindInputProcessing(runCommand) {
    const paths = [COMMAND_PATH, PYTHON_PATH, INPUT_PATH];
    const originals = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
    require.cache[COMMAND_PATH] = {
        id: COMMAND_PATH, filename: COMMAND_PATH, loaded: true,
        exports: { ...command, runCommand }
    };
    delete require.cache[PYTHON_PATH];
    delete require.cache[INPUT_PATH];
    return () => {
        for (const [modulePath, original] of originals) {
            if (original) require.cache[modulePath] = original;
            else delete require.cache[modulePath];
        }
    };
}

test('a reference mismatch followed by a hung heuristic ends unrotated after the orientation budget', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'orientation-budget-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const bambuExecutable = resolveSlicerExecutable('bambu');
    const pending = [];
    const timers = [];
    let terminations = 0;
    let armedHeuristic;
    const heuristicArmed = new Promise((resolve) => { armedHeuristic = resolve; });
    const runner = createCommandRunner({
        execFile: (executable, args, _options, callback) => {
            const call = { executable, args: [...args], callback };
            pending.push(call);
            queueMicrotask(async () => {
                if (executable === bambuExecutable) {
                    const stlDirectory = path.join(args[args.indexOf('--outputdir') + 1], 'stl');
                    await fsp.mkdir(stlDirectory, { recursive: true });
                    await fsp.writeFile(path.join(stlDirectory, 'obj_1_model.stl'), 'solid reference');
                    callback(null, '', '');
                } else if (args.length === 7) {
                    const marker = 'ORIENTATION_REFERENCE_MISMATCH|reference triangle count differs from the submitted mesh\n';
                    callback(Object.assign(new Error('Command failed: exit 3'), { code: 3 }), marker, marker);
                }
                // The heuristic (six arguments) never answers on its own.
            });
            return { pid: 4321 };
        },
        timeoutMs: DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        orientationTimeoutMs: ORIENTATION_BUDGET_MS,
        platform: 'linux',
        telemetry: 'none',
        createChildEnvironment: () => ({}),
        setTimeout: (callback, delay) => {
            const handle = { callback, delay, unref() {} };
            timers.push(handle);
            if (pending.length === 3) armedHeuristic(handle);
            return handle;
        },
        clearTimeout: () => {},
        createProcessTreeTerminator: () => ({
            async terminate() {
                terminations += 1;
                pending[2].callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }), '', '');
            }
        })
    });
    t.after(installRunnerBehindInputProcessing(runner));
    const { tryOptimizeOrientation } = require(INPUT_PATH);
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const model = path.join(root, 'model.stl');
    await fsp.writeFile(model, 'solid model');
    const events = [];
    const emitEvent = (name, data) => { events.push([name, data]); return true; };

    const run = tryOptimizeOrientation(model, 'FDM', 'auto', workspace, new AbortController().signal, { engine: 'bambu', emitEvent });
    const heuristicTimer = await heuristicArmed;
    assert.equal(heuristicTimer.delay, ORIENTATION_BUDGET_MS);
    heuristicTimer.callback();
    const result = await run;

    assert.deepEqual(pending.map((call) => [call.executable, call.args.length]), [
        [bambuExecutable, 8],
        [process.execPath, 7],
        [process.execPath, 6]
    ]);
    assert.ok(pending.slice(1).every((call) => call.args[0] === ORIENTATION_HELPER_PATH));
    // The Bambu reference export keeps the helper budget; both orient.py runs get the orientation budget.
    assert.deepEqual(timers.map((timer) => timer.delay), [PYTHON_HELPER_TIMEOUT_MS, ORIENTATION_BUDGET_MS, ORIENTATION_BUDGET_MS]);
    assert.equal(terminations, 1);
    assert.equal(result.processableFile, model);
    assert.equal(result.orientation.outcome, 'fallback_unmodified');
    assert.equal(result.orientation.automaticOrientationApplied, false);
    assert.deepEqual(events, [
        ['orientation.reference_fallback', {
            audience: 'slice',
            outcome: 'heuristic',
            error_code: 'ORIENTATION_REFERENCE_MISMATCH',
            extra: { reason: 'auto', technology: 'FDM', native_kind: 'bambu' }
        }],
        ['orientation.fallback', {
            audience: 'slice',
            outcome: 'fallback_unmodified',
            error_code: 'ORIENTATION_HELPER_TIMEOUT',
            extra: { reason: 'auto', technology: 'FDM' }
        }]
    ]);
});
