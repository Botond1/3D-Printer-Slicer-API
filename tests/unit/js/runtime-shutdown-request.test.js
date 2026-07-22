'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRuntimeLifecycle } = require('../../../app/services/runtime-lifecycle');
const {
    createSliceQueue,
    SliceQueueShutdownError
} = require('../../../app/services/slice/queue');

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

test('runtime abort prevents post-abort success/artifact release and cleans workspace once', async () => {
    const processRef = new EventEmitter();
    const queue = createSliceQueue({
        maxConcurrent: 1,
        maxQueueLength: 10,
        maxQueuePerClient: 10,
        maxWaitMs: 60_000
    });
    const taskStarted = deferred();
    const taskGate = deferred();
    let artifactReleases = 0;
    let successResponses = 0;
    let cleanupCalls = 0;
    let cleanupPromise;
    const cleanupWorkspace = () => {
        if (!cleanupPromise) {
            cleanupPromise = Promise.resolve().then(() => { cleanupCalls += 1; });
        }
        return cleanupPromise;
    };
    const requestDone = queue.enqueueSliceJob(async (signal) => {
        try {
            taskStarted.resolve();
            await taskGate.promise;
            if (!signal.aborted) {
                artifactReleases += 1;
                successResponses += 1;
            }
        } finally {
            await cleanupWorkspace();
        }
    }, { queueKey: 'shutdown-client' }).catch((error) => error);
    await taskStarted.promise;

    let closeCalls = 0;
    const lifecycle = createRuntimeLifecycle({
        processRef,
        beginQueueShutdown: queue.beginSliceQueueShutdown
    });
    await lifecycle.run(async () => ({
        close(callback) { closeCalls += 1; callback(); },
        closeIdleConnections() {}
    }));
    processRef.emit('SIGTERM');
    const shutdown = lifecycle.shutdown();
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    assert.equal(cleanupCalls, 0);

    taskGate.resolve();
    const requestResult = await requestDone;
    await shutdown;

    assert.ok(requestResult instanceof SliceQueueShutdownError);
    assert.equal(closeCalls, 1);
    assert.equal(artifactReleases, 0);
    assert.equal(successResponses, 0);
    assert.equal(cleanupCalls, 1);
    await cleanupWorkspace();
    assert.equal(cleanupCalls, 1);
    assert.equal(queue.getQueueStatus().activeJobs, 0);
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
    assert.equal(processRef.listenerCount('SIGINT'), 0);
});
