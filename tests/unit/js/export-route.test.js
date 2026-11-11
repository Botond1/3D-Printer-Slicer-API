'use strict';

/**
 * 3.9.0 §2.2–2.3 (T-EXP-U): `POST /bambu/export` and its job routes over a
 * live HTTP server, with the real router, upload lifecycle, export queue
 * class, job store, result files and workspaces, and a fake export runner
 * (the runner's own contract is pinned in export-runner.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const express = require('express');
const { createExportRouter, EXPORT_ROUTE_PATH } = require('../../../app/routes/export.routes');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const { createSliceQueue } = require('../../../app/services/slice/queue');
const { createExportJobStore } = require('../../../app/services/export/export-jobs');
const { createExportFiles } = require('../../../app/services/export/export-files');
const { preValidateSliceRequest } = require('../../../app/services/slice.service');
const { sliceRateLimiter } = require('../../../app/middleware/rateLimit');
const { createRequestIdMiddleware } = require('../../../app/middleware/requestId');
const errorHandler = require('../../../app/middleware/errorHandler');

const GENERATION = 'a'.repeat(64);
const MODEL = 'solid synthetic export source';
const SOURCE_SHA = crypto.createHash('sha256').update(MODEL).digest('hex');
const PLACED = Buffer.from('placed-stl-bytes-0123456789');
const PLACED_SHA = crypto.createHash('sha256').update(PLACED).digest('hex');
const JOB_PATH = /^\/bambu\/export\/jobs\/(ex_[a-f0-9]{32})$/;

const FACTS = Object.freeze({
    sliced_geometry_sha256: PLACED_SHA,
    measurement_generation: GENERATION,
    final_dimensions_mm: { x: 40, y: 40, z: 40 },
    oriented_dimensions_mm: { x: 40, y: 40, z: 40 },
    rotation_matrix: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    rotation_deg: { x: 90, y: 0, z: 0 },
    volume_mm3: 64000.000001,
    placement_mm: { x: 18, y: 0.5 },
    orientation_outcome: 'preserved',
    orientation_mode: 'preserve',
    scale_percent: 100
});

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function multipart(parts) {
    const boundary = `export-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const chunks = [];
    for (const part of parts) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`));
        if (part.filename !== undefined) {
            chunks.push(Buffer.from(`; filename="${part.filename}"\r\nContent-Type: application/octet-stream`));
        }
        chunks.push(Buffer.from(`\r\n\r\n${part.value}\r\n`));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { boundary, body: Buffer.concat(chunks) };
}

function exportParts(overrides = {}, omit = []) {
    const fields = {
        layerHeight: '0.2',
        material: 'PLA',
        printerProfile: 'P1S',
        orientationMode: 'preserve',
        expectedMeasurementGeneration: GENERATION,
        expectedSourceSha256: SOURCE_SHA,
        expectedSlicedGeometrySha256: PLACED_SHA,
        ...overrides
    };
    const parts = [{ name: 'choosenFile', filename: 'r3d-private-0001.stl', value: MODEL }];
    for (const [name, value] of Object.entries(fields)) if (!omit.includes(name)) parts.push({ name, value });
    return parts;
}

function send(port, { method = 'GET', path: target, headers = {}, parts = null }) {
    const payload = parts ? multipart(parts) : null;
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1', port, path: target, method, agent: false,
            headers: {
                'x-test-principal': 'woocommerce',
                ...(payload ? {
                    'content-type': `multipart/form-data; boundary=${payload.boundary}`,
                    'content-length': payload.body.length
                } : {}),
                ...headers
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                let json = null;
                if (/json/.test(res.headers['content-type'] || '') && body.length) json = JSON.parse(body.toString('utf8'));
                resolve({ status: res.statusCode, headers: res.headers, body, json });
            });
        });
        req.on('error', reject);
        req.end(payload ? payload.body : undefined);
    });
}

function principalAuthentication(req, res, next) {
    const slot = req.get('x-test-principal');
    if (!slot) {
        return res.status(401).json({
            success: false, error: 'Slice service authentication is required.', errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
        });
    }
    req.slicePrincipal = Object.freeze({ audience: 'slice', slot, rotation: 'active' });
    return next();
}

const passLimiter = (req, res, next) => next();

/** A fake export runner: it stores PLACED (or a 3MF stand-in) through the real persist path. */
function createFakeRunner() {
    const state = { runs: [], gate: null, answer: null };
    async function runner(input, signal, persist) {
        state.runs.push({ input, signal });
        if (state.gate) await Promise.race([state.gate.promise, new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })]);
        if (signal.aborted) throw signal.reason;
        if (state.answer) return state.answer;
        const scratch = path.join(os.tmpdir(), `export-fake-${crypto.randomBytes(8).toString('hex')}`);
        const bytes = input.fields.format === '3mf' ? Buffer.from('PK-fake-3mf') : PLACED;
        await fs.writeFile(scratch, bytes);
        const stored = await persist(input.fields.format, scratch);
        return {
            status: 200,
            format: input.fields.format,
            fidelity: input.fields.expectedSlicedGeometrySha256 ? 'exact' : 'unverified',
            facts: FACTS,
            file: { path: stored, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
        };
    }
    return { runner, state };
}

async function createHarness(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-route-'));
    const dirs = {
        jobsRoot: path.join(root, 'jobs'), scratchRoot: path.join(root, 'scratch'), outputRoot: path.join(root, 'output')
    };
    await fs.mkdir(dirs.outputRoot);
    const files = createExportFiles({ root: path.join(root, 'jobs-results') });
    const store = createExportJobStore({ files, maxJobs: 4 });
    const queue = createSliceQueue({ maxConcurrent: 2, isRuntimeAvailable: () => true, emitEvent: () => {} });
    const fake = createFakeRunner();
    let allocations = 0;
    const router = createExportRouter({
        enabled: true,
        authenticate: principalAuthentication,
        rateLimiter: passLimiter,
        jobRateLimiter: passLimiter,
        createWorkspace: () => { allocations += 1; return createJobWorkspace(dirs); },
        store,
        enqueue: queue.enqueueExportJob,
        runner: fake.runner,
        preValidate: () => null,
        preflight: null,
        readGeneration: () => ({ measurement_generation: GENERATION }),
        files,
        ...options
    });
    const app = express();
    app.use(createRequestIdMiddleware());
    app.use(router);
    app.all('*', (req, res) => res.status(404).json({ success: false, error: 'Route not found.', errorCode: 'ROUTE_NOT_FOUND' }));
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    async function waitFor(predicate, timeoutMs = 5000) {
        const started = Date.now();
        while (!(await predicate())) {
            if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    async function jobDirectories(directory = dirs.jobsRoot) {
        try {
            return (await fs.readdir(directory)).filter((name) => name.startsWith('job-'));
        } catch {
            return [];
        }
    }
    // The lifecycle cleans a request's workspace after its answer was sent:
    // wait for every cleanup before the server and the root go away.
    // Both halves of a workspace (job dir and scratch dir) must be gone: on
    // Windows an rmdir racing the lifecycle's own removal answers EPERM.
    const settledWorkspaces = () => waitFor(async () => (await jobDirectories()).length === 0
        && (await jobDirectories(dirs.scratchRoot)).length === 0);
    t.after(async () => {
        await settledWorkspaces().catch(() => {});
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    });
    return {
        port, store, files, fake, queue, waitFor, jobDirectories, settledWorkspaces, allocations: () => allocations,
        post: (parts, headers = {}) => send(port, { method: 'POST', path: EXPORT_ROUTE_PATH, parts, headers }),
        get: (target, headers = {}) => send(port, { path: target, headers }),
        del: (target, headers = {}) => send(port, { method: 'DELETE', path: target, headers })
    };
}

const ASYNC = { prefer: 'respond-async' };

test('with the export off every export path is the application 404 ROUTE_NOT_FOUND', async (t) => {
    for (const enabled of [false, undefined]) {
        const options = enabled === undefined ? {} : { enabled };
        const router = createExportRouter(options);
        assert.equal(router.stack.length, 0, 'code default is off (EXPORT_ROUTE_ENABLED=false)');
    }
    const harness = await createHarness(t, { enabled: false });
    for (const [method, target] of [
        ['POST', '/bambu/export'],
        ['GET', `/bambu/export/jobs/ex_${'a'.repeat(32)}`],
        ['GET', `/bambu/export/jobs/ex_${'a'.repeat(32)}/file`],
        ['DELETE', `/bambu/export/jobs/ex_${'a'.repeat(32)}`]
    ]) {
        const response = await send(harness.port, { method, path: target, parts: method === 'POST' ? exportParts() : null });
        assert.equal(response.status, 404, `${method} ${target}`);
        assert.equal(response.json.errorCode, 'ROUTE_NOT_FOUND');
    }
    assert.equal(harness.allocations(), 0);
});

test('route order: authentication, the export bucket (never the slice bucket), then the lifecycle', () => {
    const router = createExportRouter({ enabled: true });
    const routes = router.stack.filter((layer) => layer.route).map((layer) => ({
        path: layer.route.path, methods: Object.keys(layer.route.methods), names: layer.route.stack.map((s) => s.name)
    }));
    assert.deepEqual(routes.map((route) => `${route.methods.join()} ${route.path}`), [
        'post /bambu/export',
        'get /bambu/export/jobs/:job_id/file',
        'get /bambu/export/jobs/:job_id',
        'delete /bambu/export/jobs/:job_id'
    ]);
    assert.deepEqual(routes[0].names.slice(0, 2), ['authenticateOrCharge', 'limiterMiddleware']);
    const postHandles = router.stack.find((layer) => layer.route?.path === '/bambu/export').route.stack.map((s) => s.handle);
    assert.equal(postHandles.includes(sliceRateLimiter), false);
    for (const route of routes.slice(1)) assert.deepEqual(route.names.slice(0, 3), ['noStore', 'authenticateOrCharge', 'limiterMiddleware']);
});

test('twenty exports spend only the export bucket (6/min, burst 3); the slice bucket stays whole', async (t) => {
    const harness = await createHarness(t, { rateLimiter: undefined, preValidate: (req, res) => res.status(400).json({ refused: true }) });
    const statuses = [];
    for (let index = 0; index < 20; index += 1) statuses.push((await harness.post(exportParts(), { 'x-test-principal': 'shop' })).status);
    assert.deepEqual(statuses.slice(0, 3), [400, 400, 400]);
    assert.ok(statuses.slice(3).every((status) => status === 429), statuses.join());
    const limited = await harness.post(exportParts(), { 'x-test-principal': 'shop' });
    assert.equal(limited.json.errorCode, 'RATE_LIMIT_EXCEEDED');
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    // The process-wide slice bucket of the same principal still has its full burst (default 5).
    let passed = 0;
    for (let index = 0; index < 5; index += 1) {
        sliceRateLimiter({ slicePrincipal: { slot: 'shop' } }, { setHeader() {}, status() { return this; }, json() { return this; } }, () => { passed += 1; });
    }
    assert.equal(passed, 5);
});

test('authentication refuses before any workspace is allocated', async (t) => {
    const harness = await createHarness(t);
    const response = await harness.post(exportParts(), { 'x-test-principal': '' });
    assert.equal(response.status, 401);
    assert.equal(response.json.errorCode, 'SLICE_SERVICE_AUTH_REQUIRED');
    assert.equal(harness.allocations(), 0);
});

test('field validation answers 400 before any queue place', async (t) => {
    const harness = await createHarness(t);
    const cases = [
        [exportParts({ exportFormat: 'step' }), 'EXPORT_FORMAT_INVALID'],
        [exportParts({ exportFormat: '' }), 'EXPORT_FORMAT_INVALID'],
        [exportParts({}, ['expectedSourceSha256']), 'EXPORT_REQUEST_INVALID'],
        [exportParts({ expectedSourceSha256: SOURCE_SHA.toUpperCase() }), 'EXPORT_REQUEST_INVALID'],
        [exportParts({ exportLabel: 'Q-123' }), 'EXPORT_REQUEST_INVALID'],
        [exportParts({ exportLabel: '../Q-1234567' }), 'EXPORT_REQUEST_INVALID'],
        [exportParts({ expectedSlicedGeometrySha256: 'nothex' }), 'EXPORT_REQUEST_INVALID'],
        [exportParts({}, ['expectedMeasurementGeneration']), 'EXPORT_REQUEST_INVALID']
    ];
    for (const [parts, code] of cases) {
        for (const headers of [{}, ASYNC]) {
            const response = await harness.post(parts, headers);
            assert.equal(response.status, 400, code);
            assert.equal(response.json.errorCode, code);
            assert.equal(response.json.success, false);
            assert.equal(typeof response.json.error, 'string');
            assert.equal(Object.hasOwn(response.json, 'code'), false);
        }
    }
    assert.equal(harness.fake.state.runs.length, 0);
    assert.equal(harness.store.size(), 0);
    await harness.settledWorkspaces();
    assert.deepEqual(await harness.jobDirectories(), []);
});

test("the slice's own option errors keep the slice's codes", async (t) => {
    const harness = await createHarness(t, { preValidate: preValidateSliceRequest });
    const response = await harness.post(exportParts({ printerProfile: 'X1C' }));
    assert.equal(response.status, 400);
    assert.equal(response.json.errorCode, 'INVALID_PRINTER_PROFILE');
    const noFile = await harness.post(exportParts().slice(1));
    assert.equal(noFile.status, 400);
    assert.equal(noFile.json.errorCode, 'NO_FILE_UPLOADED');
});

test('pre-queue 409s are synchronous, also with Prefer: respond-async', async (t) => {
    const harness = await createHarness(t);
    const cases = [
        [exportParts({ expectedMeasurementGeneration: 'b'.repeat(64) }), 'SLICE_IDENTITY_MISMATCH'],
        [exportParts({ expectedMeasurementGeneration: 'short' }), 'SLICE_IDENTITY_MISMATCH'],
        [exportParts({ expectedProfileSha256: 'not-a-digest' }), 'SLICE_IDENTITY_MISMATCH'],
        [exportParts({ expectedSourceSha256: 'c'.repeat(64) }), 'EXPORT_SOURCE_MISMATCH']
    ];
    for (const [parts, code] of cases) {
        for (const headers of [{}, ASYNC]) {
            const response = await harness.post(parts, headers);
            assert.equal(response.status, 409, code);
            assert.equal(response.json.errorCode, code);
            assert.equal(response.headers.location, undefined);
        }
    }
    // A well-formed profile hash is not compared (the export runs no slice profile).
    const unrelatedProfile = await harness.post(exportParts({ expectedProfileSha256: 'd'.repeat(64) }));
    assert.equal(unrelatedProfile.status, 200);
    assert.equal(harness.fake.state.runs.length, 1);
});

test('the generation must be readable: an engine without identity answers 503', async (t) => {
    const harness = await createHarness(t, { readGeneration: () => { throw new Error('no identity'); } });
    const response = await harness.post(exportParts());
    assert.equal(response.status, 503);
    assert.equal(response.json.errorCode, 'SLICER_ENGINE_UNAVAILABLE');
});

test('sync 200: the body is the file with every §2.2 header, and nothing is kept', async (t) => {
    const harness = await createHarness(t);
    const response = await harness.post(exportParts({ exportLabel: 'Q-1234567' }), { 'x-request-id': 'req-export-1' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, PLACED);
    const h = response.headers;
    assert.equal(h['content-type'], 'model/stl');
    assert.equal(h['content-disposition'], 'attachment; filename="r3d-export.stl"');
    assert.equal(h['cache-control'], 'no-store');
    assert.equal(h['x-content-type-options'], 'nosniff');
    assert.equal(h['x-r3d-export-contract'], '1');
    assert.equal(h['x-r3d-export-fidelity'], 'exact');
    assert.equal(h['x-r3d-export-sha256'], crypto.createHash('sha256').update(response.body).digest('hex'));
    assert.equal(h['x-r3d-sliced-geometry-sha256'], PLACED_SHA);
    assert.equal(h['x-r3d-measurement-generation'], GENERATION);
    assert.equal(h['x-r3d-final-dimensions-mm'], '40.000,40.000,40.000');
    assert.equal(h['x-r3d-placement-mm'], '18.000,0.500');
    assert.equal(h['x-r3d-orientation-outcome'], 'preserved');
    assert.equal(h['x-r3d-rotation-matrix'],
        '1.000000000,0.000000000,0.000000000,0.000000000,0.000000000,-1.000000000,0.000000000,1.000000000,0.000000000');
    assert.equal(h['x-r3d-oriented-dimensions-mm'], '40.000,40.000,40.000');
    assert.equal(h['x-r3d-volume-mm3'], '64000.000001');
    assert.equal(h['x-request-id'], 'req-export-1');
    assert.equal(h['content-length'], String(PLACED.length));
    const run = harness.fake.state.runs[0];
    assert.equal(run.input.fields.exportLabel, 'Q-1234567');
    assert.equal(run.input.generation, GENERATION);
    assert.equal(harness.store.size(), 0);
    await harness.settledWorkspaces();
    assert.deepEqual(await harness.jobDirectories(), []);
});

test('sync: a pipeline refusal passes through with its own status and body', async (t) => {
    const harness = await createHarness(t);
    harness.fake.state.answer = {
        status: 422,
        body: { success: false, error: 'Model dimensions are outside selected printer limits.', errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS', model_dimensions_mm: { x: 400, y: 1, z: 1 } }
    };
    const response = await harness.post(exportParts());
    assert.equal(response.status, 422);
    assert.deepEqual(response.json, harness.fake.state.answer.body);
});

test('sync over the deadline answers 504 EXPORT_DEADLINE_EXCEEDED with retry_async', async (t) => {
    const harness = await createHarness(t, { syncDeadlineMs: 50 });
    harness.fake.state.gate = deferred();
    const response = await harness.post(exportParts());
    assert.equal(response.status, 504);
    assert.deepEqual(response.json, {
        success: false, error: 'The export did not finish within its deadline.', errorCode: 'EXPORT_DEADLINE_EXCEEDED', retry_async: true
    });
    assert.equal(harness.fake.state.runs[0].signal.aborted, true);
});

test('async: 202, poll, file, DELETE — and the job owns and cleans the workspace', async (t) => {
    const harness = await createHarness(t);
    harness.fake.state.gate = deferred();
    const accepted = await harness.post(exportParts({ exportFormat: '3mf' }), ASYNC);
    assert.equal(accepted.status, 202);
    const location = accepted.headers.location;
    const [, jobId] = JOB_PATH.exec(location);
    assert.doesNotMatch(jobId, /^sj_/);
    assert.equal(accepted.headers['preference-applied'], 'respond-async');
    assert.equal(accepted.headers['retry-after'], '2');
    assert.equal(accepted.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(accepted.json), [
        'success', 'export_contract', 'job_id', 'status', 'status_url', 'poll_after_ms', 'deadline_at', 'deadline_ms'
    ]);
    assert.equal(accepted.json.status_url, location);
    assert.equal(accepted.json.deadline_ms, harness.store.deadlineMs);
    // The request finished; the job still holds its workspace with the upload.
    assert.equal((await harness.jobDirectories()).length, 1);
    await harness.waitFor(() => harness.fake.state.runs.length === 1);
    const running = await harness.get(location);
    assert.equal(running.status, 200);
    assert.equal(running.json.status, 'running');
    assert.equal(running.json.queue_position, null);
    assert.equal(running.headers['cache-control'], 'no-store');
    assert.equal(running.headers['retry-after'], '2');
    const early = await harness.get(`${location}/file`);
    assert.equal(early.status, 409);
    assert.equal(early.json.errorCode, 'EXPORT_NOT_READY');
    const stranger = await harness.get(location, { 'x-test-principal': 'leadpilot' });
    assert.equal(stranger.status, 404);
    assert.equal(stranger.json.errorCode, 'EXPORT_JOB_NOT_FOUND');
    harness.fake.state.gate.resolve();
    let completed;
    await harness.waitFor(() => harness.store.lookup(jobId, 'slice:woocommerce')?.state === 'completed');
    completed = await harness.get(location);
    assert.deepEqual(Object.keys(completed.json), [
        'success', 'export_contract', 'job_id', 'status', 'elapsed_ms', 'result_status', 'result'
    ]);
    assert.equal(completed.headers['retry-after'], undefined);
    assert.equal(completed.json.result_status, 200);
    const result = completed.json.result;
    assert.deepEqual(Object.keys(result), [
        'success', 'fidelity', 'format', 'media_type', 'size_bytes', 'sha256', 'sliced_geometry_sha256',
        'measurement_generation', 'final_dimensions_mm', 'oriented_dimensions_mm', 'rotation_matrix', 'volume_mm3',
        'placement_mm', 'orientation_outcome', 'file_url', 'file_expires_at'
    ]);
    assert.equal(result.format, '3mf');
    assert.equal(result.media_type, 'model/3mf');
    assert.equal(result.file_url, `${location}/file`);
    assert.deepEqual(result.placement_mm, { x: 18, y: 0.5 });
    assert.deepEqual(result.rotation_matrix, FACTS.rotation_matrix);
    const file = await harness.get(result.file_url);
    assert.equal(file.status, 200);
    assert.equal(file.body.toString(), 'PK-fake-3mf');
    assert.equal(file.headers['content-type'], 'model/3mf');
    assert.equal(file.headers['content-disposition'], 'attachment; filename="r3d-export.3mf"');
    assert.equal(file.headers['x-r3d-export-sha256'], result.sha256);
    assert.equal(file.headers['x-r3d-sliced-geometry-sha256'], PLACED_SHA);
    await harness.settledWorkspaces();
    assert.deepEqual(await harness.jobDirectories(), [], 'the job cleaned its workspace when it settled');
    const removed = await harness.del(location);
    assert.equal(removed.status, 204);
    assert.equal(removed.headers['cache-control'], 'no-store');
    assert.equal((await harness.get(location)).status, 404);
    assert.equal((await harness.get(`${location}/file`)).status, 404);
    assert.equal((await harness.del(location)).status, 404);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(fs.lstat(harness.files.resultDirectory(jobId)), { code: 'ENOENT' });
});

test('async: DELETE of a running job aborts it; a failed job has no file', async (t) => {
    const harness = await createHarness(t);
    harness.fake.state.gate = deferred();
    const accepted = await harness.post(exportParts(), ASYNC);
    const location = accepted.headers.location;
    await harness.waitFor(() => harness.fake.state.runs.length === 1);
    assert.equal((await harness.del(location)).status, 204);
    await harness.waitFor(() => harness.fake.state.runs[0].signal.aborted);
    assert.equal(harness.fake.state.runs[0].signal.reason.code, 'EXPORT_CANCELLED');
    assert.equal((await harness.get(location)).status, 404);
    await harness.settledWorkspaces();

    harness.fake.state.gate = null;
    harness.fake.state.answer = {
        status: 409,
        body: { success: false, error: 'x', errorCode: 'EXPORT_GEOMETRY_MISMATCH', actual_sliced_geometry_sha256: 'e'.repeat(64), orientation_outcome: 'applied' }
    };
    const second = await harness.post(exportParts(), ASYNC);
    const [, jobId] = JOB_PATH.exec(second.headers.location);
    await harness.waitFor(() => harness.store.lookup(jobId, 'slice:woocommerce')?.state === 'completed');
    const view = await harness.get(second.headers.location);
    assert.equal(view.json.result_status, 409);
    assert.deepEqual(view.json.result, harness.fake.state.answer.body);
    const file = await harness.get(`${second.headers.location}/file`);
    assert.equal(file.status, 409);
    assert.equal(file.json.errorCode, 'EXPORT_NOT_READY');
});

test('the fifth export while four are queued or running gets 429 EXPORT_QUEUE_FULL, Retry-After 10', async (t) => {
    const harness = await createHarness(t);
    harness.fake.state.gate = deferred();
    for (let index = 0; index < 4; index += 1) assert.equal((await harness.post(exportParts(), ASYNC)).status, 202);
    for (const headers of [ASYNC, {}]) {
        const refused = await harness.post(exportParts(), headers);
        assert.equal(refused.status, 429);
        assert.equal(refused.json.errorCode, 'EXPORT_QUEUE_FULL');
        assert.equal(refused.headers['retry-after'], '10');
    }
    harness.fake.state.gate.resolve();
    await harness.waitFor(() => harness.store.inFlight() === 0);
});

test('a queued export reports its position in the export class', async (t) => {
    const harness = await createHarness(t);
    harness.fake.state.gate = deferred();
    const first = await harness.post(exportParts(), ASYNC);
    const second = await harness.post(exportParts(), ASYNC);
    await harness.waitFor(() => harness.fake.state.runs.length === 1);
    const queued = await harness.get(second.headers.location);
    assert.equal(queued.json.status, 'queued');
    assert.equal(queued.json.queue_position, 1);
    assert.equal((await harness.get(first.headers.location)).json.status, 'running');
    harness.fake.state.gate.resolve();
    await harness.waitFor(() => harness.store.inFlight() === 0);
});
