'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    HTTP_SERVER_BOUNDS,
    HTTP_SERVER_DEFAULTS,
    TRAEFIK_DEFAULT_IDLE_CONN_TIMEOUT_MS,
    configureHttpServer,
    resolveHttpServerOptions
} = require('../../../app/services/http-server');

test('Node keep-alive outlives the Traefik idle connection timeout by default and at its cap', () => {
    assert.equal(TRAEFIK_DEFAULT_IDLE_CONN_TIMEOUT_MS, 90_000);
    assert.equal(HTTP_SERVER_DEFAULTS.HTTP_KEEP_ALIVE_TIMEOUT_MS, 95_000);
    assert.equal(HTTP_SERVER_BOUNDS.HTTP_KEEP_ALIVE_TIMEOUT_MS.maximum, 120_000);
    assert.equal(HTTP_SERVER_BOUNDS.HTTP_KEEP_ALIVE_TIMEOUT_MS.minimum, 1_000);
    assert.ok(HTTP_SERVER_DEFAULTS.HTTP_KEEP_ALIVE_TIMEOUT_MS > TRAEFIK_DEFAULT_IDLE_CONN_TIMEOUT_MS);
    assert.ok(HTTP_SERVER_BOUNDS.HTTP_KEEP_ALIVE_TIMEOUT_MS.maximum > HTTP_SERVER_DEFAULTS.HTTP_KEEP_ALIVE_TIMEOUT_MS);

    const resolved = resolveHttpServerOptions({});
    assert.equal(resolved.keepAliveTimeout, 95_000);
    assert.equal(resolveHttpServerOptions({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '120000' }).keepAliveTimeout, 120_000);
    assert.equal(resolveHttpServerOptions({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '120001' }).keepAliveTimeout, 95_000);
    assert.equal(resolveHttpServerOptions({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '5000' }).keepAliveTimeout, 5_000);
});

test('headers timeout rules are unchanged and still capped at the request timeout', () => {
    assert.deepEqual(HTTP_SERVER_BOUNDS.HTTP_HEADERS_TIMEOUT_MS, { minimum: 1_000, maximum: 60_000 });
    assert.deepEqual(HTTP_SERVER_BOUNDS.HTTP_REQUEST_TIMEOUT_MS, { minimum: 60_000, maximum: 600_000 });
    const resolved = resolveHttpServerOptions({
        HTTP_HEADERS_TIMEOUT_MS: '60000',
        HTTP_REQUEST_TIMEOUT_MS: '60000',
        HTTP_KEEP_ALIVE_TIMEOUT_MS: '100000'
    });
    assert.equal(resolved.headersTimeout, 60_000);
    assert.ok(resolved.headersTimeout <= resolved.requestTimeout);
    assert.equal(resolved.keepAliveTimeout, 100_000);

    const server = {};
    configureHttpServer(server, resolved);
    assert.equal(server.keepAliveTimeout, 100_000);
    assert.equal(server.headersTimeout, 60_000);
    assert.equal(server.requestTimeout, 60_000);
});
