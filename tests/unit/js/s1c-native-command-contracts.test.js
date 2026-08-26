'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PATH = path.join(ROOT, 'app/services/slice/command.js');
const PYTHON_PATH = path.join(ROOT, 'app/config/python.js');
const INPUT_PATH = path.join(ROOT, 'app/services/slice/input-processing.js');
const MODEL_PATH = path.join(ROOT, 'app/services/slice/model-stats.js');
const TRANSFORM_PATH = path.join(ROOT, 'app/services/slice/transform.js');
const OUTPUT_PATH = path.join(ROOT, 'app/services/slice/output-lifecycle.js');
const PROFILES_PATH = path.join(ROOT, 'app/services/slice/profiles.js');
const PROFILE_DIGEST_PATH = path.join(ROOT, 'app/services/slice/profile-digest.js');
const ENGINE_VERSION_PATH = path.join(ROOT, 'app/services/slice/engine-version.js');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { resolvePythonHelper } = require('../../../app/services/slice/helper-paths');
const {
    resolveSlicerExecutable,
    resolveSlicerInvocationPolicy,
    buildSlicerCommandArgs
} = require('../../../app/services/slice/engine');

function installCommandMock(runCommand) {
    const paths = [
        COMMAND_PATH, PYTHON_PATH, INPUT_PATH, MODEL_PATH, TRANSFORM_PATH,
        OUTPUT_PATH, PROFILES_PATH, PROFILE_DIGEST_PATH, ENGINE_VERSION_PATH
    ];
    const originalModules = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
    require.cache[COMMAND_PATH] = {
        id: COMMAND_PATH,
        filename: COMMAND_PATH,
        loaded: true,
        exports: {
            runCommand,
            throwIfAborted(signal) { if (signal?.aborted) throw signal.reason; },
            isAbortError(error, signal) { return Boolean(signal?.aborted || error?.name === 'AbortError'); }
        }
    };
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
        exports: { getSlicerEngineVersion: (engine) => engine === 'orca' ? '2.3.1' : '2.8.1' }
    };
    for (const modulePath of [INPUT_PATH, MODEL_PATH, TRANSFORM_PATH, OUTPUT_PATH]) delete require.cache[modulePath];
    return () => {
        for (const [modulePath, original] of originalModules) {
            if (original) require.cache[modulePath] = original;
            else delete require.cache[modulePath];
        }
    };
}

test('converter, orientation, model-info, and transform commands preserve exact arrays', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-args-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const calls = [];
    const restoreModules = installCommandMock(async (executable, args, options) => {
        calls.push({ executable, args: [...args], signal: options?.signal });
        if (path.basename(args[0] || '') === 'scale_model.py' || ['mesh2stl.py', 'cad2stl.py', 'orient.py'].includes(path.basename(args[0] || ''))) {
            await fsp.writeFile(args[2], 'solid inert');
        }
        return { stdout: 'size_x = 10\nsize_y = 20\nsize_z = 30\n', stderr: '' };
    });
    t.after(restoreModules);
    delete require.cache[PYTHON_PATH];
    const { convertInputToStl, tryOptimizeOrientation } = require(INPUT_PATH);
    const { getModelInfo } = require(MODEL_PATH);
    const { applyTransformAndValidateModel } = require(TRANSFORM_PATH);
    const workspace = { assertContainedPath(candidate) { return candidate; } };
    const signal = new AbortController().signal;

    const mesh = path.join(root, 'mesh.obj'); await fsp.writeFile(mesh, 'x');
    const meshStl = await convertInputToStl(mesh, workspace, signal);
    const cad = path.join(root, 'part.step'); await fsp.writeFile(cad, 'x');
    await convertInputToStl(cad, workspace, signal);
    await tryOptimizeOrientation(meshStl, 'FDM', workspace, signal);
    await getModelInfo(meshStl, signal);
    const transformOptions = { unit: 'mm', keepProportions: true,
        requestedTargetSize: { x: null, y: null, z: null }, targetSizeMm: { x: null, y: null, z: null },
        scalePercent: 200, rotationDeg: { x: 0, y: 0, z: 0 } };
    const limits = { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 1000, z: 1000 }, sourceProfile: 'inert' };
    await applyTransformAndValidateModel(meshStl, { x: 10, y: 20, z: 30 }, transformOptions, limits, workspace, signal);

    const transformedPath = calls[4].args[2];
    assert.deepEqual(calls.map(({ executable, args }) => [executable, args]), [
        [process.execPath, [resolvePythonHelper('mesh2stl.py'), mesh, `${mesh}.stl`]],
        [process.execPath, [resolvePythonHelper('cad2stl.py'), cad, `${cad}.stl`]],
        [process.execPath, [resolvePythonHelper('orient.py'), meshStl,
            meshStl.replace(/\.stl$/i, '_oriented.stl'), 'FDM']],
        ['prusa-slicer', ['--info', meshStl]],
        [process.execPath, [resolvePythonHelper('scale_model.py'), meshStl, transformedPath,
            '2', '2', '2', '0', '0', '0']],
        ['prusa-slicer', ['--info', transformedPath]]
    ]);
    assert.ok(calls.every((call) => call.signal === signal));
});
test('Prusa and Orca slicer executable/argument arrays remain exact', () => {
    const prusa = buildSlicerCommandArgs('FDM', 'profile.ini', 'out.gcode', '20%', 'prusa', null);
    const prusaPolicy = resolveSlicerInvocationPolicy('prusa', 'FDM');
    assert.equal(resolveSlicerExecutable('prusa'), 'prusa-slicer');
    assert.deepEqual(prusa, ['--load', 'profile.ini', '--center', '100,100', '--support-material',
        '--support-material-auto', '--gcode-flavor', 'marlin', '--export-gcode', '--output',
        'out.gcode', '--fill-density', '20%']);
    assert.ok(prusa.includes(`--export-${prusaPolicy.export}`));
    const orca = buildSlicerCommandArgs(
        'FDM', 'process.json', path.join('stage', 'result.gcode'), '20%',
        'orca', 'machine.json', 'filament.json'
    );
    const orcaPolicy = resolveSlicerInvocationPolicy('orca', 'FDM');
    assert.equal(resolveSlicerExecutable('orca'), 'orca-slicer');
    assert.deepEqual(orcaPolicy.settingsPrecedence, ['machine', 'process', 'filament']);
    assert.equal(orca[1], orcaPolicy.settingsPrecedence
        .map((role) => ({ machine: 'machine.json', process: 'process.json', filament: 'filament.json' })[role])
        .join(';'));
    assert.deepEqual(orca, ['--load-settings', 'machine.json;process.json;filament.json', '--arrange', '1',
        '--orient', '0', '--slice', '0', '--outputdir', 'stage']);
    assert.equal(
        buildSlicerCommandArgs(
            'FDM', 'process.json', path.join('stage', 'result.gcode'), '20%', 'orca', 'machine.json'
        )[1],
        'machine.json;process.json'
    );
});

test('Prusa and Orca execution append only the processable model to exact engine arrays', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-slicer-args-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const calls = [];
    const parseCalls = [];
    const restoreModules = installCommandMock(async (executable, args, options) => {
        calls.push({ executable, args: [...args], signal: options.signal });
        const target = executable === 'orca-slicer'
            ? path.join(args[args.indexOf('--outputdir') + 1], 'actual.gcode')
            : path.join(root, 'prusa.gcode');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, '; generated');
        return { stdout: '', stderr: '' };
    });
    t.after(restoreModules);
    require.cache[MODEL_PATH] = {
        id: MODEL_PATH, filename: MODEL_PATH, loaded: true,
        exports: { parseOutputDetailed: async (...args) => {
            parseCalls.push(args);
            return { print_time_seconds: 1 };
        } }
    };
    require.cache[PROFILES_PATH] = {
        id: PROFILES_PATH, filename: PROFILES_PATH, loaded: true,
        exports: { createRuntimeSlicerProfile: async (_engine, base) => base, logEngineProfileSelection() {} }
    };
    delete require.cache[OUTPUT_PATH];
    const { runSlicerAndParseStats } = require(OUTPUT_PATH);
    const workspace = {
        assertContainedPath(candidate) { return candidate; },
        async promoteOutputCandidate() {}
    };
    const signal = new AbortController().signal;
    const filamentProfile = path.join(root, 'filament.json');
    await fsp.writeFile(filamentProfile, JSON.stringify({
        type: 'filament', filament_type: ['PLA'],
        filament_diameter: ['1.75'], filament_density: ['1.24']
    }));
    const common = { technology: 'FDM', layerHeight: 0.2, infillPercentage: '20%', material: 'PLA',
        outputCandidate: 'candidate', processableFile: 'model.stl',
        effectiveModelInfo: { height_mm: 1 }, workspace, signal };
    const prusaResult = await runSlicerAndParseStats({ ...common, engine: 'prusa', baseConfigFile: 'profile.ini',
        orcaMachineConfigFile: null, slicerOutputPath: path.join(root, 'prusa.gcode'), engineOutputDir: null });
    const orcaResult = await runSlicerAndParseStats({ ...common, engine: 'orca', baseConfigFile: 'process.json',
        orcaMachineConfigFile: 'machine.json', orcaFilamentConfigFile: filamentProfile,
        slicerOutputPath: path.join(root, 'orca', 'result.gcode'),
        engineOutputDir: path.join(root, 'orca') });
    const orcaManualResult = await runSlicerAndParseStats({
        ...common,
        engine: 'orca',
        material: 'ABS',
        baseConfigFile: 'process.json',
        orcaMachineConfigFile: 'machine.json',
        orcaFilamentConfigFile: null,
        slicerOutputPath: path.join(root, 'orca-manual', 'result.gcode'),
        engineOutputDir: path.join(root, 'orca-manual')
    });
    assert.equal(prusaResult.effectiveProfileSha256, 'a'.repeat(64));
    assert.equal(orcaResult.effectiveProfileSha256, 'a'.repeat(64));
    assert.equal(orcaManualResult.effectiveProfileSha256, 'a'.repeat(64));
    assert.equal(prusaResult.engineVersion, '2.8.1');
    assert.equal(orcaResult.engineVersion, '2.3.1');
    assert.equal(orcaManualResult.filamentProfileMetadata, null);
    const expectedPrusa = [...buildSlicerCommandArgs('FDM', 'profile.ini', path.join(root, 'prusa.gcode'), '20%', 'prusa'), 'model.stl'];
    const expectedOrca = [...buildSlicerCommandArgs(
        'FDM', 'process.json', path.join(root, 'orca', 'result.gcode'), '20%',
        'orca', 'machine.json', filamentProfile
    ), 'model.stl'];
    const expectedOrcaManual = [...buildSlicerCommandArgs(
        'FDM', 'process.json', path.join(root, 'orca-manual', 'result.gcode'), '20%',
        'orca', 'machine.json', null
    ), 'model.stl'];
    assert.deepEqual(calls.map(({ executable, args }) => [executable, args]), [
        ['prusa-slicer', expectedPrusa],
        ['orca-slicer', expectedOrca],
        ['orca-slicer', expectedOrcaManual]
    ]);
    assert.deepEqual(parseCalls.map((args) => [args[4], args[5]]), [
        ['prusa', { requireFilamentGrams: false }],
        ['orca', { requireFilamentGrams: true }],
        ['orca', { requireFilamentGrams: false }]
    ]);
    assert.ok(calls.every((call) => call.signal === signal));
});
