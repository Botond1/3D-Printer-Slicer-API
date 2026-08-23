'use strict';

function selectEvictions(records, now, policy) {
    const sorted = records.filter((item) => !item.partial).sort((left, right) => (
        left.metadata.createdAt - right.metadata.createdAt
        || left.metadata.artifactId.localeCompare(right.metadata.artifactId)
    ));
    const selected = new Set(sorted.filter((item) => now - item.metadata.createdAt > policy.ARTIFACT_TTL_MS));
    let retained = sorted.filter((item) => !selected.has(item));
    let bytes = retained.reduce((sum, item) => sum + item.metadata.sizeBytes, 0);
    while (retained.length > policy.MAX_MANAGED_ARTIFACTS || bytes > policy.MAX_MANAGED_ARTIFACT_BYTES) {
        const oldest = retained.shift();
        selected.add(oldest);
        bytes -= oldest.metadata.sizeBytes;
    }
    return selected;
}

module.exports = { selectEvictions };
