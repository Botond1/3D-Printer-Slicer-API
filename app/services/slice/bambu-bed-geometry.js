'use strict';

/**
 * Bambu Studio bed geometry derived from the flattened vendor machine snapshot.
 *
 * With `--arrange 0` Bambu Studio keeps the STL coordinates exactly, so the
 * API owns placement and needs the real bed shape rather than a bounding
 * triple. Three vendor keys matter:
 *
 * - `printable_area`: the plate polygon (`["0x0", "256x0", "256x256", "0x256"]`).
 * - `extruder_printable_area`: one polygon per extruder on dual-extruder
 *   machines, each written as one comma-separated string
 *   (`"0x0,325x0,325x320,0x320"`). A single-filament job can only use the
 *   FIRST extruder's area; the measured H2D admission confirmed it
 *   (`325 x 320` passes, `349` wide fails with rc 190).
 * - `bed_exclude_area`: a polygon the slicer refuses to print into (the P1S
 *   `18 x 28 mm` corner at the origin); an overlapping object fails with
 *   rc 192 `Object conflicts were detected`.
 *
 * Every polygon is reduced to its axis-aligned bounding rectangle. For the
 * printable area that is exact (the vendor plates are rectangles); for an
 * exclude polygon it is a conservative superset, which can only reject a
 * placement the slicer would have accepted, never the reverse.
 */

const { parseNumberLike } = require('./value-parsers');

/** Upper bound on polygon vertices accepted from a profile value. */
const MAX_POLYGON_POINTS = 64;
/** Upper bound on excluded rectangles accepted from a profile value. */
const MAX_EXCLUDE_RECTANGLES = 8;
const POINT_PATTERN = /^(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)$/i;

/**
 * Parse one `<x>x<y>` token into a point.
 * @param {unknown} token Candidate point token.
 * @returns {{x: number, y: number}|null} Parsed point or null.
 */
function parsePoint(token) {
    if (typeof token !== 'string' && typeof token !== 'number') return null;
    const match = POINT_PATTERN.exec(String(token).trim());
    if (!match) return null;
    const x = Number.parseFloat(match[1]);
    const y = Number.parseFloat(match[2]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Parse a polygon written either as an array of point tokens
 * (`printable_area`/`bed_exclude_area`) or as one comma-separated string
 * (each `extruder_printable_area` entry).
 * @param {unknown} value Profile value.
 * @returns {Array<{x: number, y: number}>} Parsed points (possibly empty).
 */
function parsePolygon(value) {
    const tokens = Array.isArray(value)
        ? value
        : typeof value === 'string' ? value.split(',') : [];
    if (tokens.length > MAX_POLYGON_POINTS) return [];
    const points = [];
    for (const token of tokens) {
        const point = parsePoint(token);
        if (!point) return [];
        points.push(point);
    }
    return points;
}

/**
 * Axis-aligned bounding rectangle of a polygon with a positive area.
 * @param {Array<{x: number, y: number}>} points Polygon vertices.
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null} Rectangle or null when degenerate.
 */
function boundingRectangle(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const rectangle = {
        minX: Math.min(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxX: Math.max(...points.map((point) => point.x)),
        maxY: Math.max(...points.map((point) => point.y))
    };
    if (!(rectangle.maxX > rectangle.minX) || !(rectangle.maxY > rectangle.minY)) return null;
    return Object.freeze(rectangle);
}

/**
 * Resolve the printable rectangle: the first extruder's area when the machine
 * declares per-extruder areas, otherwise the plate `printable_area`.
 * @param {Record<string, unknown>} profileData Flattened machine profile.
 * @returns {{rectangle: {minX: number, minY: number, maxX: number, maxY: number}, source: 'extruder_printable_area'|'printable_area'}|null} Printable rectangle and its source key.
 */
function resolvePrintableRectangle(profileData) {
    const extruderAreas = profileData.extruder_printable_area;
    if (Array.isArray(extruderAreas) && extruderAreas.length > 0) {
        const first = boundingRectangle(parsePolygon(extruderAreas[0]));
        if (first) return { rectangle: first, source: 'extruder_printable_area' };
    }
    const plate = boundingRectangle(parsePolygon(profileData.printable_area));
    return plate ? { rectangle: plate, source: 'printable_area' } : null;
}

/**
 * Resolve the excluded rectangles from `bed_exclude_area`. The vendor writes
 * one polygon; a nested array of polygons is tolerated for completeness.
 * @param {Record<string, unknown>} profileData Flattened machine profile.
 * @returns {ReadonlyArray<{minX: number, minY: number, maxX: number, maxY: number}>} Excluded rectangles.
 */
function resolveExcludeRectangles(profileData) {
    const raw = profileData.bed_exclude_area;
    if (!Array.isArray(raw) || raw.length === 0) return Object.freeze([]);
    const polygons = raw.every((entry) => Array.isArray(entry)) ? raw : [raw];
    if (polygons.length > MAX_EXCLUDE_RECTANGLES) {
        throw new Error('Bambu machine snapshot declares too many excluded bed areas.');
    }
    const rectangles = [];
    for (const polygon of polygons) {
        const rectangle = boundingRectangle(parsePolygon(polygon));
        if (rectangle) rectangles.push(rectangle);
    }
    return Object.freeze(rectangles);
}

/**
 * Derive the bed geometry from a flattened Bambu machine profile.
 * @param {Record<string, unknown>} profileData Flattened machine profile JSON.
 * @returns {Readonly<{printable: {minX: number, minY: number, maxX: number, maxY: number}, printableSource: string, excludes: ReadonlyArray<{minX: number, minY: number, maxX: number, maxY: number}>, printableHeight: number}>} Frozen bed geometry.
 */
function parseBambuBedGeometry(profileData) {
    if (!profileData || typeof profileData !== 'object' || Array.isArray(profileData)) {
        throw new Error('Bambu machine snapshot must be a JSON object.');
    }
    const printable = resolvePrintableRectangle(profileData);
    if (!printable) {
        throw new Error('Bambu machine snapshot declares no printable area.');
    }
    const printableHeight = parseNumberLike(profileData.printable_height);
    if (!Number.isFinite(printableHeight) || printableHeight <= 0) {
        throw new Error('Bambu machine snapshot declares no printable height.');
    }
    return Object.freeze({
        printable: printable.rectangle,
        printableSource: printable.source,
        excludes: resolveExcludeRectangles(profileData),
        printableHeight
    });
}

module.exports = {
    MAX_EXCLUDE_RECTANGLES,
    MAX_POLYGON_POINTS,
    boundingRectangle,
    parseBambuBedGeometry,
    parsePolygon
};
