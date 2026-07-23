'use strict';

const activePaths = new Map();
const deletingPaths = new Set();

function acquireArtifactLease(paths) {
    const leased = [...new Set(paths.map((item) => String(item)))];
    if (leased.some((item) => deletingPaths.has(item))) {
        const error = new Error('Artifact is being cleaned.');
        error.code = 'ARTIFACT_BUSY';
        throw error;
    }
    for (const item of leased) activePaths.set(item, (activePaths.get(item) || 0) + 1);
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
