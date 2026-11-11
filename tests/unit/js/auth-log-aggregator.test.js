'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthLogAggregator } = require('../../../app/middleware/auth-log-aggregator');
const { createEventEmitter } = require('../../../app/services/observability/events');
const metrics = require('../../../app/services/observability/metrics');

/** A real allowlisted emitter writing into an array, so the vocabulary filter is exercised. */
function recordingEmitter() {
    const lines = [];
    const emit = createEventEmitter({ writer: (entry) => lines.push(entry), readContext: () => ({}) });
    return { lines, emit };
}

function rejection(overrides = {}) {
    const metadata = { requestId: 'caller-id', clientIp: '198.51.100.9', ...overrides.enumerable };
    const hidden = {
        audience: 'slice',
        reason: 'invalid_key',
        serverRequestId: 'srv-0123456789abcdef',
        clientRequestId: 'plugin-req-1',
        ...overrides.hidden
    };
    for (const [name, value] of Object.entries(hidden)) {
        Object.defineProperty(metadata, name, { value, enumerable: false });
    }
    return metadata;
}

function manualTimer() {
    const timers = [];
    return {
        timers,
        setInterval: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
        clearInterval: (timer) => { timer.cleared = true; }
    };
}

test('auth.rejected: first immediately with attribution, then one line per minute per (IP, audience) with count', () => {
    metrics.resetMetricsForTests();
    const { lines, emit } = recordingEmitter();
    const timer = manualTimer();
    const aggregator = createAuthLogAggregator({ emit, setInterval: timer.setInterval, clearInterval: timer.clearInterval });
    aggregator.start();
    assert.equal(timer.timers[0].ms, 60_000);

    for (let index = 0; index < 100; index += 1) aggregator.logger.warn('[SLICE AUTH] Authentication rejected.', rejection());
    aggregator.logger.warn('x', rejection({ enumerable: { clientIp: '203.0.113.4' } }));
    assert.equal(lines.length, 2, 'one immediate line per (IP, audience)');
    assert.equal(lines[0].event, 'auth.rejected');
    assert.equal(lines[0].request_id, 'srv-0123456789abcdef');
    assert.equal(lines[0].audience, 'slice');
    assert.equal(lines[0].error_code, 'AUTH_REQUIRED');
    assert.deepEqual(lines[0].extra, {
        reason: 'invalid_key', count: 1, client_ip: '198.51.100.9', client_request_id: 'plugin-req-1'
    });

    timer.timers[0].fn();
    assert.equal(lines.length, 3, 'only the pair with traffic since the first line writes a summary');
    assert.equal(lines[2].event, 'auth.rejected');
    assert.match(lines[2].request_id, /^srv-[0-9a-f]{16}$/);
    assert.deepEqual(lines[2].extra, { reason: 'window_summary', count: 99, client_ip: '198.51.100.9' });
    // Every rejection is counted exactly once in slicer_auth_rejections_total.
    assert.match(metrics.renderMetrics(), /^slicer_auth_rejections_total\{audience="slice"\} 101$/m);

    timer.timers[0].fn();
    assert.equal(lines.length, 3, 'a quiet minute writes nothing');
    timer.timers[0].fn();
    aggregator.logger.warn('x', rejection());
    assert.equal(lines.length, 4, 'a forgotten pair is written immediately again');
    aggregator.stop();
    assert.equal(timer.timers[0].cleared, true);
    metrics.resetMetricsForTests();
});

test('auth.slot_summary per (audience, slot, rotation, client) and slicer_auth_accepted_total', () => {
    metrics.resetMetricsForTests();
    const { lines, emit } = recordingEmitter();
    const timer = manualTimer();
    const aggregator = createAuthLogAggregator({ emit, setInterval: timer.setInterval, clearInterval: timer.clearInterval });
    aggregator.start();
    for (let index = 0; index < 5; index += 1) {
        aggregator.onAccepted({ audience: 'slice', slot: 'woocommerce', rotation: 'previous', clientIp: '45.84.204.13' });
    }
    aggregator.onAccepted({ audience: 'slice', slot: 'staging', rotation: 'active', clientIp: '192.0.2.7' });
    assert.equal(lines.length, 2);
    assert.equal(lines[0].event, 'auth.slot_summary');
    assert.equal(lines[0].audience, 'slice');
    assert.deepEqual(lines[0].extra, { slot: 'woocommerce', rotation: 'previous', count: 1, client_ip: '45.84.204.13' });
    timer.timers[0].fn();
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[2].extra, { slot: 'woocommerce', rotation: 'previous', count: 4, client_ip: '45.84.204.13' });
    const rendered = metrics.renderMetrics();
    assert.match(rendered, /^slicer_auth_accepted_total\{audience="slice",slot="woocommerce",rotation="previous"\} 5$/m);
    assert.match(rendered, /^slicer_auth_accepted_total\{audience="slice",slot="staging",rotation="active"\} 1$/m);
    // Labels only: no key material, digests or file names can reach a line.
    for (const line of lines) {
        assert.ok(Object.keys(line.extra).length <= 8);
        assert.doesNotMatch(JSON.stringify(line), /key|digest|sha/i);
    }
    aggregator.stop();
    metrics.resetMetricsForTests();
});

test('bounded memory: tuples beyond the cap fold into one overflow line', () => {
    const { lines, emit } = recordingEmitter();
    const aggregator = createAuthLogAggregator({ emit, maxEntries: 3, setInterval: () => ({}), clearInterval() {} });
    for (let index = 1; index <= 10; index += 1) {
        aggregator.logger.warn('x', rejection({ enumerable: { clientIp: `192.0.2.${index}` } }));
    }
    assert.equal(lines.length, 3);
    assert.ok(aggregator.size() <= 4);
    aggregator.flush();
    assert.equal(lines.length, 4);
    assert.deepEqual(lines[3].extra, { reason: 'overflow', count: 7 });
});

test('a non-IP client value is dropped by the vocabulary; a throwing emitter never throws to the request', () => {
    const { lines, emit } = recordingEmitter();
    const aggregator = createAuthLogAggregator({ emit, setInterval: () => ({}), clearInterval() {} });
    aggregator.logger.warn('x', rejection({ enumerable: { clientIp: 'unknown' } }));
    assert.equal(lines[0].extra.client_ip, undefined);
    const broken = createAuthLogAggregator({
        emit() { throw new Error('writer down'); },
        metrics: { incrementAuthRejection() { throw new Error('x'); }, incrementAuthAccepted() { throw new Error('x'); } },
        setInterval: () => ({}),
        clearInterval() {}
    });
    assert.doesNotThrow(() => {
        broken.logger.warn('x', rejection());
        broken.logger.warn('x', rejection());
        broken.logger.warn('x', rejection());
        broken.onAccepted({ audience: 'slice', slot: 'leadpilot', rotation: 'active', clientIp: '192.0.2.1' });
        broken.flush();
    });
});
