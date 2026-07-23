'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadCommonJsFromSource } = require('./helpers/load-commonjs-from-source');

const ROOT = path.resolve(__dirname, '../../..');
const PATHS = Object.freeze({
    response: path.join(ROOT, 'app/services/slice/response.js'),
    output: path.join(ROOT, 'app/services/slice/workspace-output.js'),
    admin: path.join(ROOT, 'app/services/admin-output.service.js'),
    system: path.join(ROOT, 'app/routes/system.routes.js'),
    metrics: path.join(ROOT, 'app/services/observability/metrics.js'),
    readiness: path.join(ROOT, 'app/services/readiness.service.js')
});
const read = (name) => fs.readFileSync(PATHS[name], 'utf8');

function validateCorrelation(sources) {
    assert.match(sources.response, /job_id: context\.jobId,/);
    assert.match(sources.response, /artifact_id: context\.artifactId,/);
    assert.match(sources.output,
        /emitEvent\('artifact\.promoted', \{\s*job_id: record\.jobId,\s*artifact_id: record\.artifactId,/);
    assert.equal((sources.output.match(/job_id: record\.jobId,/g) || []).length, 2);
    assert.match(sources.output,
        /return \{\s*jobId: record\.jobId,\s*artifactId: record\.artifactId,\s*fileName: record\.fileName/);
    assert.match(sources.admin,
        /\.\.\.\(file\.artifactId \? \{ artifact_id: file\.artifactId, job_id: file\.jobId \} : \{\}\)/);
}

function validateMetricsAuthorization(source) {
    assert.match(source,
        /router\.get\('\/operations\/readiness', adminRateLimiter, authenticateOperations,/);
    assert.match(source,
        /router\.get\('\/operations\/metrics', adminRateLimiter, authenticateOperations,/);
    assert.match(source, /router\.get\('\/ready', \(req, res\) =>/);
}

function validateMetrics(module) {
    module.resetMetricsForTests();
    module.incrementRequest('slice",request_id="attacker', 'invented');
    module.incrementAuthRejection('unbounded-user-audience');
    module.recordQueueRejection('customer-reason');
    module.incrementResourceFailure('customer-message');
    const rendered = module.renderMetrics();
    assert.doesNotMatch(rendered, /attacker|request_id|unbounded|customer/);
    assert.match(rendered, /audience="public",outcome="server_error"/);
    assert.ok(Buffer.byteLength(rendered) < 16 * 1024);
    assert.ok(rendered.split('\n').length < 128);
}

function createReadiness(module, { shuttingDown = false, quarantined = false } = {}) {
    return module.createReadinessService({
        clock: () => 0,
        cacheMs: 1,
        isShuttingDown: () => shuttingDown,
        getQueueStatus: () => ({
            queueLength: 0, activeJobs: 0, maxQueueLength: 1, acceptingJobs: true
        }),
        getNativeRuntimeStatus: () => ({ available: true, quarantined }),
        probes: {
            queue: () => true,
            storage: () => true,
            retention: () => true,
            pricing: () => true,
            config: () => true
        }
    }).getStatus();
}

function validateReadiness(module) {
    const shutdown = createReadiness(module, { shuttingDown: true });
    assert.equal(shutdown.ready, false);
    assert.deepEqual(shutdown.reasonCodes, ['SHUTDOWN']);
    const quarantine = createReadiness(module, { quarantined: true });
    assert.equal(quarantine.ready, false);
    assert.deepEqual(quarantine.reasonCodes, ['NATIVE_RUNTIME_QUARANTINED']);
}

function mutate(name, from, to) {
    const original = read(name);
    assert.ok(original.includes(from), `missing I5 runtime mutation anchor: ${from}`);
    return original.replace(from, to);
}

test('job and artifact correlation mutations fail the cross-surface contract', async (t) => {
    const sources = {
        response: read('response'),
        output: read('output'),
        admin: read('admin')
    };
    validateCorrelation(sources);
    const cases = [
        ['slice response loses job correlation', 'response',
            'job_id: context.jobId,', 'job_id: undefined,'],
        ['slice response loses artifact correlation', 'response',
            'artifact_id: context.artifactId,', 'artifact_id: undefined,'],
        ['promotion event loses job correlation', 'output',
            'job_id: record.jobId,', 'job_id: undefined,'],
        ['artifact listing loses correlation', 'admin',
            '{ artifact_id: file.artifactId, job_id: file.jobId }',
            '{ artifact_id: file.artifactId }']
    ];
    for (const [name, file, from, to] of cases) await t.test(name, () => {
        assert.throws(() => validateCorrelation({
            ...sources,
            [file]: mutate(file, from, to)
        }), assert.AssertionError);
    });
});

test('metrics authentication and cardinality mutations fail', async (t) => {
    const system = read('system');
    validateMetricsAuthorization(system);
    await t.test('metrics route loses operations authentication', () => {
        assert.throws(() => validateMetricsAuthorization(mutate('system',
            "router.get('/operations/metrics', adminRateLimiter, authenticateOperations,",
            "router.get('/operations/metrics', adminRateLimiter,"
        )), assert.AssertionError);
    });
    await t.test('attacker values become metric labels', () => {
        const mutated = mutate('metrics',
            'return values.includes(value) ? value : fallback;',
            'return String(value);');
        assert.throws(() => validateMetrics(
            loadCommonJsFromSource(PATHS.metrics, mutated)
        ), assert.AssertionError);
    });
});

test('shutdown and native-quarantine readiness mutations fail', async (t) => {
    const live = require(PATHS.readiness);
    validateReadiness(live);
    const cases = [
        ['shutdown ignored',
            'const ready = admissionOpen && !shuttingDown() && Object.values(probes).every(Boolean);',
            'const ready = admissionOpen && Object.values(probes).every(Boolean);'],
        ['native quarantine ignored',
            'native?.available === true && native?.quarantined === false',
            'native?.available === true']
    ];
    for (const [name, from, to] of cases) await t.test(name, () => {
        const module = loadCommonJsFromSource(PATHS.readiness,
            mutate('readiness', from, to));
        assert.throws(() => validateReadiness(module), assert.AssertionError);
    });
});
