const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const queue = require(path.join(REPO_ROOT, 'app/services/slice/queue'));

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function serializeError(error) {
    return {
        name: error.name,
        message: error.message,
        status: error.status,
        errorCode: error.errorCode,
        response: queue.toQueueErrorResponse(error)
    };
}

async function flushQueueFinalizers() {
    await new Promise((resolve) => setImmediate(resolve));
}

async function runFifoScenario() {
    const firstGate = deferred();
    const starts = [];

    const jobs = [
        queue.enqueueSliceJob(async () => {
            starts.push('first');
            await firstGate.promise;
            return 'first-result';
        }, { queueKey: 'client-a' }),
        queue.enqueueSliceJob(async () => {
            starts.push('second');
            return 'second-result';
        }, { queueKey: 'client-b' }),
        queue.enqueueSliceJob(async () => {
            starts.push('third');
            return 'third-result';
        }, { queueKey: 'client-c' })
    ];

    const whileBlocked = queue.getQueueStatus();
    firstGate.resolve();
    const results = await Promise.all(jobs);
    await flushQueueFinalizers();

    return {
        starts,
        results,
        whileBlocked,
        finalStatus: queue.getQueueStatus()
    };
}

async function runConcurrencyScenario() {
    const firstGate = deferred();
    const secondGate = deferred();
    const thirdGate = deferred();
    const thirdStarted = deferred();
    const starts = [];
    let activeTasks = 0;
    let peakActiveTasks = 0;

    function gatedTask(name, gate, onStart = () => {}) {
        return async () => {
            starts.push(name);
            activeTasks += 1;
            peakActiveTasks = Math.max(peakActiveTasks, activeTasks);
            onStart();
            await gate.promise;
            activeTasks -= 1;
            return `${name}-result`;
        };
    }

    const first = queue.enqueueSliceJob(gatedTask('first', firstGate), { queueKey: 'client-a' });
    const second = queue.enqueueSliceJob(gatedTask('second', secondGate), { queueKey: 'client-b' });
    const third = queue.enqueueSliceJob(
        gatedTask('third', thirdGate, thirdStarted.resolve),
        { queueKey: 'client-c' }
    );

    const saturated = queue.getQueueStatus();
    secondGate.resolve();
    await thirdStarted.promise;
    const afterReplacement = queue.getQueueStatus();

    firstGate.resolve();
    thirdGate.resolve();
    const results = await Promise.all([first, second, third]);
    await flushQueueFinalizers();

    return {
        starts,
        results,
        saturated,
        afterReplacement,
        peakActiveTasks,
        finalStatus: queue.getQueueStatus()
    };
}

async function runClientCapScenario() {
    const firstGate = deferred();
    const accepted = [
        queue.enqueueSliceJob(async () => {
            await firstGate.promise;
            return 'first';
        }, { queueKey: 'same-client' }),
        queue.enqueueSliceJob(async () => 'second', { queueKey: 'same-client' }),
        queue.enqueueSliceJob(async () => 'other', { queueKey: 'other-client' })
    ];

    const rejected = await queue
        .enqueueSliceJob(async () => 'must-not-run', { queueKey: 'same-client' })
        .then(
            () => ({ unexpectedSuccess: true }),
            serializeError
        );
    const whileBlocked = queue.getQueueStatus();

    firstGate.resolve();
    const results = await Promise.all(accepted);
    await flushQueueFinalizers();

    return {
        rejected,
        results,
        whileBlocked,
        finalStatus: queue.getQueueStatus()
    };
}

async function runOverflowScenario() {
    const firstGate = deferred();
    const accepted = [
        queue.enqueueSliceJob(async () => {
            await firstGate.promise;
            return 'active';
        }, { queueKey: 'client-a' }),
        queue.enqueueSliceJob(async () => 'queued-1', { queueKey: 'client-b' }),
        queue.enqueueSliceJob(async () => 'queued-2', { queueKey: 'client-c' })
    ];

    const rejected = await queue
        .enqueueSliceJob(async () => 'must-not-run', { queueKey: 'client-d' })
        .then(
            () => ({ unexpectedSuccess: true }),
            serializeError
        );
    const whileBlocked = queue.getQueueStatus();

    firstGate.resolve();
    const results = await Promise.all(accepted);
    await flushQueueFinalizers();

    return {
        rejected,
        results,
        whileBlocked,
        finalStatus: queue.getQueueStatus()
    };
}

async function runMappingScenario() {
    const typedErrors = [
        new queue.SliceQueueFullError(),
        new queue.SliceQueueClientLimitError(),
        new queue.SliceQueueTimeoutError()
    ];

    return {
        typed: typedErrors.map(serializeError),
        legacy: [
            new Error('QUEUE_FULL| legacy full'),
            new Error('QUEUE_CLIENT_LIMIT| legacy client cap'),
            new Error('QUEUE_TIMEOUT| legacy timeout')
        ].map((error) => queue.toQueueErrorResponse(error)),
        unknown: queue.toQueueErrorResponse(new Error('unrelated failure'))
    };
}

const scenarios = {
    fifo: runFifoScenario,
    concurrency: runConcurrencyScenario,
    clientCap: runClientCapScenario,
    overflow: runOverflowScenario,
    mapping: runMappingScenario
};

async function main() {
    const scenarioName = process.argv[2];
    const scenario = scenarios[scenarioName];
    if (!scenario) {
        throw new Error(`Unknown queue scenario: ${scenarioName || '<missing>'}`);
    }

    const result = await scenario();
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
