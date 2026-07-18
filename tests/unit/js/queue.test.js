const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

const FIXTURE_PATH = path.join(__dirname, 'fixtures/queue-scenarios.js');

function runQueueScenario(name, overrides) {
    const environment = {
        ...process.env,
        MAX_SLICE_QUEUE_WAIT_MS: '60000',
        ...overrides
    };

    return new Promise((resolve, reject) => {
        execFile(
            process.execPath,
            [FIXTURE_PATH, name],
            {
                env: environment,
                encoding: 'utf8',
                timeout: 5000,
                windowsHide: true
            },
            (error, stdout, stderr) => {
                if (error) {
                    error.message = `${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`;
                    reject(error);
                    return;
                }

                assert.equal(stderr, '');
                resolve(JSON.parse(stdout));
            }
        );
    });
}

function assertDrained(status) {
    assert.equal(status.queueLength, 0);
    assert.equal(status.activeJobs, 0);
}

test('queue executes waiting jobs in FIFO order', async () => {
    const result = await runQueueScenario('fifo', {
        MAX_CONCURRENT_SLICES: '1',
        MAX_SLICE_QUEUE_LENGTH: '10',
        MAX_SLICE_QUEUE_PER_IP: '10'
    });

    assert.deepEqual(result.starts, ['first', 'second', 'third']);
    assert.deepEqual(result.results, ['first-result', 'second-result', 'third-result']);
    assert.equal(result.whileBlocked.activeJobs, 1);
    assert.equal(result.whileBlocked.queueLength, 2);
    assertDrained(result.finalStatus);
});

test('queue honors configured maximum concurrency', async () => {
    const result = await runQueueScenario('concurrency', {
        MAX_CONCURRENT_SLICES: '2',
        MAX_SLICE_QUEUE_LENGTH: '10',
        MAX_SLICE_QUEUE_PER_IP: '10'
    });

    assert.deepEqual(result.starts, ['first', 'second', 'third']);
    assert.equal(result.saturated.activeJobs, 2);
    assert.equal(result.saturated.queueLength, 1);
    assert.equal(result.afterReplacement.activeJobs, 2);
    assert.equal(result.afterReplacement.queueLength, 0);
    assert.equal(result.peakActiveTasks, 2);
    assertDrained(result.finalStatus);
});

test('queue enforces the queued-plus-active per-client cap', async () => {
    const result = await runQueueScenario('clientCap', {
        MAX_CONCURRENT_SLICES: '1',
        MAX_SLICE_QUEUE_LENGTH: '10',
        MAX_SLICE_QUEUE_PER_IP: '2'
    });

    assert.equal(result.whileBlocked.activeJobs, 1);
    assert.equal(result.whileBlocked.queueLength, 2);
    assert.equal(result.rejected.name, 'SliceQueueClientLimitError');
    assert.equal(result.rejected.status, 429);
    assert.equal(result.rejected.errorCode, 'SLICE_QUEUE_CLIENT_LIMIT');
    assert.deepEqual(result.rejected.response, {
        status: 429,
        body: {
            success: false,
            error: result.rejected.message,
            errorCode: 'SLICE_QUEUE_CLIENT_LIMIT'
        }
    });
    assert.deepEqual(result.results, ['first', 'second', 'other']);
    assertDrained(result.finalStatus);
});

test('queue rejects overflow without running the rejected task', async () => {
    const result = await runQueueScenario('overflow', {
        MAX_CONCURRENT_SLICES: '1',
        MAX_SLICE_QUEUE_LENGTH: '2',
        MAX_SLICE_QUEUE_PER_IP: '10'
    });

    assert.equal(result.whileBlocked.activeJobs, 1);
    assert.equal(result.whileBlocked.queueLength, 2);
    assert.equal(result.rejected.name, 'SliceQueueFullError');
    assert.equal(result.rejected.status, 503);
    assert.equal(result.rejected.errorCode, 'SLICE_QUEUE_FULL');
    assert.deepEqual(result.results, ['active', 'queued-1', 'queued-2']);
    assertDrained(result.finalStatus);
});

test('queue maps typed and supported legacy errors to stable API payloads', async () => {
    const result = await runQueueScenario('mapping', {
        MAX_CONCURRENT_SLICES: '1',
        MAX_SLICE_QUEUE_LENGTH: '2',
        MAX_SLICE_QUEUE_PER_IP: '2'
    });

    assert.deepEqual(
        result.typed.map(({ name, status, errorCode, response }) => ({ name, status, errorCode, responseCode: response.body.errorCode })),
        [
            { name: 'SliceQueueFullError', status: 503, errorCode: 'SLICE_QUEUE_FULL', responseCode: 'SLICE_QUEUE_FULL' },
            { name: 'SliceQueueClientLimitError', status: 429, errorCode: 'SLICE_QUEUE_CLIENT_LIMIT', responseCode: 'SLICE_QUEUE_CLIENT_LIMIT' },
            { name: 'SliceQueueTimeoutError', status: 503, errorCode: 'SLICE_QUEUE_TIMEOUT', responseCode: 'SLICE_QUEUE_TIMEOUT' }
        ]
    );
    assert.deepEqual(
        result.legacy.map(({ status, body }) => ({ status, errorCode: body.errorCode })),
        [
            { status: 503, errorCode: 'SLICE_QUEUE_FULL' },
            { status: 429, errorCode: 'SLICE_QUEUE_CLIENT_LIMIT' },
            { status: 503, errorCode: 'SLICE_QUEUE_TIMEOUT' }
        ]
    );
    assert.equal(result.unknown, null);
});
