'use strict';

/** Shared fixed-digest authentication for scoped service audiences. */

const crypto = require('node:crypto');
const { getClientIp } = require('../utils/client-ip');

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
function resolveMatchedSlot(index, principalNames) {
    if (index < 2) return SHARED_SLOT;
    return principalNames[Math.floor((index - 2) / 2)] || SHARED_SLOT;
}

/**
 * Build middleware from an immutable key-ring snapshot.
 * Every configured rotation family is compared for every request. Absent
 * rotation slots use a fixed dummy digest so the comparison topology remains
 * stable, but dummy matches never authorize a request.
 *
 * A successful slice-audience match attaches a frozen
 * `req.slicePrincipal = { audience: 'slice', slot }` describing only which
 * rotation family authorized the request (`shared`, `woocommerce`, or
 * `leadpilot`); the credential itself is never attached.
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
        hideAudienceMetadata = false
    } = options;
    if (typeof audience !== 'string' || !audience) throw new TypeError('Authentication audience is required.');
    const keys = normalizeAudienceKeys(options.keyRing, audience);
    const slotSecrets = [keys.active];
    if (keys.previous || alwaysComparePrevious) slotSecrets.push(keys.previous);
    slotSecrets.push(...keys.principalSlots);
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
            const metadata = {
                requestId: sanitizeLogField(req.requestId),
                clientIp: sanitizeLogField(getClientIp(req), 'unknown')
            };
            if (hideAudienceMetadata) {
                Object.defineProperty(metadata, 'audience', { value: audience, enumerable: false });
            } else {
                metadata.audience = audience;
            }
            logger.warn?.(logMessage, metadata);
            return res.status(configured ? 401 : 503).json(failure);
        }
        if (audience === 'slice') {
            req.slicePrincipal = Object.freeze({
                audience: 'slice',
                slot: resolveMatchedSlot(matchedIndex, keys.principalNames)
            });
        }
        return next();
    };
}

module.exports = {
    SHARED_SLOT,
    createRequireAudience,
    resolveMatchedSlot,
    digestSecret,
    fixedDigestCompare,
    legacySlotsAllowed,
    sanitizeLogField
};
