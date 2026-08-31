'use strict';

const { DEFAULTS, MAX_CONCURRENT_SLICES_RANGE } = require('./constants');

const MiB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Repository safety defaults. These are not claims about host capacity.
 * Every explicit override is rejected unless it is a canonical positive
 * decimal integer inside the documented inclusive range.
 */
const RESOURCE_DEFINITIONS = Object.freeze({
    JSON_BODY_LIMIT: { default: MiB, min: 1_024, max: 10 * MiB },
    FORM_BODY_LIMIT: { default: MiB, min: 1_024, max: 10 * MiB },
    MAX_UPLOAD_BYTES: { default: 500 * MiB, min: 1, max: 500 * MiB },
    UPLOAD_TOTAL_TIMEOUT_MS: { default: 600_000, min: 1_000, max: 600_000 },
    MULTIPART_MAX_FIELDS: { default: 40, min: 35, max: 64 },
    MULTIPART_MAX_PARTS: { default: 42, min: 37, max: 66 },
    MULTIPART_MAX_FIELD_NAME_CHARS: { default: 64, min: 20, max: 256 },
    MULTIPART_MAX_FIELD_BYTES: { default: 65_536, min: 1_024, max: MiB },
    MAX_ZIP_ENTRIES: { default: 500, min: 1, max: 500 },
    MAX_ZIP_UNCOMPRESSED_BYTES: { default: 500 * MiB, min: 1, max: 500 * MiB },
    MAX_ZIP_ENTRY_BYTES: { default: 500 * MiB, min: 1, max: 500 * MiB },
    MAX_ZIP_COMPRESSION_RATIO: { default: 100, min: 1, max: 1_000 },
    MAX_ZIP_PATH_DEPTH: { default: 1, min: 1, max: 8 },
    MAX_3MF_PATH_DEPTH: { default: 4, min: 2, max: 8 },
    MAX_MODEL_FILE_BYTES: { default: 500 * MiB, min: 1, max: 500 * MiB },
    MAX_OUTPUT_BYTES: { default: 500 * MiB, min: 1, max: 500 * MiB },
    MAX_OUTPUT_PARSE_BYTES: { default: 4 * MiB, min: 64 * 1024, max: 16 * MiB },
    MAX_PROFILE_BYTES: { default: MiB, min: 1_024, max: 10 * MiB },
    MAX_PRICING_BYTES: { default: MiB, min: 1_024, max: 10 * MiB },
    MAX_PRINT_TIME_SECONDS: { default: 30 * 24 * 60 * 60, min: 1, max: 365 * 24 * 60 * 60 },
    MAX_MATERIAL_USED_METERS: { default: 10_000, min: 1, max: 100_000 },
    MAX_MATERIAL_USED_GRAMS: { default: 100_000, min: 1, max: 1_000_000 },
    MAX_MATERIAL_USED_ML: { default: 100_000, min: 1, max: 1_000_000 },
    MAX_HOURLY_PRICE_HUF: { default: 1_000_000, min: 1, max: 100_000_000 },
    MAX_MODEL_DIMENSION_MM: { default: 10_000, min: 350, max: 100_000 },
    ARTIFACT_TTL_MS: { default: DAY_MS, min: 60_000, max: 30 * DAY_MS },
    MAX_MANAGED_ARTIFACTS: { default: 500, min: 1, max: 5_000 },
    MAX_MANAGED_ARTIFACT_BYTES: { default: 500 * MiB, min: 1, max: 10 * 500 * MiB },
    PARTIAL_ARTIFACT_STALE_MS: { default: 60 * 60 * 1000, min: 60_000, max: DAY_MS },
    STARTUP_CLEANUP_MAX_ENTRIES: { default: 500, min: 1, max: 5_000 },
    STARTUP_CLEANUP_MAX_MS: { default: 1_000, min: 100, max: 10_000 },
    MAX_CONCURRENT_SLICES: {
        default: DEFAULTS.MAX_CONCURRENT_SLICES,
        min: MAX_CONCURRENT_SLICES_RANGE.min,
        max: MAX_CONCURRENT_SLICES_RANGE.max
    }
});

function parseCanonicalPositiveInteger(name, value, definition) {
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) {
        throw new Error(`${name} must be a canonical positive decimal integer.`);
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < definition.min || parsed > definition.max) {
        throw new Error(`${name} must be between ${definition.min} and ${definition.max}.`);
    }
    return parsed;
}

function resolveResourcePolicy(env = process.env, definitions = RESOURCE_DEFINITIONS) {
    const policy = {};
    for (const [name, definition] of Object.entries(definitions)) {
        const configured = env[name];
        if (configured === undefined) {
            if (definition.required) throw new Error(`${name} is required.`);
            policy[name] = definition.default;
            continue;
        }
        policy[name] = parseCanonicalPositiveInteger(name, configured, definition);
    }
    return Object.freeze(policy);
}

module.exports = {
    RESOURCE_DEFINITIONS,
    parseCanonicalPositiveInteger,
    resolveResourcePolicy
};
