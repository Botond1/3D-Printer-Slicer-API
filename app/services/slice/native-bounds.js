'use strict';

/** Native slicer placement rejection classification and bounded response context. */

const { roundDimensions } = require('./common');

const NATIVE_BOUNDS_ERROR_CODE = 'NATIVE_MODEL_OUT_OF_PRINTER_BOUNDS';
const MODEL_TRANSFORM_KEYS = Object.freeze([
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
]);

function combinedNativeOutput(err) {
    return `${err?.message || ''}\n${err?.stderr || ''}\n${err?.stdout || ''}`.toLowerCase();
}

/**
 * Bambu Studio placement refusals observed on the production CLI, matched as
 * bounded lowercase substrings of the combined message/stderr/stdout:
 *
 * - rc 192 `Object conflicts were detected. Please verify the slicing of all
 *   plates in Bambu Studio before uploading.` when the object overlaps the
 *   `bed_exclude_area` corner;
 * - rc 190 `Some filaments cannot be mapped to correct extruders for
 *   multi-extruder Printer.` when the object leaves the first extruder's
 *   printable area on the H2D.
 */
const BAMBU_PLACEMENT_DIAGNOSTICS = Object.freeze([
    'object conflicts were detected',
    'some filaments cannot be mapped to correct extruders'
]);

/**
 * Match only native diagnostics that explicitly reject placement in the print volume.
 * Generic slicer failures must remain internal processing errors.
 *
 * @param {{message?: string, stderr?: string, stdout?: string}} err Native command failure.
 * @returns {boolean} Whether the native output is an explicit placement rejection.
 */
function isNativePlacementRejection(err) {
    const combined = combinedNativeOutput(err);
    const lastLayerExceedsBuildHeight = (
        combined.includes('itself fits the build volume')
        && combined.includes('last layer exceeds the maximum build volume height')
    );
    return (
        combined.includes('nothing to be sliced')
        && combined.includes('no object is fully inside the print volume')
    ) || combined.includes('does not fit inside the print volume')
        || combined.includes('does not fit on the print bed')
        || combined.includes('outside the print volume')
        || lastLayerExceedsBuildHeight
        || BAMBU_PLACEMENT_DIAGNOSTICS.some((diagnostic) => combined.includes(diagnostic));
}

/**
 * Wrap a known native placement rejection with the already validated model contract.
 *
 * @param {Error & {stderr?: string, killed?: boolean}} err Native command error.
 * @param {{modelTransform?: Record<string, unknown>, buildVolumeLimits?: Record<string, unknown>}} context Slice context.
 * @returns {Error} Typed error, or the original error when the diagnostic is unrelated.
 */
function wrapNativePlacementRejection(err, context) {
    if (!isNativePlacementRejection(err)) return err;
    const wrapped = new Error('Native slicer rejected model placement inside the print volume.', {
        cause: err
    });
    wrapped.code = NATIVE_BOUNDS_ERROR_CODE;
    wrapped.killed = err?.killed === true;
    wrapped.nativeBoundsContext = Object.freeze({
        modelTransform: context?.modelTransform,
        buildVolumeLimits: context?.buildVolumeLimits
    });
    return wrapped;
}

function hasPositiveDimensions(dimensions) {
    return dimensions
        && ['x', 'y', 'z'].every((axis) => (
            Number.isFinite(Number(dimensions[axis])) && Number(dimensions[axis]) > 0
        ));
}

function hasMeasuredDimensions(dimensions) {
    return dimensions
        && Object.keys(dimensions).sort().join(',') === 'x,y,z'
        && ['x', 'y', 'z'].every((axis) => (
            Number.isFinite(Number(dimensions[axis])) && Number(dimensions[axis]) >= 0
        ));
}

function hasBuildVolumeLimits(limits) {
    return limits
        && hasPositiveDimensions(limits.max)
        && limits.min
        && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(limits.min[axis])))
        && typeof limits.sourceProfile === 'string'
        && limits.sourceProfile.length > 0;
}

function hasCompleteModelTransform(modelTransform) {
    if (!modelTransform || modelTransform.transform_schema !== 2) return false;
    const keys = Object.keys(modelTransform).sort();
    if (
        keys.length !== MODEL_TRANSFORM_KEYS.length
        || keys.some((key, index) => key !== MODEL_TRANSFORM_KEYS[index])
        || !hasPositiveDimensions(modelTransform.oriented_dimensions_mm)
        || !hasPositiveDimensions(modelTransform.final_dimensions_mm)
        || typeof modelTransform.original_dimensions_available !== 'boolean'
    ) {
        return false;
    }
    return modelTransform.original_dimensions_available
        ? hasMeasuredDimensions(modelTransform.original_dimensions_mm)
        : modelTransform.original_dimensions_mm === null;
}

/**
 * Build the full K2 bounds payload only from a complete schema-v2 context.
 *
 * @param {{code?: string, nativeBoundsContext?: Record<string, unknown>}} err Typed native rejection.
 * @returns {Record<string, unknown>|null} Full API payload, or null when context is incomplete.
 */
function buildNativeBoundsResponse(err) {
    if (err?.code !== NATIVE_BOUNDS_ERROR_CODE) return null;
    const { modelTransform, buildVolumeLimits } = err.nativeBoundsContext || {};
    if (
        !hasCompleteModelTransform(modelTransform)
        || !hasBuildVolumeLimits(buildVolumeLimits)
    ) {
        return null;
    }

    return {
        success: false,
        error: 'Model dimensions are outside selected printer limits. The native slicer could not place the model fully inside the print volume.',
        errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS',
        model_dimensions_mm: roundDimensions(modelTransform.final_dimensions_mm),
        model_transform: modelTransform,
        build_volume_limits_mm: {
            min: roundDimensions(buildVolumeLimits.min),
            max: roundDimensions(buildVolumeLimits.max),
            source_profile: buildVolumeLimits.sourceProfile
        }
    };
}

module.exports = {
    BAMBU_PLACEMENT_DIAGNOSTICS,
    NATIVE_BOUNDS_ERROR_CODE,
    isNativePlacementRejection,
    wrapNativePlacementRejection,
    buildNativeBoundsResponse,
    hasCompleteModelTransform
};
