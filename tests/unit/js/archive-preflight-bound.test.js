'use strict';

// 3.9.0 WP3, T-ARC-4: the pre-queue archive preflight is bounded. One worker
// thread inspects one archive at a time, at most MAX_SLICE_QUEUE_LENGTH (24)
// requests wait, the main thread keeps answering, a killed worker refuses
// only its own request, and a consumed verdict skips the tokenizer once.
//
// The admitted archive inflates to R3D_ARC4_INFLATE_MIB MiB (default 32; the
// specification's 400 MiB run is `R3D_ARC4_INFLATE_MIB=400`), which keeps the
// default suite fast while the bound under test is the same.

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = originalPythonExecutable || process.execPath;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { ZipArchive } = require('archiver');
const { createArchivePreflight, sendPreflightRefusal } = require('../../../app/services/slice/archive-preflight');
const { inspectThreeMfPackage } = require('../../../app/services/slice/three-mf');
const { clearExpansionVerdictsForTests } = require('../../../app/services/slice/three-mf-expansion');
const { SliceQueueFullError } = require('../../../app/services/slice/queue');
const { setEventWriter } = require('../../../app/services/observability/events');
const { CONTENT_TYPES, RELS, makeArchive, tetrahedronThreeMf } = require('../../fixtures/archives/archive-cases');

const INFLATE_MIB = Number.parseInt(process.env.R3D_ARC4_INFLATE_MIB || '32', 10);

test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

function mockResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

/** An admitted 3MF whose model part inflates to about `mib` MiB (ratio well under 100). */
async function writeLargeAdmittedThreeMf(target, mib) {
    const triangleBytes = 48;
    const triangles = Math.floor((mib * 1024 * 1024) / triangleBytes);
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' });
        const archive = new ZipArchive({ zlib: { level: 1 } });
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
        archive.pipe(output);
        archive.append(CONTENT_TYPES, { name: '[Content_Types].xml' });
        archive.append(RELS, { name: '_rels/.rels' });
        const { Readable } = require('node:stream');
        let index = 0;
        const head = '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" '
            + 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
            + '<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles>';
        const tail = '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
        const body = new Readable({
            read() {
                if (index === 0) this.push(head);
                if (index >= triangles) {
                    this.push(tail);
                    this.push(null);
                    return;
                }
                const lines = [];
                const end = Math.min(triangles, index + 20_000);
                for (; index < end; index += 1) {
                    lines.push(`<triangle v1="${index}" v2="${index * 7 + 1}" v3="${index * 13 + 2}"/>`);
                }
                this.push(lines.join(''));
            }
        });
        archive.append(body, { name: '3D/3dmodel.model' });
        archive.finalize();
    });
    return triangles;
}

async function tempDir(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wp3-bound-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

test('30 parallel uploads: one inflate at a time, 24 waiting, the rest 503 SLICE_QUEUE_FULL; the main thread keeps answering', async (t) => {
    setEventWriter(() => {});
    const root = await tempDir(t);
    const file = path.join(root, 'upload-large');
    const triangles = await writeLargeAdmittedThreeMf(file, INFLATE_MIB);
    const preflight = createArchivePreflight({ maxWaiting: 24 });
    const server = http.createServer((req, res) => res.end('{"status":"ready"}'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        setEventWriter(undefined);
        await preflight.close();
        await new Promise((resolve) => server.close(resolve));
    });
    const { port } = server.address();
    const probeLatencies = [];
    let probing = true;
    const probe = (async () => {
        while (probing) {
            const started = process.hrtime.bigint();
            await new Promise((resolve, reject) => {
                http.get({ host: '127.0.0.1', port, path: '/ready', agent: false }, (res) => {
                    res.resume();
                    res.once('end', resolve);
                }).once('error', reject);
            });
            probeLatencies.push(Number(process.hrtime.bigint() - started) / 1e6);
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    })();
    const delay = monitorEventLoopDelay({ resolution: 5 });
    delay.enable();
    let observedMaxRunning = 0;
    const sampler = setInterval(() => {
        observedMaxRunning = Math.max(observedMaxRunning, preflight.stats().running);
    }, 5);

    const outcomes = await Promise.allSettled(Array.from({ length: 30 }, () => preflight.run(file)));
    clearInterval(sampler);
    delay.disable();
    probing = false;
    await probe;

    const admitted = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    assert.equal(admitted.length, 25, 'one running + 24 waiting');
    assert.equal(refused.length, 5);
    for (const outcome of admitted) {
        assert.equal(outcome.value.admitted, true);
        assert.equal(outcome.value.counts.triangles, triangles);
    }
    for (const outcome of refused) {
        assert.ok(outcome.reason instanceof SliceQueueFullError);
        const res = mockResponse();
        sendPreflightRefusal(outcome.reason, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.errorCode, 'SLICE_QUEUE_FULL');
        assert.equal(res.headers['retry-after'], '5');
        assert.deepEqual(Object.keys(res.body), ['success', 'error', 'errorCode']);
    }
    const stats = preflight.stats();
    assert.equal(stats.maxRunning, 1, 'at most one inflate at any moment (worker counter)');
    assert.equal(observedMaxRunning, 1);
    assert.equal(stats.workersCreated, 1);
    assert.equal(stats.refusedFull, 5);
    const loopMaxMs = delay.max / 1e6;
    assert.ok(loopMaxMs < 50, `main-thread event-loop delay max ${loopMaxMs} ms`);
    assert.ok(probeLatencies.length > 3, 'the probe ran during the burst');
    assert.ok(Math.max(...probeLatencies) < 100, `probe max ${Math.max(...probeLatencies)} ms`);
});

test('a killed worker refuses only its own request; the next request gets a new worker', async (t) => {
    setEventWriter(() => {});
    const root = await tempDir(t);
    const file = path.join(root, 'upload-large');
    await writeLargeAdmittedThreeMf(file, 16);
    const small = path.join(root, 'upload-small');
    await makeArchive(small, tetrahedronThreeMf());
    const preflight = createArchivePreflight({ maxWaiting: 24 });
    t.after(async () => {
        setEventWriter(undefined);
        await preflight.close();
    });
    const doomed = preflight.run(file);
    const next = preflight.run(small);
    while (preflight.stats().running === 0) await new Promise((resolve) => setImmediate(resolve));
    await preflight.terminateActiveWorker();
    const error = await doomed.then(() => null, (caught) => caught);
    assert.ok(error, 'the killed request is refused');
    const res = mockResponse();
    sendPreflightRefusal(error, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.errorCode, 'INVALID_SOURCE_ARCHIVE');
    assert.equal(res.body.archive_rule, 'ARCHIVE_UNREADABLE');
    const served = await next;
    assert.deepEqual(served.counts, { triangles: 4, instances: 1, objects: 1 });
    assert.equal(preflight.stats().workersCreated, 2);
    assert.equal(preflight.stats().crashed, 1);
});

test('a consumed verdict skips the tokenizer once; a second job on the same file re-tokenizes', async (t) => {
    clearExpansionVerdictsForTests();
    const root = await tempDir(t);
    const upload = path.join(root, 'upload-0123');
    await makeArchive(upload, tetrahedronThreeMf());
    const preflight = createArchivePreflight({ maxWaiting: 24 });
    t.after(async () => {
        clearExpansionVerdictsForTests();
        await preflight.close();
    });
    const admission = await preflight.run(upload);
    assert.equal(admission.verdict, true);
    // The job renames the upload to carry its original extension.
    const renamed = `${upload}.3mf`;
    await fsp.rename(upload, renamed);
    const first = await inspectThreeMfPackage(renamed);
    assert.equal(first.verdictConsumed, true);
    assert.deepEqual(first.expansion, { triangles: 4, instances: 1, objects: 1 });
    const second = await inspectThreeMfPackage(renamed);
    assert.equal(second.verdictConsumed, false, 're-tokenized');
    assert.deepEqual(second.expansion, first.expansion);
    assert.deepEqual(second.summary, first.summary);
});

test('an archive yauzl cannot open is left to the job (3.8.3 answers it there); waiting requests can be aborted', async (t) => {
    const root = await tempDir(t);
    const junk = path.join(root, 'upload-junk');
    await fsp.writeFile(junk, 'not a zip');
    const preflight = createArchivePreflight({ maxWaiting: 2 });
    t.after(() => preflight.close());
    assert.deepEqual(await preflight.run(junk), { admitted: true, counts: null, verdict: false });
    const large = path.join(root, 'upload-large');
    await writeLargeAdmittedThreeMf(large, 8);
    const running = preflight.run(large);
    const controller = new AbortController();
    const waiting = preflight.run(large, { signal: controller.signal });
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(preflight.stats().waiting, 0);
    await running;
});
