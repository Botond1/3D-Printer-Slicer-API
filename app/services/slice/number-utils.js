/**
 * Shared numeric parsing helpers for slice modules.
 */

/**
 * Parse positive integer value with fallback.
 * @param {string | number | undefined} value Source value.
 * @param {number} fallback Fallback integer.
 * @returns {number} Parsed positive integer or fallback value.
 */
function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse a canonical positive decimal integer inside an inclusive range.
 * Runtime startup separately rejects invalid explicit resource settings; this
 * helper keeps module construction bounded before that startup gate executes.
 * @param {string | number | undefined} value Source value.
 * @param {number} fallback Safe fallback integer.
 * @param {{min: number, max: number}} range Inclusive accepted range.
 * @returns {number} Parsed bounded integer or fallback value.
 */
function parseBoundedPositiveInt(value, fallback, range) {
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) return fallback;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= range.min && parsed <= range.max
        ? parsed
        : fallback;
}

module.exports = {
    parsePositiveInt,
    parseBoundedPositiveInt
};
