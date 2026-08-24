'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n?/g, '\n');
}

function validateConcurrencySources(sources) {
    assert.match(sources.constants,
        /MAX_CONCURRENT_SLICES_RANGE = Object\.freeze\(\{ min: 1, max: 3 \}\)/);
    assert.match(sources.policy,
        /\n    MAX_CONCURRENT_SLICES: \{[\s\S]{0,180}?default: DEFAULTS\.MAX_CONCURRENT_SLICES,[\s\S]{0,180}?min: MAX_CONCURRENT_SLICES_RANGE\.min,[\s\S]{0,180}?max: MAX_CONCURRENT_SLICES_RANGE\.max/);
    assert.match(sources.queue,
        /parseBoundedPositiveInt\([\s\S]{0,180}?process\.env\.MAX_CONCURRENT_SLICES,[\s\S]{0,180}?MAX_CONCURRENT_SLICES_RANGE/);
    assert.match(sources.queue, /value >= MAX_CONCURRENT_SLICES_RANGE\.min/);
    assert.match(sources.queue, /value <= MAX_CONCURRENT_SLICES_RANGE\.max/);
    assert.match(sources.scheduler,
        /function runNextSliceJob\(\) \{\s*if \(!runtimeAvailable\(\)\) \{\s*void beginSliceQueueShutdown\(\);\s*return;\s*\}/);
    assert.match(sources.scheduler,
        /config\.subscribeToRuntimeQuarantine\?\.\(\(\) => \{\s*void beginSliceQueueShutdown\(\);\s*\}\)/);
    assert.match(sources.scheduler,
        /function closeRuntimeSubscription\(\)[\s\S]{0,300}?unsubscribeRuntimeQuarantine\?\.\(\)/);
    assert.match(sources.scheduler,
        /resolveShutdown = undefined;\s*closeRuntimeSubscription\(\);\s*resolve\(\)/);
    assert.match(sources.scheduler,
        /if \(typeof unsubscribe === 'function'\)[\s\S]{0,300}?unsubscribeRuntimeQuarantine = unsubscribe/);
    assert.match(sources.scheduler,
        /const available = runtimeAvailable\(\);\s*if \(shuttingDown \|\| !available\) \{\s*void beginSliceQueueShutdown\(\);\s*return rejectAdmission\(config\.createShutdownError\(\), correlation\);\s*\}/);
    assert.match(sources.scheduler,
        /function getQueueStatus\(\) \{\s*const available = runtimeAvailable\(\);[\s\S]{0,500}?value: !shuttingDown && available/);
    assert.match(sources.readiness,
        /queue\.maxConcurrent >= MAX_CONCURRENT_SLICES_RANGE\.min/);
    assert.match(sources.readiness,
        /queue\.maxConcurrent <= MAX_CONCURRENT_SLICES_RANGE\.max/);
    assert.match(sources.readiness, /queue\.activeJobs <= queue\.maxConcurrent/);
}

test('concurrency and quarantine mutations fail the direct-source contract', async (t) => {
    const sources = {
        constants: read('app/config/constants.js'),
        policy: read('app/config/resource-policy.js'),
        queue: read('app/services/slice/queue.js'),
        scheduler: read('app/services/slice/queue-scheduler.js'),
        readiness: read('app/services/readiness.service.js')
    };
    validateConcurrencySources(sources);
    const cases = [
        ['upper bound raised', 'constants', 'min: 1, max: 3', 'min: 1, max: 4'],
        ['startup policy removed', 'policy', '    MAX_CONCURRENT_SLICES: {', '    REMOVED_MAX_CONCURRENT_SLICES: {'],
        ['canonical environment parser removed', 'queue', 'parseBoundedPositiveInt(', 'parsePositiveInt('],
        ['factory lower cap removed', 'queue', 'value >= MAX_CONCURRENT_SLICES_RANGE.min', 'true'],
        ['factory upper cap removed', 'queue', 'value <= MAX_CONCURRENT_SLICES_RANGE.max', 'true'],
        ['dequeue runtime guard removed', 'scheduler',
            'function runNextSliceJob() {\n        if (!runtimeAvailable()) {',
            'function runNextSliceJob() {\n        if (false) {'],
        ['dynamic quarantine subscription removed', 'scheduler',
            'config.subscribeToRuntimeQuarantine?.(() => {', 'config.removedSubscription?.(() => {'],
        ['quarantine subscription settlement teardown removed', 'scheduler',
            '        closeRuntimeSubscription();\n        resolve();',
            '        resolve();'],
        ['quarantine unsubscribe ownership discarded', 'scheduler',
            '            unsubscribeRuntimeQuarantine = unsubscribe;',
            '            void unsubscribe;'],
        ['runtime admission guard removed', 'scheduler',
            'if (shuttingDown || !available) {\n            void beginSliceQueueShutdown();\n'
                + '            return rejectAdmission(config.createShutdownError(), correlation);\n        }',
            'if (shuttingDown || !available) {\n            void beginSliceQueueShutdown();\n'
                + '            return new Promise(() => {});\n        }'],
        ['accepting status ignores quarantine', 'scheduler',
            'value: !shuttingDown && available', 'value: available'],
        ['readiness upper bound removed', 'readiness',
            'queue.maxConcurrent <= MAX_CONCURRENT_SLICES_RANGE.max', 'true'],
        ['readiness lower bound removed', 'readiness',
            'queue.maxConcurrent >= MAX_CONCURRENT_SLICES_RANGE.min', 'true'],
        ['readiness active cap removed', 'readiness',
            'queue.activeJobs <= queue.maxConcurrent', 'true']
    ];
    for (const [name, key, from, to] of cases) await t.test(name, () => {
        assert.ok(sources[key].includes(from), `missing mutation anchor: ${name}`);
        const mutated = { ...sources, [key]: sources[key].replace(from, to) };
        assert.throws(() => validateConcurrencySources(mutated), assert.AssertionError);
    });
});
