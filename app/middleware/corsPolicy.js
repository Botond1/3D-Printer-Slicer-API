'use strict';

/** Dynamic CORS policy for public, admin, and slice-service routes. */

/**
 * Parse a comma-separated origin allowlist.
 * @param {unknown} value Raw configuration value.
 * @returns {string[]} Normalized origins.
 */
function parseAllowedOrigins(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function createOriginError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.status = 403;
    return error;
}

function isAdminRoute(requestPath) {
    return requestPath === '/admin' || requestPath.startsWith('/admin/');
}

function isSliceRoute(requestPath) {
    return /^\/(?:prusa|orca)\/slice\/?$/.test(requestPath);
}

/**
 * Build the callback consumed by the cors package.
 * Browser-origin slice requests use only the slice allowlist. Non-browser
 * requests without Origin continue to be accepted.
 * @param {object} options Policy configuration.
 * @param {string[]} [options.adminAllowedOrigins] Admin browser allowlist.
 * @param {string[]} [options.sliceAllowedOrigins] Slice browser allowlist.
 * @returns {(req: import('express').Request, callback: Function) => void} CORS resolver.
 */
function createCorsOptionsResolver(options = {}) {
    const adminAllowedOrigins = new Set(options.adminAllowedOrigins || []);
    const sliceAllowedOrigins = new Set(options.sliceAllowedOrigins || []);

    return function resolveCorsOptions(req, callback) {
        const requestOrigin = req.header('Origin');
        if (!requestOrigin) {
            callback(null, { origin: true });
            return;
        }

        if (isAdminRoute(req.path)) {
            if (adminAllowedOrigins.has(requestOrigin)) {
                callback(null, { origin: true });
                return;
            }
            callback(createOriginError(
                'ADMIN_CORS_ORIGIN_NOT_ALLOWED',
                'Admin CORS origin is not allowed.'
            ));
            return;
        }

        if (isSliceRoute(req.path)) {
            if (sliceAllowedOrigins.has(requestOrigin)) {
                callback(null, { origin: true });
                return;
            }
            callback(createOriginError(
                'SLICE_CORS_ORIGIN_NOT_ALLOWED',
                'Slice CORS origin is not allowed.'
            ));
            return;
        }

        callback(null, { origin: true });
    };
}

module.exports = {
    createCorsOptionsResolver,
    isAdminRoute,
    isSliceRoute,
    parseAllowedOrigins
};
