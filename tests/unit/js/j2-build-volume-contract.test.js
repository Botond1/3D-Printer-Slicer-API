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

const {
    MAX_BUILD_VOLUMES,
    MIN_BUILD_VOLUMES
} = require('../../../app/config/constants');
const { RESOURCE_DEFINITIONS } = require('../../../app/config/resource-policy');
const {
    resolveBuildVolumeLimits,
    validateModelDimensionsAgainstLimits
} = require('../../../app/services/slice/profiles');
const { applyTransformAndValidateModel } = require('../../../app/services/slice/transform');
const {
    createOrientationState,
    identityRotationMatrix
} = require('../../../app/services/slice/orientation-contract');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PRUSA_DIR = path.join(REPO_ROOT, 'configs', 'prusa');
const ORCA_DIR = path.join(REPO_ROOT, 'configs', 'orca');

function resolvePrusaLimits(layer) {
    return resolveBuildVolumeLimits(
        'prusa',
        'FDM',
        path.join(PRUSA_DIR, `FDM_${layer}mm.ini`),
        null
    );
}

function resolveOrcaLimits(machineProfile) {
    return resolveBuildVolumeLimits(
        'orca',
        'FDM',
        path.join(ORCA_DIR, 'FDM_0.2mm.json'),
        path.join(ORCA_DIR, machineProfile)
    );
}

const NO_TRANSFORM = Object.freeze({
    unit: 'mm',
    keepProportions: true,
    requestedTargetSize: Object.freeze({ x: null, y: null, z: null }),
    targetSizeMm: Object.freeze({ x: null, y: null, z: null }),
    scalePercent: null,
    rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 })
});
const INERT_WORKSPACE = Object.freeze({
    assertContainedPath(candidate) { return candidate; }
});
const MODEL_TRANSFORM_KEYS = [
    'automatic_orientation_applied', 'automatic_rotation_deg', 'automatic_rotation_matrix',
    'final_dimensions_mm', 'keep_proportions', 'orientation_mode', 'orientation_outcome',
    'oriented_dimensions_mm', 'original_dimensions_available', 'original_dimensions_mm',
    'requested_rotation_deg',
    'requested_size', 'rotation_deg', 'rotation_matrix', 'scale_factors', 'scale_percent',
    'size_unit', 'transform_schema'
].sort();

function preserveContext(dimensions) {
    return {
        orientation: createOrientationState('preserve', 'preserved', identityRotationMatrix()),
        originalModelInfo: dimensions,
        orientedModelInfo: dimensions
    };
}

test('all shipped Prusa FDM layers keep declared P1S dimensions and enforce one inclusive ceiling', () => {
    for (const layer of ['0.1', '0.2', '0.3']) {
        const limits = resolvePrusaLimits(layer);
        assert.deepEqual(limits.declaredMax, { x: 256, y: 256, z: 250 }, layer);
        assert.deepEqual(limits.largestPassingDimensionsInclusive, {
            x: 256, y: 256, z: 249.9
        }, layer);
        assert.deepEqual(limits.max, { x: 256, y: 256, z: 249.9 }, layer);
        assert.deepEqual(limits.explicitMaxAxes, { x: true, y: true, z: true }, layer);
        assert.equal(limits.sourceProfile, `FDM_${layer}mm.ini`);
    }
});

test('W1 boundary matrix accepts 230mm Z and rejects actual Z and X/Y overflow', () => {
    for (const layer of ['0.1', '0.2', '0.3']) {
        const limits = resolvePrusaLimits(layer);
        assert.deepEqual(
            validateModelDimensionsAgainstLimits({ x: 20, y: 20, z: 230 }, limits),
            { isValid: true, dimensions: { x: 20, y: 20, z: 230 } },
            `${layer}: Z=230 must be accepted`
        );
        assert.equal(
            validateModelDimensionsAgainstLimits({ x: 256, y: 256, z: 249.9 }, limits).isValid,
            true,
            `${layer}: the conservative inclusive P1S boundary must be accepted`
        );

        const zCeilingOverflow = validateModelDimensionsAgainstLimits(
            { x: 20, y: 20, z: 250 }, limits
        );
        assert.equal(zCeilingOverflow.isValid, false, `${layer}: Z=250 must be rejected`);
        assert.deepEqual(zCeilingOverflow.tooLarge, ['Z: 250mm > 249.9mm']);

        const zOverflow = validateModelDimensionsAgainstLimits({ x: 20, y: 20, z: 251 }, limits);
        assert.equal(zOverflow.isValid, false, `${layer}: Z=251 must be rejected`);
        assert.deepEqual(zOverflow.tooLarge, ['Z: 251mm > 249.9mm']);

        const planarOverflow = validateModelDimensionsAgainstLimits({ x: 257, y: 258, z: 20 }, limits);
        assert.equal(planarOverflow.isValid, false, `${layer}: planar overflow must be rejected`);
        assert.deepEqual(planarOverflow.tooLarge, [
            'X: 257mm > 256mm',
            'Y: 258mm > 256mm'
        ]);
    }
});

test('W1 public error payload reports MODEL_OUT_OF_PRINTER_BOUNDS with the real envelope', async () => {
    const limits = resolvePrusaLimits('0.2');
    const accepted = await applyTransformAndValidateModel(
        'model.stl',
        { x: 20, y: 20, z: 230, height_mm: 230 },
        NO_TRANSFORM,
        limits,
        INERT_WORKSPACE
    );
    assert.equal(accepted.isValid, true);

    for (const dimensions of [
        { x: 20, y: 20, z: 251, height_mm: 251 },
        { x: 257, y: 258, z: 20, height_mm: 20 }
    ]) {
        const rejected = await applyTransformAndValidateModel(
            'model.stl', dimensions, NO_TRANSFORM, limits, INERT_WORKSPACE
        );
        assert.equal(rejected.isValid, false);
        assert.equal(rejected.status, 422);
        assert.equal(rejected.response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
        assert.deepEqual(Object.keys(rejected.response.model_transform).sort(), MODEL_TRANSFORM_KEYS);
        assert.equal(rejected.response.model_transform.transform_schema, 2);
        assert.equal(rejected.response.model_transform.original_dimensions_available, true);
        assert.deepEqual(rejected.response.model_transform.final_dimensions_mm, {
            x: dimensions.x,
            y: dimensions.y,
            z: dimensions.z
        });
        assert.deepEqual(rejected.response.build_volume_limits_mm, {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 256, y: 256, z: 249.9 },
            source_profile: 'FDM_0.2mm.ini'
        });
    }
});

test('K2 preserve makes 20x255x255 a full-contract P1S bounds error but 20x240x245 fits', async () => {
    const oversized = { x: 20, y: 255, z: 255, height_mm: 255 };
    const fitting = { x: 20, y: 240, z: 245, height_mm: 245 };
    for (const [engine, limits] of [
        ['prusa', resolvePrusaLimits('0.2')],
        ['orca', resolveOrcaLimits('Bambu_P1S_0.4_nozzle.json')]
    ]) {
        const rejected = await applyTransformAndValidateModel(
            'model.stl',
            oversized,
            NO_TRANSFORM,
            limits,
            INERT_WORKSPACE,
            undefined,
            preserveContext(oversized)
        );
        assert.equal(rejected.isValid, false, engine);
        assert.equal(rejected.status, 422, engine);
        assert.equal(rejected.response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS', engine);
        assert.deepEqual(rejected.response.model_dimensions_mm, { x: 20, y: 255, z: 255 }, engine);
        assert.deepEqual(Object.keys(rejected.response.model_transform).sort(), MODEL_TRANSFORM_KEYS, engine);
        assert.equal(rejected.response.model_transform.orientation_mode, 'preserve', engine);
        assert.equal(rejected.response.model_transform.orientation_outcome, 'preserved', engine);
        assert.equal(rejected.response.model_transform.automatic_orientation_applied, false, engine);
        assert.equal(rejected.response.model_transform.original_dimensions_available, true, engine);
        assert.deepEqual(rejected.response.model_transform.original_dimensions_mm, { x: 20, y: 255, z: 255 }, engine);
        assert.deepEqual(rejected.response.model_transform.oriented_dimensions_mm, { x: 20, y: 255, z: 255 }, engine);
        assert.deepEqual(rejected.response.model_transform.final_dimensions_mm, { x: 20, y: 255, z: 255 }, engine);

        const accepted = await applyTransformAndValidateModel(
            'model.stl',
            fitting,
            NO_TRANSFORM,
            limits,
            INERT_WORKSPACE,
            undefined,
            preserveContext(fitting)
        );
        assert.equal(accepted.isValid, true, engine);
        assert.equal(accepted.modelTransform.orientation_outcome, 'preserved', engine);
        assert.deepEqual(accepted.modelTransform.final_dimensions_mm, { x: 20, y: 240, z: 245 }, engine);
    }
});

test('Orca keeps physical dimensions separate from P1S and enlarged quote admission ceilings', () => {
    const p1sLimits = resolveOrcaLimits('Bambu_P1S_0.4_nozzle.json');
    assert.deepEqual(p1sLimits.declaredMax, {
        x: 256,
        y: 256,
        z: 250
    });
    assert.deepEqual(p1sLimits.max, { x: 253.9, y: 253.9, z: 249.9 });
    assert.deepEqual(p1sLimits.explicitMaxAxes, { x: true, y: true, z: true });
    assert.equal(
        validateModelDimensionsAgainstLimits({ x: 253.9, y: 253.9, z: 249.9 }, p1sLimits).isValid,
        true
    );
    assert.equal(
        validateModelDimensionsAgainstLimits({ x: 254, y: 20, z: 20 }, p1sLimits).isValid,
        false
    );
    const quoteLimits = resolveOrcaLimits('Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json');
    assert.deepEqual(quoteLimits.declaredMax, {
        x: 350,
        y: 320,
        z: 325
    });
    assert.deepEqual(quoteLimits.max, { x: 347.9, y: 317.9, z: 324.9 });
    assert.deepEqual(quoteLimits.explicitMaxAxes, { x: true, y: true, z: true });
});

test('explicit-axis provenance distinguishes complete, partial, and fallback envelopes', () => {
    const fallbackSla = resolveBuildVolumeLimits(
        'prusa', 'SLA', path.join(PRUSA_DIR, 'missing-sla-profile.ini'), null
    );
    assert.deepEqual(fallbackSla.max, { x: 120, y: 120, z: 150 });
    assert.deepEqual(fallbackSla.explicitMaxAxes, { x: false, y: false, z: false });

    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2-partial-volume-'));
    const partialProfile = path.join(temporaryRoot, 'partial.ini');
    try {
        fs.writeFileSync(
            partialProfile,
            'bed_shape = 0x0,120x0,120x120,0x120\nprinter_technology = FDM\n',
            'utf8'
        );
        const partial = resolveBuildVolumeLimits('prusa', 'FDM', partialProfile, null);
        assert.deepEqual(partial.declaredMax, { x: 120, y: 120, z: 325 });
        assert.deepEqual(partial.max, { x: 120, y: 120, z: 324.9 });
        assert.deepEqual(partial.explicitMaxAxes, { x: true, y: true, z: false });
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('upper fallbacks cover supported machines while the existing lower boundary stays unchanged', () => {
    assert.deepEqual(MAX_BUILD_VOLUMES.FDM, { x: 350, y: 320, z: 325 });
    assert.deepEqual(MIN_BUILD_VOLUMES.FDM, { x: 1, y: 1, z: 1 });
    assert.deepEqual(MIN_BUILD_VOLUMES.SLA, { x: 1, y: 1, z: 1 });
    assert.equal(RESOURCE_DEFINITIONS.MAX_MODEL_DIMENSION_MM.min, 350);

    const fallback = resolveBuildVolumeLimits(
        'prusa',
        'FDM',
        path.join(PRUSA_DIR, 'missing-profile.ini'),
        null
    );
    assert.deepEqual(fallback.declaredMax, { x: 350, y: 320, z: 325 });
    assert.deepEqual(fallback.max, { x: 350, y: 320, z: 324.9 });
    assert.deepEqual(fallback.explicitMaxAxes, { x: false, y: false, z: false });
    assert.equal(
        validateModelDimensionsAgainstLimits({ x: 0.5, y: 0.5, z: 0.5 }, fallback).isValid,
        false
    );
    assert.equal(
        validateModelDimensionsAgainstLimits({ x: 0, y: 0.5, z: 0.5 }, fallback).isValid,
        false
    );
});
