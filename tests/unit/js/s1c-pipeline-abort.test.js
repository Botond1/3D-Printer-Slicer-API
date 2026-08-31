'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const slicePath = (name) => path.join(ROOT, 'app/services/slice', name);
const COMMAND_PATH = slicePath('command.js');
const INPUT_PATH = slicePath('input-processing.js');
const MODEL_PATH = slicePath('model-stats.js');
const OUTPUT_PATH = slicePath('output-lifecycle.js');
const PIPELINE_PATH = slicePath('pipeline.js');
const PROFILES_PATH = slicePath('profiles.js');
const PROFILE_DIGEST_PATH = slicePath('profile-digest.js');
const ENGINE_VERSION_PATH = slicePath('engine-version.js');

process.env.PYTHON_EXECUTABLE = process.execPath;
let runImpl;

function installCommandMock() {
    require.cache[COMMAND_PATH] = {
        id: COMMAND_PATH, filename: COMMAND_PATH, loaded: true,
        exports: {
            runCommand(...args) { return runImpl(...args); },
            abortReason(signal) { return signal?.reason instanceof Error ? signal.reason : new Error('aborted'); },
            throwIfAborted(signal) { if (signal?.aborted) throw signal.reason; },
            isAbortError(error, signal) { return Boolean(signal?.aborted || error?.name === 'AbortError'); }
        }
    };
}

function resetModules() {
    for (const file of [INPUT_PATH, MODEL_PATH, OUTPUT_PATH, PIPELINE_PATH, PROFILE_DIGEST_PATH, ENGINE_VERSION_PATH]) {
        delete require.cache[file];
    }
    installCommandMock();
    require.cache[PROFILE_DIGEST_PATH] = {
        id: PROFILE_DIGEST_PATH,
        filename: PROFILE_DIGEST_PATH,
        loaded: true,
        exports: { calculateEffectiveProfileSha256: () => 'a'.repeat(64) }
    };
    require.cache[ENGINE_VERSION_PATH] = {
        id: ENGINE_VERSION_PATH,
        filename: ENGINE_VERSION_PATH,
        loaded: true,
        exports: { getSlicerEngineVersion: () => '2.8.1' }
    };
}

test('pre-aborted converter, orientation, and model-info calls launch no command', async () => {
    resetModules();
    let launches = 0;
    runImpl = async () => { launches += 1; return { stdout: '', stderr: '' }; };
    const reason = new Error('pre-aborted');
    const controller = new AbortController(); controller.abort(reason);
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const { convertInputToStl, tryOptimizeOrientation } = require(INPUT_PATH);
    const { getModelInfo } = require(MODEL_PATH);
    await assert.rejects(convertInputToStl('model.obj', workspace, controller.signal), (error) => error === reason);
    await assert.rejects(
        tryOptimizeOrientation('model.stl', 'FDM', 'auto', workspace, controller.signal),
        (error) => error === reason
    );
    await assert.rejects(getModelInfo('model.stl', controller.signal), (error) => error === reason);
    assert.equal(launches, 0);
});

test('orientation and model-info fallbacks rethrow active abort instead of swallowing it', async () => {
    resetModules();
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const { tryOptimizeOrientation } = require(INPUT_PATH);
    const { getModelInfo } = require(MODEL_PATH);
    for (const invoke of [
        (signal) => tryOptimizeOrientation('model.stl', 'FDM', 'auto', workspace, signal),
        (signal) => getModelInfo('model.stl', signal)
    ]) {
        const reason = new Error('active abort'); reason.name = 'AbortError';
        const controller = new AbortController();
        runImpl = async () => { controller.abort(reason); throw reason; };
        await assert.rejects(invoke(controller.signal), (error) => error === reason);
    }
});

test('genuine non-abort orientation and metadata failures retain their safe fallbacks', async () => {
    resetModules();
    runImpl = async () => { throw new Error('ordinary native failure'); };
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const { tryOptimizeOrientation } = require(INPUT_PATH);
    const { getModelInfo } = require(MODEL_PATH);
    const fallback = await tryOptimizeOrientation('model.stl', 'FDM', 'auto', workspace);
    assert.equal(fallback.processableFile, 'model.stl');
    assert.equal(fallback.orientation.mode, 'auto');
    assert.equal(fallback.orientation.outcome, 'fallback_unmodified');
    assert.equal(fallback.orientation.automaticOrientationApplied, false);
    assert.deepEqual(fallback.orientation.automaticRotationMatrix, [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
    ]);
    assert.deepEqual(await getModelInfo('model.stl'), {
        status: 'unavailable',
        modelInfo: null
    });
});

test('an oriented output without trusted sidecar metadata is ignored', async (t) => {
    resetModules();
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-orientation-metadata-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const modelPath = path.join(root, 'model.stl');
    await fsp.writeFile(modelPath, 'solid original');
    runImpl = async (_executable, args) => {
        await fsp.writeFile(args[2], 'solid untrusted-rotated-output');
        return { stdout: '', stderr: '' };
    };
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const { tryOptimizeOrientation } = require(INPUT_PATH);

    const result = await tryOptimizeOrientation(modelPath, 'FDM', 'auto', workspace);
    assert.equal(result.processableFile, modelPath);
    assert.equal(result.orientation.outcome, 'fallback_unmodified');
    assert.equal(result.orientation.automaticOrientationApplied, false);
});

test('fallback_unmodified sidecar keeps the original STL as the slicer input', async (t) => {
    resetModules();
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-orientation-fallback-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const modelPath = path.join(root, 'model.stl');
    await fsp.writeFile(modelPath, 'solid original');
    runImpl = async (_executable, args) => {
        await fsp.writeFile(args[2], 'solid helper-fallback-copy');
        await fsp.writeFile(args[5], JSON.stringify({
            orientation_metadata_schema: 1,
            orientation_mode: 'auto',
            orientation_outcome: 'fallback_unmodified',
            rotation_matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        }));
        return { stdout: '', stderr: '' };
    };
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const { tryOptimizeOrientation } = require(INPUT_PATH);

    const result = await tryOptimizeOrientation(modelPath, 'FDM', 'auto', workspace);
    assert.equal(result.processableFile, modelPath);
    assert.equal(result.orientation.outcome, 'fallback_unmodified');
    assert.equal(result.orientation.automaticOrientationApplied, false);
});

test('orientation abort stops preprocessing before model-info, transform, or slicing', async (t) => {
    resetModules();
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-pipeline-abort-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const modelPath = path.join(root, 'model.stl');
    await fsp.writeFile(modelPath, 'solid bounded');
    const reason = new Error('orientation abort'); reason.name = 'AbortError';
    const controller = new AbortController();
    const launches = [];
    runImpl = async (executable, args) => {
        launches.push([executable, ...args]);
        if (executable === 'prusa-slicer') {
            return { stdout: 'size_x = 10\nsize_y = 20\nsize_z = 30\n', stderr: '' };
        }
        controller.abort(reason);
        throw reason;
    };
    const workspace = { assertContainedPath(candidate) { return path.resolve(candidate); } };
    const { prepareProcessableModel } = require(PIPELINE_PATH);
    await assert.rejects(
        prepareProcessableModel(modelPath, 'FDM', 'auto', workspace, controller.signal),
        (error) => error === reason
    );
    assert.equal(launches.length, 2);
    assert.deepEqual(launches[0].slice(0, 2), ['prusa-slicer', '--info']);
    assert.equal(path.basename(launches[1][1]), 'orient.py');
});

async function outputFixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-output-abort-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return { root, output: path.join(root, 'result.gcode') };
}

function loadOutputLifecycle(parseOutputDetailed) {
    resetModules();
    require.cache[MODEL_PATH] = {
        id: MODEL_PATH, filename: MODEL_PATH, loaded: true,
        exports: { parseOutputDetailed, getModelInfo: async () => ({ x: 1, y: 1, z: 1, height_mm: 1 }) }
    };
    const actualProfiles = require(PROFILES_PATH);
    require.cache[PROFILES_PATH] = {
        id: PROFILES_PATH, filename: PROFILES_PATH, loaded: true,
        exports: { ...actualProfiles, createRuntimeSlicerProfile: async () => 'runtime-profile', logEngineProfileSelection() {} }
    };
    delete require.cache[OUTPUT_PATH];
    return require(OUTPUT_PATH);
}

function outputContext(output, workspace, signal) {
    return {
        engine: 'prusa', technology: 'FDM', layerHeight: 0.2, infillPercentage: '20%',
        baseConfigFile: 'base.ini', orcaMachineConfigFile: null, slicerOutputPath: output,
        outputCandidate: 'candidate.gcode', engineOutputDir: null, processableFile: 'model.stl',
        effectiveModelInfo: { height_mm: 10 }, workspace, signal
    };
}

function schemaTwoPreserveTransform() {
    const zero = { x: 0, y: 0, z: 0 };
    const dimensions = { x: 20, y: 30, z: 40 };
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    return {
        transform_schema: 2,
        size_unit: 'mm',
        keep_proportions: true,
        requested_size: { x: null, y: null, z: null },
        scale_percent: 100,
        scale_factors: { x: 1, y: 1, z: 1 },
        orientation_mode: 'preserve',
        orientation_outcome: 'preserved',
        automatic_orientation_applied: false,
        automatic_rotation_deg: { ...zero },
        requested_rotation_deg: { ...zero },
        rotation_deg: { ...zero },
        automatic_rotation_matrix: identity.map((row) => [...row]),
        rotation_matrix: identity.map((row) => [...row]),
        original_dimensions_available: true,
        original_dimensions_mm: { ...dimensions },
        oriented_dimensions_mm: { ...dimensions },
        final_dimensions_mm: { ...dimensions }
    };
}

test('abort after native return prevents parsing and artifact promotion', async (t) => {
    const { output } = await outputFixture(t);
    const reason = new Error('post-native abort'); reason.name = 'AbortError';
    const controller = new AbortController();
    let parses = 0; let promotions = 0; let observedSignal;
    const { runSlicerAndParseStats } = loadOutputLifecycle(async () => { parses += 1; return {}; });
    runImpl = async (_executable, _args, options) => {
        observedSignal = options.signal;
        await fsp.writeFile(output, '; partial');
        controller.abort(reason);
        return { stdout: '', stderr: '' };
    };
    const workspace = {
        assertContainedPath(candidate) { return candidate; },
        async promoteOutputCandidate() { promotions += 1; }
    };
    await assert.rejects(runSlicerAndParseStats(outputContext(output, workspace, controller.signal)),
        (error) => error === reason);
    assert.equal(observedSignal, controller.signal);
    assert.equal(parses, 0);
    assert.equal(promotions, 0);
});

test('Prusa exit-zero missing output maps explicit placement text to full K2 only', async (t) => {
    const { output } = await outputFixture(t);
    const controller = new AbortController();
    const { runSlicerAndParseStats } = loadOutputLifecycle(async () => {
        throw new Error('must not parse');
    });
    const workspace = {
        assertContainedPath(candidate) { return candidate; },
        async promoteOutputCandidate() { throw new Error('must not promote'); }
    };
    const buildVolumeLimits = {
        min: { x: 0.1, y: 0.1, z: 0.1 },
        max: { x: 253.9, y: 253.9, z: 249.9 },
        sourceProfile: 'Bambu_P1S_0.4_nozzle.json'
    };
    const context = {
        ...outputContext(output, workspace, controller.signal),
        modelTransform: schemaTwoPreserveTransform(),
        buildVolumeLimits
    };
    runImpl = async () => ({
        stdout: 'plate 1: Nothing to be sliced; no object is fully inside the print volume',
        stderr: 'warning: unrelated native note'
    });

    let placementError;
    await assert.rejects(runSlicerAndParseStats(context), (error) => {
        placementError = error;
        return error.code === 'NATIVE_MODEL_OUT_OF_PRINTER_BOUNDS';
    });
    const { buildNativeBoundsResponse } = require('../../../app/services/slice/native-bounds');
    const response = buildNativeBoundsResponse(placementError);
    assert.equal(response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(response.model_transform, context.modelTransform);
    assert.deepEqual(response.build_volume_limits_mm.max, buildVolumeLimits.max);

    runImpl = async () => ({
        stdout: 'unrelated successful diagnostic',
        stderr: 'warning: unrelated native note'
    });
    await assert.rejects(runSlicerAndParseStats(context), (error) => (
        error.code === 'ENOENT' && buildNativeBoundsResponse(error) === null
    ));
});

test('abort racing with promotion cannot become a successful artifact response', async (t) => {
    const { output } = await outputFixture(t);
    const reason = new Error('promotion abort'); reason.name = 'AbortError';
    const controller = new AbortController();
    let promotions = 0;
    const { runSlicerAndParseStats } = loadOutputLifecycle(async () => ({ print_time_seconds: 1 }));
    runImpl = async () => { await fsp.writeFile(output, '; generated'); return { stdout: '', stderr: '' }; };
    const workspace = {
        assertContainedPath(candidate) { return candidate; },
        async promoteOutputCandidate() { promotions += 1; controller.abort(reason); }
    };
    await assert.rejects(runSlicerAndParseStats(outputContext(output, workspace, controller.signal)),
        (error) => error === reason);
    assert.equal(promotions, 1);
});

test('processSlice preserves a typed queue-shutdown reason and writes no 500 response', async () => {
    resetModules();
    runImpl = async () => { throw new Error('must not launch'); };
    delete require.cache[PIPELINE_PATH];
    const { processSlice } = require(PIPELINE_PATH);
    const { attachWorkspaceToRequest } = require('../../../app/services/slice/workspace');
    const { SliceQueueShutdownError } = require('../../../app/services/slice/queue');
    const req = {};
    attachWorkspaceToRequest(req, { id: 'inert', assertContainedPath(candidate) { return candidate; } });
    let writes = 0;
    const res = { status() { writes += 1; return this; }, json() { writes += 1; return this; } };
    const reason = new SliceQueueShutdownError();
    const controller = new AbortController(); controller.abort(reason);
    await assert.rejects(processSlice(req, res, { signal: controller.signal }), (error) => error === reason);
    assert.equal(writes, 0);
});
