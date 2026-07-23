'use strict';

/** Authentication middleware for service-to-service slicing requests. */

const crypto = require('node:crypto');
const { getClientIp } = require('../utils/client-ip');

const AUTHENTICATION_FAILURE = Object.freeze({
    success: false,
    error: 'Slice service authentication is required.',
    errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
});

/**
 * Compare UTF-8 strings through fixed-length digests.
 * timingSafeEqual therefore always receives equal-size buffers, including for
 * differently sized or missing credentials.
 * @param {string} supplied Supplied credential.
 * @param {string} configured Configured credential.
 * @returns {boolean} True only when the credentials match.
 */
function timingSafeCompare(supplied, configured) {
    const suppliedDigest = crypto.createHash('sha256').update(supplied, 'utf8').digest();
    const configuredDigest = crypto.createHash('sha256').update(configured, 'utf8').digest();
    return crypto.timingSafeEqual(suppliedDigest, configuredDigest);
}

/**
 * Restrict untrusted log fields to a short, single-line printable value.
 * @param {unknown} value Candidate field value.
 * @param {string} fallback Safe fallback.
 * @returns {string} Sanitized log value.
 */
function sanitizeLogField(value, fallback) {
    const normalized = String(value || fallback).replace(/[^\x20-\x7e]/g, '?');
    return normalized.slice(0, 128) || fallback;
}

/**
 * Create injectable slice-service authentication middleware.
 * @param {object} options Middleware dependencies.
 * @param {string} [options.apiKey] Fixed configured credential.
 * @param {() => unknown} [options.getApiKey] Deferred credential resolver.
 * @param {{warn?: Function}} [options.logger] Rejection logger.
 * @returns {import('express').RequestHandler} Express middleware.
 */
function createRequireSliceService(options = {}) {
    const logger = options.logger || console;
    const getApiKey = options.getApiKey || (() => (
        options.apiKey === undefined ? process.env.SLICE_SERVICE_API_KEY : options.apiKey
    ));

    return function requireSliceService(req, res, next) {
        const configuredApiKey = getApiKey();
        const suppliedApiKey = req.header('x-slicer-api-key');
        const isAuthenticated = typeof configuredApiKey === 'string'
            && typeof suppliedApiKey === 'string'
            && timingSafeCompare(suppliedApiKey, configuredApiKey);

        if (!isAuthenticated) {
            const requestId = sanitizeLogField(req.requestId, 'n/a');
            const clientIp = sanitizeLogField(getClientIp(req), 'unknown');
            logger.warn?.('[SLICE AUTH] Authentication rejected.', { requestId, clientIp });
            return res.status(401).json(AUTHENTICATION_FAILURE);
        }

        return next();
    };
}

const requireSliceService = createRequireSliceService();

module.exports = requireSliceService;
module.exports.AUTHENTICATION_FAILURE = AUTHENTICATION_FAILURE;
module.exports.createRequireSliceService = createRequireSliceService;
module.exports.sanitizeLogField = sanitizeLogField;
module.exports.timingSafeCompare = timingSafeCompare;
