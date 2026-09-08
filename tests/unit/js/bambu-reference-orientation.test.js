'use strict';

/**
 * Bambu FDM automatic orientation follows the engine's own pose: the CLI
 * exports the pose it would print, and `orient.py` applies that rotation to
 * the submitted geometry. Every degradation from that path is honest and
 * observable, and every other engine, mode, and technology is untouched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PATH = path.join(ROOT, 'app/services/slice/command.js');
const PYTHON_PATH = path.join(ROOT, 'app/config/python.js');
const INPUT_PATH = path.join(ROOT, 'app/services/slice/input-processing.js');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const { resolvePythonHelper } = require('../../../app/services/slice/helper-paths');
const { EVENT_NAMES, createEventEmitter } = require('../../../app/services/observability/events');

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RX_90 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
const HELPER_BUDGET_MS = 120000;

function installCommandMock(runCommand) {
    const paths = [COMMAND_PATH, PYTHON_PATH, INPUT_PATH];
    const originalModules = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
    require.cache[COMMAND_PATH] = {
        id: COMMAND_PATH,
        filename: COMMAND_PATH,
        loaded: true,
        exports: {
            runCommand,
            PYTHON_HELPER_TIMEOUT_MS: HELPER_BUDGET_MS,
            throwIfAborted(signal) { if (signal?.aborted) throw signal.reason; },
            isAbortError(error, signal) { return Boolean(signal?.aborted || error?.name === 'AbortError'); }
        }
    };
    delete require.cache[PYTHON_PATH];
    delete require.cache[INPUT_PATH];
    return () => {
        for (const [modulePath, original] of originalModules) {
            if (original) require.cache[modulePath] = original;
            else delete require.cache[modulePath];
        }
    };
}

/**
 * Drive `tryOptimizeOrientation` against a scripted command runner.
 * `bambu`: 'ok' | 'throw' | 'empty' | 'two'; `helper`: 'ok' | 'mismatch'.
 */
async function scenario(t, { engine, technology = 'FDM', mode = 'auto', bambu = 'ok', helper = 'ok', abortDuring = null } = {}) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bambu-reference-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const controller = new AbortController();
    const calls = [];
    const events = [];
    const restoreModules = installCommandMock(async (executable, args, options) => {
        calls.push({ executable, args: [...args], timeoutMs: options?.timeoutMs, signal: options?.signal });
        if (executable === 'bambu-studio') {
            if (abortDuring === 'reference') {
                controller.abort(new Error('client gone'));
                throw controller.signal.reason;
            }
            if (bambu === 'throw') {
                throw Object.assign(new Error('spawn bambu-studio ENOENT'), { code: 'ENOENT' });
            }
            const stlDirectory = path.join(args[args.indexOf('--outputdir') + 1], 'stl');
            await fsp.mkdir(stlDirectory, { recursive: true });
            if (bambu !== 'empty') await fsp.writeFile(path.join(stlDirectory, 'obj_1_model.stl'), 'solid reference');
            if (bambu === 'two') await fsp.writeFile(path.join(stlDirectory, 'obj_2_model.stl'), 'solid reference');
            return { stdout: 'best:0 0 1\n', stderr: '' };
        }
        const withReference = args.length === 7;
        if (withReference && helper === 'mismatch') {
            const marker = 'ORIENTATION_REFERENCE_MISMATCH|reference triangle count differs from the submitted mesh\n';
            throw Object.assign(new Error('Command failed: exit 3'), { code: 3, stdout: marker, stderr: marker });
        }
        const outcome = mode === 'preserve' ? 'preserved' : (withReference ? 'applied' : 'unchanged');
        await fsp.writeFile(args[2], 'solid oriented');
        await fsp.writeFile(args[5], JSON.stringify({
            orientation_metadata_schema: 1,
            orientation_mode: mode,
            orientation_outcome: outcome,
            rotation_matrix: withReference ? RX_90 : IDENTITY
        }));
        return { stdout: '', stderr: '' };
    });
    t.after(restoreModules);
    const { tryOptimizeOrientation } = require(INPUT_PATH);
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const model = path.join(root, 'model.stl');
    await fsp.writeFile(model, 'solid model');
    const emitEvent = (name, data) => { events.push([name, data]); return true; };
    const run = tryOptimizeOrientation(model, technology, mode, workspace, controller.signal, { engine, emitEvent });
    return { root, model, calls, events, controller, run };
}

function orientedOf(model) {
    return model.replace(/\.stl$/i, '_oriented.stl');
}

function referenceDirectoryOf(model) {
    return model.replace(/\.stl$/i, '_bambu-orient');
}

test('the reference fallback is part of the fixed, bounded event vocabulary', () => {
    assert.ok(EVENT_NAMES.includes('orientation.reference_fallback'));
    assert.ok(EVENT_NAMES.length <= 32);
    const emitted = [];
    const emit = createEventEmitter({ writer: (entry) => emitted.push(entry) });
    assert.equal(emit('orientation.reference_fallback', {
        audience: 'slice', outcome: 'heuristic', error_code: 'ORIENTATION_REFERENCE_UNAVAILABLE',
        extra: { reason: 'auto', technology: 'FDM', native_kind: 'bambu', path: '/tmp/secret.stl' }
    }), true);
    assert.equal(emitted[0].event, 'orientation.reference_fallback');
    assert.equal(emitted[0].outcome, 'heuristic');
    assert.equal(emitted[0].error_code, 'ORIENTATION_REFERENCE_UNAVAILABLE');
    assert.deepEqual(emitted[0].extra, { reason: 'auto', technology: 'FDM', native_kind: 'bambu' });
});

test('Bambu FDM auto exports the engine pose first and hands it to the helper as the reference', async (t) => {
    const { model, calls, events, controller, run } = await scenario(t, { engine: 'bambu' });
    const result = await run;

    const referenceDirectory = referenceDirectoryOf(model);
    assert.deepEqual(calls.map(({ executable, args }) => [executable, args]), [
        ['bambu-studio', ['--orient', '1', '--arrange', '0', '--export-stl', '--outputdir', referenceDirectory, model]],
        [process.execPath, [resolvePythonHelper('orient.py'), model, orientedOf(model), 'FDM', 'auto',
            `${orientedOf(model)}.orientation.json`, path.join(referenceDirectory, 'stl', 'obj_1_model.stl')]]
    ]);
    assert.ok(calls.every((call) => call.signal === controller.signal && call.timeoutMs === HELPER_BUDGET_MS));
    assert.equal(result.processableFile, orientedOf(model));
    assert.equal(result.orientation.mode, 'auto');
    assert.equal(result.orientation.outcome, 'applied');
    assert.equal(result.orientation.automaticOrientationApplied, true);
    assert.deepEqual(result.orientation.automaticRotationMatrix, RX_90);
    assert.deepEqual(events, []);
});

for (const [label, bambu, errorCode] of [
    ['an unavailable Bambu executable', 'throw', 'ORIENTATION_REFERENCE_UNAVAILABLE'],
    ['an export without any STL', 'empty', 'ORIENTATION_REFERENCE_UNAVAILABLE'],
    ['an export with more than one STL', 'two', 'ORIENTATION_REFERENCE_UNAVAILABLE']
]) {
    test(`${label} degrades to the heuristic once and says so`, async (t) => {
        const { model, calls, events, run } = await scenario(t, { engine: 'bambu', bambu });
        const result = await run;

        assert.equal(calls.length, 2);
        assert.equal(calls[0].executable, 'bambu-studio');
        assert.deepEqual(calls[1].args, [resolvePythonHelper('orient.py'), model, orientedOf(model), 'FDM', 'auto',
            `${orientedOf(model)}.orientation.json`]);
        assert.equal(result.orientation.outcome, 'unchanged');
        assert.deepEqual(events, [['orientation.reference_fallback', {
            audience: 'slice',
            outcome: 'heuristic',
            error_code: errorCode,
            extra: { reason: 'auto', technology: 'FDM', native_kind: 'bambu' }
        }]]);
        assert.doesNotMatch(JSON.stringify(events), /bambu-reference-|model\.stl/);
    });
}

test('a reference the helper refuses as another mesh is discarded and the heuristic runs', async (t) => {
    const { model, calls, events, run } = await scenario(t, { engine: 'bambu', helper: 'mismatch' });
    const result = await run;

    assert.equal(calls.length, 3);
    assert.equal(calls[1].args.length, 7);
    assert.equal(calls[2].args.length, 6);
    assert.equal(result.processableFile, orientedOf(model));
    assert.equal(result.orientation.outcome, 'unchanged');
    assert.deepEqual(result.orientation.automaticRotationMatrix, IDENTITY);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'orientation.reference_fallback');
    assert.equal(events[0][1].error_code, 'ORIENTATION_REFERENCE_MISMATCH');
});

for (const [label, options] of [
    ['the Prusa engine', { engine: 'prusa' }],
    ['the Orca engine', { engine: 'orca' }],
    ['an unspecified engine', {}],
    ['preserve mode on Bambu', { engine: 'bambu', mode: 'preserve' }],
    ['SLA on Bambu', { engine: 'bambu', technology: 'SLA' }]
]) {
    test(`${label} never asks Bambu for a reference pose`, async (t) => {
        const { calls, events, run } = await scenario(t, options);
        await run;

        assert.equal(calls.length, 1);
        assert.equal(calls[0].executable, process.execPath);
        assert.equal(calls[0].args.length, 6);
        assert.deepEqual(events, []);
    });
}

test('an abort while the reference is being exported propagates without any helper run', async (t) => {
    const { calls, events, controller, run } = await scenario(t, { engine: 'bambu', abortDuring: 'reference' });

    await assert.rejects(run, controller.signal.reason);
    assert.equal(calls.length, 1);
    assert.deepEqual(events, []);
});

test('the exported reference lives beside the submitted STL inside the workspace', () => {
    const { resolveReferencePoseDirectory, usesReferencePose, REFERENCE_POSE_ARGS } = require(INPUT_PATH);
    const contained = [];
    const workspace = { assertContainedPath(candidate) { contained.push(candidate); return candidate; } };
    assert.equal(resolveReferencePoseDirectory('/job/model.STL', workspace), '/job/model_bambu-orient');
    assert.deepEqual(contained, ['/job/model_bambu-orient']);
    assert.deepEqual([...REFERENCE_POSE_ARGS], ['--orient', '1', '--arrange', '0', '--export-stl']);
    assert.equal(usesReferencePose('FDM', 'auto', 'bambu'), true);
    assert.equal(usesReferencePose('FDM', 'preserve', 'bambu'), false);
    assert.equal(usesReferencePose('SLA', 'auto', 'bambu'), false);
    assert.equal(usesReferencePose('FDM', 'auto', 'orca'), false);
    assert.equal(usesReferencePose('FDM', 'auto', undefined), false);
});
