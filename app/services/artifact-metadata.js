'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { OUTPUT_DIR } = require('../config/paths');
const { readFileSyncBounded } = require('../utils/bounded-file');

const METADATA_VERSION = 1;
const ARTIFACT_ID_PATTERN = /^artifact-[a-f0-9]{32}$/;
const JOB_ID_PATTERN = /^job-[a-f0-9]{32}$/;
const FILE_NAME_PATTERN = /^[a-zA-Z0-9-]+-output-artifact-[a-f0-9]{32}\.(?:gcode|sl1)$/;
const METADATA_NAME_PATTERN = /^\.artifact-(?<hex>[a-f0-9]{32})\.json$/;

function samePath(left, right) {
    const normalize = (value) => process.platform === 'win32'
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    return normalize(left) === normalize(right);
}

function directChild(root, name) {
    if (!name || name.includes('/') || name.includes('\\')) return null;
    const candidate = path.join(path.resolve(root), name);
    return path.dirname(candidate) === path.resolve(root) ? candidate : null;
}

function fileIdentity(stats) {
    return `${String(stats.dev)}:${String(stats.ino)}:${String(stats.birthtimeNs ?? stats.birthtimeMs)}`;
}

async function assertCanonicalOutputRoot(outputRoot) {
    const resolved = path.resolve(outputRoot);
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await fs.realpath(resolved), resolved)) {
        throw new Error('Unsafe artifact output root.');
    }
    return resolved;
}

function metadataFileName(artifactId) {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid artifact identifier.');
    return `.${artifactId}.json`;
}

function isValidMetadata(metadata, markerName) {
    return Boolean(
        metadata?.version === METADATA_VERSION
        && ARTIFACT_ID_PATTERN.test(metadata.artifactId)
        && JOB_ID_PATTERN.test(metadata.jobId)
        && FILE_NAME_PATTERN.test(metadata.fileName)
        && (metadata.state === 'partial' || metadata.state === 'complete')
        && Number.isSafeInteger(metadata.sizeBytes)
        && metadata.sizeBytes >= 0
        && typeof metadata.fileIdentity === 'string'
        && Number.isSafeInteger(metadata.createdAt)
        && metadata.createdAt >= 0
        && markerName === metadataFileName(metadata.artifactId)
    );
}

async function createPartialArtifactMetadata(context) {
    const outputRoot = await assertCanonicalOutputRoot(context.outputRoot || OUTPUT_DIR);
    const artifactPath = directChild(outputRoot, context.fileName);
    if (!artifactPath || !FILE_NAME_PATTERN.test(context.fileName)) throw new Error('Invalid managed artifact name.');
    const stat = await fs.lstat(artifactPath, { bigint: true });
    const realPath = await fs.realpath(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink() || !samePath(realPath, artifactPath)) {
        throw new Error('Unsafe managed artifact.');
    }
    if (!ARTIFACT_ID_PATTERN.test(context.artifactId) || !JOB_ID_PATTERN.test(context.jobId)) {
        throw new Error('Invalid artifact ownership correlation.');
    }
    const metadata = {
        version: METADATA_VERSION,
        artifactId: context.artifactId,
        jobId: context.jobId,
        fileName: context.fileName,
        state: 'partial',
        sizeBytes: 0,
        fileIdentity: fileIdentity(stat),
        createdAt: context.createdAt
    };
    if (!Number.isSafeInteger(metadata.createdAt) || metadata.createdAt < 0) {
        throw new Error('Invalid artifact creation time.');
    }
    const metadataPath = path.join(outputRoot, metadataFileName(context.artifactId));
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, { flag: 'wx', mode: 0o600 });
    return { ...metadata, metadataPath, realPath };
}

async function finalizeArtifactMetadata(context) {
    const outputRoot = await assertCanonicalOutputRoot(context.outputRoot || OUTPUT_DIR);
    const metadataPath = path.join(outputRoot, metadataFileName(context.artifactId));
    const prior = JSON.parse(readFileSyncBounded(metadataPath, 64 * 1024));
    if (
        !isValidMetadata(prior, path.basename(metadataPath))
        || prior.state !== 'partial'
        || prior.jobId !== context.jobId
        || prior.fileName !== context.fileName
    ) throw new Error('Invalid partial artifact metadata.');
    const artifactPath = directChild(outputRoot, prior.fileName);
    const stat = await fs.lstat(artifactPath, { bigint: true });
    if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || Number(stat.size) <= 0
        || fileIdentity(stat) !== prior.fileIdentity
        || !samePath(await fs.realpath(artifactPath), artifactPath)
    ) throw new Error('Unsafe finalized artifact.');
    const metadata = { ...prior, state: 'complete', sizeBytes: Number(stat.size) };
    const temporary = path.join(outputRoot, `.${context.artifactId}.final-${context.tempToken}.tmp`);
    let handle;
    try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(metadata)}\n`);
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(temporary, metadataPath);
    } finally {
        await handle?.close().catch(() => {});
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return { ...metadata, metadataPath, realPath: artifactPath };
}

async function removeArtifactMetadata(outputRoot, artifactId) {
    const root = await assertCanonicalOutputRoot(outputRoot);
    const target = directChild(root, metadataFileName(artifactId));
    if (target) await fs.rm(target, { force: true });
}

async function inspectMarker(root, entry, policy) {
    if (!entry.isFile() || entry.isSymbolicLink?.() || !METADATA_NAME_PATTERN.test(entry.name)) return null;
    const metadataPath = directChild(root, entry.name);
    const markerStat = await fs.lstat(metadataPath, { bigint: true });
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || Number(markerStat.size) > 64 * 1024) return null;
    let metadata;
    try {
        metadata = JSON.parse(readFileSyncBounded(metadataPath, 64 * 1024));
    } catch {
        return null;
    }
    if (!isValidMetadata(metadata, entry.name)) return null;
    const artifactPath = directChild(root, metadata.fileName);
    let artifactStat;
    try {
        artifactStat = await fs.lstat(artifactPath, { bigint: true });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {
                metadata, metadataPath, artifactPath, partial: true, missing: true,
                metadataIdentity: fileIdentity(markerStat)
            };
        }
        throw error;
    }
    if (
        !artifactStat.isFile()
        || artifactStat.isSymbolicLink()
        || (metadata.state === 'complete' && Number(artifactStat.size) !== metadata.sizeBytes)
        || Number(artifactStat.size) > policy.MAX_OUTPUT_BYTES
        || fileIdentity(artifactStat) !== metadata.fileIdentity
        || !samePath(await fs.realpath(artifactPath), artifactPath)
    ) return null;
    return {
        metadata,
        metadataPath,
        artifactPath,
        realPath: artifactPath,
        artifactIdentity: fileIdentity(artifactStat),
        metadataIdentity: fileIdentity(markerStat),
        partial: metadata.state === 'partial',
        missing: false
    };
}

module.exports = {
    METADATA_VERSION,
    ARTIFACT_ID_PATTERN,
    METADATA_NAME_PATTERN,
    samePath,
    fileIdentity,
    assertCanonicalOutputRoot,
    createPartialArtifactMetadata,
    finalizeArtifactMetadata,
    removeArtifactMetadata,
    inspectMarker
};
