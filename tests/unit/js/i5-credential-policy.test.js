'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    SERVICE_AUTH_CONFIGURATION_ERROR,
    resolveServiceKeyRing
} = require('../../../app/config/service-auth');
const {
    createRequireAdminAudience
} = require('../../../app/middleware/requireAdmin');
const {
    AUTHENTICATION_FAILURE,
    createRequireSliceService
} = require('../../../app/middleware/requireSliceService');

const NOW = Date.parse('2026-07-23T12:00:00.000Z');

function secret(audience, slot = 'active') {
    return `i5-${audience}-${slot}-${'x'.repeat(48)}`;
}

function validEnvironment() {
    return {
        SLICE_SERVICE_API_KEY: secret('slice'),
        SLICE_SERVICE_API_KEY_PREVIOUS: secret('slice', 'previous'),
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

test('scoped key ring is immutable and exposes one active plus optional previous slot', () => {
    const ring = resolveServiceKeyRing(validEnvironment(), { now: NOW });
    assert.deepEqual(Object.keys(ring.audiences), [
        'slice', 'pricing', 'artifact', 'operations'
    ]);
    assert.equal(ring.audiences.slice.active, secret('slice'));
    assert.equal(ring.audiences.operations.previous, secret('operations', 'previous'));
    assert.equal(ring.legacyMigration.enabled, false);
    assert.equal(Object.isFrozen(ring), true);
    assert.equal(Object.isFrozen(ring.audiences), true);
    assert.equal(Object.isFrozen(ring.audiences.pricing), true);
});

test('startup rejects missing, placeholder, malformed, reused, and duplicate-slot material generically', () => {
    const cases = [
        ['missing active', (env) => { delete env.PRICING_API_KEY; }],
        ['control character', (env) => { env.ARTIFACT_API_KEY = `${'a'.repeat(31)}\n`; }],
        ['placeholder', (env) => { env.OPERATIONS_API_KEY = `example-${'x'.repeat(48)}`; }],
        ['cross-audience duplicate', (env) => { env.ARTIFACT_API_KEY = env.PRICING_API_KEY; }],
        ['same audience duplicate', (env) => { env.PRICING_API_KEY_PREVIOUS = env.PRICING_API_KEY; }]
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
    assert.equal(invoke(afterRevocation, 'x-api-key', secret('pricing', 'previous')).status, 401);
    assert.equal(invoke(afterRevocation, 'x-api-key', secret('pricing')).nextCalls, 1);
});

test('slice keeps its stable 401 and rejects credentials from every admin audience', () => {
    const env = validEnvironment();
    const middleware = createRequireSliceService({
        keyRing: resolveServiceKeyRing(env, { now: NOW }),
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

test('legacy admin migration is one-audience-only, restart-bounded, and expires closed', () => {
    const env = validEnvironment();
    delete env.PRICING_API_KEY;
    env.ADMIN_API_KEY = secret('legacy');
    env.LEGACY_ADMIN_API_KEY_AUDIENCE = 'pricing';
    env.LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL = '2026-07-24T12:00:00.000Z';

    const ring = resolveServiceKeyRing(env, { now: NOW });
    assert.equal(ring.audiences.pricing.active, env.ADMIN_API_KEY);
    assert.deepEqual(ring.legacyMigration, {
        enabled: true,
        audience: 'pricing',
        expiresAt: '2026-07-24T12:00:00.000Z'
    });
    for (const invalidAudience of ['slice', 'all', '']) {
        assert.throws(() => resolveServiceKeyRing({
            ...env,
            LEGACY_ADMIN_API_KEY_AUDIENCE: invalidAudience
        }, { now: NOW }), new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR));
    }
    assert.throws(
        () => resolveServiceKeyRing(env, { now: Date.parse(env.LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL) }),
        new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
    );
});
