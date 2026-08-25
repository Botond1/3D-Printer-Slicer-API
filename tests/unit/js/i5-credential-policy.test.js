'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    SERVICE_AUTH_CONFIGURATION_ERROR,
    SLICE_PRINCIPAL_ENV,
    resolveServiceKeyRing
} = require('../../../app/config/service-auth');
const { createRequireSliceService } = require('../../../app/middleware/requireSliceService');
const { NOW, invoke, secret, validEnvironment } = require('./helpers/i5-credential-fixtures');

function assertLegacyOnlyMode() {
    const legacyOnly = validEnvironment();
    for (const names of Object.values(SLICE_PRINCIPAL_ENV)) {
        delete legacyOnly[names.active];
        delete legacyOnly[names.previous];
    }
    legacyOnly.SLICE_SERVICE_AUTH_MODE = 'legacy';
    delete legacyOnly.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL;
    assert.equal(
        resolveServiceKeyRing(legacyOnly, { now: NOW }).audiences.slice.active,
        legacyOnly.SLICE_SERVICE_API_KEY
    );
}

function assertPrincipalOnlyMode() {
    const principalOnly = validEnvironment();
    delete principalOnly.SLICE_SERVICE_API_KEY;
    delete principalOnly.SLICE_SERVICE_API_KEY_PREVIOUS;
    principalOnly.SLICE_SERVICE_AUTH_MODE = 'principals';
    delete principalOnly.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL;
    const ring = resolveServiceKeyRing(principalOnly, { now: NOW });
    assert.equal(ring.audiences.slice.active, null);
    assert.equal(
        ring.audiences.slice.principals.woocommerce.active,
        principalOnly.SLICE_SERVICE_WOOCOMMERCE_API_KEY
    );
    assert.equal(
        ring.audiences.slice.principals.leadpilot.active,
        principalOnly.SLICE_SERVICE_LEADPILOT_API_KEY
    );
    assert.deepEqual(ring.sliceCredentialMode, {
        mode: 'principals', legacyAccepted: false, expiresAt: null
    });
    const middleware = createRequireSliceService({ keyRing: ring, logger: { warn() {} } });
    for (const accepted of [
        principalOnly.SLICE_SERVICE_WOOCOMMERCE_API_KEY,
        principalOnly.SLICE_SERVICE_LEADPILOT_API_KEY
    ]) {
        assert.equal(invoke(middleware, 'x-slicer-api-key', accepted).nextCalls, 1);
    }
    assert.equal(invoke(middleware, 'x-slicer-api-key', secret('slice')).status, 401);
}

function assertIncompleteSliceModesRejected() {
    const mutations = [
        (env) => { delete env.SLICE_SERVICE_WOOCOMMERCE_API_KEY; },
        (env) => { delete env.SLICE_SERVICE_LEADPILOT_API_KEY; },
        (env) => {
            delete env.SLICE_SERVICE_API_KEY;
            delete env.SLICE_SERVICE_API_KEY_PREVIOUS;
            delete env.SLICE_SERVICE_WOOCOMMERCE_API_KEY;
            delete env.SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS;
            delete env.SLICE_SERVICE_LEADPILOT_API_KEY;
            delete env.SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS;
        }
    ];
    for (const mutate of mutations) {
        const incomplete = validEnvironment();
        mutate(incomplete);
        assert.throws(
            () => resolveServiceKeyRing(incomplete, { now: NOW }),
            new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
        );
    }
}

function createMigrationObserver(ring) {
    let requestTime = NOW;
    const comparisons = [];
    const middleware = createRequireSliceService({
        keyRing: ring,
        logger: { warn() {} },
        clock: () => requestTime,
        compareDigests(left, right) {
            comparisons.push([left.length, right.length]);
            return crypto.timingSafeEqual(left, right);
        }
    });
    return {
        observe(credential) {
            const before = comparisons.length;
            const result = invoke(middleware, 'x-slicer-api-key', credential);
            assert.deepEqual(comparisons.slice(before), Array(6).fill([32, 32]));
            return result;
        },
        setRequestTime(value) { requestTime = value; }
    };
}

function assertMigrationRequestBoundary(migration, ring) {
    const observer = createMigrationObserver(ring);
    assert.equal(observer.observe(migration.SLICE_SERVICE_API_KEY).nextCalls, 1);
    const expiresAt = Date.parse(migration.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL);
    observer.setRequestTime(expiresAt);
    assert.equal(observer.observe(migration.SLICE_SERVICE_API_KEY).status, 401);
    assert.equal(observer.observe(migration.SLICE_SERVICE_API_KEY_PREVIOUS).status, 401);
    assert.equal(observer.observe(migration.SLICE_SERVICE_WOOCOMMERCE_API_KEY).nextCalls, 1);
    assert.equal(observer.observe(migration.SLICE_SERVICE_LEADPILOT_API_KEY).nextCalls, 1);
    observer.setRequestTime(expiresAt + 1);
    assert.equal(observer.observe(migration.SLICE_SERVICE_API_KEY).status, 401);
}

function assertInvalidMigrationConfigurationsRejected(migration) {
    const mutations = [
        (env) => { delete env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL; },
        (env) => { env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL = new Date(NOW).toISOString(); },
        (env) => {
            env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL = new Date(
                NOW + (91 * 24 * 60 * 60 * 1000)
            ).toISOString();
        },
        (env) => { env.SLICE_SERVICE_AUTH_MODE = 'unknown'; },
        (env) => {
            env.SLICE_SERVICE_AUTH_MODE = 'principals';
            delete env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL;
        },
        (env) => {
            env.SLICE_SERVICE_AUTH_MODE = 'legacy';
            delete env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL;
        }
    ];
    for (const mutate of mutations) {
        const invalid = validEnvironment();
        mutate(invalid);
        assert.throws(
            () => resolveServiceKeyRing(invalid, { now: NOW }),
            new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
        );
    }
    assert.throws(
        () => resolveServiceKeyRing(migration, {
            now: Date.parse(migration.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL)
        }),
        new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR)
    );
}

test('scoped key ring is immutable and exposes one active plus optional previous slot', () => {
    const ring = resolveServiceKeyRing(validEnvironment(), { now: NOW });
    assert.deepEqual(Object.keys(ring.audiences), [
        'slice', 'pricing', 'artifact', 'operations'
    ]);
    assert.equal(ring.audiences.slice.active, secret('slice'));
    assert.equal(
        ring.audiences.slice.principals.woocommerce.active,
        secret('woocommerce')
    );
    assert.equal(
        ring.audiences.slice.principals.leadpilot.previous,
        secret('leadpilot', 'previous')
    );
    assert.deepEqual(SLICE_PRINCIPAL_ENV, {
        woocommerce: {
            active: 'SLICE_SERVICE_WOOCOMMERCE_API_KEY',
            previous: 'SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS'
        },
        leadpilot: {
            active: 'SLICE_SERVICE_LEADPILOT_API_KEY',
            previous: 'SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS'
        }
    });
    assert.equal(ring.audiences.operations.previous, secret('operations', 'previous'));
    assert.equal(ring.legacyMigration.enabled, false);
    assert.equal(Object.isFrozen(ring), true);
    assert.equal(Object.isFrozen(ring.audiences), true);
    assert.equal(Object.isFrozen(ring.audiences.pricing), true);
    assert.equal(Object.isFrozen(ring.audiences.slice.principals), true);
    assert.equal(Object.isFrozen(ring.audiences.slice.principals.woocommerce), true);
});
test('slice startup accepts only complete legacy, migration, or two-principal modes', () => {
    assertLegacyOnlyMode();
    assertPrincipalOnlyMode();
    assertIncompleteSliceModesRejected();
});

test('slice legacy migration is explicit, bounded, and expires closed', () => {
    const migration = validEnvironment();
    const ring = resolveServiceKeyRing(migration, { now: NOW });
    assert.deepEqual(ring.sliceCredentialMode, {
        mode: 'migration',
        legacyAccepted: true,
        expiresAt: migration.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL
    });
    assertMigrationRequestBoundary(migration, ring);
    assertInvalidMigrationConfigurationsRejected(migration);
});
