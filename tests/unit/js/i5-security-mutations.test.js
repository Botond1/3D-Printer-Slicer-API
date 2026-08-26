'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    keyMaterial,
    mutateAndLoad
} = require('./helpers/i5-security-mutation-fixtures');

function environment() {
    return {
        SLICE_SERVICE_API_KEY: keyMaterial('slice-active'),
        SLICE_SERVICE_API_KEY_PREVIOUS: keyMaterial('slice-previous'),
        PRICING_API_KEY: keyMaterial('pricing-active'),
        PRICING_API_KEY_PREVIOUS: keyMaterial('pricing-previous'),
        ARTIFACT_API_KEY: keyMaterial('artifact-active'),
        ARTIFACT_API_KEY_PREVIOUS: keyMaterial('artifact-previous'),
        OPERATIONS_API_KEY: keyMaterial('operations-active'),
        OPERATIONS_API_KEY_PREVIOUS: keyMaterial('operations-previous')
    };
}

function validateKeyRing(module) {
    const env = environment();
    const ring = module.resolveServiceKeyRing(env, { now: 1 });
    assert.deepEqual(Object.keys(ring.audiences),
        ['slice', 'pricing', 'artifact', 'operations']);
    assert.equal(ring.audiences.pricing.active, env.PRICING_API_KEY);
    assert.equal(ring.audiences.artifact.active, env.ARTIFACT_API_KEY);
    const revoked = { ...env };
    delete revoked.PRICING_API_KEY_PREVIOUS;
    assert.equal(module.resolveServiceKeyRing(revoked, { now: 1 })
        .audiences.pricing.previous, null);
    assert.throws(() => module.resolveServiceKeyRing({
        ...env,
        ARTIFACT_API_KEY: env.PRICING_API_KEY
    }, { now: 1 }));
}

function validateSlicePrincipalCompleteness(module) {
    const env = {
        ...environment(),
        SLICE_SERVICE_WOOCOMMERCE_API_KEY: keyMaterial('woocommerce-active'),
        SLICE_SERVICE_AUTH_MODE: 'migration',
        SLICE_SERVICE_LEGACY_MIGRATION_UNTIL: '1970-01-02T00:00:00.000Z'
    };
    assert.throws(() => module.resolveServiceKeyRing(env, { now: 1 }));
}

function validateAdminMaterialUniqueness(module) {
    const env = environment();
    env.ADMIN_API_KEY = env.SLICE_SERVICE_API_KEY;
    assert.throws(() => module.resolveServiceKeyRing(env, { now: 1 }));
}

function validateLegacyAdminSubstitutionSlots(module) {
    const env = environment();
    delete env.PRICING_API_KEY;
    env.ADMIN_API_KEY = keyMaterial('legacy-admin');
    env.LEGACY_ADMIN_API_KEY_AUDIENCE = 'pricing';
    env.LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL = '1970-01-02T00:00:00.000Z';
    assert.doesNotThrow(() => module.resolveServiceKeyRing(env, { now: 1 }));
    env.PRICING_API_KEY_PREVIOUS = env.ADMIN_API_KEY;
    assert.throws(() => module.resolveServiceKeyRing(env, { now: 1 }));
}

function invoke(middleware, supplied) {
    const state = { status: null, next: 0 };
    middleware({
        requestId: 'i5-mutation',
        socket: { remoteAddress: '192.0.2.2' },
        header: () => supplied
    }, {
        status(value) { state.status = value; return this; },
        json() { return this; }
    }, () => { state.next += 1; });
    return state;
}

function validateConstantTime(module) {
    const calls = [];
    const compare = (left, right) => {
        calls.push([left.length, right.length]);
        return crypto.timingSafeEqual(left, right);
    };
    const middleware = module.createRequireAudience({
        audience: 'pricing',
        keyRing: { audiences: { pricing: {
            active: keyMaterial('pricing-active'),
            previous: keyMaterial('pricing-previous')
        } } },
        compareDigests: compare,
        logger: { warn() {} }
    });
    assert.equal(invoke(middleware, keyMaterial('pricing-active')).next, 1);
    assert.equal(invoke(middleware, 'short').status, 401);
    assert.deepEqual(calls, [[32, 32], [32, 32], [32, 32], [32, 32]]);
}

function validateDummySlotsNeverAuthorize(module) {
    const middleware = module.createRequireAudience({
        audience: 'slice',
        keyRing: { audiences: { slice: { active: keyMaterial('slice-active') } } },
        logger: { warn() {} }
    });
    assert.equal(invoke(middleware, '').status, 401);
    assert.equal(invoke(middleware, undefined).status, 401);
}

function validateSliceMigrationExpiry(module) {
    const expiryMs = Date.parse('2030-01-02T00:00:00.000Z');
    const legacyActive = keyMaterial('slice-active');
    const legacyPrevious = keyMaterial('slice-previous');
    const woocommerceActive = keyMaterial('woocommerce-active');
    const leadpilotActive = keyMaterial('leadpilot-active');
    const calls = [];
    let now = expiryMs;
    const middleware = module.createRequireAudience({
        audience: 'slice',
        keyRing: {
            audiences: { slice: {
                active: legacyActive,
                previous: legacyPrevious,
                principals: {
                    woocommerce: { active: woocommerceActive, previous: null },
                    leadpilot: { active: leadpilotActive, previous: null }
                }
            } },
            sliceCredentialMode: {
                mode: 'migration',
                expiresAt: new Date(expiryMs).toISOString()
            }
        },
        compareDigests(left, right) {
            calls.push([left.length, right.length]);
            return crypto.timingSafeEqual(left, right);
        },
        clock: () => now,
        logger: { warn() {} }
    });
    const observe = (supplied, observedAt) => {
        now = observedAt;
        const before = calls.length;
        const result = invoke(middleware, supplied);
        assert.equal(calls.length - before, 6);
        assert.deepEqual(calls.slice(before), Array(6).fill([32, 32]));
        return result;
    };

    const exactActive = observe(legacyActive, expiryMs);
    const exactPrevious = observe(legacyPrevious, expiryMs);
    const exactPrincipal = observe(woocommerceActive, expiryMs);
    const afterActive = observe(legacyActive, expiryMs + 1);
    const afterPrevious = observe(legacyPrevious, expiryMs + 1);
    const afterPrincipal = observe(leadpilotActive, expiryMs + 1);

    assert.equal(exactPrincipal.next, 1);
    assert.equal(afterPrincipal.next, 1);
    assert.equal(exactActive.status, 401);
    assert.equal(exactPrevious.status, 401);
    assert.equal(afterActive.status, 401);
    assert.equal(afterPrevious.status, 401);
}

test('credential audience, revocation, duplicate, and constant-time mutations fail', async (t) => {
    const cases = [
        ['audience alias', 'auth',
            'audiences[audience] = immutableAudienceKey(active, previous);',
            "audiences[audience === 'artifact' ? 'pricing' : audience] = immutableAudienceKey(active, previous);",
            validateKeyRing],
        ['revocation retains active as previous', 'auth',
            'return Object.freeze({ active, previous: previous || null });',
            'return Object.freeze({ active, previous: previous || active });',
            validateKeyRing],
        ['cross-audience duplicate admitted', 'auth',
            'if (material.includes(secret)) throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);',
            'if (false) throw new Error(SERVICE_AUTH_CONFIGURATION_ERROR);',
            validateKeyRing],
        ['configured admin duplicate admitted', 'auth',
            'if (adminSecret && isValidServiceSecret(adminSecret)) material.push(adminSecret);',
            'void adminSecret;',
            validateAdminMaterialUniqueness],
        ['legacy previous duplicates substituted admin', 'auth',
            'if (previous) registerUniqueSecret(material, previous);',
            'void previous;',
            validateLegacyAdminSubstitutionSlots],
        ['partial slice principal rollout admitted', 'auth',
            '|| !allPrincipalsActive\n        || !Number.isFinite(expiryMs)',
            '|| !Number.isFinite(expiryMs)',
            validateSlicePrincipalCompleteness],
        ['active comparison bypasses digest comparator', 'audience',
            'compareDigests(suppliedDigest, expectedDigest) && Boolean(slotSecrets[index])',
            'supplied === slotSecrets[index] && Boolean(slotSecrets[index])',
            validateConstantTime],
        ['empty dummy slot authorizes empty header', 'audience',
            'compareDigests(suppliedDigest, expectedDigest) && Boolean(slotSecrets[index])',
            'compareDigests(suppliedDigest, expectedDigest)',
            validateDummySlotsNeverAuthorize],
        ['request-time slice migration expiry bypassed', 'audience',
            'const legacyAllowed = legacySlotsAllowed(keys, clock());',
            'const legacyAllowed = true;',
            validateSliceMigrationExpiry]
    ];
    for (const [name, file, from, to, validate] of cases) await t.test(name, () => {
        assert.throws(() => validate(mutateAndLoad(file, from, to)), assert.AssertionError);
    });
});
