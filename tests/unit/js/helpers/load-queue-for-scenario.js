const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const QUEUE_MODULE_PATH = path.join(REPO_ROOT, 'app/services/slice/queue.js');
const QUEUE_SCHEDULER_PATH = path.join(REPO_ROOT, 'app/services/slice/queue-scheduler.js');
const {
    loadCommonJsFromSource
} = require('./load-commonjs-from-source');

function loadQueueForScenario() {
    const mutation = String(process.env.QUEUE_TEST_MUTATION || '').trim();
    if (!mutation) return require(QUEUE_MODULE_PATH);
    if (mutation !== 'reject-then-run') {
        throw new Error(`Unknown queue test mutation: ${mutation}`);
    }

    const source = fs.readFileSync(QUEUE_SCHEDULER_PATH, 'utf8').replace(/\r\n?/g, '\n');
    let mutatedSource = source.replace(
        '        if (queuedJobs.length >= config.maxQueueLength) {\n'
            + '            return rejectAdmission(config.createFullError(), correlation);\n'
            + '        }',
        'if (queuedJobs.length >= config.maxQueueLength) {\n'
            + '            Promise.resolve().then(() => task());\n'
            + '            return rejectAdmission(config.createFullError(), correlation);\n'
            + '        }'
    );
    mutatedSource = mutatedSource.replace(
        '            return rejectAdmission(config.createClientLimitError(), correlation);',
        '            Promise.resolve().then(() => task());\n'
            + '            return rejectAdmission(config.createClientLimitError(), correlation);'
    );

    if (mutatedSource === source || !mutatedSource.includes('Promise.resolve().then(() => task());')) {
        throw new Error('Reject-then-run queue mutation seam did not apply.');
    }

    const mutatedScheduler = loadCommonJsFromSource(QUEUE_SCHEDULER_PATH, mutatedSource);
    const cachedScheduler = require.cache[QUEUE_SCHEDULER_PATH];
    require.cache[QUEUE_SCHEDULER_PATH] = {
        id: QUEUE_SCHEDULER_PATH,
        filename: QUEUE_SCHEDULER_PATH,
        loaded: true,
        exports: mutatedScheduler
    };
    try {
        return loadCommonJsFromSource(
            QUEUE_MODULE_PATH,
            fs.readFileSync(QUEUE_MODULE_PATH, 'utf8')
        );
    } finally {
        if (cachedScheduler) require.cache[QUEUE_SCHEDULER_PATH] = cachedScheduler;
        else delete require.cache[QUEUE_SCHEDULER_PATH];
    }
}

module.exports = {
    loadQueueForScenario
};
