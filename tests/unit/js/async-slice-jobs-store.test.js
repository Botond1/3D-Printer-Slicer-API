'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    JOB_ID_PATTERN,
    createAsyncSliceJobStore,
    createJobId
} = require('../../../app/services/slice/async-jobs');
const { EVENT_NAMES, createEventEmitter } = require('../../../app/services/observability/events');
const { RESOURCE_DEFINITIONS, resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { createQueueScheduler } = require('../../../app/services/slice/queue-scheduler');

const PRINCIPAL = 'slice:woocommerce';
const OTHER = 'slice:leadpilot';

/** Deterministic clock and timers: `advance(ms)` fires every due timer in order. */
function fakeTime(start = Date.parse('2026-10-05T10:00:00.000Z')) {
    let current = start;
    let sequence = 0;
    const timers = new Map();
    return {
        now: () => current,
        setTimeout(callback, delay) {
            const handle = { id: (sequence += 1), unref() { return this; } };
            timers.set(handle, { at: current + delay, callback });
            return handle;
        },
        clearTimeout(handle) { timers.delete(handle); },
        advance(ms) {
            const target = current + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, timer]) => timer.at <= target)
                    .sort((left, right) => left[1].at - right[1].at || left[0].id - right[0].id)[0];
                if (!due) break;
                timers.delete(due[0]);
                current = due[1].at;
                due[1].callback();
            }
            current = target;
        },
        pending: () => timers.size
    };
}

function createStore(overrides = {}) {
    const time = fakeTime();
    const events = [];
    let counter = 0;
    const store = createAsyncSliceJobStore({
        deadlineMs: 600_000,
        resultTtlMs: 1_800_000,
        maxJobs: 3,
        now: time.now,
        setTimeout: time.setTimeout,
        clearTimeout: time.clearTimeout,
        createId: () => `sj_${String((counter += 1)).padStart(32, '0')}`,
        emitEvent: (name, data) => events.push({ name, ...data }),
        ...overrides
    });
    return { store, time, events };
}

function admit(store, principal = PRINCIPAL, admission = null) {
    const controller = new AbortController();
    const job = store.admit({ principal, requestId: 'req-async-1', controller, admission });
    return { job, controller };
}

const OK_RESULT = Object.freeze({ status: 200, body: { success: true, stats: { print_time_seconds: 2453 } }, retryAfterSeconds: null });

test('job identifiers are sj_ plus 128 CSPRNG bits as 32 lowercase hex characters', () => {
    const seen = new Set();
    for (let index = 0; index < 64; index += 1) {
        const id = createJobId();
        assert.match(id, /^sj_[a-f0-9]{32}$/);
        seen.add(id);
    }
    assert.equal(seen.size, 64);
    assert.equal(JOB_ID_PATTERN.test('sj_' + 'A'.repeat(32)), false);
    assert.equal(createJobId((bytes) => Buffer.alloc(bytes, 0xab)), `sj_${'ab'.repeat(16)}`);
});

test('the async policy entries carry the contract defaults and ranges', () => {
    const policy = resolveResourcePolicy({});
    assert.equal(policy.ASYNC_SLICE_DEADLINE_MS, 600_000);
    assert.equal(policy.ASYNC_SLICE_RESULT_TTL_MS, 1_800_000);
    assert.equal(policy.ASYNC_SLICE_MAX_JOBS, 200);
    assert.deepEqual(RESOURCE_DEFINITIONS.ASYNC_SLICE_DEADLINE_MS, { default: 600_000, min: 60_000, max: 1_800_000 });
    assert.deepEqual(RESOURCE_DEFINITIONS.ASYNC_SLICE_RESULT_TTL_MS, { default: 1_800_000, min: 60_000, max: 86_400_000 });
    assert.deepEqual(RESOURCE_DEFINITIONS.ASYNC_SLICE_MAX_JOBS, { default: 200, min: 1, max: 2_000 });
    assert.throws(() => resolveResourcePolicy({ ASYNC_SLICE_DEADLINE_MS: '59999' }), /ASYNC_SLICE_DEADLINE_MS/);
    assert.throws(() => resolveResourcePolicy({ ASYNC_SLICE_DEADLINE_MS: '1800001' }), /ASYNC_SLICE_DEADLINE_MS/);
    assert.throws(() => resolveResourcePolicy({ ASYNC_SLICE_RESULT_TTL_MS: '86400001' }), /ASYNC_SLICE_RESULT_TTL_MS/);
    assert.throws(() => resolveResourcePolicy({ ASYNC_SLICE_MAX_JOBS: '0' }), /ASYNC_SLICE_MAX_JOBS/);
    const store = createAsyncSliceJobStore({ policy });
    assert.deepEqual(store.limits, { deadlineMs: 600_000, resultTtlMs: 1_800_000, maxJobs: 200 });
});

test('an admitted job reports queued with its position, then running, then the captured result', () => {
    const { store, time, events } = createStore();
    let state = 'queued';
    let position = 2;
    const { job } = admit(store, PRINCIPAL, { getState: () => state, getQueuePosition: () => position });
    assert.deepEqual(store.acceptedView(job), {
        success: true,
        async_contract: 1,
        job_id: job.id,
        status: 'queued',
        status_url: `/bambu/slice/jobs/${job.id}`,
        poll_after_ms: 2_000,
        deadline_at: '2026-10-05T10:10:00.000Z',
        deadline_ms: 600_000
    });
    time.advance(1_500);
    assert.deepEqual(store.view(store.lookup(job.id, PRINCIPAL)), {
        success: true, async_contract: 1, job_id: job.id, status: 'queued', queue_position: 2,
        elapsed_ms: 1_500, deadline_at: '2026-10-05T10:10:00.000Z', poll_after_ms: 2_000
    });
    // The scheduler activated the job before its task marked it running.
    state = 'active';
    position = null;
    assert.equal(store.view(job).status, 'running');
    assert.equal(store.view(job).queue_position, null);
    store.markRunning(job);
    time.advance(3_000);
    assert.equal(store.complete(job, { ...OK_RESULT, retryAfterSeconds: 7 }), true);
    assert.equal(store.complete(job, OK_RESULT), false, 'a finished job cannot be completed twice');
    assert.deepEqual(store.view(store.lookup(job.id, PRINCIPAL)), {
        success: true, async_contract: 1, job_id: job.id, status: 'completed', elapsed_ms: 4_500,
        result_status: 200, result_retry_after_seconds: 7, result: OK_RESULT.body
    });
    assert.deepEqual(events.map((event) => event.name), ['async.accepted', 'async.completed']);
    assert.equal(events[1].job_id, job.id);
    assert.equal(events[1].request_id, 'req-async-1');
    assert.equal(events[1].outcome, 'success');
    assert.equal(events[1].duration_ms, 4_500);
});

test('the deadline aborts the queue signal and completes the job as 504 SLICE_DEADLINE_EXCEEDED', () => {
    const { store, time, events } = createStore();
    const { job, controller } = admit(store);
    store.markRunning(job);
    time.advance(599_999);
    assert.equal(controller.signal.aborted, false);
    time.advance(1);
    assert.equal(controller.signal.aborted, true);
    assert.equal(controller.signal.reason.code, 'SLICE_DEADLINE_EXCEEDED');
    assert.equal(controller.signal.reason.name, 'AbortError');
    assert.equal(store.isLive(job), false);
    const view = store.view(store.lookup(job.id, PRINCIPAL));
    assert.equal(view.status, 'completed');
    assert.equal(view.result_status, 504);
    assert.equal(view.elapsed_ms, 600_000);
    assert.deepEqual(view.result, {
        success: false,
        error: 'Slice job exceeded its asynchronous deadline.',
        errorCode: 'SLICE_DEADLINE_EXCEEDED'
    });
    assert.equal('result_retry_after_seconds' in view, false);
    const completed = events.find((event) => event.name === 'async.completed');
    assert.equal(completed.error_code, 'SLICE_DEADLINE_EXCEEDED');
    assert.equal(completed.outcome, 'failure');
    // A late pipeline answer cannot overwrite the deadline result.
    assert.equal(store.complete(job, OK_RESULT), false);
});

test('a finished result is retained for the TTL, then expires to not-found with async.expired', () => {
    const { store, time, events } = createStore();
    const { job } = admit(store);
    store.complete(job, OK_RESULT);
    time.advance(1_799_999);
    assert.ok(store.lookup(job.id, PRINCIPAL));
    time.advance(1);
    assert.equal(store.lookup(job.id, PRINCIPAL), null);
    assert.deepEqual(events.map((event) => event.name), ['async.accepted', 'async.completed', 'async.expired']);
    assert.equal(store.getStatus().retained, 0);
    assert.equal(time.pending(), 0, 'no timer outlives a removed job');
});

test('lookups are bound to the submitting principal and reject malformed identifiers', () => {
    const { store } = createStore();
    const { job } = admit(store);
    assert.equal(store.lookup(job.id, OTHER), null);
    assert.equal(store.lookup(job.id.toUpperCase(), PRINCIPAL), null);
    for (const malformed of [undefined, null, '', 'sj_', `sj_${'0'.repeat(31)}`, `sj_${'0'.repeat(33)}`,
        `job-${'0'.repeat(32)}`, `sj_${'g'.repeat(32)}`, `../${job.id}`]) {
        assert.equal(store.lookup(malformed, PRINCIPAL), null, String(malformed));
    }
    assert.equal(store.lookup(`sj_${'f'.repeat(32)}`, PRINCIPAL), null);
    assert.equal(store.cancel(job.id, OTHER), false, 'another principal cannot cancel');
    assert.ok(store.lookup(job.id, PRINCIPAL));
});

test('cancel aborts a live job, discards a finished one, and both then answer not-found', () => {
    const { store, events } = createStore();
    const live = admit(store);
    store.markRunning(live.job);
    assert.equal(store.cancel(live.job.id, PRINCIPAL), true);
    assert.equal(live.controller.signal.aborted, true);
    assert.equal(live.controller.signal.reason.code, 'SLICE_JOB_CANCELLED');
    assert.equal(store.lookup(live.job.id, PRINCIPAL), null);
    assert.equal(store.complete(live.job, OK_RESULT), false, 'a cancelled job never records a result');

    const finished = admit(store);
    store.complete(finished.job, OK_RESULT);
    assert.equal(store.cancel(finished.job.id, PRINCIPAL), true);
    assert.equal(finished.controller.signal.aborted, false);
    assert.equal(store.lookup(finished.job.id, PRINCIPAL), null);
    assert.equal(store.cancel(finished.job.id, PRINCIPAL), false);
    const cancelled = events.filter((event) => event.name === 'async.cancelled');
    assert.deepEqual(cancelled.map((event) => event.extra.queue_state), ['running', 'completed']);
});

test('at capacity the oldest finished result is evicted; when every retained job is live there is no room', () => {
    const { store, time, events } = createStore({ maxJobs: 3 });
    const first = admit(store);
    const second = admit(store);
    const third = admit(store);
    assert.equal(store.hasCapacity(), false, 'three live jobs fill the store');
    assert.equal(admit(store).job, null);
    time.advance(10);
    store.complete(second.job, OK_RESULT);
    time.advance(10);
    store.complete(first.job, OK_RESULT);
    assert.equal(store.hasCapacity(), true);
    const fourth = admit(store);
    assert.ok(fourth.job);
    assert.equal(store.lookup(second.job.id, PRINCIPAL), null, 'the earliest-completed result went first');
    assert.ok(store.lookup(first.job.id, PRINCIPAL));
    assert.ok(store.lookup(third.job.id, PRINCIPAL));
    const evicted = events.filter((event) => event.name === 'async.evicted');
    assert.deepEqual(evicted.map((event) => event.job_id), [second.job.id]);
    assert.deepEqual(store.getStatus(), { retained: 3, live: 2, maxJobs: 3 });
});

test('the event vocabulary registers the async events and keeps sj_ identifiers', () => {
    for (const name of ['async.accepted', 'async.completed', 'async.expired', 'async.cancelled', 'async.evicted']) {
        assert.ok(EVENT_NAMES.includes(name), name);
    }
    assert.ok(EVENT_NAMES.length <= 32);
    const entries = [];
    const emit = createEventEmitter({ writer: (entry) => entries.push(entry), readContext: () => ({}) });
    const jobId = `sj_${'c'.repeat(32)}`;
    emit('async.accepted', { request_id: 'req-1', job_id: jobId, audience: 'slice', outcome: 'accepted' });
    emit('async.accepted', { request_id: 'req-1', job_id: `sj_${'C'.repeat(32)}` });
    assert.equal(entries[0].job_id, jobId);
    assert.equal(entries[0].request_id, 'req-1');
    assert.equal(entries[1].job_id, undefined, 'a malformed identifier is dropped, never echoed');
});

test('the scheduler reports queue positions and an async job ignores MAX_SLICE_QUEUE_WAIT_MS', async () => {
    const time = fakeTime();
    const scheduler = createQueueScheduler({
        maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10, maxWaitMs: 1_000,
        now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
        createFullError: () => new Error('full'),
        createTimeoutError: () => Object.assign(new Error('timeout'), { errorCode: 'SLICE_QUEUE_TIMEOUT' }),
        createClientLimitError: () => new Error('limit'),
        createShutdownError: () => new Error('shutdown')
    });
    let release;
    const blocker = scheduler.enqueueSliceJob(() => new Promise((resolve) => { release = resolve; }), { queueKey: 'a' });
    const handles = [];
    const syncJob = scheduler.enqueueSliceJob(async () => 'sync', { queueKey: 'b' }).catch((error) => error);
    const asyncJob = scheduler.enqueueSliceJob(async () => 'async', {
        queueKey: 'c', ignoreQueueWait: true, onAdmitted: (handle) => handles.push(handle)
    });
    assert.equal(handles.length, 1);
    assert.equal(handles[0].getState(), 'queued');
    assert.equal(handles[0].getQueuePosition(), 2);
    time.advance(5_000);
    assert.equal((await syncJob).errorCode, 'SLICE_QUEUE_TIMEOUT');
    assert.equal(handles[0].getQueuePosition(), 1);
    await new Promise((resolve) => setImmediate(resolve));
    release('done');
    assert.equal(await blocker, 'done');
    assert.equal(await asyncJob, 'async');
    assert.equal(handles[0].getQueuePosition(), null);
    assert.equal(handles[0].getState(), 'settled');
});
