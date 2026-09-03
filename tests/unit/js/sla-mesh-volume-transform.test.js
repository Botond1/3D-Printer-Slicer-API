'use strict';

/**
 * `scale_model.py` prints a final bounded `R3D_MESH_VOLUME_MM3=<value>`
 * stdout line whenever it actually runs (a real scale/rotation transform, or
 * the Bambu-only placement pass); `transform.js` parses it with a bounded
 * regex into `effectiveModelInfo.volume_mm3` without touching the existing
 * dimension logic. This is the JS side of the SLA model-volume contract that
 * feeds `stats.model_volume_ml`/`support_volume_ml`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const COMMAND_PATH = require.resolve('../../../app/services/slice/command');
const MODEL_STATS_PATH = require.resolve('../../../app/services/slice/model-stats');
const TRANSFORM_PATH = require.resolve('../../../app/services/slice/transform');

const { createMeasuredModelMeasurement } = require('../../../app/services/slice/model-stats');
const {
    createOrientationState,
    identityRotationMatrix
} = require('../../../app/services/slice/orientation-contract');

const LIMITS = Object.freeze({
    min: Object.freeze({ x: 1, y: 1, z: 1 }),
    max: Object.freeze({ x: 256, y: 256, z: 250 }),
    sourceProfile: 'test-profile.ini'
});
const ROTATING_OPTIONS = Object.freeze({
    unit: 'mm',
    keepProportions: true,
    requestedTargetSize: Object.freeze({ x: null, y: null, z: null }),
    targetSizeMm: Object.freeze({ x: null, y: null, z: null }),
    scalePercent: null,
    rotationDeg: Object.freeze({ x: 90, y: 0, z: 0 })
});
const NO_TRANSFORM_OPTIONS = Object.freeze({
    unit: 'mm',
    keepProportions: true,
    requestedTargetSize: Object.freeze({ x: null, y: null, z: null }),
    targetSizeMm: Object.freeze({ x: null, y: null, z: null }),
    scalePercent: null,
    rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 })
});
const UNCHANGED = createOrientationState('auto', 'unchanged', identityRotationMatrix());

function replaceModule(modulePath, exportsValue) {
    const previous = require.cache[modulePath];
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: exportsValue };
    return () => {
        if (previous) require.cache[modulePath] = previous;
        else delete require.cache[modulePath];
    };
}

function loadTransformWithCommand(runCommand) {
    const command = require(COMMAND_PATH);
    const restoreCommand = replaceModule(COMMAND_PATH, { ...command, runCommand });
    // model-stats.js (getModelInfo) and transform.js both cache their own
    // `require('./command')` binding at first load, so both must be forced to
    // re-require it after the mock is installed or the real prusa-slicer
    // --info call still runs and fails in this native-binary-free test env.
    const previousModelStats = require.cache[MODEL_STATS_PATH];
    const previousTransform = require.cache[TRANSFORM_PATH];
    delete require.cache[MODEL_STATS_PATH];
    delete require.cache[TRANSFORM_PATH];
    const transform = require(TRANSFORM_PATH);
    return {
        transform,
        restore: () => {
            if (previousModelStats) require.cache[MODEL_STATS_PATH] = previousModelStats;
            else delete require.cache[MODEL_STATS_PATH];
            if (previousTransform) require.cache[TRANSFORM_PATH] = previousTransform;
            else delete require.cache[TRANSFORM_PATH];
            restoreCommand();
        }
    };
}

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sla-volume-transform-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

function inertWorkspace() {
    return { assertContainedPath(candidate) { return candidate; } };
}

test('a watertight mesh volume marker is parsed into effectiveModelInfo.volume_mm3', async (t) => {
    const root = await fixture(t);
    const stl = path.join(root, 'model.stl');
    await fs.writeFile(stl, 'solid model\nendsolid model\n');
    let sawScaleModelCall = false;
    const { transform, restore } = loadTransformWithCommand(async (executable, args) => {
        if (path.basename(args[0] || '') === 'scale_model.py') {
            sawScaleModelCall = true;
            await fs.writeFile(args[2], 'solid rotated\nendsolid rotated\n');
            return { stdout: '[PYTHON SCALE] Success! Saved transformed model: x\nR3D_MESH_VOLUME_MM3=24320.5\n', stderr: '' };
        }
        return { stdout: 'size_x = 20\nsize_y = 30\nsize_z = 44\n', stderr: '' };
    });
    t.after(restore);
    const result = await transform.applyTransformAndValidateModel(
        stl,
        createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }),
        ROTATING_OPTIONS,
        LIMITS,
        inertWorkspace(),
        undefined,
        { orientation: UNCHANGED, originalModelMeasurement: createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }) }
    );
    assert.equal(sawScaleModelCall, true);
    assert.equal(result.isValid, true);
    assert.equal(result.effectiveModelInfo.volume_mm3, 24320.5);
});

test('an unavailable (non-watertight) marker yields a null volume without failing the transform', async (t) => {
    const root = await fixture(t);
    const stl = path.join(root, 'model.stl');
    await fs.writeFile(stl, 'solid model\nendsolid model\n');
    const { transform, restore } = loadTransformWithCommand(async (executable, args) => {
        if (path.basename(args[0] || '') === 'scale_model.py') {
            await fs.writeFile(args[2], 'solid rotated\nendsolid rotated\n');
            return { stdout: '[PYTHON SCALE] Success! Saved transformed model: x\nR3D_MESH_VOLUME_MM3=unavailable\n', stderr: '' };
        }
        return { stdout: 'size_x = 20\nsize_y = 30\nsize_z = 44\n', stderr: '' };
    });
    t.after(restore);
    const result = await transform.applyTransformAndValidateModel(
        stl,
        createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }),
        ROTATING_OPTIONS,
        LIMITS,
        inertWorkspace(),
        undefined,
        { orientation: UNCHANGED, originalModelMeasurement: createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }) }
    );
    assert.equal(result.isValid, true);
    assert.equal(result.effectiveModelInfo.volume_mm3, null);
});

test('a malformed or missing marker fails closed to null rather than throwing', async (t) => {
    const root = await fixture(t);
    const stl = path.join(root, 'model.stl');
    await fs.writeFile(stl, 'solid model\nendsolid model\n');
    for (const stdout of ['[PYTHON SCALE] Success!\n', '[PYTHON SCALE] Success!\nR3D_MESH_VOLUME_MM3=not-a-number\n']) {
        const { transform, restore } = loadTransformWithCommand(async (executable, args) => {
            if (path.basename(args[0] || '') === 'scale_model.py') {
                await fs.writeFile(args[2], 'solid rotated\nendsolid rotated\n');
                return { stdout, stderr: '' };
            }
            return { stdout: 'size_x = 20\nsize_y = 30\nsize_z = 44\n', stderr: '' };
        });
        try {
            const result = await transform.applyTransformAndValidateModel(
                stl,
                createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }),
                ROTATING_OPTIONS,
                LIMITS,
                inertWorkspace(),
                undefined,
                { orientation: UNCHANGED, originalModelMeasurement: createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }) }
            );
            assert.equal(result.isValid, true);
            assert.equal(result.effectiveModelInfo.volume_mm3, null);
        } finally {
            restore();
        }
    }
});

test('no scale/rotation requested never invokes scale_model.py, so volume stays null', async (t) => {
    const root = await fixture(t);
    const stl = path.join(root, 'model.stl');
    await fs.writeFile(stl, 'solid model\nendsolid model\n');
    let calls = 0;
    const { transform, restore } = loadTransformWithCommand(async () => {
        calls += 1;
        return { stdout: '', stderr: '' };
    });
    t.after(restore);
    const result = await transform.applyTransformAndValidateModel(
        stl,
        createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }),
        NO_TRANSFORM_OPTIONS,
        LIMITS,
        inertWorkspace(),
        undefined,
        { orientation: UNCHANGED, originalModelMeasurement: createMeasuredModelMeasurement({ x: 20, y: 44, z: 30 }) }
    );
    assert.equal(calls, 0);
    assert.equal(result.isValid, true);
    assert.equal(result.effectiveModelInfo.volume_mm3, null);
});
