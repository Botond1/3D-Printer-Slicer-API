'use strict';

/** Cached, admission-aware readiness state and required probes. */

const fs = require('node:fs');
const { MAX_CONCURRENT_SLICES_RANGE } = require('../config/constants');
const {
    APP_ROOT,
    CONFIGS_DIR,
    OUTPUT_DIR,
    PRUSA_CONFIGS_DIR,
    ORCA_CONFIGS_DIR,
    PRICING_STATE_DIR
} = require('../config/paths');
const { getPricing } = require('./pricing.service');
const { getQueueStatus } = require('./slice/queue');
const { getNativeRuntimeStatus } = require('./slice/native-runtime-status');
const { emitEvent } = require('./observability/events');
const metrics = require('./observability/metrics');

const DEFAULT_CACHE_MS = 5000;
const READINESS_REASON_ORDER = Object.freeze([
    'SHUTDOWN',
    'ADMISSION_CLOSED',
    'QUEUE_UNAVAILABLE',
    'NATIVE_RUNTIME_QUARANTINED',
    'STORAGE_UNSAFE',
    'RETENTION_UNSAFE',
    'PRICING_UNAVAILABLE',
    'CONFIG_UNSAFE'
]);

function nativeRuntimeHealthy(native) {
    return native?.available === true && native?.quarantined === false;
}

function directoryHealthy(directory) {
    try {
        const stats = fs.lstatSync(directory);
        return stats.isDirectory() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function directoryWritable(directory) {
    if (!directoryHealthy(directory)) return false;
    try {
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function directoryImmutable(directory, enforce) {
    if (!directoryHealthy(directory)) return false;
    if (!enforce) return true;
    try {
        fs.accessSync(directory, fs.constants.W_OK);
        return false;
    } catch {
        return true;
    }
}

function pricingHealthy(pricing) {
    return Boolean(
        pricing
        && typeof pricing.FDM === 'object'
        && typeof pricing.SLA === 'object'
        && Object.keys(pricing.FDM).length
        && Object.keys(pricing.SLA).length
    );
}

function createReadinessService(options = {}) {
    const clock = options.clock || Date.now;
    const cacheMs = Number.isSafeInteger(options.cacheMs) ? options.cacheMs : DEFAULT_CACHE_MS;
    const queueStatus = options.getQueueStatus || getQueueStatus;
    const nativeStatus = options.getNativeRuntimeStatus || getNativeRuntimeStatus;
    const readPricing = options.getPricing || getPricing;
    const shuttingDown = options.isShuttingDown || (() => false);
    const legacyMigration = options.legacyMigration || Object.freeze({
        enabled: false, audience: null, expiresAt: null
    });
    const probesOverride = options.probes || {};
    const enforceImmutable = options.production === true
        || (options.production === undefined && process.env.NODE_ENV === 'production');
    let admissionOpen = true;
    let retentionHealthy = options.retentionHealthy !== false;
    let cache;

    function closeAdmission(reason = 'shutdown') {
        if (!admissionOpen) return;
        admissionOpen = false;
        cache = undefined;
        metrics.setReadiness(false);
        metrics.setShutdownState(reason === 'shutdown');
        emitEvent('readiness.changed', {
            outcome: 'unavailable',
            error_code: reason === 'shutdown' ? 'SHUTDOWN' : 'ADMISSION_CLOSED'
        });
    }

    /**
     * Record the outcome of one artifact retention sweep.
     * A sweep that could not satisfy the quota flips `RETENTION_UNSAFE`; the
     * next sweep that satisfies it clears the reason again. The readiness
     * cache is invalidated either way so `/ready` reflects the latest sweep.
     * @param {{quotaSatisfied?: boolean} | boolean | null | undefined} summary Sweep summary or a bare boolean.
     * @returns {boolean} The retention health now in effect.
     */
    function recordRetentionResult(summary) {
        retentionHealthy = typeof summary === 'boolean'
            ? summary
            : summary?.quotaSatisfied === true;
        cache = undefined;
        return retentionHealthy;
    }

    function runProbes() {
        const queue = queueStatus();
        const native = nativeStatus();
        const probes = Object.freeze({
            queue: probesOverride.queue?.() ?? Boolean(
                queue
                && Number.isSafeInteger(queue.queueLength)
                && queue.queueLength >= 0
                && Number.isSafeInteger(queue.activeJobs)
                && queue.activeJobs >= 0
                && Number.isSafeInteger(queue.maxConcurrent)
                && queue.maxConcurrent >= MAX_CONCURRENT_SLICES_RANGE.min
                && queue.maxConcurrent <= MAX_CONCURRENT_SLICES_RANGE.max
                && queue.activeJobs <= queue.maxConcurrent
                && Number.isSafeInteger(queue.maxQueueLength)
                && queue.maxQueueLength > 0
                && queue.acceptingJobs === true
                && queue.queueLength <= queue.maxQueueLength
            ),
            native: nativeRuntimeHealthy(native) && (probesOverride.native?.() ?? true),
            storage: probesOverride.storage?.() ?? (
                directoryWritable(OUTPUT_DIR) && directoryWritable(PRICING_STATE_DIR)
            ),
            retention: probesOverride.retention?.() ?? retentionHealthy,
            pricing: probesOverride.pricing?.() ?? pricingHealthy(readPricing()),
            config: probesOverride.config?.() ?? (
                directoryHealthy(CONFIGS_DIR)
                && directoryHealthy(PRUSA_CONFIGS_DIR)
                && directoryHealthy(ORCA_CONFIGS_DIR)
                && directoryImmutable(APP_ROOT, enforceImmutable)
                && directoryImmutable(PRUSA_CONFIGS_DIR, enforceImmutable)
                && directoryImmutable(ORCA_CONFIGS_DIR, enforceImmutable)
            )
        });
        const ready = admissionOpen && !shuttingDown() && Object.values(probes).every(Boolean);
        const reasonCodes = [];
        if (shuttingDown()) reasonCodes.push('SHUTDOWN');
        else if (!admissionOpen) reasonCodes.push('ADMISSION_CLOSED');
        if (!probes.queue) reasonCodes.push('QUEUE_UNAVAILABLE');
        if (!probes.native) reasonCodes.push('NATIVE_RUNTIME_QUARANTINED');
        if (!probes.storage) reasonCodes.push('STORAGE_UNSAFE');
        if (!probes.retention) reasonCodes.push('RETENTION_UNSAFE');
        if (!probes.pricing) reasonCodes.push('PRICING_UNAVAILABLE');
        if (!probes.config) reasonCodes.push('CONFIG_UNSAFE');
        metrics.setReadiness(ready);
        metrics.setQueueStatus(queue);
        return Object.freeze({
            checkedAt: new Date(clock()).toISOString(),
            ready,
            admissionOpen: admissionOpen && !shuttingDown(),
            probes,
            reasonCodes: Object.freeze(reasonCodes),
            queue: Object.freeze({ ...queue, acceptingJobs: queue.acceptingJobs }),
            legacyMigration
        });
    }

    function getStatus() {
        const now = clock();
        if (!cache || now - cache.cachedAt >= cacheMs) {
            cache = { cachedAt: now, value: runProbes() };
            return cache.value;
        }
        if (nativeRuntimeHealthy(nativeStatus())) {
            metrics.setReadiness(cache.value.ready);
            return cache.value;
        }
        const probes = Object.freeze({ ...cache.value.probes, native: false });
        const reasonCodes = Object.freeze([
            ...new Set([...cache.value.reasonCodes, 'NATIVE_RUNTIME_QUARANTINED'])
        ].sort((left, right) => (
            READINESS_REASON_ORDER.indexOf(left) - READINESS_REASON_ORDER.indexOf(right)
        )));
        metrics.setReadiness(false);
        return Object.freeze({
            ...cache.value,
            ready: false,
            probes,
            reasonCodes
        });
    }

    function getFreshStatus() {
        return runProbes();
    }

    return Object.freeze({
        closeAdmission,
        getFreshStatus,
        getStatus,
        isAdmissionOpen: () => admissionOpen && !shuttingDown(),
        isRetentionHealthy: () => retentionHealthy,
        recordRetentionResult
    });
}

module.exports = {
    DEFAULT_CACHE_MS,
    createReadinessService,
    directoryHealthy,
    directoryImmutable,
    directoryWritable,
    pricingHealthy
};
