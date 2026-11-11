'use strict';

/**
 * Retention adapter (3.9.0, spec §4.2): the object `configureRetentionObserver`
 * receives instead of the readiness service itself.
 *
 * 3.8.3 latched `/ready` at 503 on the first post-slice retention miss until
 * a restart, because nothing ran another sweep. Now a bare `false` from the
 * hashed post-slice path schedules one immediate, coalesced sweep, and only a
 * sweep's verdict reaches readiness: `satisfied` → healthy, `exceeded` →
 * unhealthy, `incomplete` → the previous value is kept and an
 * `artifact.cleanup` event with `ARTIFACT_SCAN_INCOMPLETE` is emitted (the
 * sweeper counts the incomplete sweep in its metric).
 */

const { emitEvent } = require('./observability/events');
const { createArtifactSweeper } = require('./artifact-sweeper');

const SCAN_INCOMPLETE_ERROR_CODE = 'ARTIFACT_SCAN_INCOMPLETE';

/**
 * @param {object} options
 * @param {{recordRetentionResult(summary: unknown): boolean}} options.readinessService Readiness service.
 * @param {() => Promise<unknown>} options.requestSweep Coalesced immediate sweep (`sweeper.runNow`).
 * @param {Function} [options.emitEvent] Event seam.
 * @returns {{recordRetentionResult(summary: unknown): void, handleSweepResult(summary: object): void}} Adapter.
 */
function createRetentionAdapter(options) {
    const readiness = options?.readinessService;
    if (!readiness || typeof readiness.recordRetentionResult !== 'function') {
        throw new TypeError('A readiness service with recordRetentionResult is required.');
    }
    if (typeof options.requestSweep !== 'function') {
        throw new TypeError('A requestSweep function is required.');
    }
    const publish = options.emitEvent || emitEvent;

    function handleSweepResult(summary) {
        const verdict = summary?.verdict;
        if (verdict === 'incomplete') {
            try {
                publish('artifact.cleanup', {
                    audience: 'artifact',
                    outcome: 'failure',
                    error_code: SCAN_INCOMPLETE_ERROR_CODE,
                    extra: { reason: 'sweep', verdict: 'incomplete' }
                });
            } catch {
                // Telemetry never alters readiness.
            }
            return;
        }
        if (verdict === 'satisfied') readiness.recordRetentionResult(true);
        else if (verdict === 'exceeded') readiness.recordRetentionResult(false);
        // A summary without a verdict (an older caller) keeps the 3.8.3 meaning.
        else readiness.recordRetentionResult(summary);
    }

    /**
     * Observer entry point. A bare `false` is the post-slice miss: sweep now
     * instead of latching. A sweep summary is judged by its verdict; any other
     * value goes to readiness as before.
     */
    function recordRetentionResult(summary) {
        if (summary === false) {
            Promise.resolve()
                .then(() => options.requestSweep())
                .catch(() => {});
            return;
        }
        if (summary && typeof summary === 'object' && typeof summary.verdict === 'string') {
            handleSweepResult(summary);
            return;
        }
        readiness.recordRetentionResult(summary);
    }

    return Object.freeze({ recordRetentionResult, handleSweepResult });
}

/**
 * Wire a sweeper and an adapter together for the integrator:
 * `configureRetentionObserver(adapter)`, `sweeper.start()` after listen,
 * `sweeper.stop()` on shutdown.
 * @param {object} options `readinessService` plus optional `sweeper` options.
 * @returns {{adapter: object, sweeper: object}} Wired pair.
 */
function createRetentionRuntime(options) {
    const sweeper = createArtifactSweeper(options?.sweeper || {});
    const adapter = createRetentionAdapter({
        readinessService: options?.readinessService,
        requestSweep: () => sweeper.runNow(),
        emitEvent: options?.emitEvent
    });
    sweeper.setOnResult(adapter.handleSweepResult);
    return { adapter, sweeper };
}

module.exports = {
    SCAN_INCOMPLETE_ERROR_CODE,
    createRetentionAdapter,
    createRetentionRuntime
};
