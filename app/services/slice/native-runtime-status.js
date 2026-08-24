'use strict';

/** Process-local fail-closed quarantine after unverifiable native settlement. */

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
    getNativeRuntimeStatus,
    quarantineNativeRuntime,
    resetNativeRuntimeStatusForTests,
    subscribeToNativeRuntimeQuarantine
};
