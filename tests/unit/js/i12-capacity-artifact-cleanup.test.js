'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const artifactMetadata = require('../../../app/services/artifact-metadata');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const {
    CLEANUP_SCHEMA,
    MAX_MANIFEST_BYTES,
    assertExecutionBoundary,
    executeCleanup,
    parseManifest,
    runCli
} = require('../../../scripts/i12-capacity-artifact-cleanup');

const createdRoots = new Set();

test.afterEach(() => {
    for (const root of createdRoots) fs.rmSync(root, { recursive: true, force: true });
    createdRoots.clear();
});

function hex(index) {
    return index.toString(16).padStart(32, '0');
}

function record(index) {
    return {
        artifact_id: `artifact-${hex(index)}`,
        job_id: `job-${hex(index)}`
    };
}

function markerPath(outputRoot, artifactId) {
    return path.join(outputRoot, `.${artifactId}.json`);
}

async function createArtifact(outputRoot, index) {
    const ownership = record(index);
    const fileName = `synthetic-output-${ownership.artifact_id}.gcode`;
    const artifactPath = path.join(outputRoot, fileName);
    fs.writeFileSync(artifactPath, `G1 X${index}\n`, { encoding: 'utf8', flag: 'wx' });
    await artifactMetadata.createPartialArtifactMetadata({
        outputRoot,
        fileName,
        artifactId: ownership.artifact_id,
        jobId: ownership.job_id,
        createdAt: 1_700_000_000_000 + index
    });
    await artifactMetadata.finalizeArtifactMetadata({
        outputRoot,
        fileName,
        artifactId: ownership.artifact_id,
        jobId: ownership.job_id,
        tempToken: `fixture-${index}`
    });
    return {
        ...ownership,
        artifactPath,
        markerPath: markerPath(outputRoot, ownership.artifact_id)
    };
}

async function harness(count = 1) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i12-artifact-cleanup-'));
    createdRoots.add(root);
    const outputRoot = path.join(root, 'output');
    const manifestPath = path.join(root, 'cleanup.json');
    fs.mkdirSync(outputRoot, { mode: 0o700 });
    const artifacts = [];
    for (let index = 1; index <= count; index += 1) {
        artifacts.push(await createArtifact(outputRoot, index));
    }
    const manifest = {
        schema_version: CLEANUP_SCHEMA,
        artifacts: artifacts.map(({ artifact_id, job_id }) => ({ artifact_id, job_id }))
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
    });
    const runtime = {
        argv: ['node', 'i12-capacity-artifact-cleanup.js'],
        getuid: () => (typeof process.getuid === 'function' ? process.getuid() : 1000),
        platform: process.platform,
        manifestPath,
        outputRoot,
        fsSync: fs,
        fsPromises,
        artifactMetadata,
        policy: resolveResourcePolicy({})
    };
    return { root, outputRoot, manifestPath, manifest, artifacts, runtime };
}

function fakeOwnerMode(stat, uid, mode) {
    const bigint = typeof stat.mode === 'bigint';
    const owner = typeof stat.uid === 'bigint' ? BigInt(uid) : uid;
    const permissions = bigint
        ? (stat.mode & ~0o7777n) | BigInt(mode)
        : (stat.mode & ~0o7777) | mode;
    Object.defineProperty(stat, 'uid', { configurable: true, value: owner });
    Object.defineProperty(stat, 'mode', { configurable: true, value: permissions });
    return stat;
}

function fakePosixOwnership(fixture, overrides = {}) {
    const serviceUid = overrides.serviceUid ?? 4242;
    const manifestUid = overrides.manifestUid ?? serviceUid;
    const manifestMode = overrides.manifestMode ?? 0o600;
    const outputUid = overrides.outputUid ?? serviceUid;
    const outputMode = overrides.outputMode ?? 0o700;
    fixture.runtime.platform = 'linux';
    fixture.runtime.getuid = () => serviceUid;
    fixture.runtime.fsSync = {
        ...fs,
        lstatSync: (target, options) => {
            const stat = fs.lstatSync(target, options);
            return path.resolve(target) === path.resolve(fixture.manifestPath)
                ? fakeOwnerMode(stat, manifestUid, manifestMode)
                : stat;
        }
    };
    fixture.runtime.fsPromises = {
        ...fsPromises,
        lstat: async (target, options) => {
            const stat = await fsPromises.lstat(target, options);
            return path.resolve(target) === path.resolve(fixture.outputRoot)
                ? fakeOwnerMode(stat, outputUid, outputMode)
                : stat;
        }
    };
}

function writeManifest(fixture, manifest) {
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
}

function rewriteMarker(fixture, index, mutate) {
    const target = fixture.artifacts[index].markerPath;
    const metadata = JSON.parse(fs.readFileSync(target, 'utf8'));
    mutate(metadata);
    fs.writeFileSync(target, `${JSON.stringify(metadata)}\n`, 'utf8');
}

function captureStream() {
    const chunks = [];
    return { chunks, write: (chunk) => { chunks.push(String(chunk)); } };
}

test('deletes only preflighted artifact-marker pairs in artifact-first order', async () => {
    const fixture = await harness(2);
    const unrelated = path.join(fixture.outputRoot, 'operator-owned.txt');
    fs.writeFileSync(unrelated, 'preserve', { flag: 'wx' });
    const deletions = [];
    fixture.runtime.fsPromises = {
        ...fsPromises,
        unlink: async (target) => {
            deletions.push(target);
            await fsPromises.unlink(target);
        }
    };

    const result = await executeCleanup(fixture.runtime);

    assert.deepEqual(result, { classification: 'cleanup_complete', deleted_count: 2 });
    assert.deepEqual(deletions, [
        fixture.artifacts[0].artifactPath,
        fixture.artifacts[0].markerPath,
        fixture.artifacts[1].artifactPath,
        fixture.artifacts[1].markerPath
    ]);
    assert.equal(fs.existsSync(unrelated), true);
    for (const artifact of fixture.artifacts) {
        assert.equal(fs.existsSync(artifact.artifactPath), false);
        assert.equal(fs.existsSync(artifact.markerPath), false);
    }
});

test('accepts an empty exact manifest and performs no deletion', async () => {
    const fixture = await harness(0);
    let unlinkCalls = 0;
    fixture.runtime.fsPromises = {
        ...fsPromises,
        unlink: async () => { unlinkCalls += 1; }
    };
    assert.deepEqual(
        await executeCleanup(fixture.runtime),
        { classification: 'cleanup_complete', deleted_count: 0 }
    );
    assert.equal(unlinkCalls, 0);
});

test('rejects root execution and every CLI argument before deletion', async () => {
    for (const mutate of [
        (runtime) => { runtime.getuid = () => 0; },
        (runtime) => { runtime.argv = [...runtime.argv, '--unexpected']; }
    ]) {
        const fixture = await harness(1);
        let unlinkCalls = 0;
        fixture.runtime.fsPromises = {
            ...fsPromises,
            unlink: async () => { unlinkCalls += 1; }
        };
        mutate(fixture.runtime);
        await assert.rejects(executeCleanup(fixture.runtime), (error) => {
            assert.match(error.code, /^cleanup_(?:root|cli_arguments)_forbidden$/);
            return true;
        });
        assert.equal(unlinkCalls, 0);
        assert.equal(fs.existsSync(fixture.artifacts[0].artifactPath), true);
    }
});

test('execution boundary returns the validated non-root UID', () => {
    assert.equal(assertExecutionBoundary(['node', 'cleanup.js'], () => 4242), 4242);
});

test('faked POSIX owner and restrictive mode contract succeeds without a platform skip', async () => {
    const fixture = await harness(1);
    fakePosixOwnership(fixture);
    assert.deepEqual(
        await executeCleanup(fixture.runtime),
        { classification: 'cleanup_complete', deleted_count: 1 }
    );
});

test('faked POSIX manifest and output ownership or mode drift fails before deletion', async () => {
    const cases = [
        [{ manifestUid: 4343 }, 'cleanup_manifest_permissions_invalid'],
        [{ manifestMode: 0o640 }, 'cleanup_manifest_permissions_invalid'],
        [{ manifestMode: 0o1600 }, 'cleanup_manifest_permissions_invalid'],
        [{ outputUid: 4343 }, 'cleanup_output_root_permissions_invalid'],
        [{ outputMode: 0o750 }, 'cleanup_output_root_permissions_invalid'],
        [{ outputMode: 0o2700 }, 'cleanup_output_root_permissions_invalid']
    ];
    for (const [overrides, expected] of cases) {
        const fixture = await harness(1);
        fakePosixOwnership(fixture, overrides);
        let unlinkCalls = 0;
        fixture.runtime.fsPromises.unlink = async () => { unlinkCalls += 1; };
        await assert.rejects(executeCleanup(fixture.runtime), (error) => error.code === expected);
        assert.equal(unlinkCalls, 0);
        assert.equal(fs.existsSync(fixture.artifacts[0].artifactPath), true);
        assert.equal(fs.existsSync(fixture.artifacts[0].markerPath), true);
    }
});

test('missing explicit platform seam fails closed before deletion', async () => {
    const fixture = await harness(1);
    fixture.runtime.platform = undefined;
    let unlinkCalls = 0;
    fixture.runtime.fsPromises = { ...fsPromises, unlink: async () => { unlinkCalls += 1; } };
    await assert.rejects(executeCleanup(fixture.runtime), (error) => error.code === 'cleanup_platform_invalid');
    assert.equal(unlinkCalls, 0);
});

test('rejects unavailable, non-regular, oversized, and replaced manifests', async () => {
    {
        const fixture = await harness(1);
        fixture.runtime.manifestPath = path.join(fixture.root, 'missing.json');
        await assert.rejects(executeCleanup(fixture.runtime));
    }
    {
        const fixture = await harness(1);
        fixture.runtime.manifestPath = fixture.outputRoot;
        await assert.rejects(executeCleanup(fixture.runtime));
    }
    {
        const fixture = await harness(1);
        fs.writeFileSync(fixture.manifestPath, 'x'.repeat(MAX_MANIFEST_BYTES + 1));
        await assert.rejects(executeCleanup(fixture.runtime));
    }
    {
        const fixture = await harness(1);
        let calls = 0;
        fixture.runtime.fsSync = {
            ...fs,
            lstatSync: (target, options) => {
                const stat = fs.lstatSync(target, options);
                calls += 1;
                if (calls === 2) Object.defineProperty(stat, 'ino', { value: stat.ino + 1n });
                return stat;
            }
        };
        await assert.rejects(executeCleanup(fixture.runtime), (error) => error.code === 'cleanup_manifest_replaced');
    }
});

test('rejects a manifest symlink when the platform permits creating it', async (context) => {
    const fixture = await harness(1);
    const link = path.join(fixture.root, 'cleanup-link.json');
    try {
        fs.symlinkSync(fixture.manifestPath, link, 'file');
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
            context.skip('filesystem does not permit symlinks');
            return;
        }
        throw error;
    }
    fixture.runtime.manifestPath = link;
    await assert.rejects(executeCleanup(fixture.runtime));
});

test('manifest parser rejects schema drift, key drift, invalid IDs, collisions, and over-count', () => {
    const valid = record(1);
    const cases = [
        {},
        { schema_version: CLEANUP_SCHEMA, artifacts: [], extra: true },
        { schema_version: 'i12-queue-cleanup-v2', artifacts: [] },
        { schema_version: CLEANUP_SCHEMA, artifacts: null },
        { schema_version: CLEANUP_SCHEMA, artifacts: [valid, record(2), record(3), record(4)] },
        { schema_version: CLEANUP_SCHEMA, artifacts: [{ job_id: valid.job_id }] },
        { schema_version: CLEANUP_SCHEMA, artifacts: [{ ...valid, extra: true }] },
        { schema_version: CLEANUP_SCHEMA, artifacts: [{ ...valid, job_id: 'JOB-invalid' }] },
        { schema_version: CLEANUP_SCHEMA, artifacts: [{ ...valid, artifact_id: 'artifact-invalid' }] },
        { schema_version: CLEANUP_SCHEMA, artifacts: [valid, { ...record(2), job_id: valid.job_id }] },
        { schema_version: CLEANUP_SCHEMA, artifacts: [valid, { ...record(2), artifact_id: valid.artifact_id }] }
    ];
    for (const manifest of cases) {
        assert.throws(() => parseManifest(JSON.stringify(manifest)), CleanupContractErrorMatcher);
    }
});

function CleanupContractErrorMatcher(error) {
    return error?.name === 'CleanupContractError';
}

test('rejects incomplete or mismatched metadata before deleting anything', async () => {
    const mutators = [
        (fixture) => rewriteMarker(fixture, 0, (metadata) => { metadata.state = 'partial'; metadata.sizeBytes = 0; }),
        (fixture) => rewriteMarker(fixture, 0, (metadata) => { metadata.jobId = record(2).job_id; }),
        (fixture) => rewriteMarker(fixture, 0, (metadata) => { metadata.sizeBytes += 1; }),
        (fixture) => rewriteMarker(fixture, 0, (metadata) => { metadata.unexpected = true; }),
        (fixture) => fs.unlinkSync(fixture.artifacts[0].artifactPath),
        (fixture) => fs.unlinkSync(fixture.artifacts[0].markerPath),
        (fixture) => {
            const target = fixture.artifacts[0].artifactPath;
            const raw = fs.readFileSync(target);
            fs.unlinkSync(target);
            fs.writeFileSync(target, raw, { flag: 'wx' });
        }
    ];
    for (const mutate of mutators) {
        const fixture = await harness(1);
        mutate(fixture);
        let unlinkCalls = 0;
        fixture.runtime.fsPromises = {
            ...fsPromises,
            unlink: async () => { unlinkCalls += 1; }
        };
        await assert.rejects(executeCleanup(fixture.runtime));
        assert.equal(unlinkCalls, 0);
    }
});

test('rejects artifact and marker symlinks without deletion when supported', async (context) => {
    for (const selected of ['artifactPath', 'markerPath']) {
        const fixture = await harness(1);
        const target = fixture.artifacts[0][selected];
        const preserved = path.join(fixture.root, `${selected}.preserved`);
        fs.renameSync(target, preserved);
        try {
            fs.symlinkSync(preserved, target, 'file');
        } catch (error) {
            if (error.code === 'EPERM' || error.code === 'EACCES') {
                context.skip('filesystem does not permit symlinks');
                return;
            }
            throw error;
        }
        let unlinkCalls = 0;
        fixture.runtime.fsPromises = {
            ...fsPromises,
            unlink: async () => { unlinkCalls += 1; }
        };
        await assert.rejects(executeCleanup(fixture.runtime));
        assert.equal(unlinkCalls, 0);
    }
});

test('preflights every record before any deletion', async () => {
    const fixture = await harness(2);
    rewriteMarker(fixture, 1, (metadata) => { metadata.jobId = record(3).job_id; });
    let unlinkCalls = 0;
    fixture.runtime.fsPromises = {
        ...fsPromises,
        unlink: async () => { unlinkCalls += 1; }
    };
    await assert.rejects(executeCleanup(fixture.runtime));
    assert.equal(unlinkCalls, 0);
    assert.equal(fs.existsSync(fixture.artifacts[0].artifactPath), true);
    assert.equal(fs.existsSync(fixture.artifacts[0].markerPath), true);
});

test('rejects an identity change during the global pre-delete re-stat', async () => {
    const fixture = await harness(1);
    const target = fixture.artifacts[0].artifactPath;
    let targetStats = 0;
    let unlinkCalls = 0;
    fixture.runtime.fsPromises = {
        ...fsPromises,
        lstat: async (candidate, options) => {
            const stat = await fsPromises.lstat(candidate, options);
            if (candidate === target) {
                targetStats += 1;
                if (targetStats === 2) Object.defineProperty(stat, 'ino', { value: stat.ino + 1n });
            }
            return stat;
        },
        unlink: async () => { unlinkCalls += 1; }
    };
    await assert.rejects(executeCleanup(fixture.runtime), (error) => error.code === 'cleanup_artifact_changed');
    assert.equal(unlinkCalls, 0);
    assert.equal(fs.existsSync(target), true);
});

test('detects marker replacement between artifact and marker deletion', async () => {
    const fixture = await harness(1);
    const artifact = fixture.artifacts[0];
    const markerRaw = fs.readFileSync(artifact.markerPath);
    const deletions = [];
    fixture.runtime.fsPromises = {
        ...fsPromises,
        unlink: async (target) => {
            deletions.push(target);
            await fsPromises.unlink(target);
            if (target === artifact.artifactPath) {
                await fsPromises.unlink(artifact.markerPath);
                await fsPromises.writeFile(artifact.markerPath, markerRaw, { flag: 'wx' });
            }
        }
    };
    await assert.rejects(executeCleanup(fixture.runtime), (error) => error.code === 'cleanup_marker_changed');
    assert.deepEqual(deletions, [artifact.artifactPath]);
    assert.equal(fs.existsSync(artifact.artifactPath), false);
    assert.equal(fs.existsSync(artifact.markerPath), true);
});

test('fails closed when unlink leaves residue', async () => {
    const fixture = await harness(1);
    let unlinkCalls = 0;
    fixture.runtime.fsPromises = {
        ...fsPromises,
        unlink: async () => { unlinkCalls += 1; }
    };
    await assert.rejects(executeCleanup(fixture.runtime), (error) => error.code === 'cleanup_residue_detected');
    assert.equal(unlinkCalls, 2);
    assert.equal(fs.existsSync(fixture.artifacts[0].artifactPath), true);
    assert.equal(fs.existsSync(fixture.artifacts[0].markerPath), true);
});

test('CLI output is bounded to classification and count on success and raw-error failure', async () => {
    const fixture = await harness(1);
    const stdout = captureStream();
    const stderr = captureStream();
    assert.equal(await runCli({ stdout, stderr, loadRuntime: () => fixture.runtime }), 0);
    assert.deepEqual(stdout.chunks, ['{"classification":"cleanup_complete","deleted_count":1}\n']);
    assert.deepEqual(stderr.chunks, []);

    const failedStdout = captureStream();
    const failedStderr = captureStream();
    const raw = `secret-value ${fixture.artifacts[0].artifact_id} ${fixture.outputRoot}`;
    assert.equal(await runCli({
        stdout: failedStdout,
        stderr: failedStderr,
        loadRuntime: () => { throw new Error(raw); }
    }), 1);
    assert.deepEqual(failedStdout.chunks, []);
    assert.deepEqual(failedStderr.chunks, ['{"classification":"cleanup_failed","deleted_count":0}\n']);
    assert.doesNotMatch(failedStderr.chunks.join(''), /secret|artifact-[a-f0-9]|output/i);
});
