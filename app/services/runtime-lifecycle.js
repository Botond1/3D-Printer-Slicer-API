'use strict';

/** Process-signal and HTTP-server lifecycle coordination. */

const {
    QUARANTINE_EXIT_CODE,
    subscribeToNativeRuntimeQuarantine
} = require('./slice/native-runtime-status');

const SHUTDOWN_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);
/**
 * Bounded drain window after a native quarantine before the process exits.
 * Kept well below the 30 s container stop grace so the supervisor observes a
 * clean self-exit rather than a forced kill.
 */
const QUARANTINE_DRAIN_MS = 10_000;

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function awaitAllOrThrow(promises) {
    const outcomes = await Promise.allSettled(promises);
    const failures = outcomes
        .filter((outcome) => outcome.status === 'rejected')
        .map((outcome) => outcome.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Runtime shutdown failed.');
}

function closeHttpServer(server) {
    if (!server || typeof server.close !== 'function') return Promise.resolve();
    return new Promise((resolve, reject) => {
        try {
            server.close((error) => {
                if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') resolve();
                else reject(error);
            });
            server.closeIdleConnections?.();
        } catch (error) {
            if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolve();
            else reject(error);
        }
    });
}

/**
 * Create an injectable, single-flight runtime lifecycle.
 * Queue shutdown starts synchronously; HTTP close waits for startup to settle.
 *
 * A native-runtime quarantine is terminal: the lifecycle closes admission
 * through the normal shutdown path, waits at most `quarantineDrainMs`, and
 * then calls the injectable `exit` seam with `quarantineExitCode` so the
 * container supervisor (`restart: unless-stopped`) replaces the process.
 * @param {object} options Runtime dependencies.
 * @param {Function} options.beginQueueShutdown Queue drain starter.
 * @param {Function} [options.onShutdownStart] Admission-closing hook.
 * @param {Function} [options.onQuarantine] Hook invoked once before the quarantine drain.
 * @param {Function} [options.subscribeToRuntimeQuarantine] Quarantine subscription seam.
 * @param {(code: number, reason: string) => void} [options.exit] Process exit seam.
 * @param {number} [options.quarantineExitCode] Exit status after quarantine.
 * @param {number} [options.quarantineDrainMs] Bounded drain window in milliseconds.
 * @returns {object} Lifecycle facade.
 */
function createRuntimeLifecycle(options = {}) {
    const processRef = options.processRef || process;
    const logger = options.logger || console;
    const beginQueueShutdown = options.beginQueueShutdown;
    const onShutdownStart = options.onShutdownStart || (() => {});
    const onQuarantine = options.onQuarantine || (() => {});
    const subscribeToQuarantine = options.subscribeToRuntimeQuarantine
        || subscribeToNativeRuntimeQuarantine;
    const exit = options.exit || ((code) => processRef.exit?.(code));
    const quarantineExitCode = Number.isSafeInteger(options.quarantineExitCode)
        ? options.quarantineExitCode
        : QUARANTINE_EXIT_CODE;
    const quarantineDrainMs = Number.isSafeInteger(options.quarantineDrainMs)
        && options.quarantineDrainMs > 0
        ? Math.min(options.quarantineDrainMs, QUARANTINE_DRAIN_MS)
        : QUARANTINE_DRAIN_MS;
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    if (typeof beginQueueShutdown !== 'function') {
        throw new TypeError('beginQueueShutdown must be a function.');
    }

    const serverReady = createDeferred();
    const signalHandlers = new Map();
    let startupInvoked = false;
    let serverReadySettled = false;
    let readyServer = null;
    let listenersInstalled = false;
    let shuttingDown = false;
    let shutdownPromise;
    let shutdownFailureObserved = false;
    let unsubscribeQuarantine;
    let quarantineHandled = false;
    let quarantineExit = null;

    function settleServerReady(server) {
        if (serverReadySettled) return;
        serverReadySettled = true;
        readyServer = server || null;
        serverReady.resolve(readyServer);
    }

    function removeSignalListeners() {
        if (!listenersInstalled) return;
        listenersInstalled = false;
        for (const [signal, handler] of signalHandlers) {
            processRef.removeListener(signal, handler);
        }
        try {
            unsubscribeQuarantine?.();
        } catch {
            // Observer teardown never blocks shutdown completion.
        }
        unsubscribeQuarantine = undefined;
    }

    function finishQuarantine(reason) {
        if (quarantineExit) return;
        quarantineExit = Object.freeze({ code: quarantineExitCode, reason });
        try {
            exit(quarantineExitCode, reason);
        } catch (error) {
            logger.error?.('[QUARANTINE] Process exit seam failed.', error);
        }
    }

    function handleQuarantine() {
        if (quarantineHandled) return;
        quarantineHandled = true;
        try {
            onQuarantine();
        } catch (error) {
            logger.error?.('[QUARANTINE] Quarantine hook failed.', error);
        }
        // A quarantined slot never settles by design, so the drain is bounded
        // and the process exits either way; the supervisor restarts it clean.
        // The timer deliberately keeps the event loop alive: the exit status
        // must be the quarantine code, never an incidental natural exit.
        const timer = setTimer(() => finishQuarantine('drain_timeout'), quarantineDrainMs);
        shutdown().then(
            () => { clearTimer(timer); finishQuarantine('drained'); },
            (error) => {
                clearTimer(timer);
                logger.error?.('[QUARANTINE] Drain failed before exit.', error);
                finishQuarantine('drain_failed');
            }
        );
    }

    function installQuarantineSubscription() {
        if (unsubscribeQuarantine || typeof subscribeToQuarantine !== 'function') return;
        const unsubscribe = subscribeToQuarantine(handleQuarantine);
        unsubscribeQuarantine = typeof unsubscribe === 'function' ? unsubscribe : () => {};
    }

    function shutdown() {
        if (shutdownPromise) return shutdownPromise;
        shuttingDown = true;
        try {
            onShutdownStart();
        } catch (error) {
            logger.error?.('[SHUTDOWN] Readiness transition failed.', error);
        }

        let queueDrain;
        try {
            queueDrain = Promise.resolve(beginQueueShutdown());
        } catch (error) {
            queueDrain = Promise.reject(error);
        }
        const httpClose = serverReadySettled
            ? closeHttpServer(readyServer)
            : serverReady.promise.then(closeHttpServer);
        shutdownPromise = awaitAllOrThrow([queueDrain, httpClose])
            .finally(removeSignalListeners);
        return shutdownPromise;
    }

    function observeSignalFailure(signal) {
        const pendingShutdown = shutdown();
        if (shutdownFailureObserved) return;
        shutdownFailureObserved = true;
        pendingShutdown.catch((error) => {
            processRef.exitCode = 1;
            logger.error?.(`[SHUTDOWN] ${signal} shutdown failed.`, error);
        });
    }

    function installSignalListeners() {
        if (listenersInstalled) return;
        listenersInstalled = true;
        for (const signal of SHUTDOWN_SIGNALS) {
            const handler = () => observeSignalFailure(signal);
            signalHandlers.set(signal, handler);
            processRef.on(signal, handler);
        }
    }

    async function run(startServer) {
        if (startupInvoked) throw new Error('Runtime startup may only be invoked once.');
        if (typeof startServer !== 'function') throw new TypeError('startServer must be a function.');
        startupInvoked = true;
        installSignalListeners();
        installQuarantineSubscription();
        try {
            const server = await startServer();
            settleServerReady(server);
            return server;
        } catch (startupError) {
            settleServerReady(null);
            try {
                await shutdown();
            } catch (shutdownError) {
                throw new AggregateError(
                    [startupError, shutdownError],
                    'Runtime startup and cleanup failed.'
                );
            }
            throw startupError;
        }
    }

    return {
        run,
        shutdown,
        isShuttingDown: () => shuttingDown,
        getQuarantineExit: () => quarantineExit,
        removeSignalListeners
    };
}

module.exports = {
    QUARANTINE_DRAIN_MS,
    SHUTDOWN_SIGNALS,
    closeHttpServer,
    createRuntimeLifecycle
};
