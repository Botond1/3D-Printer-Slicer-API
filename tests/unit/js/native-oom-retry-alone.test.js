'use strict';

/**
 * 3.8.2: a native killed by the system (the cgroup OOM killer beside a
 * sibling slice) is logged with its exit facts and, on the asynchronous path,
 * run once more ALONE. On 2026-10-18 two concurrent Bambu slices of one 3MF
 * pushed `bambustu_main` to 7.8 GB beside a 4.6 GB sibling under the 12 GiB
 * cgroup; the kernel killed one, the job answered INTERNAL_PROCESSING_ERROR
 * after 344 s and nothing retried or logged why.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
const { setEventWriter } = require('../../../app/services/observability/events');
const { createSliceQueue } = require('../../../app/services/slice/queue');
const { createCommandRunner } = require('../../../app/services/slice/command');
const { handleProcessingError } = require('../../../app/services/slice/errors');
const { setResponseSettlement, writeJsonAndWaitForFinish } = require('../../../app/services/slice/response-lifecycle');
const { createAsyncHarness, deferred } = require('./helpers/async-slice-harness');

const events = [];
setEventWriter((entry) => events.push(entry));
test.after(() => {
    setEventWriter((entry) => console.info(JSON.stringify(entry)));
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const eventsNamed = (name) => events.filter((entry) => entry.event === name);

function createQueue() {
    return createSliceQueue({
        maxConcurrent: 2, maxQueueLength: 10, maxQueuePerClient: 10, maxWaitMs: 60_000,
        emitEvent: () => {}, recordQueueRejection: () => {}
    });
}

/** Enqueue a task that runs until its gate opens; records its start. */
function enqueueGated(queue, name, started, options = {}) {
    const gate = deferred();
    const record = { gate, handle: null, signal: null };
    record.settled = queue.enqueueSliceJob((signal) => {
        record.signal = signal;
        started.push(name);
        return gate.promise;
    }, { queueKey: name, onAdmitted: (handle) => { record.handle = handle; }, ...options });
    record.settled.catch(() => {});
    return record;
}

test('awaitSolo holds the queue until the job runs alone, then dequeuing resumes', async () => {
    const queue = createQueue();
    const started = [];
    const a = enqueueGated(queue, 'A', started);
    const b = enqueueGated(queue, 'B', started);
    await tick();
    assert.deepEqual(started, ['A', 'B']);
    let soloGranted = false;
    const solo = b.handle.awaitSolo(b.signal).then(() => { soloGranted = true; });
    assert.equal(queue.getQueueStatus().soloHold, true);
    assert.deepEqual(Object.keys(queue.getQueueStatus()), [
        'queueLength', 'activeJobs', 'maxConcurrent', 'maxQueueLength', 'maxQueuePerClient'
    ], 'soloHold is not serialized');
    const c = enqueueGated(queue, 'C', started);
    await tick();
    assert.deepEqual(started, ['A', 'B'], 'no job starts while a solo request is pending');
    assert.equal(queue.getQueueStatus().queueLength, 1);

    a.gate.resolve('a');
    await a.settled;
    await solo;
    assert.equal(soloGranted, true);
    await tick();
    assert.deepEqual(started, ['A', 'B'], 'the solo run keeps the slot to itself');
    assert.equal(queue.getQueueStatus().activeJobs, 1);

    b.gate.resolve('b');
    await b.settled;
    await tick();
    assert.deepEqual(started, ['A', 'B', 'C'], 'the hold ends when the solo job settles');
    assert.equal(queue.getQueueStatus().soloHold, false);
    c.gate.resolve('c');
    assert.equal(await c.settled, 'c');
});

test('aborting a pending awaitSolo rejects it and releases the hold', async () => {
    const queue = createQueue();
    const started = [];
    const external = new AbortController();
    const a = enqueueGated(queue, 'A', started);
    const b = enqueueGated(queue, 'B', started, { signal: external.signal });
    await tick();
    const solo = b.handle.awaitSolo(b.signal);
    const c = enqueueGated(queue, 'C', started);
    await tick();
    assert.deepEqual(started, ['A', 'B']);

    external.abort(new Error('client gone'));
    await assert.rejects(solo, /client gone/);
    assert.equal(queue.getQueueStatus().soloHold, false);
    a.gate.resolve('a');
    await a.settled;
    await tick();
    assert.deepEqual(started, ['A', 'B', 'C'], 'normal dequeuing resumes while B still runs');
    b.gate.resolve('b');
    await assert.rejects(b.settled, /client gone/);
    c.gate.resolve('c');
    await c.settled;
});

test('a second solo holder is refused instead of deadlocking', async () => {
    const queue = createQueue();
    const started = [];
    const a = enqueueGated(queue, 'A', started);
    const b = enqueueGated(queue, 'B', started);
    await tick();
    const first = b.handle.awaitSolo(b.signal);
    await assert.rejects(a.handle.awaitSolo(a.signal), { code: 'SLICE_SOLO_UNAVAILABLE' });
    a.gate.resolve('a');
    await a.settled;
    await first;
    b.gate.resolve('b');
    await b.settled;
    assert.equal(queue.getQueueStatus().soloHold, false);
});

const KILLED_500 = Object.freeze({
    success: false,
    error: 'Slicing failed. The error has been logged for review.',
    errorCode: 'INTERNAL_PROCESSING_ERROR',
    native: { exit_code: null, signal: 'SIGKILL', killed_by_system: true }
});
const PLAIN_500 = Object.freeze({
    success: false,
    error: 'Slicing failed. The error has been logged for review.',
    errorCode: 'INTERNAL_PROCESSING_ERROR'
});

/** A pipeline that renames the upload exactly like `appendOriginalExtensionToUpload` and answers from a script. */
function createScriptedPipeline(answers) {
    const state = { paths: [], calls: 0 };
    async function processSlice(req, res) {
        const answer = answers[Math.min(state.calls, answers.length - 1)];
        state.calls += 1;
        state.paths.push(req.file.path);
        await fs.rename(req.file.path, `${req.file.path}.stl`);
        if (answer.status !== 200) return res.status(answer.status).json(answer.body);
        setResponseSettlement(req, writeJsonAndWaitForFinish(res, answer.body));
        return res;
    }
    return { state, processSlice };
}

async function runAsync(t, answers) {
    const pipeline = createScriptedPipeline(answers);
    const harness = await createAsyncHarness(t, { pipeline });
    const since = events.length;
    const accepted = await harness.submit();
    assert.equal(accepted.status, 202);
    const done = await harness.pollCompleted(accepted.headers.location);
    await harness.assertDrained();
    const retries = events.slice(since).filter((entry) => entry.event === 'async.retry_alone');
    return { done, pipeline, retries };
}

test('a system-killed native is retried once alone and the second answer is stored', async (t) => {
    const { done, pipeline, retries } = await runAsync(t, [
        { status: 500, body: KILLED_500 },
        { status: 200, body: { success: true, slicer_engine: 'bambu' } }
    ]);
    assert.equal(pipeline.state.calls, 2);
    assert.equal(pipeline.state.paths[1], `${pipeline.state.paths[0]}.stl`, 'the retry starts from the renamed upload');
    assert.equal(done.json.result_status, 200);
    assert.deepEqual(done.json.result, { success: true, slicer_engine: 'bambu' });
    assert.equal(retries.length, 1);
    assert.equal(retries[0].outcome, 'retrying');
    assert.deepEqual(retries[0].extra, { queue_state: 'running', reason: 'native_killed' });
});

test('a native killed twice stores the 500 marked retried_alone', async (t) => {
    const { done, pipeline, retries } = await runAsync(t, [{ status: 500, body: KILLED_500 }]);
    assert.equal(pipeline.state.calls, 2, 'exactly one retry');
    assert.equal(done.json.result_status, 500);
    assert.deepEqual(done.json.result, { ...KILLED_500, retried_alone: true });
    assert.equal(retries.length, 1);
});

test('a plain 500 and a success never retry', async (t) => {
    const plain = await runAsync(t, [{ status: 500, body: PLAIN_500 }]);
    assert.equal(plain.pipeline.state.calls, 1);
    assert.deepEqual(plain.done.json.result, PLAIN_500);
    assert.equal(plain.retries.length, 0);
    const notKilled = await runAsync(t, [{ status: 500, body: { ...PLAIN_500, native: { exit_code: 1, signal: null, killed_by_system: false } } }]);
    assert.equal(notKilled.pipeline.state.calls, 1);
    assert.equal(notKilled.retries.length, 0);
});

function failingRunner(failure) {
    return createCommandRunner({
        execFile: (_executable, _args, _options, callback) => {
            queueMicrotask(() => callback(Object.assign(new Error('Command failed'), failure), '', failure.stderr || ''));
            return { pid: 4242 };
        },
        setTimeout: () => 1,
        clearTimeout: () => {}
    });
}

test('native.completed failure carries the exit facts and a printable stderr tail', async () => {
    let since = events.length;
    await assert.rejects(failingRunner({ code: 1, signal: null, stderr: 'boom\n\x1b[31mred' })('/bin/native', []));
    let completed = events.slice(since).filter((entry) => entry.event === 'native.completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].outcome, 'failure');
    assert.deepEqual(completed[0].extra, {
        exit_code: 1, signal: null, killed_by_runner: false, stderr_tail: 'boom [31mred'
    });

    since = events.length;
    await assert.rejects(failingRunner({ code: null, signal: 'SIGKILL', killed: false })('/bin/native', []));
    completed = events.slice(since).filter((entry) => entry.event === 'native.completed');
    assert.equal(completed[0].extra.signal, 'SIGKILL');
    assert.equal(completed[0].extra.killed_by_runner, false);
    assert.equal(completed[0].extra.exit_code, null);

    const long = `${'x'.repeat(1000)}TAIL`;
    since = events.length;
    await assert.rejects(failingRunner({ code: 2, signal: null, stderr: long })('/bin/native', []));
    const tail = events.slice(since).find((entry) => entry.event === 'native.completed').extra.stderr_tail;
    assert.equal(tail.length, 400);
    assert.ok(tail.endsWith('TAIL'));
});

function captureResponse() {
    return {
        statusCode: 200, body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

test('the generic 500 carries a bounded native block for a command error only', () => {
    let since = events.length;
    const killed = Object.assign(new Error('Command failed: /usr/local/bin/bambu-studio /secret/path'), {
        code: null, signal: 'SIGKILL', killed: false, cmd: '/usr/local/bin/bambu-studio /secret/path',
        stderr: 'loading /secret/path\n',
        bambuResult: Object.freeze({ returnCode: -51, errorString: 'Slicing failed' })
    });
    const res = handleProcessingError(killed, captureResponse(), null, null, () => '.stl');
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.errorCode, 'INTERNAL_PROCESSING_ERROR');
    assert.deepEqual(res.body.native, { exit_code: null, signal: 'SIGKILL', killed_by_system: true });
    assert.ok(!JSON.stringify(res.body).includes('/secret/path'), 'no stderr or path in the body');
    const detail = events.slice(since).filter((entry) => entry.event === 'native.failure_detail');
    assert.equal(detail.length, 1);
    assert.equal(detail[0].error_code, 'NATIVE_PROCESS_KILLED');
    assert.equal(detail[0].outcome, 'failure');
    assert.deepEqual(detail[0].extra, {
        exit_code: null, signal: 'SIGKILL', killed_by_runner: false,
        bambu_return_code: -51, bambu_error: 'Slicing failed', stderr_tail: 'loading /secret/path'
    });

    since = events.length;
    const wrapperExit = Object.assign(new Error('Command failed'), { code: 137, signal: null, killed: false, cmd: 'x', stderr: '' });
    assert.equal(handleProcessingError(wrapperExit, captureResponse(), null, null, () => '').body.native.killed_by_system, true,
        'the Bambu wrapper reports a SIGKILLed child as exit status 137');
    const failed = Object.assign(new Error('Command failed'), { code: 1, signal: null, killed: false, cmd: 'x', stderr: 'bad' });
    const failedBody = handleProcessingError(failed, captureResponse(), null, null, () => '').body;
    assert.deepEqual(failedBody.native, { exit_code: 1, signal: null, killed_by_system: false });
    const failedDetail = events.slice(since).filter((entry) => entry.event === 'native.failure_detail').at(-1);
    assert.equal(failedDetail.error_code, 'NATIVE_PROCESSING_FAILED');
    assert.equal(failedDetail.extra.bambu_return_code, null);

    since = events.length;
    const plain = handleProcessingError(new Error('unexpected'), captureResponse(), null, null, () => '');
    assert.deepEqual(plain.body, PLAIN_500);
    assert.equal(events.slice(since).filter((entry) => entry.event === 'native.failure_detail').length, 0);
});

test('the asynchronous deadline still ends the second run', async (t) => {
    const state = { calls: 0 };
    async function processSlice(req, res, options) {
        state.calls += 1;
        await fs.rename(req.file.path, `${req.file.path}.stl`);
        if (state.calls === 1) return res.status(500).json(KILLED_500);
        await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
        return res;
    }
    const harness = await createAsyncHarness(t, { pipeline: { state, processSlice }, store: { deadlineMs: 300 } });
    const accepted = await harness.submit();
    const done = await harness.pollCompleted(accepted.headers.location);
    assert.equal(state.calls, 2);
    assert.equal(done.json.result_status, 504, 'the first 500 did not shield the retry from the deadline');
    await harness.assertDrained();
});
