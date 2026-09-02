const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PROCESSING_ERRORS_PATH = path.join(REPO_ROOT, 'app/services/slice/errors.js');
const { handleProcessingError } = require(PROCESSING_ERRORS_PATH);
const {
    BAMBU_PLACEMENT_DIAGNOSTICS,
    isNativePlacementRejection,
    wrapNativePlacementRejection
} = require('../../../app/services/slice/native-bounds');
const {
    loadCommonJsFromSource
} = require('./helpers/load-commonjs-from-source');

function invokeProcessingError(error, handler = handleProcessingError) {
    const state = {
        statusCode: null,
        body: null
    };
    const response = {
        status(statusCode) {
            state.statusCode = statusCode;
            return this;
        },
        json(body) {
            state.body = body;
            return this;
        }
    };
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        const returned = handler(
            error,
            response,
            [],
            'unit-input.stl',
            () => '.stl, .zip'
        );
        assert.equal(returned, response);
    } finally {
        console.error = originalConsoleError;
    }

    return state;
}

function assertProcessingMapping(actual, expectedStatus, expectedErrorCode) {
    assert.equal(actual.statusCode, expectedStatus, expectedErrorCode);
    assert.equal(actual.body.success, false, expectedErrorCode);
    assert.equal(actual.body.errorCode, expectedErrorCode);
    assert.equal(typeof actual.body.error, 'string', expectedErrorCode);
    assert.ok(actual.body.error.length > 0, expectedErrorCode);
}

test('processing timeout maps live to FILE_PROCESSING_TIMEOUT (422)', () => {
    assertProcessingMapping(
        invokeProcessingError(new Error('ETIMEDOUT')),
        422,
        'FILE_PROCESSING_TIMEOUT'
    );
});

test('invalid source geometry maps live to INVALID_SOURCE_GEOMETRY (400)', () => {
    const result = invokeProcessingError(
        new Error('cad2stl.py critical error: invalid polygon geometry')
    );
    assertProcessingMapping(result, 400, 'INVALID_SOURCE_GEOMETRY');
    assert.match(
        result.body.error,
        /Automatic repair is disabled to preserve exact model fidelity\./
    );
});

test('invalid source archive maps live to INVALID_SOURCE_ARCHIVE (400)', () => {
    assertProcessingMapping(
        invokeProcessingError(new Error('ZIP_GUARD| archive validation failed')),
        400,
        'INVALID_SOURCE_ARCHIVE'
    );
});

test('unsupported input maps live to UNSUPPORTED_FILE_FORMAT (400)', () => {
    assertProcessingMapping(
        invokeProcessingError(new Error('unknown file format; input file must have a supported extension')),
        400,
        'UNSUPPORTED_FILE_FORMAT'
    );
});

test('Orca preset mismatch maps live to ORCA_PROFILE_INCOMPATIBLE (422)', () => {
    assertProcessingMapping(
        invokeProcessingError(new Error('process not compatible with printer')),
        422,
        'ORCA_PROFILE_INCOMPATIBLE'
    );
});

function schemaTwoModelTransform(dimensions = { x: 254, y: 100, z: 20 }) {
    return {
        transform_schema: 2,
        size_unit: 'mm',
        keep_proportions: true,
        requested_size: { x: null, y: null, z: null },
        scale_percent: null,
        scale_factors: { x: 1, y: 1, z: 1 },
        orientation_mode: 'preserve',
        orientation_outcome: 'preserved',
        automatic_orientation_applied: false,
        automatic_rotation_deg: { x: 0, y: 0, z: 0 },
        requested_rotation_deg: { x: 0, y: 0, z: 0 },
        rotation_deg: { x: 0, y: 0, z: 0 },
        automatic_rotation_matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        rotation_matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        original_dimensions_available: false,
        original_dimensions_mm: null,
        oriented_dimensions_mm: { ...dimensions },
        final_dimensions_mm: { ...dimensions }
    };
}

test('known native placement rejection maps to the full K2 bounds contract', () => {
    const nativeError = new Error('plate 1: Nothing to be sliced, no object is fully inside the print volume');
    const wrapped = wrapNativePlacementRejection(nativeError, {
        modelTransform: schemaTwoModelTransform(),
        buildVolumeLimits: {
            min: { x: 0.1, y: 0.1, z: 0.1 },
            max: { x: 253.9, y: 253.9, z: 249.9 },
            sourceProfile: 'Bambu_P1S_0.4_nozzle.json'
        }
    });
    const result = invokeProcessingError(wrapped);

    assertProcessingMapping(result, 422, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(result.body.model_dimensions_mm, { x: 254, y: 100, z: 20 });
    assert.deepEqual(result.body.model_transform, schemaTwoModelTransform());
    assert.deepEqual(result.body.build_volume_limits_mm, {
        min: { x: 0.1, y: 0.1, z: 0.1 },
        max: { x: 253.9, y: 253.9, z: 249.9 },
        source_profile: 'Bambu_P1S_0.4_nozzle.json'
    });
});

test('stdout placement diagnostic plus unrelated stderr warning still maps to full K2', () => {
    const nativeError = Object.assign(new Error('Native command failed.'), {
        stdout: 'plate 1: Nothing to be sliced; no object is fully inside the print volume',
        stderr: 'warning: unrelated preset metadata note'
    });
    const wrapped = wrapNativePlacementRejection(nativeError, {
        modelTransform: schemaTwoModelTransform(),
        buildVolumeLimits: {
            min: { x: 0.1, y: 0.1, z: 0.1 },
            max: { x: 253.9, y: 253.9, z: 249.9 },
            sourceProfile: 'Bambu_P1S_0.4_nozzle.json'
        }
    });
    const result = invokeProcessingError(wrapped);

    assertProcessingMapping(result, 422, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(result.body.model_transform, schemaTwoModelTransform());
    assert.deepEqual(result.body.build_volume_limits_mm.max, {
        x: 253.9, y: 253.9, z: 249.9
    });
});

test('exact native last-layer height rejection maps command failure to full K2', () => {
    const modelTransform = schemaTwoModelTransform({ x: 60, y: 60, z: 325 });
    const nativeError = Object.assign(new Error('Native command failed.'), {
        stdout: '',
        stderr: 'While the object z325.stl itself fits the build volume, its last layer exceeds '
            + 'the maximum build volume height. You might want to reduce the size of your model '
            + 'or change current print settings and retry.'
    });
    const wrapped = wrapNativePlacementRejection(nativeError, {
        modelTransform,
        buildVolumeLimits: {
            min: { x: 0.1, y: 0.1, z: 0.1 },
            max: { x: 350, y: 320, z: 325 },
            sourceProfile: 'FDM_P1S_H2D_SIZE_QUOTING_0.3mm.ini'
        }
    });
    const result = invokeProcessingError(wrapped);

    assertProcessingMapping(result, 422, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(result.body.model_dimensions_mm, { x: 60, y: 60, z: 325 });
    assert.deepEqual(result.body.model_transform, modelTransform);
    assert.deepEqual(result.body.build_volume_limits_mm, {
        min: { x: 0.1, y: 0.1, z: 0.1 },
        max: { x: 350, y: 320, z: 325 },
        source_profile: 'FDM_P1S_H2D_SIZE_QUOTING_0.3mm.ini'
    });
});

test('native placement diagnostic requires complete schema-v2 context before mapping', () => {
    const nativeError = new Error('Object does not fit inside the print volume');
    const wrapped = wrapNativePlacementRejection(nativeError, {
        modelTransform: { transform_schema: 1 },
        buildVolumeLimits: null
    });
    assertProcessingMapping(
        invokeProcessingError(wrapped),
        500,
        'INTERNAL_PROCESSING_ERROR'
    );
});

test('native placement matcher excludes unrelated native failures', () => {
    assert.equal(
        isNativePlacementRejection({
            message: 'Slicer did not produce an output artifact.',
            stderr: 'plate 1: Nothing to be sliced; no object is fully inside the print volume'
        }),
        true
    );
    assert.equal(
        isNativePlacementRejection(new Error('Slicer exited with status 1')),
        false
    );
    assert.equal(
        isNativePlacementRejection({ stderr: 'Nothing to be sliced' }),
        false
    );
    assert.equal(
        isNativePlacementRejection({
            stdout: 'All objects are outside the print volume.'
        }),
        true
    );
    assert.equal(
        isNativePlacementRejection({
            stderr: 'While the object z325.stl itself fits the build volume, validation failed.'
        }),
        false
    );
    assert.equal(
        isNativePlacementRejection({
            stderr: 'The last layer exceeds the maximum build volume height.'
        }),
        false
    );
});

test('converter INVALID_SOURCE_GEOMETRY| markers on either stream map to 400 without free-text guessing', () => {
    const {
        SOURCE_GEOMETRY_MARKER_PREFIX,
        hasSourceGeometryMarker,
        isSourceGeometryError
    } = require(PROCESSING_ERRORS_PATH);
    assert.equal(SOURCE_GEOMETRY_MARKER_PREFIX, 'INVALID_SOURCE_GEOMETRY|');
    const stdoutMarker = Object.assign(new Error('Command failed: python'), {
        stdout: 'info line\nINVALID_SOURCE_GEOMETRY|scene is empty\n',
        stderr: ''
    });
    assertProcessingMapping(invokeProcessingError(stdoutMarker), 400, 'INVALID_SOURCE_GEOMETRY');
    const stderrMarker = Object.assign(new Error('Command failed: python'), {
        stdout: '',
        stderr: 'INVALID_SOURCE_GEOMETRY|no faces\r\n'
    });
    assertProcessingMapping(invokeProcessingError(stderrMarker), 400, 'INVALID_SOURCE_GEOMETRY');
    // The marker is an exact line prefix: an embedded mention is not a converter verdict.
    assert.equal(hasSourceGeometryMarker('note: INVALID_SOURCE_GEOMETRY| mentioned mid-line'), false);
    assert.equal(hasSourceGeometryMarker('invalid_source_geometry|lowercase'), false);
    assert.equal(hasSourceGeometryMarker(''), false);
    assert.equal(hasSourceGeometryMarker(undefined), false);
    assert.equal(hasSourceGeometryMarker(['INVALID_SOURCE_GEOMETRY|array']), false);
    assert.equal(isSourceGeometryError({ stdout: 'note: INVALID_SOURCE_GEOMETRY| mid-line', stderr: '' }), false);
    assertProcessingMapping(
        invokeProcessingError(Object.assign(new Error('failed'), { stdout: 'note: INVALID_SOURCE_GEOMETRY| mid-line' })),
        500,
        'INTERNAL_PROCESSING_ERROR'
    );
});

test('only a real timeout maps to FILE_PROCESSING_TIMEOUT; killed children keep their own class', () => {
    const { isProcessingTimeoutError } = require(PROCESSING_ERRORS_PATH);
    const timedOut = Object.assign(new Error('The slicing process timed out after 10 minutes.'), {
        code: 'ETIMEDOUT', killed: true
    });
    const mapped = invokeProcessingError(timedOut);
    assertProcessingMapping(mapped, 422, 'FILE_PROCESSING_TIMEOUT');
    // Native slices and the shorter Python helper budget share the code, so no fixed minutes.
    assert.doesNotMatch(mapped.body.error, /10 minutes/);
    assert.match(mapped.body.error, /processing budget/);
    const helperTimeout = Object.assign(new Error('The slicing process timed out after 2 minutes.'), { code: 'ETIMEDOUT' });
    assertProcessingMapping(invokeProcessingError(helperTimeout), 422, 'FILE_PROCESSING_TIMEOUT');
    assert.equal(isProcessingTimeoutError({ code: 'ETIMEDOUT' }), true);
    assert.equal(isProcessingTimeoutError({ message: 'The slicing process timed out after 2 minutes.' }), true);
    assert.equal(isProcessingTimeoutError({ killed: true, signal: 'SIGKILL', message: 'Command failed: native-tool' }), false);
    assert.equal(isProcessingTimeoutError({ killed: true, code: 'ABORT_ERR', message: 'aborted' }), false);
    assert.equal(isProcessingTimeoutError({ killed: true, code: 'NATIVE_OUTPUT_OVERFLOW', message: 'overflow' }), false);
    assertProcessingMapping(
        invokeProcessingError(Object.assign(new Error('Command failed: native-tool'), { killed: true, signal: 'SIGKILL' })),
        500,
        'INTERNAL_PROCESSING_ERROR'
    );
});

test('bounded native output overflow maps to HTTP 500 NATIVE_OUTPUT_OVERFLOW ahead of the timeout branch', () => {
    const overflow = Object.assign(new Error('Native output exceeded the bounded buffer.'), {
        code: 'NATIVE_OUTPUT_OVERFLOW', killed: true
    });
    const mapped = invokeProcessingError(overflow);
    assertProcessingMapping(mapped, 500, 'NATIVE_OUTPUT_OVERFLOW');
    assert.deepEqual(Object.keys(mapped.body).sort(), ['error', 'errorCode', 'success']);
    assert.doesNotMatch(JSON.stringify(mapped.body), /timed out/i);
});

test('Bambu Studio rc 192/190 placement refusals map to the full K2 bounds contract', () => {
    assert.deepEqual(BAMBU_PLACEMENT_DIAGNOSTICS, [
        'object conflicts were detected',
        'some filaments cannot be mapped to correct extruders'
    ]);
    for (const [stream, text] of [
        ['stdout', 'Object conflicts were detected. Please verify the slicing of all plates in Bambu Studio before uploading.'],
        ['stderr', 'Some filaments cannot be mapped to correct extruders for multi-extruder Printer.']
    ]) {
        const nativeError = Object.assign(new Error('Native command failed with exit status 192.'), {
            stdout: '', stderr: '', [stream]: text
        });
        assert.equal(isNativePlacementRejection(nativeError), true, stream);
        const wrapped = wrapNativePlacementRejection(nativeError, {
            modelTransform: schemaTwoModelTransform({ x: 256, y: 228.1, z: 20 }),
            buildVolumeLimits: {
                min: { x: 1, y: 1, z: 1 },
                max: { x: 256, y: 228, z: 250 },
                sourceProfile: 'Bambu Lab P1S 0.4 nozzle'
            }
        });
        const result = invokeProcessingError(wrapped);
        assertProcessingMapping(result, 422, 'MODEL_OUT_OF_PRINTER_BOUNDS');
        assert.deepEqual(result.body.model_dimensions_mm, { x: 256, y: 228.1, z: 20 });
        assert.equal(result.body.model_transform.transform_schema, 2);
        assert.deepEqual(result.body.build_volume_limits_mm, {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 256, y: 228, z: 250 },
            source_profile: 'Bambu Lab P1S 0.4 nozzle'
        });
        assert.doesNotMatch(JSON.stringify(result.body), /Bambu Studio before uploading|multi-extruder/);
    }
    assert.equal(isNativePlacementRejection({ stderr: 'Object conflicts resolved automatically' }), false);
    assert.equal(isNativePlacementRejection({ stderr: 'filaments mapped to extruders successfully' }), false);
});

test('unclassified processing failure maps live to INTERNAL_PROCESSING_ERROR (500)', () => {
    assertProcessingMapping(
        invokeProcessingError(new Error('unclassified processing failure')),
        500,
        'INTERNAL_PROCESSING_ERROR'
    );
});

test('live processing mapping proof detects an incorrect adjacent archive status', () => {
    const source = fs.readFileSync(PROCESSING_ERRORS_PATH, 'utf8');
    const archiveBranchPattern = /(if \(isZipInputError\(err\)\) \{\r?\n\s*return res\.status\()400(\)\.json\(\{)/;
    const mutatedSource = source.replace(
        archiveBranchPattern,
        (_match, branchPrefix, responseSuffix) => `${branchPrefix}422${responseSuffix}`
    );
    assert.notEqual(mutatedSource, source, 'Adjacent archive-status mutation seam did not apply.');

    const mutatedModule = loadCommonJsFromSource(PROCESSING_ERRORS_PATH, mutatedSource);
    const geometryResult = invokeProcessingError(
        new Error('cad2stl.py critical error: invalid polygon geometry'),
        mutatedModule.handleProcessingError
    );
    const archiveResult = invokeProcessingError(
        new Error('ZIP_GUARD| archive validation failed'),
        mutatedModule.handleProcessingError
    );

    assertProcessingMapping(geometryResult, 400, 'INVALID_SOURCE_GEOMETRY');
    assert.equal(archiveResult.statusCode, 422, 'Mutation seam did not alter only the archive branch.');
    assert.throws(
        () => assertProcessingMapping(archiveResult, 400, 'INVALID_SOURCE_ARCHIVE'),
        /INVALID_SOURCE_ARCHIVE/
    );
});
