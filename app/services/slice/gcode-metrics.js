/**
 * SZ-B2 — strict G-code metric extraction (print time and filament mass).
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * The legacy helpers in `model-stats.js` are *tolerant*: when none of the
 * `M73` / `; filament used` patterns matches, they return `0` seconds and `0`
 * metres and the request still answers `200 OK`. That is the single most
 * expensive failure mode this service has. A slicer upgrade that renames one
 * comment line does not produce an outage — it produces a *quote* built on
 * "0 hours, 0 grams", which is a wrong price sent to a customer. Nobody looks
 * at a successful response.
 *
 * So the rule here is the opposite one: if the numbers cannot be read with
 * certainty, this module THROWS. A 500 is recoverable (retry, manual quote);
 * a silent zero is not.
 *
 * Each metric also reports WHICH pattern matched (`source`). The regression
 * test pins those identifiers against a captured OrcaSlicer 2.3.1 output, so a
 * future drift shows up as "matched a different, weaker pattern" rather than
 * only as "matched nothing".
 */

/** Error codes emitted by {@link parseGcodeMetricsStrict}. */
const GCODE_METRIC_ERROR_CODES = Object.freeze({
    TIME_UNPARSED: 'GCODE_TIME_UNPARSED',
    TIME_NOT_POSITIVE: 'GCODE_TIME_NOT_POSITIVE',
    FILAMENT_UNPARSED: 'GCODE_FILAMENT_UNPARSED',
    FILAMENT_NOT_POSITIVE: 'GCODE_FILAMENT_NOT_POSITIVE',
    EMPTY_CONTENT: 'GCODE_EMPTY_CONTENT'
});

/** Error raised when a slicer output cannot be measured with confidence. */
class GcodeMetricsError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'GcodeMetricsError';
        this.code = code;
        this.errorCode = 'SLICE_OUTPUT_UNPARSED';
        this.status = 500;
    }
}

/** Parse a duration string into whole seconds. */
function parseDurationText(timeText) {
    const text = String(timeText || '').trim();
    if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
    const match = /^(?:(\d+)\s*d\s*)?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+)\s*s\s*)?$/i.exec(text);
    if (!match || !match.slice(1).some((value) => value !== undefined)) return 0;
    return [86400, 3600, 60, 1].reduce(
        (seconds, multiplier, index) => seconds + Number.parseInt(match[index + 1] || '0', 10) * multiplier,
        0
    );
}

/**
 * Detect a thousands-grouped number split across two comma-list entries.
 * Ambiguous shapes are deliberately refused rather than guessed.
 */
function looksLikeThousandsGrouping(part, previousPart) {
    if (previousPart === undefined) return false;
    return /^\d{1,3}$/.test(previousPart) && /^\d{3}(?:\.\d+)?$/.test(part);
}

/**
 * Sum a comma-separated numeric list used for multi-extruder output.
 * Empty, unreadable, or thousands-ambiguous entries fail closed.
 */
function sumNumericList(rawList) {
    const parts = String(rawList || '').split(',').map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;

    let total = 0;
    for (const [index, part] of parts.entries()) {
        if (!/^\d+(?:\.\d+)?$/.test(part)) return null;
        if (looksLikeThousandsGrouping(part, parts[index - 1])) return null;
        total += Number.parseFloat(part);
    }
    return Number.isFinite(total) ? total : null;
}

/** Ordered print-time patterns, strongest first. */
const PRINT_TIME_PATTERNS = Object.freeze([
    {
        id: 'm73_p0_r_minutes',
        regex: /^M73 P0 R(\d+)\s*$/im,
        toSeconds: (match) => Number.parseInt(match[1], 10) * 60
    },
    {
        id: 'estimated_printing_time',
        regex: /^;\s*estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\r\n]+)$/im,
        toSeconds: (match) => parseDurationText(match[1])
    },
    {
        id: 'total_estimated_time',
        regex: /^;\s*total estimated time\s*[:=]\s*([^\r\n]+)$/im,
        toSeconds: (match) => parseDurationText(match[1])
    },
    {
        id: 'time_seconds',
        regex: /^;\s*TIME\s*[:=]\s*(\d+)\s*$/im,
        toSeconds: (match) => Number.parseInt(match[1], 10)
    }
]);

/** Ordered filament-mass patterns. Grams is the billing unit. */
const FILAMENT_GRAM_PATTERNS = Object.freeze([
    {
        id: 'filament_used_g',
        regex: /^;\s*filament used \[g\]\s*=\s*([0-9.,\s]+?)\s*$/im,
        toGrams: (match) => sumNumericList(match[1])
    },
    {
        id: 'total_filament_used_g',
        regex: /^;\s*total filament used \[g\]\s*[:=]\s*([0-9.,\s]+?)\s*$/im,
        toGrams: (match) => sumNumericList(match[1])
    },
    {
        id: 'filament_used_grams_word',
        regex: /^;\s*filament used\s*\(g\)\s*[:=]\s*([0-9.,\s]+?)\s*$/im,
        toGrams: (match) => sumNumericList(match[1])
    }
]);

/** Ordered filament-length patterns. */
const FILAMENT_LENGTH_PATTERNS = Object.freeze([
    {
        id: 'filament_used_mm',
        regex: /^;\s*filament used \[mm\]\s*=\s*([0-9.,\s]+?)\s*$/im,
        toMillimeters: (match) => sumNumericList(match[1])
    },
    {
        id: 'total_filament_used_mm',
        regex: /^;\s*total filament used \[mm\]\s*[:=]\s*([0-9.,\s]+?)\s*$/im,
        toMillimeters: (match) => sumNumericList(match[1])
    },
    {
        id: 'filament_used_m',
        regex: /^;\s*filament used \[m\]\s*[:=]\s*([0-9.,\s]+?)\s*$/im,
        toMillimeters: (match) => {
            const metres = sumNumericList(match[1]);
            return metres === null ? null : metres * 1000;
        }
    }
]);

function matchOrdered(content, patterns, converterKey) {
    for (const pattern of patterns) {
        const match = pattern.regex.exec(content);
        if (!match) continue;
        const value = pattern[converterKey](match);
        if (value === null || !Number.isFinite(value)) continue;
        return { value, source: pattern.id };
    }
    return null;
}

/**
 * Extract print time and filament mass from a G-code body, or throw.
 * @param {string} content Full G-code text content.
 * @param {{requireFilamentGrams?: boolean}} [options] Extraction options.
 * @returns {{print_time_seconds:number,print_time_source:string,filament_used_g:number|null,filament_used_g_source:string|null,filament_used_mm:number|null,filament_used_mm_source:string|null}}
 */
function parseGcodeMetricsStrict(content, options = {}) {
    const { requireFilamentGrams = true } = options;
    const text = typeof content === 'string' ? content : '';
    if (text.trim().length === 0) {
        throw new GcodeMetricsError(
            GCODE_METRIC_ERROR_CODES.EMPTY_CONTENT,
            'The slicer produced an empty output file; no metric could be read.'
        );
    }

    const time = matchOrdered(text, PRINT_TIME_PATTERNS, 'toSeconds');
    if (time === null) {
        throw new GcodeMetricsError(
            GCODE_METRIC_ERROR_CODES.TIME_UNPARSED,
            'No known print-time marker matched the slicer output ' +
            `(expected one of: ${PRINT_TIME_PATTERNS.map((pattern) => pattern.id).join(', ')}). ` +
            'Refusing to report 0 seconds, which would price the job as free.'
        );
    }
    if (time.value <= 0) {
        throw new GcodeMetricsError(
            GCODE_METRIC_ERROR_CODES.TIME_NOT_POSITIVE,
            `The print-time marker "${time.source}" reported ${time.value} seconds.`
        );
    }

    const length = matchOrdered(text, FILAMENT_LENGTH_PATTERNS, 'toMillimeters');
    const grams = matchOrdered(text, FILAMENT_GRAM_PATTERNS, 'toGrams');
    if (grams === null) {
        if (requireFilamentGrams) {
            throw new GcodeMetricsError(
                GCODE_METRIC_ERROR_CODES.FILAMENT_UNPARSED,
                'No known filament-mass marker matched the slicer output ' +
                `(expected one of: ${FILAMENT_GRAM_PATTERNS.map((pattern) => pattern.id).join(', ')}). ` +
                'Grams is the billing unit — refusing to report 0 g.'
            );
        }
        return {
            print_time_seconds: time.value,
            print_time_source: time.source,
            filament_used_g: null,
            filament_used_g_source: null,
            filament_used_mm: length === null ? null : length.value,
            filament_used_mm_source: length === null ? null : length.source
        };
    }
    if (grams.value <= 0) {
        throw new GcodeMetricsError(
            GCODE_METRIC_ERROR_CODES.FILAMENT_NOT_POSITIVE,
            `The filament-mass marker "${grams.source}" reported ${grams.value} g.`
        );
    }

    return {
        print_time_seconds: time.value,
        print_time_source: time.source,
        filament_used_g: grams.value,
        filament_used_g_source: grams.source,
        filament_used_mm: length === null ? null : length.value,
        filament_used_mm_source: length === null ? null : length.source
    };
}

module.exports = {
    FILAMENT_GRAM_PATTERNS,
    FILAMENT_LENGTH_PATTERNS,
    GCODE_METRIC_ERROR_CODES,
    GcodeMetricsError,
    PRINT_TIME_PATTERNS,
    looksLikeThousandsGrouping,
    parseDurationText,
    parseGcodeMetricsStrict,
    sumNumericList
};
