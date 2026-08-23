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
    return Object.freeze({
        active: typeof candidate?.active === 'string' ? candidate.active : '',
        previous: typeof candidate?.previous === 'string' ? candidate.previous : ''
    });
}

/**
 * Build middleware from an immutable key-ring snapshot.
 * Both rotation slots are compared for every request; an absent previous slot
 * uses a fixed dummy digest so the comparison topology remains stable.
 */
function createRequireAudience(options = {}) {
    const {
        audience,
        headerName = 'x-api-key',
        failure = Object.freeze({ success: false, error: 'Unauthorized' }),
        logger = console,
        compareDigests = crypto.timingSafeEqual,
        alwaysComparePrevious = true,
        logMessage = '[AUTH] Authentication rejected.',
        hideAudienceMetadata = false
    } = options;
    if (typeof audience !== 'string' || !audience) throw new TypeError('Authentication audience is required.');
    const keys = normalizeAudienceKeys(options.keyRing, audience);
    const activeDigest = keys.active ? digestSecret(keys.active) : EMPTY_DIGEST;
    const previousDigest = keys.previous ? digestSecret(keys.previous) : EMPTY_DIGEST;

    return function requireAudience(req, res, next) {
        const supplied = req.header(headerName);
        const suppliedDigest = digestSecret(supplied);
        const activeMatch = compareDigests(suppliedDigest, activeDigest);
        const previousMatch = keys.previous || alwaysComparePrevious
            ? compareDigests(suppliedDigest, previousDigest)
            : false;
        const configured = Boolean(keys.active);
        if (!configured || typeof supplied !== 'string' || (!activeMatch && !previousMatch)) {
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
    sanitizeLogField
};
