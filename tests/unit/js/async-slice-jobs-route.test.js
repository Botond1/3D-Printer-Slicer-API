'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { JOB_PATH, createAsyncHarness, deferred, send } = require('./helpers/async-slice-harness');
const { createCommandRunner } = require('../../../app/services/slice/command');
const { preValidateSliceRequest } = require('../../../app/services/slice.service');

const BOUNDS_BODY = Object.freeze({
    success: false,
    error: 'Model exceeds printer build volume.',
    errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS',
    model_dimensions_mm: { x: 400, y: 10, z: 10 },
    build_volume_limits_mm: { x: 325, y: 320, z: 324.9 }
});
const SUCCESS_BODY = Object.freeze({
    success: true,
    slicer_engine: 'bambu',
    stats: { print_time_seconds: 2453, material_used_g: 24, big: 1e21, small: -0.000001 },
    technical_receipt: { schema: 'r3d-technical-receipt-v1', geometry: { watertight: true, component_count: 1 } },
    note: `f${String.fromCharCode(0x171)}r${String.fromCharCode(0xe9)}sz ${String.fromCharCode(0x2014)} "quoted" \\ slash`
});

function assertAccepted(response, deadlineMs = 60_000) {
    assert.equal(response.status, 202);
    const { job_id: jobId } = response.json;
    assert.match(jobId, /^sj_[a-f0-9]{32}$/);
    assert.equal(response.headers.location, `/bambu/slice/jobs/${jobId}`);
    assert.equal(response.headers['preference-applied'], 'respond-async');
    assert.equal(response.headers['retry-after'], '2');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(response.json), [
        'success', 'async_contract', 'job_id', 'status', 'status_url', 'poll_after_ms', 'deadline_at', 'deadline_ms'
    ]);
    assert.equal(response.json.success, true);
    assert.equal(response.json.async_contract, 1);
    assert.equal(response.json.status, 'queued');
    assert.equal(response.json.status_url, response.headers.location);
    assert.equal(response.json.poll_after_ms, 2_000);
    assert.equal(response.json.deadline_ms, deadlineMs);
    assert.ok(Number.isSafeInteger(Date.parse(response.json.deadline_at)));
    assert.match(response.json.deadline_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    return response.headers.location;
}

test('a successful async job reports queued, running, then the byte-identical synchronous result', async (t) => {
    const harness = await createAsyncHarness(t);
    harness.pipeline.state.answer = { status: 200, body: SUCCESS_BODY };
    const synchronous = await harness.submit({ prefer: '' });
    assert.equal(synchronous.status, 200);
    assert.equal(synchronous.headers['preference-applied'], undefined);
    assert.equal(synchronous.headers.location, undefined);

    const blocker = deferred();
    harness.pipeline.state.gate = blocker;
    const firstResponse = await harness.submit({ 'x-request-id': 'req-async-first' });
    const firstRequestId = firstResponse.headers['x-request-id'];
    assert.equal(firstRequestId, 'req-async-first');
    const first = assertAccepted(firstResponse);
    const second = assertAccepted(await harness.submit({ prefer: 'wait=10, Respond-Async' }));
    await harness.waitFor(() => harness.pipeline.state.runs.length === 2);
    const running = await harness.status(first);
    assert.equal(running.status, 200);
    assert.equal(running.headers['cache-control'], 'no-store');
    assert.equal(running.headers['retry-after'], '2');
    assert.deepEqual(Object.keys(running.json), [
        'success', 'async_contract', 'job_id', 'status', 'queue_position', 'elapsed_ms', 'deadline_at', 'poll_after_ms'
    ]);
    assert.equal(running.json.status, 'running');
    assert.equal(running.json.queue_position, null);
    const queued = await harness.status(second);
    assert.equal(queued.json.status, 'queued');
    assert.equal(queued.json.queue_position, 1);
    assert.ok(queued.json.elapsed_ms >= 0);

    blocker.resolve();
    for (const location of [first, second]) {
        const done = await harness.pollCompleted(location);
        assert.equal(done.headers['retry-after'], undefined);
        assert.deepEqual(Object.keys(done.json), [
            'success', 'async_contract', 'job_id', 'status', 'elapsed_ms', 'result_status', 'result'
        ]);
        assert.equal(done.json.result_status, synchronous.status);
        assert.equal(JSON.stringify(done.json.result), synchronous.text, 'result is the exact synchronous body');
        assert.ok(done.text.includes(`"result":${synchronous.text}}`));
    }
    assert.equal(harness.pipeline.state.released, 3, 'each async artifact was released like a synchronous one');
    await harness.assertDrained();
    assert.deepEqual(harness.events.map((event) => event.name),
        ['async.accepted', 'async.accepted', 'async.completed', 'async.completed']);
    const firstId = first.split('/').at(-1);
    const firstEvents = harness.events.filter((event) => event.job_id === firstId);
    assert.equal(firstEvents.length, 2);
    for (const event of firstEvents) {
        assert.equal(event.request_id, firstRequestId, 'events carry the submission request id');
        assert.equal(event.audience, 'slice');
    }
});

test('an error result keeps its synchronous status, body and Retry-After', async (t) => {
    const harness = await createAsyncHarness(t);
    harness.pipeline.state.answer = { status: 422, body: BOUNDS_BODY };
    const synchronous = await harness.submit({ prefer: '' });
    const done = await harness.pollCompleted(assertAccepted(await harness.submit()));
    assert.equal(synchronous.status, 422);
    assert.equal(done.json.result_status, 422);
    assert.equal(JSON.stringify(done.json.result), synchronous.text);
    assert.equal(harness.events.at(-1).error_code, 'MODEL_OUT_OF_PRINTER_BOUNDS');

    harness.pipeline.state.answer = { status: 503, headers: { 'Retry-After': '9' }, body: { success: false, error: 'x', errorCode: 'SLICER_ENGINE_UNAVAILABLE' } };
    const retry = await harness.pollCompleted(assertAccepted(await harness.submit()));
    assert.equal(retry.json.result_status, 503);
    assert.equal(retry.json.result_retry_after_seconds, 9);
    await harness.assertDrained();
});

test('a queue shutdown after admission becomes the synchronous 503 result', async (t) => {
    const harness = await createAsyncHarness(t);
    harness.pipeline.state.gate = deferred();
    const location = assertAccepted(await harness.submit());
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    void harness.queue.beginSliceQueueShutdown();
    const done = await harness.pollCompleted(location);
    assert.equal(done.json.result_status, 503);
    assert.equal(done.json.result.errorCode, 'SLICE_QUEUE_SHUTDOWN');
    await harness.assertDrained();
});

test('the deadline terminates the native process tree and completes as 504 SLICE_DEADLINE_EXCEEDED', async (t) => {
    const native = { spawned: 0, terminated: [] };
    const runner = createCommandRunner({
        telemetry: 'none',
        platform: 'linux',
        execFile(executable, args, options, callback) {
            native.spawned += 1;
            const child = { pid: 4000 + native.spawned, callback };
            return child;
        },
        createProcessTreeTerminator: (child) => ({
            async terminate() {
                native.terminated.push(child.pid);
                child.callback(Object.assign(new Error('terminated'), { killed: true, signal: 'SIGKILL' }), '', '');
            }
        })
    });
    let sawSignal;
    const pipeline = {
        state: { runs: [] },
        async processSlice(req, res, options) {
            pipeline.state.runs.push(options);
            sawSignal = options.signal;
            await runner('bambu-studio', ['--slice', '0'], { signal: options.signal });
            return res.status(200).json({ success: true });
        }
    };
    const harness = await createAsyncHarness(t, { pipeline, store: { deadlineMs: 1_000 } });
    const location = assertAccepted(await harness.submit(), 1_000);
    await harness.waitFor(() => native.spawned === 1);
    assert.equal((await harness.status(location)).json.status, 'running');
    const done = await harness.pollCompleted(location);
    assert.equal(done.json.result_status, 504);
    assert.deepEqual(done.json.result, {
        success: false,
        error: 'Slice job exceeded its asynchronous deadline.',
        errorCode: 'SLICE_DEADLINE_EXCEEDED'
    });
    assert.ok(done.json.elapsed_ms >= 990, `elapsed ${done.json.elapsed_ms} ms`);
    assert.equal(sawSignal.aborted, true);
    assert.equal(sawSignal.reason.code, 'SLICE_DEADLINE_EXCEEDED');
    await harness.assertDrained();
    assert.deepEqual(native.terminated, [4001], 'the running native tree was terminated');
});

test('the deadline removes a queued job before it starts and MAX_SLICE_QUEUE_WAIT_MS never cuts an async job', async (t) => {
    const harness = await createAsyncHarness(t, { store: { deadlineMs: 400 }, queue: { maxWaitMs: 50 } });
    const blocker = deferred();
    harness.pipeline.state.gate = blocker;
    // A synchronous slice (no async deadline) holds the only slot.
    const holding = harness.submit({ prefer: '' });
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    const queued = assertAccepted(await harness.submit(), 400);
    const waited = await harness.submit({ prefer: '' });
    assert.equal(waited.status, 503);
    assert.equal(waited.json.errorCode, 'SLICE_QUEUE_TIMEOUT', 'the sync wait limit still applies');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stillQueued = await harness.status(queued);
    if (stillQueued.json.status !== 'completed') {
        assert.equal(stillQueued.json.status, 'queued', 'the 50 ms queue wait did not cut the async job');
        assert.equal(stillQueued.json.queue_position, 1);
    }
    const expired = await harness.pollCompleted(queued);
    // Had the queue wait applied, the job would have ended after ~50 ms as 503 SLICE_QUEUE_TIMEOUT.
    assert.equal(expired.json.result_status, 504);
    assert.equal(expired.json.result.errorCode, 'SLICE_DEADLINE_EXCEEDED');
    assert.ok(expired.json.elapsed_ms >= 390, `elapsed ${expired.json.elapsed_ms} ms`);
    assert.equal(harness.queue.getQueueStatus().queueLength, 0, 'the deadline removed it from the queue');
    blocker.resolve();
    assert.equal((await holding).status, 200);
    await harness.assertDrained();
    assert.equal(harness.pipeline.state.runs.length, 1, 'the expired queued job never started');
});

test('a client disconnect after the 202 never aborts the job and the socket stays usable for polls', async (t) => {
    const harness = await createAsyncHarness(t);
    const gate = deferred();
    harness.pipeline.state.gate = gate;
    const accepted = await harness.submit({}, { onResponse: (response) => response.socket.destroy() });
    const location = assertAccepted(accepted);
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    t.after(() => agent.destroy());
    const kept = assertAccepted(await send(harness.port, {
        method: 'POST', path: '/bambu/slice', agent, headers: { prefer: 'respond-async' },
        parts: [{ name: 'choosenFile', filename: 'cube.stl', value: 'solid synthetic' }]
    }));
    const sameSocket = await harness.status(kept, {}, agent);
    assert.equal(sameSocket.status, 200, 'the keep-alive socket of the 202 serves the next poll');
    assert.equal(sameSocket.json.status, 'queued');

    gate.resolve();
    const done = await harness.pollCompleted(location);
    assert.equal(done.json.result_status, 200);
    assert.equal(harness.pipeline.state.runs[0].signal.aborted, false);
    assert.equal((await harness.pollCompleted(kept)).json.result_status, 200);
    await harness.assertDrained();
});

test('unknown, malformed, other-principal, cancelled and unauthenticated job reads answer 404 or 401', async (t) => {
    const harness = await createAsyncHarness(t);
    const location = assertAccepted(await harness.submit());
    await harness.pollCompleted(location);
    const notFound = async (target, headers) => {
        const response = await harness.status(target, headers);
        assert.equal(response.status, 404, target);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.json, { success: false, error: 'Slice job not found.', errorCode: 'SLICE_JOB_NOT_FOUND' });
    };
    await notFound(`/bambu/slice/jobs/sj_${'0'.repeat(32)}`);
    await notFound('/bambu/slice/jobs/not-a-job');
    await notFound(location.toUpperCase().replace('/BAMBU/SLICE/JOBS/SJ_', '/bambu/slice/jobs/sj_'));
    await notFound(location, { 'x-test-principal': 'leadpilot' });
    const unauthenticated = await harness.status(location, { 'x-test-principal': '' });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await harness.status(location)).status, 200, 'the owner still reads it');
    const discarded = await harness.cancel(location);
    assert.equal(discarded.status, 204);
    assert.equal(discarded.text, '');
    assert.equal(discarded.headers['cache-control'], 'no-store');
    await notFound(location);
    assert.equal((await harness.cancel(location)).status, 404);
    assert.equal((await harness.cancel(`/bambu/slice/jobs/sj_${'0'.repeat(32)}`)).status, 404);
    await harness.assertDrained();
});

test('DELETE terminates a running job and removes a queued one from the queue', async (t) => {
    const harness = await createAsyncHarness(t);
    harness.pipeline.state.gate = deferred();
    const running = assertAccepted(await harness.submit());
    const queued = assertAccepted(await harness.submit());
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    assert.equal((await harness.cancel(queued)).status, 204);
    assert.equal(harness.queue.getQueueStatus().queueLength, 0);
    assert.equal((await harness.cancel(running)).status, 204);
    assert.equal(harness.pipeline.state.runs[0].signal.reason.code, 'SLICE_JOB_CANCELLED');
    assert.equal((await harness.status(running)).status, 404);
    await harness.assertDrained();
    assert.equal(harness.pipeline.state.runs.length, 1, 'the cancelled queued job never started');
    assert.deepEqual(harness.events.filter((event) => event.name === 'async.cancelled').map((event) => event.extra.queue_state),
        ['queued', 'running']);
});

test('async jobs count toward the per-client and queue-length limits while queued or running', async (t) => {
    const harness = await createAsyncHarness(t, { queue: { maxQueuePerClient: 2 } });
    const gate = deferred();
    harness.pipeline.state.gate = gate;
    const first = assertAccepted(await harness.submit());
    const second = assertAccepted(await harness.submit());
    for (const prefer of ['respond-async', '']) {
        const limited = await harness.submit({ prefer });
        assert.equal(limited.status, 429);
        assert.equal(limited.json.errorCode, 'SLICE_QUEUE_CLIENT_LIMIT');
        assert.equal(limited.headers['retry-after'], '5');
        assert.equal(limited.headers['preference-applied'], undefined);
    }
    assert.equal(harness.store.getStatus().retained, 2, 'a rejected submission creates no job');
    gate.resolve();
    await harness.pollCompleted(first);
    await harness.pollCompleted(second);
    await harness.waitFor(() => harness.queue.getQueueStatus().activeJobs === 0);
    assertAccepted(await harness.submit());
    await harness.assertDrained();

    const full = await createAsyncHarness(t, { queue: { maxQueueLength: 1 } });
    full.pipeline.state.gate = deferred();
    assertAccepted(await full.submit());
    await full.waitFor(() => full.pipeline.state.runs.length === 1);
    assertAccepted(await full.submit());
    const overflow = await full.submit();
    assert.equal(overflow.status, 503);
    assert.equal(overflow.json.errorCode, 'SLICE_QUEUE_FULL');
    full.pipeline.state.gate.resolve();
    await full.assertDrained();
});

test('when every retained job is live a new async submission answers 429 and consumes no queue slot', async (t) => {
    const harness = await createAsyncHarness(t, { store: { maxJobs: 1 } });
    const gate = deferred();
    harness.pipeline.state.gate = gate;
    const first = assertAccepted(await harness.submit());
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    const refused = await harness.submit();
    assert.equal(refused.status, 429);
    assert.equal(refused.headers['retry-after'], '5');
    assert.deepEqual(refused.json, {
        success: false,
        error: 'Too many asynchronous slice jobs are retained. Please wait and retry.',
        errorCode: 'SLICE_ASYNC_JOBS_FULL',
        retryAfterSeconds: 5
    });
    assert.deepEqual({ ...harness.queue.getQueueStatus() }, {
        queueLength: 0, activeJobs: 1, maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10
    });
    gate.resolve();
    await harness.pollCompleted(first);
    const next = assertAccepted(await harness.submit());
    assert.equal((await harness.status(first)).status, 404, 'the finished result was evicted');
    await harness.pollCompleted(next);
    assert.ok(harness.events.some((event) => event.name === 'async.evicted'));
    await harness.assertDrained();
});

test('pre-pipeline validation answers synchronously with Prefer and creates no job', async (t) => {
    const harness = await createAsyncHarness(t, { validate: preValidateSliceRequest });
    const response = await send(harness.port, {
        method: 'POST', path: '/bambu/slice', headers: { prefer: 'respond-async' },
        parts: [
            { name: 'choosenFile', filename: 'cube.stl', value: 'solid synthetic' },
            { name: 'layerHeight', value: 'thick' },
            { name: 'material', value: 'PLA' }
        ]
    });
    assert.equal(response.status, 400);
    assert.match(response.json.errorCode, /^INVALID_LAYER_HEIGHT/);
    assert.equal(response.headers['preference-applied'], undefined);
    assert.equal(harness.store.getStatus().retained, 0);
    assert.equal(harness.pipeline.state.runs.length, 0);
    await harness.assertDrained();
});
