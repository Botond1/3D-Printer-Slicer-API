'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const {
    createReadinessService
} = require('../../../app/services/readiness.service');
const previousPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
const {
    createSystemRouter
} = require('../../../app/routes/system.routes');
if (previousPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
else process.env.PYTHON_EXECUTABLE = previousPythonExecutable;
const metrics = require('../../../app/services/observability/metrics');

function validPricing() {
    return { FDM: { PLA: 1 }, SLA: { RESIN: 1 } };
}

function healthyQueue(overrides = {}) {
    return {
        queueLength: 0,
        activeJobs: 0,
        maxConcurrent: 1,
        maxQueueLength: 100,
        acceptingJobs: true,
        ...overrides
    };
}

function createService(overrides = {}) {
    let now = 1000;
    let queue = healthyQueue();
    let native = { available: true, quarantined: false };
    let shuttingDown = false;
    let queueCalls = 0;
    const service = createReadinessService({
        clock: () => now,
        cacheMs: 5000,
        getQueueStatus: () => {
            queueCalls += 1;
            return queue;
        },
        getNativeRuntimeStatus: () => native,
        getPricing: validPricing,
        isShuttingDown: () => shuttingDown,
        ...overrides
    });
    return {
        service,
        advance: (milliseconds) => { now += milliseconds; },
        queueCalls: () => queueCalls,
        setQueue: (value) => { queue = value; },
        setNative: (value) => { native = value; },
        setShuttingDown: (value) => { shuttingDown = value; }
    };
}

test.beforeEach(() => metrics.resetMetricsForTests());

test('readiness is cached, admission-aware, and reports fixed queue reason codes', () => {
    const fixture = createService();
    const ready = fixture.service.getStatus();
    assert.equal(ready.ready, true);
    assert.equal(ready.admissionOpen, true);
    assert.deepEqual(ready.reasonCodes, []);
    assert.equal(fixture.queueCalls(), 1);

    fixture.setQueue(healthyQueue({ acceptingJobs: false }));
    assert.equal(fixture.service.getStatus(), ready);
    assert.equal(fixture.queueCalls(), 1);
    fixture.advance(5000);
    const unavailable = fixture.service.getStatus();
    assert.equal(unavailable.ready, false);
    assert.deepEqual(unavailable.reasonCodes, ['QUEUE_UNAVAILABLE']);
    assert.equal(fixture.queueCalls(), 2);
});

test('fresh readiness observes live state without priming or replacing the normal cache', () => {
    const fixture = createService();
    const cachedZero = fixture.service.getStatus();
    assert.equal(cachedZero.queue.activeJobs, 0);

    fixture.setQueue(healthyQueue({ activeJobs: 1 }));
    const freshActive = fixture.service.getFreshStatus();
    assert.equal(freshActive.queue.activeJobs, 1);
    assert.deepEqual(Object.keys(freshActive), Object.keys(cachedZero));
    assert.deepEqual(Object.keys(freshActive.probes), Object.keys(cachedZero.probes));
    assert.equal(fixture.queueCalls(), 2);

    assert.equal(fixture.service.getStatus(), cachedZero);
    assert.equal(fixture.service.getStatus().queue.activeJobs, 0);
    assert.equal(fixture.queueCalls(), 2);

    const unprimed = createService();
    unprimed.setQueue(healthyQueue({ activeJobs: 1 }));
    assert.equal(unprimed.service.getFreshStatus().queue.activeJobs, 1);
    unprimed.setQueue(healthyQueue());
    const firstCached = unprimed.service.getStatus();
    assert.equal(firstCached.queue.activeJobs, 0);
    assert.equal(unprimed.queueCalls(), 2);
    assert.equal(unprimed.service.getStatus(), firstCached);
    assert.equal(unprimed.queueCalls(), 2);
});

test('shutdown, native quarantine, retention, pricing, and malformed queue fail closed', () => {
    const shutdown = createService();
    shutdown.service.closeAdmission('shutdown');
    assert.equal(shutdown.service.getStatus().ready, false);
    assert.deepEqual(shutdown.service.getStatus().reasonCodes, ['ADMISSION_CLOSED']);
    assert.match(metrics.renderMetrics(), /slicer_shutdown 1/);

    const lifecycleShutdown = createService();
    lifecycleShutdown.setShuttingDown(true);
    const stopping = lifecycleShutdown.service.getStatus();
    assert.equal(stopping.ready, false);
    assert.deepEqual(stopping.reasonCodes, ['SHUTDOWN']);

    const native = createService();
    native.setNative({ available: false, quarantined: true });
    assert.deepEqual(native.service.getStatus().reasonCodes, ['NATIVE_RUNTIME_QUARANTINED']);

    const retention = createService();
    retention.service.recordRetentionResult({ quotaSatisfied: false });
    assert.deepEqual(retention.service.getStatus().reasonCodes, ['RETENTION_UNSAFE']);

    const pricing = createService({ getPricing: () => ({ FDM: {}, SLA: {} }) });
    assert.deepEqual(pricing.service.getStatus().reasonCodes, ['PRICING_UNAVAILABLE']);

    const queue = createService({ getQueueStatus: () => ({ queueLength: '0' }) });
    assert.deepEqual(queue.service.getStatus().reasonCodes, ['QUEUE_UNAVAILABLE']);
});

async function withSystemServer(readinessService, callback) {
    const app = express();
    const authenticateOperations = (req, res, next) => (
        req.header('x-api-key') === 'i5-operations-client'
            ? next()
            : res.status(401).json({
                success: false,
                error: 'Operations authentication is required.',
                errorCode: 'OPERATIONS_AUTH_REQUIRED'
            })
    );
    app.use(createSystemRouter({
        readinessService,
        authenticateOperations,
        authenticateArtifact: authenticateOperations
    }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        return await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('public readiness is minimal while reasons and metrics require operations scope', async () => {
    const fixture = createService();
    fixture.service.closeAdmission('shutdown');
    await withSystemServer(fixture.service, async (baseUrl) => {
        const publicResponse = await fetch(`${baseUrl}/ready`);
        assert.equal(publicResponse.status, 503);
        assert.deepEqual(await publicResponse.json(), { status: 'NOT_READY' });

        for (const path of ['/operations/readiness', '/operations/metrics']) {
            const rejected = await fetch(`${baseUrl}${path}`);
            assert.equal(rejected.status, 401, path);
            assert.equal((await rejected.json()).errorCode, 'OPERATIONS_AUTH_REQUIRED', path);
        }

        const headers = { 'x-api-key': 'i5-operations-client' };
        const detailed = await fetch(`${baseUrl}/operations/readiness`, { headers });
        assert.equal(detailed.status, 503);
        const detailBody = await detailed.json();
        assert.equal(detailBody.ready, false);
        assert.deepEqual(detailBody.reasonCodes, ['ADMISSION_CLOSED']);
        assert.doesNotMatch(JSON.stringify(detailBody), /API_KEY|i5-operations-client|absolutePath/);

        const metricResponse = await fetch(`${baseUrl}/operations/metrics`, { headers });
        assert.equal(metricResponse.status, 200);
        assert.match(metricResponse.headers.get('content-type'), /text\/plain/);
        const text = await metricResponse.text();
        assert.match(text, /slicer_readiness 0/);
        assert.ok(Buffer.byteLength(text, 'utf8') < 16 * 1024);
    });
});

test('warm cached readiness cannot mask a later native-runtime quarantine', async () => {
    const fixture = createService();
    assert.equal(fixture.service.getStatus().ready, true);
    fixture.setNative({ available: false, quarantined: true });

    await withSystemServer(fixture.service, async (baseUrl) => {
        const publicResponse = await fetch(`${baseUrl}/ready`);
        assert.equal(publicResponse.status, 503);
        assert.deepEqual(await publicResponse.json(), { status: 'NOT_READY' });

        const headers = { 'x-api-key': 'i5-operations-client' };
        const operationsResponse = await fetch(`${baseUrl}/operations/readiness`, { headers });
        assert.equal(operationsResponse.status, 503);
        const operationsBody = await operationsResponse.json();
        assert.deepEqual(operationsBody.reasonCodes, ['NATIVE_RUNTIME_QUARANTINED']);

        const metricsResponse = await fetch(`${baseUrl}/operations/metrics`, { headers });
        assert.equal(metricsResponse.status, 200);
        assert.match(await metricsResponse.text(), /slicer_readiness 0/);
    });
});

test('detailed health evaluates fresh readiness only after operations authentication', async () => {
    let cachedCalls = 0;
    let freshCalls = 0;
    const cachedStatus = Object.freeze({
        ready: true,
        queue: Object.freeze(healthyQueue()),
        probes: Object.freeze({ queue: true })
    });
    const freshStatus = Object.freeze({
        ready: true,
        queue: Object.freeze(healthyQueue({ activeJobs: 1 })),
        probes: Object.freeze({ queue: true })
    });
    const readinessService = {
        getStatus() {
            cachedCalls += 1;
            return cachedStatus;
        },
        getFreshStatus() {
            freshCalls += 1;
            return freshStatus;
        }
    };

    const pythonExecutable = process.env.PYTHON_EXECUTABLE;
    process.env.PYTHON_EXECUTABLE = process.execPath;
    try {
        await withSystemServer(readinessService, async (baseUrl) => {
            const rejected = await fetch(`${baseUrl}/health/detailed`);
            assert.equal(rejected.status, 401);
            assert.equal(freshCalls, 0);
            assert.equal(cachedCalls, 0);

            const headers = { 'x-api-key': 'i5-operations-client' };
            const detailed = await fetch(`${baseUrl}/health/detailed`, { headers });
            assert.equal(detailed.status, 200);
            assert.equal((await detailed.json()).subsystems.queue.activeJobs, 1);
            assert.equal(freshCalls, 1);
            assert.equal(cachedCalls, 0);

            assert.equal((await fetch(`${baseUrl}/ready`)).status, 200);
            assert.equal((await fetch(`${baseUrl}/operations/readiness`, { headers })).status, 200);
            assert.equal((await fetch(`${baseUrl}/operations/metrics`, { headers })).status, 200);
            assert.equal(cachedCalls, 0);
            assert.equal(freshCalls, 4);
        });
    } finally {
        if (pythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
        else process.env.PYTHON_EXECUTABLE = pythonExecutable;
    }
});
