'use strict';

/** 3.9.0 §2.3 / §4.7: the export job store and its result files (T-EXP-U: ids, TTL, DELETE). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
    createExportJobStore,
    createExportJobId,
    ExportDeadlineError
} = require('../../../app/services/export/export-jobs');
const { createExportFiles, EXPORT_RESULTS_DIR } = require('../../../app/services/export/export-files');
const { EVENT_NAMES } = require('../../../app/services/observability/events');

const SLICE_JOB_ID = /^sj_[a-f0-9]{32}$/;

function manualTimers() {
    const timers = new Map();
    let next = 1;
    return {
        setTimeout(callback, ms) { const id = next++; timers.set(id, { callback, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        fire(ms) {
            for (const [id, timer] of [...timers]) {
                if (timer.ms === ms) { timers.delete(id); timer.callback(); }
            }
        },
        pending: () => [...timers.values()].map((timer) => timer.ms)
    };
}

async function tempFiles(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-files-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return createExportFiles({ root: path.join(root, '.export-results') });
}

function createStore(overrides = {}) {
    const timers = manualTimers();
    let clock = 1_000_000;
    const events = [];
    const outcomes = [];
    const store = createExportJobStore({
        maxJobs: 4,
        resultTtlMs: 900_000,
        deadlineMs: 900_000,
        now: () => clock,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        emitEvent: (name, data) => events.push({ name, data }),
        incrementExportJob: (label) => outcomes.push(label),
        ...overrides
    });
    return { store, timers, events, outcomes, advance: (ms) => { clock += ms; } };
}

test('ex_ ids never match the slice job pattern, and the event vocabulary admits them', () => {
    for (let index = 0; index < 200; index += 1) {
        const id = createExportJobId();
        assert.match(id, /^ex_[a-f0-9]{32}$/);
        assert.doesNotMatch(id, SLICE_JOB_ID);
    }
    for (const name of ['export.accepted', 'export.completed', 'export.deleted', 'export.preempted']) {
        assert.ok(EVENT_NAMES.includes(name), name);
    }
    assert.equal(EXPORT_RESULTS_DIR.endsWith(`${path.sep}.export-results`), true);
});

test('a job belongs to its principal; any other principal gets nothing', () => {
    const { store } = createStore();
    const job = store.admit({ principal: 'slice:woocommerce', format: 'stl', fidelity: 'exact' });
    assert.equal(store.lookup(job.id, 'slice:woocommerce'), job);
    assert.equal(store.lookup(job.id, 'slice:leadpilot'), null);
    assert.equal(store.lookup(job.id.replace('ex_', 'sj_'), 'slice:woocommerce'), null);
    assert.equal(store.cancel(job.id, 'slice:leadpilot'), false);
    assert.equal(store.lookup(job.id, 'slice:woocommerce'), job);
});

test('at most four exports are queued or running, synchronous exports included', () => {
    const { store } = createStore();
    const releaseSync = store.reserveSync();
    assert.equal(typeof releaseSync, 'function');
    const jobs = [1, 2, 3].map(() => store.admit({ principal: 'slice:shop', format: 'stl', fidelity: 'exact' }));
    assert.equal(store.hasCapacity(), false);
    assert.equal(store.admit({ principal: 'slice:shop', format: 'stl', fidelity: 'exact' }), null);
    assert.equal(store.reserveSync(), null);
    releaseSync();
    releaseSync(); // idempotent
    assert.equal(store.inFlight(), 3);
    store.complete(jobs[0], { status: 200, view: {} });
    assert.equal(store.inFlight(), 2);
    assert.ok(store.admit({ principal: 'slice:shop', format: 'stl', fidelity: 'exact' }));
});

test('views: queued, running, completed — the §2.3 shapes', () => {
    const { store, advance } = createStore();
    const job = store.admit({ principal: 'slice:shop', format: '3mf', fidelity: 'exact' });
    const accepted = store.acceptedView(job);
    assert.deepEqual(Object.keys(accepted), [
        'success', 'export_contract', 'job_id', 'status', 'status_url', 'poll_after_ms', 'deadline_at', 'deadline_ms'
    ]);
    assert.equal(accepted.status_url, `/bambu/export/jobs/${job.id}`);
    assert.equal(accepted.deadline_ms, 900_000);
    let position = 2;
    let state = 'queued';
    store.attachAdmission(job, { getQueuePosition: () => (state === 'queued' ? position : null), getState: () => state });
    const queued = store.view(job);
    assert.deepEqual(Object.keys(queued), [
        'success', 'export_contract', 'job_id', 'status', 'queue_position', 'elapsed_ms', 'deadline_at', 'poll_after_ms'
    ]);
    assert.equal(queued.status, 'queued');
    assert.equal(queued.queue_position, 2);
    state = 'active';
    store.markRunning(job);
    advance(1500);
    const running = store.view(job);
    assert.equal(running.status, 'running');
    assert.equal(running.queue_position, null);
    assert.equal(running.elapsed_ms, 1500);
    // Pre-empted and queued again: the position reappears.
    state = 'queued';
    position = 1;
    assert.equal(store.view(job).status, 'queued');
    assert.equal(store.view(job).queue_position, 1);
    store.complete(job, { status: 409, view: { success: false, errorCode: 'EXPORT_GEOMETRY_MISMATCH' } });
    const completed = store.view(job);
    assert.deepEqual(Object.keys(completed), [
        'success', 'export_contract', 'job_id', 'status', 'elapsed_ms', 'result_status', 'result'
    ]);
    assert.equal(completed.result_status, 409);
    assert.equal(completed.result.errorCode, 'EXPORT_GEOMETRY_MISMATCH');
});

test('the deadline aborts the job with EXPORT_DEADLINE_EXCEEDED', () => {
    const { store, timers } = createStore();
    const job = store.admit({ principal: 'slice:shop', format: 'stl', fidelity: 'exact' });
    timers.fire(900_000);
    assert.equal(job.controller.signal.aborted, true);
    assert.ok(job.controller.signal.reason instanceof ExportDeadlineError);
    assert.equal(job.controller.signal.reason.code, 'EXPORT_DEADLINE_EXCEEDED');
});

test('a result lives 15 minutes after completion, then its record and file are gone', async (t) => {
    const files = await tempFiles(t);
    const { store, timers, events, outcomes } = createStore({ files });
    const job = store.admit({ principal: 'slice:shop', format: 'stl', fidelity: 'exact' });
    const source = path.join(os.tmpdir(), `export-source-${process.pid}-${Date.now()}.stl`);
    await fs.writeFile(source, 'bytes');
    const stored = await files.storeResultFile(job.id, 'stl', source);
    assert.equal(path.basename(stored), 'r3d-export.stl');
    assert.equal(path.dirname(stored), files.resultDirectory(job.id));
    if (process.platform !== 'win32') {
        assert.equal((await fs.stat(path.dirname(stored))).mode & 0o777, 0o700);
        assert.equal((await fs.stat(stored)).mode & 0o777, 0o600);
    }
    store.complete(job, { status: 200, file: { path: stored, size: 5, sha256: 'x' }, view: (done) => ({ expires: done.fileExpiresAt }) });
    assert.equal(store.view(job).result.expires, job.completedAt + 900_000);
    assert.deepEqual(timers.pending(), [900_000]);
    timers.fire(900_000);
    // The file removal is asynchronous: wait for it (bounded) rather than a
    // fixed 20 ms, which a loaded full-suite run can outlast.
    for (let waited = 0; waited < 2_000; waited += 10) {
        const gone = await fs.lstat(files.resultDirectory(job.id)).then(() => false, () => true);
        if (gone) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(store.lookup(job.id, 'slice:shop'), null);
    await assert.rejects(fs.lstat(files.resultDirectory(job.id)), { code: 'ENOENT' });
    assert.deepEqual(outcomes, ['expired']);
    assert.ok(events.some((event) => event.name === 'export.deleted' && event.data.extra.reason === 'expired'));
});

test('DELETE aborts a running job, deletes a finished job and its file, and answers once', async (t) => {
    const files = await tempFiles(t);
    const { store, events, outcomes } = createStore({ files });
    const running = store.admit({ principal: 'slice:shop', format: 'stl', fidelity: 'exact' });
    assert.equal(store.cancel(running.id, 'slice:shop'), true);
    assert.equal(running.controller.signal.aborted, true);
    assert.equal(running.controller.signal.reason.code, 'EXPORT_CANCELLED');
    assert.equal(store.cancel(running.id, 'slice:shop'), false);
    // A late result of a deleted job is dropped, file included.
    const lateSource = path.join(os.tmpdir(), `export-late-${process.pid}-${Date.now()}.stl`);
    await fs.writeFile(lateSource, 'late');
    const lateFile = await files.storeResultFile(running.id, 'stl', lateSource);
    assert.equal(store.complete(running, { status: 200, file: { path: lateFile } }), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(fs.lstat(files.resultDirectory(running.id)), { code: 'ENOENT' });

    const finished = store.admit({ principal: 'slice:shop', format: '3mf', fidelity: 'unverified' });
    const source = path.join(os.tmpdir(), `export-done-${process.pid}-${Date.now()}.3mf`);
    await fs.writeFile(source, 'pk');
    const stored = await files.storeResultFile(finished.id, '3mf', source);
    store.complete(finished, { status: 200, file: { path: stored }, view: {} });
    assert.equal(store.cancel(finished.id, 'slice:shop'), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(fs.lstat(files.resultDirectory(finished.id)), { code: 'ENOENT' });
    assert.equal(store.lookup(finished.id, 'slice:shop'), null);
    assert.deepEqual(outcomes, ['cancelled']);
    assert.deepEqual(events.filter((event) => event.name === 'export.deleted').map((event) => event.data.extra),
        [{ reason: 'cancelled', action: 'abort' }, { reason: 'deleted', action: 'discard' }]);
});

test('the export files purge removes every stored result', async (t) => {
    const files = await tempFiles(t);
    const source = path.join(os.tmpdir(), `export-purge-${process.pid}-${Date.now()}.stl`);
    await fs.writeFile(source, 'x');
    const id = createExportJobId();
    await files.storeResultFile(id, 'stl', source);
    await files.purgeAll();
    await assert.rejects(fs.lstat(files.root), { code: 'ENOENT' });
    assert.throws(() => files.resultDirectory('../escape'), /Invalid export job id/);
    assert.throws(() => files.resultDirectory('sj_' + 'a'.repeat(32)), /Invalid export job id/);
});
