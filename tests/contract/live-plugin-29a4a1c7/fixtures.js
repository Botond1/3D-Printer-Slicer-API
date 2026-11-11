'use strict';

/**
 * Replay fixtures for the live plugin's validators.
 *
 * Provenance (stated, not implied): these bodies are NOT captures from the
 * private 3.8.3 container (§8 step 1 records those for the PHP oracle). They
 * are built from the 3.8.3 sources at dbc539e — the success answer is a port
 * of the plugin's own `tests/Slicer/Support/BambuFixture.php` carrying the
 * live 3.8.3 identity values of the P1S 0.2 PLA row, with its receipt digest
 * computed by the slicer's own `receipt-hash.js`; every error body is the
 * literal object 3.8.3 writes for that case (file:line in `source`). Each one
 * is labelled `recorded_from: '3.8.3 source / unit-test harness'`.
 */

const { createHash } = require('node:crypto');
const { hashValue } = require('../../../app/services/slice/receipt-hash');

const LIVE_IDENTITY = Object.freeze({
    generation: '0af5bd3e2fb980f41e754064b7f869038500f1523bbbb48a5d00b406aa394e27',
    buildHash: '0dd1ab55a0f6237ac4a47f76b4b0966464caa79e6789a792dc251e0d0235786c',
    bundleHash: 'ad05bb2bdd19e49f7509d509288b6072704803ac3818101f05bba9b23a24d2ca',
    profileHash: '70e87eaff59a65d93fbfddd507eaa08d2ee52e5857e222757f32199d7fc9f06f',
    engineVersion: '02.08.02.61'
});

const SOURCE_BYTES = Buffer.from('solid r3d-contract-fixture\nendsolid r3d-contract-fixture\n');

/** The `SliceRequest` the plugin builds for a P1S 0.2 mm PLA slice (BambuFixture::request). */
function sliceRequest(overrides = {}) {
    return {
        requestId: 'fixture-attempt-1',
        jobUuid: 'contract-fixture',
        technology: 'FDM',
        material: 'PLA',
        layerHeight: 0.2,
        infill: 20,
        supports: true,
        printerProfile: 'P1S',
        sizeUnit: 'mm',
        orientationMode: 'auto',
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        scalePercent: null,
        sourceSha256: createHash('sha256').update(SOURCE_BYTES).digest('hex'),
        verifiedProfile: {
            engine: 'bambu',
            filename: 'P1S',
            engineVersion: LIVE_IDENTITY.engineVersion,
            profileHash: LIVE_IDENTITY.profileHash,
            buildHash: LIVE_IDENTITY.buildHash,
            bundleHash: LIVE_IDENTITY.bundleHash,
            generation: LIVE_IDENTITY.generation,
            processProfile: '0.20mm Standard @BBL X1C',
            components: [
                { role: 'machine', basename: 'Bambu Lab P1S 0.4 nozzle' },
                { role: 'process', basename: '0.20mm Standard @BBL X1C' },
                { role: 'filament', basename: 'Generic PLA' }
            ],
            limits: { x: 256, y: 228, z: 249.9 },
            alternativeFootprints: [{ x: 238, y: 256 }]
        },
        ...overrides
    };
}

/**
 * A successful synchronous Bambu answer for `request` (BambuFixture::response),
 * receipt digest by the slicer's own `hashValue`.
 */
function successBody(request = sliceRequest(), mutate = null) {
    const h = 'f'.repeat(64);
    const transform = {
        transform_schema: 2, size_unit: 'mm', orientation_mode: request.orientationMode,
        scale_factors: { x: 1, y: 1, z: 1 }, requested_rotation_deg: { x: request.rotationX, y: request.rotationY, z: request.rotationZ },
        rotation_deg: { x: 0, y: 0, z: 0 },
        rotation_matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        automatic_rotation_matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        orientation_outcome: 'unchanged',
        oriented_dimensions_mm: { x: 10, y: 20, z: 30 },
        final_dimensions_mm: { x: 10, y: 20, z: 30 }
    };
    const p = request.verifiedProfile;
    const receipt = {
        schema: 'r3d-technical-receipt-v1', request_id: request.requestId, job_id: 'job-0123456789abcdef0123456789abcdef',
        measurement_generation: p.generation,
        source: { sha256: request.sourceSha256, format: 'stl', normalized_geometry_sha256: h, sliced_geometry_sha256: h, units: 'mm', unit_source: 'request' },
        engine: { name: 'bambu', version: p.engineVersion, platform: 'linux', build_sha256: p.buildHash },
        profiles: { printer: 'P1S', machine: 'Bambu Lab P1S 0.4 nozzle', process: p.processProfile, filament: 'Generic PLA',
            effective_profile_sha256: p.profileHash, bundle_sha256: p.bundleHash, machine_sha256: h, process_sha256: h, filament_sha256: h,
            nozzle_diameter_mm: 0.4, extruder_mode: 'single_filament_first_extruder', bed_type: 'Textured PEI Plate' },
        applied: { layer_height_mm: request.layerHeight, infill_percent: request.infill, supports: request.supports, material: request.material,
            evidence: 'bambu_gcode_config', configuration_sha256: h },
        geometry: { valid: true, watertight: true, winding_consistent: true, component_count: 1, closed_component_count: 1,
            open_edge_count: 0, dropped_degenerate_faces: 0, dropped_duplicate_faces: 0, volume_mm3: 6000,
            volume_source: 'validated_triangle_mesh', model_transform: transform },
        scope: { kind: 'single_part', object_count: 1, instance_count: 1, plate_count: 1, filament_count: 1, quantity: 1 },
        estimates: { print_time_seconds: 829, print_time_source: 'total_estimated_time', time_basis: 'including_start_sequence',
            material_used_g: 1.78, material_used_g_source: 'total_filament_weight_g', model_time_seconds: null,
            preparation_time_seconds: null, support_material_g: null, calibration: 'raw_slicer_estimate' },
        artifact: { id: 'art_0123456789abcdef', sha256: h, size_bytes: 1024, media_type: 'model/3mf', extension: '.gcode.3mf',
            gcode_sha256: h, access: 'artifact_audience', retention_seconds: 3600 },
        warnings: [],
        identity: { schema: 'r3d-slice-identity-v1', job_sha256: h, processing_schema: 'r3d-bambu-processing-v1' }
    };
    const body = {
        success: true, job_id: receipt.job_id, artifact_id: receipt.artifact.id, slicer_engine: 'bambu', technology: 'FDM',
        engine_version: p.engineVersion, material: request.material, infill: `${request.infill}%`, supports: request.supports,
        profiles: { effective_profile_sha256: p.profileHash, printer: 'P1S', machine_profile: receipt.profiles.machine,
            process_profile: p.processProfile, filament_profile: 'Generic PLA', bed_type: 'Textured PEI Plate' },
        applied_layer_height_mm: request.layerHeight,
        stats: { print_time_seconds: 829, print_time_source: 'total_estimated_time', material_used_m: 0.6, material_used_g: 1.78,
            material_used_g_source: 'total_filament_weight_g' },
        model_transform: transform,
        build_volume_limits_mm: { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 228, z: 249.9 }, source_profile: 'Bambu Lab P1S 0.4 nozzle' },
        technical_receipt: receipt
    };
    if (mutate) mutate(body);
    body.technical_receipt.receipt_sha256 = hashValue(Object.fromEntries(Object.entries(body.technical_receipt)
        .filter(([key]) => key !== 'receipt_sha256')));
    return body;
}

const FROM = '3.8.3 source / unit-test harness';

/**
 * Every refusal the plugin meets on `/bambu/slice` and its job routes, as
 * 3.8.3 writes it, with the plugin's reading of it at 29a4a1c7 (`code`,
 * `reason` of `classifyFailure`, `strike` = the submission's breaker strike).
 */
const ERROR_ANSWERS = Object.freeze([
    { name: 'model out of printer bounds', status: 422, recorded_from: FROM, source: 'app/services/slice/native-bounds.js:179-189',
        body: { success: false, error: 'Model dimensions are outside selected printer limits. The native slicer could not place the model fully inside the print volume.',
            errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS', model_dimensions_mm: { x: 400, y: 10, z: 10 },
            build_volume_limits_mm: { min: { x: 1, y: 1, z: 1 }, max: { x: 325, y: 320, z: 324.9 }, source_profile: 'Bambu Lab H2D 0.4 nozzle' } },
        code: 'r3d_slicer_model_out_of_printer_bounds', reason: 'out_of_bounds', strike: false },
    { name: 'ambiguous manufacturing scope', status: 422, recorded_from: FROM, source: 'app/services/slice/errors.js:234-240',
        body: { success: false, error: 'Automatic Bambu slicing needs a 3MF whose build items reference plain mesh objects in one model part; assemblies (components) and external part references are not admitted.',
            errorCode: 'AMBIGUOUS_MANUFACTURING_SCOPE' },
        code: 'r3d_slicer_ambiguous_manufacturing_scope', reason: 'geometry_rejected', strike: false },
    { name: 'file processing timeout', status: 422, recorded_from: FROM, source: 'app/services/slice/errors.js:284-292',
        body: { success: false, error: 'Processing exceeded the processing budget. The uploaded file may be too complex or invalid for automatic slicing. Please simplify or correct the file and try again.',
            errorCode: 'FILE_PROCESSING_TIMEOUT' },
        code: 'r3d_slicer_file_processing_timeout', reason: 'slicer_down', strike: false },
    { name: 'invalid source geometry', status: 400, recorded_from: FROM, source: 'app/services/slice/errors.js:309-315',
        body: { success: false, error: 'The uploaded model holds no printable geometry: it is empty, unreadable, has no finite coordinates, or encloses no volume. Please upload a corrected model file.',
            errorCode: 'INVALID_SOURCE_GEOMETRY' },
        code: 'r3d_slicer_invalid_source_geometry', reason: 'geometry_rejected', strike: false },
    { name: 'unsliceable source geometry', status: 422, recorded_from: FROM, source: 'app/services/slice/errors.js:299-307',
        body: { success: false, error: 'The native slicer could not slice the uploaded geometry. Automatic repair is disabled to preserve exact model fidelity. Please repair the model and try again.',
            errorCode: 'UNSLICEABLE_SOURCE_GEOMETRY', detail: 'non_manifold_edges' },
        code: 'r3d_slicer_unsliceable_source_geometry', reason: 'geometry_rejected', strike: false },
    { name: 'invalid source archive', status: 400, recorded_from: FROM, source: 'app/services/slice/errors.js:317-323',
        body: { success: false, error: 'Uploaded ZIP file is invalid or does not contain a supported model file.', errorCode: 'INVALID_SOURCE_ARCHIVE' },
        code: 'r3d_slicer_invalid_source_archive', reason: 'slicer_down', strike: false },
    { name: 'resource limit exceeded', status: 413, recorded_from: FROM, source: 'app/services/slice/errors.js:252-258',
        body: { success: false, error: 'Slice processing exceeded a configured resource limit.', errorCode: 'SLICE_RESOURCE_LIMIT_EXCEEDED' },
        code: 'r3d_slicer_slice_resource_limit_exceeded', reason: 'slicer_down', strike: false },
    { name: '409 identity mismatch', status: 409, recorded_from: FROM, source: 'app/services/slice/errors.js:236',
        body: { success: false, error: 'Selected profile or measurement generation is stale.', errorCode: 'SLICE_IDENTITY_MISMATCH' },
        code: 'r3d_slicer_slice_identity_mismatch', reason: 'slicer_down', strike: false },
    { name: '429 async jobs full', status: 429, headers: { 'retry-after': '5' }, recorded_from: FROM, source: 'app/services/slice/async-slice.js:133-141',
        body: { success: false, error: 'Too many asynchronous slice jobs are retained. Please wait and retry.', errorCode: 'SLICE_ASYNC_JOBS_FULL', retryAfterSeconds: 5 },
        code: 'r3d_rate_limited', reason: 'slicer_down', strike: true, asyncCode: 'r3d_slicer_busy' },
    { name: '503 slice queue full', status: 503, recorded_from: FROM, source: 'app/services/slice/queue.js:56-60, errorHandler',
        body: { success: false, error: 'Slice queue is full. Please retry later.', errorCode: 'SLICE_QUEUE_FULL' },
        code: 'r3d_slicer_slice_queue_full', reason: 'slicer_down', strike: true, asyncCode: 'r3d_slicer_slice_queue_full' },
    { name: 'pre-202 503 engine unavailable', status: 503, recorded_from: FROM, source: 'app/middleware/errorHandler.js:21-24',
        body: { success: false, error: 'The selected slicer engine is unavailable.', errorCode: 'SLICER_ENGINE_UNAVAILABLE' },
        code: 'r3d_slicer_slicer_engine_unavailable', reason: 'slicer_down', strike: true },
    { name: 'finished-job 500 with native facts', status: 500, recorded_from: FROM, source: 'app/services/slice/errors.js:340-350',
        body: { success: false, error: 'Slicing failed. The error has been logged for review.', errorCode: 'INTERNAL_PROCESSING_ERROR',
            native: { exit_code: 137, signal: null, killed_by_system: true } },
        code: 'r3d_slicer_internal_processing_error', reason: 'slicer_down', strike: true, finishedStrike: false },
    { name: 'async deadline exceeded', status: 504, recorded_from: FROM, source: 'app/services/slice/async-jobs.js:24-28',
        body: { success: false, error: 'Slice job exceeded its asynchronous deadline.', errorCode: 'SLICE_DEADLINE_EXCEEDED' },
        code: 'r3d_slicer_deadline_exceeded', reason: 'slicer_down', strike: true, finishedStrike: false },
    { name: '401 with a wrong key', status: 401, recorded_from: FROM, source: 'app/middleware/requireSliceService.js:13-17',
        body: { success: false, error: 'Slice service authentication is required.', errorCode: 'SLICE_SERVICE_AUTH_REQUIRED' },
        code: 'r3d_slicer_slice_service_auth_required', reason: 'slicer_down', strike: false },
    { name: '429 limiter', status: 429, headers: { 'retry-after': '2' }, recorded_from: FROM, source: 'app/middleware/rateLimit.js:25-33',
        body: { success: false, error: 'Too many requests. Please retry later.', errorCode: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: 2 },
        code: 'r3d_rate_limited', reason: 'slicer_down', strike: true }
]);

module.exports = { ERROR_ANSWERS, LIVE_IDENTITY, SOURCE_BYTES, sliceRequest, successBody };
