'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandRunner } = require('../../../app/services/slice/command');
const { createSliceQueue } = require('../../../app/services/slice/queue');

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

test('10 active queue slot remains occupied until native callback and tree termination settle', async () => {
    const termination = deferred();
    let nativeCallback;
    let replacementRuns = 0;
    const command = createCommandRunner({
        platform: 'linux', timeoutMs: 60_000,
        createChildEnvironment: () => ({ PATH: '/bin' }),
        setTimeout: () => ({ unref() {} }), clearTimeout() {},
        execFile(_executable, _args, _options, callback) {
            nativeCallback = callback;
            return { pid: 45678 };
        },
        createProcessTreeTerminator: () => ({ terminate: () => termination.promise })
    });
    const queue = createSliceQueue({
        maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10, maxWaitMs: 60_000
    });
    const controller = new AbortController();
    const reason = new Error('native abort');
    const active = queue.enqueueSliceJob(
        (signal) => command('native-tool', [], { signal }),
        { queueKey: 'first', signal: controller.signal }
    );
    const replacement = queue.enqueueSliceJob(async () => {
        replacementRuns += 1;
        return 'replacement';
    }, { queueKey: 'second' });
    await flush();

    controller.abort(reason);
    nativeCallback(new Error('native child exited'), '', '');
    await flush();
    assert.equal(queue.getQueueStatus().activeJobs, 1);
    assert.equal(replacementRuns, 0);

    termination.resolve();
    await assert.rejects(active, (error) => error === reason);
    assert.equal(await replacement, 'replacement');
    await flush();
    assert.equal(queue.getQueueStatus().activeJobs, 0);
});
