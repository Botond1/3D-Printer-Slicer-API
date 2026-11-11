'use strict';

/**
 * Every answer of the working tree's slice and job routes passes the live
 * plugin's validators: the real routes, queue, async job store and response
 * lifecycle answer the plugin's exact multipart request with each fixture
 * (fake pipeline: no native runs), synchronously and as an async job, and
 * the port reads each answer exactly as 29a4a1c7 does — the 202 through
 * AsyncSliceAcceptance, each poll through AsyncSliceStatus, each result
 * through the result path with the pinned code, classification and breaker
 * effect.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const V = require('./validator');
const { ERROR_ANSWERS, sliceRequest, successBody } = require('./fixtures');
const { pluginParts } = require('./skeleton');

const { createAsyncHarness } = require(path.resolve(__dirname, '../../unit/js/helpers/async-slice-harness.js'));
const REQUEST = sliceRequest();
const PARTS = pluginParts(REQUEST);

async function asyncRoundTrip(harness) {
    const accepted = await harness.submit({ 'x-request-id': 'contract-replay' }, { parts: PARTS });
    assert.equal(accepted.status, 202);
    const acceptance = V.readSubmission(REQUEST, { status: 202, body: accepted.text, retryAfter: accepted.headers['retry-after'], preferAsync: true });
    assert.equal(acceptance.kind, 'accepted');
    const location = accepted.headers.location;
    assert.equal(location, `/bambu/slice/jobs/${acceptance.acceptance.jobId}`);
    const completed = await harness.pollCompleted(location);
    const view = V.asyncStatus(completed.status, completed.text, completed.headers['retry-after'], acceptance.acceptance.jobId);
    assert.equal(view.kind, 'completed');
    assert.equal((await harness.cancel(location)).status, 204);
    return { view, resultText: JSON.stringify(JSON.parse(completed.text).result) };
}

test('the success answer is admitted synchronously and as a finished async job', async (t) => {
    const harness = await createAsyncHarness(t);
    harness.pipeline.state.answer = { status: 200, body: successBody(REQUEST) };
    const sync = await harness.submit({ prefer: '' }, { parts: PARTS });
    assert.equal(sync.status, 200);
    assert.equal(V.readSubmission(REQUEST, { status: sync.status, body: sync.text }).result.printTimeS, 829);

    const { view, resultText } = await asyncRoundTrip(harness);
    assert.equal(view.resultStatus, 200);
    assert.equal(V.readCompleted(REQUEST, view, resultText).filamentG, 1.78);
    await harness.assertDrained();
});

test('every 3.8.3 refusal reads with its pinned code, synchronously and from a finished job', async (t) => {
    for (const answer of ERROR_ANSWERS) {
        const harness = await createAsyncHarness(t);
        harness.pipeline.state.answer = { status: answer.status, body: answer.body, headers: answer.headers };
        const sync = await harness.submit({ prefer: '' }, { parts: PARTS });
        assert.equal(sync.status, answer.status, answer.name);
        assert.throws(() => V.readSubmission(REQUEST, { status: sync.status, body: sync.text, retryAfter: sync.headers['retry-after'] }),
            (error) => error instanceof V.PluginRefusal && error.code === answer.code
                && V.classifyFailure(error.code) === answer.reason && (error.context.breakerStrike === true) === answer.strike,
            answer.name);

        const { view, resultText } = await asyncRoundTrip(harness);
        assert.equal(view.resultStatus, answer.status, answer.name);
        assert.throws(() => V.readCompleted(REQUEST, view, resultText),
            (error) => error instanceof V.PluginRefusal && error.code === answer.code
                && (answer.status >= 500 ? error.context.breakerStrike === false : true),
            `${answer.name} (finished job)`);
        await harness.assertDrained();
    }
});

test('a poll of a running job and of an unknown job read as pending and not_found', async (t) => {
    const harness = await createAsyncHarness(t);
    const { deferred } = require(path.resolve(__dirname, '../../unit/js/helpers/async-slice-harness.js'));
    const gate = deferred();
    harness.pipeline.state.gate = gate;
    harness.pipeline.state.answer = { status: 200, body: successBody(REQUEST) };
    const accepted = await harness.submit({}, { parts: PARTS });
    const jobId = JSON.parse(accepted.text).job_id;
    await harness.waitFor(() => harness.pipeline.state.runs.length === 1);
    const running = await harness.status(accepted.headers.location);
    assert.equal(V.asyncStatus(running.status, running.text, running.headers['retry-after'], jobId).kind, 'pending');
    const unknown = await harness.status(`/bambu/slice/jobs/sj_${'0'.repeat(32)}`);
    assert.equal(V.asyncStatus(unknown.status, unknown.text, null, `sj_${'0'.repeat(32)}`).kind, 'not_found');
    gate.resolve();
    await harness.pollCompleted(accepted.headers.location);
    await harness.cancel(accepted.headers.location);
    await harness.assertDrained();
});
