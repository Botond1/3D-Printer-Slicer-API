'use strict';

const fs = require('node:fs/promises');
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

let cleanupPromise;

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

async function scanManagedArtifacts(options, policy, summary) {
    const root = await assertCanonicalOutputRoot(options.outputRoot || OUTPUT_DIR);
    const directory = await fs.opendir(root);
    const records = [];
    const clock = options.clock || Date.now;
    const started = clock();
    let bounded = false;
    try {
        for await (const entry of directory) {
            if (clock() - started >= policy.STARTUP_CLEANUP_MAX_MS) {
                bounded = true;
                break;
            }
            if (!METADATA_NAME_PATTERN.test(entry.name)) {
                summary.skipped++;
                continue;
            }
            if (summary.inspected >= policy.STARTUP_CLEANUP_MAX_ENTRIES) {
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

async function removeOwnedRecord(record, summary, options, eventName, reason) {
    if (!record.partial && isArtifactLeased(record.realPath)) {
        summary.active++;
        emitArtifactLifecycle(eventName, record, 'skipped', 'ARTIFACT_LEASE_ACTIVE', reason);
        return;
    }
    if (!record.missing && !beginArtifactDeletion(record.realPath)) {
        summary.active++;
        emitArtifactLifecycle(eventName, record, 'skipped', 'ARTIFACT_DELETION_BUSY', reason);
        return;
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
                return;
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
    } catch {
        summary.failed++;
        emitArtifactLifecycle(
            eventName,
            record,
            'failure',
            eventName === 'artifact.evicted' ? 'ARTIFACT_EVICTION_FAILED' : 'ARTIFACT_CLEANUP_FAILED',
            reason
        );
    } finally {
        if (!record.missing) endArtifactDeletion(record.realPath);
    }
}

async function runCleanup(options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const now = (options.clock || Date.now)();
    const summary = {
        inspected: 0, managed: 0, removed: 0, removedArtifacts: 0,
        removedBytes: 0, active: 0, skipped: 0, failed: 0
    };
    const records = await scanManagedArtifacts(options, policy, summary);
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
    return summary;
}

function cleanupManagedArtifacts(options = {}) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = runCleanup(options).finally(() => {
        cleanupPromise = null;
    });
    return cleanupPromise;
}

module.exports = {
    METADATA_VERSION,
    ARTIFACT_ID_PATTERN,
    createPartialArtifactMetadata,
    finalizeArtifactMetadata,
    removeArtifactMetadata,
    cleanupManagedArtifacts,
    selectEvictions,
    inspectMarker
};
