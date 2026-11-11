'use strict';

/** T-RET-1..3 (3.9.0): the retention latch is gone; the sweep verdict drives readiness. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadinessService } = require('../../../app/services/readiness.service');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { retention } = require('../../../app/config/release-policy');
const metrics = require('../../../app/services/observability/metrics');
const { setEventWriter } = require('../../../app/services/observability/events');
const { createArtifactSweeper } = require('../../../app/services/artifact-sweeper');
const {
    SCAN_INCOMPLETE_ERROR_CODE,
    createRetentionAdapter,
    createRetentionRuntime
} = require('../../../app/services/retention-adapter');
const { createManagedArtifact, createOutputRoot, exists } = require('./helpers/managed-artifact-fixture');

const events = [];
test.beforeEach(() => {
    events.length = 0;
    setEventWriter((entry) => events.push(entry));
});
test.after(() => setEventWriter((entry) => console.info(JSON.stringify(entry))));

function readiness() {
    return createReadinessService({
        clock: () => 0,
        cacheMs: 5_000,
        getQueueStatus: () => ({
            queueLength: 0, activeJobs: 0, maxConcurrent: 1, maxQueueLength: 100, maxQueuePerClient: 5, acceptingJobs: true
        }),
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        getPricing: () => ({ FDM: { PLA: 800 }, SLA: { Standard: 1800 } }),
        probes: { storage: () => true, config: () => true }
    });
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('T-RET-1: a post-slice miss no longer latches; the next sweep satisfied makes /ready 200 again', async () => {
    const service = readiness();
    const verdicts = ['satisfied'];
    const { adapter, sweeper } = createRetentionRuntime({
        readinessService: service,
        sweeper: { cleanup: async () => ({ quotaSatisfied: true, verdict: verdicts.shift() }), intervalMs: 60_000 }
    });
    // 3.8.3 semantics of a bare false would have been an immediate RETENTION_UNSAFE latch.
    service.recordRetentionResult(false);
    assert.equal(service.getStatus().ready, false);
    adapter.recordRetentionResult(false);
    await flush();
    await flush();
    assert.equal(service.getStatus().ready, true, 'within one sweep');
    assert.deepEqual(service.getStatus().reasonCodes, []);
    sweeper.stop();
});

test('T-RET-2: an incomplete sweep keeps the previous value and emits ARTIFACT_SCAN_INCOMPLETE', () => {
    for (const previous of [true, false]) {
        const service = readiness();
        service.recordRetentionResult(previous);
        events.length = 0;
        const adapter = createRetentionAdapter({ readinessService: service, requestSweep: async () => null });
        adapter.recordRetentionResult({ quotaSatisfied: false, verdict: 'incomplete' });
        assert.equal(service.isRetentionHealthy(), previous);
        assert.equal(events.length, 1);
        assert.equal(events[0].event, 'artifact.cleanup');
        assert.equal(events[0].error_code, SCAN_INCOMPLETE_ERROR_CODE);
        assert.deepEqual(events[0].extra, { reason: 'sweep', verdict: 'incomplete' });
    }
});

test('T-RET-3: an exceeded sweep turns /ready 503 (RETENTION_UNSAFE); satisfied clears it', () => {
    const service = readiness();
    const adapter = createRetentionAdapter({ readinessService: service, requestSweep: async () => null });
    adapter.handleSweepResult({ quotaSatisfied: false, verdict: 'exceeded' });
    assert.equal(service.getStatus().ready, false);
    assert.deepEqual(service.getStatus().reasonCodes, ['RETENTION_UNSAFE']);
    adapter.handleSweepResult({ quotaSatisfied: true, verdict: 'satisfied' });
    assert.equal(service.getStatus().ready, true);
    // Values that are not a bare false nor a verdict keep the 3.8.3 meaning.
    adapter.recordRetentionResult({ quotaSatisfied: false });
    assert.equal(service.getStatus().ready, false);
    adapter.recordRetentionResult(true);
    assert.equal(service.getStatus().ready, true);
});

test('the incomplete sweep increments slicer_artifact_sweep_incomplete_total; others do not', async () => {
    metrics.resetMetricsForTests();
    const verdicts = ['satisfied', 'exceeded', 'incomplete'];
    const sweeper = createArtifactSweeper({
        cleanup: async () => ({ verdict: verdicts.shift() }),
        intervalMs: 60_000
    });
    const counter = () => Number(/^slicer_artifact_sweep_incomplete_total (\d+)$/m.exec(metrics.renderMetrics())[1]);
    assert.equal(counter(), 0);
    await sweeper.runNow();
    await sweeper.runNow();
    assert.equal(counter(), 0);
    await sweeper.runNow();
    assert.equal(counter(), 1);
    assert.match(metrics.renderMetrics(), /^slicer_artifact_sweep_seconds \d/m);
    metrics.resetMetricsForTests();
});

test('the sweeper never overlaps itself, coalesces immediate requests and passes phase sweep', async () => {
    const gates = [];
    const calls = [];
    const sweeper = createArtifactSweeper({
        cleanup: (options) => {
            calls.push(options);
            const gate = deferred();
            gates.push(gate);
            return gate.promise;
        },
        intervalMs: 60_000,
        recordSweep: () => {}
    });
    const first = sweeper.runNow();
    const second = sweeper.runNow();
    const third = sweeper.runNow();
    assert.equal(second, third, 'requests while a sweep runs share one follow-up');
    assert.equal(calls.length, 1);
    assert.equal(sweeper.isRunning(), true);
    gates[0].resolve({ verdict: 'satisfied' });
    assert.deepEqual(await first, { verdict: 'satisfied' });
    await flush();
    assert.equal(calls.length, 2, 'exactly one follow-up');
    gates[1].resolve({ verdict: 'exceeded' });
    assert.deepEqual(await second, { verdict: 'exceeded' });
    assert.deepEqual(calls.map((options) => options.phase), ['sweep', 'sweep']);
    sweeper.stop();
    assert.equal(await sweeper.runNow(), null, 'stopped');
});

test('a throwing cleanup is an exceeded sweep, never an unhandled rejection', async () => {
    const results = [];
    const sweeper = createArtifactSweeper({
        cleanup: async () => { throw new Error('EIO'); },
        intervalMs: 60_000,
        recordSweep: () => {},
        onResult: (summary) => results.push(summary.verdict)
    });
    const summary = await sweeper.runNow();
    assert.equal(summary.verdict, 'exceeded');
    assert.deepEqual(results, ['exceeded']);
});

test('the interval is unref\'d, ARTIFACT_SWEEP_INTERVAL_MS by default, skipped while a sweep runs, and stopped on shutdown', async () => {
    const timers = [];
    let cleared = null;
    const gate = deferred();
    let calls = 0;
    const sweeper = createArtifactSweeper({
        cleanup: () => { calls += 1; return gate.promise; },
        recordSweep: () => {},
        setInterval(callback, delay) {
            const timer = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true; return this; } };
            timers.push(timer);
            return timer;
        },
        clearInterval(timer) { cleared = timer; }
    });
    assert.equal(sweeper.intervalMs, retention.ARTIFACT_SWEEP_INTERVAL_MS);
    assert.equal(retention.ARTIFACT_SWEEP_INTERVAL_MS, 300_000);
    sweeper.start();
    sweeper.start();
    assert.equal(timers.length, 1, 'one interval');
    assert.equal(timers[0].delay, 300_000);
    assert.equal(timers[0].unrefCalled, true);
    timers[0].callback();
    timers[0].callback();
    assert.equal(calls, 1, 'a tick while a sweep runs is skipped');
    gate.resolve({ verdict: 'satisfied' });
    await flush();
    sweeper.stop();
    assert.equal(cleared, timers[0]);
    timers[0].callback();
    assert.equal(calls, 1, 'nothing runs after stop');
});

test('end to end: a real quota miss, then a real sweep satisfies the quota and clears readiness', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const now = 1_800_000_000_000;
    const resourcePolicy = { ...resolveResourcePolicy({}), MAX_MANAGED_ARTIFACTS: 2 };
    const created = [];
    for (let index = 1; index <= 3; index += 1) created.push(await createManagedArtifact(outputRoot, index, now - 100 + index));
    const service = readiness();
    const { adapter, sweeper } = createRetentionRuntime({
        readinessService: service,
        sweeper: { intervalMs: 60_000, cleanupOptions: { outputRoot, resourcePolicy, clock: () => now } }
    });
    service.recordRetentionResult(false);
    adapter.recordRetentionResult(false);
    const started = Date.now();
    while (!service.isRetentionHealthy()) {
        if (Date.now() - started > 5_000) throw new Error('the sweep never satisfied the quota');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(service.getStatus().ready, true);
    assert.equal(await exists(created[0].artifactPath), false);
    assert.equal(await exists(created[2].artifactPath), true);
    sweeper.stop();
});
