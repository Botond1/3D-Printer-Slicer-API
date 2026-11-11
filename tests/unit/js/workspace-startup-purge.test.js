'use strict';

/**
 * T-RET (3.9.0): nothing of a job survives it, a restart purges interrupted
 * job workspaces, and T-RET-5: a customer-like file name reaches no log line.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { createJobWorkspace, auditStaleWorkspaces, MARKER_NAME } = require('../../../app/services/slice/workspace');
const { setEventWriter } = require('../../../app/services/observability/events');
const { createAsyncHarness } = require('./helpers/async-slice-harness');

const SLICE_FIELDS = Object.freeze([
    { name: 'layerHeight', value: '0.2' },
    { name: 'material', value: 'PLA' }
]);

function parts(filename) {
    return [{ name: 'choosenFile', filename, value: 'solid synthetic' }, ...SLICE_FIELDS];
}

/** The startup options the integrator passes (spec §4.3). */
const STARTUP_PURGE = Object.freeze({ delete: true, deleteMarkedRegardlessAge: true, verifyExclusiveLease: async () => true });

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-startup-purge-'));
    const dirs = { jobsRoot: path.join(root, 'jobs'), scratchRoot: path.join(root, 'scratch'), outputRoot: path.join(root, 'output') };
    await fs.mkdir(dirs.outputRoot, { recursive: true });
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    return dirs;
}

test('startup purges every marked workspace regardless of age and leaves an unmarked directory', async (t) => {
    const dirs = await fixture(t);
    const now = Date.now();
    // A Node death a moment ago: the workspace is young and its marker valid.
    const orphan = await createJobWorkspace({ ...dirs, clock: () => now - 1_000 });
    await fs.writeFile(path.join(orphan.directory, 'upload.stl'), 'solid private');
    await fs.access(path.join(orphan.directory, MARKER_NAME));
    const unmarked = path.join(dirs.jobsRoot, `job-${'a'.repeat(32)}`);
    await fs.mkdir(unmarked);
    const stranger = path.join(dirs.jobsRoot, 'not-a-job');
    await fs.mkdir(stranger);

    const summary = await auditStaleWorkspaces({ ...dirs, clock: () => now, ...STARTUP_PURGE });
    assert.equal(summary.removed, 1);
    assert.equal(summary.failed, 0);
    await assert.rejects(fs.access(orphan.directory), { code: 'ENOENT' });
    await fs.access(unmarked);
    await fs.access(stranger);
});

test('without the exclusive-lease proof the startup audit deletes nothing', async (t) => {
    const dirs = await fixture(t);
    const orphan = await createJobWorkspace({ ...dirs, clock: () => Date.now() - 1_000 });
    const summary = await auditStaleWorkspaces({ ...dirs, delete: true, deleteMarkedRegardlessAge: true, verifyExclusiveLease: async () => false });
    assert.equal(summary.removed, 0);
    await fs.access(orphan.directory);
});

test('nothing stays under the job or scratch roots after sync, async, failed, cancelled and retried-alone jobs', async (t) => {
    const harness = await createAsyncHarness(t);

    harness.pipeline.state.answer = { status: 200, body: { success: true } };
    assert.equal((await harness.submit({ prefer: '' })).status, 200, 'sync');
    await harness.pollCompleted((await harness.submit()).headers.location);

    harness.pipeline.state.answer = { status: 422, body: { success: false, errorCode: 'UNSLICEABLE_SOURCE_GEOMETRY' } };
    assert.equal((await harness.submit({ prefer: '' })).status, 422, 'sync failure');
    await harness.pollCompleted((await harness.submit()).headers.location);

    harness.pipeline.state.answer = {
        status: 500,
        body: { success: false, errorCode: 'INTERNAL_SERVER_ERROR', native: { exit_code: null, signal: 'SIGKILL', killed_by_system: true } }
    };
    const retried = await harness.pollCompleted((await harness.submit()).headers.location);
    assert.equal(retried.json.result.retried_alone, true, 'the retry-alone run happened');
    assert.equal(harness.pipeline.state.runs.length, 6);

    harness.pipeline.state.answer = null;
    let release;
    harness.pipeline.state.gate = { promise: new Promise((resolve) => { release = resolve; }) };
    const running = (await harness.submit()).headers.location;
    await harness.waitFor(() => harness.pipeline.state.runs.length === 7);
    assert.equal((await harness.cancel(running)).status, 204);
    release();

    await harness.assertDrained();
});

test('T-RET-5: the multipart file name Jane-Doe-private.stl appears in no log line', async (t) => {
    const lines = [];
    setEventWriter((entry) => lines.push(JSON.stringify(entry)));
    const originals = {};
    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
        originals[method] = console[method];
        console[method] = (...args) => lines.push(args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
    }
    t.after(() => {
        for (const [method, original] of Object.entries(originals)) console[method] = original;
        setEventWriter((entry) => console.info(JSON.stringify(entry)));
    });
    const harness = await createAsyncHarness(t);
    harness.pipeline.state.answer = { status: 200, body: { success: true } };
    const name = 'Jane-Doe-private.stl';
    assert.equal((await harness.submit({ prefer: '' }, { parts: parts(name) })).status, 200);
    const location = (await harness.submit({}, { parts: parts(name) })).headers.location;
    await harness.pollCompleted(location);
    assert.equal((await harness.cancel(location)).status, 204);
    harness.pipeline.state.answer = { status: 422, body: { success: false, errorCode: 'INVALID_SOURCE_GEOMETRY' } };
    await harness.pollCompleted((await harness.submit({}, { parts: parts(name) })).headers.location);
    await harness.assertDrained();

    const storeEvents = harness.events.map((event) => JSON.stringify(event));
    assert.ok(lines.length + storeEvents.length > 0, 'events were captured');
    for (const line of [...lines, ...storeEvents]) {
        assert.equal(/jane-doe/i.test(line), false, line);
    }
});
