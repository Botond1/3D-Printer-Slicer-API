'use strict';

/** T-RET (3.9.0): a completed job's DELETE removes its artifact; the pending-delete set. */

const test = require('node:test');
const assert = require('node:assert/strict');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { acquireArtifactLease } = require('../../../app/services/artifact-leases');
const {
    cleanupManagedArtifacts,
    deleteArtifact,
    listPendingArtifactDeletions,
    resetPendingArtifactDeletionsForTests,
    LOST_LEASE_MS,
    PENDING_WATCH_MAX_FAILURES,
    SWEEP_PHASE
} = require('../../../app/services/artifact-store');
const { setEventWriter } = require('../../../app/services/observability/events');
const { createManagedArtifact, createOutputRoot, exists } = require('./helpers/managed-artifact-fixture');
const { createAsyncHarness } = require('./helpers/async-slice-harness');

const NOW = Date.now();
const events = [];

test.beforeEach(() => {
    events.length = 0;
    setEventWriter((entry) => events.push(entry));
    resetPendingArtifactDeletionsForTests(10);
});
test.after(() => {
    resetPendingArtifactDeletionsForTests();
    setEventWriter((entry) => console.info(JSON.stringify(entry)));
});

async function waitFor(predicate, timeoutMs = 5_000) {
    const started = Date.now();
    while (!(await predicate())) {
        if (Date.now() - started > timeoutMs) throw new Error('Condition was not met in time.');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test('an unleased artifact and its sidecar are deleted at once with an artifact.cleanup reason=deleted event', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const artifact = await createManagedArtifact(outputRoot, 1, NOW);
    const keep = await createManagedArtifact(outputRoot, 2, NOW);
    assert.deepEqual(await deleteArtifact(artifact.artifactId, { outputRoot }), { state: 'deleted', bytes: 6 });
    assert.equal(await exists(artifact.artifactPath), false);
    assert.equal(await exists(artifact.markerPath), false);
    assert.equal(await exists(keep.artifactPath), true, 'only the named artifact is removed');
    assert.deepEqual(listPendingArtifactDeletions(), []);
    const event = events.find((entry) => entry.event === 'artifact.cleanup' && entry.artifact_id === artifact.artifactId);
    assert.equal(event.outcome, 'success');
    assert.deepEqual(event.extra, { reason: 'deleted' });
    assert.deepEqual(await deleteArtifact(artifact.artifactId, { outputRoot }), { state: 'absent' });
    assert.deepEqual(await deleteArtifact('artifact-../x', { outputRoot }), { state: 'invalid' });
    assert.deepEqual(await deleteArtifact(undefined, { outputRoot }), { state: 'invalid' });
});

test('a leased artifact is marked pending and is gone as soon as the last lease is released', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const artifact = await createManagedArtifact(outputRoot, 3, NOW);
    const first = acquireArtifactLease([artifact.realPath]);
    const second = acquireArtifactLease([artifact.realPath]);
    assert.deepEqual(await deleteArtifact(artifact.artifactId, { outputRoot }), { state: 'pending' });
    assert.deepEqual(listPendingArtifactDeletions(), [artifact.artifactId]);
    assert.equal(await exists(artifact.artifactPath), true, 'never deleted under an active download');

    // Ordinary sweeps (post-slice, startup) wait for the release.
    await cleanupManagedArtifacts({ outputRoot, clock: () => NOW });
    assert.equal(await exists(artifact.artifactPath), true);
    first.release();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(await exists(artifact.artifactPath), true, 'one lease still holds it');
    second.release();
    await waitFor(async () => !(await exists(artifact.markerPath)) && listPendingArtifactDeletions().length === 0);
    assert.equal(await exists(artifact.artifactPath), false);
    assert.equal(await exists(artifact.markerPath), false);
    assert.deepEqual(listPendingArtifactDeletions(), []);
});

test('a lease whose release is never called: the first periodic sweep after the lost-lease age removes it far below the TTL', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const artifact = await createManagedArtifact(outputRoot, 4, NOW);
    acquireArtifactLease([artifact.realPath]); // never released
    assert.deepEqual(await deleteArtifact(artifact.artifactId, { outputRoot, clock: () => NOW }), { state: 'pending' });
    // A sweep while the lease may still be a live download leaves it (CONC-1).
    const early = await cleanupManagedArtifacts({ outputRoot, clock: () => NOW + 300_000, phase: SWEEP_PHASE });
    assert.equal(early.deletedPending, 0);
    assert.equal(await exists(artifact.artifactPath), true, 'a live download keeps its file');
    assert.deepEqual(listPendingArtifactDeletions(), [artifact.artifactId]);
    assert.ok(LOST_LEASE_MS < resolveResourcePolicy({ ARTIFACT_TTL_MS: '3600000' }).ARTIFACT_TTL_MS, 'below the live TTL');
    // While the overriding sweep unlinks the file no new lease can start.
    const leaseAttempts = [];
    const removeFile = async (target, options) => {
        try {
            acquireArtifactLease([artifact.realPath]).release();
            leaseAttempts.push('acquired');
        } catch (error) {
            leaseAttempts.push(error.code);
        }
        return require('node:fs/promises').rm(target, options);
    };
    const summary = await cleanupManagedArtifacts({
        outputRoot, clock: () => NOW + LOST_LEASE_MS, phase: SWEEP_PHASE, removeFile
    });
    assert.equal(summary.deletedPending, 1);
    assert.deepEqual(leaseAttempts, ['ARTIFACT_BUSY', 'ARTIFACT_BUSY']);
    assert.equal(summary.verdict, 'satisfied');
    assert.equal(await exists(artifact.artifactPath), false);
    assert.equal(await exists(artifact.markerPath), false);
    assert.deepEqual(listPendingArtifactDeletions(), []);
});

test('a released mark whose removal keeps failing: one watcher pass at a time, then left to the periodic sweep (CONC-2)', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const artifact = await createManagedArtifact(outputRoot, 7, NOW);
    let active = 0;
    let maxActive = 0;
    let attempts = 0;
    const removeFile = async () => {
        attempts += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        // Slower than several 10 ms watcher ticks.
        await new Promise((resolve) => setTimeout(resolve, 40));
        active -= 1;
        const error = new Error('read-only file system');
        error.code = 'EROFS';
        throw error;
    };
    const lease = acquireArtifactLease([artifact.realPath]);
    assert.deepEqual(await deleteArtifact(artifact.artifactId, { outputRoot, removeFile }), { state: 'pending' });
    lease.release();
    await waitFor(() => attempts >= PENDING_WATCH_MAX_FAILURES);
    // Well past the point where an unguarded watcher would have retried again.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(maxActive, 1, 'never two watcher passes at once');
    assert.equal(attempts, PENDING_WATCH_MAX_FAILURES, 'the watcher stops retrying after its failure budget');
    const failures = events.filter((entry) => entry.event === 'artifact.cleanup'
        && entry.artifact_id === artifact.artifactId && entry.error_code === 'ARTIFACT_CLEANUP_FAILED');
    assert.equal(failures.length, PENDING_WATCH_MAX_FAILURES);
    assert.deepEqual(listPendingArtifactDeletions(), [artifact.artifactId], 'the mark stays for the periodic sweep');
    // The periodic sweep still tries (and, with a working volume, deletes).
    const summary = await cleanupManagedArtifacts({ outputRoot, clock: () => NOW, phase: SWEEP_PHASE, removeFile: require('node:fs/promises').rm });
    assert.equal(summary.deletedPending, 1);
    assert.equal(await exists(artifact.artifactPath), false);
    assert.deepEqual(listPendingArtifactDeletions(), []);
});

test('a pending id whose file vanished is dropped by the next sweep', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const artifact = await createManagedArtifact(outputRoot, 5, NOW);
    const lease = acquireArtifactLease([artifact.realPath]);
    assert.deepEqual(await deleteArtifact(artifact.artifactId, { outputRoot }), { state: 'pending' });
    const fs = require('node:fs/promises');
    await fs.rm(artifact.artifactPath);
    await fs.rm(artifact.markerPath);
    await cleanupManagedArtifacts({ outputRoot, clock: () => NOW });
    assert.deepEqual(listPendingArtifactDeletions(), []);
    lease.release();
});

test('DELETE of a completed async job answers 204 and removes the artifact and its sidecar', async (t) => {
    let outputRoot = null;
    const harness = await createAsyncHarness(t, {
        store: { deleteArtifact: (artifactId) => deleteArtifact(artifactId, { outputRoot }) }
    });
    outputRoot = harness.dirs.outputRoot;
    const artifact = await createManagedArtifact(outputRoot, 6, NOW);
    harness.pipeline.state.answer = {
        status: 200,
        body: { success: true, slicer_engine: 'bambu', artifact_id: artifact.artifactId }
    };
    const accepted = await harness.submit();
    assert.equal(accepted.status, 202);
    const location = accepted.headers.location;
    const completed = await harness.pollCompleted(location);
    assert.equal(completed.json.result.artifact_id, artifact.artifactId);
    assert.equal(harness.store.lookup(completed.json.job_id, 'slice:shared').artifactId, artifact.artifactId);

    const deleted = await harness.cancel(location);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.text, '');
    assert.equal(deleted.headers['cache-control'], 'no-store');
    await waitFor(async () => !(await exists(artifact.markerPath)) && listPendingArtifactDeletions().length === 0);
    assert.equal(await exists(artifact.artifactPath), false);
    assert.equal(await exists(artifact.markerPath), false);
    const again = await harness.cancel(location);
    assert.equal(again.status, 404);
    assert.equal(again.json.errorCode, 'SLICE_JOB_NOT_FOUND');
    await harness.assertDrained();
});

test('DELETE of a completed job whose artifact is leased: 204, pending, removed on release', async (t) => {
    let outputRoot = null;
    const harness = await createAsyncHarness(t, {
        store: { deleteArtifact: (artifactId) => deleteArtifact(artifactId, { outputRoot }) }
    });
    outputRoot = harness.dirs.outputRoot;
    const artifact = await createManagedArtifact(outputRoot, 7, NOW);
    harness.pipeline.state.answer = { status: 200, body: { success: true, artifact_id: artifact.artifactId } };
    const location = (await harness.submit()).headers.location;
    await harness.pollCompleted(location);
    const download = acquireArtifactLease([artifact.realPath]);
    assert.equal((await harness.cancel(location)).status, 204);
    await waitFor(() => listPendingArtifactDeletions().includes(artifact.artifactId));
    assert.equal(await exists(artifact.artifactPath), true);
    download.release();
    await waitFor(async () => !(await exists(artifact.markerPath)) && listPendingArtifactDeletions().length === 0);
    assert.equal(await exists(artifact.artifactPath), false);
    assert.deepEqual(listPendingArtifactDeletions(), []);
});

test('an error result owns no artifact: DELETE stays 204 and deletes nothing', async (t) => {
    const calls = [];
    const harness = await createAsyncHarness(t, { store: { deleteArtifact: (id) => { calls.push(id); } } });
    harness.pipeline.state.answer = {
        status: 422,
        body: { success: false, errorCode: 'UNSLICEABLE_SOURCE_GEOMETRY', artifact_id: `artifact-${'e'.repeat(32)}` }
    };
    const location = (await harness.submit()).headers.location;
    await harness.pollCompleted(location);
    assert.equal((await harness.cancel(location)).status, 204);
    assert.deepEqual(calls, []);
});

test('resource policy default stays 24 h in code; the live 1 h is env only', () => {
    assert.equal(resolveResourcePolicy({}).ARTIFACT_TTL_MS, 86_400_000);
    assert.equal(resolveResourcePolicy({ ARTIFACT_TTL_MS: '3600000' }).ARTIFACT_TTL_MS, 3_600_000);
});
