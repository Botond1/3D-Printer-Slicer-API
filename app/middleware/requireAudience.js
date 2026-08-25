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

function normalizeAudienceKeys(keyRing, audience) {
    const candidate = keyRing?.audiences?.[audience] || keyRing?.[audience] || keyRing;
    const credentialMode = audience === 'slice' ? keyRing?.sliceCredentialMode : null;
    const principalSlots = [];
    if (candidate?.principals && typeof candidate.principals === 'object') {
        for (const principal of Object.keys(candidate.principals).sort()) {
            const pair = candidate.principals[principal];
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
 * Build middleware from an immutable key-ring snapshot.
 * Every configured rotation family is compared for every request. Absent
 * rotation slots use a fixed dummy digest so the comparison topology remains
 * stable, but dummy matches never authorize a request.
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
        const authorized = matches.some((match, index) => (
            match && (index >= 2 || legacyAllowed)
        ));
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
        return next();
    };
}

module.exports = {
    createRequireAudience,
    digestSecret,
    fixedDigestCompare,
    legacySlotsAllowed,
    sanitizeLogField
};
