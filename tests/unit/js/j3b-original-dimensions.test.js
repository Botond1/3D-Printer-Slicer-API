'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const COMMAND_PATH = require.resolve('../../../app/services/slice/command');
const INPUT_PROCESSING_PATH = require.resolve('../../../app/services/slice/input-processing');
const MODEL_STATS_PATH = require.resolve('../../../app/services/slice/model-stats');
const PIPELINE_PATH = require.resolve('../../../app/services/slice/pipeline');
const TRANSFORM_PATH = require.resolve('../../../app/services/slice/transform');

const modelStats = require(MODEL_STATS_PATH);
const {
    createMeasuredModelMeasurement,
    createUnavailableModelMeasurement
} = modelStats;
const {
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix
} = require('../../../app/services/slice/orientation-contract');
const { buildSliceSuccessResponse } = require('../../../app/services/slice/response');

const NO_TRANSFORM_OPTIONS = Object.freeze({
    unit: 'mm',
    keepProportions: true,
    requestedTargetSize: Object.freeze({ x: null, y: null, z: null }),
    targetSizeMm: Object.freeze({ x: null, y: null, z: null }),
    scalePercent: null,
    rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 })
});
const NO_TRANSFORM_PLAN = Object.freeze({
    requiresTransform: false,
    scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 }),
    requestedUnit: 'mm',
    keepProportions: true,
    requestedTargetSize: Object.freeze({ x: null, y: null, z: null }),
    predictedSizeMm: Object.freeze({ x: 20, y: 30, z: 40 })
});
const LIMITS = Object.freeze({
    min: Object.freeze({ x: 1, y: 1, z: 1 }),
    max: Object.freeze({ x: 256, y: 256, z: 250 }),
    sourceProfile: 'test-profile.json'
});
const WORKSPACE = Object.freeze({
    assertContainedPath(candidate) { return candidate; }
});
const PRESERVED = createOrientationState('preserve', 'preserved', identityRotationMatrix());

function replaceModule(modulePath, exportsValue) {
    const previous = require.cache[modulePath];
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports: exportsValue
    };
    return () => {
        if (previous) require.cache[modulePath] = previous;
        else delete require.cache[modulePath];
    };
}

function loadModelStatsWithCommand(runCommand) {
    const command = require(COMMAND_PATH);
    const restoreCommand = replaceModule(COMMAND_PATH, { ...command, runCommand });
    const previousModelStats = require.cache[MODEL_STATS_PATH];
    delete require.cache[MODEL_STATS_PATH];
    try {
        return require(MODEL_STATS_PATH);
    } finally {
        if (previousModelStats) require.cache[MODEL_STATS_PATH] = previousModelStats;
        else delete require.cache[MODEL_STATS_PATH];
        restoreCommand();
    }
}

function buildContract(originalModelMeasurement) {
    const positive = createMeasuredModelMeasurement({ x: 20, y: 30, z: 40, height_mm: 40 });
    return buildModelTransformContract({
        transformOptions: NO_TRANSFORM_OPTIONS,
        transformPlan: NO_TRANSFORM_PLAN,
        orientation: PRESERVED,
        originalModelMeasurement,
        orientedModelMeasurement: positive,
        finalModelMeasurement: positive
    });
}

test('getModelInfo distinguishes unavailable, incomplete, and measured-zero outcomes', async () => {
    const failed = loadModelStatsWithCommand(async () => {
        throw new Error('native info unavailable');
    });
    assert.deepEqual(await failed.getModelInfo('model.stl'), {
        status: 'unavailable',
        modelInfo: null
    });

    const incomplete = loadModelStatsWithCommand(async () => ({
        stdout: 'size_x = 10\nsize_y = 20\n',
        stderr: ''
    }));
    assert.deepEqual(await incomplete.getModelInfo('model.stl'), {
        status: 'unavailable',
        modelInfo: null
    });

    const measuredZero = loadModelStatsWithCommand(async () => ({
        stdout: 'size_x = 0\nsize_y = 0\nsize_z = 0\n',
        stderr: ''
    }));
    assert.deepEqual(await measuredZero.getModelInfo('model.stl'), {
        status: 'measured',
        modelInfo: { x: 0, y: 0, z: 0, height_mm: 0, volume_mm3: null }
    });
});

test('getModelInfo preserves abort propagation instead of degrading it to unavailable', async () => {
    const controller = new AbortController();
    const reason = new Error('request aborted');
    controller.abort(reason);
    const measured = loadModelStatsWithCommand(async () => {
        throw new Error('must not run');
    });
    await assert.rejects(measured.getModelInfo('model.stl', controller.signal), (error) => error === reason);
});

test('transform schema 2 exposes a truthful measured-or-null original dimension contract', () => {
    const measured = buildContract(createMeasuredModelMeasurement({
        x: 20, y: 30, z: 40, height_mm: 40
    }));
    assert.equal(measured.transform_schema, 2);
    assert.equal(measured.original_dimensions_available, true);
    assert.deepEqual(measured.original_dimensions_mm, { x: 20, y: 30, z: 40 });

    const unavailable = buildContract(createUnavailableModelMeasurement());
    assert.equal(unavailable.transform_schema, 2);
    assert.equal(unavailable.original_dimensions_available, false);
    assert.equal(unavailable.original_dimensions_mm, null);

    const measuredZero = buildContract(createMeasuredModelMeasurement({
        x: 0, y: 30, z: 40, height_mm: 40
    }));
    assert.equal(measuredZero.original_dimensions_available, true);
    assert.deepEqual(measuredZero.original_dimensions_mm, { x: 0, y: 30, z: 40 });
});

test('success response refuses inconsistent schema-2 original availability and keeps the height gate', () => {
    const transform = buildContract(createUnavailableModelMeasurement());
    assert.throws(
        () => buildSliceSuccessResponse({
            modelTransform: {
                ...transform,
                original_dimensions_available: true
            },
            stats: { object_height_mm: 40 }
        }),
        /availability is inconsistent/
    );
    for (const invalidDimensions of [
        {},
        { x: -1, y: 30, z: 40 },
        { x: 20, y: 30, z: 40, extra: 1 }
    ]) {
        assert.throws(
            () => buildSliceSuccessResponse({
                modelTransform: {
                    ...transform,
                    original_dimensions_available: true,
                    original_dimensions_mm: invalidDimensions
                },
                stats: { object_height_mm: 40 }
            }),
            /availability is inconsistent/
        );
    }
    assert.throws(
        () => buildSliceSuccessResponse({
            modelTransform: {
                ...transform,
                original_dimensions_available: false,
                original_dimensions_mm: { x: 20, y: 30, z: 40 }
            },
            stats: { object_height_mm: 40 }
        }),
        /availability is inconsistent/
    );
    assert.throws(
        () => buildSliceSuccessResponse({
            modelTransform: transform,
            stats: { object_height_mm: 39.999 }
        }),
        (error) => error.code === 'INVALID_SLICE_STATS'
    );
});

test('applyTransform direct compatibility measures only complete raw objects', async () => {
    const { applyTransformAndValidateModel } = require(TRANSFORM_PATH);
    const positive = await applyTransformAndValidateModel(
        'model.stl',
        { x: 20, y: 30, z: 40, height_mm: 40 },
        NO_TRANSFORM_OPTIONS,
        LIMITS,
        WORKSPACE
    );
    assert.equal(positive.isValid, true);
    assert.equal(positive.modelTransform.original_dimensions_available, true);
    assert.deepEqual(positive.modelTransform.original_dimensions_mm, { x: 20, y: 30, z: 40 });

    for (const candidate of [
        { x: 0, y: 30, z: 40, height_mm: 40 },
        { x: 20, y: 30 },
        null,
        { x: 20, y: 30, z: 40, height_mm: Number.NaN },
        {
            status: 'measured',
            modelInfo: { x: 20, y: 30, z: 40 }
        },
        {
            status: 'measured',
            modelInfo: { x: 20, y: 30, z: 40, height_mm: Number.NaN }
        },
        {
            status: 'measured',
            modelInfo: { x: 20, y: 30, z: 40, height_mm: -1 }
        },
        {
            status: 'measured',
            modelInfo: { x: 20, y: 30, z: 40, height_mm: 39 }
        }
    ]) {
        const rejected = await applyTransformAndValidateModel(
            'model.stl', candidate, NO_TRANSFORM_OPTIONS, LIMITS, WORKSPACE
        );
        assert.equal(rejected.isValid, false);
        assert.equal(rejected.status, 422);
        assert.equal(rejected.response.errorCode, 'MODEL_DIMENSIONS_UNAVAILABLE');
        assert.equal(Object.hasOwn(rejected.response, 'model_transform'), false);
    }
});

test('measured-state factory enforces the canonical height-equals-z invariant', () => {
    for (const height of [Number.NaN, -1, 39]) {
        assert.throws(
            () => createMeasuredModelMeasurement({
                x: 20, y: 30, z: 40, height_mm: height
            }),
            /Measured model information is invalid/
        );
    }
    assert.deepEqual(
        createMeasuredModelMeasurement({ x: 20, y: 30, z: 40 }),
        {
            status: 'measured',
            modelInfo: { x: 20, y: 30, z: 40, height_mm: 40, volume_mm3: null }
        }
    );
});

test('unavailable original remains non-fatal and is never replaced by oriented dimensions', async () => {
    const { applyTransformAndValidateModel } = require(TRANSFORM_PATH);
    const oriented = createMeasuredModelMeasurement({ x: 20, y: 30, z: 40, height_mm: 40 });
    const accepted = await applyTransformAndValidateModel(
        'model.stl',
        oriented,
        NO_TRANSFORM_OPTIONS,
        LIMITS,
        WORKSPACE,
        undefined,
        {
            orientation: PRESERVED,
            originalModelMeasurement: createUnavailableModelMeasurement()
        }
    );
    assert.equal(accepted.isValid, true);
    assert.equal(accepted.modelTransform.original_dimensions_available, false);
    assert.equal(accepted.modelTransform.original_dimensions_mm, null);
    assert.deepEqual(accepted.modelTransform.oriented_dimensions_mm, { x: 20, y: 30, z: 40 });

    const outside = createMeasuredModelMeasurement({ x: 300, y: 30, z: 40, height_mm: 40 });
    const rejected = await applyTransformAndValidateModel(
        'model.stl',
        outside,
        NO_TRANSFORM_OPTIONS,
        LIMITS,
        WORKSPACE,
        undefined,
        {
            orientation: PRESERVED,
            originalModelMeasurement: createUnavailableModelMeasurement()
        }
    );
    assert.equal(rejected.response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.equal(rejected.response.model_transform.transform_schema, 2);
    assert.equal(rejected.response.model_transform.original_dimensions_available, false);
    assert.equal(rejected.response.model_transform.original_dimensions_mm, null);
});

test('malformed tagged original measurement degrades to unavailable instead of throwing', async () => {
    const { applyTransformAndValidateModel } = require(TRANSFORM_PATH);
    const oriented = createMeasuredModelMeasurement({ x: 20, y: 30, z: 40, height_mm: 40 });
    const accepted = await applyTransformAndValidateModel(
        'model.stl',
        oriented,
        NO_TRANSFORM_OPTIONS,
        LIMITS,
        WORKSPACE,
        undefined,
        {
            orientation: PRESERVED,
            originalModelMeasurement: {
                status: 'measured',
                modelInfo: { x: 20, y: 30, z: 40 }
            }
        }
    );
    assert.equal(accepted.isValid, true);
    assert.equal(accepted.modelTransform.original_dimensions_available, false);
    assert.equal(accepted.modelTransform.original_dimensions_mm, null);
});

test('pre-orientation measurement failure does not stop a later measured oriented model', async (t) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j3b-pipeline-'));
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const inputPath = path.join(temporaryRoot, 'input.stl');
    const orientedPath = path.join(temporaryRoot, 'input_oriented.stl');
    fs.writeFileSync(inputPath, 'input');
    fs.writeFileSync(orientedPath, 'oriented');
    const measurements = [
        createUnavailableModelMeasurement(),
        createMeasuredModelMeasurement({ x: 20, y: 30, z: 40, height_mm: 40 })
    ];
    const restoreModelStats = replaceModule(MODEL_STATS_PATH, {
        ...modelStats,
        getModelInfo: async () => measurements.shift()
    });
    const restoreInputProcessing = replaceModule(INPUT_PROCESSING_PATH, {
        convertInputToStl: async () => inputPath,
        tryOptimizeOrientation: async () => ({
            processableFile: orientedPath,
            orientation: PRESERVED
        })
    });
    const previousPipeline = require.cache[PIPELINE_PATH];
    delete require.cache[PIPELINE_PATH];
    let pipeline;
    try {
        pipeline = require(PIPELINE_PATH);
    } finally {
        if (previousPipeline) require.cache[PIPELINE_PATH] = previousPipeline;
        else delete require.cache[PIPELINE_PATH];
        restoreInputProcessing();
        restoreModelStats();
    }

    const result = await pipeline.prepareProcessableModel(
        inputPath,
        'FDM',
        'auto',
        WORKSPACE
    );
    assert.deepEqual(result.originalModelMeasurement, createUnavailableModelMeasurement());
    assert.equal(result.orientedModelMeasurement.status, 'measured');
    assert.deepEqual(result.orientedModelMeasurement.modelInfo, {
        x: 20, y: 30, z: 40, height_mm: 40, volume_mm3: null
    });
});

test('unchanged orientation retries an unavailable provenance read for load-bearing dimensions', async (t) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j3b-pipeline-retry-'));
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const inputPath = path.join(temporaryRoot, 'input.stl');
    fs.writeFileSync(inputPath, 'input');
    const measurements = [
        createUnavailableModelMeasurement(),
        createMeasuredModelMeasurement({ x: 20, y: 30, z: 40, height_mm: 40 })
    ];
    const restoreModelStats = replaceModule(MODEL_STATS_PATH, {
        ...modelStats,
        getModelInfo: async () => measurements.shift()
    });
    const restoreInputProcessing = replaceModule(INPUT_PROCESSING_PATH, {
        convertInputToStl: async () => inputPath,
        tryOptimizeOrientation: async () => ({
            processableFile: inputPath,
            orientation: PRESERVED
        })
    });
    const previousPipeline = require.cache[PIPELINE_PATH];
    delete require.cache[PIPELINE_PATH];
    let pipeline;
    try {
        pipeline = require(PIPELINE_PATH);
    } finally {
        if (previousPipeline) require.cache[PIPELINE_PATH] = previousPipeline;
        else delete require.cache[PIPELINE_PATH];
        restoreInputProcessing();
        restoreModelStats();
    }

    const result = await pipeline.prepareProcessableModel(
        inputPath,
        'FDM',
        'preserve',
        WORKSPACE
    );
    assert.equal(measurements.length, 0);
    assert.deepEqual(result.originalModelMeasurement, createUnavailableModelMeasurement());
    assert.deepEqual(result.orientedModelMeasurement, createMeasuredModelMeasurement({
        x: 20, y: 30, z: 40, height_mm: 40
    }));
});

test('unavailable or malformed post-transform measurement is a controlled 422', async (t) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j3b-final-measurement-'));
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const inputPath = path.join(temporaryRoot, 'input.stl');
    fs.writeFileSync(inputPath, 'input');

    const command = require(COMMAND_PATH);
    const restoreCommand = replaceModule(COMMAND_PATH, {
        ...command,
        runCommand: async (_executable, args) => {
            fs.writeFileSync(args[2], 'transformed');
            return { stdout: '', stderr: '' };
        }
    });
    const postTransformMeasurements = [
        createUnavailableModelMeasurement(),
        {
            status: 'measured',
            modelInfo: { x: 20, y: 40, z: 30 }
        },
        {
            status: 'measured',
            modelInfo: { x: 20, y: 40, z: 30, height_mm: Number.NaN }
        },
        {
            status: 'measured',
            modelInfo: { x: 20, y: 40, z: 30, height_mm: -1 }
        }
    ];
    const restoreModelStats = replaceModule(MODEL_STATS_PATH, {
        ...modelStats,
        getModelInfo: async () => postTransformMeasurements.shift()
    });
    const previousTransform = require.cache[TRANSFORM_PATH];
    delete require.cache[TRANSFORM_PATH];
    let transform;
    try {
        transform = require(TRANSFORM_PATH);
    } finally {
        if (previousTransform) require.cache[TRANSFORM_PATH] = previousTransform;
        else delete require.cache[TRANSFORM_PATH];
        restoreModelStats();
        restoreCommand();
    }

    for (let index = 0; index < 4; index += 1) {
        const result = await transform.applyTransformAndValidateModel(
            inputPath,
            createMeasuredModelMeasurement({ x: 20, y: 30, z: 40, height_mm: 40 }),
            {
                ...NO_TRANSFORM_OPTIONS,
                rotationDeg: { x: 90, y: 0, z: 0 }
            },
            LIMITS,
            WORKSPACE,
            undefined,
            {
                orientation: PRESERVED,
                originalModelMeasurement: createUnavailableModelMeasurement()
            }
        );
        assert.equal(result.isValid, false);
        assert.equal(result.status, 422);
        assert.equal(result.response.errorCode, 'MODEL_DIMENSIONS_UNAVAILABLE');
    }
});
