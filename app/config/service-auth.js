'use strict';

/** Slice-service credential configuration and startup validation. */

const SLICE_SERVICE_KEY_LIMITS = Object.freeze({
    minimumBytes: 32,
    maximumBytes: 256
});

const SERVICE_AUTH_CONFIGURATION_ERROR = 'Service authentication configuration is invalid.';

/**
 * Check the bounded secret format without normalizing or disclosing the value.
 * @param {unknown} value Candidate secret.
 * @returns {boolean} True for printable ASCII secrets within the byte envelope.
 */
function isValidSliceServiceSecret(value) {
    if (typeof value !== 'string') return false;
    const byteLength = Buffer.byteLength(value, 'utf8');
    return byteLength >= SLICE_SERVICE_KEY_LIMITS.minimumBytes
        && byteLength <= SLICE_SERVICE_KEY_LIMITS.maximumBytes
        && /^[\x20-\x7e]+$/.test(value);
}

/**
 * Resolve the mandatory, separately scoped slice-service credential.
 * All invalid states use the same generic error so secret material is never disclosed.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} env Environment source.
 * @returns {string} Validated slice-service credential.
 */
function resolveSliceServiceApiKey(env = process.env) {
    const sliceServiceApiKey = env.SLICE_SERVICE_API_KEY;
    const adminApiKey = env.ADMIN_API_KEY;
    if (
        !isValidSliceServiceSecret(sliceServiceApiKey)
        || (typeof adminApiKey === 'string' && sliceServiceApiKey === adminApiKey)
    ) {
        throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);
    }
    return sliceServiceApiKey;
}

module.exports = {
    SERVICE_AUTH_CONFIGURATION_ERROR,
    SLICE_SERVICE_KEY_LIMITS,
    isValidSliceServiceSecret,
    resolveSliceServiceApiKey
};
