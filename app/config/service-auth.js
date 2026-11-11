'use strict';

/** Scoped service credentials, rotation slots, and bounded legacy migration. */

const SERVICE_KEY_LIMITS = Object.freeze({ minimumBytes: 32, maximumBytes: 256 });
const SLICE_SERVICE_KEY_LIMITS = SERVICE_KEY_LIMITS;
const SERVICE_AUTH_CONFIGURATION_ERROR = 'Service authentication configuration is invalid.';
const SERVICE_AUTH_AUDIENCES = Object.freeze(['slice', 'pricing', 'artifact', 'operations']);
const SLICE_SERVICE_PRINCIPALS = Object.freeze(['woocommerce', 'leadpilot']);
/**
 * Optional slice principals (3.9.0): their own rate bucket and queue share,
 * revocable apart from the live shop. Never part of `allPrincipalsActive`;
 * absent = today's key ring to the byte (no extra comparison slots).
 */
const OPTIONAL_SLICE_SERVICE_PRINCIPALS = Object.freeze(['staging']);
/** Readiness reason of a slice migration whose date has passed (never `/ready`). */
const LEGACY_SLICE_SLOT_EXPIRED = 'LEGACY_SLICE_SLOT_EXPIRED';
const SLICE_SERVICE_AUTH_MODES = Object.freeze(['legacy', 'migration', 'principals']);
const LEGACY_MIGRATION_MAX_MS = 90 * 24 * 60 * 60 * 1000;

const AUDIENCE_ENV = Object.freeze({
    slice: Object.freeze({ active: 'SLICE_SERVICE_API_KEY', previous: 'SLICE_SERVICE_API_KEY_PREVIOUS' }),
    pricing: Object.freeze({ active: 'PRICING_API_KEY', previous: 'PRICING_API_KEY_PREVIOUS' }),
    artifact: Object.freeze({ active: 'ARTIFACT_API_KEY', previous: 'ARTIFACT_API_KEY_PREVIOUS' }),
    operations: Object.freeze({ active: 'OPERATIONS_API_KEY', previous: 'OPERATIONS_API_KEY_PREVIOUS' })
});

const SLICE_PRINCIPAL_ENV = Object.freeze({
    woocommerce: Object.freeze({
        active: 'SLICE_SERVICE_WOOCOMMERCE_API_KEY',
        previous: 'SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS'
    }),
    leadpilot: Object.freeze({
        active: 'SLICE_SERVICE_LEADPILOT_API_KEY',
        previous: 'SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS'
    })
});

const OPTIONAL_SLICE_PRINCIPAL_ENV = Object.freeze({
    staging: Object.freeze({
        active: 'SLICE_SERVICE_STAGING_API_KEY',
        previous: 'SLICE_SERVICE_STAGING_API_KEY_PREVIOUS'
    })
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

function optionalSecret(value) {
    return value === undefined || value === '' ? null : value;
}

function registerUniqueSecret(material, secret) {
    if (material.includes(secret)) throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    material.push(secret);
}

function resolveOptionalRotationPair(env, names, material) {
    const active = optionalSecret(env[names.active]);
    const previous = optionalSecret(env[names.previous]);
    if (
        (active && !isValidServiceSecret(active))
        || (previous && (!active || !isValidServiceSecret(previous)))
    ) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    for (const secret of [active, previous].filter(Boolean)) {
        registerUniqueSecret(material, secret);
    }
    return immutableAudienceKey(active, previous);
}

function immutableSliceAudienceKey(legacy, principals) {
    return Object.freeze({
        active: legacy.active,
        previous: legacy.previous,
        principals: Object.freeze(principals)
    });
}

/**
 * Resolve the slice credential mode.
 *
 * 3.9.0: a `migration` whose date has passed no longer refuses startup (a
 * restart after the date used to crash-loop the service). It resolves
 * `{mode: 'migration', legacyAccepted: false, expired: true, expiresAt}`;
 * the legacy slots are refused per request exactly as `requireAudience`
 * already does after the date, the principals keep working, and the
 * integrator reports `LEGACY_SLICE_SLOT_EXPIRED` on `/operations/readiness`
 * only. A malformed date or one more than 90 days ahead stays a startup error.
 */
function parseSliceCredentialMode(env, now, legacy, principals) {
    const configuredMode = optionalSecret(env.SLICE_SERVICE_AUTH_MODE);
    const mode = configuredMode || 'legacy';
    const expiryValue = optionalSecret(env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL);
    const principalPairs = SLICE_SERVICE_PRINCIPALS.map((principal) => principals[principal]);
    const allPrincipalsActive = principalPairs.every((pair) => Boolean(pair.active));
    const anyPrincipalMaterial = Object.values(principals).some((pair) => Boolean(pair.active || pair.previous));
    const legacyActive = Boolean(legacy.active);

    if (!SLICE_SERVICE_AUTH_MODES.includes(mode)) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    if (mode === 'legacy') {
        if (!legacyActive || anyPrincipalMaterial || expiryValue) {
            throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
        }
        return Object.freeze({ mode, legacyAccepted: true, expiresAt: null });
    }
    if (mode === 'principals') {
        if (legacyActive || legacy.previous || !allPrincipalsActive || expiryValue) {
            throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
        }
        return Object.freeze({ mode, legacyAccepted: false, expiresAt: null });
    }

    const expiryMs = Date.parse(expiryValue || '');
    if (
        !legacyActive
        || !allPrincipalsActive
        || !Number.isFinite(expiryMs)
        || expiryMs - now > LEGACY_MIGRATION_MAX_MS
    ) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    if (expiryMs <= now) {
        return Object.freeze({
            mode,
            legacyAccepted: false,
            expired: true,
            expiresAt: new Date(expiryMs).toISOString()
        });
    }
    return Object.freeze({
        mode,
        legacyAccepted: true,
        expiresAt: new Date(expiryMs).toISOString()
    });
}

/**
 * Readiness reason codes of a resolved key ring, for `/operations/readiness`
 * only (never `/ready`): `LEGACY_SLICE_SLOT_EXPIRED` once a slice migration's
 * date has passed, judged at startup or at `now`.
 * @param {{sliceCredentialMode?: {mode?: string, expired?: boolean, expiresAt?: string|null}}} keyRing Resolved key ring.
 * @param {number} [now] Clock seam.
 * @returns {string[]} Reason codes (empty when none applies).
 */
function resolveKeyRingReadinessReasons(keyRing, now = Date.now()) {
    const mode = keyRing?.sliceCredentialMode;
    if (!mode || mode.mode !== 'migration') return [];
    const expiresAtMs = typeof mode.expiresAt === 'string' ? Date.parse(mode.expiresAt) : NaN;
    if (mode.expired === true || (Number.isFinite(expiresAtMs) && now >= expiresAtMs)) {
        return [LEGACY_SLICE_SLOT_EXPIRED];
    }
    return [];
}

/**
 * Resolve all scoped credentials exactly once during startup.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} env Environment source.
 * @param {{now?: number}} options Deterministic clock seam.
 * @returns {{audiences: object, legacyMigration: object, sliceCredentialMode: object}} Frozen key-ring contract.
 */
function resolveServiceKeyRing(env = process.env, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const legacyMigration = parseLegacyMigration(env, now);
    const material = [];
    const adminSecret = optionalSecret(env.ADMIN_API_KEY);
    if (adminSecret && isValidServiceSecret(adminSecret)) material.push(adminSecret);
    const audiences = {};

    for (const audience of SERVICE_AUTH_AUDIENCES) {
        const names = AUDIENCE_ENV[audience];
        if (audience === 'slice') {
            audiences[audience] = resolveOptionalRotationPair(env, names, material);
            continue;
        }
        let active = env[names.active];
        let usesLegacyAdmin = false;
        if (
            legacyMigration.enabled
            && legacyMigration.audience === audience
            && (active === undefined || active === '')
        ) {
            active = env.ADMIN_API_KEY;
            usesLegacyAdmin = true;
        }
        const previous = env[names.previous];
        if (!isValidServiceSecret(active) || (previous && !isValidServiceSecret(previous))) {
            throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
        }
        if (!usesLegacyAdmin) registerUniqueSecret(material, active);
        if (previous) registerUniqueSecret(material, previous);
        audiences[audience] = immutableAudienceKey(active, previous);
    }

    const slicePrincipals = {};
    for (const principal of SLICE_SERVICE_PRINCIPALS) {
        slicePrincipals[principal] = resolveOptionalRotationPair(
            env,
            SLICE_PRINCIPAL_ENV[principal],
            material
        );
    }
    for (const principal of OPTIONAL_SLICE_SERVICE_PRINCIPALS) {
        const pair = resolveOptionalRotationPair(env, OPTIONAL_SLICE_PRINCIPAL_ENV[principal], material);
        if (pair.active || pair.previous) slicePrincipals[principal] = pair;
    }
    const sliceCredentialMode = parseSliceCredentialMode(
        env,
        now,
        audiences.slice,
        slicePrincipals
    );
    audiences.slice = immutableSliceAudienceKey(audiences.slice, slicePrincipals);

    return Object.freeze({
        audiences: Object.freeze(audiences),
        legacyMigration,
        sliceCredentialMode
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
    LEGACY_SLICE_SLOT_EXPIRED,
    OPTIONAL_SLICE_PRINCIPAL_ENV,
    OPTIONAL_SLICE_SERVICE_PRINCIPALS,
    SLICE_PRINCIPAL_ENV,
    SLICE_SERVICE_AUTH_MODES,
    SLICE_SERVICE_PRINCIPALS,
    SERVICE_AUTH_AUDIENCES,
    SERVICE_AUTH_CONFIGURATION_ERROR,
    SERVICE_KEY_LIMITS,
    SLICE_SERVICE_KEY_LIMITS,
    isValidServiceSecret,
    isValidSliceServiceSecret,
    resolveKeyRingReadinessReasons,
    resolveServiceKeyRing,
    resolveSliceServiceApiKey
};
