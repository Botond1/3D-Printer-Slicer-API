'use strict';

/**
 * The Bambu Studio artifact is the printer-ready `.gcode.3mf` project. Every
 * managed-name validator must admit that compound extension, otherwise a
 * successful native slice answers HTTP 500 at promotion time (observed on the
 * production image). This exercises promotion, metadata finalization, the
 * retention scan, and the admin listing end to end on a temporary output root.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const PATHS_PATH = path.join(ROOT, 'app/config/paths.js');
const ADMIN_OUTPUT_PATH = path.join(ROOT, 'app/services/admin-output.service.js');

const artifactMetadata = require('../../../app/services/artifact-metadata');
const { cleanupManagedArtifacts, inspectMarker } = require('../../../app/services/artifact-store');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { MANAGED_FILE_PATTERN } = require('../../../app/services/admin-output.service');

const ARTIFACT_ID = 'artifact-0123456789abcdef0123456789abcdef';
const JOB_ID = 'job-fedcba9876543210fedcba9876543210';

async function temporaryRoots(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b2-bambu-artifact-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const outputRoot = path.join(root, 'output');
    await fsp.mkdir(outputRoot, { mode: 0o700 });
    return {
        root,
        outputRoot,
        jobsRoot: path.join(root, 'input', '.slice-jobs'),
        scratchRoot: path.join(root, 'scratch')
    };
}

/**
 * Load a fresh admin-output service whose OUTPUT_DIR is the temporary root.
 * @param {string} outputRoot Temporary output directory.
 * @returns {{service: object, restore: () => void}} Service and cache restorer.
 */
function loadAdminOutputWithRoot(outputRoot) {
    const originalPaths = require.cache[PATHS_PATH];
    const originalAdmin = require.cache[ADMIN_OUTPUT_PATH];
    const paths = require(PATHS_PATH);
    require.cache[PATHS_PATH] = {
        id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
        exports: { ...paths, OUTPUT_DIR: outputRoot }
    };
    delete require.cache[ADMIN_OUTPUT_PATH];
    const service = require(ADMIN_OUTPUT_PATH);
    return {
        service,
        restore() {
            if (originalPaths) require.cache[PATHS_PATH] = originalPaths;
            else delete require.cache[PATHS_PATH];
            if (originalAdmin) require.cache[ADMIN_OUTPUT_PATH] = originalAdmin;
            else delete require.cache[ADMIN_OUTPUT_PATH];
        }
    };
}

test('a .gcode.3mf artifact promotes, finalizes metadata, survives the retention scan, and lists with correlation', async (t) => {
    const dirs = await temporaryRoots(t);
    const workspace = await createJobWorkspace({
        jobsRoot: dirs.jobsRoot, scratchRoot: dirs.scratchRoot, outputRoot: dirs.outputRoot,
        artifactIdFactory: () => ARTIFACT_ID
    });
    const candidate = await workspace.registerOutputCandidate('cube.stl', 'FDM', 'bambu');
    const fileName = `cube-output-${ARTIFACT_ID}.gcode.3mf`;
    assert.equal(path.basename(candidate), fileName);
    assert.equal(path.dirname(candidate), path.resolve(dirs.outputRoot));
    const source = workspace.resolvePath('result.gcode.3mf');
    await fsp.writeFile(source, 'PK-project-bytes');

    // Promotion is exactly the step that failed in production with a `.gcode`-only validator.
    await workspace.promoteOutputCandidate(candidate, source);
    const metadataPath = path.join(dirs.outputRoot, `.${ARTIFACT_ID}.json`);
    const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
    assert.equal(metadata.version, artifactMetadata.METADATA_VERSION);
    assert.equal(metadata.state, 'complete');
    assert.equal(metadata.fileName, fileName);
    assert.equal(metadata.artifactId, ARTIFACT_ID);
    assert.equal(metadata.sizeBytes, 16);
    assert.match(metadata.jobId, /^job-[a-f0-9]{32}$/);
    assert.match(fileName, artifactMetadata.FILE_NAME_PATTERN);
    assert.match(fileName, MANAGED_FILE_PATTERN);
    assert.equal(await fsp.readFile(candidate, 'utf8'), 'PK-project-bytes');
    await workspace.releaseOutputCandidate(candidate);
    await workspace.cleanup();
    await fsp.access(candidate);

    // The retention scan recognises the marker + artifact pair as one managed, complete record.
    const policy = resolveResourcePolicy({});
    const entry = { name: `.${ARTIFACT_ID}.json`, isFile: () => true, isSymbolicLink: () => false };
    const record = await inspectMarker(path.resolve(dirs.outputRoot), entry, policy);
    assert.ok(record);
    assert.equal(record.partial, false);
    assert.equal(record.missing, false);
    assert.equal(path.basename(record.artifactPath), fileName);
    const summary = await cleanupManagedArtifacts({ outputRoot: dirs.outputRoot, resourcePolicy: policy });
    assert.equal(summary.managed, 1);
    assert.equal(summary.removed, 0);
    assert.equal(summary.retainedCount, 1);
    assert.equal(summary.retainedBytes, 16);
    assert.equal(summary.quotaSatisfied, true);
    await fsp.access(candidate);
    await fsp.access(metadataPath);

    // The admin listing and single-file resolution accept the compound extension and correlate it.
    const { service, restore } = loadAdminOutputWithRoot(dirs.outputRoot);
    t.after(restore);
    const listed = service.listOutputFileSummaries();
    assert.equal(listed.success, true);
    assert.equal(listed.total, 1);
    assert.equal(listed.files[0].fileName, fileName);
    assert.equal(listed.files[0].sizeBytes, 16);
    assert.equal(listed.files[0].downloadUrl, `/admin/download/${encodeURIComponent(fileName)}`);
    assert.equal(listed.files[0].artifact_id, ARTIFACT_ID);
    assert.equal(listed.files[0].job_id, metadata.jobId);
    assert.equal(listed.files.some((file) => file.fileName.startsWith('.artifact-')), false);
    const single = service.getValidatedOutputFile(fileName);
    assert.equal(single.success, true);
    assert.equal(single.fileName, fileName);
    assert.equal(single.artifactId, ARTIFACT_ID);
    assert.equal(service.getValidatedOutputFile(`cube-output-${ARTIFACT_ID}.3mf`).errorCode, 'INVALID_OUTPUT_FILE');
});

test('managed artifact names admit exactly .gcode, .sl1, and .gcode.3mf', () => {
    const { FILE_NAME_PATTERN } = artifactMetadata;
    for (const name of [
        `cube-output-${ARTIFACT_ID}.gcode`,
        `resin-output-${ARTIFACT_ID}.sl1`,
        `cube-output-${ARTIFACT_ID}.gcode.3mf`,
        `My-unsafe-model-output-${ARTIFACT_ID}.gcode.3mf`
    ]) {
        assert.match(name, FILE_NAME_PATTERN, name);
        assert.match(name, MANAGED_FILE_PATTERN, name);
    }
    for (const name of [
        `cube-output-${ARTIFACT_ID}.3mf`,
        `cube-output-${ARTIFACT_ID}.GCODE.3MF`,
        `cube-output-${ARTIFACT_ID}.gcode.3mf.bak`,
        `cube-output-${ARTIFACT_ID}.gcode3mf`,
        `cube-output-${ARTIFACT_ID}.gcode.`,
        'cube-output-artifact-xyz.gcode.3mf',
        `dir/cube-output-${ARTIFACT_ID}.gcode.3mf`,
        `cube.output-${ARTIFACT_ID}.gcode.3mf`,
        `.gcode.3mf`
    ]) {
        assert.doesNotMatch(name, FILE_NAME_PATTERN, name);
    }
});

test('partial metadata creation rejects a bare .3mf name but accepts and finalizes the compound extension', async (t) => {
    const dirs = await temporaryRoots(t);
    const bare = `part-output-${ARTIFACT_ID}.3mf`;
    const compound = `part-output-${ARTIFACT_ID}.gcode.3mf`;
    await fsp.writeFile(path.join(dirs.outputRoot, bare), 'PK');
    await fsp.writeFile(path.join(dirs.outputRoot, compound), 'PK-project');
    const context = { outputRoot: dirs.outputRoot, artifactId: ARTIFACT_ID, jobId: JOB_ID, createdAt: 1_700_000_000_000 };
    await assert.rejects(
        artifactMetadata.createPartialArtifactMetadata({ ...context, fileName: bare }),
        /Invalid managed artifact name/
    );
    const partial = await artifactMetadata.createPartialArtifactMetadata({ ...context, fileName: compound });
    assert.equal(partial.state, 'partial');
    assert.equal(partial.fileName, compound);
    const complete = await artifactMetadata.finalizeArtifactMetadata({
        outputRoot: dirs.outputRoot, artifactId: ARTIFACT_ID, jobId: JOB_ID, fileName: compound, tempToken: 'b2fixture'
    });
    assert.equal(complete.state, 'complete');
    assert.equal(complete.sizeBytes, 10);
    const entry = { name: `.${ARTIFACT_ID}.json`, isFile: () => true, isSymbolicLink: () => false };
    const record = await inspectMarker(path.resolve(dirs.outputRoot), entry, resolveResourcePolicy({}));
    assert.equal(record?.partial, false);
    assert.equal(record?.metadata.fileName, compound);
});
