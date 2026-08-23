/**
 * Model metadata and slicing output statistics parsing.
 */

const fs = require('node:fs/promises');
const { DEFAULTS } = require('../../config/constants');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { runCommand, throwIfAborted, isAbortError } = require('./command');
const { resourceLimit, invalidStats } = require('./resource-errors');
const { parseSl1Stats } = require('./sl1-stats');

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
 * @returns {Promise<{x: number, y: number, z: number, height_mm: number}>} Parsed size metrics.
 */
async function getModelInfo(filePath, signal) {
    throwIfAborted(signal);
    try {
        const { stdout } = await runCommand('prusa-slicer', ['--info', filePath], { signal });
        throwIfAborted(signal);
        let x = 0;
        let y = 0;
        let z = 0;

        const matchX = /size_x\s*=\s*([0-9.]+)/i.exec(stdout);
        const matchY = /size_y\s*=\s*([0-9.]+)/i.exec(stdout);
        const matchZ = /size_z\s*=\s*([0-9.]+)/i.exec(stdout);

        if (matchX) x = Number(matchX[1]);
        if (matchY) y = Number(matchY[1]);
        if (matchZ) z = Number(matchZ[1]);
        const policy = resolveResourcePolicy();
        if (![x, y, z].every((value) => Number.isFinite(value) && value >= 0 && value <= policy.MAX_MODEL_DIMENSION_MM)) {
            return { x: 0, y: 0, z: 0, height_mm: 0 };
        }

        return { x, y, z, height_mm: z };
    } catch (err) {
        if (isAbortError(err, signal)) {
            throwIfAborted(signal);
            throw err;
        }
        return { x: 0, y: 0, z: 0, height_mm: 0 };
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
 * Parse FDM-specific output metadata from generated G-code.
 * @param {{print_time_seconds: number, print_time_readable: string, material_used_m: number}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} filePath Output file path.
 * @param {'prusa'|'orca'} [engine='prusa'] Engine identifier.
 * @returns {void}
 */
async function parseFdmOutputStats(stats, technology, filePath, engine = 'prusa', policy = resolveResourcePolicy()) {
    if (technology !== 'FDM') return;
    try {
        const content = await readBoundedText(filePath, policy.MAX_OUTPUT_PARSE_BYTES);
        const printTime = extractPrintTimeFromGcode(content);
        stats.print_time_seconds = printTime.print_time_seconds;
        stats.print_time_readable = printTime.print_time_readable;
        stats.material_used_m = extractMaterialUsedMetersFromGcode(content);

    } catch (error_) {
        if (error_?.code === 'SLICE_RESOURCE_LIMIT_EXCEEDED') throw error_;
        throw invalidStats('Slicer statistics could not be parsed.');
    }
}

/**
 * Backfill SLA print-time estimate when explicit metadata is missing.
 * @param {{print_time_seconds: number, object_height_mm: number}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number|string} layerHeight Active layer height.
 * @returns {void}
 */
function applySlaEstimateIfNeeded(stats, technology, layerHeight) {
    if (technology !== 'SLA' || stats.print_time_seconds > 0 || stats.object_height_mm <= 0) return;

    const totalLayers = Math.ceil(
        stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), DEFAULTS.SLA_MIN_LAYER_HEIGHT_MM)
    );
    const secondsPerLayer = DEFAULTS.SLA_SECONDS_PER_LAYER;
    const baseTime = DEFAULTS.SLA_BASE_TIME_SECONDS;
    stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
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
 * @returns {Promise<{print_time_seconds: number, print_time_readable: string, material_used_m: number, object_height_mm: number, estimated_price_huf: number}>}
 */
async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight, engine = 'prusa') {
    const policy = resolveResourcePolicy();
    const stats = {
        print_time_seconds: 0,
        print_time_readable: 'Unknown',
        material_used_m: 0,
        material_used_ml: 0,
        object_height_mm: Number.isFinite(Number(knownHeight)) ? Number(knownHeight) : 0,
        estimated_price_huf: 0
    };

    await parseFdmOutputStats(stats, technology, filePath, engine, policy);
    if (technology === 'SLA') {
        const slaStats = await parseSl1Stats(filePath, { resourcePolicy: policy });
        stats.material_used_ml = slaStats.material_used_ml;
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
    if (stats.material_used_ml > policy.MAX_MATERIAL_USED_ML) {
        throw invalidStats('Slicer resin usage is outside the allowed range.');
    }
    if (stats.object_height_mm <= 0 || stats.object_height_mm > policy.MAX_MODEL_DIMENSION_MM) {
        throw invalidStats('Slicer object height is missing or outside the allowed range.');
    }
    if (technology === 'FDM' && stats.material_used_m <= 0) {
        throw invalidStats('FDM output is missing required material usage.');
    }
    if (technology === 'SLA' && stats.material_used_ml <= 0) {
        throw invalidStats('SLA output is missing required material usage.');
    }
    return stats;
}

module.exports = {
    getModelInfo,
    parseOutputDetailed,
    validateSliceStats,
    readBoundedText,
    extractPrintTimeFromGcode,
    extractMaterialUsedMetersFromGcode
};
