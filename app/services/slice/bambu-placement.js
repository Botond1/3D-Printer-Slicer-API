'use strict';

/**
 * Deterministic API-owned placement of a model footprint on a Bambu bed.
 *
 * Bambu Studio's `--arrange 1` rotates an object that does not fit the plate
 * even with rotations disabled, which silently breaks the rotation-only
 * transform contract. The API therefore sends `--arrange 0` and translates the
 * model itself so its bounding box lands inside the printable rectangle
 * without overlapping any excluded rectangle:
 *
 * 1. centre the footprint in the printable rectangle;
 * 2. if it overlaps an excluded rectangle, shift +Y so `y_min` equals that
 *    rectangle's top edge (if it still fits);
 * 3. else shift +X so `x_min` equals that rectangle's right edge (if it still
 *    fits);
 * 4. else the model is out of bounds.
 *
 * Touching an edge is not an overlap: the measured P1S admission accepts
 * `256 x 228` at `(0, 28)` and `238 x 256` at `(18, 0)`, both flush against
 * the excluded `18 x 28 mm` corner, while `256 x 228.1` and `238.1 x 256`
 * fail. The admissible footprint is L-shaped; the catalogue publishes one
 * triple and this module represents the rest.
 */

const { roundToThree } = require('./common');

/** Tolerance for float noise from centring arithmetic, in millimetres. */
const PLACEMENT_EPSILON_MM = 1e-6;

const PLACEMENT_STRATEGIES = Object.freeze({
    CENTRED: 'centred',
    SHIFTED_Y: 'shifted_y',
    SHIFTED_X: 'shifted_x'
});

const PLACEMENT_REJECTIONS = Object.freeze({
    INVALID_FOOTPRINT: 'invalid_footprint',
    EXCEEDS_PRINTABLE_AREA: 'exceeds_printable_area',
    EXCLUDE_CONFLICT: 'exclude_conflict'
});

function footprintRectangle(xMin, yMin, footprint) {
    return { minX: xMin, minY: yMin, maxX: xMin + footprint.x, maxY: yMin + footprint.y };
}

/**
 * Whether two rectangles share interior area. Shared edges do not count.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} left First rectangle.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} right Second rectangle.
 * @returns {boolean} True when the interiors overlap.
 */
function rectanglesOverlap(left, right) {
    return left.minX < right.maxX - PLACEMENT_EPSILON_MM
        && left.maxX > right.minX + PLACEMENT_EPSILON_MM
        && left.minY < right.maxY - PLACEMENT_EPSILON_MM
        && left.maxY > right.minY + PLACEMENT_EPSILON_MM;
}

/**
 * Whether a rectangle lies inside the printable rectangle (edges inclusive).
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} rectangle Candidate.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} printable Printable area.
 * @returns {boolean} True when contained.
 */
function rectangleWithin(rectangle, printable) {
    return rectangle.minX >= printable.minX - PLACEMENT_EPSILON_MM
        && rectangle.minY >= printable.minY - PLACEMENT_EPSILON_MM
        && rectangle.maxX <= printable.maxX + PLACEMENT_EPSILON_MM
        && rectangle.maxY <= printable.maxY + PLACEMENT_EPSILON_MM;
}

function isAdmissible(candidate, bedGeometry) {
    return rectangleWithin(candidate, bedGeometry.printable)
        && !bedGeometry.excludes.some((exclude) => rectanglesOverlap(candidate, exclude));
}

function accepted(candidate, strategy) {
    return Object.freeze({
        fits: true,
        strategy,
        xMin: candidate.minX,
        yMin: candidate.minY
    });
}

/**
 * Resolve the deterministic placement of a footprint on the bed.
 * @param {{x: number, y: number}} footprint Final model X/Y extents in mm.
 * @param {{printable: object, excludes: ReadonlyArray<object>}} bedGeometry Parsed bed geometry.
 * @returns {Readonly<{fits: true, strategy: string, xMin: number, yMin: number}|{fits: false, reason: string, conflict?: object}>} Placement result.
 */
function resolveBambuPlacement(footprint, bedGeometry) {
    const x = Number(footprint?.x);
    const y = Number(footprint?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
        return Object.freeze({ fits: false, reason: PLACEMENT_REJECTIONS.INVALID_FOOTPRINT });
    }
    const { printable } = bedGeometry;
    const width = printable.maxX - printable.minX;
    const depth = printable.maxY - printable.minY;
    if (x > width + PLACEMENT_EPSILON_MM || y > depth + PLACEMENT_EPSILON_MM) {
        return Object.freeze({ fits: false, reason: PLACEMENT_REJECTIONS.EXCEEDS_PRINTABLE_AREA });
    }
    const size = { x, y };
    const centred = footprintRectangle(
        printable.minX + (width - x) / 2,
        printable.minY + (depth - y) / 2,
        size
    );
    const conflict = bedGeometry.excludes.find((exclude) => rectanglesOverlap(centred, exclude));
    if (!conflict) return accepted(centred, PLACEMENT_STRATEGIES.CENTRED);

    const shiftedY = footprintRectangle(centred.minX, conflict.maxY, size);
    if (isAdmissible(shiftedY, bedGeometry)) return accepted(shiftedY, PLACEMENT_STRATEGIES.SHIFTED_Y);

    const shiftedX = footprintRectangle(conflict.maxX, centred.minY, size);
    if (isAdmissible(shiftedX, bedGeometry)) return accepted(shiftedX, PLACEMENT_STRATEGIES.SHIFTED_X);

    return Object.freeze({
        fits: false,
        reason: PLACEMENT_REJECTIONS.EXCLUDE_CONFLICT,
        conflict
    });
}

function formatMm(value) {
    return `${roundToThree(value)}mm`;
}

/**
 * Human-readable rejection detail for the bounds error payload.
 * @param {{reason: string, conflict?: object}} placement Rejected placement.
 * @param {{x: number, y: number}} dimensions Model dimensions.
 * @param {{printable: object}} bedGeometry Bed geometry.
 * @returns {string[]} Bounded issue descriptions.
 */
function describePlacementRejection(placement, dimensions, bedGeometry) {
    const { printable } = bedGeometry;
    const width = printable.maxX - printable.minX;
    const depth = printable.maxY - printable.minY;
    if (placement.reason === PLACEMENT_REJECTIONS.EXCEEDS_PRINTABLE_AREA) {
        const issues = [];
        if (dimensions.x > width + PLACEMENT_EPSILON_MM) {
            issues.push(`X: ${formatMm(dimensions.x)} > ${formatMm(width)}`);
        }
        if (dimensions.y > depth + PLACEMENT_EPSILON_MM) {
            issues.push(`Y: ${formatMm(dimensions.y)} > ${formatMm(depth)}`);
        }
        return issues;
    }
    if (placement.reason === PLACEMENT_REJECTIONS.EXCLUDE_CONFLICT && placement.conflict) {
        const conflict = placement.conflict;
        return [
            `Footprint ${formatMm(dimensions.x)} x ${formatMm(dimensions.y)} cannot be placed on the `
            + `${formatMm(width)} x ${formatMm(depth)} printable area without overlapping the excluded `
            + `${formatMm(conflict.maxX - conflict.minX)} x ${formatMm(conflict.maxY - conflict.minY)} bed corner`
        ];
    }
    return ['Model footprint must be finite and positive.'];
}

/**
 * Validate model dimensions against placement-aware Bambu limits.
 * X/Y admission is decided by placement feasibility on the real bed shape;
 * Z and the minimum floor keep the generic per-axis comparison against the
 * published inclusive ceiling.
 * @param {{x: number, y: number, z: number}} dimensions Finite positive dimensions.
 * @param {{min: object, max: object, bedGeometry: object}} buildVolumeLimits Bambu limits.
 * @returns {{isValid: true, dimensions: object, placement: {xMin: number, yMin: number, strategy: string}}|{isValid: false, dimensions: object, tooSmall: string[], tooLarge: string[]}} Validation result.
 */
function validateBambuPlacementLimits(dimensions, buildVolumeLimits) {
    const tooSmall = [];
    const tooLarge = [];
    for (const axis of ['x', 'y', 'z']) {
        if (dimensions[axis] > 0 && dimensions[axis] < buildVolumeLimits.min[axis]) {
            tooSmall.push(`${axis.toUpperCase()}: ${formatMm(dimensions[axis])} < ${formatMm(buildVolumeLimits.min[axis])}`);
        }
    }
    if (dimensions.z > buildVolumeLimits.max.z) {
        tooLarge.push(`Z: ${formatMm(dimensions.z)} > ${formatMm(buildVolumeLimits.max.z)}`);
    }
    const placement = resolveBambuPlacement(dimensions, buildVolumeLimits.bedGeometry);
    if (!placement.fits) {
        tooLarge.push(...describePlacementRejection(placement, dimensions, buildVolumeLimits.bedGeometry));
    }
    if (tooSmall.length === 0 && tooLarge.length === 0) {
        return {
            isValid: true,
            dimensions,
            placement: { xMin: placement.xMin, yMin: placement.yMin, strategy: placement.strategy }
        };
    }
    return { isValid: false, dimensions, tooSmall, tooLarge };
}

module.exports = {
    PLACEMENT_EPSILON_MM,
    PLACEMENT_REJECTIONS,
    PLACEMENT_STRATEGIES,
    describePlacementRejection,
    rectanglesOverlap,
    rectangleWithin,
    resolveBambuPlacement,
    validateBambuPlacementLimits
};
