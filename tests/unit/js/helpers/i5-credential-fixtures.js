'use strict';

const assert = require('node:assert/strict');

const NOW = Date.parse('2026-07-23T12:00:00.000Z');

function secret(audience, slot = 'active') {
    return `i5-${audience}-${slot}-${'x'.repeat(48)}`;
}

function validEnvironment() {
    return {
        SLICE_SERVICE_API_KEY: secret('slice'),
        SLICE_SERVICE_API_KEY_PREVIOUS: secret('slice', 'previous'),
        SLICE_SERVICE_WOOCOMMERCE_API_KEY: secret('woocommerce'),
        SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: secret('woocommerce', 'previous'),
        SLICE_SERVICE_LEADPILOT_API_KEY: secret('leadpilot'),
        SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS: secret('leadpilot', 'previous'),
        SLICE_SERVICE_AUTH_MODE: 'migration',
        SLICE_SERVICE_LEGACY_MIGRATION_UNTIL: '2026-07-24T12:00:00.000Z',
        PRICING_API_KEY: secret('pricing'),
        PRICING_API_KEY_PREVIOUS: secret('pricing', 'previous'),
        ARTIFACT_API_KEY: secret('artifact'),
        ARTIFACT_API_KEY_PREVIOUS: secret('artifact', 'previous'),
        OPERATIONS_API_KEY: secret('operations'),
        OPERATIONS_API_KEY_PREVIOUS: secret('operations', 'previous')
    };
}

function invoke(middleware, headerName, supplied) {
    const state = { status: null, body: null, nextCalls: 0 };
    middleware({
        requestId: 'req-i5-credential',
        ip: '192.0.2.15',
        header(name) {
            assert.equal(name, headerName);
            return supplied;
        }
    }, {
        status(value) {
            state.status = value;
            return this;
        },
        json(value) {
            state.body = value;
            return this;
        }
    }, () => {
        state.nextCalls += 1;
    });
    return state;
}

module.exports = { NOW, invoke, secret, validEnvironment };
