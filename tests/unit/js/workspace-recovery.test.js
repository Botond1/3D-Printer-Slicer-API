'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJobWorkspace, auditStaleWorkspaces, MARKER_NAME, resolveWorkspaceStaleAgeMs } = require('../../../app/services/slice/workspace');
const { loadCommonJsFromSource } = require('./helpers/load-commonjs-from-source');

const WORKSPACE_MODULE_PATH = path.resolve(__dirname, '../../../app/services/slice/workspace.js');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slicer-recovery-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot, { recursive: true });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, jobsRoot, outputRoot };
}

test('resolver is bounded and audit-only leaves stale, fresh, and unmarked entries', async (t) => {
    const dirs = await fixture(t);
    const now = 2_000_000;
    const stale = await createJobWorkspace({ ...dirs, clock: () => now - 120_001 });
    const fresh = await createJobWorkspace({ ...dirs, clock: () => now - 10_000 });
    const unmarked = path.join(dirs.jobsRoot, 'job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await fs.mkdir(unmarked);
    const result = await auditStaleWorkspaces({ ...dirs, clock: () => now, staleAgeMs: 60_000 });
    assert.deepEqual(result, { inspected: 3, stale: 1, removed: 0, skipped: 2, failed: 0 });
    await Promise.all([fs.access(stale.directory), fs.access(fresh.directory), fs.access(unmarked)]);
    assert.equal(resolveWorkspaceStaleAgeMs(1), 24 * 60 * 60 * 1000);
});

test('deletion needs async exclusive lease and lifetime safety margin', async (t) => {
    const dirs = await fixture(t);
    const now = 5_000_000;
    const unsafe = await createJobWorkspace({ ...dirs, clock: () => now - 200_000 });
    let result = await auditStaleWorkspaces({ ...dirs, clock: () => now, staleAgeMs: 120_000, delete: true, boundedLifetimeMs: 60_001, verifyExclusiveLease: async () => true });
    assert.equal(result.removed, 0);
    await fs.access(unsafe.directory);
    result = await auditStaleWorkspaces({ ...dirs, clock: () => now, staleAgeMs: 120_001, delete: true, boundedLifetimeMs: 60_000, verifyExclusiveLease: async () => true });
    assert.equal(result.removed, 1);
    await assert.rejects(fs.access(unsafe.directory));
});

test('malformed marker and symlink are never accepted as stale', async (t) => {
    const dirs = await fixture(t);
    await fs.mkdir(dirs.jobsRoot, { recursive: true });
    const malformed = path.join(dirs.jobsRoot, 'job-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    await fs.mkdir(malformed);
    await fs.writeFile(path.join(malformed, MARKER_NAME), '{bad');
    const outside = path.join(dirs.root, 'outside');
    await fs.mkdir(outside);
    const link = path.join(dirs.jobsRoot, 'job-cccccccccccccccccccccccccccccccc');
    try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch { return; }
    const result = await auditStaleWorkspaces({ ...dirs, clock: () => 9_000_000, staleAgeMs: 60_000, delete: true, boundedLifetimeMs: 0, verifyExclusiveLease: async () => true });
    assert.equal(result.removed, 0);
    await fs.access(outside);
    await fs.access(malformed);
});

test('one stale-entry deletion failure is sanitized and does not stop later entries', async (t) => {
    const dirs = await fixture(t);
    const now = 10_000_000;
    const first = await createJobWorkspace({ ...dirs, clock: () => now - 180_000 });
    const second = await createJobWorkspace({ ...dirs, clock: () => now - 180_000 });
    const warnings = [];
    const removeWorkspace = async (directory) => {
        if (directory === first.directory) throw new Error(`private path: ${directory}`);
        await fs.rm(directory, { recursive: true });
    };

    const result = await auditStaleWorkspaces({
        ...dirs,
        clock: () => now,
        staleAgeMs: 120_000,
        delete: true,
        boundedLifetimeMs: 60_000,
        verifyExclusiveLease: async () => true,
        removeWorkspace,
        logger: { warn(message, metadata) { warnings.push({ message, metadata }); } }
    });

    assert.deepEqual(result, { inspected: 2, stale: 2, removed: 1, skipped: 0, failed: 1 });
    await fs.access(first.directory);
    await assert.rejects(fs.access(second.directory));
    assert.equal(warnings.length, 1);
    assert.deepEqual(Object.keys(warnings[0].metadata), ['jobId']);
    assert.doesNotMatch(JSON.stringify(warnings), /private path/);
});

test('audit rejects a symlinked workspace root without scanning or deleting its target', async (t) => {
    const dirs = await fixture(t);
    const outsideJobs = path.join(dirs.root, 'outside-jobs');
    const linkedJobs = path.join(dirs.root, 'linked-jobs');
    const markedName = 'job-dddddddddddddddddddddddddddddddd';
    const marked = path.join(outsideJobs, markedName);
    await fs.mkdir(marked, { recursive: true });
    await fs.writeFile(path.join(marked, MARKER_NAME), JSON.stringify({
        version: 1,
        id: markedName,
        createdAt: 1
    }));
    try {
        await fs.symlink(outsideJobs, linkedJobs, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink creation unavailable: ${error.code || 'unknown'}`);
        return;
    }

    await assert.rejects(
        auditStaleWorkspaces({
            jobsRoot: linkedJobs,
            clock: () => 1_000_000,
            staleAgeMs: 60_000,
            delete: true,
            boundedLifetimeMs: 0,
            verifyExclusiveLease: async () => true
        }),
        /Unsafe job workspace root/
    );
    await fs.access(marked);
});

test('mutation proof rejects stale audit variants that accept unmarked or fresh entries', async (t) => {
    const dirs = await fixture(t);
    const now = 12_000_000;
    const fresh = await createJobWorkspace({ ...dirs, clock: () => now - 1_000 });
    const unmarked = path.join(dirs.jobsRoot, 'job-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    await fs.mkdir(unmarked);
    const expected = { inspected: 2, stale: 0, removed: 0, skipped: 2, failed: 0 };
    assert.deepEqual(await auditStaleWorkspaces({ ...dirs, clock: () => now, staleAgeMs: 60_000 }), expected);

    const source = await fs.readFile(WORKSPACE_MODULE_PATH, 'utf8');
    const unmarkedVariant = source.replace(
        'if (!marker || (!deleteEveryMarked && now - marker.createdAt <= staleAgeMs)) {',
        'if (marker && (!deleteEveryMarked && now - marker.createdAt <= staleAgeMs)) {'
    );
    const freshVariant = source.replace(
        'now - marker.createdAt <= staleAgeMs',
        'now - marker.createdAt <= -1'
    );
    assert.notEqual(unmarkedVariant, source);
    assert.notEqual(freshVariant, source);

    for (const variant of [unmarkedVariant, freshVariant]) {
        const mutated = loadCommonJsFromSource(WORKSPACE_MODULE_PATH, variant);
        const result = await mutated.auditStaleWorkspaces({ ...dirs, clock: () => now, staleAgeMs: 60_000 });
        assert.throws(() => assert.deepEqual(result, expected));
    }
    await fs.access(fresh.directory);
    await fs.access(unmarked);
});
