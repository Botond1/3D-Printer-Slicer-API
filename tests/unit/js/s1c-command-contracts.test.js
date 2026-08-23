'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const actualCommand = require(COMMAND_PATH);
const { createChildEnvironment } = require('../../../app/services/slice/child-environment');
const { APPLICATION_ROOT, resolvePythonHelper } = require('../../../app/services/slice/helper-paths');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('../../../app/services/slice/engine');

function installCommandMock(runCommand) {
    const paths = [COMMAND_PATH, PYTHON_PATH, INPUT_PATH, MODEL_PATH, TRANSFORM_PATH, OUTPUT_PATH, PROFILES_PATH];
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
    for (const modulePath of [INPUT_PATH, MODEL_PATH, TRANSFORM_PATH, OUTPUT_PATH]) delete require.cache[modulePath];
    return () => {
        for (const [modulePath, original] of originalModules) {
            if (original) require.cache[modulePath] = original;
            else delete require.cache[modulePath];
        }
    };
}

function restoreEnvironment(snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

test('minimal environment passes runtime essentials and excludes secret/application variables', () => {
    const source = {
        PATH: 'runtime-path', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
        PATHEXT: '.EXE', TEMP: 'C:\\Temp', TMP: 'C:\\Tmp', LANG: 'C.UTF-8',
        ADMIN_API_KEY: String(41), SLICE_SERVICE_API_KEY: String(42),
        SECRET_MARKER: String(43), DATABASE_URL: String(44),
        CLOUD_API_KEY: String(45), TELEGRAM_BOT_TOKEN: String(46), EMAIL_API_KEY: String(47),
        SLICE_RATE_LIMIT_MAX_REQUESTS: String(48), NODE_OPTIONS: '--inspect', PYTHONPATH: 'unsafe'
    };
    const env = createChildEnvironment(source, 'win32');
    assert.deepEqual(env, {
        PATH: 'runtime-path', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
        PATHEXT: '.EXE', TEMP: 'C:\\Temp', TMP: 'C:\\Tmp', LANG: 'C.UTF-8',
        PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
        PYTHONUNBUFFERED: '1', PYTHONUTF8: '1'
    });
    for (const key of ['ADMIN_API_KEY', 'SLICE_SERVICE_API_KEY', 'SECRET_MARKER',
        'DATABASE_URL', 'CLOUD_API_KEY',
        'TELEGRAM_BOT_TOKEN', 'EMAIL_API_KEY', 'SLICE_RATE_LIMIT_MAX_REQUESTS',
        'NODE_OPTIONS', 'PYTHONPATH']) assert.equal(env[key], undefined, key);
});

test('POSIX child environment uses fixed writable homes and never inherits parent HOME/XDG paths', () => {
    const env = createChildEnvironment({
        PATH: '/usr/bin',
        TMPDIR: '/tmp',
        HOME: '/secret/home',
        XDG_CACHE_HOME: '/secret/cache',
        XDG_CONFIG_HOME: '/secret/config',
        XDG_RUNTIME_DIR: '/secret/runtime'
    }, 'linux');
    assert.deepEqual({
        TMPDIR: env.TMPDIR,
        TEMP: env.TEMP,
        TMP: env.TMP,
        HOME: env.HOME,
        XDG_CACHE_HOME: env.XDG_CACHE_HOME,
        XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
        XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR
    }, {
        TMPDIR: '/tmp',
        TEMP: '/tmp',
        TMP: '/tmp',
        HOME: '/tmp/slicer-home',
        XDG_CACHE_HOME: '/tmp/xdg-cache',
        XDG_CONFIG_HOME: '/tmp/xdg-config',
        XDG_RUNTIME_DIR: '/tmp/xdg-runtime'
    });
});

test('POSIX child environment rejects arbitrary, normalized, relative, and NUL TMPDIR authorities', () => {
    for (const candidate of ['/app/output', '/etc', '/tmp/../etc', '../../secret', '/tmp\0/escape']) {
        const env = createChildEnvironment({ TMPDIR: candidate, HOME: '/secret/home' }, 'linux');
        assert.equal(env.TMPDIR, '/tmp', candidate);
        assert.equal(env.HOME, '/tmp/slicer-home', candidate);
    }
});

test('real child sees required allowlist values but no inert secret markers', async () => {
    const keys = ['ADMIN_API_KEY', 'SLICE_SERVICE_API_KEY', 'SECRET_MARKER', 'DATABASE_URL'];
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
        keys.forEach((key, index) => { process.env[key] = String(51 + index); });
        const { stdout } = await actualCommand.runCommand(process.execPath, ['-e', [
            "const e=process.env;process.stdout.write(JSON.stringify({",
            "path:Boolean(e.PATH),root:Boolean(e.SystemRoot||e.WINDIR),",
            "python:[e.PYTHONDONTWRITEBYTECODE,e.PYTHONNOUSERSITE,e.PYTHONUNBUFFERED,e.PYTHONUTF8],",
            "leaked:['ADMIN_API_KEY','SLICE_SERVICE_API_KEY','SECRET_MARKER','DATABASE_URL'].filter(k=>k in e)}))"
        ].join('')]);
        const observed = JSON.parse(stdout);
        assert.equal(observed.path, true);
        if (process.platform === 'win32') assert.equal(observed.root, true);
        assert.deepEqual(observed.python, ['1', '1', '1', '1']);
        assert.deepEqual(observed.leaked, []);
    } finally {
        restoreEnvironment(original);
    }
});

test('helper resolution is absolute, allowlisted, cwd-independent, and Docker-layout compatible', () => {
    const originalCwd = process.cwd();
    process.chdir(os.tmpdir());
    try {
        for (const name of ['mesh2stl.py', 'cad2stl.py', 'orient.py', 'scale_model.py']) {
            assert.equal(resolvePythonHelper(name), path.join(APPLICATION_ROOT, name));
            assert.equal(path.isAbsolute(resolvePythonHelper(name)), true);
        }
        assert.throws(() => resolvePythonHelper('../other.py'), /Unknown Python/);
    } finally {
        process.chdir(originalCwd);
    }
    const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert.match(docker, /WORKDIR \/app/);
    assert.match(docker, /COPY --chown=0:0 app\/ \.\//);
    assert.equal(path.posix.resolve('/app/services/slice', '../..'), '/app');
});

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
    assert.equal(resolveSlicerExecutable('prusa'), 'prusa-slicer');
    assert.deepEqual(prusa, ['--load', 'profile.ini', '--center', '100,100', '--support-material',
        '--support-material-auto', '--gcode-flavor', 'marlin', '--export-gcode', '--output',
        'out.gcode', '--fill-density', '20%']);
    const orca = buildSlicerCommandArgs('FDM', 'process.json', path.join('stage', 'result.gcode'), '20%', 'orca', 'machine.json');
    assert.equal(resolveSlicerExecutable('orca'), 'orca-slicer');
    assert.deepEqual(orca, ['--load-settings', 'machine.json;process.json', '--arrange', '1',
        '--orient', '1', '--slice', '0', '--outputdir', 'stage']);
});

test('Prusa and Orca execution append only the processable model to exact engine arrays', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 's1c-slicer-args-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const calls = [];
    const restoreModules = installCommandMock(async (executable, args, options) => {
        calls.push({ executable, args: [...args], signal: options.signal });
        const target = executable === 'orca-slicer'
            ? path.join(root, 'orca', 'actual.gcode') : path.join(root, 'prusa.gcode');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, '; generated');
        return { stdout: '', stderr: '' };
    });
    t.after(restoreModules);
    require.cache[MODEL_PATH] = {
        id: MODEL_PATH, filename: MODEL_PATH, loaded: true,
        exports: { parseOutputDetailed: async () => ({ print_time_seconds: 1 }) }
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
    const common = { technology: 'FDM', layerHeight: 0.2, infillPercentage: '20%',
        outputCandidate: 'candidate', processableFile: 'model.stl',
        effectiveModelInfo: { height_mm: 1 }, workspace, signal };
    await runSlicerAndParseStats({ ...common, engine: 'prusa', baseConfigFile: 'profile.ini',
        orcaMachineConfigFile: null, slicerOutputPath: path.join(root, 'prusa.gcode'), engineOutputDir: null });
    await runSlicerAndParseStats({ ...common, engine: 'orca', baseConfigFile: 'process.json',
        orcaMachineConfigFile: 'machine.json', slicerOutputPath: path.join(root, 'orca', 'result.gcode'),
        engineOutputDir: path.join(root, 'orca') });
    const expectedPrusa = [...buildSlicerCommandArgs('FDM', 'profile.ini', path.join(root, 'prusa.gcode'), '20%', 'prusa'), 'model.stl'];
    const expectedOrca = [...buildSlicerCommandArgs('FDM', 'process.json', path.join(root, 'orca', 'result.gcode'), '20%', 'orca', 'machine.json'), 'model.stl'];
    assert.deepEqual(calls.map(({ executable, args }) => [executable, args]), [
        ['prusa-slicer', expectedPrusa], ['orca-slicer', expectedOrca]
    ]);
    assert.ok(calls.every((call) => call.signal === signal));
});
