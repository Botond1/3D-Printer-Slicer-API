'use strict';

/** 3.9.0 §4.7: the export class of the slice queue (T-EXP-U scheduling cases). */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createSliceQueue,
    toQueueErrorResponse,
    ExportQueueFullError,
    EXPORT_QUEUE_RETRY_AFTER_SECONDS
} = require('../../../app/services/slice/queue');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createQueue(options = {}) {
    const events = [];
    const queue = createSliceQueue({
        maxConcurrent: 2,
        maxQueueLength: 24,
        maxQueuePerClient: 20,
        maxWaitMs: 60_000,
        isRuntimeAvailable: () => true,
        emitEvent: (name, data) => events.push({ name, data }),
        recordQueueRejection: () => {},
        captureContext: () => ({}),
        runWithContext: (context, callback) => callback(),
        ...options
    });
    return { queue, events };
}

/** A controllable task recording its starts. */
function controlled(label, starts) {
    const gates = [];
    const task = (signal) => {
        const gate = deferred();
        gates.push(gate);
        starts.push({ label, signal });
        signal.addEventListener('abort', () => gate.reject(signal.reason), { once: true });
        return gate.promise;
    };
    return { task, gates };
}

test('without exports the 3.8.3 admission order is unchanged (sync before async, FIFO)', async () => {
    const { queue } = createQueue({ maxConcurrent: 1 });
    const starts = [];
    const blocker = controlled('blocker', starts);
    const asyncA = controlled('asyncA', starts);
    const syncB = controlled('syncB', starts);
    const syncC = controlled('syncC', starts);
    const settled = [
        queue.enqueueSliceJob(blocker.task, { queueKey: 'k' }),
        queue.enqueueSliceJob(asyncA.task, { queueKey: 'k', ignoreQueueWait: true }),
        queue.enqueueSliceJob(syncB.task, { queueKey: 'k' }),
        queue.enqueueSliceJob(syncC.task, { queueKey: 'k' })
    ];
    await flush();
    assert.deepEqual(starts.map((s) => s.label), ['blocker']);
    for (const gate of [blocker, syncB, syncC, asyncA]) {
        await flush();
        gate.gates.at(-1).resolve('done');
        await flush();
    }
    await Promise.all(settled);
    assert.deepEqual(starts.map((s) => s.label), ['blocker', 'syncB', 'syncC', 'asyncA']);
    const status = queue.getQueueStatus();
    assert.equal(status.exportQueueLength, 0);
    assert.equal(status.exportActive, false);
    assert.deepEqual(Object.keys(status), ['queueLength', 'activeJobs', 'maxConcurrent', 'maxQueueLength', 'maxQueuePerClient']);
});

test('an export starts only when a slot is free and no slice waits', async () => {
    const { queue } = createQueue();
    const starts = [];
    const sliceA = controlled('sliceA', starts);
    const sliceB = controlled('sliceB', starts);
    const sliceC = controlled('sliceC', starts);
    const exportJob = controlled('export', starts);
    const a = queue.enqueueSliceJob(sliceA.task, { queueKey: 'k' });
    const b = queue.enqueueSliceJob(sliceB.task, { queueKey: 'k' });
    const e = queue.enqueueExportJob(exportJob.task);
    const c = queue.enqueueSliceJob(sliceC.task, { queueKey: 'k' });
    await flush();
    assert.deepEqual(starts.map((s) => s.label), ['sliceA', 'sliceB']);
    sliceA.gates[0].resolve(1);
    await flush();
    // The queued slice wins the free slot; the export still waits.
    assert.deepEqual(starts.map((s) => s.label), ['sliceA', 'sliceB', 'sliceC']);
    sliceB.gates[0].resolve(2);
    await flush();
    assert.deepEqual(starts.map((s) => s.label), ['sliceA', 'sliceB', 'sliceC', 'export']);
    assert.equal(queue.getQueueStatus().exportActive, true);
    assert.equal(queue.getQueueStatus().activeJobs, 2);
    exportJob.gates[0].resolve('file');
    sliceC.gates[0].resolve(3);
    assert.deepEqual(await Promise.all([a, b, c, e]), [1, 2, 3, 'file']);
});

test('an export takes a slot: with one slice and one export running, a new slice waits', async () => {
    const { queue } = createQueue();
    const starts = [];
    const slice = controlled('slice', starts);
    const exportJob = controlled('export', starts);
    const late = controlled('late', starts);
    const s = queue.enqueueSliceJob(slice.task, { queueKey: 'k' });
    const e = queue.enqueueExportJob(exportJob.task);
    await flush();
    assert.deepEqual(starts.map((x) => x.label), ['slice', 'export']);
    const l = queue.enqueueSliceJob(late.task, { queueKey: 'k' });
    await flush();
    assert.deepEqual(starts.map((x) => x.label), ['slice', 'export']);
    exportJob.gates[0].resolve('e');
    await flush();
    assert.deepEqual(starts.map((x) => x.label), ['slice', 'export', 'late']);
    slice.gates[0].resolve('s');
    late.gates[0].resolve('l');
    assert.deepEqual(await Promise.all([s, e, l]), ['s', 'e', 'l']);
});

test('at most one export runs; exports are FIFO within their class', async () => {
    const { queue } = createQueue();
    const starts = [];
    const first = controlled('first', starts);
    const second = controlled('second', starts);
    const positions = [];
    const one = queue.enqueueExportJob(first.task);
    const two = queue.enqueueExportJob(second.task, { onAdmitted: (handle) => positions.push(handle) });
    await flush();
    assert.deepEqual(starts.map((s) => s.label), ['first']);
    assert.equal(positions[0].getQueuePosition(), 1);
    assert.equal(positions[0].getState(), 'queued');
    first.gates[0].resolve(1);
    await flush();
    assert.deepEqual(starts.map((s) => s.label), ['first', 'second']);
    assert.equal(positions[0].getQueuePosition(), null);
    second.gates[0].resolve(2);
    assert.deepEqual(await Promise.all([one, two]), [1, 2]);
});

test('exports never count toward the 24-job queue or the per-key share', async () => {
    const { queue } = createQueue({ maxConcurrent: 1, maxQueueLength: 2, maxQueuePerClient: 2, maxExportJobs: 16 });
    const starts = [];
    const pending = [];
    const blocker = controlled('blocker', starts);
    pending.push(queue.enqueueSliceJob(blocker.task, { queueKey: 'shop' }));
    const exports = [];
    for (let index = 0; index < 5; index += 1) {
        const job = controlled(`export${index}`, starts);
        exports.push(job);
        pending.push(queue.enqueueExportJob(job.task));
    }
    // The shop key still has its whole share and the queue its whole length.
    const second = controlled('second', starts);
    pending.push(queue.enqueueSliceJob(second.task, { queueKey: 'shop' }));
    const third = controlled('third', starts);
    pending.push(queue.enqueueSliceJob(third.task, { queueKey: 'other' }));
    await assert.rejects(queue.enqueueSliceJob(() => 0, { queueKey: 'other' }), { errorCode: 'SLICE_QUEUE_FULL' });
    assert.equal(queue.getQueueStatus().queueLength, 2);
    assert.equal(queue.getQueueStatus().exportQueueLength, 5);
    blocker.gates[0].resolve();
    await flush();
    second.gates[0].resolve();
    await flush();
    third.gates[0].resolve();
    for (const job of exports) {
        await flush();
        job.gates[0].resolve();
    }
    await Promise.all(pending);
    assert.deepEqual(starts.map((s) => s.label), [
        'blocker', 'second', 'third', 'export0', 'export1', 'export2', 'export3', 'export4'
    ]);
});

test('the export class has its own limit and answers EXPORT_QUEUE_FULL 429 with Retry-After 10', async () => {
    const { queue } = createQueue({ maxExportJobs: 2 });
    const starts = [];
    const a = controlled('a', starts);
    const b = controlled('b', starts);
    const pa = queue.enqueueExportJob(a.task);
    const pb = queue.enqueueExportJob(b.task);
    await assert.rejects(queue.enqueueExportJob(() => 0), (error) => {
        assert.ok(error instanceof ExportQueueFullError);
        const mapping = toQueueErrorResponse(error);
        assert.equal(mapping.status, 429);
        assert.equal(mapping.body.errorCode, 'EXPORT_QUEUE_FULL');
        assert.equal(mapping.headers['Retry-After'], String(EXPORT_QUEUE_RETRY_AFTER_SECONDS));
        assert.equal(EXPORT_QUEUE_RETRY_AFTER_SECONDS, 10);
        return true;
    });
    await flush();
    a.gates[0].resolve();
    await flush();
    b.gates[0].resolve();
    await Promise.all([pa, pb]);
});

test('a solo hold pre-empts a running export, which is re-queued at the head of its class', async () => {
    const { queue, events } = createQueue();
    const starts = [];
    let soloHandle;
    const slice = controlled('slice', starts);
    const exportJob = controlled('export', starts);
    const nextExport = controlled('next-export', starts);
    const s = queue.enqueueSliceJob(slice.task, { queueKey: 'k', ignoreQueueWait: true, onAdmitted: (h) => { soloHandle = h; } });
    let exportHandle;
    const e = queue.enqueueExportJob(exportJob.task, { onAdmitted: (h) => { exportHandle = h; } });
    const n = queue.enqueueExportJob(nextExport.task);
    await flush();
    assert.deepEqual(starts.map((x) => x.label), ['slice', 'export']);
    const runningExportSignal = starts[1].signal;
    const granted = soloHandle.awaitSolo();
    assert.equal(runningExportSignal.aborted, true);
    assert.equal(runningExportSignal.reason.code, 'EXPORT_PREEMPTED');
    await flush();
    await granted; // the solo slice waited only for the abort to settle
    assert.equal(exportHandle.getState(), 'queued');
    assert.equal(exportHandle.getQueuePosition(), 1);
    assert.deepEqual(starts.map((x) => x.label), ['slice', 'export']);
    assert.ok(events.some((event) => event.name === 'export.preempted'
        && event.data.extra.reason === 'retry_alone' && event.data.extra.count === 1));
    slice.gates[0].resolve('sliced');
    await flush();
    // The pre-empted export runs again before the export queued behind it.
    assert.deepEqual(starts.map((x) => x.label), ['slice', 'export', 'export']);
    assert.equal(starts[2].signal.aborted, false);
    exportJob.gates[1].resolve('exported');
    await flush();
    nextExport.gates[0].resolve('next');
    assert.deepEqual(await Promise.all([s, e, n]), ['sliced', 'exported', 'next']);
});

test('a pre-empted export whose deadline passes rejects with the deadline, not the pre-emption', async () => {
    const { queue } = createQueue();
    const starts = [];
    let soloHandle;
    const slice = controlled('slice', starts);
    const deadline = new AbortController();
    let release;
    const exportTask = (signal) => {
        starts.push({ label: 'export', signal });
        return new Promise((resolve, reject) => {
            release = () => reject(signal.reason);
        });
    };
    const s = queue.enqueueSliceJob(slice.task, { queueKey: 'k', onAdmitted: (h) => { soloHandle = h; } });
    const e = queue.enqueueExportJob(exportTask, { signal: deadline.signal });
    await flush();
    const granted = soloHandle.awaitSolo();
    const deadlineError = Object.assign(new Error('deadline'), { code: 'EXPORT_DEADLINE_EXCEEDED' });
    deadline.abort(deadlineError);
    release();
    await assert.rejects(e, (error) => error === deadlineError);
    await granted;
    slice.gates[0].resolve('ok');
    assert.equal(await s, 'ok');
});

test('an external abort removes a queued export; shutdown rejects queued and running exports', async () => {
    const { queue } = createQueue({ maxConcurrent: 1 });
    const starts = [];
    const blocker = controlled('blocker', starts);
    const b = queue.enqueueSliceJob(blocker.task, { queueKey: 'k' });
    const cancel = new AbortController();
    const cancelled = queue.enqueueExportJob(() => assert.fail('never starts'), { signal: cancel.signal });
    const reason = Object.assign(new Error('deleted'), { code: 'EXPORT_CANCELLED' });
    cancel.abort(reason);
    await assert.rejects(cancelled, (error) => error === reason);
    assert.equal(queue.getQueueStatus().exportQueueLength, 0);
    const queuedExport = queue.enqueueExportJob(() => assert.fail('never starts'));
    const drained = queue.beginSliceQueueShutdown();
    await assert.rejects(queuedExport, { errorCode: 'SLICE_QUEUE_SHUTDOWN' });
    await assert.rejects(b, { errorCode: 'SLICE_QUEUE_SHUTDOWN' });
    await drained;
    await assert.rejects(queue.enqueueExportJob(() => 0), { errorCode: 'SLICE_QUEUE_SHUTDOWN' });
});
