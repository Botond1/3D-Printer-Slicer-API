'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const proxyaddr = require('proxy-addr');
const { loadCommonJsFromSource } = require('./helpers/load-commonjs-from-source');

const ROOT = path.resolve(__dirname, '../../..');
const FILES = Object.freeze({
    auth: path.join(ROOT, 'app/config/service-auth.js'),
    audience: path.join(ROOT, 'app/middleware/requireAudience.js'),
    cors: path.join(ROOT, 'app/middleware/corsPolicy.js'),
    trust: path.join(ROOT, 'app/config/trust-proxy.js'),
    requestId: path.join(ROOT, 'app/middleware/requestId.js'),
    events: path.join(ROOT, 'app/services/observability/events.js')
});
const source = (name) => fs.readFileSync(FILES[name], 'utf8');
const keyMaterial = (name) => `i5-${name}-${'x'.repeat(48)}`;

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

function resolveCors(resolver, origin) {
    return new Promise((resolve) => resolver({
        method: 'POST',
        path: '/pricing/FDM',
        header: () => origin
    }, (error, options) => resolve({ error, options })));
}

async function validatePricingOrigin(module) {
    const resolver = module.createCorsOptionsResolver({
        pricingAllowedOrigins: ['https://pricing.invalid'],
        artifactAllowedOrigins: ['https://artifact.invalid']
    });
    assert.equal((await resolveCors(resolver, 'https://pricing.invalid')).error, null);
    assert.equal((await resolveCors(resolver, 'https://artifact.invalid')).error?.code,
        'PRICING_CORS_ORIGIN_NOT_ALLOWED');
}

function forwarded(peer, value) {
    return {
        connection: { remoteAddress: peer },
        socket: { remoteAddress: peer },
        headers: { 'x-forwarded-for': value }
    };
}

function validateTrust(module) {
    assert.equal(module.resolveTrustProxySetting({}), false);
    assert.throws(() => module.resolveTrustProxySetting({
        TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '0.0.0.0/0'
    }));
    const trust = module.resolveTrustProxySetting({
        TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '10.0.0.0/24'
    });
    assert.equal(proxyaddr.all(forwarded('203.0.113.9', '198.51.100.7'), trust).at(-1),
        '203.0.113.9');
}

function validateRequestId(module) {
    const generated = '00000000-0000-4000-8000-000000000099';
    assert.equal(module.resolveRequestId('a'.repeat(128), () => generated), 'a'.repeat(128));
    assert.equal(module.resolveRequestId('a'.repeat(129), () => generated), generated);
    assert.equal(module.resolveRequestId('safe\r\nforged', () => generated), generated);
}

function validateEventRedaction(module) {
    const entries = [];
    const emit = module.createEventEmitter({
        writer: (entry) => entries.push(entry),
        createId: () => '00000000-0000-4000-8000-000000000099'
    });
    emit('artifact.accessed', {
        extra: {
            action: 'Bearer do-not-leak-credential-value',
            technology: 'FDM\r\nforged'
        }
    });
    const serialized = JSON.stringify(entries[0]);
    assert.doesNotMatch(serialized, /do-not-leak|[\r\n]/);
    assert.equal(entries[0].extra.action, '[REDACTED]');
    assert.equal(entries[0].extra.technology, 'FDM??forged');
}

function mutateAndLoad(name, from, to) {
    const original = source(name);
    assert.ok(original.includes(from), `missing I5 mutation anchor in ${name}: ${from}`);
    return loadCommonJsFromSource(FILES[name], original.replace(from, to));
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
        ['active comparison bypasses digest comparator', 'audience',
            'const activeMatch = compareDigests(suppliedDigest, activeDigest);',
            'const activeMatch = supplied === keys.active;',
            validateConstantTime]
    ];
    for (const [name, file, from, to, validate] of cases) await t.test(name, () => {
        assert.throws(() => validate(mutateAndLoad(file, from, to)), assert.AssertionError);
    });
});

test('pricing Origin, trust topology, and request-ID mutations fail', async (t) => {
    await t.test('pricing inherits artifact allowlist', async () => {
        const mutated = mutateAndLoad('cors',
            "pricing: new Set(audienceOrigins('pricing', options.pricingAllowedOrigins))",
            "pricing: new Set(audienceOrigins('artifact', options.artifactAllowedOrigins))");
        await assert.rejects(() => validatePricingOrigin(mutated), assert.AssertionError);
    });
    const cases = [
        ['trust defaults enabled', 'trust',
            "if (!enabled || enabled === 'false') return false;",
            "if (!enabled || enabled === 'false') return true;", validateTrust],
        ['overbroad IPv4 CIDR admitted', 'trust',
            'const minimum = version === 4 ? 8 : 32;',
            'const minimum = version === 4 ? 0 : 0;', validateTrust],
        ['every proxy hop trusted', 'trust',
            'return Boolean(net.isIP(normalized) && trusted.check(normalized, family));',
            'return true;', validateTrust],
        ['request IDs become unbounded', 'requestId',
            '{0,127}', '{0,255}', validateRequestId]
    ];
    for (const [name, file, from, to, validate] of cases) await t.test(name, () => {
        assert.throws(() => validate(mutateAndLoad(file, from, to)), assert.AssertionError);
    });
});

test('event secret-redaction and control-character mutations fail', async (t) => {
    const cases = [
        ['suspicious credential value emitted',
            "if (SUSPICIOUS_VALUE.test(value)) return '[REDACTED]';",
            "if (false) return '[REDACTED]';"],
        ['control characters preserved',
            "return value.replace(/[^\\x20-\\x7e]/g, '?').slice(0, 128);",
            'return value.slice(0, 128);']
    ];
    for (const [name, from, to] of cases) await t.test(name, () => {
        assert.throws(() => validateEventRedaction(
            mutateAndLoad('events', from, to)
        ), assert.AssertionError);
    });
});
