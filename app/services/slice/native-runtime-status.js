'use strict';

/** Process-local fail-closed quarantine after unverifiable native settlement. */

let quarantined = false;

function quarantineNativeRuntime() {
    quarantined = true;
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

module.exports = {
    getNativeRuntimeStatus,
    quarantineNativeRuntime,
    resetNativeRuntimeStatusForTests
};
