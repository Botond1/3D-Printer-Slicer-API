'use strict';

/**
 * T-ID (3.9.0 §4.1, §7, §11 K2-B1/B2): `assertBambuBuildCurrent()` through
 * `bambu-generation.js` with real component files — the synchronous
 * contract, the legacy loop when the monitor is off, the bound function the
 * hashed callers and `bambu-readiness.js` hold, and staleness/background
 * failures that never fail `/ready` or a slice submission.
 */

const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const ROOT = path.resolve(__dirname, '../..', '..');
process.env.BAMBU_PROFILES_ROOT = path.join(ROOT, 'tests/unit/fixtures/bambu-profiles');
// bambu-readiness resolves a Python path at require time; its runner is stubbed here.
if (!process.env.PYTHON_EXECUTABLE) process.env.PYTHON_EXECUTABLE = process.execPath;

const generationModule = require('../../../app/services/slice/bambu-generation');
const { createBambuReadiness } = require('../../../app/services/slice/bambu-readiness');
const { createReadinessService } = require('../../../app/services/readiness.service');

const {
    assertBambuBuildCurrent,
    getBambuGeneration,
    getNativeIdentityStatus,
    initializeBambuGeneration,
    startNativeIdentityMonitor,
    IDENTITY_FAILURE_REASONS
} = generationModule;

const POLICY = Object.freeze({
    NATIVE_IDENTITY_MONITOR: true,
    NATIVE_IDENTITY_VERIFY_INTERVAL_MS: 300_000,
    NATIVE_IDENTITY_MAX_AGE_MS: 900_000,
    NATIVE_IDENTITY_TIMEOUT_MS: 120_000
});

const unhandled = [];
const onUnhandled = (reason) => { unhandled.push(reason); };
process.on('unhandledRejection', onUnhandled);
let activeMonitor = null;
after(() => {
    if (activeMonitor) activeMonitor.stop();
    process.off('unhandledRejection', onUnhandled);
    assert.deepEqual(unhandled, [], 'no T-ID case may leave an unhandled rejection');
});

function installNatives(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-generation-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const executable = path.join(root, 'bambu-studio.exe');
    const library = path.join(root, 'BambuStudio.dll');
    fs.writeFileSync(executable, 'fake-bambu-studio-executable');
    fs.writeFileSync(library, 'fake-bambu-studio-library');
    const generation = initializeBambuGeneration('02.08.02.61', { executable, platform: 'win32' });
    return { executable, library, generation };
}

async function startMonitor(options = {}) {
    let clock = 10_000;
    const timers = [];
    const monitor = await startNativeIdentityMonitor({
        policy: POLICY, now: () => clock,
        setInterval: (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer; },
        clearInterval: () => {}, emitEvent: () => {}, ...options
    });
    activeMonitor = monitor;
    return { monitor, timers, advance(ms) { clock += ms; } };
}

function readiness() {
    const files = Array.from({ length: 8 }, () => __filename);
    const bambuReadiness = createBambuReadiness({ runner: async () => ({ stdout: JSON.stringify(files) }) });
    return bambuReadiness.initialize({ bambu: '02.08.02.61' }).then(() => bambuReadiness);
}

function readinessService(bambuReadiness) {
    const always = () => true;
    return createReadinessService({
        production: false,
        getQueueStatus: () => ({ queueLength: 0, activeJobs: 0, maxConcurrent: 2, maxQueueLength: 24, acceptingJobs: true }),
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        getSlicerRuntimeStatus: () => bambuReadiness.getStatus(),
        probes: { native: always, storage: always, retention: always, pricing: always, config: always }
    });
}

function ensureCtimeMoves() {
    const until = Date.now() + 25;
    while (Date.now() < until) { /* spin */ }
}

function isThenable(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

test('the exports keep their 3.8.3 names and gain only the three monitor names', () => {
    assert.deepEqual(Object.keys(generationModule), ['PROCESSING_SCHEMA', 'initializeBambuGeneration', 'getBambuGeneration',
        'catalogueGenerationFields', 'assertBambuBuildCurrent', 'startNativeIdentityMonitor', 'getNativeIdentityStatus',
        'IDENTITY_FAILURE_REASONS']);
    assert.deepEqual(Object.values(IDENTITY_FAILURE_REASONS).sort(), ['NATIVE_IDENTITY_CHANGED',
        'NATIVE_IDENTITY_MONITOR_OFF', 'NATIVE_IDENTITY_STALE', 'NATIVE_IDENTITY_VERIFY_FAILED']);
});

test('the hashed callers and bambu-readiness bind the same exported function object', () => {
    const outputLifecycle = fs.readFileSync(path.join(ROOT, 'app/services/slice/output-lifecycle.js'), 'utf8');
    assert.match(outputLifecycle, /const \{ assertBambuBuildCurrent \} = require\('\.\/bambu-generation'\);/);
    assert.doesNotMatch(outputLifecycle, /await assertBambuBuildCurrent/);
    const readinessSource = fs.readFileSync(path.join(ROOT, 'app/services/slice/bambu-readiness.js'), 'utf8');
    assert.match(readinessSource, /const \{ assertBambuBuildCurrent \} = require\('\.\/bambu-generation'\);/);
    assert.equal(require('../../../app/services/slice/bambu-generation').assertBambuBuildCurrent, assertBambuBuildCurrent);
});

test('monitor on: the check never calls readFileSync and returns exactly undefined', async (t) => {
    installNatives(t);
    const { monitor } = await startMonitor();
    assert.equal(monitor.enabled, true);
    const readFileSync = t.mock.method(fs, 'readFileSync');
    for (let index = 0; index < 20; index += 1) {
        const result = assertBambuBuildCurrent();
        assert.equal(result, undefined);
        assert.equal(isThenable(result), false);
    }
    assert.equal(readFileSync.mock.callCount(), 0);
    assert.deepEqual(getNativeIdentityStatus().reasons, []);
});

test('monitor off: the 3.8.3 loop runs (readFileSync per component) and the check stays synchronous', async (t) => {
    const { executable, library } = installNatives(t);
    const { monitor } = await startMonitor({ policy: { ...POLICY, NATIVE_IDENTITY_MONITOR: false } });
    assert.equal(monitor.enabled, false);
    const readFileSync = t.mock.method(fs, 'readFileSync');
    assert.equal(assertBambuBuildCurrent(), undefined);
    assert.deepEqual(readFileSync.mock.calls.map((call) => call.arguments[0]), [executable, library]);
    assert.deepEqual(getNativeIdentityStatus().reasons, [IDENTITY_FAILURE_REASONS.monitorOff]);
    readFileSync.mock.restore();
    fs.writeFileSync(library, 'tampered-library');
    let thrown = null;
    try { assertBambuBuildCurrent(); } catch (error) { thrown = error; }
    assert.equal(thrown?.message, 'Bambu runtime build changed after startup.');
});

test('startup generation object is deep-equal (and the same object) before and after the monitor', async (t) => {
    const { generation } = installNatives(t);
    const before = structuredClone(generation);
    const { monitor, advance } = await startMonitor();
    assertBambuBuildCurrent();
    advance(POLICY.NATIVE_IDENTITY_MAX_AGE_MS + 1);
    assertBambuBuildCurrent();
    await monitor.verifyNow();
    assert.equal(getBambuGeneration(), generation);
    assert.deepEqual(structuredClone(getBambuGeneration()), before);
});

test('a confirmed change throws synchronously in a plain try and turns bambu readiness false', async (t) => {
    const { library } = installNatives(t);
    await startMonitor();
    const bambuReadiness = await readiness();
    assert.equal(bambuReadiness.getStatus().bambuReady, true);
    const replacement = `${library}.new`;
    fs.writeFileSync(replacement, 'tampered-library');
    fs.renameSync(replacement, library);
    let thrown = null;
    let returned;
    try { returned = assertBambuBuildCurrent(); } catch (error) { thrown = error; }
    assert.equal(returned, undefined);
    assert.equal(thrown?.message, 'Bambu runtime build changed after startup.');
    assert.equal(bambuReadiness.getStatus().bambuReady, false);
    assert.equal(bambuReadiness.isEngineAvailable('bambu'), false);
    assert.deepEqual(getNativeIdentityStatus().reasons, [IDENTITY_FAILURE_REASONS.changed]);
    const service = readinessService(bambuReadiness).getFreshStatus();
    assert.equal(service.ready, false);
    assert.ok(service.reasonCodes.includes('BAMBU_RUNTIME_UNAVAILABLE'));
});

test('an unreadable native throws synchronously for that call; bambu readiness false, then recovers', async (t) => {
    const { executable } = installNatives(t);
    await startMonitor();
    const bambuReadiness = await readiness();
    const aside = `${executable}.aside`;
    fs.renameSync(executable, aside);
    let thrown = null;
    try { assertBambuBuildCurrent(); } catch (error) { thrown = error; }
    assert.ok(thrown instanceof Error);
    assert.equal(bambuReadiness.getStatus().bambuReady, false);
    assert.equal(bambuReadiness.isEngineAvailable('bambu'), false);
    fs.renameSync(aside, executable);
    assert.equal(bambuReadiness.getStatus().bambuReady, true);
});

test('a moved fingerprint with an equal digest returns and adopts the new fingerprint', async (t) => {
    const { library } = installNatives(t);
    await startMonitor();
    ensureCtimeMoves();
    const copy = `${library}.copy`;
    fs.writeFileSync(copy, 'fake-bambu-studio-library');
    fs.renameSync(copy, library);
    const readFileSync = t.mock.method(fs, 'readFileSync');
    assert.equal(assertBambuBuildCurrent(), undefined);
    assert.equal(readFileSync.mock.callCount(), 2, 'the legacy loop ran once over both components');
    assert.equal(assertBambuBuildCurrent(), undefined);
    assert.equal(readFileSync.mock.callCount(), 2, 'adopted: no second hash');
});

test('stale and three failed background attempts never fail the check, /ready or a slice submission', async (t) => {
    installNatives(t);
    let failReads = false;
    const { monitor, advance } = await startMonitor({
        createReadStream: (file, options) => (failReads
            ? new Readable({ read() { this.destroy(Object.assign(new Error('EIO'), { code: 'EIO' })); } })
            : fs.createReadStream(file, options))
    });
    const bambuReadiness = await readiness();
    failReads = true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.deepEqual(await monitor.verifyNow(), { ok: false, outcome: 'error' });
    }
    advance(POLICY.NATIVE_IDENTITY_MAX_AGE_MS + 1);
    const readFileSync = t.mock.method(fs, 'readFileSync');
    let thrown = null;
    let returned = 'not-called';
    try { returned = assertBambuBuildCurrent(); } catch (error) { thrown = error; }
    assert.equal(thrown, null);
    assert.equal(returned, undefined);
    assert.equal(readFileSync.mock.callCount(), 0);
    assert.equal(bambuReadiness.getStatus().bambuReady, true);
    // The slice route refuses with 503 SLICER_ENGINE_UNAVAILABLE only when this is false.
    assert.equal(bambuReadiness.isEngineAvailable('bambu'), true);
    const service = readinessService(bambuReadiness).getFreshStatus();
    assert.equal(service.ready, true, '/ready answers 200');
    assert.deepEqual(service.reasonCodes, []);
    // Only the operations view carries the informational reasons.
    assert.deepEqual(getNativeIdentityStatus().reasons, [IDENTITY_FAILURE_REASONS.stale, IDENTITY_FAILURE_REASONS.verifyFailed]);
    // Let the stale path's scheduled verification settle inside this test.
    await monitor.verifyNow();
});

test('a fresh module: status before start is MONITOR_OFF and start refuses before the generation exists', async () => {
    const modulePath = require.resolve('../../../app/services/slice/bambu-generation');
    const original = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
        const fresh = require(modulePath);
        assert.equal(fresh.getNativeIdentityStatus().monitor, 'not_started');
        assert.deepEqual(fresh.getNativeIdentityStatus().reasons, [IDENTITY_FAILURE_REASONS.monitorOff]);
        await assert.rejects(fresh.startNativeIdentityMonitor({ policy: POLICY }), /runtime identity is unavailable/);
        assert.throws(() => fresh.assertBambuBuildCurrent(), /changed after startup/);
    } finally {
        require.cache[modulePath] = original;
    }
});
