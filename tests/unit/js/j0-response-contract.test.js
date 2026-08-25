'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
const modelStatsPath = path.resolve(__dirname, '../../../app/services/slice/model-stats.js');
const originalModelStatsModule = require.cache[modelStatsPath];
require.cache[modelStatsPath] = {
    id: modelStatsPath,
    filename: modelStatsPath,
    loaded: true,
    exports: { getModelInfo: async () => ({ x: 1, y: 1, z: 1, height_mm: 1 }) }
};
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
    if (originalModelStatsModule) require.cache[modelStatsPath] = originalModelStatsModule;
    else delete require.cache[modelStatsPath];
});

const { createSliceResponses } = require('../../../app/docs/slice-openapi');
const {
    buildSliceSuccessResponse,
    resolveProfileMapper
} = require('../../../app/services/slice/response');
const { applyTransformAndValidateModel } = require('../../../app/services/slice/transform');
const { resolveBuildVolumeLimits } = require('../../../app/services/slice/profiles');

const SHA256 = 'a'.repeat(64);

test('both engine profile payloads expose the same required effective digest key', () => {
    assert.deepEqual(resolveProfileMapper('prusa')({
        baseConfigFile: path.join('profiles', 'FDM_0.2mm.ini'),
        effectiveProfileSha256: SHA256
    }), {
        prusa_profile: 'FDM_0.2mm.ini',
        effective_profile_sha256: SHA256
    });
    assert.deepEqual(resolveProfileMapper('orca')({
        baseConfigFile: path.join('profiles', 'FDM_0.2mm.json'),
        orcaMachineConfigFile: path.join('profiles', 'Bambu_P1S_0.4_nozzle.json'),
        effectiveProfileSha256: SHA256
    }), {
        machine_profile: 'Bambu_P1S_0.4_nozzle.json',
        process_profile: 'FDM_0.2mm.json',
        effective_profile_sha256: SHA256
    });
    assert.throws(
        () => resolveProfileMapper('prusa')({ baseConfigFile: 'profile.ini' }),
        /Effective profile SHA-256 is unavailable/
    );
});

test('OpenAPI exposes engine identity, W2 digest, requested omissions, and live validation code', () => {
    const responses = createSliceResponses();
    const success = responses[200].content['application/json'].schema;
    assert.ok(success.required.includes('profiles'));
    assert.ok(success.required.includes('engine_version'));
    assert.equal(success.properties.engine_version.description,
        'Version reported by the native slicer binary that produced the result.');
    assert.ok(success.properties.profiles.required.includes('effective_profile_sha256'));
    assert.deepEqual(success.properties.profiles.properties.effective_profile_sha256, {
        type: 'string',
        pattern: '^[a-f0-9]{64}$',
        description: 'Deterministic SHA-256 of fully resolved effective machine/process profile layers and server-owned native policy, excluding per-request layer-height and infill overrides.'
    });

    const validation = responses[422].content['application/json'].schema;
    assert.deepEqual(validation.properties.errorCode.enum, [
        'INVALID_SLICE_OUTPUT',
        'INVALID_SLICE_STATS',
        'FILE_PROCESSING_TIMEOUT',
        'ORCA_PROFILE_INCOMPATIBLE',
        'MODEL_DIMENSIONS_UNAVAILABLE',
        'MODEL_OUT_OF_PRINTER_BOUNDS'
    ]);
    assert.deepEqual(
        responses[500].content['application/json'].schema.properties.errorCode.enum,
        [
            'INTERNAL_PROCESSING_ERROR',
            'QUEUE_INTERNAL_ERROR',
            'UPLOAD_STORAGE_ERROR',
            'INTERNAL_SERVER_ERROR'
        ]
    );
    assert.equal(JSON.stringify(responses).includes('error_code'), false);
});

function matchingValidationBranches(schema, payload) {
    return schema.oneOf.filter((branch) => {
        const allowedCodes = branch.properties.errorCode.enum;
        if (!allowedCodes.includes(payload.errorCode)) return false;
        return (branch.required || []).every((property) => payload[property] !== undefined);
    }).length;
}

test('OpenAPI 422 oneOf classifies live dimension payloads without ambiguity', () => {
    const schema = createSliceResponses()[422].content['application/json'].schema;
    const dimensions = { x: 260, y: 20, z: 30 };
    const limits = {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 250, y: 250, z: 250 },
        source_profile: 'machine.json'
    };
    assert.equal(matchingValidationBranches(schema, {
        success: false,
        error: 'outside bounds',
        errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS',
        model_dimensions_mm: dimensions,
        build_volume_limits_mm: limits
    }), 1);
    assert.equal(matchingValidationBranches(schema, {
        success: false,
        error: 'outside bounds',
        errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS'
    }), 0);
    assert.equal(matchingValidationBranches(schema, {
        success: false,
        error: 'dimensions unavailable',
        errorCode: 'MODEL_DIMENSIONS_UNAVAILABLE'
    }), 1);
    assert.equal(matchingValidationBranches(schema, {
        success: false,
        error: 'invalid stats',
        errorCode: 'INVALID_SLICE_STATS',
        model_dimensions_mm: dimensions,
        build_volume_limits_mm: limits
    }), 1);
});

test('OpenAPI requires both dimension payloads for MODEL_OUT_OF_PRINTER_BOUNDS', () => {
    const schema = createSliceResponses()[422].content['application/json'].schema;
    const boundsBranch = schema.oneOf.find((branch) => (
        branch.properties.errorCode.enum[0] === 'MODEL_OUT_OF_PRINTER_BOUNDS'
    ));
    assert.deepEqual(boundsBranch.required, ['model_dimensions_mm', 'build_volume_limits_mm']);
    assert.deepEqual(boundsBranch.properties.model_dimensions_mm.required, ['x', 'y', 'z']);
    assert.deepEqual(boundsBranch.properties.build_volume_limits_mm.required, [
        'min', 'max', 'source_profile'
    ]);
});

test('live bounds validation always emits dimensions with MODEL_OUT_OF_PRINTER_BOUNDS', async () => {
    const root = path.resolve(__dirname, '../../..');
    const processSnapshot = path.join(root, 'configs/orca/FDM_0.2mm.json');
    const machineSnapshot = path.join(root, 'configs/orca/Bambu_P1S_0.4_nozzle.json');
    const limits = resolveBuildVolumeLimits(
        'orca',
        'FDM',
        processSnapshot,
        machineSnapshot,
        path.join('selected', 'Bambu_P1S_0.4_nozzle.json')
    );
    assert.equal(limits.sourceProfile, 'Bambu_P1S_0.4_nozzle.json');
    const result = await applyTransformAndValidateModel(
        'model.stl',
        { x: 260, y: 20, z: 30, height_mm: 30 },
        {
            unit: 'mm',
            keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            targetSizeMm: { x: null, y: null, z: null },
            scalePercent: null,
            rotationDeg: { x: 0, y: 0, z: 0 }
        },
        limits,
        { assertContainedPath(candidate) { return candidate; } }
    );

    assert.equal(result.isValid, false);
    assert.equal(result.status, 422);
    assert.equal(result.response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(result.response.model_dimensions_mm, { x: 260, y: 20, z: 30 });
    assert.deepEqual(result.response.build_volume_limits_mm, {
        min: limits.min,
        max: limits.max,
        source_profile: 'Bambu_P1S_0.4_nozzle.json'
    });
});

test('success response preserves selected profile metadata after snapshot-backed bounds parsing', () => {
    const sourceProfile = 'Bambu_P1S_0.4_nozzle.json';
    const response = buildSliceSuccessResponse({
        engine: 'orca',
        technology: 'FDM',
        material: 'PLA',
        infillPercentage: '20%',
        baseConfigFile: path.join('selected', 'FDM_0.2mm.json'),
        orcaMachineConfigFile: path.join('selected', sourceProfile),
        effectiveProfileSha256: SHA256,
        engineVersion: '2.3.1',
        transformOptions: { unit: 'mm', scalePercent: null },
        transformPlan: {
            keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            scale: { x: 1, y: 1, z: 1 },
            rotationDeg: { x: 90, y: 0, z: 0 }
        },
        originalModelInfo: { x: 10, y: 20, z: 30 },
        modelBoundsValidation: { dimensions: { x: 10, y: 30, z: 20 } },
        buildVolumeLimits: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 256, y: 256, z: 256 },
            sourceProfile
        },
        stats: {
            print_time_seconds: 60,
            print_time_readable: '1m',
            material_used_m: 1,
            object_height_mm: 30
        },
        jobId: 'job-id',
        artifactId: 'artifact-id'
    });
    assert.equal(response.profiles.machine_profile, sourceProfile);
    assert.equal(response.engine_version, '2.3.1');
    assert.equal(response.profiles.process_profile, 'FDM_0.2mm.json');
    assert.deepEqual(response.model_transform.rotation_deg, { x: 90, y: 0, z: 0 });
    assert.deepEqual(response.model_transform.final_dimensions_mm, { x: 10, y: 30, z: 20 });
    assert.equal(response.build_volume_limits_mm.source_profile, sourceProfile);
    assert.doesNotMatch(JSON.stringify(response), /orca-(?:base|machine)-profile-[a-f0-9]{16}/);
});
