'use strict';

/** Deterministic identity for the effective profile layers used by a slice. */

const crypto = require('node:crypto');
const { readProfileText, readProfileJson } = require('./profile-readers');
const { resolveSlicerInvocationPolicy } = require('./engine');

const DIGEST_SCHEMA = 'r3d-effective-slice-profile-v1';
const PRUSA_REQUEST_OVERRIDE_KEYS = Object.freeze(new Set(['layer_height', 'fill_density']));
const PRUSA_SLA_REQUEST_OVERRIDE_KEYS = Object.freeze(new Set(['layer_height']));
const ORCA_REQUEST_OVERRIDE_KEYS = Object.freeze(new Set(['layer_height', 'sparse_infill_density']));

/**
 * Recursively sort object keys while retaining array order.
 * @param {unknown} value JSON-compatible value.
 * @returns {unknown} Canonical JSON-compatible value.
 */
function canonicalizeJsonValue(value) {
    if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, canonicalizeJsonValue(value[key])])
    );
}

/**
 * Convert an INI profile into its effective, order-independent key/value form.
 * Exact duplicate keys fail closed, matching the native Boost INI parser.
 * @param {string} content INI profile text.
 * @returns {{entries: Array<[string, string, string]>, directives: string[]}} Canonical INI payload.
 */
function canonicalizeIni(content) {
    const values = new Map();
    const directives = [];
    let section = '';

    for (const line of String(content).split(/\r\n|\n|\r/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

        const sectionMatch = /^\[([^\]]+)]$/.exec(trimmed);
        if (sectionMatch) {
            section = sectionMatch[1].trim();
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex < 0) {
            directives.push(trimmed);
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        if (!key) {
            directives.push(trimmed);
            continue;
        }
        const qualifiedKey = `${section}\u0000${key}`;
        if (values.has(qualifiedKey)) {
            throw new Error('Duplicate slicer profile key is not supported.');
        }
        values.set(qualifiedKey, trimmed.slice(separatorIndex + 1).trim());
    }

    return {
        entries: [...values.entries()]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([qualifiedKey, value]) => {
                const separatorIndex = qualifiedKey.indexOf('\u0000');
                return [
                    qualifiedKey.slice(0, separatorIndex),
                    qualifiedKey.slice(separatorIndex + 1),
                    value
                ];
            }),
        directives
    };
}

/**
 * Remove request-controlled INI settings from an already canonical profile.
 * @param {{entries: Array<[string, string, string]>, directives: string[]}} profile Canonical INI profile.
 * @param {Set<string>} excludedKeys Exact top-level request keys excluded from profile identity.
 * @returns {{entries: Array<[string, string, string]>, directives: string[]}} Profile-only identity payload.
 */
function excludeIniKeys(profile, excludedKeys) {
    return {
        entries: profile.entries.filter(([section, key]) => section !== '' || !excludedKeys.has(key)),
        directives: [...profile.directives]
    };
}

/**
 * Remove request-controlled top-level Orca settings without mutating the profile.
 * @param {Record<string, unknown>} profile Parsed Orca process profile.
 * @param {Set<string>} excludedKeys Keys excluded from profile identity.
 * @returns {Record<string, unknown>} Profile-only identity payload.
 */
function excludeJsonKeys(profile, excludedKeys) {
    return Object.fromEntries(
        Object.entries(profile).filter(([key]) => !excludedKeys.has(key))
    );
}

function requireResolvedOrcaProfile(profile) {
    if (Object.hasOwn(profile, 'inherits')) {
        throw new Error('Unresolved Orca profile inheritance cannot be hashed or sliced.');
    }
    return profile;
}

/**
 * Build the canonical profile identity used by the native slicer invocation.
 * The runtime profile is the exact merged profile passed to the slicer, but its
 * request-controlled layer-height and infill values are deliberately removed.
 * Stable server-added Orca settings and all other configured profile values
 * remain covered. Paths and request identity are also excluded.
 * @param {{engine: 'prusa'|'orca', technology: 'FDM'|'SLA', runtimeConfigFile: string, orcaMachineConfigFile?: string|null}} context Profile context.
 * @returns {Record<string, unknown>} Canonicalizable profile identity.
 */
function createEffectiveProfileIdentity(context) {
    const { engine, technology, runtimeConfigFile, orcaMachineConfigFile = null } = context;
    if (engine !== 'prusa' && engine !== 'orca') {
        throw new Error('Unsupported slicer engine for effective profile digest.');
    }
    if (technology !== 'FDM' && technology !== 'SLA') {
        throw new Error('Unsupported technology for effective profile digest.');
    }
    if (typeof runtimeConfigFile !== 'string' || !runtimeConfigFile) {
        throw new Error('Runtime process profile is required for effective profile digest.');
    }
    if (engine === 'orca' && (typeof orcaMachineConfigFile !== 'string' || !orcaMachineConfigFile)) {
        throw new Error('Orca machine profile is required for effective profile digest.');
    }

    return {
        schema: DIGEST_SCHEMA,
        engine,
        technology,
        invocation: resolveSlicerInvocationPolicy(engine, technology),
        machine: engine === 'orca'
            ? canonicalizeJsonValue(requireResolvedOrcaProfile(readProfileJson(orcaMachineConfigFile)))
            : null,
        process: engine === 'orca'
            ? canonicalizeJsonValue(excludeJsonKeys(
                requireResolvedOrcaProfile(readProfileJson(runtimeConfigFile)),
                ORCA_REQUEST_OVERRIDE_KEYS
            ))
            : excludeIniKeys(
                canonicalizeIni(readProfileText(runtimeConfigFile)),
                technology === 'FDM' ? PRUSA_REQUEST_OVERRIDE_KEYS : PRUSA_SLA_REQUEST_OVERRIDE_KEYS
            )
    };
}

/**
 * Calculate the effective profile digest used by the native slicer invocation.
 * @param {{engine: 'prusa'|'orca', technology: 'FDM'|'SLA', runtimeConfigFile: string, orcaMachineConfigFile?: string|null}} context Profile context.
 * @returns {string} Lowercase SHA-256 digest.
 */
function calculateEffectiveProfileSha256(context) {
    const effectiveProfile = createEffectiveProfileIdentity(context);
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(canonicalizeJsonValue(effectiveProfile)), 'utf8')
        .digest('hex');
}

module.exports = {
    DIGEST_SCHEMA,
    calculateEffectiveProfileSha256,
    canonicalizeIni,
    canonicalizeJsonValue,
    createEffectiveProfileIdentity,
    excludeIniKeys,
    excludeJsonKeys,
    requireResolvedOrcaProfile
};
