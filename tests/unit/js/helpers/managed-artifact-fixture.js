'use strict';

/** Managed artifacts (file + finalized sidecar) in a private output root, for the 3.9.0 retention tests. */

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const artifactMetadata = require('../../../../app/services/artifact-metadata');

function hex(index) {
    return index.toString(16).padStart(32, '0');
}

async function createOutputRoot(t, prefix = 'r3d-retention-') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot, { mode: 0o700 });
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    return outputRoot;
}

/**
 * Create one complete managed artifact.
 * @returns {Promise<{artifactId: string, jobId: string, artifactPath: string, markerPath: string, realPath: string}>}
 */
async function createManagedArtifact(outputRoot, index, createdAt, body = `G1 X${index}\n`) {
    const artifactId = `artifact-${hex(index)}`;
    const jobId = `job-${hex(index)}`;
    const fileName = `synthetic-output-${artifactId}.gcode`;
    const artifactPath = path.join(outputRoot, fileName);
    await fs.writeFile(artifactPath, body, { flag: 'wx' });
    await artifactMetadata.createPartialArtifactMetadata({ outputRoot, fileName, artifactId, jobId, createdAt });
    const finalized = await artifactMetadata.finalizeArtifactMetadata({
        outputRoot, fileName, artifactId, jobId, tempToken: `fixture-${index}`
    });
    return {
        artifactId,
        jobId,
        artifactPath,
        markerPath: path.join(outputRoot, `.${artifactId}.json`),
        realPath: finalized.realPath
    };
}

async function exists(target) {
    try {
        await fs.lstat(target);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

module.exports = { createManagedArtifact, createOutputRoot, exists, hex };
