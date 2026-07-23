'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {
    EVENT_NAMES,
    EVENT_VERSION,
    createEventEmitter
} = require('../../../app/services/observability/events');
const metrics = require('../../../app/services/observability/metrics');
const {
    createRequestObservabilityMiddleware
} = require('../../../app/middleware/requestObservability');

const REQUEST_ID = '00000000-0000-4000-8000-000000000015';
const JOB_ID = `job-${'a'.repeat(32)}`;
const ARTIFACT_ID = `artifact-${'b'.repeat(32)}`;

test.beforeEach(() => metrics.resetMetricsForTests());

test('structured events enforce schema, correlation identifiers, bounds, and fixed names', () => {
    const entries = [];
    const emit = createEventEmitter({
        writer: (entry) => entries.push(entry),
        clock: () => new Date('2026-07-23T12:34:56.000Z'),
        createId: () => REQUEST_ID
    });
    assert.equal(emit('not.registered', {}), false);
    assert.equal(emit('request.completed', {
        request_id: 'line\r\nforge',
        job_id: JOB_ID,
        artifact_id: ARTIFACT_ID,
        audience: 'slice',
        outcome: 'success',
        error_code: 'OK',
        duration_ms: 999999999999,
        extra: {
            action: 'completed',
            count: 2,
            ignored_cardinality: 'must-not-appear'
        }
    }), true);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
        version: EVENT_VERSION,
        event: 'request.completed',
        timestamp: '2026-07-23T12:34:56.000Z',
        request_id: REQUEST_ID,
        job_id: JOB_ID,
        artifact_id: ARTIFACT_ID,
        audience: 'slice',
        outcome: 'success',
        error_code: 'OK',
        duration_ms: 86400000,
        extra: { action: 'completed', count: 2 }
    });
    assert.equal(Object.isFrozen(entries[0]), true);
    assert.ok(EVENT_NAMES.length <= 32);
    assert.equal(new Set(EVENT_NAMES).size, EVENT_NAMES.length);
});

test('event redaction neutralizes injection and excludes sensitive or unbounded data', () => {
    const entries = [];
    const emit = createEventEmitter({
        writer: (entry) => entries.push(entry),
        createId: () => REQUEST_ID
    });
    emit('artifact.accessed', {
        job_id: `job-${'c'.repeat(64)}`,
        artifact_id: 'artifact-invalid',
        audience: 'artifact\r\nforged',
        error_code: 'E'.repeat(200),
        extra: {
            action: 'Bearer abcdefghijklmnopqrstuvwxyz',
            reason: 'api_key=do-not-print-this-value',
            authorization: 'do-not-print',
            technology: 'FDM\r\nnext',
            bytes: Number.POSITIVE_INFINITY,
            count: 3,
            fileName: 'customer-model.gcode',
            absolutePath: 'C:\\private\\customer-model.gcode'
        }
    });
    const serialized = JSON.stringify(entries[0]);
    assert.doesNotMatch(serialized, /do-not-print|customer-model|C:\\\\private|authorization/i);
    assert.doesNotMatch(serialized, /[\r\n]/);
    assert.equal(entries[0].job_id, undefined);
    assert.equal(entries[0].artifact_id, undefined);
    assert.equal(entries[0].audience, undefined);
    assert.equal(entries[0].error_code.length, 64);
    assert.deepEqual(entries[0].extra, {
        action: '[REDACTED]',
        reason: '[REDACTED]',
        technology: 'FDM??next',
        count: 3
    });
});

test('logger failures, clock failures, and identifier generation failures never escape', () => {
    const writeFailure = createEventEmitter({ writer() { throw new Error('writer failed'); } });
    assert.doesNotThrow(() => assert.equal(writeFailure('auth.rejected', {
        audience: 'slice'
    }), false));
    const clockFailure = createEventEmitter({ clock() { throw new Error('clock failed'); } });
    assert.doesNotThrow(() => assert.equal(clockFailure('request.completed', {}), false));
    const idFailure = createEventEmitter({ createId() { throw new Error('uuid failed'); } });
    assert.doesNotThrow(() => assert.equal(idFailure('request.completed', {}), false));
});

test('metrics use fixed-cardinality labels and bounded operational values only', () => {
    metrics.incrementRequest('slice', 'success');
    metrics.incrementRequest(`slice",request_id="${REQUEST_ID}`, 'invented');
    metrics.incrementAuthRejection('pricing');
    metrics.incrementAuthRejection('arbitrary-user-label');
    metrics.recordQueueRejection('timeout');
    metrics.recordQueueRejection('arbitrary-reason');
    metrics.nativeStarted();
    metrics.nativeFinished('timeout', 6001);
    metrics.incrementResourceFailure('invalid_stats');
    metrics.incrementResourceFailure('customer-message');
    metrics.setArtifactStatus(12, 4096);
    metrics.recordArtifactCleanup('success', 2, 512);
    metrics.setQueueStatus({ activeJobs: 1, queueLength: 2, acceptingJobs: true });
    metrics.setReadiness(false);
    metrics.setShutdownState(true);

    const rendered = metrics.renderMetrics();
    for (const expected of [
        'slicer_http_requests_total{audience="slice",outcome="success"} 1',
        'slicer_http_requests_total{audience="public",outcome="server_error"} 1',
        'slicer_auth_rejections_total{audience="pricing"} 1',
        'slicer_auth_rejections_total{audience="operations"} 1',
        'slicer_queue_rejections_total{reason="timeout"} 1',
        'slicer_queue_rejections_total{reason="shutdown"} 1',
        'slicer_native_outcomes_total{outcome="timeout"} 1',
        'slicer_native_duration_ms_bucket{le="30000"} 1',
        'slicer_resource_failures_total{reason="invalid_stats"} 1',
        'slicer_artifacts_retained 12',
        'slicer_artifact_bytes_retained 4096',
        'slicer_queue_accepting_jobs 1',
        'slicer_shutdown 1'
    ]) assert.match(rendered, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(rendered, /request_id|artifact_id|job_id|filename|material|profile|customer-message|arbitrary/);
    assert.ok(Buffer.byteLength(rendered, 'utf8') < 16 * 1024);
    assert.equal(rendered.split('\n').length < 128, true);
});

test('request lifecycle settles once on finish or an aborted close and telemetry cannot escape', () => {
    const events = [];
    const counts = [];
    const times = [0n, 2_000_000n, 4_000_000n, 7_000_000n];
    const middleware = createRequestObservabilityMiddleware({
        clock: () => times.shift(),
        emitEvent: (name, data) => events.push([name, data]),
        incrementRequest: (...values) => counts.push(values),
        resolveRequestAudience: () => 'slice'
    });

    for (const [terminalEvent, writableFinished] of [
        ['finish', true],
        ['close', false]
    ]) {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.writableFinished = writableFinished;
        let nextCalls = 0;
        middleware({ requestId: `request-${terminalEvent}` }, response, () => { nextCalls += 1; });
        response.emit(terminalEvent);
        response.emit(terminalEvent === 'finish' ? 'close' : 'finish');
        assert.equal(nextCalls, 1);
    }

    assert.deepEqual(counts, [
        ['slice', 'success'],
        ['slice', 'rejected']
    ]);
    assert.equal(events.filter(([name]) => name === 'request.completed').length, 2);
    assert.equal(events.filter(([name]) => name === 'request.rejected').length, 1);
    assert.equal(
        events.find(([name, data]) => name === 'request.rejected' && data.request_id === 'request-close')[1].error_code,
        'REQUEST_ABORTED'
    );

    const telemetryFailure = createRequestObservabilityMiddleware({
        emitEvent() { throw new Error('synthetic telemetry failure'); },
        incrementRequest() { throw new Error('synthetic metrics failure'); },
        resolveRequestAudience: () => 'public'
    });
    const response = new EventEmitter();
    response.statusCode = 204;
    response.writableFinished = true;
    assert.doesNotThrow(() => telemetryFailure(
        { requestId: 'request-safe' },
        response,
        () => response.emit('finish')
    ));
});

test('server establishes request correlation and lifecycle observation before CORS', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../app/server.js'), 'utf8');
    const requestIdIndex = source.indexOf('app.use(createRequestIdMiddleware())');
    const lifecycleIndex = source.indexOf('app.use(createRequestObservabilityMiddleware())');
    const corsIndex = source.indexOf('app.use(cors(resolveCorsOptions))');
    assert.ok(requestIdIndex >= 0 && requestIdIndex < lifecycleIndex);
    assert.ok(lifecycleIndex < corsIndex);
});
