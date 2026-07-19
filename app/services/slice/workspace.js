'use strict';

const crypto = require('node:crypto');
const { lstatSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULTS } = require('../../config/constants');
const { JOB_WORKSPACES_DIR, OUTPUT_DIR } = require('../../config/paths');
const { OutputCandidateRegistry } = require('./workspace-output');

const MARKER_NAME = '.workspace-owner.json';
const MARKER_VERSION = 1;
const JOB_PATTERN = /^job-[a-f0-9]{32}$/;
const REQUEST_WORKSPACE = Symbol('sliceJobWorkspace');
const MIN_STALE_MS = 60_000;
const MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;

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
    const markerStat = await lstatOrNull(markerPath);
    if (!markerStat?.isFile() || markerStat.isSymbolicLink()) return null;
    try {
        const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
        return marker.version === MARKER_VERSION && marker.id === expectedId
            && Number.isSafeInteger(marker.createdAt) && marker.createdAt >= 0
            ? marker : null;
    } catch { return null; }
}

function resolveWorkspaceStaleAgeMs(value) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= MIN_STALE_MS && parsed <= MAX_STALE_MS
        ? parsed : DEFAULTS.WORKSPACE_STALE_AGE_MS;
}

function createWorkspaceCleanup({ id, directory, outputCandidates, options }) {
    let cleanupPromise;
    return async function cleanup(reason = 'settled') {
        if (cleanupPromise) return cleanupPromise;
        cleanupPromise = (async () => {
            let cleanupFailed = await outputCandidates.cleanup();
            let workspaceRemoved = false;
            try {
                const stat = await lstatOrNull(directory);
                if (!stat) {
                    workspaceRemoved = true;
                } else if (stat.isDirectory() && !stat.isSymbolicLink() && await readValidMarker(directory, id)) {
                    await fs.rm(directory, { recursive: true, force: true });
                    workspaceRemoved = true;
                } else {
                    cleanupFailed = true;
                }
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
    const outputRoot = path.resolve(options.outputRoot || OUTPUT_DIR);
    await fs.mkdir(jobsRoot, { recursive: true, mode: 0o700 });
    await assertCanonicalDirectory(jobsRoot, 'job workspace root');

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
    try {
        await fs.writeFile(path.join(directory, MARKER_NAME), `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
    }

    const assertContainedPath = (candidate) => assertInside(directory, candidate);
    const resolvePath = (...segments) => assertContainedPath(path.resolve(directory, ...segments));

    async function createUniquePath(extension = '') {
        if (extension && (!/^\.[a-z0-9]+$/i.test(extension))) throw new Error('Invalid temporary extension');
        return resolvePath(`${crypto.randomBytes(16).toString('hex')}${extension}`);
    }

    async function assertSafeOutputRoot() {
        await assertCanonicalDirectory(outputRoot, 'output root');
    }
    const outputCandidates = new OutputCandidateRegistry({
        outputRoot,
        assertContainedPath,
        assertSafeOutputRoot,
        options
    });

    const cleanup = createWorkspaceCleanup({ id, directory, outputCandidates, options });

    return {
        id,
        directory,
        resolvePath,
        assertContainedPath,
        createUniquePath,
        registerOutputCandidate: outputCandidates.register.bind(outputCandidates),
        promoteOutputCandidate: outputCandidates.promote.bind(outputCandidates),
        releaseOutputCandidate: outputCandidates.release.bind(outputCandidates),
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
    let entries;
    try {
        await assertCanonicalDirectory(jobsRoot, 'job workspace root');
        entries = await fs.readdir(jobsRoot, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return summary;
        throw error;
    }
    let mayDelete = false;
    if (options.delete === true) {
        const bounded = Number(options.boundedLifetimeMs);
        mayDelete = Number.isSafeInteger(bounded) && bounded >= 0 && staleAgeMs >= bounded + MIN_STALE_MS
            && typeof options.verifyExclusiveLease === 'function' && await options.verifyExclusiveLease(jobsRoot) === true;
    }
    for (const entry of entries) {
        summary.inspected++;
        if (!entry.isDirectory() || entry.isSymbolicLink?.() || !JOB_PATTERN.test(entry.name)) { summary.skipped++; continue; }
        const directory = path.join(jobsRoot, entry.name);
        try {
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) { summary.skipped++; continue; }
            if (!isSameResolvedPath(await fs.realpath(directory), directory)) { summary.skipped++; continue; }
            const marker = await readValidMarker(directory, entry.name);
            if (!marker || now - marker.createdAt <= staleAgeMs) { summary.skipped++; continue; }
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
