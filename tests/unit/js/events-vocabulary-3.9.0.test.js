'use strict';

/**
 * 3.9.0 event vocabulary (spec §4.9): every new name and extra key survives
 * the emitter's allowlist, `ex_` job ids are kept, each emitter's documented
 * extra set fits the 8-key cap, and no new key name would be redacted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_NAMES, createEventEmitter } = require('../../../app/services/observability/events');

const REQUEST_ID = '00000000-0000-4000-8000-000000000390';
const REDACTED_KEY = /(?:authorization|cookie|credential|key|password|secret|token)/i;

const NEW_EVENT_NAMES = Object.freeze([
    'identity.verified', 'identity.failed', 'identity.stale',
    'auth.slot_summary', 'auth.legacy_migration_expired',
    'runtime.event_loop_stall', 'runtime.limits_unavailable',
    'export.accepted', 'export.completed', 'export.deleted', 'export.preempted'
]);
const NEW_EXTRA_KEYS = Object.freeze([
    'slot', 'rotation', 'client_ip', 'client_request_id', 'rule', 'limit',
    'triangles', 'instances', 'objects', 'verdict', 'format', 'fidelity'
]);

/**
 * The documented `extra` set of each 3.9.0 emitter (top-level fields such as
 * `audience`, `outcome`, `error_code`, `duration_ms`, `job_id` are not in
 * `extra`). Emitters must stay inside these sets.
 */
const DOCUMENTED_EXTRA_SETS = Object.freeze({
    'identity.verified': { reason: 'background', count: 1 },
    'identity.failed': { reason: 'timeout', count: 2 },
    'identity.stale': { reason: 'stale', count: 1 },
    'auth.rejected': {
        reason: 'invalid_key', client_ip: '203.0.113.7', client_request_id: 'plugin-req-1', count: 12
    },
    'auth.slot_summary': { slot: 'woocommerce', rotation: 'previous', client_ip: '45.84.204.13', count: 40 },
    'auth.legacy_migration_expired': { slot: 'shared', reason: 'expired' },
    'runtime.event_loop_stall': { reason: 'event_loop', count: 1 },
    'runtime.limits_unavailable': { reason: 'choom_missing', limit: 500 },
    'export.accepted': { format: 'stl', fidelity: 'exact', queue_state: 'queued' },
    'export.completed': { format: '3mf', fidelity: 'unverified', verdict: 'exact', bytes: 4096 },
    'export.deleted': { reason: 'deleted', action: 'delete' },
    'export.preempted': { reason: 'retry_alone', count: 1 },
    'resource.rejected': {
        reason: '3mf_expansion', rule: 'ARCHIVE_EXPANSION_EXCEEDED', limit: 25000000,
        triangles: 25000001, instances: 12, objects: 3
    },
    'artifact.cleanup': { reason: 'deleted', verdict: 'incomplete', count: 3, bytes: 1024 }
});

function captureEmitter() {
    const entries = [];
    const emit = createEventEmitter({
        writer: (entry) => entries.push(entry),
        clock: () => new Date('2026-11-11T00:00:00.000Z'),
        createId: () => REQUEST_ID,
        readContext: () => ({})
    });
    return { emit, entries };
}

test('every 3.9.0 event name is registered and emitted', () => {
    for (const name of NEW_EVENT_NAMES) {
        assert.ok(EVENT_NAMES.includes(name), name);
        const { emit, entries } = captureEmitter();
        assert.equal(emit(name, { outcome: 'success', error_code: 'OK', duration_ms: 12 }), true, name);
        assert.equal(entries[0].event, name);
        assert.equal(entries[0].outcome, 'success');
        assert.equal(entries[0].duration_ms, 12);
    }
    assert.equal(new Set(EVENT_NAMES).size, EVENT_NAMES.length);
});

test('every documented emitter set survives the filter whole and fits the 8-key cap', () => {
    for (const [name, extra] of Object.entries(DOCUMENTED_EXTRA_SETS)) {
        assert.ok(EVENT_NAMES.includes(name), name);
        assert.ok(Object.keys(extra).length <= 8, `${name} documents more than 8 keys`);
        const { emit, entries } = captureEmitter();
        assert.equal(emit(name, { audience: 'slice', extra }), true, name);
        assert.deepEqual(entries[0].extra, extra, name);
        assert.equal(entries[0].audience, 'slice');
    }
});

test('each new extra key survives the filter and none matches the redaction pattern', () => {
    for (const key of NEW_EXTRA_KEYS) {
        assert.doesNotMatch(key, REDACTED_KEY, key);
        const value = key === 'client_ip' ? '2001:db8::1' : 'label';
        const { emit, entries } = captureEmitter();
        emit('auth.slot_summary', { extra: { [key]: value } });
        assert.deepEqual(entries[0].extra, { [key]: value }, key);
    }
    // `audience` is already a top-level field, so `audience_slot` is not added.
    const { emit, entries } = captureEmitter();
    emit('auth.slot_summary', { audience: 'slice', extra: { audience_slot: 'slice', slot: 'leadpilot' } });
    assert.deepEqual(entries[0].extra, { slot: 'leadpilot' });
    assert.equal(entries[0].audience, 'slice');
});

test('client_ip keeps only literal IPv4/IPv6 addresses', () => {
    for (const address of ['31.97.75.126', '45.84.204.13', '::1', '::ffff:192.0.2.1', '2001:db8::7']) {
        const { emit, entries } = captureEmitter();
        emit('auth.rejected', { extra: { client_ip: address, count: 1 } });
        assert.equal(entries[0].extra.client_ip, address);
    }
    for (const value of ['999.1.1.1', 'shop.rocket3d.hu', '203.0.113.7, 10.0.0.1', '', 3232235777, null]) {
        const { emit, entries } = captureEmitter();
        emit('auth.rejected', { extra: { client_ip: value, count: 1 } });
        assert.deepEqual(entries[0].extra, { count: 1 }, String(value));
    }
});

test('ex_ job ids are kept, sj_ and job- ids still are, malformed ids are dropped', () => {
    for (const id of [`ex_${'a'.repeat(32)}`, `sj_${'b'.repeat(32)}`, `job-${'c'.repeat(32)}`]) {
        const { emit, entries } = captureEmitter();
        emit('export.accepted', { job_id: id });
        assert.equal(entries[0].job_id, id);
    }
    for (const id of [`ex_${'a'.repeat(31)}`, `ex_${'A'.repeat(32)}`, `ex-${'a'.repeat(32)}`, `xx_${'a'.repeat(32)}`]) {
        const { emit, entries } = captureEmitter();
        emit('export.accepted', { job_id: id });
        assert.equal(entries[0].job_id, undefined, id);
    }
    // A correlation context carrying an export id is kept as well.
    const seen = [];
    createEventEmitter({
        writer: (entry) => seen.push(entry), readContext: () => ({ jobId: `ex_${'d'.repeat(32)}` })
    })('export.completed', {});
    assert.equal(seen[0].job_id, `ex_${'d'.repeat(32)}`);
});

test('the pre-3.9.0 vocabulary is unchanged and unknown names stay dropped', () => {
    for (const name of [
        'artifact.cleanup', 'async.accepted', 'async.retry_alone', 'auth.rejected',
        'native.failure_detail', 'resource.rejected', 'request.completed', 'startup.completed'
    ]) assert.ok(EVENT_NAMES.includes(name), name);
    assert.equal(EVENT_NAMES.length, 34 + NEW_EVENT_NAMES.length);
    const { emit, entries } = captureEmitter();
    assert.equal(emit('export.unknown', {}), false);
    assert.equal(entries.length, 0);
});
