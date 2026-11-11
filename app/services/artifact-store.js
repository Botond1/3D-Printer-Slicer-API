'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveResourcePolicy } = require('../config/resource-policy');
const { OUTPUT_DIR } = require('../config/paths');
const {
    isArtifactLeased,
    beginArtifactDeletion,
    endArtifactDeletion
} = require('./artifact-leases');
const { selectEvictions } = require('./artifact-retention-policy');
const { emitEvent } = require('./observability/events');
const {
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
} = require('./artifact-metadata');

/** Only the periodic sweeper passes this phase; every other caller keeps today's budget. */
const SWEEP_PHASE = 'sweep';
/** How often a leased pending deletion re-checks its lease (3.9.0). */
const PENDING_DELETE_POLL_MS = 100;

let cleanupTail = Promise.resolve();
/**
 * Artifacts a completed job's `DELETE` asked to remove while a lease held
 * them (3.9.0, spec §4.3). Process memory only: a restart loses the set and
 * the artifact TTL then bounds the artifact's life.
 * @type {Map<string, {outputRoot: string, realPath: string|null}>}
 */
const pendingDeletes = new Map();
let pendingTimer = null;
let pendingPollMs = PENDING_DELETE_POLL_MS;

function emitArtifactLifecycle(eventName, record, outcome, errorCode, reason) {
    emitEvent(eventName, {
        job_id: record?.metadata?.jobId,
        artifact_id: record?.metadata?.artifactId,
        audience: 'artifact',
        outcome,
        error_code: errorCode,
        extra: { reason }
    });
}

/**
 * Scan budget of one cleanup. No `phase` (the startup call and the post-slice
 * call on the response path) keeps the 3.8.3 budget exactly; only
 * `phase: 'sweep'` gets the periodic sweep's own time and entry budget.
 * @param {object} options Cleanup options (`phase`, optional `sweepMaxMs`).
 * @param {object} policy Resolved resource policy.
 * @returns {{maxMs: number, maxEntries: number}} Scan budget.
 */
function resolveScanBudget(options, policy) {
    if (options.phase !== SWEEP_PHASE) {
        return { maxMs: policy.STARTUP_CLEANUP_MAX_MS, maxEntries: policy.STARTUP_CLEANUP_MAX_ENTRIES };
    }
    const sweepMaxMs = Number.isSafeInteger(options.sweepMaxMs) && options.sweepMaxMs > 0
        ? options.sweepMaxMs
        // Resolved lazily so the hashed post-slice path never loads it.
        : require('../config/release-policy').retention.ARTIFACT_SWEEP_MAX_MS;
    return {
        maxMs: sweepMaxMs,
        maxEntries: Math.max(2 * policy.MAX_MANAGED_ARTIFACTS + 64, policy.STARTUP_CLEANUP_MAX_ENTRIES)
    };
}

async function scanManagedArtifacts(root, options, policy, summary) {
    const budget = resolveScanBudget(options, policy);
    const directory = await fs.opendir(root);
    const records = [];
    const clock = options.clock || Date.now;
    const started = clock();
    let bounded = false;
    try {
        for await (const entry of directory) {
            if (clock() - started >= budget.maxMs) {
                bounded = true;
                break;
            }
            if (!METADATA_NAME_PATTERN.test(entry.name)) {
                summary.skipped++;
                continue;
            }
            if (summary.inspected >= budget.maxEntries) {
                bounded = true;
                break;
            }
            summary.inspected++;
            try {
                const record = await inspectMarker(root, entry, policy);
                if (record) records.push(record);
                else summary.skipped++;
            } catch {
                summary.failed++;
            }
        }
    } finally {
        await directory.close().catch(() => {});
    }
    summary.scanComplete = !bounded;
    return records;
}

async function removeOwnedRecord(record, summary, options, eventName, reason, overrideLease = false) {
    // `overrideLease`: only the periodic sweep, only for an artifact a job
    // DELETE already marked, whose lease release was lost (spec §2.4/§4.3).
    const leased = !record.partial && isArtifactLeased(record.realPath);
    if (leased && !overrideLease) {
        summary.active++;
        emitArtifactLifecycle(eventName, record, 'skipped', 'ARTIFACT_LEASE_ACTIVE', reason);
        return false;
    }
    if (!leased && !record.missing && !beginArtifactDeletion(record.realPath)) {
        summary.active++;
        emitArtifactLifecycle(eventName, record, 'skipped', 'ARTIFACT_DELETION_BUSY', reason);
        return false;
    }
    try {
        if (!record.missing) {
            const current = await fs.lstat(record.artifactPath, { bigint: true });
            const marker = await fs.lstat(record.metadataPath, { bigint: true });
            if (
                !current.isFile()
                || current.isSymbolicLink()
                || (record.metadata.state === 'complete' && Number(current.size) !== record.metadata.sizeBytes)
                || fileIdentity(current) !== record.artifactIdentity
                || fileIdentity(marker) !== record.metadataIdentity
                || !samePath(await fs.realpath(record.artifactPath), record.artifactPath)
                || !samePath(await fs.realpath(record.metadataPath), record.metadataPath)
            ) {
                summary.skipped++;
                emitArtifactLifecycle(eventName, record, 'rejected', 'ARTIFACT_IDENTITY_CHANGED', reason);
                return false;
            }
            await (options.removeFile || fs.rm)(record.artifactPath, { force: true });
            if (!record.partial) {
                summary.removedArtifacts++;
                summary.removedBytes += record.metadata.sizeBytes;
            }
        }
        await (options.removeFile || fs.rm)(record.metadataPath, { force: true });
        summary.removed++;
        emitArtifactLifecycle(eventName, record, 'success', undefined, reason);
        return true;
    } catch {
        summary.failed++;
        emitArtifactLifecycle(
            eventName,
            record,
            'failure',
            eventName === 'artifact.evicted' ? 'ARTIFACT_EVICTION_FAILED' : 'ARTIFACT_CLEANUP_FAILED',
            reason
        );
        return false;
    } finally {
        if (!leased && !record.missing) endArtifactDeletion(record.realPath);
    }
}

function emptySummary() {
    return {
        inspected: 0, managed: 0, removed: 0, removedArtifacts: 0,
        removedBytes: 0, active: 0, skipped: 0, failed: 0
    };
}

/**
 * Read one artifact's marker by id, without a directory scan.
 * @returns {Promise<object|null>} The inspected record, or null when the
 *   marker is gone or is not a valid managed marker.
 */
async function inspectArtifactById(root, artifactId, policy) {
    const name = `.${artifactId}.json`;
    let stat;
    try {
        stat = await fs.lstat(path.join(root, name));
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
    return inspectMarker(root, {
        name,
        isFile: () => stat.isFile(),
        isSymbolicLink: () => stat.isSymbolicLink()
    }, policy);
}

function ensurePendingWatcher() {
    if (pendingTimer || pendingDeletes.size === 0) return;
    pendingTimer = setInterval(() => {
        if (pendingDeletes.size === 0) {
            stopPendingWatcher();
            return;
        }
        const released = [...pendingDeletes.entries()]
            .filter(([, entry]) => !entry.realPath || !isArtifactLeased(entry.realPath));
        if (released.length === 0) return;
        const roots = new Set(released.map(([, entry]) => entry.outputRoot));
        for (const outputRoot of roots) {
            serialize(() => processPendingDeletes(outputRoot, {})).catch(() => {});
        }
    }, pendingPollMs);
    pendingTimer.unref?.();
}

function stopPendingWatcher() {
    if (!pendingTimer) return;
    clearInterval(pendingTimer);
    pendingTimer = null;
}

/**
 * Remove every pending, unleased artifact of one output root ahead of its
 * TTL; drop ids whose files are already gone. Never touches the scan summary
 * of the caller (its quota arithmetic counts only scanned records).
 * @returns {Promise<{deleted: number, deletedBytes: number, pending: number}>} Outcome.
 */
async function processPendingDeletes(outputRoot, options, policy = null) {
    const outcome = { deleted: 0, deletedBytes: 0, pending: 0 };
    if (pendingDeletes.size === 0) return outcome;
    const resolvedPolicy = policy || options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    for (const [artifactId, entry] of [...pendingDeletes.entries()]) {
        if (!samePath(entry.outputRoot, outputRoot)) continue;
        const local = emptySummary();
        let record;
        try {
            record = await inspectArtifactById(outputRoot, artifactId, resolvedPolicy);
        } catch {
            outcome.pending++;
            continue;
        }
        if (!record) {
            // Already gone (or no longer a managed marker): nothing to delete.
            pendingDeletes.delete(artifactId);
            continue;
        }
        // The periodic sweep honours the mark even over a lease whose release
        // was lost; every other sweep waits for the release.
        const overrideLease = options.phase === SWEEP_PHASE;
        if (await removeOwnedRecord(record, local, options, 'artifact.cleanup', 'deleted', overrideLease)) {
            pendingDeletes.delete(artifactId);
            outcome.deleted++;
            outcome.deletedBytes += local.removedBytes;
        } else {
            if (record.realPath) entry.realPath = record.realPath;
            outcome.pending++;
        }
    }
    if (pendingDeletes.size === 0) stopPendingWatcher();
    return outcome;
}

async function runCleanup(options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const now = (options.clock || Date.now)();
    const summary = emptySummary();
    const root = await assertCanonicalOutputRoot(options.outputRoot || OUTPUT_DIR);
    // A job DELETE's pending mark is honoured ahead of the TTL by every sweep.
    const pending = await processPendingDeletes(root, options, policy);
    summary.deletedPending = pending.deleted;
    const records = await scanManagedArtifacts(root, options, policy, summary);
    summary.managed = records.length;
    const evictions = selectEvictions(records, now, policy);
    for (const record of records) {
        const stalePartial = record.partial
            && now - record.metadata.createdAt > policy.PARTIAL_ARTIFACT_STALE_MS;
        if (stalePartial || evictions.has(record)) {
            const evicted = evictions.has(record);
            await removeOwnedRecord(
                record,
                summary,
                options,
                evicted ? 'artifact.evicted' : 'artifact.cleanup',
                evicted ? 'retention' : 'partial'
            );
        }
    }
    const complete = records.filter((record) => !record.partial);
    summary.retainedCount = complete.length - summary.removedArtifacts;
    summary.retainedBytes = complete.reduce(
        (sum, record) => sum + record.metadata.sizeBytes,
        0
    ) - summary.removedBytes;
    summary.quotaSatisfied = summary.failed === 0
        && summary.scanComplete
        && summary.retainedCount <= policy.MAX_MANAGED_ARTIFACTS
        && summary.retainedBytes <= policy.MAX_MANAGED_ARTIFACT_BYTES;
    // `satisfied` | `exceeded` (complete scan, quota still over or a failure) | `incomplete`.
    summary.verdict = !summary.scanComplete
        ? 'incomplete'
        : (summary.quotaSatisfied ? 'satisfied' : 'exceeded');
    return summary;
}

/** Run one task through the single cleanup serialisation. */
function serialize(task) {
    const run = cleanupTail.then(task);
    cleanupTail = run.catch(() => {});
    return run;
}

/**
 * Serialized managed-artifact cleanup.
 * @param {object} [options] `phase: 'sweep'` (periodic sweeper only) selects
 *   the sweep budget; anything else keeps the 3.8.3 budget.
 * @returns {Promise<object>} Summary with `quotaSatisfied` and `verdict`.
 */
function cleanupManagedArtifacts(options = {}) {
    // Kept in its 3.8.3 text: i12-artifact-retention-race-mutations pins it.
    const cleanup = cleanupTail.then(() => runCleanup(options));
    cleanupTail = cleanup.catch(() => {});
    return cleanup;
}

async function runDeleteArtifact(artifactId, options) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const root = await assertCanonicalOutputRoot(options.outputRoot || OUTPUT_DIR);
    const record = await inspectArtifactById(root, artifactId, policy);
    if (!record) return { state: 'absent' };
    const local = emptySummary();
    if (await removeOwnedRecord(record, local, options, 'artifact.cleanup', 'deleted')) {
        pendingDeletes.delete(artifactId);
        return { state: 'deleted', bytes: local.removedBytes };
    }
    if (local.failed > 0 || local.skipped > 0) return { state: 'failed' };
    // Leased (an operator download) or mid-deletion: delete when released.
    pendingDeletes.set(artifactId, { outputRoot: root, realPath: record.realPath || null });
    ensurePendingWatcher();
    return { state: 'pending' };
}

/**
 * Delete one managed artifact and its sidecar (a completed job's `DELETE`,
 * 3.9.0). Runs through the cleanup serialisation. An unleased artifact is
 * removed now; a leased one is marked pending and removed when its last lease
 * ends or by the next sweep, whichever comes first. Never throws.
 * @param {string} artifactId `artifact-<32 hex>`.
 * @param {object} [options] Test seams (`outputRoot`, `resourcePolicy`, `removeFile`).
 * @returns {Promise<{state: 'deleted'|'pending'|'absent'|'failed'|'invalid', bytes?: number}>} Outcome.
 */
function deleteArtifact(artifactId, options = {}) {
    if (typeof artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(artifactId)) {
        return Promise.resolve({ state: 'invalid' });
    }
    return serialize(() => runDeleteArtifact(artifactId, options))
        .catch(() => ({ state: 'failed' }));
}

/** Ids currently marked for deletion, sorted (diagnostics and tests). */
function listPendingArtifactDeletions() {
    return [...pendingDeletes.keys()].sort();
}

/** Test seam: forget every pending mark and set the lease poll interval. */
function resetPendingArtifactDeletionsForTests(pollMs = PENDING_DELETE_POLL_MS) {
    pendingDeletes.clear();
    stopPendingWatcher();
    pendingPollMs = pollMs;
}

module.exports = {
    METADATA_VERSION,
    ARTIFACT_ID_PATTERN,
    PENDING_DELETE_POLL_MS,
    SWEEP_PHASE,
    createPartialArtifactMetadata,
    finalizeArtifactMetadata,
    removeArtifactMetadata,
    cleanupManagedArtifacts,
    deleteArtifact,
    listPendingArtifactDeletions,
    resetPendingArtifactDeletionsForTests,
    selectEvictions,
    inspectMarker
};
