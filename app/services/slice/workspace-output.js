/** Exact-file ownership for final output candidates outside a job workspace. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { buildOutputFilename } = require('./common');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const {
    createPartialArtifactMetadata,
    finalizeArtifactMetadata,
    removeArtifactMetadata
} = require('../artifact-store');
const { resourceLimit } = require('./resource-errors');
const { acquireArtifactLease } = require('../artifact-leases');

function isDirectChild(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return relative !== ''
        && relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
        && !relative.includes(path.sep);
}

function fileIdentity(stats) {
    return `${String(stats.dev)}:${String(stats.ino)}:${String(stats.birthtimeNs ?? stats.birthtimeMs)}`;
}

function isOwnedCandidate(record, stats) {
    return Boolean(
        record?.identity
        && stats?.isFile()
        && !stats.isSymbolicLink()
        && fileIdentity(stats) === record.identity
    );
}

async function lstatOrNull(target, options) {
    try {
        return await fs.lstat(target, options);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

async function copyOwnedFileToHandle(sourcePath, sourceIdentity, targetHandle, maximumBytes) {
    const sourceHandle = await fs.open(sourcePath, 'r');
    try {
        const openedSource = await sourceHandle.stat({ bigint: true });
        if (!openedSource.isFile() || fileIdentity(openedSource) !== sourceIdentity) {
            throw new Error('Unsafe promotion source');
        }
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        for (;;) {
            const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0) break;
            if (position + bytesRead > maximumBytes) throw resourceLimit('Generated output exceeds its byte limit.');
            await writeBufferFully(targetHandle, buffer, bytesRead, position);
            position += bytesRead;
        }
    } finally {
        await sourceHandle.close();
    }
}

async function writeBufferFully(handle, buffer, length, position) {
    let written = 0;
    while (written < length) {
        const result = await handle.write(buffer, written, length - written, position + written);
        if (result.bytesWritten === 0) throw new Error('Output promotion write made no progress');
        written += result.bytesWritten;
    }
}

class OutputCandidateRegistry {
    constructor(context) {
        this.jobId = context.jobId;
        this.outputRoot = context.outputRoot;
        this.assertContainedPath = context.assertContainedPath;
        this.assertSafeOutputRoot = context.assertSafeOutputRoot;
        this.options = context.options;
        this.policy = context.options.resourcePolicy || resolveResourcePolicy(context.options.env || process.env);
        this.candidates = new Map();
    }

    async register(originalName, technology) {
        const artifactId = this.options.artifactIdFactory
            ? String(this.options.artifactIdFactory())
            : `artifact-${randomBytes(16).toString('hex')}`;
        if (!/^artifact-[a-f0-9]{32}$/.test(artifactId)) throw new Error('Invalid artifact identifier');
        const candidate = path.join(this.outputRoot, buildOutputFilename(originalName, technology, artifactId));
        if (!isDirectChild(this.outputRoot, candidate)) throw new Error('Output candidate is not a direct child');
        await this.assertSafeOutputRoot();
        if (await lstatOrNull(candidate)) throw new Error('Output candidate already exists');
        this.candidates.set(candidate, {
            promoted: false,
            handle: null,
            identity: null,
            artifactId,
            jobId: this.jobId,
            fileName: path.basename(candidate),
            metadataCreated: false
        });
        return candidate;
    }

    async promote(candidate, source) {
        const record = this.candidates.get(path.resolve(candidate));
        if (!record || record.promoted) throw new Error('Output candidate is not registered');
        await this.assertSafeOutputRoot();
        const sourcePath = this.assertContainedPath(source);
        const sourceStat = await fs.lstat(sourcePath, { bigint: true });
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Unsafe promotion source');

        record.handle = await fs.open(candidate, 'wx', 0o600);
        record.promoted = true;
        record.identity = fileIdentity(await record.handle.stat({ bigint: true }));
        record.metadata = await createPartialArtifactMetadata({
            outputRoot: this.outputRoot,
            artifactId: record.artifactId,
            jobId: record.jobId,
            fileName: record.fileName,
            createdAt: (this.options.clock || Date.now)()
        });
        record.metadataCreated = true;
        if (Number(sourceStat.size) <= 0 || Number(sourceStat.size) > this.policy.MAX_OUTPUT_BYTES) {
            throw resourceLimit('Generated output exceeds its byte limit.');
        }
        await copyOwnedFileToHandle(
            sourcePath,
            fileIdentity(sourceStat),
            record.handle,
            this.policy.MAX_OUTPUT_BYTES
        );
        await record.handle.sync();
        await this.assertPromotedCandidate(candidate, record);
        record.metadata = await finalizeArtifactMetadata({
            outputRoot: this.outputRoot,
            artifactId: record.artifactId,
            jobId: record.jobId,
            fileName: record.fileName,
            tempToken: randomBytes(8).toString('hex')
        });
        record.activeLease = acquireArtifactLease([record.metadata.realPath]);
        await fs.rm(sourcePath, { force: true });
        return candidate;
    }

    async assertPromotedCandidate(candidate, record) {
        const inspect = this.options.inspectOutputCandidate || fs.lstat;
        const inspected = await inspect(candidate);
        const current = await fs.lstat(candidate, { bigint: true });
        if (
            !inspected.isFile()
            || inspected.isSymbolicLink()
            || Number(inspected.size) === 0
            || Number(inspected.size) > this.policy.MAX_OUTPUT_BYTES
            || !isOwnedCandidate(record, current)
        ) throw new Error('Unsafe promoted output');
    }

    async release(candidate) {
        const resolved = path.resolve(candidate);
        const record = this.candidates.get(resolved);
        if (!record?.promoted) throw new Error('Output candidate was not promoted');
        await this.assertSafeOutputRoot();
        const stat = await fs.lstat(resolved, { bigint: true });
        if (!isOwnedCandidate(record, stat)) throw new Error('Unsafe output candidate');
        await this.closeRecord(record);
        const finalStat = await fs.lstat(resolved, { bigint: true });
        if (!isOwnedCandidate(record, finalStat)) throw new Error('Unsafe output candidate');
        record.activeLease?.release();
        record.activeLease = null;
        this.candidates.delete(resolved);
        return resolved;
    }

    async cleanup() {
        let failed = false;
        for (const [candidate, record] of this.candidates) {
            if (!record.promoted || !isDirectChild(this.outputRoot, candidate)) continue;
            if (!await this.cleanupCandidate(candidate, record)) failed = true;
        }
        return failed;
    }

    async cleanupCandidate(candidate, record) {
        try {
            record.activeLease?.release();
            record.activeLease = null;
            await this.assertSafeOutputRoot();
            const stat = await lstatOrNull(candidate, { bigint: true });
            if (!stat) return this.closeRecord(record);
            if (!isOwnedCandidate(record, stat)) {
                await this.closeRecord(record);
                return false;
            }
            const remove = this.options.removeOutputCandidate || ((target) => fs.rm(target, { force: true }));
            await remove(candidate);
            if (record.metadataCreated) {
                await removeArtifactMetadata(this.outputRoot, record.artifactId);
            }
            return this.closeRecord(record);
        } catch {
            await this.closeRecord(record);
            return false;
        }
    }

    async closeRecord(record) {
        try {
            await record.handle?.close();
            record.handle = null;
            return true;
        } catch {
            record.handle = null;
            return false;
        }
    }

    getInfo(candidate) {
        const record = this.candidates.get(path.resolve(candidate));
        if (!record) throw new Error('Output candidate is not registered');
        return {
            jobId: record.jobId,
            artifactId: record.artifactId,
            fileName: record.fileName
        };
    }
}

module.exports = {
    OutputCandidateRegistry
};
