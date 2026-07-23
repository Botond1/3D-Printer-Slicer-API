'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const {
    appendOriginalExtensionToUpload,
    resolveSliceOutputTargets
} = require('../../../app/services/slice.service');
const {
    resolveConvertedPath,
    resolveOrientedPath
} = require('../../../app/services/slice/input-processing');
const { resolveTransformedPath } = require('../../../app/services/slice/transform');
const {
    createRuntimeSlicerProfile,
    resolveRuntimeProfilePath
} = require('../../../app/services/slice/profiles');
const { resolveExtractionDirectory } = require('../../../app/services/slice/zip');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 's1a-transient-'));
    const jobsRoot = path.join(root, 'input', '.slice-jobs');
    const outputRoot = path.join(root, 'output');
    const scratchRoot = path.join(root, 'tmp', 'slice-jobs');
    await fs.mkdir(outputRoot, { recursive: true });
    const workspace = await createJobWorkspace({ jobsRoot, outputRoot, scratchRoot });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, outputRoot, workspace };
}

function assertContained(workspace, candidate) {
    assert.equal(workspace.assertContainedPath(candidate), path.resolve(candidate));
}

test('every upload, preprocessing, engine, and runtime-profile path stays contained', async (t) => {
    const { workspace } = await fixture(t);
    const opaqueUpload = workspace.resolvePath('opaque-upload');
    await fs.writeFile(opaqueUpload, 'solid x');
    const upload = await appendOriginalExtensionToUpload(opaqueUpload, '.stl', workspace);

    const converted = resolveConvertedPath(workspace.resolvePath('mesh.obj'), workspace);
    const oriented = resolveOrientedPath(upload, workspace);
    const transformed = resolveTransformedPath(upload, workspace, () => '0123456789abcdef');
    const extraction = resolveExtractionDirectory(workspace);
    const profilePath = resolveRuntimeProfilePath(workspace, 'prusa-runtime', '.ini');
    const prusaTargets = await resolveSliceOutputTargets('prusa', 'normal.stl', 'FDM', workspace);
    const orcaTargets = await resolveSliceOutputTargets('orca', 'other.stl', 'FDM', workspace);

    for (const candidate of [
        upload,
        converted,
        oriented,
        transformed,
        extraction,
        prusaTargets.slicerOutputPath,
        orcaTargets.engineOutputDir,
        orcaTargets.slicerOutputPath
    ]) assertContained(workspace, candidate);
    assert.equal(workspace.assertScratchContainedPath(profilePath), path.resolve(profilePath));

    const baseIni = path.join(workspace.directory, 'base.ini');
    await fs.writeFile(baseIni, 'layer_height = 0.3\nfill_density = 10%\n');
    const runtimeIni = await createRuntimeSlicerProfile('prusa', baseIni, 'FDM', 0.2, '20%', workspace);
    assert.equal(workspace.assertScratchContainedPath(runtimeIni), path.resolve(runtimeIni));
    assert.match(await fs.readFile(runtimeIni, 'utf8'), /layer_height = 0\.2/);

    await workspace.cleanup();
});

test('adversarial profile and extraction seams cannot escape to a naive-prefix sibling', async (t) => {
    const { workspace } = await fixture(t);
    const sibling = `${workspace.scratchDirectory}-foreign`;
    const escape = () => path.join(sibling, 'escaped');

    assert.throws(
        () => resolveRuntimeProfilePath(workspace, 'prusa-runtime', '.ini', escape),
        /outside the managed workspace/
    );
    assert.throws(
        () => resolveExtractionDirectory(workspace, escape),
        /outside the managed workspace/
    );
    assert.throws(
        () => resolveTransformedPath(workspace.resolvePath('model.stl'), workspace, () => '../escape'),
        /Invalid server-generated transform suffix/
    );

    await assert.rejects(fs.access(sibling));
    await workspace.cleanup();
});

test('all transient helper families reject an intermediate junction escape', async (t) => {
    const { root, workspace } = await fixture(t);
    const outside = path.join(root, 'outside');
    const link = path.join(workspace.directory, 'linked');
    const scratchLink = path.join(workspace.scratchDirectory, 'linked');
    await fs.mkdir(outside);
    try {
        await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        await fs.symlink(outside, scratchLink, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink creation unavailable: ${error.code || 'unknown'}`);
        await workspace.cleanup();
        return;
    }
    const escapedStl = path.join(link, 'model.stl');
    const escapedObj = path.join(link, 'model.obj');

    assert.throws(() => resolveConvertedPath(escapedObj, workspace), /Symlink paths/);
    assert.throws(() => resolveOrientedPath(escapedStl, workspace), /Symlink paths/);
    assert.throws(
        () => resolveTransformedPath(escapedStl, workspace, () => '0123456789abcdef'),
        /Symlink paths/
    );
    assert.throws(
        () => resolveRuntimeProfilePath(workspace, 'prusa-runtime', '.ini', () => path.join(scratchLink, 'profile.ini')),
        /Symlink paths/
    );
    assert.throws(
        () => resolveExtractionDirectory(workspace, () => path.join(link, 'extract')),
        /Symlink paths/
    );
    await assert.rejects(
        resolveSliceOutputTargets('orca', 'engine.stl', 'FDM', {
            ...workspace,
            createUniquePath: async () => path.join(link, 'engine-output')
        }),
        /Symlink paths/
    );
    await assert.rejects(appendOriginalExtensionToUpload(escapedStl, '.stl', workspace), /Symlink paths/);

    await workspace.cleanup();
    await fs.access(outside);
});
