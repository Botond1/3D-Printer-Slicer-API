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

test('all shipped Prusa FDM layers publish the exact P1S 256x256x250 build envelope', () => {
    for (const layer of ['0.1', '0.2', '0.3']) {
        const limits = resolvePrusaLimits(layer);
        assert.deepEqual(limits.max, { x: 256, y: 256, z: 250 }, layer);
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
            validateModelDimensionsAgainstLimits({ x: 256, y: 256, z: 250 }, limits).isValid,
            true,
            `${layer}: the exact P1S boundary must be accepted`
        );

        const zOverflow = validateModelDimensionsAgainstLimits({ x: 20, y: 20, z: 251 }, limits);
        assert.equal(zOverflow.isValid, false, `${layer}: Z=251 must be rejected`);
        assert.deepEqual(zOverflow.tooLarge, ['Z: 251mm > 250mm']);

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
        assert.deepEqual(rejected.response.build_volume_limits_mm, {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 256, y: 256, z: 250 },
            source_profile: 'FDM_0.2mm.ini'
        });
    }
});

test('Orca placeholder profiles expose owner-confirmed P1S and H2D envelopes', () => {
    const p1sLimits = resolveOrcaLimits('Bambu_P1S_0.4_nozzle.json');
    assert.deepEqual(p1sLimits.max, {
        x: 256,
        y: 256,
        z: 250
    });
    assert.deepEqual(p1sLimits.explicitMaxAxes, { x: true, y: true, z: true });
    assert.equal(
        validateModelDimensionsAgainstLimits({ x: 256, y: 256, z: 250 }, p1sLimits).isValid,
        true
    );
    assert.equal(
        validateModelDimensionsAgainstLimits({ x: 20, y: 20, z: 251 }, p1sLimits).isValid,
        false
    );
    const h2dLimits = resolveOrcaLimits('Bambu_H2D_0.4_nozzle.json');
    assert.deepEqual(h2dLimits.max, {
        x: 350,
        y: 320,
        z: 325
    });
    assert.deepEqual(h2dLimits.explicitMaxAxes, { x: true, y: true, z: true });
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
        assert.deepEqual(partial.max, { x: 120, y: 120, z: 325 });
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
    assert.deepEqual(fallback.max, { x: 350, y: 320, z: 325 });
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
