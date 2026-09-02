'use strict';

/** Bounded Node HTTP server construction and configuration. */

const http = require('node:http');
const { DEFAULTS } = require('../config/constants');

/**
 * Traefik's default `idleConnTimeout` toward backends is 90 s. Node must keep
 * an idle keep-alive socket open longer than the proxy does, otherwise Node
 * closes first and the proxy's next reuse of that socket surfaces as an
 * intermittent 502 at the edge. The default therefore sits above 90 s and
 * the cap allows a further margin for a longer proxy setting.
 */
const TRAEFIK_DEFAULT_IDLE_CONN_TIMEOUT_MS = 90_000;
const KEEP_ALIVE_TIMEOUT_DEFAULT_MS = 95_000;
const KEEP_ALIVE_TIMEOUT_MAXIMUM_MS = 120_000;

const HTTP_SERVER_DEFAULTS = Object.freeze({
    HTTP_HEADERS_TIMEOUT_MS: DEFAULTS.HTTP_HEADERS_TIMEOUT_MS,
    HTTP_REQUEST_TIMEOUT_MS: DEFAULTS.HTTP_REQUEST_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS: KEEP_ALIVE_TIMEOUT_DEFAULT_MS,
    HTTP_MAX_HEADERS_COUNT: DEFAULTS.HTTP_MAX_HEADERS_COUNT,
    HTTP_MAX_CONNECTIONS: DEFAULTS.HTTP_MAX_CONNECTIONS,
    HTTP_MAX_REQUESTS_PER_SOCKET: DEFAULTS.HTTP_MAX_REQUESTS_PER_SOCKET
});

const HTTP_SERVER_BOUNDS = Object.freeze({
    HTTP_HEADERS_TIMEOUT_MS: Object.freeze({ minimum: 1_000, maximum: 60_000 }),
    HTTP_REQUEST_TIMEOUT_MS: Object.freeze({ minimum: 60_000, maximum: 600_000 }),
    HTTP_KEEP_ALIVE_TIMEOUT_MS: Object.freeze({ minimum: 1_000, maximum: KEEP_ALIVE_TIMEOUT_MAXIMUM_MS }),
    HTTP_MAX_HEADERS_COUNT: Object.freeze({ minimum: 16, maximum: 2_000 }),
    HTTP_MAX_CONNECTIONS: Object.freeze({ minimum: 1, maximum: 1_024 }),
    HTTP_MAX_REQUESTS_PER_SOCKET: Object.freeze({ minimum: 1, maximum: 1_000 })
});

/**
 * Parse a strict positive decimal safe integer within a finite bound.
 * Invalid values consistently fall back to the supplied safe default.
 * @param {unknown} value Candidate configuration value.
 * @param {number} fallback Safe default.
 * @param {{minimum: number, maximum: number}} bounds Inclusive bounds.
 * @returns {number} Validated value or fallback.
 */
function resolveBoundedPositiveInteger(value, fallback, bounds) {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) return fallback;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed)
        && parsed >= bounds.minimum
        && parsed <= bounds.maximum
        ? parsed
        : fallback;
}

/**
 * Resolve the HTTP resource envelope from environment configuration.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} env Environment source.
 * @returns {Readonly<object>} Validated server settings.
 */
function resolveHttpServerOptions(env = process.env) {
    const requestTimeout = resolveBoundedPositiveInteger(
        env.HTTP_REQUEST_TIMEOUT_MS,
        DEFAULTS.HTTP_REQUEST_TIMEOUT_MS,
        HTTP_SERVER_BOUNDS.HTTP_REQUEST_TIMEOUT_MS
    );
    const requestedHeadersTimeout = resolveBoundedPositiveInteger(
        env.HTTP_HEADERS_TIMEOUT_MS,
        DEFAULTS.HTTP_HEADERS_TIMEOUT_MS,
        HTTP_SERVER_BOUNDS.HTTP_HEADERS_TIMEOUT_MS
    );

    return Object.freeze({
        headersTimeout: Math.min(requestedHeadersTimeout, requestTimeout),
        requestTimeout,
        keepAliveTimeout: resolveBoundedPositiveInteger(
            env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
            HTTP_SERVER_DEFAULTS.HTTP_KEEP_ALIVE_TIMEOUT_MS,
            HTTP_SERVER_BOUNDS.HTTP_KEEP_ALIVE_TIMEOUT_MS
        ),
        maxHeadersCount: resolveBoundedPositiveInteger(
            env.HTTP_MAX_HEADERS_COUNT,
            DEFAULTS.HTTP_MAX_HEADERS_COUNT,
            HTTP_SERVER_BOUNDS.HTTP_MAX_HEADERS_COUNT
        ),
        maxConnections: resolveBoundedPositiveInteger(
            env.HTTP_MAX_CONNECTIONS,
            DEFAULTS.HTTP_MAX_CONNECTIONS,
            HTTP_SERVER_BOUNDS.HTTP_MAX_CONNECTIONS
        ),
        maxRequestsPerSocket: resolveBoundedPositiveInteger(
            env.HTTP_MAX_REQUESTS_PER_SOCKET,
            DEFAULTS.HTTP_MAX_REQUESTS_PER_SOCKET,
            HTTP_SERVER_BOUNDS.HTTP_MAX_REQUESTS_PER_SOCKET
        )
    });
}

/**
 * Apply validated HTTP limits before listening.
 * @param {import('node:http').Server} server HTTP server instance.
 * @param {ReturnType<typeof resolveHttpServerOptions>} options Validated settings.
 * @returns {import('node:http').Server} The same configured server.
 */
function configureHttpServer(server, options) {
    server.requestTimeout = options.requestTimeout;
    server.headersTimeout = Math.min(options.headersTimeout, options.requestTimeout);
    server.keepAliveTimeout = options.keepAliveTimeout;
    server.maxHeadersCount = options.maxHeadersCount;
    server.maxConnections = options.maxConnections;
    server.maxRequestsPerSocket = options.maxRequestsPerSocket;
    return server;
}

/**
 * Create and configure exactly one HTTP server for an Express application.
 * @param {import('express').Express} app Express application.
 * @param {object} options Injectable construction options.
 * @param {NodeJS.ProcessEnv | Record<string, unknown>} [options.env] Environment source.
 * @param {(handler: Function) => import('node:http').Server} [options.createServer] Server factory.
 * @returns {import('node:http').Server} Configured HTTP server.
 */
function createBoundedHttpServer(app, options = {}) {
    const createServer = options.createServer || http.createServer;
    const server = createServer(app);
    return configureHttpServer(server, resolveHttpServerOptions(options.env || process.env));
}

module.exports = {
    HTTP_SERVER_BOUNDS,
    HTTP_SERVER_DEFAULTS,
    TRAEFIK_DEFAULT_IDLE_CONN_TIMEOUT_MS,
    configureHttpServer,
    createBoundedHttpServer,
    resolveBoundedPositiveInteger,
    resolveHttpServerOptions
};
