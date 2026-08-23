'use strict';

/** Scoped service credentials, rotation slots, and bounded legacy migration. */

const SERVICE_KEY_LIMITS = Object.freeze({ minimumBytes: 32, maximumBytes: 256 });
const SLICE_SERVICE_KEY_LIMITS = SERVICE_KEY_LIMITS;
const SERVICE_AUTH_CONFIGURATION_ERROR = 'Service authentication configuration is invalid.';
const SERVICE_AUTH_AUDIENCES = Object.freeze(['slice', 'pricing', 'artifact', 'operations']);
const LEGACY_MIGRATION_MAX_MS = 90 * 24 * 60 * 60 * 1000;

const AUDIENCE_ENV = Object.freeze({
    slice: Object.freeze({ active: 'SLICE_SERVICE_API_KEY', previous: 'SLICE_SERVICE_API_KEY_PREVIOUS' }),
    pricing: Object.freeze({ active: 'PRICING_API_KEY', previous: 'PRICING_API_KEY_PREVIOUS' }),
    artifact: Object.freeze({ active: 'ARTIFACT_API_KEY', previous: 'ARTIFACT_API_KEY_PREVIOUS' }),
    operations: Object.freeze({ active: 'OPERATIONS_API_KEY', previous: 'OPERATIONS_API_KEY_PREVIOUS' })
});

const REJECTED_PLACEHOLDER_WORDS = Object.freeze([
    'admin', 'changeme', 'default', 'example', 'password', 'root', 'secret', 'test'
]);

function isValidServiceSecret(value) {
    if (typeof value !== 'string') return false;
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (
        byteLength < SERVICE_KEY_LIMITS.minimumBytes
        || byteLength > SERVICE_KEY_LIMITS.maximumBytes
        || !/^[\x20-\x7e]+$/.test(value)
    ) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized || REJECTED_PLACEHOLDER_WORDS.includes(normalized)) return false;
    return !REJECTED_PLACEHOLDER_WORDS.some((token) => (
        normalized === token
        || new RegExp(`^${token}(?:[-_: .]|$)`).test(normalized)
    ));
}

const isValidSliceServiceSecret = isValidServiceSecret;

function parseLegacyMigration(env, now) {
    const audienceValue = String(env.LEGACY_ADMIN_API_KEY_AUDIENCE || '').trim().toLowerCase();
    const expiryValue = String(env.LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL || '').trim();
    if (!audienceValue && !expiryValue) {
        return Object.freeze({ enabled: false, audience: null, expiresAt: null });
    }
    if (!SERVICE_AUTH_AUDIENCES.includes(audienceValue) || audienceValue === 'slice' || !expiryValue) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    const expiryMs = Date.parse(expiryValue);
    if (
        !Number.isFinite(expiryMs)
        || expiryMs <= now
        || expiryMs - now > LEGACY_MIGRATION_MAX_MS
        || !isValidServiceSecret(env.ADMIN_API_KEY)
    ) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    return Object.freeze({
        enabled: true,
        audience: audienceValue,
        expiresAt: new Date(expiryMs).toISOString()
    });
}

function immutableAudienceKey(active, previous) {
    return Object.freeze({ active, previous: previous || null });
}

/**
 * Resolve all scoped credentials exactly once during startup.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} env Environment source.
 * @param {{now?: number}} options Deterministic clock seam.
 * @returns {{audiences: object, legacyMigration: object}} Frozen key-ring contract.
 */
function resolveServiceKeyRing(env = process.env, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const legacyMigration = parseLegacyMigration(env, now);
    const material = [];
    const audiences = {};

    for (const audience of SERVICE_AUTH_AUDIENCES) {
        const names = AUDIENCE_ENV[audience];
        let active = env[names.active];
        if (
            legacyMigration.enabled
            && legacyMigration.audience === audience
            && (active === undefined || active === '')
        ) {
            active = env.ADMIN_API_KEY;
        }
        const previous = env[names.previous];
        if (!isValidServiceSecret(active) || (previous && !isValidServiceSecret(previous))) {
            throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
        }
        for (const secret of [active, previous].filter(Boolean)) {
            if (material.includes(secret)) throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
            material.push(secret);
        }
        audiences[audience] = immutableAudienceKey(active, previous);
    }

    return Object.freeze({
        audiences: Object.freeze(audiences),
        legacyMigration
    });
}

/**
 * Backward-compatible focused resolver retained for isolated slice-auth tests.
 */
function resolveSliceServiceApiKey(env = process.env) {
    const sliceKey = env.SLICE_SERVICE_API_KEY;
    if (
        !isValidServiceSecret(sliceKey)
        || (typeof env.ADMIN_API_KEY === 'string' && sliceKey === env.ADMIN_API_KEY)
    ) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    return sliceKey;
}

module.exports = {
    AUDIENCE_ENV,
    SERVICE_AUTH_AUDIENCES,
    SERVICE_AUTH_CONFIGURATION_ERROR,
    SERVICE_KEY_LIMITS,
    SLICE_SERVICE_KEY_LIMITS,
    isValidServiceSecret,
    isValidSliceServiceSecret,
    resolveServiceKeyRing,
    resolveSliceServiceApiKey
};
