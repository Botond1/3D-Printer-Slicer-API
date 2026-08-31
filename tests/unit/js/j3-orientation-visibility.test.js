'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const {
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix,
    multiplyRotationMatrices,
    parseOrientationMetadata,
    rotationMatrixFromEulerDegrees,
    rotationMatrixToEulerDegrees,
    validateRotationMatrix
} = require('../../../app/services/slice/orientation-contract');
const { applyTransformAndValidateModel } = require('../../../app/services/slice/transform');
const { buildSliceSuccessResponse } = require('../../../app/services/slice/response');
const { createMeasuredModelMeasurement } = require('../../../app/services/slice/model-stats');

const IDENTITY = identityRotationMatrix();
const RX_90 = [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0]
];
const RY_90 = [
    [0, 0, 1],
    [0, 1, 0],
    [-1, 0, 0]
];
const RZ_90 = [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1]
];
const TOTAL_RZ_RX = [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0]
];
const TRANSFORM_KEYS = [
    'automatic_orientation_applied',
    'automatic_rotation_deg',
    'automatic_rotation_matrix',
    'final_dimensions_mm',
    'keep_proportions',
    'orientation_mode',
    'orientation_outcome',
    'oriented_dimensions_mm',
    'original_dimensions_available',
    'original_dimensions_mm',
    'requested_rotation_deg',
    'requested_size',
    'rotation_deg',
    'rotation_matrix',
    'scale_factors',
    'scale_percent',
    'size_unit',
    'transform_schema'
].sort();

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
    predictedSizeMm: Object.freeze({ x: 20, y: 255, z: 255 })
});
const P1S_LIMITS = Object.freeze({
    min: Object.freeze({ x: 1, y: 1, z: 1 }),
    max: Object.freeze({ x: 256, y: 256, z: 250 }),
    sourceProfile: 'Bambu_P1S_0.4_nozzle.json'
});
const INERT_WORKSPACE = Object.freeze({
    assertContainedPath(candidate) { return candidate; }
});

function assertMatrixClose(actual, expected, tolerance = 1e-8) {
    assert.equal(actual.length, 3);
    for (let row = 0; row < 3; row += 1) {
        assert.equal(actual[row].length, 3);
        for (let column = 0; column < 3; column += 1) {
            assert.ok(
                Math.abs(actual[row][column] - expected[row][column]) <= tolerance,
                `matrix[${row}][${column}]: ${actual[row][column]} != ${expected[row][column]}`
            );
        }
    }
}

function rotateBounds(dimensions, matrix) {
    const points = [];
    for (const x of [0, dimensions.x]) {
        for (const y of [0, dimensions.y]) {
            for (const z of [0, dimensions.z]) {
                points.push(matrix.map((row) => (
                    (row[0] * x) + (row[1] * y) + (row[2] * z)
                )));
            }
        }
    }
    return ['x', 'y', 'z'].reduce((result, axis, index) => {
        const values = points.map((point) => point[index]);
        result[axis] = Math.max(...values) - Math.min(...values);
        return result;
    }, {});
}

function buildContract({
    orientation = createOrientationState('auto', 'applied', RX_90),
    rotationDeg = { x: 0, y: 0, z: 90 },
    original = { x: 20, y: 240, z: 245 },
    oriented = { x: 20, y: 245, z: 240 },
    final = { x: 245, y: 20, z: 240 }
} = {}) {
    return buildModelTransformContract({
        transformOptions: {
            ...NO_TRANSFORM_OPTIONS,
            rotationDeg
        },
        transformPlan: {
            ...NO_TRANSFORM_PLAN,
            rotationDeg,
            predictedSizeMm: { ...oriented }
        },
        orientation,
        originalModelMeasurement: createMeasuredModelMeasurement(original),
        orientedModelMeasurement: createMeasuredModelMeasurement(oriented),
        finalModelMeasurement: createMeasuredModelMeasurement(final)
    });
}

test('rotation matrices reject malformed, non-finite, non-orthogonal, and reflected input', () => {
    assert.deepEqual(validateRotationMatrix(IDENTITY), IDENTITY);
    assert.deepEqual(validateRotationMatrix(RX_90), RX_90);

    for (const candidate of [
        null,
        [[1, 0], [0, 1]],
        [[1, 0, 0], [0, 1, 0], [0, 0]],
        [[1, 0, 0], [0, Number.NaN, 0], [0, 0, 1]],
        [[1, 0, 0], [0, Number.POSITIVE_INFINITY, 0], [0, 0, 1]],
        [[1, 0, 0], [0, 1, 0], [0.5, 0, 1]],
        [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[1.01, 0, 0], [0, 1, 0], [0, 0, 1]]
    ]) {
        assert.throws(() => validateRotationMatrix(candidate));
    }
});

test('authoritative composition is requested Rz*Ry*Rx after automatic rotation', () => {
    assertMatrixClose(rotationMatrixFromEulerDegrees({ x: 90, y: 0, z: 0 }), RX_90);
    assertMatrixClose(rotationMatrixFromEulerDegrees({ x: 0, y: 0, z: 90 }), RZ_90);
    assertMatrixClose(multiplyRotationMatrices(RZ_90, RX_90), TOTAL_RZ_RX);

    const original = { x: 20, y: 240, z: 245 };
    assert.deepEqual(rotateBounds(original, RX_90), { x: 20, y: 245, z: 240 });
    assert.deepEqual(rotateBounds(original, TOTAL_RZ_RX), { x: 245, y: 20, z: 240 });

    const contract = buildContract();
    assertMatrixClose(contract.automatic_rotation_matrix, RX_90);
    assertMatrixClose(contract.rotation_matrix, TOTAL_RZ_RX);
    assert.deepEqual(contract.original_dimensions_mm, original);
    assert.deepEqual(contract.oriented_dimensions_mm, { x: 20, y: 245, z: 240 });
    assert.deepEqual(contract.final_dimensions_mm, { x: 245, y: 20, z: 240 });
});

test('Euler conversion round-trips regular and positive/negative gimbal-lock rotations', () => {
    for (const rotation of [
        { x: 35, y: 25, z: -20 },
        { x: 35, y: 90, z: -20 },
        { x: -15, y: -90, z: 40 },
        { x: 360, y: -720, z: 0 }
    ]) {
        const matrix = rotationMatrixFromEulerDegrees(rotation);
        const canonicalEuler = rotationMatrixToEulerDegrees(matrix);
        assertMatrixClose(rotationMatrixFromEulerDegrees(canonicalEuler), matrix, 1e-7);
        assert.ok(Object.values(canonicalEuler).every(Number.isFinite));
    }
});

test('orientation state enforces the accepted mode/outcome/matrix truth table', () => {
    const cases = [
        ['auto', 'applied', RX_90, true],
        ['auto', 'unchanged', IDENTITY, false],
        ['auto', 'fallback_unmodified', IDENTITY, false],
        ['preserve', 'preserved', IDENTITY, false]
    ];
    for (const [mode, outcome, matrix, applied] of cases) {
        const state = createOrientationState(mode, outcome, matrix);
        assert.equal(state.mode, mode);
        assert.equal(state.outcome, outcome);
        assert.equal(state.automaticOrientationApplied, applied);
        assert.deepEqual(state.automaticRotationMatrix, matrix);
        assert.equal(Object.isFrozen(state), true);
    }

    for (const args of [
        ['auto', 'applied', IDENTITY],
        ['auto', 'unchanged', RX_90],
        ['auto', 'fallback_unmodified', RX_90],
        ['preserve', 'preserved', RX_90],
        ['preserve', 'applied', RX_90],
        ['preserve', 'unchanged', IDENTITY]
    ]) {
        assert.throws(() => createOrientationState(...args), /inconsistent|Unsupported/);
    }
});

test('sidecar metadata parser accepts only the exact schema, mode, outcome, and proper matrix', () => {
    const parse = (orientation_mode, orientation_outcome, rotation_matrix) => parseOrientationMetadata({
        orientation_metadata_schema: 1,
        orientation_mode,
        orientation_outcome,
        rotation_matrix
    }, orientation_mode);

    assert.equal(parse('auto', 'applied', RY_90).automaticOrientationApplied, true);
    assert.equal(parse('auto', 'unchanged', IDENTITY).outcome, 'unchanged');
    assert.equal(parse('auto', 'fallback_unmodified', IDENTITY).outcome, 'fallback_unmodified');
    assert.equal(parse('preserve', 'preserved', IDENTITY).outcome, 'preserved');

    const valid = {
        orientation_metadata_schema: 1,
        orientation_mode: 'auto',
        orientation_outcome: 'unchanged',
        rotation_matrix: IDENTITY
    };
    for (const candidate of [
        null,
        [],
        { ...valid, extra: true },
        { ...valid, orientation_metadata_schema: 2 },
        { ...valid, orientation_mode: 'AUTO' },
        { ...valid, orientation_outcome: 'applied' },
        { ...valid, rotation_matrix: RX_90, orientation_outcome: 'unchanged' },
        { ...valid, rotation_matrix: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] }
    ]) {
        assert.throws(() => parseOrientationMetadata(candidate, 'auto'));
    }
    assert.throws(() => parseOrientationMetadata(valid, 'preserve'), /does not match/);
});

test('K1 model_transform exposes the exact versioned visibility contract', () => {
    const contract = buildContract();
    assert.deepEqual(Object.keys(contract).sort(), TRANSFORM_KEYS);
    assert.equal(contract.transform_schema, 2);
    assert.equal(contract.original_dimensions_available, true);
    assert.equal(contract.orientation_mode, 'auto');
    assert.equal(contract.orientation_outcome, 'applied');
    assert.equal(contract.automatic_orientation_applied, true);
    assert.deepEqual(contract.automatic_rotation_deg, { x: 90, y: 0, z: 0 });
    assert.deepEqual(contract.requested_rotation_deg, { x: 0, y: 0, z: 90 });
    assert.deepEqual(contract.rotation_deg, { x: 90, y: 0, z: 90 });
    assertMatrixClose(contract.automatic_rotation_matrix, RX_90);
    assertMatrixClose(contract.rotation_matrix, TOTAL_RZ_RX);
});

test('K2 preserve bounds failure carries the same complete model_transform contract', async () => {
    const dimensions = { x: 20, y: 255, z: 255, height_mm: 255 };
    const orientation = createOrientationState('preserve', 'preserved', IDENTITY);
    const result = await applyTransformAndValidateModel(
        'model.stl',
        dimensions,
        NO_TRANSFORM_OPTIONS,
        P1S_LIMITS,
        INERT_WORKSPACE,
        undefined,
        {
            orientation,
            originalModelInfo: dimensions,
            orientedModelInfo: dimensions
        }
    );

    assert.equal(result.isValid, false);
    assert.equal(result.status, 422);
    assert.equal(result.response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(result.response.model_dimensions_mm, { x: 20, y: 255, z: 255 });
    assert.deepEqual(result.response.build_volume_limits_mm, {
        min: P1S_LIMITS.min,
        max: P1S_LIMITS.max,
        source_profile: P1S_LIMITS.sourceProfile
    });
    assert.deepEqual(Object.keys(result.response.model_transform).sort(), TRANSFORM_KEYS);
    assert.deepEqual(result.response.model_transform, buildModelTransformContract({
        transformOptions: NO_TRANSFORM_OPTIONS,
        transformPlan: { ...NO_TRANSFORM_PLAN, predictedSizeMm: { x: 20, y: 255, z: 255 } },
        orientation,
        originalModelMeasurement: createMeasuredModelMeasurement(dimensions),
        orientedModelMeasurement: createMeasuredModelMeasurement(dimensions),
        finalModelMeasurement: createMeasuredModelMeasurement(dimensions)
    }));
});

test('20x255x255 auto orientation fits P1S while preserving submitted dimensions', async () => {
    const original = { x: 20, y: 255, z: 255, height_mm: 255 };
    const oriented = { x: 255, y: 255, z: 20, height_mm: 20 };
    const result = await applyTransformAndValidateModel(
        'oriented.stl',
        oriented,
        NO_TRANSFORM_OPTIONS,
        P1S_LIMITS,
        INERT_WORKSPACE,
        undefined,
        {
            orientation: createOrientationState('auto', 'applied', RY_90),
            originalModelInfo: original,
            orientedModelInfo: oriented
        }
    );

    assert.equal(result.isValid, true);
    assert.deepEqual(result.modelTransform.original_dimensions_mm, { x: 20, y: 255, z: 255 });
    assert.deepEqual(result.modelTransform.oriented_dimensions_mm, { x: 255, y: 255, z: 20 });
    assert.deepEqual(result.modelTransform.final_dimensions_mm, { x: 255, y: 255, z: 20 });
    assert.equal(result.modelTransform.orientation_outcome, 'applied');
});

test('success response enforces object_height_mm === final_dimensions_mm.z', () => {
    const modelTransform = buildContract({
        orientation: createOrientationState('preserve', 'preserved', IDENTITY),
        rotationDeg: { x: 0, y: 0, z: 0 },
        original: { x: 20, y: 240, z: 245 },
        oriented: { x: 20, y: 240, z: 245 },
        final: { x: 20, y: 240, z: 245 }
    });
    const context = {
        engine: 'prusa',
        technology: 'FDM',
        material: 'PLA',
        infillPercentage: '20%',
        baseConfigFile: path.join('selected', 'FDM_0.2mm.ini'),
        orcaMachineConfigFile: null,
        orcaFilamentConfigFile: null,
        filamentProfileMetadata: null,
        effectiveProfileSha256: 'a'.repeat(64),
        engineVersion: '2.8.1',
        modelTransform,
        buildVolumeLimits: {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 256, y: 256, z: 250 },
            sourceProfile: 'FDM_0.2mm.ini'
        },
        stats: {
            print_time_seconds: 60,
            print_time_readable: '1m',
            material_used_m: 1,
            material_used_g: null,
            object_height_mm: 245
        },
        jobId: 'job-id',
        artifactId: 'artifact-id'
    };

    const response = buildSliceSuccessResponse(context);
    assert.equal(response.stats.object_height_mm, response.model_transform.final_dimensions_mm.z);
    assert.deepEqual(response.model_transform, modelTransform);

    assert.throws(
        () => buildSliceSuccessResponse({
            ...context,
            stats: { ...context.stats, object_height_mm: 244.999 }
        }),
        (error) => error.code === 'INVALID_SLICE_STATS'
    );
});
