const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function assertNearestRuleStatus(source, errorCode, expectedStatus) {
    const marker = `errorCode: '${errorCode}'`;
    const markerIndex = source.indexOf(marker);
    assert.notEqual(markerIndex, -1, `Missing ${errorCode}`);
    const prefix = source.slice(Math.max(0, markerIndex - 500), markerIndex);
    const statusMatches = [...prefix.matchAll(/status:\s*(\d+)/g)];
    assert.ok(statusMatches.length > 0, `Missing rule status near ${errorCode}`);
    assert.equal(Number(statusMatches.at(-1)[1]), expectedStatus, errorCode);
}

test('queue source retains typed stable status/error-code metadata', () => {
    const source = readSource('app/services/slice/queue.js');
    assert.match(
        source,
        /class SliceQueueFullError[\s\S]{0,300}?super\([^;]+, 503, 'SLICE_QUEUE_FULL'\);/
    );
    assert.match(
        source,
        /class SliceQueueTimeoutError[\s\S]{0,300}?super\([^;]+, 503, 'SLICE_QUEUE_TIMEOUT'\);/
    );
    assert.match(
        source,
        /class SliceQueueClientLimitError[\s\S]{0,300}?super\([^;]+, 429, 'SLICE_QUEUE_CLIENT_LIMIT'\);/
    );
});

function count(source, pattern) {
    return (source.match(pattern) || []).length;
}

function validateS1bSources(sources) {
    const { scheduler, service, response, requestAbort, route } = sources;
    assert.match(scheduler, /startDeadline\(job\);/);
    assert.match(scheduler, /config\.setTimeout\([\s\S]{0,180}?config\.createTimeoutError\(\)/);
    assert.match(scheduler, /deadlineTimer\?\.unref\?\.\(\)/);
    assert.match(scheduler, /queuedJobs\.splice\(index, 1\)/);
    assert.match(scheduler, /rejectQueuedJob\(job, abortReason\(controller\.signal\)\)/);
    assert.equal(count(scheduler, /decrement\(queuedByKey, job\.queueKey\);/g), 2);
    assert.equal(count(scheduler, /cleanJobResources\(job\);/g), 2);
    assert.equal(count(scheduler, /job\.task\(job\.controller\.signal\)/g), 2);
    assert.match(scheduler, /if \(job\.controller\.signal\.aborted\) job\.reject\(abortReason\(job\.controller\.signal\)\)/);
    assert.match(scheduler, /job\.controller\.abort\(abortReason\(job\.externalSignal\)\)/);
    assert.match(scheduler,
        /if \(shuttingDown\) return rejectAdmission\(config\.createShutdownError\(\), correlation\)/);
    assert.match(scheduler, /while \(!shuttingDown && activeJobs\.size < config\.maxConcurrent/);
    assert.match(scheduler, /for \(const job of \[\.\.\.queuedJobs, \.\.\.activeJobs\]\)/);
    assert.match(service, /const taskSignal = effectiveSignal \|\| binding\.signal/);
    assert.match(service, /process\(req, res, \{ forcedTechnology, engine, signal: taskSignal \}\)/);
    assert.match(service, /if \(isResponseWritable\(res\) && !binding\.signal\.aborted\)/);
    assert.equal(count(service, /settlementError = await safelyAwaitResponseSettlement\(/g), 1);
    assert.match(response, /if \(signal\?\.aborted\) return Promise\.reject\(abortReason\(signal\)\)/);
    assert.match(response, /signal\?\.removeEventListener\('abort', onAbort\)/);
    assert.match(requestAbort, /req\?\.destroyed && req\?\.complete !== true/);
    assert.match(requestAbort, /addListener\(registrations, req, 'aborted', abort\)/);
    assert.match(requestAbort, /addListener\(registrations, req\?\.socket, 'error', onError\)/);
    assert.match(requestAbort, /addListener\(registrations, res, 'close', onClose\)/);
    assert.equal(count(route, /cleanupError = await finalizeLifecycle\(/g), 1);
}

test('S1b source contracts reject deadline, abort, shutdown, response, counter, and cleanup mutations', async (t) => {
    const sources = {
        scheduler: readSource('app/services/slice/queue-scheduler.js'),
        service: readSource('app/services/slice.service.js'),
        response: readSource('app/services/slice/response-lifecycle.js'),
        requestAbort: readSource('app/services/slice/request-abort.js'),
        route: readSource('app/routes/slice.routes.js')
    };
    validateS1bSources(sources);
    const mutations = [
        ['deadline timer removed', 'scheduler', '        startDeadline(job);', ''],
        ['timeout leaves exact job queued', 'scheduler', 'rejectQueuedJob(job, abortReason(controller.signal))', 'job.reject(abortReason(controller.signal))'],
        ['timer/listener terminal cleanup removed', 'scheduler', '        cleanJobResources(job);', ''],
        ['queued counter double decrement', 'scheduler', '        decrement(queuedByKey, job.queueKey);', '        decrement(queuedByKey, job.queueKey);\n        decrement(queuedByKey, job.queueKey);'],
        ['active abort releases through settlement', 'scheduler', 'job.controller.abort(abortReason(job.externalSignal))', "settleActiveJob(job, 'reject', abortReason(job.externalSignal))"],
        ['task AbortSignal omitted', 'scheduler', 'job.task(job.controller.signal)', 'job.task()'],
        ['abort-after-success accepted', 'scheduler', 'if (job.controller.signal.aborted) job.reject(abortReason(job.controller.signal))', "if (outcome === 'resolve') job.resolve(value)"],
        ['disconnected response write admitted', 'service', 'if (isResponseWritable(res) && !binding.signal.aborted)', 'if (true)'],
        ['shutdown admission reopened', 'scheduler',
            'if (shuttingDown) return rejectAdmission(config.createShutdownError(), correlation)',
            'if (false) return rejectAdmission(config.createShutdownError(), correlation)'],
        ['shutdown starts queued work', 'scheduler', 'while (!shuttingDown && activeJobs.size < config.maxConcurrent', 'while (activeJobs.size < config.maxConcurrent'],
        ['route cleanup no longer awaits safe settlement', 'service', 'settlementError = await safelyAwaitResponseSettlement(', 'settlementError = safelyAwaitResponseSettlement('],
        ['route cleanup duplicated', 'route', 'cleanupError = await finalizeLifecycle(', 'cleanupError = await finalizeLifecycle(\n                    {});\n                cleanupError = await finalizeLifecycle(']
    ];

    for (const [name, key, from, to] of mutations) {
        await t.test(name, () => {
            assert.ok(sources[key].includes(from), `Mutation seam missing: ${name}`);
            const mutated = { ...sources, [key]: sources[key].replace(from, to) };
            assert.throws(() => validateS1bSources(mutated), assert.AssertionError);
        });
    }
});

test('global error-handler source retains selected middleware mappings', () => {
    const source = readSource('app/middleware/errorHandler.js');
    for (const code of [
        'PRICING_CORS_ORIGIN_NOT_ALLOWED',
        'ARTIFACT_CORS_ORIGIN_NOT_ALLOWED',
        'OPERATIONS_CORS_ORIGIN_NOT_ALLOWED'
    ]) {
        assert.match(source, new RegExp(`\\['${code}',`));
    }
    assert.match(source, /\.map\(\(\[errorCode, message\]\) => \(\{[\s\S]{0,160}?status: 403,/);
    assertNearestRuleStatus(source, 'INVALID_JSON_BODY', 400);
    assertNearestRuleStatus(source, 'PAYLOAD_TOO_LARGE', 413);
    assertNearestRuleStatus(source, 'UPLOADED_FILE_TOO_LARGE', 413);
    assertNearestRuleStatus(source, 'UNEXPECTED_FILE_FIELD', 400);
    assertNearestRuleStatus(source, 'UNSUPPORTED_FILE_FORMAT', 400);
    assertNearestRuleStatus(source, 'UPLOAD_ERROR', 400);
    assert.match(source, /Unexpected file field\. Use "choosenFile" for uploads\./);
});
