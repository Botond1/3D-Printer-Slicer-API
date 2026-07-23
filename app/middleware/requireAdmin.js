'use strict';

/** Compatibility facade and scoped x-api-key authentication factories. */

const crypto = require('node:crypto');
const { createRequireAudience } = require('./requireAudience');

const AUDIENCE_FAILURES = Object.freeze({
    pricing: Object.freeze({
        success: false, error: 'Pricing authentication is required.',
        errorCode: 'PRICING_AUTH_REQUIRED'
    }),
    artifact: Object.freeze({
        success: false, error: 'Artifact authentication is required.',
        errorCode: 'ARTIFACT_AUTH_REQUIRED'
    }),
    operations: Object.freeze({
        success: false, error: 'Operations authentication is required.',
        errorCode: 'OPERATIONS_AUTH_REQUIRED'
    })
});

function timingSafeCompare(a, b) {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) {
        crypto.timingSafeEqual(left, left);
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

function createRequireAdminAudience(audience, keyRing, options = {}) {
    if (!AUDIENCE_FAILURES[audience]) throw new TypeError('Unsupported admin audience.');
    return createRequireAudience({
        audience,
        headerName: 'x-api-key',
        keyRing,
        failure: AUDIENCE_FAILURES[audience],
        logger: options.logger,
        compareDigests: options.compareDigests || crypto.timingSafeEqual
    });
}

/*
 * Fail-closed compatibility export for direct imports and router defaults.
 * Runtime wiring must inject one finite audience from the startup key ring.
 */
function requireAdmin(req, res, next) {
    void req;
    void next;
    return res.status(503).json({
        success: false,
        error: 'Admin API key is not configured on server.'
    });
}

module.exports = requireAdmin;
module.exports.AUDIENCE_FAILURES = AUDIENCE_FAILURES;
module.exports.createRequireAdminAudience = createRequireAdminAudience;
module.exports.timingSafeCompare = timingSafeCompare;
