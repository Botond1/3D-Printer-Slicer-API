'use strict';

/** Live HTTP harness for asynchronous slice jobs: real routes, queue, store and workspaces; fake pipeline. */

const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSliceRouter } = require('../../../../app/routes/slice.routes');
const { createSliceJobsRouter } = require('../../../../app/routes/slice-jobs.routes');
const { createJobWorkspace } = require('../../../../app/services/slice/workspace');
const { createSliceQueue } = require('../../../../app/services/slice/queue');
const { createAsyncSliceJobStore } = require('../../../../app/services/slice/async-jobs');
const { createSliceHandlers } = require('../../../../app/services/slice.service');
const {
    writeJsonAndWaitForFinish,
    setResponseSettlement
} = require('../../../../app/services/slice/response-lifecycle');
const errorHandler = require('../../../../app/middleware/errorHandler');
const { createRequestIdMiddleware } = require('../../../../app/middleware/requestId');

const CLIENT_IP = '203.0.113.7';
const JOB_PATH = /^\/bambu\/slice\/jobs\/(sj_[a-f0-9]{32})$/;

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

function multipart(parts) {
    const boundary = `async-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

const SLICE_PARTS = Object.freeze([
    { name: 'choosenFile', filename: 'cube.stl', value: 'solid synthetic' },
    { name: 'layerHeight', value: '0.2' },
    { name: 'material', value: 'PLA' }
]);

/**
 * One HTTP exchange. `agent` defaults to a fresh connection.
 * @returns {Promise<{status: number, headers: object, text: string, json: object|null, socket: object}>}
 */
function send(port, { method = 'GET', path: target, headers = {}, parts = null, agent = false, onResponse }) {
    const payload = parts ? multipart(parts) : null;
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1', port, path: target, method, agent,
            headers: {
                'x-test-principal': 'shared',
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
                const text = Buffer.concat(chunks).toString('utf8');
                const result = { status: res.statusCode, headers: res.headers, text, json: text ? JSON.parse(text) : null, socket: res.socket };
                onResponse?.(result);
                resolve(result);
            });
        });
        req.on('error', reject);
        req.end(payload ? payload.body : undefined);
    });
}

/** A fake pipeline that answers exactly like the real one: write, then settle the artifact release. */
function createFakePipeline() {
    const state = { runs: [], released: 0, gate: null, answer: null };
    async function processSlice(req, res, options) {
        const run = { signal: options.signal, engine: options.engine, started: Date.now() };
        state.runs.push(run);
        if (state.gate) {
            await Promise.race([
                state.gate.promise,
                new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
            ]);
        }
        const answer = state.answer || { status: 200, body: { success: true, engine: options.engine } };
        for (const [name, value] of Object.entries(answer.headers || {})) res.setHeader(name, value);
        if (answer.status !== 200) return res.status(answer.status).json(answer.body);
        setResponseSettlement(req, writeJsonAndWaitForFinish(res, answer.body).then(() => { state.released += 1; }));
        return res;
    }
    return { state, processSlice };
}

function principalAuthentication(req, res, next) {
    const slot = req.get('x-test-principal');
    if (!slot) return res.status(401).json({ success: false, error: 'Slice service authentication is required.', errorCode: 'SLICE_SERVICE_AUTH_REQUIRED' });
    req.slicePrincipal = Object.freeze({ audience: 'slice', slot });
    return next();
}

async function createAsyncHarness(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'async-slice-'));
    const dirs = { jobsRoot: path.join(root, 'jobs'), scratchRoot: path.join(root, 'scratch'), outputRoot: path.join(root, 'output') };
    await fs.mkdir(dirs.outputRoot);
    const queue = createSliceQueue({
        maxConcurrent: 1, maxQueueLength: 10, maxQueuePerClient: 10, maxWaitMs: 60_000,
        emitEvent: () => {}, recordQueueRejection: () => {}, ...options.queue
    });
    const events = [];
    const store = createAsyncSliceJobStore({
        deadlineMs: 60_000, resultTtlMs: 60_000, maxJobs: 10,
        emitEvent: (name, data) => events.push({ name, ...data }), ...options.store
    });
    const pipeline = options.pipeline || createFakePipeline();
    const handlers = createSliceHandlers({
        enqueueSliceJobImpl: queue.enqueueSliceJob,
        processSliceImpl: pipeline.processSlice,
        validateSliceRequestImpl: options.validate,
        getClientIpImpl: () => CLIENT_IP,
        asyncJobStore: options.asyncJobStore === undefined ? store : options.asyncJobStore
    });
    let settledCount = 0;
    let allocatedCount = 0;
    const app = express();
    const pass = (req, res, next) => next();
    app.use(createRequestIdMiddleware());
    app.use(createSliceRouter({
        rateLimiter: pass,
        authenticate: principalAuthentication,
        createWorkspace: () => {
            allocatedCount += 1;
            return createJobWorkspace(dirs);
        },
        handleBambu: handlers.handleSliceBambu,
        handlePrusa: handlers.handleSlicePrusa,
        onLifecycleSettled() { settledCount += 1; }
    }));
    app.use(createSliceJobsRouter({ rateLimiter: pass, authenticate: principalAuthentication, store }));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    t.after(async () => {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });
    const harness = {
        port, queue, store, events, pipeline, dirs,
        settledCount: () => settledCount,
        submit: (headers = {}, extra = {}) => send(port, {
            method: 'POST', path: '/bambu/slice', parts: SLICE_PARTS,
            headers: { prefer: 'respond-async', ...headers }, ...extra
        }),
        status: (location, headers = {}, agent = false) => send(port, { path: location, headers, agent }),
        cancel: (location, headers = {}) => send(port, { method: 'DELETE', path: location, headers }),
        async waitFor(predicate, timeoutMs = 10_000) {
            const started = Date.now();
            while (!(await predicate())) {
                if (Date.now() - started > timeoutMs) throw new Error('Condition was not met in time.');
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
        },
        async pollCompleted(location, headers = {}) {
            let response;
            await harness.waitFor(async () => {
                response = await harness.status(location, headers);
                return response.json?.status === 'completed';
            });
            return response;
        },
        async assertDrained() {
            await harness.waitFor(() => {
                const status = queue.getQueueStatus();
                return status.queueLength === 0 && status.activeJobs === 0;
            });
            // Every request lifecycle (including the async ones) finished its workspace cleanup.
            await harness.waitFor(() => settledCount === allocatedCount);
            await harness.waitFor(async () => (await fs.readdir(dirs.jobsRoot)).length === 0);
            await harness.waitFor(async () => (await fs.readdir(dirs.scratchRoot)).length === 0);
        }
    };
    return harness;
}

module.exports = {
    CLIENT_IP,
    JOB_PATH,
    SLICE_PARTS,
    createAsyncHarness,
    createFakePipeline,
    deferred,
    send
};
