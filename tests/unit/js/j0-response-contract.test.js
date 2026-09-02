'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
const modelStatsPath = path.resolve(__dirname, '../../../app/services/slice/model-stats.js');
const originalModelStatsModule = require.cache[modelStatsPath];
const modelStats = require(modelStatsPath);
require.cache[modelStatsPath] = {
    id: modelStatsPath,
    filename: modelStatsPath,
    loaded: true,
    exports: {
        ...modelStats,
        getModelInfo: async () => modelStats.createMeasuredModelMeasurement({
            x: 1, y: 1, z: 1, height_mm: 1
        })
    }
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
const { handleProcessingError } = require('../../../app/services/slice/errors');
const { GcodeMetricsError } = require('../../../app/services/slice/gcode-metrics');
const {
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix
} = require('../../../app/services/slice/orientation-contract');

const SHA256 = 'a'.repeat(64);
const MODEL_TRANSFORM_REQUIRED = [
    'transform_schema',
    'size_unit',
    'keep_proportions',
    'requested_size',
    'scale_percent',
    'scale_factors',
    'orientation_mode',
    'orientation_outcome',
    'automatic_orientation_applied',
    'automatic_rotation_deg',
    'requested_rotation_deg',
    'rotation_deg',
    'automatic_rotation_matrix',
    'rotation_matrix',
    'original_dimensions_available',
    'original_dimensions_mm',
    'oriented_dimensions_mm',
    'final_dimensions_mm'
];

function createModelTransform({
    original = { x: 10, y: 20, z: 30 },
    oriented = original,
    final = oriented,
    rotationDeg = { x: 0, y: 0, z: 0 },
    mode = 'auto',
    outcome = 'unchanged',
    automaticMatrix = identityRotationMatrix()
} = {}) {
    return buildModelTransformContract({
        transformOptions: {
            unit: 'mm',
            keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            targetSizeMm: { x: null, y: null, z: null },
            scalePercent: null,
            rotationDeg
        },
        transformPlan: {
            requiresTransform: Object.values(rotationDeg).some((value) => value !== 0),
            scale: { x: 1, y: 1, z: 1 },
            rotationDeg,
            requestedUnit: 'mm',
            keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            predictedSizeMm: { ...oriented }
        },
        orientation: createOrientationState(mode, outcome, automaticMatrix),
        originalModelMeasurement: modelStats.createMeasuredModelMeasurement(original),
        orientedModelMeasurement: modelStats.createMeasuredModelMeasurement(oriented),
        finalModelMeasurement: modelStats.createMeasuredModelMeasurement(final)
    });
}

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
        orcaFilamentConfigFile: path.join('profiles', 'PLA_generic.json'),
        filamentProfileMetadata: { diameterMm: 1.75, densityGcm3: 1.24 },
        effectiveProfileSha256: SHA256
    }), {
        machine_profile: 'Bambu_P1S_0.4_nozzle.json',
        process_profile: 'FDM_0.2mm.json',
        filament_profile: 'PLA_generic.json',
        filament_diameter_mm: 1.75,
        filament_density_g_cm3: 1.24,
        effective_profile_sha256: SHA256
    });
    assert.deepEqual(resolveProfileMapper('orca')({
        baseConfigFile: 'process.json',
        orcaMachineConfigFile: 'machine.json',
        orcaFilamentConfigFile: null,
        filamentProfileMetadata: null,
        effectiveProfileSha256: SHA256
    }), {
        machine_profile: 'machine.json',
        process_profile: 'process.json',
        filament_profile: null,
        filament_diameter_mm: null,
        filament_density_g_cm3: null,
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
    assert.ok(success.required.includes('model_transform'));
    assert.ok(success.required.includes('build_volume_limits_mm'));
    assert.equal(success.properties.engine_version.description,
        'Version reported by the native slicer binary that produced the result.');
    assert.ok(success.properties.profiles.required.includes('effective_profile_sha256'));
    assert.deepEqual(success.properties.profiles.properties.effective_profile_sha256, {
        type: 'string',
        pattern: '^[a-f0-9]{64}$',
        description: 'Deterministic SHA-256 of effective machine/process/filament profile layers, normalized material, and server-owned native policy, excluding per-request layer-height and infill overrides.'
    });
    assert.equal(success.properties.profiles.properties.filament_profile.nullable, true);
    assert.ok(success.required.includes('hourly_rate'));
    assert.deepEqual(success.properties.hourly_rate, {
        type: 'number',
        nullable: true,
        description: 'Configured hourly rate, or null when an Orca material has no selected filament profile or the native output has no direct mass marker and pricing requires manual review.'
    });
    assert.ok(success.properties.stats.required.includes('material_used_g'));
    assert.ok(success.properties.stats.required.includes('object_height_mm'));
    assert.deepEqual(success.properties.model_transform.required, MODEL_TRANSFORM_REQUIRED);
    assert.deepEqual(success.properties.model_transform.properties.transform_schema.enum, [2]);
    assert.deepEqual(success.properties.model_transform.properties.orientation_mode.enum, ['auto', 'preserve']);
    assert.deepEqual(success.properties.model_transform.properties.orientation_outcome.enum, [
        'applied', 'unchanged', 'preserved', 'fallback_unmodified'
    ]);
    for (const property of ['automatic_rotation_matrix', 'rotation_matrix']) {
        assert.equal(success.properties.model_transform.properties[property].minItems, 3);
        assert.equal(success.properties.model_transform.properties[property].maxItems, 3);
        assert.equal(success.properties.model_transform.properties[property].items.minItems, 3);
        assert.equal(success.properties.model_transform.properties[property].items.maxItems, 3);
    }
    assert.deepEqual(success.properties.stats.properties.material_used_g, {
        type: 'number',
        nullable: true,
        minimum: 0,
        description: 'Filament mass parsed directly from the slicer marker; null when the selected native profile emits no mass marker. It is never derived from length. For SLA this is the resin mass, derived from the parsed resin volume and profiles.resin_density_g_cm3 and always positive.'
    });
    assert.ok(success.properties.stats.required.includes('estimated_price_huf'));
    assert.deepEqual(success.properties.stats.properties.estimated_price_huf, {
        type: 'number',
        nullable: true,
        description: 'Calculated estimate, or null when an Orca material has no selected filament profile or the native output has no direct mass marker and pricing requires manual review.'
    });

    const validation = responses[422].content['application/json'].schema;
    assert.deepEqual(validation.properties.errorCode.enum, [
        'INVALID_SLICE_OUTPUT',
        'INVALID_SLICE_STATS',
        'FILE_PROCESSING_TIMEOUT',
        'ORCA_PROFILE_INCOMPATIBLE',
        'MODEL_DIMENSIONS_UNAVAILABLE',
        'UNSLICEABLE_SOURCE_GEOMETRY',
        'MODEL_OUT_OF_PRINTER_BOUNDS'
    ]);
    assert.deepEqual(
        responses[500].content['application/json'].schema.properties.errorCode.enum,
        [
            'SLICE_OUTPUT_UNPARSED',
            'INTERNAL_PROCESSING_ERROR',
            'NATIVE_OUTPUT_OVERFLOW',
            'QUEUE_INTERNAL_ERROR',
            'UPLOAD_STORAGE_ERROR',
            'INTERNAL_SERVER_ERROR'
        ]
    );
    assert.ok(
        responses[400].content['application/json'].schema.properties.errorCode.enum
            .includes('INVALID_ORIENTATION_MODE')
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
    const modelTransform = createModelTransform({
        original: dimensions,
        oriented: dimensions,
        final: dimensions
    });
    assert.equal(matchingValidationBranches(schema, {
        success: false,
        error: 'outside bounds',
        errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS',
        model_dimensions_mm: dimensions,
        build_volume_limits_mm: limits,
        model_transform: modelTransform
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
    assert.deepEqual(boundsBranch.required, [
        'model_dimensions_mm', 'build_volume_limits_mm', 'model_transform'
    ]);
    assert.deepEqual(boundsBranch.properties.model_dimensions_mm.required, ['x', 'y', 'z']);
    assert.deepEqual(boundsBranch.properties.build_volume_limits_mm.required, [
        'min', 'max', 'source_profile'
    ]);
    assert.deepEqual(boundsBranch.properties.model_transform.required, MODEL_TRANSFORM_REQUIRED);
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
    assert.deepEqual(Object.keys(result.response.model_transform).sort(), [...MODEL_TRANSFORM_REQUIRED].sort());
    assert.equal(result.response.model_transform.transform_schema, 2);
    assert.equal(result.response.model_transform.original_dimensions_available, true);
    assert.equal(result.response.model_transform.orientation_mode, 'auto');
    assert.equal(result.response.model_transform.orientation_outcome, 'unchanged');
    assert.deepEqual(result.response.model_transform.original_dimensions_mm, { x: 260, y: 20, z: 30 });
    assert.deepEqual(result.response.model_transform.oriented_dimensions_mm, { x: 260, y: 20, z: 30 });
    assert.deepEqual(result.response.model_transform.final_dimensions_mm, { x: 260, y: 20, z: 30 });
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
        orcaFilamentConfigFile: path.join('selected', 'PLA_generic.json'),
        filamentProfileMetadata: { diameterMm: 1.75, densityGcm3: 1.24 },
        effectiveProfileSha256: SHA256,
        engineVersion: '2.3.1',
        modelTransform: createModelTransform({
            rotationDeg: { x: 90, y: 0, z: 0 },
            final: { x: 10, y: 30, z: 20 }
        }),
        buildVolumeLimits: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 256, y: 256, z: 250 },
            sourceProfile
        },
        stats: {
            print_time_seconds: 60,
            print_time_readable: '1m',
            material_used_m: 1,
            material_used_g: 3.01,
            object_height_mm: 20
        },
        jobId: 'job-id',
        artifactId: 'artifact-id'
    });
    assert.equal(response.profiles.machine_profile, sourceProfile);
    assert.equal(response.engine_version, '2.3.1');
    assert.equal(response.profiles.process_profile, 'FDM_0.2mm.json');
    assert.equal(response.profiles.filament_profile, 'PLA_generic.json');
    assert.equal(response.profiles.filament_diameter_mm, 1.75);
    assert.equal(response.profiles.filament_density_g_cm3, 1.24);
    assert.equal(response.stats.material_used_g, 3.01);
    assert.deepEqual(response.model_transform.rotation_deg, { x: 90, y: 0, z: 0 });
    assert.deepEqual(response.model_transform.final_dimensions_mm, { x: 10, y: 30, z: 20 });
    assert.equal(response.stats.object_height_mm, response.model_transform.final_dimensions_mm.z);
    assert.equal(response.build_volume_limits_mm.source_profile, sourceProfile);
    assert.doesNotMatch(JSON.stringify(response), /orca-(?:base|machine)-profile-[a-f0-9]{16}/);
});

test('successful Orca slicing without a filament profile requires manual pricing', () => {
    const response = buildSliceSuccessResponse({
        engine: 'orca',
        technology: 'FDM',
        material: 'ABS',
        infillPercentage: '20%',
        baseConfigFile: path.join('selected', 'FDM_0.2mm.json'),
        orcaMachineConfigFile: path.join('selected', 'Bambu_P1S_0.4_nozzle.json'),
        orcaFilamentConfigFile: null,
        filamentProfileMetadata: null,
        effectiveProfileSha256: SHA256,
        engineVersion: '2.3.1',
        modelTransform: createModelTransform(),
        buildVolumeLimits: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 256, y: 256, z: 250 },
            sourceProfile: 'Bambu_P1S_0.4_nozzle.json'
        },
        stats: {
            print_time_seconds: 60,
            print_time_readable: '1m',
            material_used_m: 1,
            material_used_g: 3.01,
            object_height_mm: 30
        },
        jobId: 'job-id',
        artifactId: 'artifact-id'
    });

    assert.equal(response.success, true);
    assert.equal(response.profiles.filament_profile, null);
    assert.equal(response.profiles.filament_diameter_mm, null);
    assert.equal(response.profiles.filament_density_g_cm3, null);
    assert.equal(response.profiles.effective_profile_sha256, SHA256);
    assert.equal(response.hourly_rate, null);
    assert.equal(response.stats.estimated_price_huf, null);
    assert.equal(response.stats.print_time_seconds, 60);
    assert.equal(response.stats.material_used_m, 1);
    assert.equal(response.stats.material_used_g, 3.01);
});

test('successful Prusa slicing without a native mass marker stays explicit and manual', () => {
    const response = buildSliceSuccessResponse({
        engine: 'prusa',
        technology: 'FDM',
        material: 'PLA',
        infillPercentage: '20%',
        baseConfigFile: path.join('selected', 'FDM_0.2mm.ini'),
        orcaMachineConfigFile: null,
        orcaFilamentConfigFile: null,
        filamentProfileMetadata: null,
        effectiveProfileSha256: SHA256,
        engineVersion: '2.8.1',
        modelTransform: createModelTransform(),
        buildVolumeLimits: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 256, y: 256, z: 250 },
            sourceProfile: 'FDM_0.2mm.ini'
        },
        stats: {
            print_time_seconds: 120,
            print_time_readable: '0h 2m ',
            material_used_m: 1.13704,
            material_used_g: null,
            object_height_mm: 30
        },
        jobId: 'job-id',
        artifactId: 'artifact-id'
    });

    assert.equal(response.success, true);
    assert.equal(response.profiles.prusa_profile, 'FDM_0.2mm.ini');
    assert.equal(response.stats.material_used_m, 1.13704);
    assert.equal(response.stats.material_used_g, null);
    assert.equal(response.hourly_rate, null);
    assert.equal(response.stats.estimated_price_huf, null);
});

test('SLA prices automatically from its positive resin mass and publishes the SLA profile fields', () => {
    const response = buildSliceSuccessResponse({
        engine: 'prusa',
        technology: 'SLA',
        material: 'Standard',
        infillPercentage: '20%',
        baseConfigFile: path.join('selected', 'SLA_0.05mm.ini'),
        orcaMachineConfigFile: null,
        orcaFilamentConfigFile: null,
        filamentProfileMetadata: null,
        effectiveProfileSha256: SHA256,
        engineVersion: '2.8.1',
        modelTransform: createModelTransform(),
        buildVolumeLimits: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 218.88, y: 122.88, z: 220 },
            sourceProfile: 'SLA_0.05mm.ini'
        },
        stats: {
            print_time_seconds: 4265,
            print_time_readable: '1h 11m (Est.)',
            material_used_m: 0,
            material_used_g: 4.68,
            material_used_ml: 4.25,
            layer_count: 800,
            model_volume_ml: null,
            support_volume_ml: null,
            print_time_source: 'sla_layer_time_model'
        },
        jobId: 'job-id',
        artifactId: 'artifact-id'
    });

    // SLA now has a real measured resin mass, so it prices exactly like FDM.
    assert.equal(response.hourly_rate, 1800);
    assert.equal(response.stats.estimated_price_huf, 2140);
    assert.equal(response.stats.material_used_g, 4.68);
    assert.equal(response.stats.material_used_ml, 4.25);
    assert.equal(response.stats.layer_count, 800);
    assert.equal(response.stats.print_time_seconds, 4265);
    assert.equal(response.profiles.sla_printer, 'SATURN4U');
    assert.equal(response.profiles.resin_density_g_cm3, 1.1);
    assert.equal(response.profiles.sla_time_model, 'sla-layer-time-v1');
    assert.equal(Object.hasOwn(response, 'placement_mm'), false);
});

test('strict metric drift maps to a bounded HTTP 500 without paths', () => {
    const observed = { status: null, payload: null };
    const res = {
        status(value) { observed.status = value; return this; },
        json(value) { observed.payload = value; return this; }
    };
    handleProcessingError(
        new GcodeMetricsError('GCODE_TIME_UNPARSED', 'private input detail'),
        res,
        null,
        null,
        () => ''
    );
    assert.equal(observed.status, 500);
    assert.deepEqual(observed.payload, {
        success: false,
        error: 'Slicer output metrics could not be parsed safely. No estimate was returned.',
        errorCode: 'SLICE_OUTPUT_UNPARSED',
        detailCode: 'GCODE_TIME_UNPARSED'
    });
    assert.equal(JSON.stringify(observed).includes('private input detail'), false);
});
