'use strict';

/** Shared fixed-digest authentication for scoped service audiences. */

const crypto = require('node:crypto');
const { getClientIp } = require('../utils/client-ip');
const { REQUEST_ID_PATTERN } = require('./requestId');
const { emitEvent } = require('../services/observability/events');

/**
 * Request-scoped rejection hook (3.9.0). `sliceAdmission.js` sets it on the
 * request before it calls the authenticator; on a rejection the authenticator
 * calls it with `(res, {status, keyPresent})` BEFORE it answers. The hook may
 * add a header (`Retry-After`) and return `false` (today's 401/503 is sent), or
 * send its own answer and return `true`. Absent hook = today's behaviour.
 */
const AUTH_REJECTION_HOOK = Symbol('r3dAuthRejectionHook');
/** Labels of the matched rotation of a slot. */
const ROTATION_ACTIVE = 'active';
const ROTATION_PREVIOUS = 'previous';
const LEGACY_EXPIRED_EVENT_INTERVAL_MS = 60_000;

const EMPTY_DIGEST = crypto.createHash('sha256').update('', 'utf8').digest();

function digestSecret(value) {
    return crypto.createHash('sha256').update(typeof value === 'string' ? value : '', 'utf8').digest();
}

function fixedDigestCompare(left, right, timingSafeEqual = crypto.timingSafeEqual) {
    return timingSafeEqual(digestSecret(left), digestSecret(right));
}

function sanitizeLogField(value, fallback = 'n/a') {
    const normalized = String(value || fallback).replace(/[^\x20-\x7e]/g, '?');
    return normalized.slice(0, 128) || fallback;
}

/** Slot label for the shared (non-principal) active/previous rotation pair. */
const SHARED_SLOT = 'shared';

function normalizeAudienceKeys(keyRing, audience) {
    const candidate = keyRing?.audiences?.[audience] || keyRing?.[audience] || keyRing;
    const credentialMode = audience === 'slice' ? keyRing?.sliceCredentialMode : null;
    const principalSlots = [];
    const principalNames = [];
    if (candidate?.principals && typeof candidate.principals === 'object') {
        for (const principal of Object.keys(candidate.principals).sort()) {
            const pair = candidate.principals[principal];
            principalNames.push(principal);
            principalSlots.push(
                typeof pair?.active === 'string' ? pair.active : '',
                typeof pair?.previous === 'string' ? pair.previous : ''
            );
        }
    }
    return Object.freeze({
        active: typeof candidate?.active === 'string' ? candidate.active : '',
        previous: typeof candidate?.previous === 'string' ? candidate.previous : '',
        principalSlots: Object.freeze(principalSlots),
        principalNames: Object.freeze(principalNames),
        legacyMode: typeof credentialMode?.mode === 'string' ? credentialMode.mode : null,
        legacyExpiresAtMs: typeof credentialMode?.expiresAt === 'string'
            ? Date.parse(credentialMode.expiresAt)
            : null
    });
}

function legacySlotsAllowed(keys, now) {
    if (keys.legacyMode === null || keys.legacyMode === 'legacy') return true;
    if (keys.legacyMode === 'principals') return false;
    return keys.legacyMode === 'migration'
        && Number.isFinite(keys.legacyExpiresAtMs)
        && now < keys.legacyExpiresAtMs;
}

/**
 * Resolve the bounded slot label for a matched digest index.
 * Indexes 0/1 are the shared active/previous pair; later indexes are the
 * sorted principal active/previous pairs.
 * @param {number} index Matched slot index.
 * @param {readonly string[]} principalNames Sorted principal names.
 * @returns {string} Slot label such as `shared`, `woocommerce`, or `leadpilot`.
 */
function resolveMatchedSlot(index, principalNames, principalOffset = 2) {
    if (index < principalOffset) return SHARED_SLOT;
    return principalNames[Math.floor((index - principalOffset) / 2)] || SHARED_SLOT;
}

/**
 * Resolve the rotation label (`active|previous`) of a matched digest index.
 * @param {number} index Matched slot index.
 * @param {number} [principalOffset] Index of the first principal slot.
 * @returns {'active'|'previous'} Rotation label.
 */
function resolveMatchedRotation(index, principalOffset = 2) {
    if (index < principalOffset) return index === 0 ? ROTATION_ACTIVE : ROTATION_PREVIOUS;
    return (index - principalOffset) % 2 === 0 ? ROTATION_ACTIVE : ROTATION_PREVIOUS;
}

/** A 16-hex server id for a rejected request (the caller's id is never trusted as ours). */
function createServerRequestId() {
    return `srv-${crypto.randomBytes(8).toString('hex')}`;
}

/** The caller's own `X-Request-Id`, kept only when it is a well-formed id. */
function readClientRequestId(req) {
    const value = req?.headers?.['x-request-id'];
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : undefined;
}

function defineHidden(target, name, value) {
    Object.defineProperty(target, name, { value, enumerable: false });
}

/**
 * Build middleware from an immutable key-ring snapshot.
 * Every configured rotation family is compared for every request. Absent
 * rotation slots use a fixed dummy digest so the comparison topology remains
 * stable, but dummy matches never authorize a request.
 *
 * A successful slice-audience match attaches a frozen
 * `req.slicePrincipal = { audience: 'slice', slot, rotation }` describing only
 * which rotation family authorized the request (`shared`, `woocommerce`,
 * `leadpilot` or `staging`) and which of its two slots (`active|previous`);
 * the credential itself is never attached. An injected
 * `onAccepted({audience, slot, rotation, clientIp})` is told about every
 * accepted request (labels only); it can never change the outcome.
 *
 * The rejection log's metadata keeps its two enumerable fields
 * (`requestId`, `clientIp`); 3.9.0 adds non-enumerable `reason`,
 * `serverRequestId` (`srv-<16hex>`) and `clientRequestId` for the
 * aggregated auth log (`auth-log-aggregator.js`).
 */
function createRequireAudience(options = {}) {
    const {
        audience,
        headerName = 'x-api-key',
        failure = Object.freeze({ success: false, error: 'Unauthorized' }),
        logger = console,
        compareDigests = crypto.timingSafeEqual,
        clock = Date.now,
        alwaysComparePrevious = true,
        logMessage = '[AUTH] Authentication rejected.',
        hideAudienceMetadata = false,
        onAccepted = null,
        emit = emitEvent
    } = options;
    if (typeof audience !== 'string' || !audience) throw new TypeError('Authentication audience is required.');
    const keys = normalizeAudienceKeys(options.keyRing, audience);
    const slotSecrets = [keys.active];
    if (keys.previous || alwaysComparePrevious) slotSecrets.push(keys.previous);
    const principalOffset = slotSecrets.length;
    slotSecrets.push(...keys.principalSlots);
    let legacyExpiredReportedAt = -Infinity;
    const slotDigests = slotSecrets.map((secret) => (
        secret ? digestSecret(secret) : EMPTY_DIGEST
    ));

    return function requireAudience(req, res, next) {
        const supplied = req.header(headerName);
        const suppliedDigest = digestSecret(supplied);
        const matches = slotDigests.map((expectedDigest, index) => (
            compareDigests(suppliedDigest, expectedDigest) && Boolean(slotSecrets[index])
        ));
        const configured = slotSecrets.some(Boolean);
        const legacyAllowed = legacySlotsAllowed(keys, clock());
        const matchedIndex = matches.findIndex((match, index) => (
            match && (index >= 2 || legacyAllowed)
        ));
        const authorized = matchedIndex >= 0;
        if (!configured || typeof supplied !== 'string' || !authorized) {
            const keyPresent = typeof supplied === 'string';
            if (keyPresent && !legacyAllowed && keys.legacyMode === 'migration'
                && matches.some((match, index) => match && index < principalOffset)) {
                reportLegacyExpired();
            }
            const metadata = {
                requestId: sanitizeLogField(req.requestId),
                clientIp: sanitizeLogField(getClientIp(req), 'unknown')
            };
            if (hideAudienceMetadata) {
                Object.defineProperty(metadata, 'audience', { value: audience, enumerable: false });
            } else {
                metadata.audience = audience;
            }
            defineHidden(metadata, 'reason', rejectionReason(configured, keyPresent));
            defineHidden(metadata, 'serverRequestId', createServerRequestId());
            defineHidden(metadata, 'clientRequestId', readClientRequestId(req));
            logger.warn?.(logMessage, metadata);
            const status = configured ? 401 : 503;
            const onRejected = req?.[AUTH_REJECTION_HOOK];
            if (typeof onRejected === 'function' && onRejected(res, { status, keyPresent }) === true) {
                return undefined;
            }
            return res.status(status).json(failure);
        }
        const slot = resolveMatchedSlot(matchedIndex, keys.principalNames, principalOffset);
        const rotation = resolveMatchedRotation(matchedIndex, principalOffset);
        if (audience === 'slice') {
            req.slicePrincipal = Object.freeze({ audience: 'slice', slot, rotation });
        }
        if (typeof onAccepted === 'function') {
            try {
                onAccepted({ audience, slot, rotation, clientIp: getClientIp(req) });
            } catch {
                // Telemetry never owns the authentication outcome.
            }
        }
        return next();
    };

    /** One `auth.legacy_migration_expired` line per minute while an expired legacy key is still sent. */
    function reportLegacyExpired() {
        const now = clock();
        if (now - legacyExpiredReportedAt < LEGACY_EXPIRED_EVENT_INTERVAL_MS) return;
        legacyExpiredReportedAt = now;
        try {
            emit('auth.legacy_migration_expired', {
                audience,
                outcome: 'rejected',
                error_code: 'LEGACY_SLICE_SLOT_EXPIRED',
                extra: { slot: SHARED_SLOT, reason: 'LEGACY_SLICE_SLOT_EXPIRED' }
            });
        } catch {
            // Reporting cannot replace the 401.
        }
    }
}

function rejectionReason(configured, keyPresent) {
    if (!configured) return 'unconfigured';
    return keyPresent ? 'invalid_key' : 'missing_key';
}

module.exports = {
    AUTH_REJECTION_HOOK,
    SHARED_SLOT,
    createRequireAudience,
    createServerRequestId,
    resolveMatchedRotation,
    resolveMatchedSlot,
    digestSecret,
    fixedDigestCompare,
    legacySlotsAllowed,
    sanitizeLogField
};
