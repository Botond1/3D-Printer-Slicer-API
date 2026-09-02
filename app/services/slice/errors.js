/**
 * Slice pipeline error classification and HTTP response mapping.
 */

const { GcodeMetricsError } = require('./gcode-metrics');
const { buildNativeBoundsResponse } = require('./native-bounds');

/**
 * Lowercased message, stderr, and stdout of a failed command. Both streams are
 * retained independently by the command runner, so a stdout-only diagnostic
 * is never hidden by an unrelated stderr warning.
 * @param {{message?: string, stderr?: string, stdout?: string}} err Command error payload.
 * @returns {string} Combined lowercase diagnostic text.
 */
function combinedDiagnostic(err) {
    return `${err?.message || ''}\n${err?.stderr || ''}\n${err?.stdout || ''}`.toLowerCase();
}

/**
 * Machine-readable marker the converters (`mesh2stl.py`, `cad2stl.py`) print
 * on both streams as `INVALID_SOURCE_GEOMETRY|<reason>` with exit status 2.
 * The match is an exact line-prefix match on the raw streams; no free-text
 * guessing is involved.
 */
const SOURCE_GEOMETRY_MARKER_PREFIX = 'INVALID_SOURCE_GEOMETRY|';

/**
 * Whether a raw command stream carries a converter geometry marker line.
 * @param {unknown} stream Raw stdout or stderr text.
 * @returns {boolean} True when one line starts with the exact marker prefix.
 */
function hasSourceGeometryMarker(stream) {
    if (typeof stream !== 'string' || stream.length === 0) return false;
    return stream.split(/\r?\n/).some((line) => line.startsWith(SOURCE_GEOMETRY_MARKER_PREFIX));
}

/**
 * Detect converter-level geometry failures from command output.
 * @param {{message?: string, stderr?: string, stdout?: string}} err Command error payload.
 * @returns {boolean} True when invalid source geometry is detected.
 */
function isSourceGeometryError(err) {
    if (hasSourceGeometryMarker(err?.stdout) || hasSourceGeometryMarker(err?.stderr)) {
        return true;
    }
    const combined = combinedDiagnostic(err);

    const failedConverter = (
        combined.includes('cad2stl.py') ||
        combined.includes('mesh2stl.py')
    );

    const geometryHints = [
        'critical error',
        'invalid polygon geometry',
        'could not create any geometry',
        'scene is empty',
        'mesh generation failed',
        'conversion failed',
        'not supported or is corrupted',
        'impossible to mesh periodic surface',
        'invalid file'
    ];

    return failedConverter && geometryHints.some((hint) => combined.includes(hint));
}

/**
 * Native slicer diagnostics that name a defect in the uploaded geometry itself.
 * Each entry maps a bounded, path-free public detail to its matcher; the raw
 * native text is never echoed because it can contain the model file name.
 */
const UNSLICEABLE_GEOMETRY_DIAGNOSTICS = Object.freeze([
    Object.freeze({
        kind: 'empty_layer',
        matches: (combined) => combined.includes('empty layer between')
            || combined.includes('faulty mesh'),
        detail: 'The native slicer found an empty layer inside the model, which indicates a faulty (non-manifold or self-intersecting) mesh.'
    }),
    Object.freeze({
        kind: 'model_load_failed',
        matches: (combined) => combined.includes('loading of a model file failed'),
        detail: 'The native slicer could not load the converted model file.'
    })
]);

/**
 * Classify a native "cannot slice this geometry" failure.
 * @param {{message?: string, stderr?: string, stdout?: string}} err Command error payload.
 * @returns {{kind: string, detail: string}|null} Bounded classification or null.
 */
function classifyUnsliceableSourceGeometry(err) {
    const combined = combinedDiagnostic(err);
    const diagnostic = UNSLICEABLE_GEOMETRY_DIAGNOSTICS.find((entry) => entry.matches(combined));
    return diagnostic ? { kind: diagnostic.kind, detail: diagnostic.detail } : null;
}

/**
 * Detect user-facing ZIP archive validation failures.
 * @param {{message?: string, stderr?: string, stdout?: string}} err Command error payload.
 * @returns {boolean} True when archive validation failed.
 */
function isZipInputError(err) {
    const combined = combinedDiagnostic(err);
    return err?.code === 'INVALID_SOURCE_ARCHIVE' || (
        combined.includes('zip_guard|') ||
        combined.includes('zip does not contain a supported') ||
        combined.includes('encrypted zip files are not supported') ||
        combined.includes('zip contains unsafe file paths') ||
        combined.includes('zip contains too many files') ||
        combined.includes('zip extracted size exceeds allowed limit') ||
        (combined.includes('enoent') && combined.includes('.zip'))
    );
}

/** Message shape the command runner assigns to a budget expiry. */
const TIMEOUT_MESSAGE_PATTERN = /timed out after \d+ minutes/i;

/**
 * Detect a real timeout from process execution errors: the runner's
 * `ETIMEDOUT` code, its timeout message, or an `ETIMEDOUT` message. A child
 * that was merely killed (client abort, output overflow, external signal) is
 * NOT a timeout and keeps its own classification.
 * @param {{message?: string, code?: string, name?: string}} err Command error payload.
 * @returns {boolean} True when a timeout condition matched.
 */
function isProcessingTimeoutError(err) {
    const message = String(err?.message || '');
    return (
        err?.code === 'ETIMEDOUT' ||
        TIMEOUT_MESSAGE_PATTERN.test(message) ||
        message.toLowerCase().includes('etimedout')
    );
}

/**
 * Detect the bounded stdout/stderr buffer overflow the command runner reports
 * when Node killed the child for exceeding its output budget.
 * @param {{code?: string}} err Command error payload.
 * @returns {boolean} True when the child overflowed its output buffer.
 */
function isNativeOutputOverflowError(err) {
    return err?.code === 'NATIVE_OUTPUT_OVERFLOW';
}

/**
 * Detect unsupported input format failures emitted by converters/slicers.
 * @param {{message?: string, stderr?: string, stdout?: string}} err Command error payload.
 * @returns {boolean} True when unsupported format is indicated.
 */
function isUnsupportedInputFormatError(err) {
    const combined = combinedDiagnostic(err);
    return (
        combined.includes('unknown file format') &&
        combined.includes('input file must have')
    );
}

/**
 * Detect Orca/Bambu process/machine profile compatibility errors.
 * @param {{message?: string, stderr?: string, stdout?: string}} err Command error payload.
 * @returns {boolean} True when incompatible preset combination is reported.
 */
function isOrcaPresetCompatibilityError(err) {
    return combinedDiagnostic(err).includes('process not compatible with printer');
}

/**
 * Convert processing exceptions into stable API error responses.
 * @param {Error & {stderr?: string, stdout?: string, killed?: boolean}} err Processing error.
 * @param {import('express').Response} res Express response.
 * @param {unknown} _legacyCleanupList Retained compatibility placeholder; route lifecycle owns cleanup.
 * @param {unknown} _legacyInputFile Retained compatibility placeholder; request paths are not logged.
 * @param {() => string} getSupportedInputExtensionsText Supported extension formatter callback.
 * @returns {import('express').Response} Serialized error response.
 */
function handleProcessingError(err, res, _legacyCleanupList, _legacyInputFile, getSupportedInputExtensionsText) {

    if (err instanceof GcodeMetricsError) {
        return res.status(500).json({
            success: false,
            error: 'Slicer output metrics could not be parsed safely. No estimate was returned.',
            errorCode: 'SLICE_OUTPUT_UNPARSED',
            detailCode: err.code
        });
    }

    if (err?.code === 'SLICE_RESOURCE_LIMIT_EXCEEDED') {
        return res.status(413).json({
            success: false,
            error: 'Slice processing exceeded a configured resource limit.',
            errorCode: 'SLICE_RESOURCE_LIMIT_EXCEEDED'
        });
    }

    if (err?.code === 'INVALID_SLICE_OUTPUT') {
        return res.status(422).json({
            success: false,
            error: 'Slicer output failed artifact validation.',
            errorCode: 'INVALID_SLICE_OUTPUT'
        });
    }

    if (err?.code === 'INVALID_SLICE_STATS') {
        return res.status(422).json({
            success: false,
            error: 'Slicer output statistics failed validation.',
            errorCode: 'INVALID_SLICE_STATS'
        });
    }

    if (isNativeOutputOverflowError(err)) {
        return res.status(500).json({
            success: false,
            error: 'The native process produced more output than the bounded buffer allows. No estimate was returned.',
            errorCode: 'NATIVE_OUTPUT_OVERFLOW'
        });
    }

    if (isProcessingTimeoutError(err)) {
        // The native slice budget (SLICE_COMMAND_TIMEOUT_MS) and the shorter
        // Python helper budget share this code, so the message names neither.
        return res.status(422).json({
            success: false,
            error: 'Processing exceeded the processing budget. The uploaded file may be too complex or invalid for automatic slicing. Please simplify or correct the file and try again.',
            errorCode: 'FILE_PROCESSING_TIMEOUT'
        });
    }

    const nativeBoundsResponse = buildNativeBoundsResponse(err);
    if (nativeBoundsResponse) {
        return res.status(422).json(nativeBoundsResponse);
    }

    const unsliceable = classifyUnsliceableSourceGeometry(err);
    if (unsliceable) {
        return res.status(422).json({
            success: false,
            error: 'The native slicer could not slice the uploaded geometry. Automatic repair is disabled to preserve exact model fidelity. Please repair the model and try again.',
            errorCode: 'UNSLICEABLE_SOURCE_GEOMETRY',
            detail: unsliceable.detail
        });
    }

    if (isSourceGeometryError(err)) {
        return res.status(400).json({
            success: false,
            error: 'Uploaded model contains invalid or non-printable source data. Automatic repair is disabled to preserve exact model fidelity. Please upload a corrected model file.',
            errorCode: 'INVALID_SOURCE_GEOMETRY'
        });
    }

    if (isZipInputError(err)) {
        return res.status(400).json({
            success: false,
            error: 'Uploaded ZIP file is invalid or does not contain a supported model file.',
            errorCode: 'INVALID_SOURCE_ARCHIVE'
        });
    }

    if (isUnsupportedInputFormatError(err)) {
        return res.status(400).json({
            success: false,
            error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
            errorCode: 'UNSUPPORTED_FILE_FORMAT'
        });
    }

    if (isOrcaPresetCompatibilityError(err)) {
        return res.status(422).json({
            success: false,
            error: 'Orca profile preset combination is incompatible. Please check machine/process profile pairing.',
            errorCode: 'ORCA_PROFILE_INCOMPATIBLE'
        });
    }

    return res.status(500).json({
        success: false,
        error: 'Slicing failed. The error has been logged for review.',
        errorCode: 'INTERNAL_PROCESSING_ERROR'
    });
}

module.exports = {
    SOURCE_GEOMETRY_MARKER_PREFIX,
    UNSLICEABLE_GEOMETRY_DIAGNOSTICS,
    classifyUnsliceableSourceGeometry,
    handleProcessingError,
    hasSourceGeometryMarker,
    isNativeOutputOverflowError,
    isProcessingTimeoutError,
    isSourceGeometryError
};
