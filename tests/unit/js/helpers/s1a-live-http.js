'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSliceRouter } = require('../../../../app/routes/slice.routes');
const { createJobWorkspace } = require('../../../../app/services/slice/workspace');
const errorHandler = require('../../../../app/middleware/errorHandler');

function multipart(parts, boundary = `s1a-${Date.now()}-${Math.random().toString(16).slice(2)}`, close = true) {
    const chunks = [];
    for (const part of parts) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`));
        if (part.filename !== undefined) chunks.push(Buffer.from(`; filename="${part.filename}"\r\nContent-Type: application/octet-stream`));
        chunks.push(Buffer.from('\r\n\r\n'));
        chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value ?? '')));
        chunks.push(Buffer.from('\r\n'));
    }
    if (close) chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { boundary, body: Buffer.concat(chunks) };
}

function request(port, payload) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/prusa/slice', method: 'POST', headers: {
            'content-type': `multipart/form-data; boundary=${payload.boundary}`,
            'content-length': payload.body.length
        } }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
            });
        });
        req.on('error', reject);
        req.end(payload.body);
    });
}

async function createHarness(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 's1a-live-'));
    const jobsRoot = path.join(root, 'jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot);
    let settledResolve;
    let settled = new Promise((resolve) => { settledResolve = resolve; });
    const settlements = [];
    const app = express();
    const allocate = options.createWorkspace
        ? () => options.createWorkspace({ jobsRoot, outputRoot })
        : () => createJobWorkspace({ jobsRoot, outputRoot });
    app.use(createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate(req, res, next) { next(); },
        createWorkspace: allocate,
        multipartLimits: options.multipartLimits,
        resourcePolicy: options.resourcePolicy,
        timers: options.timers,
        cleanupWorkspace: options.cleanupWorkspace,
        handlePrusa: options.handler || ((req, res) => res.status(200).json({ success: true, fields: Object.keys(req.body), file: Boolean(req.file) })),
        onLifecycleSettled(info) { settlements.push(info); settledResolve(info); }
    }));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(root, { recursive: true, force: true });
    });
    return {
        root, jobsRoot, port: server.address().port, settlements,
        waitSettled: () => settled,
        resetSettled() { settled = new Promise((resolve) => { settledResolve = resolve; }); },
        assertClean: async () => require('node:assert/strict').deepEqual(await fs.readdir(jobsRoot), [])
    };
}

module.exports = { multipart, request, createHarness };
