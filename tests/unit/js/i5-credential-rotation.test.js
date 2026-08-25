'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    SERVICE_AUTH_CONFIGURATION_ERROR,
    resolveServiceKeyRing
} = require('../../../app/config/service-auth');
const { createRequireAdminAudience } = require('../../../app/middleware/requireAdmin');
const {
    AUTHENTICATION_FAILURE,
    createRequireSliceService
} = require('../../../app/middleware/requireSliceService');
const { NOW, invoke, secret, validEnvironment } = require('./helpers/i5-credential-fixtures');

test('startup rejects missing, placeholder, malformed, reused, and duplicate-slot material generically', () => {
    const cases = [
        ['missing active', (env) => { delete env.PRICING_API_KEY; }],
        ['control character', (env) => { env.ARTIFACT_API_KEY = `${'a'.repeat(31)}\n`; }],
        ['placeholder', (env) => { env.OPERATIONS_API_KEY = `example-${'x'.repeat(48)}`; }],
        ['cross-audience duplicate', (env) => { env.ARTIFACT_API_KEY = env.PRICING_API_KEY; }],
        ['same audience duplicate', (env) => { env.PRICING_API_KEY_PREVIOUS = env.PRICING_API_KEY; }],
        ['cross-principal duplicate', (env) => {
            env.SLICE_SERVICE_LEADPILOT_API_KEY = env.SLICE_SERVICE_WOOCOMMERCE_API_KEY;
        }],
        ['cross-audience principal duplicate', (env) => {
            env.SLICE_SERVICE_WOOCOMMERCE_API_KEY = env.ARTIFACT_API_KEY;
        }],
        ['principal previous without active', (env) => {
            delete env.SLICE_SERVICE_WOOCOMMERCE_API_KEY;
        }],
        ['malformed principal active', (env) => {
            env.SLICE_SERVICE_LEADPILOT_API_KEY = 'short';
        }]
    ];
    for (const [name, mutate] of cases) {
        const env = validEnvironment();
        mutate(env);
        assert.throws(
            () => resolveServiceKeyRing(env, { now: NOW }),
            (error) => {
                assert.equal(error.message, SERVICE_AUTH_CONFIGURATION_ERROR, name);
                assert.doesNotMatch(error.message, /PRICING|ARTIFACT|example|i5-/i, name);
                return true;
            }
        );
    }
});

test('active and previous credentials rotate per audience and removal revokes previous', () => {
    const env = validEnvironment();
    const ring = resolveServiceKeyRing(env, { now: NOW });
    const pricing = createRequireAdminAudience('pricing', ring, { logger: { warn() {} } });
    for (const accepted of [env.PRICING_API_KEY, env.PRICING_API_KEY_PREVIOUS]) {
        assert.deepEqual(invoke(pricing, 'x-api-key', accepted), {
            status: null, body: null, nextCalls: 1
        });
    }
    for (const rejected of [env.ARTIFACT_API_KEY, env.OPERATIONS_API_KEY, 'short']) {
        const result = invoke(pricing, 'x-api-key', rejected);
        assert.equal(result.status, 401);
        assert.equal(result.nextCalls, 0);
        assert.equal(result.body.errorCode, 'PRICING_AUTH_REQUIRED');
    }

    delete env.PRICING_API_KEY_PREVIOUS;
    const restarted = resolveServiceKeyRing(env, { now: NOW });
    const afterRevocation = createRequireAdminAudience('pricing', restarted, {
        logger: { warn() {} }
    });
    assert.equal(invoke(afterRevocation, 'x-api-key', undefined).status, 401);
    assert.equal(invoke(afterRevocation, 'x-api-key', secret('pricing', 'previous')).status, 401);
    assert.equal(invoke(afterRevocation, 'x-api-key', secret('pricing')).nextCalls, 1);
});

test('WooCommerce and LeadPilot rotate and revoke independently while legacy slice keys remain valid', () => {
    const env = validEnvironment();
    const legacyKeys = [env.SLICE_SERVICE_API_KEY, env.SLICE_SERVICE_API_KEY_PREVIOUS];
    const leadPilotKeys = [
        env.SLICE_SERVICE_LEADPILOT_API_KEY,
        env.SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS
    ];
    const originalWooCommerceKey = env.SLICE_SERVICE_WOOCOMMERCE_API_KEY;
    const nextWooCommerceKey = secret('woocommerce', 'next');
    env.SLICE_SERVICE_WOOCOMMERCE_API_KEY = nextWooCommerceKey;
    env.SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS = originalWooCommerceKey;

    const duringRotation = createRequireSliceService({
        keyRing: resolveServiceKeyRing(env, { now: NOW }),
        clock: () => NOW,
        logger: { warn() {} }
    });
    for (const accepted of [
        ...legacyKeys,
        ...leadPilotKeys,
        nextWooCommerceKey,
        originalWooCommerceKey
    ]) {
        assert.equal(invoke(duringRotation, 'x-slicer-api-key', accepted).nextCalls, 1);
    }

    delete env.SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS;
    const afterWooCommerceRevocation = createRequireSliceService({
        keyRing: resolveServiceKeyRing(env, { now: NOW }),
        clock: () => NOW,
        logger: { warn() {} }
    });
    assert.equal(
        invoke(afterWooCommerceRevocation, 'x-slicer-api-key', originalWooCommerceKey).status,
        401
    );
    assert.equal(
        invoke(afterWooCommerceRevocation, 'x-slicer-api-key', nextWooCommerceKey).nextCalls,
        1
    );
    for (const unaffected of [...legacyKeys, ...leadPilotKeys]) {
        assert.equal(
            invoke(afterWooCommerceRevocation, 'x-slicer-api-key', unaffected).nextCalls,
            1
        );
    }
});

test('slice keeps its stable 401 and rejects credentials from every admin audience', () => {
    const env = validEnvironment();
    const middleware = createRequireSliceService({
        keyRing: resolveServiceKeyRing(env, { now: NOW }),
        clock: () => NOW,
        logger: { warn() {} }
    });
    for (const rejected of [
        undefined, env.PRICING_API_KEY, env.ARTIFACT_API_KEY, env.OPERATIONS_API_KEY
    ]) {
        assert.deepEqual(invoke(middleware, 'x-slicer-api-key', rejected), {
            status: 401,
            body: AUTHENTICATION_FAILURE,
            nextCalls: 0
        });
    }
    assert.equal(invoke(middleware, 'x-slicer-api-key', env.SLICE_SERVICE_API_KEY).nextCalls, 1);
});

test('every supplied credential performs fixed-length active and previous comparisons', () => {
    const env = validEnvironment();
    const calls = [];
    const middleware = createRequireAdminAudience(
        'artifact',
        resolveServiceKeyRing(env, { now: NOW }),
        {
            logger: { warn() {} },
            compareDigests(left, right) {
                calls.push([left.length, right.length]);
                return crypto.timingSafeEqual(left, right);
            }
        }
    );
    for (const candidate of [env.ARTIFACT_API_KEY, 'short', undefined]) {
        const before = calls.length;
        invoke(middleware, 'x-api-key', candidate);
        assert.deepEqual(calls.slice(before), [[32, 32], [32, 32]]);
    }
});

test('slice compares every legacy and consumer rotation slot before deciding', () => {
    const env = validEnvironment();
    delete env.SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS;
    delete env.SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS;
    delete env.SLICE_SERVICE_API_KEY_PREVIOUS;
    const calls = [];
    const middleware = createRequireSliceService({
        keyRing: resolveServiceKeyRing(env, { now: NOW }),
        logger: { warn() {} },
        compareDigests(left, right) {
            calls.push([left.length, right.length]);
            return crypto.timingSafeEqual(left, right);
        }
    });

    for (const candidate of [env.SLICE_SERVICE_LEADPILOT_API_KEY, 'short', '', undefined]) {
        const before = calls.length;
        const result = invoke(middleware, 'x-slicer-api-key', candidate);
        assert.deepEqual(calls.slice(before), Array(6).fill([32, 32]));
        assert.equal(result.nextCalls, candidate === env.SLICE_SERVICE_LEADPILOT_API_KEY ? 1 : 0);
        assert.equal(result.status, candidate === env.SLICE_SERVICE_LEADPILOT_API_KEY ? null : 401);
    }
});
