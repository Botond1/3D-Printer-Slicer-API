'use strict';

const crypto = require('node:crypto');
const { lstatSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULTS } = require('../../config/constants');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { JOB_WORKSPACES_DIR, JOB_SCRATCH_DIR, OUTPUT_DIR } = require('../../config/paths');
const { OutputCandidateRegistry } = require('./workspace-output');

const MARKER_NAME = '.workspace-owner.json';
const MARKER_VERSION = 1;
const JOB_PATTERN = /^job-[a-f0-9]{32}$/;
const REQUEST_WORKSPACE = Symbol('sliceJobWorkspace');
const MIN_STALE_MS = 60_000;
const MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MARKER_BYTES = 4 * 1024;

function isSameResolvedPath(left, right) {
    const normalize = (value) => process.platform === 'win32'
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    return normalize(left) === normalize(right);
}

function assertNoSymlinkSegments(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    const segments = relative ? relative.split(path.sep) : [];
    let current = path.resolve(root);
    for (const segment of ['', ...segments]) {
        if (segment) current = path.join(current, segment);
        try {
            const stats = lstatSync(current);
            if (stats.isSymbolicLink()) throw new Error('Symlink paths are not managed by a slice workspace');
        } catch (error) {
            if (error?.code === 'ENOENT') break;
            throw error;
        }
    }
}

function assertInside(root, candidate, allowRoot = false) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(candidate);
    const relative = path.relative(resolvedRoot, resolved);
    if ((!allowRoot && relative === '') || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Path is outside the managed workspace');
    }
    assertNoSymlinkSegments(resolvedRoot, resolved);
    return resolved;
}

async function assertCanonicalDirectory(directory, label) {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Unsafe ${label}`);
    const canonical = await fs.realpath(directory);
    if (!isSameResolvedPath(canonical, directory)) throw new Error(`Unsafe ${label}`);
    return path.resolve(directory);
}

async function lstatOrNull(target) {
    try { return await fs.lstat(target); } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function readValidMarker(directory, expectedId) {
    const markerPath = path.join(directory, MARKER_NAME);
    const markerStat = await fs.lstat(markerPath, { bigint: true }).catch(() => null);
    if (
        !markerStat?.isFile()
        || markerStat.isSymbolicLink()
        || Number(markerStat.size) <= 0
        || Number(markerStat.size) > MAX_MARKER_BYTES
    ) return null;
    let handle;
    try {
        handle = await fs.open(markerPath, 'r');
        const opened = await handle.stat({ bigint: true });
        if (
            String(opened.dev) !== String(markerStat.dev)
            || String(opened.ino) !== String(markerStat.ino)
            || opened.size !== markerStat.size
        ) return null;
        const content = Buffer.alloc(Number(opened.size));
        let offset = 0;
        while (offset < content.length) {
            const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
            if (bytesRead <= 0) return null;
            offset += bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (
            String(after.dev) !== String(opened.dev)
            || String(after.ino) !== String(opened.ino)
            || after.size !== opened.size
        ) return null;
        const marker = JSON.parse(content.toString('utf8'));
        return marker.version === MARKER_VERSION && marker.id === expectedId
            && Number.isSafeInteger(marker.createdAt) && marker.createdAt >= 0
            ? marker : null;
    } catch { return null; }
    finally { await handle?.close().catch(() => {}); }
}

function resolveWorkspaceStaleAgeMs(value) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= MIN_STALE_MS && parsed <= MAX_STALE_MS
        ? parsed : DEFAULTS.WORKSPACE_STALE_AGE_MS;
}

async function removeOwnedDirectory(directory, id) {
    const stat = await lstatOrNull(directory);
    if (!stat) return true;
    if (!stat.isDirectory() || stat.isSymbolicLink() || !await readValidMarker(directory, id)) return false;
    await fs.rm(directory, { recursive: true, force: true });
    return true;
}

function createWorkspaceCleanup({ id, directory, scratchDirectory, outputCandidates, options }) {
    let cleanupPromise;
    return async function cleanup(reason = 'settled') {
        if (cleanupPromise) return cleanupPromise;
        cleanupPromise = (async () => {
            let cleanupFailed = await outputCandidates.cleanup();
            let workspaceRemoved = false;
            try {
                workspaceRemoved = await removeOwnedDirectory(directory, id);
                if (!workspaceRemoved) cleanupFailed = true;
                if (!await removeOwnedDirectory(scratchDirectory, id)) cleanupFailed = true;
            } catch {
                cleanupFailed = true;
            }
            if (workspaceRemoved) {
                try {
                    options.logger?.info?.('Slice workspace cleaned', {
                        jobId: id,
                        reason: String(reason).replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
                    });
                } catch {
                    // Observability is not an ownership boundary and cannot undo cleanup.
                }
            }
            if (cleanupFailed) throw new Error('Slice workspace cleanup was incomplete.');
        })();
        return cleanupPromise;
    };
}

async function createJobWorkspace(options = {}) {
    const jobsRoot = path.resolve(options.jobsRoot || JOB_WORKSPACES_DIR);
    const scratchRoot = path.resolve(options.scratchRoot || JOB_SCRATCH_DIR);
    const outputRoot = path.resolve(options.outputRoot || OUTPUT_DIR);
    await fs.mkdir(jobsRoot, { recursive: true, mode: 0o700 });
    await assertCanonicalDirectory(jobsRoot, 'job workspace root');
    await fs.mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    await assertCanonicalDirectory(scratchRoot, 'job scratch root');

    let id;
    let directory;
    for (;;) {
        id = `job-${crypto.randomBytes(16).toString('hex')}`;
        directory = path.join(jobsRoot, id);
        try { await fs.mkdir(directory, { mode: 0o700 }); break; } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
    const marker = { version: MARKER_VERSION, id, createdAt: (options.clock || Date.now)() };
    const scratchDirectory = path.join(scratchRoot, id);
    try {
        await fs.writeFile(path.join(directory, MARKER_NAME), `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 });
        await fs.mkdir(scratchDirectory, { mode: 0o700 });
        await fs.writeFile(
            path.join(scratchDirectory, MARKER_NAME),
            `${JSON.stringify(marker)}\n`,
            { flag: 'wx', mode: 0o600 }
        );
    } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        await fs.rm(scratchDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
    }

    const assertContainedPath = (candidate) => assertInside(directory, candidate);
    const resolvePath = (...segments) => assertContainedPath(path.resolve(directory, ...segments));
    const assertScratchContainedPath = (candidate) => assertInside(scratchDirectory, candidate);
    const resolveScratchPath = (...segments) => assertScratchContainedPath(path.resolve(scratchDirectory, ...segments));

    async function createUniquePath(extension = '') {
        if (extension && (!/^\.[a-z0-9]+$/i.test(extension))) throw new Error('Invalid temporary extension');
        return resolvePath(`${crypto.randomBytes(16).toString('hex')}${extension}`);
    }

    async function assertSafeOutputRoot() {
        await assertCanonicalDirectory(outputRoot, 'output root');
    }
    const outputCandidates = new OutputCandidateRegistry({
        jobId: id,
        outputRoot,
        assertContainedPath,
        assertSafeOutputRoot,
        options
    });

    const cleanup = createWorkspaceCleanup({ id, directory, scratchDirectory, outputCandidates, options });

    return {
        id,
        directory,
        scratchDirectory,
        resolvePath,
        assertContainedPath,
        resolveScratchPath,
        assertScratchContainedPath,
        createUniquePath,
        registerOutputCandidate: outputCandidates.register.bind(outputCandidates),
        promoteOutputCandidate: outputCandidates.promote.bind(outputCandidates),
        releaseOutputCandidate: outputCandidates.release.bind(outputCandidates),
        getOutputCandidateInfo: outputCandidates.getInfo.bind(outputCandidates),
        cleanup
    };
}

function attachWorkspaceToRequest(req, workspace) { req[REQUEST_WORKSPACE] = workspace; return workspace; }
function getRequestWorkspace(req) { return req?.[REQUEST_WORKSPACE] || null; }
function detachWorkspaceFromRequest(req) { const workspace = getRequestWorkspace(req); if (req) delete req[REQUEST_WORKSPACE]; return workspace; }

async function auditStaleWorkspaces(options = {}) {
    const jobsRoot = path.resolve(options.jobsRoot || JOB_WORKSPACES_DIR);
    const now = (options.clock || Date.now)();
    const staleAgeMs = resolveWorkspaceStaleAgeMs(options.staleAgeMs);
    const summary = { inspected: 0, stale: 0, removed: 0, skipped: 0, failed: 0 };
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const maxEntries = options.maxEntries || policy.STARTUP_CLEANUP_MAX_ENTRIES;
    const maxMs = options.maxMs || policy.STARTUP_CLEANUP_MAX_MS;
    const started = (options.clock || Date.now)();
    let directoryHandle;
    try {
        await assertCanonicalDirectory(jobsRoot, 'job workspace root');
        directoryHandle = await fs.opendir(jobsRoot);
    } catch (error) {
        if (error.code === 'ENOENT') return summary;
        throw error;
    }
    let mayDelete = false;
    if (options.delete === true) {
        const exclusive = typeof options.verifyExclusiveLease === 'function'
            && await options.verifyExclusiveLease(jobsRoot) === true;
        if (options.deleteMarkedRegardlessAge === true) {
            mayDelete = exclusive;
        } else {
            const bounded = Number(options.boundedLifetimeMs);
            mayDelete = Number.isSafeInteger(bounded) && bounded >= 0 && staleAgeMs >= bounded + MIN_STALE_MS
                && exclusive;
        }
    }
    for await (const entry of directoryHandle) {
        if (summary.inspected >= maxEntries || (options.clock || Date.now)() - started >= maxMs) {
            summary.bounded = true;
            break;
        }
        summary.inspected++;
        if (!entry.isDirectory() || entry.isSymbolicLink?.() || !JOB_PATTERN.test(entry.name)) { summary.skipped++; continue; }
        const directory = path.join(jobsRoot, entry.name);
        try {
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) { summary.skipped++; continue; }
            if (!isSameResolvedPath(await fs.realpath(directory), directory)) { summary.skipped++; continue; }
            const marker = await readValidMarker(directory, entry.name);
            const deleteEveryMarked = mayDelete && options.deleteMarkedRegardlessAge === true;
            if (!marker || (!deleteEveryMarked && now - marker.createdAt <= staleAgeMs)) {
                summary.skipped++;
                continue;
            }
            summary.stale++;
            if (mayDelete) {
                const removeWorkspace = options.removeWorkspace || ((target) => fs.rm(target, { recursive: true }));
                await removeWorkspace(directory);
                summary.removed++;
            }
        } catch {
            summary.failed++;
            try {
                options.logger?.warn?.('Slice workspace audit entry failed', { jobId: entry.name });
            } catch {
                // A logger failure must not abort inspection of later entries.
            }
        }
    }
    return summary;
}

/**
 * Await the audit boundary before invoking the supplied listener factory.
 * @param {{audit?: (options: object) => Promise<object>, auditOptions?: object, onAudit?: (summary: object) => void, listen: () => unknown}} options Startup seams.
 * @returns {Promise<unknown>} Listener returned only after audit settlement.
 */
async function auditWorkspacesThenListen(options) {
    if (typeof options?.listen !== 'function') throw new Error('Startup listener is required.');
    const audit = options.audit || auditStaleWorkspaces;
    const summary = await audit(options.auditOptions || {});
    try {
        options.onAudit?.(summary);
    } catch {
        // A reporting failure cannot reverse a completed safety audit.
    }
    return options.listen();
}

module.exports = {
    MARKER_NAME, MARKER_VERSION, createJobWorkspace, attachWorkspaceToRequest,
    getRequestWorkspace, detachWorkspaceFromRequest, resolveWorkspaceStaleAgeMs,
    auditStaleWorkspaces, auditWorkspacesThenListen
};
