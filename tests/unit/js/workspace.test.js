'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
    MARKER_NAME, MARKER_VERSION, createJobWorkspace,
    attachWorkspaceToRequest, getRequestWorkspace, detachWorkspaceFromRequest
} = require('../../../app/services/slice/workspace');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slicer-ws-'));
    const jobsRoot = path.join(root, 'input', '.slice-jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot, { recursive: true });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, jobsRoot, outputRoot };
}

test('creates unique marked workspaces and exposes request seam', async (t) => {
    const dirs = await fixture(t);
    const first = await createJobWorkspace(dirs);
    const second = await createJobWorkspace(dirs);
    assert.notEqual(first.id, second.id);
    const marker = JSON.parse(await fs.readFile(path.join(first.directory, MARKER_NAME)));
    assert.equal(marker.version, MARKER_VERSION);
    const req = {};
    attachWorkspaceToRequest(req, first);
    assert.equal(getRequestWorkspace(req), first);
    assert.equal(detachWorkspaceFromRequest(req), first);
    assert.equal(getRequestWorkspace(req), null);
    await Promise.all([first.cleanup(), second.cleanup()]);
});

test('segment containment defeats naive-prefix mutation and cleanup is idempotent', async (t) => {
    const dirs = await fixture(t);
    const ws = await createJobWorkspace(dirs);
    assert.throws(() => ws.assertContainedPath(`${ws.directory}-evil/file.stl`), /outside/);
    assert.throws(() => ws.resolvePath('..', 'foreign'), /outside/);
    const local = await ws.createUniquePath('.stl');
    await fs.writeFile(local, 'solid x');
    await Promise.all([ws.cleanup('done'), ws.cleanup('again')]);
    await assert.rejects(fs.access(ws.directory));
    await fs.access(dirs.jobsRoot);
    await fs.access(dirs.outputRoot);
});

test('contained paths reject an intermediate junction and cleanup never follows it', async (t) => {
    const dirs = await fixture(t);
    const ws = await createJobWorkspace(dirs);
    const outside = path.join(dirs.root, 'outside');
    const sentinel = path.join(outside, 'sentinel.txt');
    await fs.mkdir(outside);
    await fs.writeFile(sentinel, 'foreign');
    const link = ws.resolvePath('link-before-creation');
    try {
        await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink creation unavailable: ${error.code || 'unknown'}`);
        await ws.cleanup();
        return;
    }

    assert.throws(() => ws.assertContainedPath(path.join(link, 'escaped.stl')), /Symlink paths/);
    await ws.cleanup();
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'foreign');
});
