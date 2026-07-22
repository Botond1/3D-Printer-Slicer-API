'use strict';

/** Process-signal and HTTP-server lifecycle coordination. */

const SHUTDOWN_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT']);

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
 * @param {object} options Runtime dependencies.
 * @returns {object} Lifecycle facade.
 */
function createRuntimeLifecycle(options = {}) {
    const processRef = options.processRef || process;
    const logger = options.logger || console;
    const beginQueueShutdown = options.beginQueueShutdown;
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
    }

    function shutdown() {
        if (shutdownPromise) return shutdownPromise;
        shuttingDown = true;

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
        removeSignalListeners
    };
}

module.exports = {
    SHUTDOWN_SIGNALS,
    closeHttpServer,
    createRuntimeLifecycle
};
