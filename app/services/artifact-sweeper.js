'use strict';

/**
 * Periodic managed-artifact sweep (3.9.0, spec §4.2). An unref'd interval
 * runs the serialized artifact cleanup with `phase: 'sweep'`, its own time
 * and entry budget. A sweep never overlaps itself: a tick while one runs is
 * skipped, and an immediate request while one runs is coalesced into a single
 * follow-up sweep. The verdict goes to `onResult` (the retention adapter).
 */

const { cleanupManagedArtifacts, SWEEP_PHASE } = require('./artifact-store');
const { recordArtifactSweep } = require('./observability/metrics');

const FAILED_SWEEP = Object.freeze({ quotaSatisfied: false, verdict: 'exceeded', failed: 1 });

/**
 * Create the periodic sweeper. Nothing runs until `start()`.
 * @param {object} [options] Seams: `cleanup`, `intervalMs` (default the
 *   `ARTIFACT_SWEEP_INTERVAL_MS` release key), `cleanupOptions`, `onResult`,
 *   `recordSweep`, `clock`, `setInterval`, `clearInterval`.
 * @returns {{start(): void, stop(): void, runNow(): Promise<object|null>, isRunning(): boolean}} Sweeper.
 */
function createArtifactSweeper(options = {}) {
    const cleanup = options.cleanup || cleanupManagedArtifacts;
    const intervalMs = options.intervalMs
        || require('../config/release-policy').retention.ARTIFACT_SWEEP_INTERVAL_MS;
    const recordSweep = options.recordSweep || recordArtifactSweep;
    const clock = options.clock || Date.now;
    const startInterval = options.setInterval || setInterval;
    const stopInterval = options.clearInterval || clearInterval;
    let onResult = typeof options.onResult === 'function' ? options.onResult : null;
    let timer = null;
    let stopped = false;
    let inFlight = null;
    let followUp = null;

    async function sweepOnce() {
        const started = clock();
        let summary;
        try {
            summary = await cleanup({ ...(options.cleanupOptions || {}), phase: SWEEP_PHASE });
            if (!summary || typeof summary !== 'object') summary = { ...FAILED_SWEEP };
        } catch {
            // A throwing sweep is a failure: the quota is not known to hold.
            summary = { ...FAILED_SWEEP };
        }
        try {
            recordSweep(Math.max(0, clock() - started) / 1000, summary.verdict);
        } catch {
            // Metrics never alter the sweep.
        }
        if (onResult) {
            try {
                onResult(summary);
            } catch {
                // The observer cannot stop later sweeps.
            }
        }
        return summary;
    }

    function begin() {
        inFlight = sweepOnce().finally(() => { inFlight = null; });
        return inFlight;
    }

    /** Run a sweep now, or once more right after the one in flight. */
    function runNow() {
        if (stopped) return Promise.resolve(null);
        if (!inFlight) return begin();
        if (!followUp) {
            followUp = inFlight.then(() => {
                followUp = null;
                return stopped ? null : begin();
            });
        }
        return followUp;
    }

    function tick() {
        if (stopped || inFlight) return;
        begin().catch(() => {});
    }

    return Object.freeze({
        start() {
            if (timer || stopped) return;
            timer = startInterval(tick, intervalMs);
            timer?.unref?.();
        },
        stop() {
            stopped = true;
            if (timer) stopInterval(timer);
            timer = null;
        },
        runNow,
        isRunning: () => inFlight !== null,
        /** Late binding of the verdict observer (the adapter is built after the sweeper). */
        setOnResult(callback) {
            onResult = typeof callback === 'function' ? callback : null;
        },
        intervalMs
    });
}

module.exports = { createArtifactSweeper };
