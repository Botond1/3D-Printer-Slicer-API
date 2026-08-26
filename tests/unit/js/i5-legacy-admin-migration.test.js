'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SERVICE_AUTH_CONFIGURATION_ERROR,
    resolveServiceKeyRing
} = require('../../../app/config/service-auth');
const { NOW, secret, validEnvironment } = require('./helpers/i5-credential-fixtures');

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

test('configured admin material remains globally unique outside authorized substitution', () => {
    const duplicatesSlice = validEnvironment();
    duplicatesSlice.ADMIN_API_KEY = duplicatesSlice.SLICE_SERVICE_API_KEY;
    assert.throws(
        () => resolveServiceKeyRing(duplicatesSlice, { now: NOW }),
        new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
    );

    const duplicatesExplicitAudience = validEnvironment();
    duplicatesExplicitAudience.ADMIN_API_KEY = duplicatesExplicitAudience.PRICING_API_KEY;
    assert.throws(
        () => resolveServiceKeyRing(duplicatesExplicitAudience, { now: NOW }),
        new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
    );

    const duplicatesMigrationPrevious = validEnvironment();
    delete duplicatesMigrationPrevious.PRICING_API_KEY;
    duplicatesMigrationPrevious.ADMIN_API_KEY = secret('legacy-previous');
    duplicatesMigrationPrevious.PRICING_API_KEY_PREVIOUS =
        duplicatesMigrationPrevious.ADMIN_API_KEY;
    duplicatesMigrationPrevious.LEGACY_ADMIN_API_KEY_AUDIENCE = 'pricing';
    duplicatesMigrationPrevious.LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL =
        '2026-07-24T12:00:00.000Z';
    assert.throws(
        () => resolveServiceKeyRing(duplicatesMigrationPrevious, { now: NOW }),
        new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
    );
});
