'use strict';

/** Request-scoped correlation that survives asynchronous native and artifact work. */

const { AsyncLocalStorage } = require('node:async_hooks');

const JOB_ID = /^job-[a-f0-9]{32}$/;
const ARTIFACT_ID = /^artifact-[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const storage = new AsyncLocalStorage();

function normalizedCorrelation(value = {}) {
    const correlation = {};
    if (REQUEST_ID.test(value.requestId || '')) correlation.requestId = value.requestId;
    if (JOB_ID.test(value.jobId || '')) correlation.jobId = value.jobId;
    if (ARTIFACT_ID.test(value.artifactId || '')) correlation.artifactId = value.artifactId;
    return correlation;
}

function runWithCorrelationContext(correlation, callback) {
    return storage.run(normalizedCorrelation(correlation), callback);
}

function runWithRequestContext(requestId, callback) {
    return runWithCorrelationContext({ requestId }, callback);
}

function setCorrelationIds(correlation) {
    const current = storage.getStore();
    if (!current) return false;
    Object.assign(current, normalizedCorrelation({ ...current, ...correlation }));
    return true;
}

function captureCorrelationContext() {
    return Object.freeze({ ...normalizedCorrelation(storage.getStore()) });
}

module.exports = {
    captureCorrelationContext,
    runWithCorrelationContext,
    runWithRequestContext,
    setCorrelationIds
};
