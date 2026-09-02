/**
 * Model metadata and slicing output statistics parsing.
 */

const fs = require('node:fs/promises');
const { DEFAULTS } = require('../../config/constants');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { runCommand, throwIfAborted, isAbortError } = require('./command');
const { resourceLimit, invalidStats } = require('./resource-errors');
const { parseSl1Stats } = require('./sl1-stats');
const {
    FILAMENT_GRAM_PATTERNS,
    GcodeMetricsError,
    parseGcodeMetricsStrict
} = require('./gcode-metrics');

const MODEL_INFO_MEASUREMENT_STATUSES = Object.freeze({
    MEASURED: 'measured',
    UNAVAILABLE: 'unavailable'
});

function createUnavailableModelMeasurement() {
    return Object.freeze({
        status: MODEL_INFO_MEASUREMENT_STATUSES.UNAVAILABLE,
        modelInfo: null
    });
}

function createMeasuredModelMeasurement(modelInfo) {
    const normalized = {
        x: Number(modelInfo?.x),
        y: Number(modelInfo?.y),
        z: Number(modelInfo?.z)
    };
    normalized.height_mm = Object.hasOwn(modelInfo || {}, 'height_mm')
        ? Number(modelInfo.height_mm)
        : normalized.z;
    if (
        Object.values(normalized).some((value) => !Number.isFinite(value) || value < 0)
        || normalized.height_mm !== normalized.z
    ) {
        throw new Error('Measured model information is invalid.');
    }
    return Object.freeze({
        status: MODEL_INFO_MEASUREMENT_STATUSES.MEASURED,
        modelInfo: Object.freeze(normalized)
    });
}

function isModelMeasurement(measurement) {
    if (
        measurement?.status !== MODEL_INFO_MEASUREMENT_STATUSES.MEASURED
        || !measurement.modelInfo
        || typeof measurement.modelInfo !== 'object'
    ) return false;
    const values = ['x', 'y', 'z', 'height_mm'].map(
        (field) => measurement.modelInfo[field]
    );
    return values.every((value) => Number.isFinite(value) && value >= 0)
        && measurement.modelInfo.height_mm === measurement.modelInfo.z;
}

function isPositiveModelMeasurement(measurement) {
    return isModelMeasurement(measurement)
        && ['x', 'y', 'z', 'height_mm'].every(
            (field) => measurement.modelInfo[field] > 0
        );
}

/**
 * Strict G-code metrics are the default and only an explicit `false` selects
 * the historical tolerant parser during a controlled drift investigation.
 * @param {NodeJS.ProcessEnv|Record<string, unknown>} [environment=process.env] Environment source.
 * @returns {boolean} True when metric drift must fail closed.
 */
function isStrictGcodeMetricsEnabled(environment = process.env) {
    return String(environment.SLICE_STRICT_GCODE_METRICS || 'true').trim().toLowerCase() !== 'false';
}

async function readBoundedText(filePath, maximumBytes) {
    const handle = await fs.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 0) {
            throw resourceLimit('File exceeds the bounded text-read envelope.');
        }
        const readBytes = Math.min(stat.size, maximumBytes);
        if (stat.size <= maximumBytes) {
            const buffer = Buffer.alloc(readBytes);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return buffer.subarray(0, bytesRead).toString('utf8');
        }
        const headBytes = Math.floor(readBytes / 2);
        const tailBytes = readBytes - headBytes;
        const head = Buffer.alloc(headBytes);
        const tail = Buffer.alloc(tailBytes);
        const first = await handle.read(head, 0, head.length, 0);
        const last = await handle.read(tail, 0, tail.length, stat.size - tailBytes);
        return `${head.subarray(0, first.bytesRead).toString('utf8')}\n${tail.subarray(0, last.bytesRead).toString('utf8')}`;
    } finally {
        await handle.close();
    }
}

/**
 * Read model dimensions from `prusa-slicer --info` output.
 * @param {string} filePath Path to mesh file.
 * @returns {Promise<
 *   {status: 'measured', modelInfo: {x: number, y: number, z: number, height_mm: number}}
 *   | {status: 'unavailable', modelInfo: null}
 * >} Explicit measurement result. A parsed zero-sized model remains distinct from an unavailable measurement.
 */
async function getModelInfo(filePath, signal) {
    throwIfAborted(signal);
    try {
        const { stdout } = await runCommand('prusa-slicer', ['--info', filePath], { signal });
        throwIfAborted(signal);
        const matchX = /size_x\s*=\s*([0-9.]+)/i.exec(stdout);
        const matchY = /size_y\s*=\s*([0-9.]+)/i.exec(stdout);
        const matchZ = /size_z\s*=\s*([0-9.]+)/i.exec(stdout);
        if (!matchX || !matchY || !matchZ) return createUnavailableModelMeasurement();
        const [x, y, z] = [matchX, matchY, matchZ].map((match) => Number(match[1]));
        const policy = resolveResourcePolicy();
        if (![x, y, z].every((value) => Number.isFinite(value) && value >= 0 && value <= policy.MAX_MODEL_DIMENSION_MM)) {
            return createUnavailableModelMeasurement();
        }
        return createMeasuredModelMeasurement({ x, y, z, height_mm: z });
    } catch (err) {
        if (isAbortError(err, signal)) {
            throwIfAborted(signal);
            throw err;
        }
        return createUnavailableModelMeasurement();
    }
}

/**
 * Parse duration string (e.g. `1h 20m 10s`) into total seconds.
 * @param {string} timeStr Human-readable duration text.
 * @returns {number} Duration in seconds.
 */
function parseTimeString(timeStr) {
    let seconds = 0;
    if (/^\d+$/.test(timeStr)) return Number.parseInt(timeStr, 10);

    const days = /(\d+)\s*d/i.exec(timeStr);
    const hours = /(\d+)\s*h/i.exec(timeStr);
    const mins = /(\d+)\s*m/i.exec(timeStr);
    const secs = /(\d+)\s*s/i.exec(timeStr);
    if (days) seconds += Number.parseInt(days[1], 10) * 86400;
    if (hours) seconds += Number.parseInt(hours[1], 10) * 3600;
    if (mins) seconds += Number.parseInt(mins[1], 10) * 60;
    if (secs) seconds += Number.parseInt(secs[1], 10);

    return seconds;
}

/**
 * Extract print-time metadata from G-code comment blocks.
 * @param {string} content Full G-code text content.
 * @returns {{print_time_seconds: number, print_time_readable: string}} Parsed print time payload.
 */
function extractPrintTimeFromGcode(content) {
    const m73Match = /M73 P0 R(\d+)/i.exec(content);
    if (m73Match) {
        const seconds = Number.parseInt(m73Match[1], 10) * 60;
        return {
            print_time_seconds: seconds,
            print_time_readable: `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
        };
    }

    const timePatterns = [
        /;\s*estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\r\n]+)/i,
        /;\s*total estimated time\s*[:=]\s*([^\r\n]+)/i,
        /;\s*print(?:ing)?_?time(?:_seconds)?\s*[:=]\s*([^\r\n]+)/i,
        /;\s*TIME\s*:\s*(\d+)/i,
        /;\s*PRINT_TIME\s*[:=]\s*(\d+)/i
    ];

    for (const pattern of timePatterns) {
        const timeMatch = pattern.exec(content);
        if (!timeMatch) continue;

        const rawTime = String(timeMatch[1] || '').trim();
        const parsedSeconds = parseTimeString(rawTime);
        if (parsedSeconds <= 0) continue;

        return {
            print_time_seconds: parsedSeconds,
            print_time_readable: rawTime
        };
    }

    return {
        print_time_seconds: 0,
        print_time_readable: 'Unknown'
    };
}

/**
 * Extract material usage in meters from G-code metadata comments.
 * @param {string} content Full G-code text content.
 * @returns {number} Material usage in meters.
 */
function extractMaterialUsedMetersFromGcode(content) {
    const filamentPatterns = [
        { regex: /;\s*filament used \[mm\]\s*=\s*([0-9.]+)/i, multiplier: 1 / 1000 },
        { regex: /;\s*total filament used \[mm\]\s*[:=]\s*([0-9.]+)/i, multiplier: 1 / 1000 },
        { regex: /;\s*filament used \[m\]\s*[:=]\s*([0-9.]+)/i, multiplier: 1 },
        { regex: /;\s*material_used_m\s*[:=]\s*([0-9.]+)/i, multiplier: 1 }
    ];

    for (const pattern of filamentPatterns) {
        const filMatch = pattern.regex.exec(content);
        if (!filMatch) continue;

        const materialUsed = Number.parseFloat(filMatch[1]) * pattern.multiplier;
        if (materialUsed > 0) return materialUsed;
    }

    return 0;
}

/**
 * Extract the slicer's directly reported mass for the explicit legacy-parser
 * escape hatch. This never derives grams from length or material constants.
 * @param {string} content Full G-code text content.
 * @returns {number} Positive grams when a supported marker is present, otherwise zero.
 */
function extractMaterialUsedGramsFromGcode(content) {
    for (const pattern of FILAMENT_GRAM_PATTERNS) {
        const match = pattern.regex.exec(content);
        if (!match) continue;
        const grams = pattern.toGrams(match);
        if (Number.isFinite(grams) && grams > 0) return grams;
    }
    return 0;
}

/**
 * Parse FDM-specific output metadata from generated G-code.
 * @param {{print_time_seconds: number, print_time_readable: string, material_used_m: number, material_used_g: number|null}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} filePath Output file path.
 * @param {'prusa'|'orca'|'bambu'} [engine='prusa'] Engine identifier; selects the strict print-time ranking.
 * @returns {void}
 */
async function parseFdmOutputStats(
    stats,
    technology,
    filePath,
    engine = 'prusa',
    policy = resolveResourcePolicy(),
    options = {}
) {
    if (technology !== 'FDM') return;
    stats.material_used_g = null;
    stats.material_used_g_source = null;
    try {
        const content = await readBoundedText(filePath, policy.MAX_OUTPUT_PARSE_BYTES);
        if (isStrictGcodeMetricsEnabled()) {
            const metrics = parseGcodeMetricsStrict(content, {
                requireFilamentGrams: options.requireFilamentGrams ?? engine === 'orca',
                engine
            });
            stats.print_time_seconds = metrics.print_time_seconds;
            stats.print_time_source = metrics.print_time_source;
            stats.material_used_g = metrics.filament_used_g;
            stats.material_used_g_source = metrics.filament_used_g_source;
            stats.material_used_m = metrics.filament_used_mm === null
                ? 0
                : metrics.filament_used_mm / 1000;
            return;
        }
        const printTime = extractPrintTimeFromGcode(content);
        stats.print_time_seconds = printTime.print_time_seconds;
        stats.print_time_readable = printTime.print_time_readable;
        stats.material_used_m = extractMaterialUsedMetersFromGcode(content);
        const directGrams = extractMaterialUsedGramsFromGcode(content);
        stats.material_used_g = directGrams > 0 ? directGrams : null;

    } catch (error_) {
        if (error_?.code === 'SLICE_RESOURCE_LIMIT_EXCEEDED') throw error_;
        if (error_ instanceof GcodeMetricsError) throw error_;
        throw invalidStats('Slicer statistics could not be parsed.');
    }
}

/** Bounded provenance labels for SLA print time; neither is a measured value. */
const SLA_PRINT_TIME_SOURCES = Object.freeze({
    SYNTHETIC_ESTIMATE: 'sla_synthetic_estimate',
    SL1_METADATA_ESTIMATE: 'sla_sl1_metadata_estimate'
});

/**
 * Backfill SLA print-time estimate when explicit metadata is missing.
 * The SLA path is not backed by a supported printer yet, so any SLA print
 * time is an estimate only: either the synthetic per-layer model or the
 * uncalibrated SL1 metadata value. `print_time_source` records which.
 * @param {{print_time_seconds: number, object_height_mm: number, print_time_source: string|null}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number|string} layerHeight Active layer height.
 * @returns {void}
 */
function applySlaEstimateIfNeeded(stats, technology, layerHeight) {
    if (technology !== 'SLA') return;
    if (stats.print_time_seconds > 0) {
        stats.print_time_source = SLA_PRINT_TIME_SOURCES.SL1_METADATA_ESTIMATE;
        return;
    }
    if (stats.object_height_mm <= 0) return;

    const totalLayers = Math.ceil(
        stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), DEFAULTS.SLA_MIN_LAYER_HEIGHT_MM)
    );
    const secondsPerLayer = DEFAULTS.SLA_SECONDS_PER_LAYER;
    const baseTime = DEFAULTS.SLA_BASE_TIME_SECONDS;
    stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
    stats.print_time_source = SLA_PRINT_TIME_SOURCES.SYNTHETIC_ESTIMATE;
}

/**
 * Build normalized human-readable print time string from seconds.
 * @param {{print_time_seconds: number, print_time_readable: string}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {void}
 */
function finalizeReadableTime(stats, technology) {
    if (stats.print_time_seconds <= 0) return;

    const h = Math.floor(stats.print_time_seconds / 3600);
    const m = Math.floor((stats.print_time_seconds % 3600) / 60);
    stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
}

/**
 * Build normalized print statistics from generated slicer output.
 * @param {string} filePath Output path to `.gcode` or `.sl1` artifact.
 * @param {'FDM' | 'SLA'} technology Active print technology.
 * @param {number|string} layerHeight Requested layer height.
 * @param {number} knownHeight Known model height in millimeters.
 * @param {'prusa'|'orca'} engine Slicer engine.
 * @param {{requireFilamentGrams?: boolean}} [options] Exact native mass requirement.
 * @returns {Promise<{print_time_seconds: number, print_time_readable: string, material_used_m: number, material_used_g: number|null, object_height_mm: number, estimated_price_huf: number}>}
 */
async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight, engine = 'prusa', options = {}) {
    const policy = resolveResourcePolicy();
    const stats = {
        print_time_seconds: 0,
        print_time_readable: 'Unknown',
        material_used_m: 0,
        material_used_g: 0,
        print_time_source: null,
        material_used_g_source: null,
        material_used_ml: 0,
        object_height_mm: Number.isFinite(Number(knownHeight)) ? Number(knownHeight) : 0,
        estimated_price_huf: 0
    };

    await parseFdmOutputStats(stats, technology, filePath, engine, policy, options);
    if (technology === 'SLA') {
        const slaStats = await parseSl1Stats(filePath, { resourcePolicy: policy });
        stats.material_used_ml = slaStats.material_used_ml;
        // Resin mass is never measured on the SLA path; a zero would read as
        // a real quantity, so the field is explicitly unavailable.
        stats.material_used_g = null;
        stats.material_used_g_source = null;
        if (slaStats.print_time_seconds > 0) stats.print_time_seconds = slaStats.print_time_seconds;
    }
    applySlaEstimateIfNeeded(stats, technology, layerHeight);
    finalizeReadableTime(stats, technology);
    return validateSliceStats(stats, technology, policy);
}

function validateSliceStats(stats, technology, policy = resolveResourcePolicy()) {
    const numericFields = [
        'print_time_seconds', 'material_used_m', 'material_used_ml',
        'object_height_mm', 'estimated_price_huf'
    ];
    if (!numericFields.every((field) => Number.isFinite(stats[field]) && stats[field] >= 0)) {
        throw invalidStats('Slicer statistics contain non-finite or negative values.');
    }
    if (stats.print_time_seconds <= 0 || stats.print_time_seconds > policy.MAX_PRINT_TIME_SECONDS) {
        throw invalidStats('Slicer print time is missing or outside the allowed range.');
    }
    if (stats.material_used_m > policy.MAX_MATERIAL_USED_METERS) {
        throw invalidStats('Slicer material usage is outside the allowed range.');
    }
    if (stats.material_used_g !== null &&
        (!Number.isFinite(stats.material_used_g) || stats.material_used_g < 0)) {
        throw invalidStats('Slicer material mass is invalid.');
    }
    if (stats.material_used_g !== null && stats.material_used_g > policy.MAX_MATERIAL_USED_GRAMS) {
        throw invalidStats('Slicer material mass is outside the allowed range.');
    }
    if (stats.material_used_ml > policy.MAX_MATERIAL_USED_ML) {
        throw invalidStats('Slicer resin usage is outside the allowed range.');
    }
    if (stats.object_height_mm <= 0 || stats.object_height_mm > policy.MAX_MODEL_DIMENSION_MM) {
        throw invalidStats('Slicer object height is missing or outside the allowed range.');
    }
    if (technology === 'FDM' && stats.material_used_m <= 0) {
        throw invalidStats('FDM output is missing required material usage.');
    }
    if (technology === 'FDM' && stats.material_used_g === 0) {
        throw invalidStats('FDM output is missing required material mass.');
    }
    if (technology === 'SLA' && stats.material_used_ml <= 0) {
        throw invalidStats('SLA output is missing required material usage.');
    }
    if (technology === 'SLA' && stats.material_used_g !== null) {
        throw invalidStats('SLA output must not publish a resin mass.');
    }
    if (technology === 'SLA' && !Object.values(SLA_PRINT_TIME_SOURCES).includes(stats.print_time_source)) {
        throw invalidStats('SLA print time must be marked as an estimate.');
    }
    return stats;
}

module.exports = {
    MODEL_INFO_MEASUREMENT_STATUSES,
    SLA_PRINT_TIME_SOURCES,
    applySlaEstimateIfNeeded,
    createMeasuredModelMeasurement,
    createUnavailableModelMeasurement,
    getModelInfo,
    isModelMeasurement,
    isPositiveModelMeasurement,
    parseOutputDetailed,
    validateSliceStats,
    readBoundedText,
    extractPrintTimeFromGcode,
    extractMaterialUsedGramsFromGcode,
    extractMaterialUsedMetersFromGcode,
    isStrictGcodeMetricsEnabled
};
