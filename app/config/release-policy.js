'use strict';

/**
 * Settings introduced by release 3.9.0.
 *
 * `constants.js` and `resource-policy.js` are read by hashed processing code
 * and are frozen (one byte there changes the Bambu `measurement_generation`),
 * so every new 3.9.0 setting is parsed here and nowhere else. Each package
 * reads its own section: `identity`, `retention`, `archive`, `authFailure`,
 * `children`, `export`.
 *
 * Rules: an absent key takes its default; a present key must be a canonical
 * non-negative decimal integer inside its inclusive range (`0` only where the
 * range starts at 0) or one of its enum spellings; cross-key rules are checked
 * on the resolved values. Anything else throws, which refuses startup when the
 * module is first required. Secrets (`SLICE_SERVICE_STAGING_API_KEY[_PREVIOUS]`)
 * are not read here; `service-auth.js` owns key material.
 */

const { resolveResourcePolicy } = require('./resource-policy');

const ON_OFF = Object.freeze({ on: true, off: false });
const TRUE_FALSE = Object.freeze({ true: true, false: false });

/**
 * Every 3.9.0 key, grouped by the section that reads it. `integer` entries
 * carry `default`, `min` and `max` (inclusive); `enum` entries carry the
 * accepted spellings and their boolean values.
 */
const RELEASE_POLICY_DEFINITIONS = Object.freeze({
    identity: Object.freeze({
        NATIVE_IDENTITY_MONITOR: Object.freeze({ type: 'enum', values: ON_OFF, default: 'on' }),
        NATIVE_IDENTITY_VERIFY_INTERVAL_MS: Object.freeze({
            type: 'integer', default: 300_000, min: 60_000, max: 3_600_000
        }),
        // Cross-key: at least 2 × NATIVE_IDENTITY_VERIFY_INTERVAL_MS.
        NATIVE_IDENTITY_MAX_AGE_MS: Object.freeze({
            type: 'integer', default: 900_000, min: 120_000, max: 7_200_000
        }),
        NATIVE_IDENTITY_TIMEOUT_MS: Object.freeze({
            type: 'integer', default: 120_000, min: 10_000, max: 600_000
        })
    }),
    retention: Object.freeze({
        ARTIFACT_SWEEP_INTERVAL_MS: Object.freeze({
            type: 'integer', default: 300_000, min: 60_000, max: 3_600_000
        }),
        ARTIFACT_SWEEP_MAX_MS: Object.freeze({
            type: 'integer', default: 10_000, min: 1_000, max: 60_000
        })
    }),
    archive: Object.freeze({
        MAX_3MF_EXPANDED_TRIANGLES: Object.freeze({
            type: 'integer', default: 50_000_000, min: 1_000_000, max: 500_000_000
        }),
        MAX_3MF_EXPANDED_INSTANCES: Object.freeze({
            type: 'integer', default: 100_000, min: 4_096, max: 10_000_000
        }),
        MAX_3MF_MODEL_OBJECTS: Object.freeze({
            type: 'integer', default: 100_000, min: 1_000, max: 1_000_000
        })
    }),
    authFailure: Object.freeze({
        AUTH_FAILURE_RATE_LIMIT_WINDOW_MS: Object.freeze({
            type: 'integer', default: 60_000, min: 1, max: 3_600_000
        }),
        AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS: Object.freeze({
            type: 'integer', default: 60, min: 1, max: 100_000
        }),
        AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY: Object.freeze({
            type: 'integer', default: 30, min: 1, max: 100_000
        })
    }),
    children: Object.freeze({
        // 0 = no `choom` wrapper.
        CHILD_OOM_SCORE_ADJ: Object.freeze({ type: 'integer', default: 500, min: 0, max: 1_000 })
    }),
    export: Object.freeze({
        EXPORT_ROUTE_ENABLED: Object.freeze({ type: 'enum', values: TRUE_FALSE, default: 'false' }),
        EXPORT_SYNC_DEADLINE_MS: Object.freeze({
            type: 'integer', default: 90_000, min: 10_000, max: 100_000
        }),
        // Cross-key: at most ASYNC_SLICE_DEADLINE_MS (resource policy). When
        // absent it is min(900 000, ASYNC_SLICE_DEADLINE_MS).
        EXPORT_ASYNC_DEADLINE_MS: Object.freeze({
            type: 'integer', default: 900_000, min: 60_000, max: 1_800_000
        }),
        EXPORT_RESULT_TTL_MS: Object.freeze({
            type: 'integer', default: 900_000, min: 60_000, max: 3_600_000
        }),
        EXPORT_MAX_JOBS: Object.freeze({ type: 'integer', default: 4, min: 1, max: 16 }),
        EXPORT_RATE_LIMIT_WINDOW_MS: Object.freeze({
            type: 'integer', default: 60_000, min: 1, max: 3_600_000
        }),
        EXPORT_RATE_LIMIT_MAX_REQUESTS: Object.freeze({
            type: 'integer', default: 6, min: 1, max: 100_000
        }),
        EXPORT_RATE_LIMIT_BURST_CAPACITY: Object.freeze({
            type: 'integer', default: 3, min: 1, max: 100_000
        })
    })
});

/**
 * Parse one present integer value.
 * @param {string} name Environment key.
 * @param {unknown} value Raw value.
 * @param {{min: number, max: number}} definition Inclusive range.
 * @returns {number}
 */
function parseCanonicalInteger(name, value, definition) {
    const text = String(value);
    if (!/^(?:0|[1-9]\d*)$/.test(text)) {
        throw new Error(`${name} must be a canonical non-negative decimal integer.`);
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < definition.min || parsed > definition.max) {
        throw new Error(`${name} must be between ${definition.min} and ${definition.max}.`);
    }
    return parsed;
}

/**
 * Parse one present enum value (exact spelling, no case folding).
 * @param {string} name Environment key.
 * @param {unknown} value Raw value.
 * @param {Readonly<Record<string, boolean>>} values Accepted spellings.
 * @returns {boolean}
 */
function parseEnum(name, value, values) {
    const text = String(value);
    if (!Object.prototype.hasOwnProperty.call(values, text)) {
        throw new Error(`${name} must be one of: ${Object.keys(values).join(', ')}.`);
    }
    return values[text];
}

function resolveSection(env, definitions) {
    const section = {};
    for (const [name, definition] of Object.entries(definitions)) {
        const configured = env[name];
        if (definition.type === 'enum') {
            section[name] = parseEnum(name, configured === undefined ? definition.default : configured,
                definition.values);
        } else if (configured === undefined) {
            section[name] = definition.default;
        } else {
            section[name] = parseCanonicalInteger(name, configured, definition);
        }
    }
    return section;
}

/**
 * Resolve every 3.9.0 setting from an environment.
 * @param {Record<string, string|undefined>} [env]
 * @returns {Readonly<{identity: object, retention: object, archive: object,
 *   authFailure: object, children: object, export: object}>}
 * @throws {Error} On any invalid value or broken cross-key rule.
 */
function resolveReleasePolicy(env = process.env) {
    const identity = resolveSection(env, RELEASE_POLICY_DEFINITIONS.identity);
    if (identity.NATIVE_IDENTITY_MAX_AGE_MS < 2 * identity.NATIVE_IDENTITY_VERIFY_INTERVAL_MS) {
        throw new Error('NATIVE_IDENTITY_MAX_AGE_MS must be at least 2 × NATIVE_IDENTITY_VERIFY_INTERVAL_MS.');
    }

    const exportSection = resolveSection(env, RELEASE_POLICY_DEFINITIONS.export);
    const asyncSliceDeadlineMs = resolveResourcePolicy(env).ASYNC_SLICE_DEADLINE_MS;
    if (env.EXPORT_ASYNC_DEADLINE_MS === undefined) {
        exportSection.EXPORT_ASYNC_DEADLINE_MS = Math.min(
            RELEASE_POLICY_DEFINITIONS.export.EXPORT_ASYNC_DEADLINE_MS.default,
            asyncSliceDeadlineMs
        );
    } else if (exportSection.EXPORT_ASYNC_DEADLINE_MS > asyncSliceDeadlineMs) {
        throw new Error('EXPORT_ASYNC_DEADLINE_MS must not exceed ASYNC_SLICE_DEADLINE_MS.');
    }

    return Object.freeze({
        identity: Object.freeze(identity),
        retention: Object.freeze(resolveSection(env, RELEASE_POLICY_DEFINITIONS.retention)),
        archive: Object.freeze(resolveSection(env, RELEASE_POLICY_DEFINITIONS.archive)),
        authFailure: Object.freeze(resolveSection(env, RELEASE_POLICY_DEFINITIONS.authFailure)),
        children: Object.freeze(resolveSection(env, RELEASE_POLICY_DEFINITIONS.children)),
        export: Object.freeze(exportSection)
    });
}

const RELEASE_POLICY = resolveReleasePolicy(process.env);

module.exports = {
    RELEASE_POLICY,
    RELEASE_POLICY_DEFINITIONS,
    archive: RELEASE_POLICY.archive,
    authFailure: RELEASE_POLICY.authFailure,
    children: RELEASE_POLICY.children,
    export: RELEASE_POLICY.export,
    identity: RELEASE_POLICY.identity,
    parseCanonicalInteger,
    resolveReleasePolicy,
    retention: RELEASE_POLICY.retention
};
