'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { DEFAULTS } = require('../../../app/config/constants');
const {
    HTTP_SERVER_BOUNDS,
    configureHttpServer,
    createBoundedHttpServer,
    resolveHttpServerOptions
} = require('../../../app/services/http-server');
const { createSliceRouter } = require('../../../app/routes/slice.routes');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const errorHandler = require('../../../app/middleware/errorHandler');

const ENVELOPE_FIELDS = Object.freeze([
    {
        envKey: 'HTTP_HEADERS_TIMEOUT_MS',
        optionKey: 'headersTimeout',
        defaultValue: DEFAULTS.HTTP_HEADERS_TIMEOUT_MS
    },
    {
        envKey: 'HTTP_REQUEST_TIMEOUT_MS',
        optionKey: 'requestTimeout',
        defaultValue: DEFAULTS.HTTP_REQUEST_TIMEOUT_MS
    },
    {
        envKey: 'HTTP_KEEP_ALIVE_TIMEOUT_MS',
        optionKey: 'keepAliveTimeout',
        defaultValue: DEFAULTS.HTTP_KEEP_ALIVE_TIMEOUT_MS
    },
    {
        envKey: 'HTTP_MAX_HEADERS_COUNT',
        optionKey: 'maxHeadersCount',
        defaultValue: DEFAULTS.HTTP_MAX_HEADERS_COUNT
    },
    {
        envKey: 'HTTP_MAX_CONNECTIONS',
        optionKey: 'maxConnections',
        defaultValue: DEFAULTS.HTTP_MAX_CONNECTIONS
    },
    {
        envKey: 'HTTP_MAX_REQUESTS_PER_SOCKET',
        optionKey: 'maxRequestsPerSocket',
        defaultValue: DEFAULTS.HTTP_MAX_REQUESTS_PER_SOCKET
    }
]);

const AUTH_HEADER = 'x-slicer-api-key: i3-inert-http-envelope-key\r\n';

function withDeadline(promise, timeoutMs, label) {
    let handle;
    const deadline = new Promise((resolve, reject) => {
        handle = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
        handle.unref?.();
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(handle));
}

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await withDeadline(once(server, 'listening'), 2_000, 'HTTP listen');
    return server.address().port;
}

async function closeServer(server) {
    if (!server.listening) return;
    server.closeAllConnections?.();
    await withDeadline(new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }), 2_000, 'HTTP close');
}

function rawExchange(port, chunks) {
    return withDeadline(new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        const responseChunks = [];
        let settled = false;

        function settle(errorCode = null) {
            if (settled) return;
            settled = true;
            resolve({
                errorCode,
                response: Buffer.concat(responseChunks).toString('latin1')
            });
        }

        socket.on('data', (chunk) => responseChunks.push(chunk));
        socket.once('connect', () => {
            for (const chunk of chunks) socket.write(chunk);
        });
        socket.once('error', (error) => {
            if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(error.code)) {
                settle(error.code);
                return;
            }
            reject(error);
        });
        socket.once('close', () => settle());
    }), 3_000, 'raw HTTP exchange');
}

function responseStatus(rawResponse) {
    const match = /^HTTP\/1\.[01]\s+(\d{3})\b/.exec(rawResponse);
    return match ? Number(match[1]) : null;
}

async function directoryEntries(directory) {
    try {
        return await fs.readdir(directory);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function waitForCondition(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`${label} exceeded ${timeoutMs}ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function createLiveSliceHarness(t, serverOptions) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'i3-http-envelope-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot);
    const allocations = [];
    const settlements = [];
    let settleNext;
    const nextSettlement = new Promise((resolve) => { settleNext = resolve; });
    const app = express();

    app.use(createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate(req, res, next) { next(); },
        createWorkspace: async () => {
            const workspace = await createJobWorkspace({ jobsRoot, outputRoot });
            allocations.push(workspace.id);
            return workspace;
        },
        handlePrusa: async (req, res) => res.status(200).json({ success: true }),
        onLifecycleSettled(info) {
            settlements.push(info);
            settleNext(info);
        },
        resourcePolicy: {
            ...resolveResourcePolicy({}),
            UPLOAD_TOTAL_TIMEOUT_MS: serverOptions.requestTimeout
        }
    }));
    app.use(errorHandler);

    const server = http.createServer({
        connectionsCheckingInterval: 25
    }, app);
    configureHttpServer(server, serverOptions);
    const port = await listen(server);

    t.after(async () => {
        await closeServer(server);
        const resolvedRoot = path.resolve(root);
        assert.ok(resolvedRoot.startsWith(path.resolve(os.tmpdir())));
        await fs.rm(resolvedRoot, { recursive: true, force: true });
    });

    return {
        allocations,
        jobsRoot,
        nextSettlement,
        outputRoot,
        port,
        server,
        settlements
    };
}

async function assertNoResidue(harness) {
    assert.deepEqual(await directoryEntries(harness.jobsRoot), []);
    assert.deepEqual(await directoryEntries(harness.outputRoot), []);
}

test('HTTP envelope resolves all six documented defaults', () => {
    const resolved = resolveHttpServerOptions({});
    assert.equal(Object.isFrozen(resolved), true);
    for (const field of ENVELOPE_FIELDS) {
        assert.equal(resolved[field.optionKey], field.defaultValue, field.envKey);
    }
    assert.equal(
        resolved.requestTimeout,
        DEFAULTS.SLICE_COMMAND_TIMEOUT_MS,
        'The request receive default remains compatible with the command timeout.'
    );
});

test('HTTP envelope accepts each inclusive minimum and maximum bound', () => {
    for (const field of ENVELOPE_FIELDS) {
        const bounds = HTTP_SERVER_BOUNDS[field.envKey];
        for (const boundary of [bounds.minimum, bounds.maximum]) {
            const resolved = resolveHttpServerOptions({ [field.envKey]: String(boundary) });
            assert.equal(resolved[field.optionKey], boundary, `${field.envKey}=${boundary}`);
        }
    }
});

test('HTTP envelope falls back for every invalid integer class on all six settings', () => {
    for (const field of ENVELOPE_FIELDS) {
        const bounds = HTTP_SERVER_BOUNDS[field.envKey];
        const invalidValues = [
            ['zero', '0'],
            ['negative', '-1'],
            ['fractional', '1.5'],
            ['non-decimal', '1e3'],
            ['overflow', '9007199254740992'],
            ['below range', String(bounds.minimum - 1)],
            ['above range', String(bounds.maximum + 1)]
        ];
        for (const [invalidClass, value] of invalidValues) {
            const resolved = resolveHttpServerOptions({ [field.envKey]: value });
            assert.equal(
                resolved[field.optionKey],
                field.defaultValue,
                `${field.envKey} must reject ${invalidClass}: ${value}`
            );
        }
    }
});

test('injectable HTTP server receives all six properties before listen', () => {
    const expected = {
        headersTimeout: 12_345,
        requestTimeout: 234_567,
        keepAliveTimeout: 6_789,
        maxHeadersCount: 77,
        maxConnections: 7,
        maxRequestsPerSocket: 9
    };
    const env = {
        HTTP_HEADERS_TIMEOUT_MS: String(expected.headersTimeout),
        HTTP_REQUEST_TIMEOUT_MS: String(expected.requestTimeout),
        HTTP_KEEP_ALIVE_TIMEOUT_MS: String(expected.keepAliveTimeout),
        HTTP_MAX_HEADERS_COUNT: String(expected.maxHeadersCount),
        HTTP_MAX_CONNECTIONS: String(expected.maxConnections),
        HTTP_MAX_REQUESTS_PER_SOCKET: String(expected.maxRequestsPerSocket)
    };
    const app = () => {};
    let receivedHandler;
    let listenSnapshot;
    const injectedServer = {
        listen() {
            listenSnapshot = Object.fromEntries(
                ENVELOPE_FIELDS.map(({ optionKey }) => [optionKey, this[optionKey]])
            );
        }
    };

    const configured = createBoundedHttpServer(app, {
        env,
        createServer(handler) {
            receivedHandler = handler;
            return injectedServer;
        }
    });

    assert.equal(configured, injectedServer);
    assert.equal(receivedHandler, app);
    assert.equal(listenSnapshot, undefined);
    configured.listen();
    assert.deepEqual(listenSnapshot, expected);
});

test('live max-connection rejection cannot become 2xx or allocate request-owned residue', async (t) => {
    const harness = await createLiveSliceHarness(t, {
        headersTimeout: 1_000,
        requestTimeout: 1_000,
        keepAliveTimeout: 100,
        maxHeadersCount: 64,
        maxConnections: 1,
        maxRequestsPerSocket: 2
    });
    const blocker = net.createConnection({ host: '127.0.0.1', port: harness.port });
    t.after(() => blocker.destroy());
    await withDeadline(once(blocker, 'connect'), 2_000, 'blocking connection');
    await withDeadline(new Promise((resolve, reject) => {
        harness.server.getConnections((error, count) => {
            if (error) reject(error);
            else if (count === 1) resolve();
            else reject(new Error(`Expected one live connection, observed ${count}.`));
        });
    }), 2_000, 'connection count');

    const dropObserved = withDeadline(once(harness.server, 'drop'), 2_000, 'max-connection drop');
    const exchange = rawExchange(harness.port, [
        'POST /prusa/slice HTTP/1.1\r\n',
        'Host: 127.0.0.1\r\n',
        AUTH_HEADER,
        'Content-Length: 0\r\n',
        'Connection: close\r\n\r\n'
    ]);
    await dropObserved;
    const result = await exchange;
    const status = responseStatus(result.response);

    assert.ok(status === null || status < 200 || status >= 300, `Unexpected success status: ${status}`);
    assert.equal(harness.allocations.length, 0);
    assert.equal(harness.settlements.length, 0);
    await assertNoResidue(harness);
});

test('live partial-request timeout cannot become 2xx and cleans request-owned residue', async (t) => {
    const requestTimeout = 150;
    const harness = await createLiveSliceHarness(t, {
        headersTimeout: requestTimeout,
        requestTimeout,
        keepAliveTimeout: 100,
        maxHeadersCount: 64,
        maxConnections: 4,
        maxRequestsPerSocket: 2
    });
    const boundary = 'i3-partial-timeout';
    const partialBody = Buffer.from(
        `--${boundary}\r\n`
        + 'Content-Disposition: form-data; name="choosenFile"; filename="synthetic.stl"\r\n'
        + 'Content-Type: application/octet-stream\r\n\r\n'
        + 'solid synthetic\n'
    );
    const exchange = rawExchange(harness.port, [
        'POST /prusa/slice HTTP/1.1\r\n',
        'Host: 127.0.0.1\r\n',
        AUTH_HEADER,
        `Content-Type: multipart/form-data; boundary=${boundary}\r\n`,
        `Content-Length: ${partialBody.length + 1_024}\r\n`,
        'Connection: close\r\n\r\n',
        partialBody
    ]);

    await waitForCondition(
        () => harness.allocations.length === 1,
        1_000,
        'request workspace allocation'
    );
    const result = await exchange;
    // HTTP receive and application upload deadlines both remain 150 ms, matching
    // their shared production default; this bound only observes settled cleanup.
    await withDeadline(harness.nextSettlement, 5_000, 'partial request cleanup');
    const status = responseStatus(result.response);

    assert.ok(status === null || status < 200 || status >= 300, `Unexpected success status: ${status}`);
    assert.equal(harness.allocations.length, 1);
    assert.equal(harness.settlements.length, 1);
    await assertNoResidue(harness);
});
