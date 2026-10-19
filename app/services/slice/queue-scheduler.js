/** Stateful scheduler for bounded FIFO slice queues. */

function abortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error('Slice job was aborted.');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

/** Rejection of a solo request that cannot be held (another holder, not active). */
function soloUnavailable(message) {
    const error = new Error(message);
    error.name = 'SliceSoloUnavailableError';
    error.code = 'SLICE_SOLO_UNAVAILABLE';
    return error;
}

function increment(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function decrement(map, key) {
    const next = (map.get(key) || 0) - 1;
    if (next > 0) map.set(key, next);
    else map.delete(key);
}

/**
 * Create the mutable scheduler behind the public queue facade.
 * @param {object} config Validated limits, clock, timers, and error factories.
 * @returns {object} Queue operations.
 */
function createQueueScheduler(config) {
    const queuedJobs = [];
    const activeJobs = new Set();
    const queuedByKey = new Map();
    const activeByKey = new Map();
    let shuttingDown = false;
    let shutdownPromise;
    let resolveShutdown;
    let unsubscribeRuntimeQuarantine;
    let runtimeSubscriptionClosed = false;
    /**
     * The one active job that asked to run alone (3.8.2): while it is set, no
     * queued job starts. `granted` once every other active job has settled;
     * the hold ends when the holder settles, aborts or the queue shuts down.
     */
    let solo = null;

    function closeRuntimeSubscription() {
        if (runtimeSubscriptionClosed) return;
        runtimeSubscriptionClosed = true;
        try {
            unsubscribeRuntimeQuarantine?.();
        } catch {
            // Queue settlement cannot depend on observer teardown.
        }
    }

    function runtimeAvailable() {
        if (typeof config.isRuntimeAvailable !== 'function') return true;
        try {
            return config.isRuntimeAvailable() === true;
        } catch {
            return false;
        }
    }

    function emitQueueEvent(eventName, data, correlation) {
        try {
            config.emitEvent?.(eventName, {
                request_id: correlation?.requestId,
                job_id: correlation?.jobId,
                audience: 'slice',
                ...data
            });
        } catch {
            // Queue ownership and settlement cannot depend on telemetry.
        }
    }

    function recordRejection(reason) {
        try {
            config.recordQueueRejection?.(reason);
        } catch {
            // Metrics cannot alter queue ownership or settlement.
        }
    }

    function rejectAdmission(error, correlation) {
        const reasonByCode = {
            SLICE_QUEUE_FULL: 'full',
            SLICE_QUEUE_CLIENT_LIMIT: 'client_limit',
            SLICE_QUEUE_SHUTDOWN: 'shutdown'
        };
        const reason = reasonByCode[error?.errorCode];
        if (reason) recordRejection(reason);
        emitQueueEvent('queue.rejected', {
            outcome: 'rejected',
            error_code: error?.errorCode || 'SLICE_QUEUE_REJECTED',
            extra: { reason: reason || 'admission' }
        }, correlation);
        return Promise.reject(error);
    }

    function totalForKey(key) {
        return (queuedByKey.get(key) || 0) + (activeByKey.get(key) || 0);
    }

    function clearDeadline(job) {
        if (job.deadlineTimer === undefined) return;
        config.clearTimeout(job.deadlineTimer);
        job.deadlineTimer = undefined;
    }

    function removeAbortListeners(job) {
        job.controller.signal.removeEventListener('abort', job.onEffectiveAbort);
        job.externalSignal?.removeEventListener('abort', job.onExternalAbort);
    }

    function cleanJobResources(job) {
        clearDeadline(job);
        removeAbortListeners(job);
    }

    function removeQueuedJob(job) {
        if (job.state !== 'queued') return false;
        const index = queuedJobs.indexOf(job);
        if (index < 0) return false;
        queuedJobs.splice(index, 1);
        decrement(queuedByKey, job.queueKey);
        return true;
    }

    function rejectQueuedJob(job, error) {
        if (!removeQueuedJob(job)) return;
        job.state = 'settled';
        cleanJobResources(job);
        if (error?.errorCode === 'SLICE_QUEUE_TIMEOUT') {
            recordRejection('timeout');
            emitQueueEvent('queue.expired', {
                outcome: 'expired',
                error_code: 'SLICE_QUEUE_TIMEOUT',
                duration_ms: Math.max(0, config.now() - job.enqueuedAt),
                extra: { reason: 'timeout' }
            }, job.correlation);
        } else if (error?.errorCode === 'SLICE_QUEUE_SHUTDOWN') {
            recordRejection('shutdown');
            emitQueueEvent('queue.rejected', {
                outcome: 'rejected',
                error_code: 'SLICE_QUEUE_SHUTDOWN',
                extra: { reason: 'shutdown' }
            }, job.correlation);
        }
        job.reject(error);
    }

    function forwardExternalAbort(job) {
        if (job.state === 'settled' || job.controller.signal.aborted) return;
        job.controller.abort(abortReason(job.externalSignal));
    }

    function resolveDrainIfReady() {
        if (!shuttingDown || activeJobs.size > 0 || !resolveShutdown) return;
        const resolve = resolveShutdown;
        resolveShutdown = undefined;
        closeRuntimeSubscription();
        resolve();
    }

    function releaseSolo(error) {
        if (!solo) return;
        const current = solo;
        solo = null;
        current.signal?.removeEventListener('abort', current.onAbort);
        if (!current.granted) current.reject(error);
    }

    /** Grant the pending solo request once its job is the only active one. */
    function grantSoloIfReady() {
        if (!solo || solo.granted) return;
        if (solo.job.state !== 'active') {
            releaseSolo(soloUnavailable('Slice job is no longer active.'));
            return;
        }
        if (activeJobs.size !== 1 || !activeJobs.has(solo.job)) return;
        solo.granted = true;
        solo.signal?.removeEventListener('abort', solo.onAbort);
        solo.resolve();
    }

    /**
     * Resolve once `job` is the only active job; meanwhile no queued job
     * starts. A second holder is refused instead of waiting (two active jobs
     * each waiting for the other would never run).
     */
    function awaitSolo(job, signal) {
        if (signal?.aborted) return Promise.reject(abortReason(signal));
        if (shuttingDown) return Promise.reject(config.createShutdownError());
        if (job.state !== 'active') return Promise.reject(soloUnavailable('Slice job is not active.'));
        if (solo && solo.job !== job) return Promise.reject(soloUnavailable('Another slice job already holds the queue alone.'));
        if (solo) return solo.promise;
        let settle;
        const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
        solo = { job, signal, promise, granted: false, resolve: settle.resolve, reject: settle.reject };
        const holder = solo;
        holder.onAbort = () => {
            if (solo !== holder || holder.granted) return;
            releaseSolo(abortReason(signal));
            if (!shuttingDown) runNextSliceJob();
        };
        signal?.addEventListener('abort', holder.onAbort, { once: true });
        grantSoloIfReady();
        return promise;
    }

    function settleActiveJob(job, outcome, value) {
        if (job.state !== 'active') return;
        job.state = 'settled';
        activeJobs.delete(job);
        decrement(activeByKey, job.queueKey);
        cleanJobResources(job);
        if (solo?.job === job) releaseSolo(soloUnavailable('Slice job settled before it ran alone.'));
        else grantSoloIfReady();
        if (job.controller.signal.aborted) job.reject(abortReason(job.controller.signal));
        else if (outcome === 'resolve') job.resolve(value);
        else job.reject(value);
        resolveDrainIfReady();
        if (!shuttingDown) runNextSliceJob();
    }

    function runTask(job) {
        Promise.resolve()
            .then(() => config.runWithContext
                ? config.runWithContext(job.correlation, () => job.task(job.controller.signal))
                : job.task(job.controller.signal))
            .then(
                (value) => settleActiveJob(job, 'resolve', value),
                (error) => settleActiveJob(job, 'reject', error)
            );
    }

    function activateJob(job) {
        job.state = 'active';
        decrement(queuedByKey, job.queueKey);
        clearDeadline(job);
        job.controller.signal.removeEventListener('abort', job.onEffectiveAbort);
        activeJobs.add(job);
        increment(activeByKey, job.queueKey);
        runTask(job);
    }

    function expireJobAtDequeue(job) {
        if (job.ignoreQueueWait) return false;
        if (config.now() - job.enqueuedAt < config.maxWaitMs) return false;
        job.controller.abort(config.createTimeoutError());
        return true;
    }

    /**
     * Synchronous waiters start before waiting asynchronous jobs (FIFO within
     * each class): a synchronous client is bounded by MAX_SLICE_QUEUE_WAIT_MS,
     * an asynchronous job only by its own, longer deadline.
     */
    function nextQueuedJob() {
        return queuedJobs.find((job) => !job.ignoreQueueWait) || queuedJobs[0];
    }

    function runNextSliceJob() {
        if (!runtimeAvailable()) {
            void beginSliceQueueShutdown();
            return;
        }
        // A pending or running solo hold (3.8.2) starts nothing until it ends.
        while (!shuttingDown && activeJobs.size < config.maxConcurrent && !solo && queuedJobs.length > 0) {
            const job = nextQueuedJob();
            if (expireJobAtDequeue(job)) continue;
            queuedJobs.splice(queuedJobs.indexOf(job), 1);
            activateJob(job);
        }
    }

    function startDeadline(job) {
        // An asynchronous job owns its own deadline (ASYNC_SLICE_DEADLINE_MS),
        // enforced by aborting its external signal; the queue wait does not cut it.
        if (job.ignoreQueueWait) return;
        job.deadlineTimer = config.setTimeout(() => {
            if (job.state === 'queued') job.controller.abort(config.createTimeoutError());
        }, config.maxWaitMs);
        job.deadlineTimer?.unref?.();
    }

    function createJob(task, queueKey, externalSignal, resolve, reject) {
        const controller = new AbortController();
        const job = {
            task, queueKey, externalSignal, resolve, reject, controller,
            enqueuedAt: config.now(), state: 'queued', deadlineTimer: undefined,
            correlation: config.captureContext?.() || {}
        };
        job.onEffectiveAbort = () => rejectQueuedJob(job, abortReason(controller.signal));
        job.onExternalAbort = () => forwardExternalAbort(job);
        return job;
    }

    /** 1-based start order under the dequeue priority; null unless queued. */
    function queuePosition(job) {
        if (job.state !== 'queued' || !queuedJobs.includes(job)) return null;
        let ahead = 0;
        for (const other of queuedJobs) {
            if (other === job) break;
            if (other.ignoreQueueWait === job.ignoreQueueWait) ahead += 1;
        }
        if (job.ignoreQueueWait) ahead += queuedJobs.filter((other) => !other.ignoreQueueWait).length;
        return ahead + 1;
    }

    function notifyAdmitted(job, onAdmitted) {
        if (typeof onAdmitted !== 'function') return;
        try {
            onAdmitted(Object.freeze({
                getState: () => job.state,
                getQueuePosition: () => queuePosition(job),
                awaitSolo: (signal) => awaitSolo(job, signal)
            }));
        } catch {
            // An admission observer cannot alter queue ownership or settlement.
        }
    }

    function acceptJob(task, queueKey, signal, resolve, reject, admission = {}) {
        const job = createJob(task, queueKey, signal, resolve, reject);
        job.ignoreQueueWait = admission.ignoreQueueWait === true;
        signal?.addEventListener('abort', job.onExternalAbort, { once: true });
        job.controller.signal.addEventListener('abort', job.onEffectiveAbort, { once: true });
        queuedJobs.push(job);
        increment(queuedByKey, queueKey);
        startDeadline(job);
        notifyAdmitted(job, admission.onAdmitted);
        emitQueueEvent('queue.admitted', {
            outcome: 'accepted',
            extra: { queue_state: 'queued' }
        }, job.correlation);
        runNextSliceJob();
    }

    function enqueueSliceJob(task, options = {}) {
        const queueKey = String(options.queueKey || 'anonymous');
        const signal = options.signal;
        const correlation = config.captureContext?.() || {};
        if (shuttingDown) return rejectAdmission(config.createShutdownError(), correlation);
        const available = runtimeAvailable();
        if (shuttingDown || !available) {
            void beginSliceQueueShutdown();
            return rejectAdmission(config.createShutdownError(), correlation);
        }
        if (signal?.aborted) return Promise.reject(abortReason(signal));
        if (queuedJobs.length >= config.maxQueueLength) {
            return rejectAdmission(config.createFullError(), correlation);
        }
        if (totalForKey(queueKey) >= config.maxQueuePerClient) {
            return rejectAdmission(config.createClientLimitError(), correlation);
        }
        const admission = {
            ignoreQueueWait: options.ignoreQueueWait === true,
            onAdmitted: options.onAdmitted
        };
        return new Promise((resolve, reject) => acceptJob(task, queueKey, signal, resolve, reject, admission));
    }

    function beginSliceQueueShutdown() {
        if (shutdownPromise) return shutdownPromise;
        shuttingDown = true;
        emitQueueEvent('queue.shutdown', {
            outcome: 'started',
            error_code: 'SLICE_QUEUE_SHUTDOWN',
            extra: { queue_state: 'draining' }
        }, config.captureContext?.() || {});
        shutdownPromise = new Promise((resolve) => { resolveShutdown = resolve; });
        releaseSolo(config.createShutdownError());
        for (const job of [...queuedJobs, ...activeJobs]) {
            if (!job.controller.signal.aborted) job.controller.abort(config.createShutdownError());
        }
        resolveDrainIfReady();
        return shutdownPromise;
    }

    function getQueueStatus() {
        const available = runtimeAvailable();
        const status = {
            queueLength: queuedJobs.length,
            activeJobs: activeJobs.size,
            maxConcurrent: config.maxConcurrent,
            maxQueueLength: config.maxQueueLength,
            maxQueuePerClient: config.maxQueuePerClient
        };
        Object.defineProperty(status, 'acceptingJobs', {
            value: !shuttingDown && available,
            enumerable: false
        });
        // Non-enumerable like acceptingJobs: the serialized status is unchanged.
        Object.defineProperty(status, 'soloHold', { value: solo !== null, enumerable: false });
        return status;
    }

    const unsubscribe = config.subscribeToRuntimeQuarantine?.(() => {
        void beginSliceQueueShutdown();
    });
    if (typeof unsubscribe === 'function') {
        if (runtimeSubscriptionClosed) {
            try { unsubscribe(); } catch { /* Queue is already settled closed. */ }
        } else {
            unsubscribeRuntimeQuarantine = unsubscribe;
        }
    }
    if (!runtimeAvailable()) void beginSliceQueueShutdown();

    return {
        enqueueSliceJob,
        getQueueStatus,
        beginSliceQueueShutdown,
        shutdownSliceQueue: beginSliceQueueShutdown
    };
}

module.exports = { createQueueScheduler };
