'use strict';

const { emitEvent } = require('./observability/events');
const { captureCorrelationContext } = require('./observability/context');

const activePaths = new Map();
const deletingPaths = new Set();

function emitLeaseEvent(eventName, outcome, correlation, errorCode) {
    emitEvent(eventName, {
        request_id: correlation?.requestId,
        job_id: correlation?.jobId,
        artifact_id: correlation?.artifactId,
        audience: 'artifact',
        outcome,
        error_code: errorCode
    });
}

function acquireArtifactLease(paths, correlations = []) {
    const entries = new Map();
    const inherited = captureCorrelationContext();
    paths.forEach((item, index) => {
        const key = String(item);
        if (!entries.has(key)) entries.set(key, { ...inherited, ...(correlations[index] || {}) });
    });
    const leased = [...entries.keys()];
    if (leased.some((item) => deletingPaths.has(item))) {
        for (const correlation of entries.values()) {
            emitLeaseEvent('artifact.lease_acquired', 'rejected', correlation, 'ARTIFACT_LEASE_BUSY');
        }
        const error = new Error('Artifact is being cleaned.');
        error.code = 'ARTIFACT_BUSY';
        throw error;
    }
    for (const item of leased) activePaths.set(item, (activePaths.get(item) || 0) + 1);
    for (const correlation of entries.values()) {
        emitLeaseEvent('artifact.lease_acquired', 'success', correlation);
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            for (const item of leased) {
                const remaining = (activePaths.get(item) || 1) - 1;
                if (remaining > 0) activePaths.set(item, remaining);
                else activePaths.delete(item);
            }
            for (const correlation of entries.values()) {
                emitLeaseEvent('artifact.lease_released', 'success', correlation);
            }
        }
    };
}

function beginArtifactDeletion(realPath) {
    const key = String(realPath);
    if (activePaths.has(key) || deletingPaths.has(key)) return false;
    deletingPaths.add(key);
    return true;
}

function endArtifactDeletion(realPath) {
    deletingPaths.delete(String(realPath));
}

function isArtifactLeased(realPath) {
    return activePaths.has(String(realPath));
}

module.exports = {
    acquireArtifactLease,
    isArtifactLeased,
    beginArtifactDeletion,
    endArtifactDeletion
};
