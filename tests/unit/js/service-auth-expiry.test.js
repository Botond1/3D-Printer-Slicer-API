'use strict';

/**
 * 3.9.0 key ring (§4.5, R6/R7): an expired slice migration no longer refuses
 * startup, the optional `staging` principal, and the `rotation` label of each
 * matched slot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    LEGACY_SLICE_SLOT_EXPIRED,
    OPTIONAL_SLICE_PRINCIPAL_ENV,
    SERVICE_AUTH_CONFIGURATION_ERROR,
    SLICE_PRINCIPAL_ENV,
    resolveKeyRingReadinessReasons,
    resolveServiceKeyRing
} = require('../../../app/config/service-auth');
const { createRequireSliceService } = require('../../../app/middleware/requireSliceService');
const {
    resolveMatchedRotation,
    resolveMatchedSlot
} = require('../../../app/middleware/requireAudience');

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const CLIFF = '2026-11-30T00:00:00.000Z';
const secret = fixtureKey;

function fixtureKey(name) {
    return ['expiry', name, 'z'.repeat(40)].join('-');
}

function migrationEnvironment(overrides = {}) {
    return {
        SLICE_SERVICE_API_KEY: secret('legacy'),
        SLICE_SERVICE_API_KEY_PREVIOUS: secret('legacy-previous'),
        SLICE_SERVICE_WOOCOMMERCE_API_KEY: secret('woocommerce'),
        SLICE_SERVICE_LEADPILOT_API_KEY: secret('leadpilot'),
        SLICE_SERVICE_AUTH_MODE: 'migration',
        SLICE_SERVICE_LEGACY_MIGRATION_UNTIL: CLIFF,
        PRICING_API_KEY: secret('pricing'),
        ARTIFACT_API_KEY: secret('artifact'),
        OPERATIONS_API_KEY: secret('operations'),
        ...overrides
    };
}

function principalsEnvironment(overrides = {}) {
    const env = migrationEnvironment(overrides);
    delete env.SLICE_SERVICE_API_KEY;
    delete env.SLICE_SERVICE_API_KEY_PREVIOUS;
    delete env.SLICE_SERVICE_LEGACY_MIGRATION_UNTIL;
    env.SLICE_SERVICE_AUTH_MODE = 'principals';
    return env;
}

function invoke(middleware, supplied, extra = {}) {
    const state = { status: null, body: null, next: 0, req: null };
    const headers = supplied === undefined ? {} : { 'x-slicer-api-key': supplied };
    const req = {
        requestId: 'req-under-test',
        ip: '192.0.2.20',
        headers: { ...headers, ...extra },
        header: (name) => headers[name.toLowerCase()]
    };
    state.req = req;
    middleware(req, {
        status(value) { state.status = value; return this; },
        json(value) { state.body = value; return this; }
    }, () => { state.next += 1; });
    return state;
}

test('frozen clock past the migration date: startup succeeds, shared 401, principals 202-path', () => {
    const env = migrationEnvironment();
    const afterCliff = Date.parse(CLIFF) + 1;
    let ring;
    assert.doesNotThrow(() => { ring = resolveServiceKeyRing(env, { now: afterCliff }); });
    assert.deepEqual(ring.sliceCredentialMode, {
        mode: 'migration', legacyAccepted: false, expired: true, expiresAt: CLIFF
    });
    assert.equal(Object.isFrozen(ring.sliceCredentialMode), true);
    assert.deepEqual(resolveKeyRingReadinessReasons(ring, afterCliff), [LEGACY_SLICE_SLOT_EXPIRED]);
    // Exactly at the date counts as expired too (expiry <= now).
    assert.equal(resolveServiceKeyRing(env, { now: Date.parse(CLIFF) }).sliceCredentialMode.expired, true);

    const events = [];
    const middleware = createRequireSliceService({
        keyRing: ring,
        logger: { warn() {} },
        clock: () => afterCliff,
        emit: (name, data) => events.push([name, data])
    });
    for (const legacy of [env.SLICE_SERVICE_API_KEY, env.SLICE_SERVICE_API_KEY_PREVIOUS]) {
        const refused = invoke(middleware, legacy);
        assert.equal(refused.status, 401);
        assert.equal(refused.body.errorCode, 'SLICE_SERVICE_AUTH_REQUIRED');
    }
    for (const [principal, slot] of [[env.SLICE_SERVICE_WOOCOMMERCE_API_KEY, 'woocommerce'],
        [env.SLICE_SERVICE_LEADPILOT_API_KEY, 'leadpilot']]) {
        const accepted = invoke(middleware, principal);
        assert.equal(accepted.next, 1);
        assert.deepEqual(accepted.req.slicePrincipal, { audience: 'slice', slot, rotation: 'active' });
    }
    // One `auth.legacy_migration_expired` line per minute, labels only.
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'auth.legacy_migration_expired');
    assert.deepEqual(events[0][1].extra, { slot: 'shared', reason: LEGACY_SLICE_SLOT_EXPIRED });
    assert.doesNotMatch(JSON.stringify(events), /expiry-legacy/);
});

test('a live (unexpired) migration keeps 3.8.3 behaviour and readiness reasons only follow the clock', () => {
    const env = migrationEnvironment();
    const ring = resolveServiceKeyRing(env, { now: NOW });
    assert.deepEqual(ring.sliceCredentialMode, { mode: 'migration', legacyAccepted: true, expiresAt: CLIFF });
    assert.deepEqual(resolveKeyRingReadinessReasons(ring, NOW), []);
    assert.deepEqual(resolveKeyRingReadinessReasons(ring, Date.parse(CLIFF)), [LEGACY_SLICE_SLOT_EXPIRED]);
    const principals = resolveServiceKeyRing(principalsEnvironment(), { now: NOW });
    assert.deepEqual(resolveKeyRingReadinessReasons(principals, Date.parse(CLIFF) + 1), []);
    const middleware = createRequireSliceService({ keyRing: ring, logger: { warn() {} }, clock: () => NOW });
    assert.deepEqual(invoke(middleware, env.SLICE_SERVICE_API_KEY).req.slicePrincipal,
        { audience: 'slice', slot: 'shared', rotation: 'active' });
    assert.deepEqual(invoke(middleware, env.SLICE_SERVICE_API_KEY_PREVIOUS).req.slicePrincipal,
        { audience: 'slice', slot: 'shared', rotation: 'previous' });
});

test('malformed and > 90-day migration dates stay startup errors', () => {
    for (const until of ['not-a-date', '', new Date(NOW + 91 * 24 * 3600 * 1000).toISOString()]) {
        assert.throws(
            () => resolveServiceKeyRing(migrationEnvironment({ SLICE_SERVICE_LEGACY_MIGRATION_UNTIL: until }), { now: NOW }),
            new RegExp(SERVICE_AUTH_CONFIGURATION_ERROR),
            until
        );
    }
    // An expired migration still needs every principal (fail closed, as before).
    const partial = migrationEnvironment();
    delete partial.SLICE_SERVICE_LEADPILOT_API_KEY;
    assert.throws(() => resolveServiceKeyRing(partial, { now: Date.parse(CLIFF) + 1 }));
});

test('the R7 cutover state (legacy key moved into WOOCOMMERCE_PREVIOUS, principals mode) resolves', () => {
    const env = principalsEnvironment({ SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: secret('legacy') });
    const ring = resolveServiceKeyRing(env, { now: Date.parse(CLIFF) + 86_400_000 });
    assert.deepEqual(ring.sliceCredentialMode, { mode: 'principals', legacyAccepted: false, expiresAt: null });
    const middleware = createRequireSliceService({ keyRing: ring, logger: { warn() {} } });
    const moved = invoke(middleware, secret('legacy'));
    assert.deepEqual(moved.req.slicePrincipal, { audience: 'slice', slot: 'woocommerce', rotation: 'previous' });
    const current = invoke(middleware, secret('woocommerce'));
    assert.deepEqual(current.req.slicePrincipal, { audience: 'slice', slot: 'woocommerce', rotation: 'active' });
});

test('staging principal: optional, own slot, unique, not part of allPrincipalsActive; absent = 3.8.3 ring', () => {
    assert.deepEqual(OPTIONAL_SLICE_PRINCIPAL_ENV, {
        staging: { active: 'SLICE_SERVICE_STAGING_API_KEY', previous: 'SLICE_SERVICE_STAGING_API_KEY_PREVIOUS' }
    });
    assert.deepEqual(Object.keys(SLICE_PRINCIPAL_ENV), ['woocommerce', 'leadpilot']);

    const absent = resolveServiceKeyRing(principalsEnvironment(), { now: NOW });
    assert.deepEqual(Object.keys(absent.audiences.slice.principals), ['woocommerce', 'leadpilot']);
    let comparisons = 0;
    const absentAuth = createRequireSliceService({
        keyRing: absent,
        logger: { warn() {} },
        compareDigests(left, right) { comparisons += 1; return crypto.timingSafeEqual(left, right); }
    });
    invoke(absentAuth, secret('woocommerce'));
    assert.equal(comparisons, 6, 'absent staging adds no comparison slot');

    const env = principalsEnvironment({
        SLICE_SERVICE_STAGING_API_KEY: secret('staging'),
        SLICE_SERVICE_STAGING_API_KEY_PREVIOUS: secret('staging-previous')
    });
    const ring = resolveServiceKeyRing(env, { now: NOW });
    assert.equal(ring.audiences.slice.principals.staging.active, secret('staging'));
    assert.equal(Object.isFrozen(ring.audiences.slice.principals.staging), true);
    const middleware = createRequireSliceService({ keyRing: ring, logger: { warn() {} } });
    assert.deepEqual(invoke(middleware, secret('staging')).req.slicePrincipal,
        { audience: 'slice', slot: 'staging', rotation: 'active' });
    assert.deepEqual(invoke(middleware, secret('staging-previous')).req.slicePrincipal,
        { audience: 'slice', slot: 'staging', rotation: 'previous' });
    assert.deepEqual(invoke(middleware, secret('leadpilot')).req.slicePrincipal,
        { audience: 'slice', slot: 'leadpilot', rotation: 'active' });

    // Without staging, principals mode still needs both required principals.
    const missingLead = principalsEnvironment({ SLICE_SERVICE_STAGING_API_KEY: secret('staging') });
    delete missingLead.SLICE_SERVICE_LEADPILOT_API_KEY;
    assert.throws(() => resolveServiceKeyRing(missingLead, { now: NOW }));
    // A staging key equal to another slot is refused.
    assert.throws(() => resolveServiceKeyRing(
        principalsEnvironment({ SLICE_SERVICE_STAGING_API_KEY: secret('woocommerce') }), { now: NOW }));
    // A previous without an active, or a placeholder, is refused.
    assert.throws(() => resolveServiceKeyRing(
        principalsEnvironment({ SLICE_SERVICE_STAGING_API_KEY_PREVIOUS: secret('staging') }), { now: NOW }));
    assert.throws(() => resolveServiceKeyRing(
        principalsEnvironment({ SLICE_SERVICE_STAGING_API_KEY: 'changeme' }), { now: NOW }));
    // Legacy mode carries no principal material, staging included.
    const legacy = {
        SLICE_SERVICE_API_KEY: secret('legacy'),
        SLICE_SERVICE_AUTH_MODE: 'legacy',
        SLICE_SERVICE_STAGING_API_KEY: secret('staging'),
        PRICING_API_KEY: secret('pricing'),
        ARTIFACT_API_KEY: secret('artifact'),
        OPERATIONS_API_KEY: secret('operations')
    };
    assert.throws(() => resolveServiceKeyRing(legacy, { now: NOW }));
});

test('rotation label per matched index', () => {
    const names = ['leadpilot', 'staging', 'woocommerce'];
    const expected = [
        [0, 'shared', 'active'], [1, 'shared', 'previous'],
        [2, 'leadpilot', 'active'], [3, 'leadpilot', 'previous'],
        [4, 'staging', 'active'], [5, 'staging', 'previous'],
        [6, 'woocommerce', 'active'], [7, 'woocommerce', 'previous']
    ];
    for (const [index, slot, rotation] of expected) {
        assert.equal(resolveMatchedSlot(index, names), slot, `${index}`);
        assert.equal(resolveMatchedRotation(index), rotation, `${index}`);
    }
    // A ring without a compared previous slot shifts the principals by one.
    assert.equal(resolveMatchedSlot(1, names, 1), 'leadpilot');
    assert.equal(resolveMatchedRotation(2, 1), 'previous');
});

test('onAccepted receives labels only; a throwing observer never changes the outcome', () => {
    const ring = resolveServiceKeyRing(principalsEnvironment(), { now: NOW });
    const seen = [];
    const middleware = createRequireSliceService({
        keyRing: ring,
        logger: { warn() {} },
        onAccepted(event) { seen.push(event); throw new Error('observer failure'); }
    });
    const accepted = invoke(middleware, secret('woocommerce'));
    assert.equal(accepted.next, 1);
    assert.deepEqual(seen, [{ audience: 'slice', slot: 'woocommerce', rotation: 'active', clientIp: '192.0.2.20' }]);
    assert.doesNotMatch(JSON.stringify(seen), /expiry-/);
    invoke(middleware, secret('nope'));
    assert.equal(seen.length, 1, 'a rejection is never reported as accepted');
});

test('rejection metadata keeps two enumerable fields and carries hidden attribution', () => {
    const ring = resolveServiceKeyRing(principalsEnvironment(), { now: NOW });
    const warnings = [];
    const middleware = createRequireSliceService({ keyRing: ring, logger: { warn: (...args) => warnings.push(args) } });
    invoke(middleware, secret('nope'), { 'x-request-id': 'plugin-req-42' });
    invoke(middleware, undefined, { 'x-request-id': 'bad id with spaces' });
    const [first, second] = warnings.map((args) => args[1]);
    assert.deepEqual(Object.keys(first).sort(), ['clientIp', 'requestId']);
    assert.equal(first.reason, 'invalid_key');
    assert.match(first.serverRequestId, /^srv-[0-9a-f]{16}$/);
    assert.equal(first.clientRequestId, 'plugin-req-42');
    assert.equal(second.reason, 'missing_key');
    assert.equal(second.clientRequestId, undefined);
    assert.notEqual(first.serverRequestId, second.serverRequestId);
    assert.doesNotMatch(JSON.stringify(warnings), /expiry-/);
});
