const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const QUEUE_MODULE_PATH = path.join(REPO_ROOT, 'app/services/slice/queue.js');
const {
    loadCommonJsFromSource
} = require('./load-commonjs-from-source');

function loadQueueForScenario() {
    const mutation = String(process.env.QUEUE_TEST_MUTATION || '').trim();
    if (!mutation) return require(QUEUE_MODULE_PATH);
    if (mutation !== 'reject-then-run') {
        throw new Error(`Unknown queue test mutation: ${mutation}`);
    }

    const source = fs.readFileSync(QUEUE_MODULE_PATH, 'utf8');
    const rejectionPatterns = [
        /([ \t]*)reject\(new SliceQueueFullError\(\)\);/,
        /([ \t]*)reject\(new SliceQueueClientLimitError\(\)\);/
    ];
    let mutatedSource = source;

    for (const pattern of rejectionPatterns) {
        mutatedSource = mutatedSource.replace(pattern, (match, indentation) => (
            `${indentation}Promise.resolve().then(task);\n${match}`
        ));
    }

    if (mutatedSource === source || !mutatedSource.includes('Promise.resolve().then(task);')) {
        throw new Error('Reject-then-run queue mutation seam did not apply.');
    }

    return loadCommonJsFromSource(QUEUE_MODULE_PATH, mutatedSource);
}

module.exports = {
    loadQueueForScenario
};
