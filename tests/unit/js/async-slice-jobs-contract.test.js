'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { createAsyncHarness, send, SLICE_PARTS } = require('./helpers/async-slice-harness');
const { prefersRespondAsync, createCapturedResponse } = require('../../../app/services/slice/async-slice');
const { ROUTE_AUDIENCES, classifyRoute } = require('../../../app/config/route-policy');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const createSwaggerDocument = require(path.join(REPO_ROOT, 'app/docs/swagger-docs'));

const STORE_TRAP = new Proxy({}, {
    get(target, property) {
        if (property === 'then') return undefined;
        return () => { throw new Error(`the synchronous path touched the async store (${String(property)})`); };
    }
});

const SYNC_BODY = Object.freeze({ success: true, engine: 'bambu' });
const ASYNC_HEADERS = ['location', 'preference-applied', 'retry-after', 'cache-control'];

function assertSynchronous(response) {
    assert.equal(response.status, 200);
    assert.equal(response.text, JSON.stringify(SYNC_BODY));
    for (const header of ASYNC_HEADERS) assert.equal(response.headers[header], undefined, header);
}

test('without Prefer: respond-async every slice route stays synchronous and never touches the async store', async (t) => {
    const harness = await createAsyncHarness(t, { asyncJobStore: STORE_TRAP });
    harness.pipeline.state.answer = { status: 200, body: SYNC_BODY };
    for (const prefer of [undefined, '', 'return=minimal', 'respond-asynchronously', 'wait=100']) {
        const headers = prefer === undefined ? { prefer: undefined } : { prefer };
        if (prefer === undefined) delete headers.prefer;
        const response = await send(harness.port, { method: 'POST', path: '/bambu/slice', parts: SLICE_PARTS, headers });
        assertSynchronous(response);
    }
    // The header is ignored on the engines the async contract does not cover.
    harness.pipeline.state.answer = { status: 200, body: SYNC_BODY };
    const prusa = await send(harness.port, {
        method: 'POST', path: '/prusa/slice', parts: SLICE_PARTS, headers: { prefer: 'respond-async' }
    });
    assertSynchronous(prusa);
    await harness.assertDrained();
});

test('a server with the async mode disabled answers a Prefer: respond-async request synchronously', async (t) => {
    const harness = await createAsyncHarness(t, { asyncJobStore: null });
    harness.pipeline.state.answer = { status: 200, body: SYNC_BODY };
    assertSynchronous(await harness.submit());
    harness.pipeline.state.answer = { status: 422, body: { success: false, error: 'x', errorCode: 'UNSLICEABLE_SOURCE_GEOMETRY' } };
    const failure = await harness.submit();
    assert.equal(failure.status, 422);
    assert.equal(failure.text, JSON.stringify(harness.pipeline.state.answer.body));
    await harness.assertDrained();
});

test('Prefer parsing follows RFC 7240 preference tokens', () => {
    const request = (prefer) => ({ headers: { prefer } });
    for (const value of ['respond-async', 'Respond-Async', ' respond-async ', 'wait=5, respond-async',
        'respond-async; foo=bar', 'respond-async=', 'return=minimal,respond-async']) {
        assert.equal(prefersRespondAsync(request(value)), true, value);
    }
    for (const value of [undefined, '', 'respond', 'respond-async-later', 'x-respond-async', 'wait=respond-async']) {
        assert.equal(prefersRespondAsync(request(value)), false, String(value));
    }
    assert.equal(prefersRespondAsync({ get: (name) => (name === 'prefer' ? 'respond-async' : undefined) }), true);
    assert.equal(prefersRespondAsync(null), false);
});

test('the captured response serializes exactly like res.json and refuses a second write', () => {
    const capture = createCapturedResponse();
    const payload = { a: 1e21, b: undefined, c: [undefined, -0, String.fromCharCode(0xe9, 0x2014)], d: { toJSON: () => 'x' } };
    capture.status(422).setHeader('Retry-After', '7');
    capture.json(payload);
    assert.equal(JSON.stringify(capture.body), JSON.stringify(payload));
    assert.equal(capture.statusCode, 422);
    assert.equal(capture.getHeader('retry-after'), '7');
    assert.equal(capture.headersSent, true);
    assert.equal(capture.writableEnded, true);
    assert.throws(() => capture.json({}), /already written/);
});

test('the job routes are slice-audience routes; other methods and shapes stay public', () => {
    const job = `/bambu/slice/jobs/sj_${'a'.repeat(32)}`;
    assert.equal(classifyRoute('GET', job), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('DELETE', `${job}/`), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('POST', job), ROUTE_AUDIENCES.PUBLIC);
    assert.equal(classifyRoute('GET', '/bambu/slice/jobs'), ROUTE_AUDIENCES.PUBLIC);
    assert.equal(classifyRoute('GET', `${job}/result`), ROUTE_AUDIENCES.PUBLIC);
    assert.equal(classifyRoute('GET', `/prusa/slice/jobs/sj_${'a'.repeat(32)}`), ROUTE_AUDIENCES.PUBLIC);
});

test('OpenAPI documents the async submission, status and cancellation contract', () => {
    const document = createSwaggerDocument({ FDM: {}, SLA: {} });
    const bambu = document.paths['/bambu/slice'].post;
    assert.deepEqual(bambu.parameters.map((parameter) => parameter.name), ['x-slicer-api-key', 'Prefer']);
    assert.equal(bambu.parameters[1].required, false);
    for (const route of ['/prusa/slice', '/orca/slice']) {
        assert.deepEqual(document.paths[route].post.parameters.map((parameter) => parameter.name), ['x-slicer-api-key']);
        assert.equal(document.paths[route].post.responses[202], undefined);
    }
    const accepted = bambu.responses[202];
    assert.deepEqual(Object.keys(accepted.headers).sort(), ['Cache-Control', 'Location', 'Preference-Applied', 'Retry-After']);
    assert.deepEqual(accepted.content['application/json'].schema.required,
        ['success', 'async_contract', 'job_id', 'status', 'status_url', 'poll_after_ms', 'deadline_at', 'deadline_ms']);
    const jobs = document.paths['/bambu/slice/jobs/{job_id}'];
    for (const method of ['get', 'delete']) {
        assert.deepEqual(jobs[method].security, [{ SliceServiceApiKey: [] }], method);
        assert.equal(jobs[method].parameters[0].name, 'x-slicer-api-key');
        assert.deepEqual(jobs[method].responses[404].content['application/json'].schema.properties.errorCode.enum,
            ['SLICE_JOB_NOT_FOUND']);
    }
    const [pending, completed] = jobs.get.responses[200].content['application/json'].schema.oneOf;
    assert.deepEqual(pending.properties.status.enum, ['queued', 'running']);
    assert.equal(pending.properties.queue_position.nullable, true);
    assert.deepEqual(completed.required,
        ['success', 'async_contract', 'job_id', 'status', 'elapsed_ms', 'result_status', 'result']);
    assert.match(completed.properties.result.description, /SLICE_DEADLINE_EXCEEDED/);
    assert.ok(jobs.delete.responses[204]);
    assert.equal(document.info.version, '3.8.1');
});

test('through the real pipeline an async result equals the synchronous answer byte for byte', async (t) => {
    const { processSlice, preValidateSliceRequest } = require('../../../app/services/slice.service');
    // PYTHON_EXECUTABLE points at node, so the first helper fails deterministically
    // inside the pipeline: both paths must map that failure identically.
    const harness = await createAsyncHarness(t, {
        pipeline: { state: { runs: [] }, processSlice },
        validate: preValidateSliceRequest
    });
    const synchronous = await harness.submit({ prefer: '' });
    await harness.assertDrained();
    const accepted = await harness.submit();
    assert.equal(accepted.status, 202);
    const done = await harness.pollCompleted(accepted.headers.location);
    assert.equal(done.json.result_status, synchronous.status);
    assert.equal(JSON.stringify(done.json.result), synchronous.text);
    assert.equal(done.json.result.success, false);
    await harness.assertDrained();
});
