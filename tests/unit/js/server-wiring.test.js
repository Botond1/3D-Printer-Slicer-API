'use strict';

/**
 * 3.9.0 §9 WP0: the integrator's wiring in app/server.js.
 *
 * app/server.js starts the service on require, so its wiring is read
 * statically (the same approach as startup-workspace-audit, render-preview-
 * contracts and public-routes-inventory). The behaviour the wiring produces
 * is proven by composing the same modules the way server.js does: readiness
 * advisory reasons reach /operations/readiness and never /ready, the export
 * router is today's 404 while off, and the pricing GET needs no app parser.
 */

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
process.on('exit', () => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'app', 'server.js'), 'utf8');
const { createReadinessService } = require('../../../app/services/readiness.service');
const { createSystemRouter } = require('../../../app/routes/system.routes');
const { createExportRouter } = require('../../../app/routes/export.routes');
const { createPricingRouter } = require('../../../app/routes/pricing.routes');

function indexOf(fragment) {
    const index = SOURCE.indexOf(fragment);
    assert.notEqual(index, -1, `server.js lacks: ${fragment}`);
    return index;
}

/** The body of `async function startServer() { … }` (up to the next top-level `}`). */
function startServerBody() {
    const start = indexOf('async function startServer() {');
    const end = SOURCE.indexOf('\n}', start);
    return SOURCE.slice(start, end);
}

test('the native identity monitor starts after the generation and before Bambu readiness (§4.1)', () => {
    const body = startServerBody();
    const generation = body.indexOf('initializeBambuGeneration(engineVersions.bambu);');
    const monitor = body.indexOf('identityMonitor = await startNativeIdentityMonitor();');
    const readiness = body.indexOf('await bambuReadiness.initialize(engineVersions);');
    assert.ok(generation >= 0 && monitor > generation && readiness > monitor);
});

test('retention: the adapter is the observer, no cleanup call passes a phase, the sweeper starts after listen (§4.2)', () => {
    assert.match(SOURCE, /configureRetentionObserver\(retentionRuntime\.adapter\);/);
    assert.doesNotMatch(SOURCE, /configureRetentionObserver\(readinessService\)/);
    assert.doesNotMatch(SOURCE, /\bphase\s*:/, 'only the sweeper passes phase: "sweep"');
    const cleanupCalls = [...SOURCE.matchAll(/cleanupManagedArtifacts\(\{([\s\S]*?)\}\)/g)];
    assert.equal(cleanupCalls.length, 1);
    assert.match(cleanupCalls[0][1], /^\s*resourcePolicy\s*$/);
    const listen = indexOf('httpServer.listen(PORT');
    assert.ok(indexOf('retentionRuntime.sweeper.start();') > listen);
    assert.match(SOURCE, /createRetentionRuntime\(\{\s*readinessService,\s*sweeper: \{ cleanupOptions: \{ resourcePolicy \} \}/);
});

test('startup purges marked job workspaces and every export result before listen (§4.3)', () => {
    const body = startServerBody();
    const purge = body.match(/auditStaleWorkspaces\(\{\s*jobsRoot: JOB_WORKSPACES_DIR,([\s\S]*?)\}\);/);
    assert.ok(purge, 'JOB_WORKSPACES_DIR purge');
    assert.match(purge[1], /delete: true,/);
    assert.match(purge[1], /deleteMarkedRegardlessAge: true,/);
    assert.match(purge[1], /verifyExclusiveLease: async \(\) => true,/);
    const purgeIndex = body.indexOf(purge[0]);
    const exportPurge = body.indexOf('await purgeExportResults();');
    const listenSequence = body.indexOf('return auditWorkspacesThenListen({');
    assert.ok(purgeIndex >= 0 && exportPurge > purgeIndex && listenSequence > exportPurge);
});

test('auth: every slice-key authenticator reports to the aggregator; no hand-made auth logger (§4.5)', () => {
    const sliceAuthenticators = [...SOURCE.matchAll(/createRequireSliceService\(\{([^}]*)\}\)/g)];
    assert.equal(sliceAuthenticators.length, 5, 'slice, jobs, render, export, capabilities');
    for (const [, args] of sliceAuthenticators) {
        assert.match(args, /keyRing: serviceKeyRing/);
        assert.match(args, /logger: authLogger/);
        assert.match(args, /onAccepted: authAggregator\.onAccepted/);
    }
    assert.match(SOURCE, /const authAggregator = createAuthLogAggregator\(\);\s*const authLogger = authAggregator\.logger;/);
    assert.doesNotMatch(SOURCE, /emitEvent\('auth\.rejected'/);
    assert.ok(indexOf('authAggregator.start();') < indexOf('return auditWorkspacesThenListen({'));
});

test('the app-level JSON and form parsers are gone (§4.5, H8)', () => {
    assert.doesNotMatch(SOURCE, /express\.json\(/);
    assert.doesNotMatch(SOURCE, /express\.urlencoded\(/);
});

test('export and capabilities routers are mounted before the 404 catch-all (§4.7, §4.8)', () => {
    const catchAll = indexOf("app.all('*'");
    for (const fragment of ['app.use(exportRoutes);', 'app.use(capabilitiesRoutes);']) {
        assert.ok(indexOf(fragment) < catchAll, fragment);
    }
    assert.match(SOURCE, /const exportRoutes = createExportRouter\(\{\s*enabled: releasePolicy\.export\.EXPORT_ROUTE_ENABLED === true,/);
    assert.match(SOURCE, /isEngineAvailable: bambuReadiness\.isEngineAvailable,\s*resourcePolicy\s*\}\);\s*const capabilitiesRoutes/);
});

test('readiness gets the advisory seams; shutdown stops the 3.9.0 background work', () => {
    for (const fragment of [
        'getNativeIdentityStatus,',
        'getKeyRingReasons: () => resolveKeyRingReadinessReasons(serviceKeyRing, Date.now()),',
        'getChildOomWrapperStatus'
    ]) indexOf(fragment);
    assert.ok(indexOf('await verifyChildOomWrapper();') < indexOf('return auditWorkspacesThenListen({'));
    const shutdown = SOURCE.slice(indexOf('onShutdownStart() {'), indexOf('function stopBackgroundWork()'));
    assert.match(shutdown, /stopBackgroundWork\(\);/);
    const stops = SOURCE.slice(indexOf('function stopBackgroundWork()'), indexOf('const EVENT_LOOP_WINDOW_MS'));
    for (const fragment of ['retentionRuntime.sweeper.stop()', 'identityMonitor?.stop?.()', 'eventLoopMonitor?.stop()',
        'authAggregator.stop()', 'closeDefaultArchivePreflight()']) {
        assert.ok(stops.includes(fragment), fragment);
    }
    assert.ok(indexOf('eventLoopMonitor = startEventLoopMonitor();') < indexOf('return auditWorkspacesThenListen({'));
});

test('an invalid release policy refuses startup with one line, like the other policies', () => {
    assert.match(SOURCE, /releasePolicy = require\('\.\/config\/release-policy'\);\s*\} catch \{\s*console\.error\('\[SECURITY\] Release policy configuration is invalid\. Refusing to start server\.'\);\s*process\.exit\(1\);/);
    assert.ok(indexOf("releasePolicy = require('./config/release-policy');") < indexOf("require('./routes/slice.routes')"));
});

async function listen(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

function readinessApp(seams) {
    const readinessService = createReadinessService({
        getSlicerRuntimeStatus: () => ({ bambuReady: seams.bambuReady, commonDependenciesReady: true }),
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        probes: { queue: () => true, storage: () => true, retention: () => true, pricing: () => true, config: () => true },
        cacheMs: 0,
        getNativeIdentityStatus: seams.identity,
        getKeyRingReasons: seams.keyRing,
        getChildOomWrapperStatus: seams.oom
    });
    const app = express();
    app.use(createSystemRouter({ readinessService, authenticateOperations: (req, res, next) => next() }));
    return app;
}

test('stale identity, a failed background verify and an expired legacy slot never touch /ready (§2.6, T-ID)', async (t) => {
    const url = await listen(t, readinessApp({
        bambuReady: true,
        identity: () => ({ monitor: 'active', stale: true, reasons: ['NATIVE_IDENTITY_STALE', 'NATIVE_IDENTITY_VERIFY_FAILED'] }),
        keyRing: () => ['LEGACY_SLICE_SLOT_EXPIRED'],
        oom: () => ({ state: 'disabled', active: false, oom_score_adj: 500, reason: 'choom_missing' })
    }));
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'READY' });
    const operations = await fetch(`${url}/operations/readiness`);
    assert.equal(operations.status, 200);
    const status = await operations.json();
    assert.equal(status.ready, true);
    assert.deepEqual(status.reasonCodes, []);
    assert.deepEqual(status.advisoryReasonCodes, [
        'NATIVE_IDENTITY_STALE', 'NATIVE_IDENTITY_VERIFY_FAILED', 'LEGACY_SLICE_SLOT_EXPIRED'
    ]);
    assert.equal(status.nativeIdentity.monitor, 'active');
    assert.equal(status.childOomWrapper.reason, 'choom_missing');
});

test('a confirmed native change reads NATIVE_IDENTITY_CHANGED beside the Bambu reason; /ready says only NOT_READY', async (t) => {
    const url = await listen(t, readinessApp({
        bambuReady: false,
        identity: () => ({ monitor: 'active', changed: true, reasons: ['NATIVE_IDENTITY_CHANGED'] })
    }));
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: 'NOT_READY' });
    const status = await (await fetch(`${url}/operations/readiness`)).json();
    assert.deepEqual(status.reasonCodes, ['BAMBU_RUNTIME_UNAVAILABLE', 'NATIVE_IDENTITY_CHANGED']);
});

test('a throwing or absent advisory seam never owns readiness', async (t) => {
    const url = await listen(t, readinessApp({
        bambuReady: true,
        identity: () => { throw new Error('boom'); },
        keyRing: () => 'not-a-list'
    }));
    const status = await (await fetch(`${url}/operations/readiness`)).json();
    assert.equal(status.ready, true);
    assert.equal(status.advisoryReasonCodes, undefined);
    assert.equal(status.nativeIdentity, undefined);
    // Without the seams the 3.8.3 body keys are unchanged.
    const plain = createReadinessService({
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        probes: { queue: () => true, storage: () => true, retention: () => true, pricing: () => true, config: () => true }
    }).getStatus();
    assert.deepEqual(Object.keys(plain), ['checkedAt', 'ready', 'admissionOpen', 'probes', 'reasonCodes', 'queue', 'legacyMigration']);
});

test('export off: every export path falls through to today\'s 404; GET /pricing needs no app-level parser', async (t) => {
    const app = express();
    app.use(createExportRouter({ enabled: false }));
    app.use(createPricingRouter({ authenticate: (req, res) => res.status(401).end() }));
    app.all('*', (req, res) => res.status(404).json({ success: false, error: 'Route not found.', errorCode: 'ROUTE_NOT_FOUND' }));
    const url = await listen(t, app);
    for (const [method, route] of [
        ['POST', '/bambu/export'],
        ['GET', `/bambu/export/jobs/ex_${'a'.repeat(32)}`],
        ['DELETE', `/bambu/export/jobs/ex_${'a'.repeat(32)}`],
        ['GET', `/bambu/export/jobs/ex_${'a'.repeat(32)}/file`]
    ]) {
        const response = await fetch(`${url}${route}`, { method });
        assert.equal(response.status, 404, `${method} ${route}`);
        assert.deepEqual(await response.json(), { success: false, error: 'Route not found.', errorCode: 'ROUTE_NOT_FOUND' });
    }
    const pricing = await fetch(`${url}/pricing`);
    assert.equal(pricing.status, 200);
    const body = await pricing.json();
    assert.ok(body && typeof body === 'object');
});
