'use strict';

/** T-RET (3.9.0): cleanup budgets per phase and the sweep verdict. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { retention } = require('../../../app/config/release-policy');
const { cleanupManagedArtifacts, SWEEP_PHASE } = require('../../../app/services/artifact-store');
const { createManagedArtifact, createOutputRoot, exists } = require('./helpers/managed-artifact-fixture');

const { setEventWriter } = require('../../../app/services/observability/events');

const NOW = 1_800_000_000_000;
test.before(() => setEventWriter(() => {}));
test.after(() => setEventWriter((entry) => console.info(JSON.stringify(entry))));

/** A clock that moves `stepMs` on every read. */
function steppingClock(stepMs, start = NOW) {
    let current = start - stepMs;
    return () => {
        current += stepMs;
        return current;
    };
}

test('the sweep phase is the only one with the sweep budget; the default keeps STARTUP_CLEANUP_MAX_MS', async (t) => {
    const outputRoot = await createOutputRoot(t);
    for (let index = 1; index <= 6; index += 1) await createManagedArtifact(outputRoot, index, NOW - 1_000);
    const resourcePolicy = resolveResourcePolicy({});
    assert.equal(resourcePolicy.STARTUP_CLEANUP_MAX_MS, 1_000);
    assert.equal(retention.ARTIFACT_SWEEP_MAX_MS, 10_000, 'release-policy default');

    // Each clock read moves 400 ms: the 3.8.3 budget of 1 s ends the scan early.
    const postSlice = await cleanupManagedArtifacts({ outputRoot, resourcePolicy, clock: steppingClock(400) });
    assert.equal(postSlice.scanComplete, false);
    assert.equal(postSlice.verdict, 'incomplete');
    assert.equal(postSlice.quotaSatisfied, false, 'quotaSatisfied keeps its 3.8.3 meaning');
    assert.ok(postSlice.inspected < 6);

    const unknownPhase = await cleanupManagedArtifacts({
        outputRoot, resourcePolicy, clock: steppingClock(400), phase: 'startup'
    });
    assert.equal(unknownPhase.verdict, 'incomplete', 'only the exact sweep phase widens the budget');

    // The same clock under the sweep budget (10 s) inspects every marker.
    const sweep = await cleanupManagedArtifacts({
        outputRoot, resourcePolicy, clock: steppingClock(400), phase: SWEEP_PHASE
    });
    assert.equal(sweep.scanComplete, true);
    assert.equal(sweep.inspected, 6);
    assert.equal(sweep.verdict, 'satisfied');
    assert.equal(sweep.quotaSatisfied, true);

    const short = await cleanupManagedArtifacts({
        outputRoot, resourcePolicy, clock: steppingClock(400), phase: SWEEP_PHASE, sweepMaxMs: 1_000
    });
    assert.equal(short.verdict, 'incomplete', 'the sweep budget is ARTIFACT_SWEEP_MAX_MS, not unbounded');
});

test('501 artifacts within the TTL: the default scan is incomplete, the sweep keeps 500 and is satisfied', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const created = [];
    for (let index = 1; index <= 501; index += 1) {
        created.push(await createManagedArtifact(outputRoot, index, NOW - 10_000 + index));
    }
    const resourcePolicy = resolveResourcePolicy({});
    const clock = () => NOW;

    const postSlice = await cleanupManagedArtifacts({ outputRoot, resourcePolicy, clock });
    assert.equal(postSlice.inspected, resourcePolicy.STARTUP_CLEANUP_MAX_ENTRIES);
    assert.equal(postSlice.verdict, 'incomplete');
    assert.equal(postSlice.removedArtifacts, 0, 'an incomplete default scan evicts nothing it did not see as over quota');

    const sweep = await cleanupManagedArtifacts({ outputRoot, resourcePolicy, clock, phase: SWEEP_PHASE });
    assert.equal(sweep.inspected, 501, 'scan cap max(2 x 500 + 64, 500) = 1064');
    assert.equal(sweep.removedArtifacts, 1);
    assert.equal(sweep.retainedCount, 500);
    assert.equal(sweep.verdict, 'satisfied');
    assert.equal(sweep.quotaSatisfied, true);
    assert.equal(await exists(created[0].artifactPath), false, 'the oldest went first');
    assert.equal(await exists(created[0].markerPath), false);
    assert.equal(await exists(created[500].artifactPath), true);
});

test('a complete scan with a failed eviction is exceeded; TTL eviction still works under the sweep phase', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const resourcePolicy = { ...resolveResourcePolicy({}), MAX_MANAGED_ARTIFACTS: 1 };
    await createManagedArtifact(outputRoot, 1, NOW - 2_000);
    await createManagedArtifact(outputRoot, 2, NOW - 1_000);
    const failing = await cleanupManagedArtifacts({
        outputRoot, resourcePolicy, clock: () => NOW, phase: SWEEP_PHASE,
        removeFile: async () => { throw new Error('EIO'); }
    });
    assert.equal(failing.scanComplete, true);
    assert.equal(failing.failed, 1);
    assert.equal(failing.verdict, 'exceeded');

    const expired = await createManagedArtifact(outputRoot, 3, NOW - resourcePolicy.ARTIFACT_TTL_MS - 1);
    const ok = await cleanupManagedArtifacts({ outputRoot, resourcePolicy, clock: () => NOW, phase: SWEEP_PHASE });
    assert.equal(ok.verdict, 'satisfied');
    assert.equal(await exists(expired.artifactPath), false);
    assert.equal(ok.retainedCount, 1);
});

test('the live 1 h TTL: an artifact older than ARTIFACT_TTL_MS=3600000 is evicted by any sweep', async (t) => {
    const outputRoot = await createOutputRoot(t);
    const resourcePolicy = resolveResourcePolicy({ ARTIFACT_TTL_MS: '3600000' });
    const old = await createManagedArtifact(outputRoot, 1, NOW - 3_600_001);
    const young = await createManagedArtifact(outputRoot, 2, NOW - 3_599_000);
    const summary = await cleanupManagedArtifacts({ outputRoot, resourcePolicy, clock: () => NOW });
    assert.equal(summary.verdict, 'satisfied');
    assert.equal(await exists(old.artifactPath), false);
    assert.equal(await exists(young.artifactPath), true);
    await fs.access(young.markerPath);
});
