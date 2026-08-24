'use strict';

/** Liveness, readiness, and audience-scoped operational routes. */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { APP_ROOT } = require('../config/paths');
const requireAdmin = require('../middleware/requireAdmin');
const { adminRateLimiter } = require('../middleware/rateLimit');
const { createReadinessService } = require('../services/readiness.service');
const { renderMetrics } = require('../services/observability/metrics');
const { outputFilesHandler, downloadHandler } = require('./admin-download.handlers');

async function checkPythonAvailability() {
    return new Promise((resolve) => {
        let output = '';
        let settled = false;
        let pythonExecutable;
        try {
            pythonExecutable = require('../config/python').PYTHON_EXECUTABLE;
        } catch {
            resolve({ available: false, version: null });
            return;
        }
        const proc = spawn(pythonExecutable, ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 2000
        });
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(value);
        };
        const timeoutId = setTimeout(() => {
            try { proc.kill(); } catch {}
            finish({ available: false, version: null });
        }, 2000);
        timeoutId.unref?.();
        proc.stdout?.on('data', (data) => { output += data.toString().trim(); });
        proc.stderr?.on('data', (data) => { output += data.toString().trim(); });
        proc.on('close', (code) => finish(code === 0 && output
            ? { available: true, version: output.slice(0, 128) }
            : { available: false, version: null }));
        proc.on('error', () => finish({ available: false, version: null }));
    });
}

function createSystemRouter(options = {}) {
    const router = express.Router();
    const authenticateArtifact = options.authenticateArtifact || requireAdmin;
    const authenticateOperations = options.authenticateOperations || requireAdmin;
    const readiness = options.readinessService || createReadinessService();

    router.get('/health', (req, res) => {
        res.status(200).json({ status: 'OK', uptime: process.uptime() });
    });

    router.get('/ready', (req, res) => {
        const status = readiness.getFreshStatus();
        return res.status(status.ready ? 200 : 503).json({
            status: status.ready ? 'READY' : 'NOT_READY'
        });
    });

    router.get('/health/detailed', adminRateLimiter, authenticateOperations, async (req, res) => {
        const readinessStatus = readiness.getFreshStatus();
        const python = await checkPythonAvailability();
        const healthy = readinessStatus.ready && python.available;
        return res.status(healthy ? 200 : 503).json({
            timestamp: new Date().toISOString(),
            status: healthy ? 'OK' : 'DEGRADED',
            uptime: process.uptime(),
            subsystems: {
                ...readinessStatus.probes,
                queue: readinessStatus.queue,
                python
            }
        });
    });

    router.get('/operations/readiness', adminRateLimiter, authenticateOperations, (req, res) => {
        const status = readiness.getFreshStatus();
        return res.status(status.ready ? 200 : 503).json(status);
    });

    router.get('/operations/metrics', adminRateLimiter, authenticateOperations, (req, res) => {
        readiness.getFreshStatus();
        res.type('text/plain; version=0.0.4; charset=utf-8');
        return res.status(200).send(renderMetrics());
    });

    router.get('/favicon.ico', (req, res) => {
        const faviconPath = path.join(APP_ROOT, 'static', 'favicon.ico');
        if (fs.existsSync(faviconPath)) return res.sendFile(faviconPath);
        return res.status(404).end();
    });

    router.get('/admin/output-files', adminRateLimiter, authenticateArtifact, outputFilesHandler);
    router.get('/admin/download/:fileName', adminRateLimiter, authenticateArtifact, downloadHandler);
    return router;
}

const router = createSystemRouter();
module.exports = router;
module.exports.checkPythonAvailability = checkPythonAvailability;
module.exports.createSystemRouter = createSystemRouter;
