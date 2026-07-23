'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slicer-output-'));
    const jobsRoot = path.join(root, 'input', '.slice-jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot, { recursive: true });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, jobsRoot, outputRoot };
}

test('exclusive output ownership cleans promoted candidate but release preserves it', async (t) => {
    const dirs = await fixture(t);
    const neighbor = path.join(dirs.outputRoot, 'neighbor.gcode');
    await fs.writeFile(neighbor, 'foreign');
    const ws = await createJobWorkspace(dirs);
    const candidate = await ws.registerOutputCandidate('model.stl', 'FDM');
    const source = ws.resolvePath('result.gcode');
    await fs.writeFile(source, 'result');
    await ws.promoteOutputCandidate(candidate, source);
    await ws.cleanup();
    await assert.rejects(fs.access(candidate));
    assert.equal(await fs.readFile(neighbor, 'utf8'), 'foreign');

    const ws2 = await createJobWorkspace(dirs);
    const kept = await ws2.registerOutputCandidate('kept.stl', 'FDM');
    const source2 = ws2.resolvePath('result.gcode');
    await fs.writeFile(source2, 'kept');
    await ws2.promoteOutputCandidate(kept, source2);
    await ws2.releaseOutputCandidate(kept);
    await ws2.cleanup();
    assert.equal(await fs.readFile(kept, 'utf8'), 'kept');
});

test('registration rejects existing generated output and unsafe technology-derived nesting', async (t) => {
    const dirs = await fixture(t);
    const artifactId = 'artifact-11111111111111111111111111111111';
    await fs.writeFile(path.join(dirs.outputRoot, `taken-output-${artifactId}.gcode`), 'foreign');
    const ws = await createJobWorkspace({ ...dirs, artifactIdFactory: () => artifactId });
    await assert.rejects(ws.registerOutputCandidate('taken.stl', 'FDM'), /exists/);
    await ws.cleanup();
});

test('external registration remains a direct generated child and rejects existing directories or links', async (t) => {
    const dirs = await fixture(t);
    const identifiers = [
        'artifact-22222222222222222222222222222222',
        'artifact-33333333333333333333333333333333',
        'artifact-44444444444444444444444444444444'
    ];
    const ws = await createJobWorkspace({ ...dirs, artifactIdFactory: () => identifiers.shift() });

    const candidate = await ws.registerOutputCandidate('../../nested/evil.stl', 'FDM');
    assert.equal(path.dirname(candidate), path.resolve(dirs.outputRoot));
    assert.equal(path.basename(candidate), 'evil-output-artifact-22222222222222222222222222222222.gcode');

    const occupied = path.join(dirs.outputRoot, 'directory-output-artifact-33333333333333333333333333333333.gcode');
    await fs.mkdir(occupied);
    await assert.rejects(ws.registerOutputCandidate('directory.stl', 'FDM'), /exists/);

    const outside = path.join(dirs.root, 'outside-directory');
    const linked = path.join(dirs.outputRoot, 'linked-output-artifact-44444444444444444444444444444444.gcode');
    await fs.mkdir(outside);
    try {
        await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(ws.registerOutputCandidate('linked.stl', 'FDM'), /exists/);
    } catch (error) {
        if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }

    await ws.cleanup();
    await fs.access(dirs.outputRoot);
    await fs.access(outside);
});

test('promotion owns an exclusively created candidate even when post-copy inspection fails', async (t) => {
    const dirs = await fixture(t);
    const ws = await createJobWorkspace({
        ...dirs,
        inspectOutputCandidate: async () => { throw new Error('synthetic inspection failure'); }
    });
    const candidate = await ws.registerOutputCandidate('inspection.stl', 'FDM');
    const source = ws.resolvePath('result.gcode');
    await fs.writeFile(source, 'generated');

    await assert.rejects(ws.promoteOutputCandidate(candidate, source), /inspection failure/);
    await fs.access(candidate);
    await ws.cleanup();
    await assert.rejects(fs.access(candidate));
    await assert.rejects(fs.access(ws.directory));
});

test('one external candidate cleanup failure does not strand the owned workspace', async (t) => {
    const dirs = await fixture(t);
    const ws = await createJobWorkspace({
        ...dirs,
        removeOutputCandidate: async () => { throw new Error('synthetic removal failure'); }
    });
    const candidate = await ws.registerOutputCandidate('cleanup.stl', 'FDM');
    const source = ws.resolvePath('result.gcode');
    await fs.writeFile(source, 'generated');
    await ws.promoteOutputCandidate(candidate, source);

    await assert.rejects(ws.cleanup(), /cleanup was incomplete/);
    await assert.rejects(fs.access(ws.directory));
    assert.equal(await fs.readFile(candidate, 'utf8'), 'generated');
});

test('registration rejects an unsafe output-root junction', async (t) => {
    const dirs = await fixture(t);
    const unsafeRoot = path.join(dirs.root, 'unsafe-output-root');
    const outside = path.join(dirs.root, 'outside-output');
    await fs.rm(dirs.outputRoot, { recursive: true });
    await fs.mkdir(outside);
    try {
        await fs.symlink(outside, unsafeRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink creation unavailable: ${error.code || 'unknown'}`);
        return;
    }
    const ws = await createJobWorkspace({ jobsRoot: dirs.jobsRoot, outputRoot: unsafeRoot });
    await assert.rejects(ws.registerOutputCandidate('unsafe.stl', 'FDM'), /Unsafe output root/);
    await ws.cleanup();
    await fs.access(outside);
});

test('promotion never adopts or deletes a foreign file created after registration', async (t) => {
    const dirs = await fixture(t);
    const ws = await createJobWorkspace(dirs);
    const candidate = await ws.registerOutputCandidate('race.stl', 'FDM');
    const source = ws.resolvePath('generated.gcode');
    await fs.writeFile(source, 'owned source');
    await fs.writeFile(candidate, 'foreign winner', { flag: 'wx' });

    await assert.rejects(ws.promoteOutputCandidate(candidate, source));
    await ws.cleanup();
    assert.equal(await fs.readFile(candidate, 'utf8'), 'foreign winner');
});

test('post-copy symlink replacement is never deleted or followed by cleanup', async (t) => {
    const dirs = await fixture(t);
    const outside = path.join(dirs.root, 'replacement-target');
    const sentinel = path.join(outside, 'sentinel.txt');
    await fs.mkdir(outside);
    await fs.writeFile(sentinel, 'foreign');
    let linkSupported = true;
    const ws = await createJobWorkspace({
        ...dirs,
        inspectOutputCandidate: async (candidate) => {
            await fs.rm(candidate);
            try {
                await fs.symlink(outside, candidate, process.platform === 'win32' ? 'junction' : 'dir');
            } catch (error) {
                linkSupported = false;
                throw error;
            }
            return fs.lstat(candidate);
        }
    });
    const candidate = await ws.registerOutputCandidate('replacement.stl', 'FDM');
    const source = ws.resolvePath('generated.gcode');
    await fs.writeFile(source, 'owned');
    await assert.rejects(ws.promoteOutputCandidate(candidate, source));
    if (!linkSupported) {
        t.skip('symlink creation unavailable');
        await ws.cleanup();
        return;
    }
    await assert.rejects(ws.cleanup(), /cleanup was incomplete/);
    assert.equal((await fs.lstat(candidate)).isSymbolicLink(), true);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'foreign');
    await assert.rejects(fs.access(ws.directory));
});

test('post-promotion regular-file replacement is neither released nor deleted', async (t) => {
    const dirs = await fixture(t);
    const ws = await createJobWorkspace(dirs);
    const candidate = await ws.registerOutputCandidate('regular-replacement.stl', 'FDM');
    const source = ws.resolvePath('generated.gcode');
    await fs.writeFile(source, 'owned');
    await ws.promoteOutputCandidate(candidate, source);
    try {
        await fs.rm(candidate);
    } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EBUSY') {
            t.skip('platform prevents replacement while the identity handle is open');
            await ws.cleanup();
            return;
        }
        throw error;
    }
    await fs.writeFile(candidate, 'foreign replacement', { flag: 'wx' });

    await assert.rejects(ws.releaseOutputCandidate(candidate), /Unsafe output candidate/);
    await assert.rejects(ws.cleanup(), /cleanup was incomplete/);
    assert.equal(await fs.readFile(candidate, 'utf8'), 'foreign replacement');
    await assert.rejects(fs.access(ws.directory));
});
