'use strict';

/**
 * T-ID (3.9.0 §4.1, §7): the native identity monitor on its own — rename
 * over, truncate, in-place write with a restored mtime, a stale verifier, a
 * hung read past its deadline, a late `changed`, the startup verification
 * and a 512 MiB component that never blocks the event loop.
 */

const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');

const {
    IDENTITY_FAILURE_REASONS,
    createNativeIdentityMonitor,
    metricReasonFor,
    notStartedStatus
} = require('../../../app/services/slice/native-identity-monitor');

const POLICY = Object.freeze({
    NATIVE_IDENTITY_MONITOR: true,
    NATIVE_IDENTITY_VERIFY_INTERVAL_MS: 300_000,
    NATIVE_IDENTITY_MAX_AGE_MS: 900_000,
    NATIVE_IDENTITY_TIMEOUT_MS: 120_000
});

const unhandled = [];
const onUnhandled = (reason) => { unhandled.push(reason); };
process.on('unhandledRejection', onUnhandled);
after(() => {
    process.off('unhandledRejection', onUnhandled);
    assert.deepEqual(unhandled, [], 'no T-ID case may leave an unhandled rejection');
});

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function legacyHash(file) {
    return sha256(fs.readFileSync(file));
}

function makeComponents(t, contents = ['native-apprun', 'native-bambu-studio-binary']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-identity-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return contents.map((content, index) => {
        const file = path.join(root, `component-${index}`);
        fs.writeFileSync(file, content);
        return { file, sha256: sha256(Buffer.from(content)) };
    });
}

function recorder() {
    const events = [];
    const metrics = {
        verifications: [], failures: [], stale: [],
        recordIdentityVerification(seconds) { this.verifications.push(seconds); },
        recordIdentityVerificationFailure(reason) { this.failures.push(reason); },
        setIdentityStale(value) { this.stale.push(value); }
    };
    return { events, metrics, emitEvent: (name, data) => { events.push({ name, ...data }); } };
}

function fakeTimers() {
    const intervals = [];
    return {
        intervals,
        setInterval(callback, ms) { const timer = { callback, ms, cleared: false, unref() {} }; intervals.push(timer); return timer; },
        clearInterval(timer) { if (timer) timer.cleared = true; }
    };
}

function createMonitor(components, extra = {}) {
    const sink = recorder();
    const timers = fakeTimers();
    let clock = 1_000;
    const monitor = createNativeIdentityMonitor(components, {
        policy: POLICY, hashFileSync: legacyHash, emitEvent: sink.emitEvent, metrics: sink.metrics,
        now: () => clock, setInterval: timers.setInterval, clearInterval: timers.clearInterval, ...extra
    });
    return { monitor, sink, timers, advance(ms) { clock += ms; }, get clock() { return clock; } };
}

async function waitFor(condition) {
    for (let attempt = 0; attempt < 500 && !condition(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.ok(condition(), 'condition not reached');
}

function ensureCtimeMoves() {
    // ctime has coarse granularity on some file systems; leave it room to move.
    const until = Date.now() + 25;
    while (Date.now() < until) { /* spin */ }
}

test('startup verification activates the monitor; the check stays synchronous and returns undefined', async (t) => {
    const components = makeComponents(t);
    const { monitor, sink, timers } = createMonitor(components);
    assert.equal(monitor.enabled, false);
    const status = await monitor.initialize();
    assert.equal(status.monitor, 'active');
    assert.equal(monitor.enabled, true);
    assert.deepEqual(status.reasons, []);
    assert.equal(sink.events[0].name, 'identity.verified');
    assert.equal(sink.metrics.verifications.length, 1);
    monitor.start();
    assert.equal(timers.intervals.length, 1);
    assert.equal(timers.intervals[0].ms, POLICY.NATIVE_IDENTITY_VERIFY_INTERVAL_MS);
    const result = monitor.assertCurrentSync();
    assert.equal(result, undefined);
    monitor.stop();
    assert.equal(timers.intervals[0].cleared, true);
});

test('the request-path check never reads a file while the fingerprint holds', async (t) => {
    const components = makeComponents(t);
    let syncHashes = 0;
    const { monitor } = createMonitor(components, { hashFileSync: (file) => { syncHashes += 1; return legacyHash(file); } });
    await monitor.initialize();
    for (let index = 0; index < 50; index += 1) monitor.assertCurrentSync();
    assert.equal(syncHashes, 0);
});

test('a rename over a component with different bytes is a confirmed change, terminal until restart', async (t) => {
    const components = makeComponents(t);
    const { monitor, sink } = createMonitor(components);
    await monitor.initialize();
    const replacement = `${components[1].file}.new`;
    fs.writeFileSync(replacement, 'tampered-native-binary');
    fs.renameSync(replacement, components[1].file);
    assert.throws(() => monitor.assertCurrentSync(), (error) => error.code === IDENTITY_FAILURE_REASONS.changed
        && error.message === 'Bambu runtime build changed after startup.');
    // Restoring the bytes does not heal it: the verdict is terminal.
    fs.writeFileSync(components[1].file, 'native-bambu-studio-binary');
    assert.throws(() => monitor.assertCurrentSync(), /changed after startup/);
    assert.equal(monitor.getStatus().changed, true);
    assert.deepEqual(monitor.getStatus().reasons, [IDENTITY_FAILURE_REASONS.changed]);
    assert.ok(sink.events.some((event) => event.name === 'identity.failed' && event.outcome === 'changed'));
    assert.ok(sink.metrics.failures.includes('changed'));
});

test('a truncated component is a confirmed change', async (t) => {
    const components = makeComponents(t);
    const { monitor } = createMonitor(components);
    await monitor.initialize();
    fs.truncateSync(components[0].file, 4);
    assert.throws(() => monitor.assertCurrentSync(), /changed after startup/);
});

test('an in-place write with the mtime restored is caught through ctime', async (t) => {
    const components = makeComponents(t);
    const { monitor } = createMonitor(components);
    await monitor.initialize();
    const before = fs.statSync(components[1].file);
    ensureCtimeMoves();
    const handle = fs.openSync(components[1].file, 'r+');
    fs.writeSync(handle, Buffer.from('X'), 0, 1, 0);
    fs.closeSync(handle);
    fs.utimesSync(components[1].file, before.atime, before.mtime);
    assert.throws(() => monitor.assertCurrentSync(), /changed after startup/);
});

test('a moved fingerprint over identical bytes is re-hashed once, adopted and returns', async (t) => {
    const components = makeComponents(t);
    let syncHashes = 0;
    const { monitor } = createMonitor(components, { hashFileSync: (file) => { syncHashes += 1; return legacyHash(file); } });
    await monitor.initialize();
    ensureCtimeMoves();
    const copy = `${components[0].file}.copy`;
    fs.writeFileSync(copy, 'native-apprun');
    fs.renameSync(copy, components[0].file);
    assert.equal(monitor.assertCurrentSync(), undefined);
    assert.equal(syncHashes, components.length, 'the legacy loop runs once over every component');
    assert.equal(monitor.assertCurrentSync(), undefined);
    assert.equal(syncHashes, components.length, 'the new fingerprint was adopted');
    assert.equal(monitor.getStatus().changed, false);
});

test('an unreadable component throws for that call only; the next call tries again', async (t) => {
    const components = makeComponents(t);
    const { monitor } = createMonitor(components);
    await monitor.initialize();
    const aside = `${components[0].file}.aside`;
    fs.renameSync(components[0].file, aside);
    assert.throws(() => monitor.assertCurrentSync(), (error) => error.code === 'ENOENT');
    assert.equal(monitor.getStatus().changed, false);
    fs.renameSync(aside, components[0].file);
    assert.equal(monitor.assertCurrentSync(), undefined);
});

test('a stale verifier never fails a check: gauge, one event per window, a scheduled verification', async (t) => {
    const components = makeComponents(t);
    let streams = 0;
    const { monitor, sink, advance } = createMonitor(components, {
        createReadStream: (file, options) => { streams += 1; return fs.createReadStream(file, options); }
    });
    await monitor.initialize();
    assert.equal(streams, components.length);
    advance(POLICY.NATIVE_IDENTITY_MAX_AGE_MS + 1);
    assert.equal(monitor.assertCurrentSync(), undefined);
    assert.equal(monitor.assertCurrentSync(), undefined);
    assert.equal(monitor.getStatus().stale, true);
    assert.deepEqual(monitor.getStatus().reasons, [IDENTITY_FAILURE_REASONS.stale]);
    assert.deepEqual(sink.metrics.stale, [false, true, true]);
    assert.equal(sink.events.filter((event) => event.name === 'identity.stale').length, 1);
    // The scheduled verification runs and clears the staleness.
    await monitor.verifyNow();
    assert.ok(streams > components.length);
    assert.equal(monitor.getStatus().stale, false);
    assert.equal(sink.metrics.stale.at(-1), false);
});

test('background read errors keep the last good verdict and are counted', async (t) => {
    const components = makeComponents(t);
    let failReads = false;
    const { monitor, sink, advance } = createMonitor(components, {
        createReadStream: (file, options) => {
            if (!failReads) return fs.createReadStream(file, options);
            return new Readable({ read() { this.destroy(Object.assign(new Error('EIO'), { code: 'EIO' })); } });
        }
    });
    await monitor.initialize();
    failReads = true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await monitor.verifyNow();
        assert.deepEqual(result, { ok: false, outcome: 'error' });
    }
    advance(POLICY.NATIVE_IDENTITY_MAX_AGE_MS + 1);
    assert.equal(monitor.assertCurrentSync(), undefined);
    const status = monitor.getStatus();
    assert.equal(status.consecutiveFailures, 3);
    assert.deepEqual(status.reasons, [IDENTITY_FAILURE_REASONS.stale, IDENTITY_FAILURE_REASONS.verifyFailed]);
    assert.deepEqual(sink.metrics.failures, ['read_error', 'read_error', 'read_error']);
    assert.equal(sink.events.filter((event) => event.name === 'identity.failed'
        && event.error_code === 'NATIVE_IDENTITY_READ_FAILED').length, 3);
});

test('a hung read past its deadline is reported as a timeout and never stacks a second read', async (t) => {
    const components = makeComponents(t);
    let hang = false;
    let opened = 0;
    let release;
    const deadlines = [];
    const { monitor, sink } = createMonitor(components, {
        createReadStream: (file, options) => {
            if (!hang) return fs.createReadStream(file, options);
            opened += 1;
            const stream = new Readable({ read() {} });
            release = (buffer) => { stream.push(buffer); stream.push(null); };
            return stream;
        },
        setTimeout: (callback) => { const timer = { callback, unref() {} }; deadlines.push(timer); return timer; },
        clearTimeout: () => {}
    });
    await monitor.initialize();
    hang = true;
    const pending = monitor.verifyNow();
    await waitFor(() => typeof release === 'function');
    deadlines.at(-1).callback();
    assert.deepEqual(await pending, { ok: false, outcome: 'timeout' });
    assert.equal(monitor.getStatus().stalled, true);
    assert.deepEqual(await monitor.verifyNow(), { ok: false, outcome: 'stalled' });
    assert.deepEqual(await monitor.verifyNow(), { ok: false, outcome: 'stalled' });
    assert.equal(opened, 1, 'no second read while the first hangs');
    assert.deepEqual(sink.metrics.failures, ['timeout', 'timeout']);
    assert.equal(monitor.assertCurrentSync(), undefined);
    // The late result is the original bytes: it never re-baselines (no success recorded).
    hang = false;
    release(Buffer.from('native-apprun'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(monitor.getStatus().stalled, false);
    assert.equal(sink.events.filter((event) => event.name === 'identity.verified').length, 1);
});

test('a late `changed` after the deadline is kept as a verdict', async (t) => {
    const components = makeComponents(t);
    let hang = false;
    let release;
    const deadlines = [];
    const { monitor, sink } = createMonitor(components, {
        createReadStream: (file, options) => {
            if (!hang) return fs.createReadStream(file, options);
            const stream = new Readable({ read() {} });
            release = (buffer) => { stream.push(buffer); stream.push(null); };
            return stream;
        },
        setTimeout: (callback) => { const timer = { callback, unref() {} }; deadlines.push(timer); return timer; },
        clearTimeout: () => {}
    });
    await monitor.initialize();
    hang = true;
    const pending = monitor.verifyNow();
    await waitFor(() => typeof release === 'function');
    deadlines.at(-1).callback();
    assert.deepEqual(await pending, { ok: false, outcome: 'timeout' });
    assert.equal(monitor.assertCurrentSync(), undefined);
    // Bytes of the same length but different content arrive after the deadline.
    release(Buffer.from('native-APPRUN'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(monitor.getStatus().changed, true);
    assert.throws(() => monitor.assertCurrentSync(), /changed after startup/);
    assert.ok(sink.events.some((event) => event.name === 'identity.failed' && event.outcome === 'changed'));
});

test('a failed startup verification leaves the monitor disabled (the legacy loop serves)', async (t) => {
    const components = makeComponents(t);
    const { monitor, sink, timers } = createMonitor(components, {
        createReadStream: () => new Readable({ read() { this.destroy(new Error('EIO')); } })
    });
    const status = await monitor.initialize();
    assert.equal(status.monitor, 'disabled');
    assert.equal(monitor.enabled, false);
    monitor.start();
    assert.equal(timers.intervals.length, 0);
    assert.deepEqual(status.reasons, [IDENTITY_FAILURE_REASONS.verifyFailed, IDENTITY_FAILURE_REASONS.monitorOff]);
    assert.equal(sink.events[0].name, 'identity.failed');
});

test('a startup digest that no longer matches disables the monitor and reports the change', async (t) => {
    const components = makeComponents(t);
    fs.writeFileSync(components[0].file, 'native-APPRUN');
    const { monitor } = createMonitor(components);
    const status = await monitor.initialize();
    assert.equal(status.enabled, false);
    assert.equal(status.changed, true);
    assert.ok(status.reasons.includes(IDENTITY_FAILURE_REASONS.changed));
});

test('monitor off: no read, no timer, reason MONITOR_OFF', async (t) => {
    const components = makeComponents(t);
    let streams = 0;
    const { monitor, timers } = createMonitor(components, {
        policy: { ...POLICY, NATIVE_IDENTITY_MONITOR: false }, hashFileSync: undefined,
        createReadStream: () => { streams += 1; throw new Error('unexpected read'); }
    });
    const status = await monitor.initialize();
    monitor.start();
    assert.equal(streams, 0);
    assert.equal(timers.intervals.length, 0);
    assert.equal(status.monitor, 'off');
    assert.deepEqual(status.reasons, [IDENTITY_FAILURE_REASONS.monitorOff]);
    assert.deepEqual(notStartedStatus().reasons, [IDENTITY_FAILURE_REASONS.monitorOff]);
});

test('outcomes map onto the metric reasons of metrics.js', () => {
    const { IDENTITY_FAILURE_METRIC_REASONS } = require('../../../app/services/observability/metrics');
    for (const outcome of ['changed', 'error', 'timeout', 'stalled', 'unstable', 'something-else']) {
        assert.ok(IDENTITY_FAILURE_METRIC_REASONS.includes(metricReasonFor(outcome)), outcome);
    }
    assert.equal(metricReasonFor('error'), 'read_error');
    assert.equal(metricReasonFor('something-else'), 'other');
});

test('the identity events survive the events.js vocabulary filter', async (t) => {
    const { createEventEmitter } = require('../../../app/services/observability/events');
    const written = [];
    const emitEvent = createEventEmitter({ writer: (entry) => written.push(entry), readContext: () => ({}) });
    const components = makeComponents(t);
    const { monitor, advance } = createMonitor(components, { emitEvent });
    await monitor.initialize();
    advance(POLICY.NATIVE_IDENTITY_MAX_AGE_MS + 1);
    monitor.assertCurrentSync();
    fs.writeFileSync(components[0].file, 'native-APPRUN');
    await monitor.verifyNow();
    const names = written.map((entry) => entry.event);
    assert.ok(names.includes('identity.verified'));
    assert.ok(names.includes('identity.stale'));
    assert.ok(names.includes('identity.failed'));
    for (const entry of written) {
        assert.ok(typeof entry.outcome === 'string');
        assert.ok(Number.isFinite(entry.duration_ms));
        assert.equal(entry.extra, undefined);
    }
});

test('a 512 MiB component is hashed without blocking the event loop for more than 20 ms', async (t) => {
    const size = 512 * 1024 * 1024;
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const expected = createHash('sha256');
    for (let index = 0; index < 512; index += 1) expected.update(chunk);
    const digest = expected.digest('hex');
    const fakeStat = { dev: 1n, ino: 2n, size: BigInt(size), mtimeNs: 3n, ctimeNs: 4n,
        isFile: () => true, isSymbolicLink: () => false };
    const { monitor } = createMonitor([{ file: '/opt/bambustudio/bin/bambu-studio', sha256: digest }], {
        lstat: async () => fakeStat,
        lstatSync: () => fakeStat,
        createReadStream: () => Readable.from((async function* chunks() {
            for (let index = 0; index < 512; index += 1) {
                await new Promise((resolve) => setImmediate(resolve));
                yield chunk;
            }
        })(), { objectMode: false })
    });
    let maxGap = 0;
    let last = performance.now();
    let ticking = true;
    const tick = () => {
        const current = performance.now();
        maxGap = Math.max(maxGap, current - last);
        last = current;
        if (ticking) setImmediate(tick);
    };
    setImmediate(tick);
    const status = await monitor.initialize();
    ticking = false;
    assert.equal(status.monitor, 'active');
    assert.ok(maxGap < 20, `longest synchronous span ${maxGap.toFixed(1)} ms`);
    t.diagnostic(`longest synchronous span ${maxGap.toFixed(2)} ms`);
});
