'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');
const { mutateAndLoad } = require('./helpers/i5-security-mutation-fixtures');

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
