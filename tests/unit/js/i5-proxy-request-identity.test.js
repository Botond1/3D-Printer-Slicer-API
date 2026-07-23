'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');
const {
    TRUST_PROXY_CONFIGURATION_ERROR,
    resolveTrustProxySetting
} = require('../../../app/config/trust-proxy');
const {
    getClientIp,
    normalizeIp
} = require('../../../app/utils/client-ip');
const {
    REQUEST_ID_PATTERN,
    resolveRequestId
} = require('../../../app/middleware/requestId');

function forwardedRequest(peer, xForwardedFor, adjacent = {}) {
    return {
        connection: { remoteAddress: peer },
        socket: { remoteAddress: peer },
        headers: {
            ...(xForwardedFor === undefined ? {} : { 'x-forwarded-for': xForwardedFor }),
            ...adjacent
        }
    };
}

function resolvedIp(request, trust) {
    return proxyaddr.all(request, trust).at(-1);
}

test('trust proxy defaults false and invalid/ambiguous/overbroad configuration fails startup', () => {
    assert.equal(resolveTrustProxySetting({}), false);
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY: 'false' }), false);
    const invalid = [
        { TRUST_PROXY: '1', TRUST_PROXY_CIDRS: '127.0.0.1' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '*' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: 'all' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '0.0.0.0/0' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '::/0' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '10.0.0.1/33' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: '10.0.0.1,10.0.0.1' },
        { TRUST_PROXY: 'true', TRUST_PROXY_CIDRS: 'unknown-name' }
    ];
    for (const env of invalid) {
        assert.throws(
            () => resolveTrustProxySetting(env),
            new RegExp(TRUST_PROXY_CONFIGURATION_ERROR)
        );
    }
});

test('safe explicit loopback, IPv4, IPv6, and mapped-address entries compile', () => {
    for (const entries of [
        'loopback',
        '10.23.4.0/24',
        '2001:db8:1234::/64',
        '127.0.0.1,::1',
        '::ffff:10.23.4.0/120'
    ]) {
        const trust = resolveTrustProxySetting({
            TRUST_PROXY: 'true',
            TRUST_PROXY_CIDRS: entries
        });
        assert.equal(typeof trust, 'function', entries);
    }
});

test('nearest-untrusted hop wins across direct, trusted, and spoofed proxy chains', () => {
    const trust = resolveTrustProxySetting({
        TRUST_PROXY: 'true',
        TRUST_PROXY_CIDRS: '10.0.0.0/24,10.0.1.0/24'
    });
    const cases = [
        ['direct untrusted ignores XFF',
            forwardedRequest('203.0.113.9', '198.51.100.7'), '203.0.113.9'],
        ['single trusted hop',
            forwardedRequest('10.0.0.2', '198.51.100.7'), '198.51.100.7'],
        ['multiple trusted hops',
            forwardedRequest('10.0.0.2', '198.51.100.7, 10.0.1.9'), '198.51.100.7'],
        ['untrusted intermediate stops spoofed prefix',
            forwardedRequest('10.0.0.2', '198.51.100.7, 192.0.2.55'), '192.0.2.55'],
        ['nearest-first spoof is not selected',
            forwardedRequest('10.0.0.2', '203.0.113.88, 10.0.1.9, 192.0.2.4'), '192.0.2.4']
    ];
    for (const [name, request, expected] of cases) {
        assert.equal(resolvedIp(request, trust), expected, name);
    }
    const disabled = () => false;
    assert.equal(
        resolvedIp(forwardedRequest('10.0.0.2', '198.51.100.7'), disabled),
        '10.0.0.2'
    );
});

test('adjacent forwarding headers never affect identity and malformed req.ip falls back to peer', () => {
    const request = forwardedRequest('192.0.2.10', undefined, {
        forwarded: 'for=198.51.100.77',
        'x-real-ip': '198.51.100.77',
        'x-client-ip': '198.51.100.77'
    });
    assert.equal(resolvedIp(request, () => true), '192.0.2.10');
    assert.equal(getClientIp({
        ip: 'not-an-address\r\nforged',
        socket: { remoteAddress: '::ffff:192.0.2.10' }
    }), '192.0.2.10');
    assert.equal(normalizeIp('2001:db8::5'), '2001:db8::5');
    assert.equal(normalizeIp('::ffff:198.51.100.3'), '198.51.100.3');
    assert.equal(normalizeIp('malformed'), null);
});

test('request IDs accept only one bounded safe format and replace everything else', () => {
    const generated = '00000000-0000-4000-8000-000000000001';
    const createId = () => generated;
    for (const accepted of [
        'a', 'request-123', 'svc.trace_123:child', 'x'.repeat(128)
    ]) {
        assert.match(accepted, REQUEST_ID_PATTERN);
        assert.equal(resolveRequestId(accepted, createId), accepted);
    }
    for (const rejected of [
        undefined, '', '-prefix', ' x', 'a/b', 'a?b', 'line\r\nforge', 'x'.repeat(129)
    ]) {
        assert.equal(resolveRequestId(rejected, createId), generated);
    }
});
