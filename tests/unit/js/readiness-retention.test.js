'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadinessService } = require('../../../app/services/readiness.service');

function healthyQueue() {
    return {
        queueLength: 0,
        activeJobs: 0,
        maxConcurrent: 1,
        maxQueueLength: 100,
        maxQueuePerClient: 5,
        acceptingJobs: true
    };
}

function createService(options = {}) {
    let now = 0;
    const service = createReadinessService({
        clock: () => now,
        cacheMs: 5_000,
        getQueueStatus: healthyQueue,
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        getPricing: () => ({ FDM: { PLA: 800 }, SLA: { Standard: 1800 } }),
        probes: { storage: () => true, config: () => true },
        ...options
    });
    return { service, advance: (ms) => { now += ms; } };
}

test('a failed retention sweep flips RETENTION_UNSAFE at runtime and a later success clears it', () => {
    const { service } = createService();
    assert.equal(service.getStatus().ready, true);
    assert.equal(service.isRetentionHealthy(), true);

    assert.equal(service.recordRetentionResult({ quotaSatisfied: false, failed: 1 }), false);
    const unsafe = service.getStatus();
    assert.equal(unsafe.ready, false);
    assert.deepEqual(unsafe.reasonCodes, ['RETENTION_UNSAFE']);
    assert.equal(unsafe.probes.retention, false);
    assert.equal(service.isRetentionHealthy(), false);

    assert.equal(service.recordRetentionResult({ quotaSatisfied: true, failed: 0 }), true);
    const recovered = service.getStatus();
    assert.equal(recovered.ready, true);
    assert.deepEqual(recovered.reasonCodes, []);
    assert.equal(recovered.probes.retention, true);
});

test('recording a retention result bypasses the bounded readiness cache in both directions', () => {
    const { service } = createService();
    const cached = service.getStatus();
    assert.equal(cached.ready, true);
    service.recordRetentionResult({ quotaSatisfied: false });
    assert.notEqual(service.getStatus(), cached, 'the cache is invalidated by the sweep result');
    assert.equal(service.getStatus().ready, false);
    service.recordRetentionResult(true);
    assert.equal(service.getStatus().ready, true);
    assert.equal(service.getFreshStatus().probes.retention, true);
});

test('malformed or missing sweep summaries fail closed', () => {
    const { service } = createService();
    for (const summary of [undefined, null, {}, { quotaSatisfied: 'yes' }, { quotaSatisfied: 1 }, false]) {
        assert.equal(service.recordRetentionResult(summary), false, JSON.stringify(summary));
        assert.deepEqual(service.getStatus().reasonCodes, ['RETENTION_UNSAFE']);
    }
});
