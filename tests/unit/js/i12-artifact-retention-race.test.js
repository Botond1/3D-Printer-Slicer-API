'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const {
    createPartialArtifactMetadata,
    finalizeArtifactMetadata,
    cleanupManagedArtifacts
} = require('../../../app/services/artifact-store');

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

async function withDeadline(promise, label) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2_000);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function createManagedArtifact(outputRoot, character, createdAt) {
    const artifactId = `artifact-${character.repeat(32)}`;
    const jobId = `job-${character.repeat(32)}`;
    const fileName = `cube-${character}-output-${artifactId}.gcode`;
    const artifactPath = path.join(outputRoot, fileName);
    const metadataPath = path.join(outputRoot, `.${artifactId}.json`);
    await fs.writeFile(artifactPath, '');
    await createPartialArtifactMetadata({
        outputRoot, artifactId, jobId, fileName, createdAt
    });
    await fs.writeFile(artifactPath, `G1 X${createdAt}\n`, { flag: 'a' });
    await finalizeArtifactMetadata({
        outputRoot,
        artifactId,
        jobId,
        fileName,
        tempToken: character.repeat(16)
    });
    return { artifactId, artifactPath, metadataPath };
}

function retentionPolicy() {
    return {
        ...resolveResourcePolicy({}),
        ARTIFACT_TTL_MS: 1_000_000,
        MAX_MANAGED_ARTIFACTS: 1,
        MAX_MANAGED_ARTIFACT_BYTES: 1024 * 1024,
        STARTUP_CLEANUP_MAX_ENTRIES: 32,
        STARTUP_CLEANUP_MAX_MS: 10_000
    };
}

async function retainedManagedEntries(outputRoot) {
    return (await fs.readdir(outputRoot)).sort();
}

test('each concurrent promotion request waits for a retention pass that includes it', async (t) => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i12-retention-race-'));
    t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
    const first = await createManagedArtifact(outputRoot, 'a', 1);
    await createManagedArtifact(outputRoot, 'b', 2);
    const removalEntered = deferred();
    const releaseRemoval = deferred();
    t.after(() => releaseRemoval.resolve());
    let held = false;

    const firstCleanup = cleanupManagedArtifacts({
        outputRoot,
        resourcePolicy: retentionPolicy(),
        clock: () => 10,
        removeFile: async (target, options) => {
            if (!held && path.resolve(target) === path.resolve(first.artifactPath)) {
                held = true;
                removalEntered.resolve();
                await releaseRemoval.promise;
            }
            await fs.rm(target, options);
        }
    });

    await withDeadline(removalEntered.promise, 'first retention removal barrier');
    const final = await createManagedArtifact(outputRoot, 'c', 3);
    const secondCleanup = cleanupManagedArtifacts({
        outputRoot,
        resourcePolicy: retentionPolicy(),
        clock: () => 10
    });
    releaseRemoval.resolve();

    const [firstSummary, secondSummary] = await Promise.all([firstCleanup, secondCleanup]);
    assert.equal(firstSummary.quotaSatisfied, true);
    assert.equal(secondSummary.quotaSatisfied, true);
    assert.notStrictEqual(secondSummary, firstSummary, 'callers must not share a stale cleanup summary');
    assert.equal(secondSummary.managed, 2, 'the later pass must observe its newly promoted artifact');
    assert.equal(secondSummary.retainedCount, 1);
    assert.deepEqual(await retainedManagedEntries(outputRoot), [
        `.${final.artifactId}.json`,
        path.basename(final.artifactPath)
    ].sort());
});

test('a failed retention pass cannot poison the serialized cleanup lane', async (t) => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i12-retention-recovery-'));
    t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
    await createManagedArtifact(outputRoot, 'd', 1);
    const retained = await createManagedArtifact(outputRoot, 'e', 2);

    await assert.rejects(cleanupManagedArtifacts({
        outputRoot: path.join(outputRoot, 'missing'),
        resourcePolicy: retentionPolicy(),
        clock: () => 10
    }), /ENOENT/);

    const recovered = await cleanupManagedArtifacts({
        outputRoot,
        resourcePolicy: retentionPolicy(),
        clock: () => 10
    });
    assert.equal(recovered.quotaSatisfied, true);
    assert.deepEqual(await retainedManagedEntries(outputRoot), [
        `.${retained.artifactId}.json`,
        path.basename(retained.artifactPath)
    ].sort());
});
