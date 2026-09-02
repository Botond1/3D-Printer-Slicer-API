'use strict';

/**
 * Process-local fail-closed quarantine after unverifiable native settlement.
 *
 * A quarantine is terminal for this process: the runtime lifecycle subscribes
 * here, closes admission, drains for a bounded window, and exits with
 * `QUARANTINE_EXIT_CODE` so the container supervisor restarts a clean process
 * instead of leaving a silent outage where `/health` stays 200 forever.
 */

/** Exit status used when a quarantined process terminates itself. */
const QUARANTINE_EXIT_CODE = 70;

let quarantined = false;
const quarantineSubscribers = new Set();

function quarantineNativeRuntime() {
    if (quarantined) return;
    quarantined = true;
    for (const subscriber of [...quarantineSubscribers]) {
        try {
            subscriber();
        } catch {
            // Quarantine remains set even if an observer fails.
        }
    }
}

function getNativeRuntimeStatus() {
    return Object.freeze({
        available: !quarantined,
        quarantined
    });
}

function resetNativeRuntimeStatusForTests() {
    quarantined = false;
}

function subscribeToNativeRuntimeQuarantine(subscriber) {
    if (typeof subscriber !== 'function') {
        throw new TypeError('Native runtime quarantine subscriber must be a function.');
    }
    quarantineSubscribers.add(subscriber);
    if (quarantined) {
        try {
            subscriber();
        } catch {
            // The status remains fail-closed and callers also poll availability.
        }
    }
    return () => quarantineSubscribers.delete(subscriber);
}

module.exports = {
    QUARANTINE_EXIT_CODE,
    getNativeRuntimeStatus,
    quarantineNativeRuntime,
    resetNativeRuntimeStatusForTests,
    subscribeToNativeRuntimeQuarantine
};
