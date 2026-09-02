'use strict';

/**
 * Authentication middleware for service-to-service slicing requests.
 * On success the shared audience guard attaches a frozen
 * `req.slicePrincipal = { audience: 'slice', slot }` (never the key) so later
 * layers can key fairness on the authenticated caller family.
 */

const crypto = require('node:crypto');
const { createRequireAudience, fixedDigestCompare, sanitizeLogField } = require('./requireAudience');

const AUTHENTICATION_FAILURE = Object.freeze({
    success: false,
    error: 'Slice service authentication is required.',
    errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
});

function timingSafeCompare(supplied, configured) {
    return fixedDigestCompare(supplied, configured);
}

function createRequireSliceService(options = {}) {
    const apiKey = options.apiKey === undefined ? process.env.SLICE_SERVICE_API_KEY : options.apiKey;
    const previous = options.previousApiKey === undefined
        ? process.env.SLICE_SERVICE_API_KEY_PREVIOUS
        : options.previousApiKey;
    const keyRing = options.keyRing || Object.freeze({
        audiences: Object.freeze({
            slice: Object.freeze({ active: apiKey || '', previous: previous || null })
        })
    });
    return createRequireAudience({
        audience: 'slice',
        headerName: 'x-slicer-api-key',
        keyRing,
        failure: AUTHENTICATION_FAILURE,
        logger: options.logger,
        compareDigests: options.compareDigests || crypto.timingSafeEqual,
        clock: options.clock,
        alwaysComparePrevious: Boolean(options.keyRing || previous),
        logMessage: '[SLICE AUTH] Authentication rejected.',
        hideAudienceMetadata: true
    });
}

const requireSliceService = createRequireSliceService();

module.exports = requireSliceService;
module.exports.AUTHENTICATION_FAILURE = AUTHENTICATION_FAILURE;
module.exports.createRequireSliceService = createRequireSliceService;
module.exports.sanitizeLogField = sanitizeLogField;
module.exports.timingSafeCompare = timingSafeCompare;
