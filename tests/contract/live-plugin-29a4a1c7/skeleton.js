'use strict';

/**
 * "Absent = today" (§7): the live plugin's exact multipart request (field
 * order of `HttpSlicerClient::buildMultipartBody()`, no new header) driven
 * through the real slice and job routes, queue and job store (fake pipeline),
 * reduced to a response skeleton — status, the headers the plugin reads, body
 * keys in order, value types, and the values of the enum fields. Ids,
 * timestamps, `receipt_sha256`, `elapsed_ms`, `deadline_*` and
 * `artifact.retention_seconds` are compared by type only.
 *
 * `captureSkeletons(harnessPath)` takes the harness module path so the 3.8.3
 * skeleton can be recorded from an exported dbc539e tree
 * (`node capture-skeleton.js <tree>`), and the test compares the working tree.
 */

const { createHash } = require('node:crypto');

// The slice modules resolve a Python executable at load; the fake pipeline never runs it.
process.env.PYTHON_EXECUTABLE ||= process.execPath;
const { SOURCE_BYTES, sliceRequest, successBody, ERROR_ANSWERS } = require('./fixtures');

const ENUM_KEYS = new Set(['success', 'status', 'errorCode', 'async_contract', 'result_status', 'schema', 'slicer_engine', 'technology',
    'material', 'infill', 'supports', 'print_time_source', 'material_used_g_source', 'orientation_mode', 'size_unit', 'transform_schema',
    'orientation_outcome', 'media_type', 'extension', 'access', 'kind', 'units', 'format', 'volume_source', 'severity', 'source',
    'poll_after_ms', 'retryAfterSeconds', 'status_url_pattern']);
const READ_HEADERS = ['location', 'retry-after', 'preference-applied', 'cache-control', 'content-type'];

/** The plugin's multipart fields for a Bambu slice, in its order (HttpSlicerClient.php:824-869). */
function pluginParts(request = sliceRequest()) {
    const fields = [
        ['material', request.material],
        ['layerHeight', request.layerHeight.toFixed(3)],
        ['infill', `${request.infill}%`],
        ['supports', request.supports ? 'true' : 'false'],
        ['orientationMode', request.orientationMode],
        ['printerProfile', request.printerProfile],
        ['sizeUnit', request.sizeUnit],
        ['rotationX', String(request.rotationX)],
        ['rotationY', String(request.rotationY)],
        ['rotationZ', String(request.rotationZ)],
        ['processProfile', request.verifiedProfile.processProfile],
        ['expectedProfileSha256', request.verifiedProfile.profileHash],
        ['expectedMeasurementGeneration', request.verifiedProfile.generation]
    ];
    if (request.scalePercent !== null) fields.push(['scalePercent', String(request.scalePercent)]);
    return [...fields.map(([name, value]) => ({ name, value })),
        { name: 'choosenFile', filename: `r3d-${createHash('sha256').update(SOURCE_BYTES).digest('hex').slice(0, 16)}.stl`, value: SOURCE_BYTES.toString('utf8') }];
}

function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
}

function shape(value, key = '') {
    const type = typeOf(value);
    if (type === 'object') {
        return { type, keys: Object.keys(value), fields: Object.fromEntries(Object.entries(value).map(([name, member]) => [name, shape(member, name)])) };
    }
    if (type === 'array') return { type, length: value.length, items: value.map((item) => shape(item, key)) };
    if (ENUM_KEYS.has(key) && (type === 'string' || type === 'integer' || type === 'boolean')) return { type, value };
    return { type };
}

function headerShape(headers) {
    const out = {};
    for (const name of READ_HEADERS) {
        if (headers[name] === undefined) continue;
        out[name] = name === 'location' ? String(headers[name]).replace(/sj_[a-f0-9]{32}/, 'sj_<32hex>') : headers[name];
    }
    return out;
}

function exchangeShape(response) {
    return { status: response.status, headers: headerShape(response.headers), body: response.text ? shape(JSON.parse(response.text)) : null };
}

/**
 * Drive the plugin's requests through a harness and return their skeletons.
 * @param {string} harnessPath Path of `async-slice-harness.js`.
 * @param {import('node:test').TestContext} t Test context (cleanup).
 */
async function captureSkeletons(harnessPath, t) {
    const { createAsyncHarness, deferred } = require(harnessPath);
    const parts = pluginParts();
    const out = {};

    let harness = await createAsyncHarness(t);
    harness.pipeline.state.answer = { status: 200, body: successBody() };
    out.sync_success = exchangeShape(await harness.submit({ prefer: '', 'x-request-id': 'contract-sync' }, { parts }));

    const gate = deferred();
    harness.pipeline.state.gate = gate;
    const accepted = await harness.submit({ 'x-request-id': 'contract-async' }, { parts });
    out.async_accepted = exchangeShape(accepted);
    const location = accepted.headers.location;
    await harness.waitFor(() => harness.pipeline.state.runs.length === 2);
    out.async_running = exchangeShape(await harness.status(location));
    gate.resolve();
    out.async_completed = exchangeShape(await harness.pollCompleted(location));
    out.async_delete_completed = { status: (await harness.cancel(location)).status };
    out.async_after_delete = exchangeShape(await harness.status(location));
    await harness.assertDrained();

    harness = await createAsyncHarness(t);
    const geometry = ERROR_ANSWERS.find((answer) => answer.body.errorCode === 'INVALID_SOURCE_GEOMETRY');
    harness.pipeline.state.answer = { status: geometry.status, body: geometry.body };
    const refused = await harness.submit({}, { parts });
    out.async_refused_completed = exchangeShape(await harness.pollCompleted(refused.headers.location));
    out.sync_refused = exchangeShape(await harness.submit({ prefer: '' }, { parts }));
    await harness.assertDrained();
    return out;
}

module.exports = { captureSkeletons, pluginParts, shape };
