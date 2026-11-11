'use strict';

class SliceResourceError extends Error {
    constructor(code, message, status = 422) {
        super(message);
        this.name = 'SliceResourceError';
        this.code = code;
        this.status = status;
    }
}

function resourceLimit(message) {
    return new SliceResourceError('SLICE_RESOURCE_LIMIT_EXCEEDED', message, 413);
}

function invalidArchive(message) {
    return new SliceResourceError('INVALID_SOURCE_ARCHIVE', message, 400);
}

function invalidOutput(message) {
    return new SliceResourceError('INVALID_SLICE_OUTPUT', message, 422);
}

function invalidStats(message) {
    return new SliceResourceError('INVALID_SLICE_STATS', message, 422);
}

/**
 * The closed `archive_rule` vocabulary of the 3.9.0 contract (§2.5). A label
 * never changes an error's code or status; it is copied into the response
 * body next to the existing `errorCode` only.
 */
const ARCHIVE_RULES = Object.freeze([
    'ARCHIVE_UNREADABLE',
    'ARCHIVE_ENCRYPTED',
    'ARCHIVE_UNSAFE_PATH',
    'ARCHIVE_NESTED',
    'ARCHIVE_DISALLOWED_PART',
    'ARCHIVE_TOO_MANY_ENTRIES',
    'ARCHIVE_TOO_LARGE',
    'ARCHIVE_RATIO_EXCEEDED',
    'ARCHIVE_EXPANSION_EXCEEDED'
]);

/**
 * Attach an archive rule label to an error as plain properties. The first
 * label wins, so an inner check's precise rule is not overwritten by an
 * outer catch.
 * @template {Error} T
 * @param {T} error Error to label.
 * @param {string} rule One of `ARCHIVE_RULES`.
 * @param {number|null} [limit] Limit that was passed, or null.
 * @returns {T} The same error.
 */
function labelArchiveError(error, rule, limit = null) {
    if (!error || typeof error !== 'object' || !ARCHIVE_RULES.includes(rule)) return error;
    if (error.archiveRule === undefined) {
        error.archiveRule = rule;
        error.archiveLimit = Number.isFinite(limit) ? limit : null;
    }
    return error;
}

/**
 * The two additive body keys of an archive refusal, or nothing.
 * @param {unknown} error Processing error.
 * @returns {{archive_rule: string, archive_limit: number|null}|{}} Body keys.
 */
function archiveBodyKeys(error) {
    if (!error || !ARCHIVE_RULES.includes(error.archiveRule)) return {};
    return {
        archive_rule: error.archiveRule,
        archive_limit: Number.isFinite(error.archiveLimit) ? error.archiveLimit : null
    };
}

module.exports = {
    ARCHIVE_RULES,
    archiveBodyKeys,
    labelArchiveError,
    SliceResourceError,
    resourceLimit,
    invalidArchive,
    invalidOutput,
    invalidStats
};
