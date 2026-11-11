'use strict';

/**
 * Native build identity off the request path (3.9.0 §4.1, D139).
 *
 * The Bambu build identity (`engine.build_sha256`, part of every
 * `measurement_generation`) is the SHA-256 of the native components taken once
 * at startup by `initializeBambuGeneration`. Until 3.8.3 every `/ready`
 * refresh and every Bambu slice re-read and re-hashed those components
 * synchronously (about 126 MB, 3-4 s with the event loop blocked).
 *
 * This monitor keeps the tamper check and moves the hashing off the request
 * path:
 *
 * - **Startup:** one awaited streamed verification (bigint `lstat` before,
 *   `createReadStream` in 1 MiB chunks, `lstat` after). The snapshot
 *   `{dev, ino, size, mtimeNs, ctimeNs}` is accepted only when the two stats
 *   agree and the digest equals the startup digest. A failure leaves the
 *   monitor disabled: the caller's legacy synchronous loop serves (3.8.3).
 * - **`assertCurrentSync()`** is synchronous, returns `undefined` and throws
 *   synchronously; it uses only `lstatSync(file, {bigint: true})`:
 *   - equal fingerprint, no confirmed change → return. Staleness (no
 *     successful background verification within `maxAgeMs`) only sets the
 *     gauge, emits `identity.stale` once per window and schedules a
 *     verification; it never fails a check.
 *   - confirmed digest change → throw, terminal until restart.
 *   - fingerprint moved → the legacy synchronous hash loop runs once in this
 *     call; equal digests adopt the new snapshot and return, a different
 *     digest is a confirmed change (throw), an `lstat`/read error throws for
 *     this call only.
 * - **Background:** a full streamed re-hash every `intervalMs` (unref'd),
 *   bounded per attempt by `timeoutMs`, never two reads at once. A read
 *   error, an unstable read or a timeout keeps the last good verdict, counts
 *   `slicer_identity_verification_failures_total{reason}` and emits
 *   `identity.failed`; it never makes `assertCurrentSync()` throw. Only a
 *   completed hash that differs from the startup digest (also one that
 *   arrives after its deadline) is a verdict.
 *
 * Reasons for `/operations/readiness` (never `/ready`) come from
 * `getStatus().reasons`: `NATIVE_IDENTITY_CHANGED` and the informational
 * `NATIVE_IDENTITY_STALE`, `NATIVE_IDENTITY_VERIFY_FAILED`,
 * `NATIVE_IDENTITY_MONITOR_OFF`.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { emitEvent: defaultEmitEvent } = require('../observability/events');
const defaultMetrics = require('../observability/metrics');

const HASH_CHUNK_BYTES = 1024 * 1024;
const MAX_NATIVE_COMPONENT_BYTES = 512n * 1024n * 1024n;
const BUILD_CHANGED_MESSAGE = 'Bambu runtime build changed after startup.';
/** A stale check schedules at most one verification per this gap. */
const STALE_RETRY_MIN_GAP_MS = 60_000;

/** Readiness reason codes (`/operations/readiness` only). */
const IDENTITY_FAILURE_REASONS = Object.freeze({
    changed: 'NATIVE_IDENTITY_CHANGED',
    stale: 'NATIVE_IDENTITY_STALE',
    verifyFailed: 'NATIVE_IDENTITY_VERIFY_FAILED',
    monitorOff: 'NATIVE_IDENTITY_MONITOR_OFF'
});

/** Bounded `error_code` of the `identity.*` events, per verification outcome. */
const OUTCOME_ERROR_CODES = Object.freeze({
    changed: IDENTITY_FAILURE_REASONS.changed,
    error: 'NATIVE_IDENTITY_READ_FAILED',
    timeout: 'NATIVE_IDENTITY_VERIFY_TIMEOUT',
    stalled: 'NATIVE_IDENTITY_VERIFY_STALLED',
    unstable: 'NATIVE_IDENTITY_UNSTABLE',
    stale: IDENTITY_FAILURE_REASONS.stale
});

/**
 * Verification outcome → `IDENTITY_FAILURE_METRIC_REASONS` of `metrics.js`
 * (`changed | read_error | timeout | unstable | other`).
 */
const OUTCOME_METRIC_REASONS = Object.freeze({
    changed: 'changed',
    error: 'read_error',
    timeout: 'timeout',
    stalled: 'timeout',
    unstable: 'unstable'
});

/**
 * @param {string} outcome Verification outcome.
 * @returns {string} Metric reason label.
 */
function metricReasonFor(outcome) {
    return OUTCOME_METRIC_REASONS[outcome] || 'other';
}

/**
 * The identity-relevant part of a bigint `lstat`.
 * @param {import('node:fs').BigIntStats} stat Bigint stat result.
 * @returns {{dev: bigint, ino: bigint, size: bigint, mtimeNs: bigint, ctimeNs: bigint, regular: boolean}} Fingerprint.
 */
function fingerprintOf(stat) {
    return Object.freeze({
        dev: BigInt(stat.dev),
        ino: BigInt(stat.ino),
        size: BigInt(stat.size),
        mtimeNs: BigInt(stat.mtimeNs),
        ctimeNs: BigInt(stat.ctimeNs),
        regular: stat.isFile() && !stat.isSymbolicLink()
    });
}

/**
 * @param {ReturnType<typeof fingerprintOf>|null} left Fingerprint.
 * @param {ReturnType<typeof fingerprintOf>|null} right Fingerprint.
 * @returns {boolean} Both regular files with identical dev/ino/size/mtime/ctime.
 */
function sameFingerprint(left, right) {
    return Boolean(left && right)
        && left.regular === true && right.regular === true
        && left.dev === right.dev && left.ino === right.ino && left.size === right.size
        && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function assertComponentShape(fingerprint) {
    if (!fingerprint.regular || fingerprint.size <= 0n || fingerprint.size > MAX_NATIVE_COMPONENT_BYTES) {
        throw new Error('Invalid native build component.');
    }
}

/**
 * Hash one component through a read stream, bracketed by two bigint stats so
 * the digest provably belongs to the fingerprint.
 * @param {string} file Absolute component path.
 * @param {{lstat: Function, createReadStream: Function, chunkBytes: number}} io Injectable I/O.
 * @returns {Promise<{sha256: string, fingerprint: ReturnType<typeof fingerprintOf>}|{unstable: true}>} Digest or instability.
 */
async function streamComponent(file, io) {
    const before = fingerprintOf(await io.lstat(file, { bigint: true }));
    assertComponentShape(before);
    const hash = createHash('sha256');
    let bytes = 0n;
    const stream = io.createReadStream(file, { highWaterMark: io.chunkBytes });
    try {
        for await (const chunk of stream) {
            hash.update(chunk);
            bytes += BigInt(chunk.length);
            if (bytes > before.size) return { unstable: true };
        }
    } finally {
        if (typeof stream.destroy === 'function' && !stream.destroyed) stream.destroy();
    }
    const after = fingerprintOf(await io.lstat(file, { bigint: true }));
    if (bytes !== before.size || !sameFingerprint(before, after)) return { unstable: true };
    return { sha256: hash.digest('hex'), fingerprint: after };
}

/**
 * Create the monitor for components already hashed at startup.
 * @param {Array<{file: string, sha256: string}>} components Startup identity (`nativeIdentity` of `bambu-generation.js`).
 * @param {{
 *   enabled?: boolean, intervalMs?: number, maxAgeMs?: number, timeoutMs?: number, chunkBytes?: number,
 *   policy?: {NATIVE_IDENTITY_MONITOR: boolean, NATIVE_IDENTITY_VERIFY_INTERVAL_MS: number,
 *     NATIVE_IDENTITY_MAX_AGE_MS: number, NATIVE_IDENTITY_TIMEOUT_MS: number},
 *   hashFileSync?: (file: string) => string,
 *   lstatSync?: Function, lstat?: Function, createReadStream?: Function,
 *   now?: () => number, setInterval?: Function, clearInterval?: Function, setTimeout?: Function, clearTimeout?: Function,
 *   emitEvent?: (name: string, data: object) => unknown, metrics?: object
 * }} [options] `policy` defaults to the `identity` section of `release-policy.js`;
 *   explicit numbers override it. `hashFileSync` is the legacy synchronous hash
 *   (`hashNativeFile`), used only when a fingerprint moved. `now` is monotonic milliseconds.
 * @returns {object} Monitor: `enabled`, `initialize()`, `start()`, `stop()`, `assertCurrentSync()`, `verifyNow()`, `getStatus()`.
 */
function createNativeIdentityMonitor(components, options = {}) {
    const policy = options.policy || require('../../config/release-policy').identity;
    const monitorOn = options.enabled !== undefined ? options.enabled === true : policy.NATIVE_IDENTITY_MONITOR === true;
    const intervalMs = options.intervalMs || policy.NATIVE_IDENTITY_VERIFY_INTERVAL_MS;
    const maxAgeMs = options.maxAgeMs || policy.NATIVE_IDENTITY_MAX_AGE_MS;
    const timeoutMs = options.timeoutMs || policy.NATIVE_IDENTITY_TIMEOUT_MS;
    const io = {
        lstat: options.lstat || ((file, statOptions) => fsp.lstat(file, statOptions)),
        createReadStream: options.createReadStream || ((file, streamOptions) => fs.createReadStream(file, streamOptions)),
        chunkBytes: options.chunkBytes || HASH_CHUNK_BYTES
    };
    const lstatSync = options.lstatSync || ((file, statOptions) => fs.lstatSync(file, statOptions));
    const hashFileSync = options.hashFileSync;
    const now = options.now || (() => performance.now());
    const schedule = options.setInterval || setInterval;
    const unschedule = options.clearInterval || clearInterval;
    const armDeadline = options.setTimeout || setTimeout;
    const disarmDeadline = options.clearTimeout || clearTimeout;
    const emitEvent = options.emitEvent || defaultEmitEvent;
    const metrics = options.metrics || defaultMetrics;
    if (!Array.isArray(components) || components.length === 0) throw new Error('Native identity requires components.');
    if (monitorOn && typeof hashFileSync !== 'function') throw new Error('Native identity monitor requires hashFileSync.');
    const baseline = components.map(({ file, sha256 }) => {
        if (typeof file !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid native identity component.');
        return { file, sha256, fingerprint: null };
    });

    /** 'off' (policy) | 'pending' (not initialized) | 'active' | 'disabled' (startup verification failed). */
    let phase = monitorOn ? 'pending' : 'off';
    let changed = false;
    let lastVerifiedAt = null;
    let lastOutcome = monitorOn ? 'pending' : 'off';
    let consecutiveFailures = 0;
    let running = null;
    /** A verification past its deadline whose reads have not settled yet. */
    let abandoned = null;
    let staleReportedAt = null;
    let lastAttemptAt = null;
    let timer = null;

    function emit(name, data) {
        try {
            emitEvent(name, data);
        } catch {
            // Telemetry never alters the identity verdict.
        }
    }

    function safely(action) {
        try {
            action();
        } catch {
            // Metrics never alter the identity verdict.
        }
    }

    function markChanged() {
        if (changed) return;
        changed = true;
        // Terminal for this process: further re-hashing proves nothing more.
        stop();
    }

    async function runVerification(attempt) {
        const verified = [];
        for (const component of baseline) {
            const result = await streamComponent(component.file, io);
            if (result.unstable) return { ok: false, outcome: 'unstable' };
            if (result.sha256 !== component.sha256) {
                // Different bytes are a verdict, even past the deadline (fail closed).
                markChanged();
                return { ok: false, outcome: 'changed' };
            }
            verified.push([component, result.fingerprint]);
        }
        // A success after the deadline was already reported as a timeout:
        // it never re-baselines or refreshes the verification age.
        if (attempt.abandoned) return { ok: false, outcome: 'timeout' };
        for (const [component, fingerprint] of verified) component.fingerprint = fingerprint;
        lastVerifiedAt = now();
        return { ok: true, outcome: 'verified' };
    }

    function record(result, startedAt) {
        const durationMs = Math.max(0, now() - startedAt);
        lastOutcome = result.outcome;
        if (result.ok) {
            consecutiveFailures = 0;
            staleReportedAt = null;
            safely(() => metrics.recordIdentityVerification(durationMs / 1000));
            safely(() => metrics.setIdentityStale(false));
            emit('identity.verified', { outcome: 'verified', duration_ms: durationMs });
            return;
        }
        consecutiveFailures += 1;
        safely(() => metrics.recordIdentityVerificationFailure(metricReasonFor(result.outcome)));
        emit('identity.failed', { outcome: result.outcome, error_code: OUTCOME_ERROR_CODES[result.outcome],
            duration_ms: durationMs });
    }

    /**
     * One streamed verification with its deadline, or the one already running.
     * @returns {Promise<{ok: boolean, outcome: string}>} Outcome; never rejects.
     */
    function verify() {
        if (running) return running;
        if (abandoned) {
            // Never stack a second read on one still hanging past its deadline.
            const result = { ok: false, outcome: 'stalled' };
            if (!abandoned.reported) {
                abandoned.reported = true;
                record(result, abandoned.startedAt);
            }
            return Promise.resolve(result);
        }
        const attempt = { abandoned: false, reported: false, startedAt: now() };
        lastAttemptAt = attempt.startedAt;
        let deadline;
        const work = runVerification(attempt).catch(() => ({ ok: false, outcome: 'error' }));
        const timedOut = new Promise((resolve) => {
            deadline = armDeadline(() => {
                attempt.abandoned = true;
                resolve(null);
            }, timeoutMs);
            deadline?.unref?.();
        });
        running = Promise.race([work, timedOut]).then((settled) => {
            disarmDeadline(deadline);
            running = null;
            let result = settled;
            if (result === null) {
                result = { ok: false, outcome: 'timeout' };
                abandoned = attempt;
                work.then((late) => {
                    abandoned = null;
                    // A late `changed` is still a verdict (already latched in runVerification).
                    if (late.outcome === 'changed') record(late, attempt.startedAt);
                });
            }
            record(result, attempt.startedAt);
            return result;
        });
        return running;
    }

    /**
     * The awaited startup verification. On failure the monitor stays disabled
     * and the caller's legacy loop serves (3.8.3 behaviour).
     * @returns {Promise<object>} Status after the attempt.
     */
    async function initialize() {
        if (phase !== 'pending') return getStatus();
        const result = await verify();
        phase = result.ok ? 'active' : 'disabled';
        return getStatus();
    }

    /**
     * Background verification for the timer and the stale path.
     * @returns {Promise<{ok: boolean, outcome: string}>} Outcome; never rejects.
     */
    function verifyNow() {
        if (phase !== 'active' || changed) return Promise.resolve({ ok: false, outcome: changed ? 'changed' : phase });
        return verify();
    }

    function noteStaleness() {
        if (lastVerifiedAt === null) return;
        const current = now();
        const age = current - lastVerifiedAt;
        if (age <= maxAgeMs) return;
        safely(() => metrics.setIdentityStale(true));
        if (staleReportedAt === null || current - staleReportedAt >= maxAgeMs) {
            staleReportedAt = current;
            emit('identity.stale', { outcome: 'stale', error_code: OUTCOME_ERROR_CODES.stale, duration_ms: age });
        }
        if (!running && (lastAttemptAt === null || current - lastAttemptAt >= Math.min(intervalMs, STALE_RETRY_MIN_GAP_MS))) {
            verifyNow();
        }
    }

    function identityChangedError() {
        return Object.assign(new Error(BUILD_CHANGED_MESSAGE), { code: IDENTITY_FAILURE_REASONS.changed });
    }

    /**
     * Cheap synchronous check for the request and readiness paths.
     * @returns {undefined} Always `undefined` (never a thenable).
     * @throws {Error} On a confirmed change (terminal) or, for this call
     *   only, when a moved component cannot be stat'ed or read.
     */
    function assertCurrentSync() {
        if (changed) throw identityChangedError();
        noteStaleness();
        const current = baseline.map((component) => fingerprintOf(lstatSync(component.file, { bigint: true })));
        if (current.every((fingerprint, index) => sameFingerprint(baseline[index].fingerprint, fingerprint))) return undefined;
        // A fingerprint moved: the 3.8.3 synchronous hash loop, once, in this call.
        const startedAt = now();
        if (baseline.some(({ file, sha256 }) => hashFileSync(file) !== sha256)) {
            markChanged();
            record({ ok: false, outcome: 'changed' }, startedAt);
            throw identityChangedError();
        }
        // Equal digests: adopt the fingerprint when it held across the hash.
        const after = baseline.map((component) => fingerprintOf(lstatSync(component.file, { bigint: true })));
        if (after.every((fingerprint, index) => sameFingerprint(current[index], fingerprint))) {
            baseline.forEach((component, index) => { component.fingerprint = after[index]; });
        }
        return undefined;
    }

    /**
     * Start the background re-hash (unref'd). No-op unless active.
     * @returns {() => void} Stop function.
     */
    function start() {
        if (phase !== 'active' || changed || timer) return stop;
        timer = schedule(() => { verifyNow(); }, intervalMs);
        timer?.unref?.();
        return stop;
    }

    function stop() {
        if (!timer) return;
        unschedule(timer);
        timer = null;
    }

    /**
     * Labels only (no paths, no digests) for `/operations/readiness`.
     * @returns {Readonly<object>} Status.
     */
    function getStatus() {
        const ageMs = lastVerifiedAt === null ? null : Math.max(0, now() - lastVerifiedAt);
        const stale = phase === 'active' && !changed && ageMs !== null && ageMs > maxAgeMs;
        const verifyFailed = phase === 'disabled' || (phase === 'active' && consecutiveFailures > 0);
        const reasons = [];
        if (changed) reasons.push(IDENTITY_FAILURE_REASONS.changed);
        if (stale) reasons.push(IDENTITY_FAILURE_REASONS.stale);
        if (verifyFailed && !changed) reasons.push(IDENTITY_FAILURE_REASONS.verifyFailed);
        if (phase !== 'active') reasons.push(IDENTITY_FAILURE_REASONS.monitorOff);
        return Object.freeze({
            monitor: phase,
            enabled: phase === 'active',
            changed,
            stale,
            verifying: running !== null,
            stalled: abandoned !== null,
            lastOutcome,
            consecutiveFailures,
            lastVerifiedAgeMs: ageMs === null ? null : Math.round(ageMs),
            intervalMs,
            maxAgeMs,
            timeoutMs,
            reasons: Object.freeze(reasons)
        });
    }

    return Object.freeze({
        get enabled() { return phase === 'active'; },
        initialize,
        start,
        stop,
        assertCurrentSync,
        verifyNow,
        getStatus
    });
}

/**
 * Status when no monitor was created (not started, or the generation module
 * never started one): the legacy loop serves.
 * @returns {Readonly<object>} Status.
 */
function notStartedStatus() {
    return Object.freeze({
        monitor: 'not_started', enabled: false, changed: false, stale: false, verifying: false, stalled: false,
        lastOutcome: 'not_started', consecutiveFailures: 0, lastVerifiedAgeMs: null,
        reasons: Object.freeze([IDENTITY_FAILURE_REASONS.monitorOff])
    });
}

module.exports = {
    BUILD_CHANGED_MESSAGE,
    HASH_CHUNK_BYTES,
    IDENTITY_FAILURE_REASONS,
    OUTCOME_ERROR_CODES,
    createNativeIdentityMonitor,
    fingerprintOf,
    metricReasonFor,
    notStartedStatus,
    sameFingerprint
};
