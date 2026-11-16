'use strict';

/** 3.10.0: the small-model fast lane of the slice queue and its policy. */

const test = require('node:test');
const assert = require('node:assert/strict');
// Loading the command module resolves the Python helper executable once.
process.env.PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || process.execPath;
const { createSliceQueue } = require('../../../app/services/slice/queue');
const {
    FAST_LANE_DEFAULT_MAX_BYTES,
    FAST_LANE_POLICY,
    resolveFastLanePolicy,
    isFastLaneUpload
} = require('../../../app/services/slice/fast-lane');
const { nativeKind } = require('../../../app/services/slice/command');
const { priorInspectionArguments } = require('../../../app/services/slice/bambu-source');

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
        fastLane: { enabled: true },
        isRuntimeAvailable: () => true,
        emitEvent: (name, data) => events.push({ name, data }),
        recordQueueRejection: () => {},
        captureContext: () => ({}),
        runWithContext: (context, callback) => callback(),
        ...options
    });
    return { queue, events };
}

function controlled(label, starts) {
    const gates = [];
    const task = (signal) => {
        const gate = deferred();
        gates.push(gate);
        starts.push(label);
        signal.addEventListener('abort', () => gate.reject(signal.reason), { once: true });
        return gate.promise;
    };
    return { task, gates };
}

function enqueue(queue, starts, label, options = {}) {
    const job = controlled(label, starts);
    job.settled = queue.enqueueSliceJob(job.task, { queueKey: 'shop', ...options });
    job.settled.catch(() => {});
    return job;
}

test('a small job starts beside two busy normal slots, one at a time, and normal jobs keep their order', async () => {
    const { queue, events } = createQueue();
    const starts = [];
    const bigA = enqueue(queue, starts, 'bigA');
    const bigB = enqueue(queue, starts, 'bigB');
    const bigC = enqueue(queue, starts, 'bigC');
    const smallA = enqueue(queue, starts, 'smallA', { fastLane: true });
    const smallB = enqueue(queue, starts, 'smallB', { fastLane: true });
    await flush();
    assert.deepEqual(starts, ['bigA', 'bigB', 'smallA']);
    let status = queue.getQueueStatus();
    assert.equal(status.activeJobs, 3);
    assert.equal(status.queueLength, 2);
    assert.equal(status.fastLaneActive, true);
    assert.equal(status.fastLaneEnabled, true);
    assert.equal(JSON.stringify(status).includes('fastLane'), false);
    assert.equal(events.filter((entry) => entry.name === 'queue.fast_lane').length, 1);
    assert.deepEqual(events.find((entry) => entry.name === 'queue.fast_lane').data.extra, { queue_state: 'fast_lane' });

    // The lane frees: the next small job takes it, the waiting normal job still waits.
    smallA.gates[0].resolve('a');
    assert.equal(await smallA.settled, 'a');
    await flush();
    assert.deepEqual(starts, ['bigA', 'bigB', 'smallA', 'smallB']);

    // A normal slot frees while the lane is busy: the normal job takes it (two normal + one lane).
    bigA.gates[0].resolve();
    await bigA.settled;
    await flush();
    assert.deepEqual(starts, ['bigA', 'bigB', 'smallA', 'smallB', 'bigC']);
    status = queue.getQueueStatus();
    assert.equal(status.activeJobs, 3);
    assert.equal(status.queueLength, 0);

    // Never more than one lane job: a third small job waits although it is eligible.
    const smallC = enqueue(queue, starts, 'smallC', { fastLane: true });
    await flush();
    assert.equal(starts.includes('smallC'), false);
    smallB.gates[0].resolve();
    await smallB.settled;
    await flush();
    assert.equal(starts.at(-1), 'smallC');
    for (const job of [bigB, bigC, smallC]) job.gates[0].resolve();
    await Promise.all([bigB.settled, bigC.settled, smallC.settled]);
    assert.equal(queue.getQueueStatus().activeJobs, 0);
    assert.equal(queue.getQueueStatus().fastLaneActive, false);
});

test('a small job takes a free normal slot like any job and then is not the lane job', async () => {
    const { queue, events } = createQueue();
    const starts = [];
    const small = enqueue(queue, starts, 'small', { fastLane: true });
    const bigA = enqueue(queue, starts, 'bigA');
    const bigB = enqueue(queue, starts, 'bigB');
    const smallB = enqueue(queue, starts, 'smallB', { fastLane: true });
    await flush();
    // small holds a normal slot, bigA the other; smallB uses the lane, bigB waits.
    assert.deepEqual(starts, ['small', 'bigA', 'smallB']);
    assert.equal(events.filter((entry) => entry.name === 'queue.fast_lane').length, 1);
    small.gates[0].resolve();
    await small.settled;
    await flush();
    assert.deepEqual(starts, ['small', 'bigA', 'smallB', 'bigB']);
    for (const job of [bigA, bigB, smallB]) job.gates[0].resolve();
    await Promise.all([bigA.settled, bigB.settled, smallB.settled]);
});

test('synchronous small jobs enter the lane before asynchronous ones', async () => {
    const { queue } = createQueue({ maxConcurrent: 1 });
    const starts = [];
    const big = enqueue(queue, starts, 'big');
    const lane = enqueue(queue, starts, 'lane', { fastLane: true });
    const asyncSmall = enqueue(queue, starts, 'asyncSmall', { fastLane: true, ignoreQueueWait: true });
    const syncSmall = enqueue(queue, starts, 'syncSmall', { fastLane: true });
    await flush();
    assert.deepEqual(starts, ['big', 'lane']);
    lane.gates[0].resolve();
    await lane.settled;
    await flush();
    assert.deepEqual(starts, ['big', 'lane', 'syncSmall']);
    for (const job of [big, syncSmall]) job.gates[0].resolve();
    await Promise.all([big.settled, syncSmall.settled]);
    await flush();
    asyncSmall.gates[0].resolve();
    await asyncSmall.settled;
});

test('without the lane (absent or disabled) a small job waits like any other', async () => {
    for (const fastLane of [undefined, { enabled: false }]) {
        const { queue, events } = createQueue({ fastLane });
        const starts = [];
        const bigA = enqueue(queue, starts, 'bigA');
        const bigB = enqueue(queue, starts, 'bigB');
        const small = enqueue(queue, starts, 'small', { fastLane: true });
        await flush();
        assert.deepEqual(starts, ['bigA', 'bigB']);
        assert.equal(queue.getQueueStatus().fastLaneEnabled, false);
        assert.equal(events.some((entry) => entry.name === 'queue.fast_lane'), false);
        bigA.gates[0].resolve();
        await bigA.settled;
        await flush();
        assert.deepEqual(starts, ['bigA', 'bigB', 'small']);
        for (const job of [bigB, small]) job.gates[0].resolve();
        await Promise.all([bigB.settled, small.settled]);
    }
});

test('a solo hold starts no lane job and is granted only after a running lane job settles', async () => {
    const { queue } = createQueue();
    const starts = [];
    let admission;
    const holder = controlled('holder', starts);
    holder.settled = queue.enqueueSliceJob(holder.task, { queueKey: 'shop', onAdmitted: (value) => { admission = value; } });
    const big = enqueue(queue, starts, 'big');
    const lane = enqueue(queue, starts, 'lane', { fastLane: true });
    await flush();
    assert.deepEqual(starts, ['holder', 'big', 'lane']);
    let granted = false;
    const solo = admission.awaitSolo().then(() => { granted = true; });
    const waiting = enqueue(queue, starts, 'waiting', { fastLane: true });
    big.gates[0].resolve();
    await big.settled;
    await flush();
    assert.equal(granted, false, 'the lane job still runs');
    assert.equal(starts.includes('waiting'), false);
    lane.gates[0].resolve();
    await lane.settled;
    await solo;
    assert.equal(granted, true);
    await flush();
    assert.equal(starts.includes('waiting'), false, 'nothing starts during the hold');
    holder.gates[0].resolve();
    await holder.settled;
    await flush();
    assert.equal(starts.at(-1), 'waiting');
    waiting.gates[0].resolve();
    await waiting.settled;
});

test('an aborted lane job frees the lane and shutdown aborts it with the rest', async () => {
    const { queue } = createQueue({ maxConcurrent: 1 });
    const starts = [];
    const big = enqueue(queue, starts, 'big');
    const controller = new AbortController();
    const lane = enqueue(queue, starts, 'lane', { fastLane: true, signal: controller.signal });
    const next = enqueue(queue, starts, 'next', { fastLane: true });
    await flush();
    controller.abort();
    await assert.rejects(lane.settled);
    await flush();
    assert.deepEqual(starts, ['big', 'lane', 'next']);
    const drained = queue.beginSliceQueueShutdown();
    await assert.rejects(next.settled);
    await assert.rejects(big.settled);
    await drained;
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});

test('the policy: default on at 50 000 binary triangles, off by switch, bounded size', () => {
    assert.equal(FAST_LANE_DEFAULT_MAX_BYTES, 2_500_084);
    assert.deepEqual({ ...resolveFastLanePolicy({}) }, { enabled: true, maxBytes: 2_500_084, maxJobs: 1 });
    assert.equal(resolveFastLanePolicy({ SLICE_FAST_LANE: 'off' }).enabled, false);
    assert.equal(resolveFastLanePolicy({ SLICE_FAST_LANE: ' OFF ' }).enabled, false);
    assert.equal(resolveFastLanePolicy({ SLICE_FAST_LANE: 'on' }).enabled, true);
    assert.equal(resolveFastLanePolicy({ SLICE_FAST_LANE_MAX_BYTES: '1000084' }).maxBytes, 1_000_084);
    for (const bad of ['0', '83', '-5', '1e6', '16777217', '0x10', ' ', '12.5']) {
        assert.equal(resolveFastLanePolicy({ SLICE_FAST_LANE_MAX_BYTES: bad }).maxBytes, 2_500_084, bad);
    }
    assert.equal(typeof FAST_LANE_POLICY.enabled, 'boolean');
});

test('eligibility: a small .stl upload in the model field, nothing else', () => {
    const policy = { enabled: true, maxBytes: 2_500_084 };
    const file = (originalname, size, fieldname = 'choosenFile') => ({ file: { originalname, size, fieldname } });
    assert.equal(isFastLaneUpload(file('cube.stl', 684), policy), true);
    assert.equal(isFastLaneUpload(file('CUBE.STL', 2_500_084), policy), true);
    assert.equal(isFastLaneUpload(file('cube.stl', 2_500_085), policy), false);
    assert.equal(isFastLaneUpload(file('cube.stl', 0), policy), false);
    assert.equal(isFastLaneUpload(file('cube.stl', Number.NaN), policy), false);
    for (const name of ['part.3mf', 'part.step', 'part.obj', 'part.ply', 'part.zip', 'part.stl.zip', 'stl']) {
        assert.equal(isFastLaneUpload(file(name, 684), policy), false, name);
    }
    assert.equal(isFastLaneUpload(file('cube.stl', 684, 'other'), policy), false);
    assert.equal(isFastLaneUpload({}, policy), false);
    assert.equal(isFastLaneUpload(file('cube.stl', 684), { enabled: false, maxBytes: 2_500_084 }), false);
});

test('a native step is named by a bounded label, never by a path or a value', () => {
    assert.equal(nativeKind(['/app/inspect_mesh.py', '/data/x.stl']), 'inspect_mesh');
    assert.equal(nativeKind(['/app/inspect_mesh.py', '/data/x.stl', '--prior', '{}']), 'inspect_mesh');
    assert.equal(nativeKind(['/app/inspect_mesh.py', '--3mf-scope', '/data/x.3mf']), 'inspect_mesh_3mf_scope');
    assert.equal(nativeKind(['C:\\app\\orient.py', 'a', 'b']), 'orient');
    assert.equal(nativeKind(['/app/scale_model.py']), 'scale_model');
    assert.equal(nativeKind(['/app/mesh2stl.py']), 'mesh2stl');
    assert.equal(nativeKind(['--orient', '1', '--arrange', '0', '--export-stl', '--outputdir', '/x']), 'engine_reference_pose');
    assert.equal(nativeKind(['--slice', '0', '/secret/path.stl']), 'engine');
    assert.equal(nativeKind(['/app/Weird Name!.py']), 'engine');
    assert.equal(nativeKind(undefined), 'engine');
    for (const args of [['/app/inspect_mesh.py'], ['--slice'], []]) assert.match(nativeKind(args), /^[a-z0-9_]+$/);
});

test('the prior handed to a later inspection is the digest and the facts it stands for, nothing else', () => {
    assert.deepEqual(priorInspectionArguments(null), []);
    assert.deepEqual(priorInspectionArguments({ watertight: true }), []);
    assert.deepEqual(priorInspectionArguments({ topology_sha256: 'zz' }), []);
    const inspection = { schema: 'r3d-mesh-inspection-v2', valid: true, watertight: true, winding_consistent: true,
        component_count: 2, closed_component_count: 2, open_edge_count: 0, dropped_degenerate_faces: 0,
        dropped_duplicate_faces: 0, volume_mm3: 12.5, volume_source: 'validated_triangle_mesh',
        dimensions_mm: { x: 1, y: 2, z: 3 }, triangle_count: 24, topology_sha256: 'a'.repeat(64),
        topology_evidence: 'measured' };
    const args = priorInspectionArguments(inspection);
    assert.equal(args[0], '--prior');
    assert.deepEqual(JSON.parse(args[1]), { schema: 'r3d-mesh-inspection-v2', valid: true, topology_sha256: 'a'.repeat(64),
        watertight: true, winding_consistent: true, open_edge_count: 0, component_count: 2, closed_component_count: 2 });
});
