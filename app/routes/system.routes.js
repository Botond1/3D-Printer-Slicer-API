/**
 * System route definitions for health, static icon, and protected operational endpoints.
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { APP_ROOT, OUTPUT_DIR, PRUSA_CONFIGS_DIR, ORCA_CONFIGS_DIR } = require('../config/paths');
const { PYTHON_EXECUTABLE } = require('../config/python');
const requireAdmin = require('../middleware/requireAdmin');
const { adminRateLimiter } = require('../middleware/rateLimit');
const { getQueueStatus } = require('../services/slice/queue');
const { outputFilesHandler, downloadHandler } = require('./admin-download.handlers');

const router = express.Router();

router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

async function checkPythonAvailability() {
    return new Promise((resolve) => {
        let output = '';
        let isResolved = false;
        const proc = spawn(PYTHON_EXECUTABLE, ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 2000
        });
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                try {
                    proc.kill();
                } catch {}
                resolve({ available: false, version: null });
            }
        }, 2000);
        proc.stdout?.on('data', (data) => {
            output += data.toString().trim();
        });
        proc.stderr?.on('data', (data) => {
            output += data.toString().trim();
        });
        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (!isResolved) {
                isResolved = true;
                resolve(code === 0 && output
                    ? { available: true, version: output }
                    : { available: false, version: null });
            }
        });
        proc.on('error', () => {
            clearTimeout(timeoutId);
            if (!isResolved) {
                isResolved = true;
                resolve({ available: false, version: null });
            }
        });
    });
}

router.get('/health/detailed', adminRateLimiter, requireAdmin, async (req, res) => {
    try {
        const timestamp = new Date().toISOString();
        const uptime = process.uptime();
        const slicerPathsOK = {
            prusa: fs.existsSync(PRUSA_CONFIGS_DIR),
            orca: fs.existsSync(ORCA_CONFIGS_DIR)
        };
        const outputDirAccessible = fs.existsSync(OUTPUT_DIR);
        const pythonStatus = await checkPythonAvailability();
        const healthReport = {
            timestamp,
            status:
                slicerPathsOK.prusa && slicerPathsOK.orca && outputDirAccessible && pythonStatus.available
                    ? 'OK'
                    : 'DEGRADED',
            uptime,
            subsystems: {
                slicers: {
                    prusa: { available: slicerPathsOK.prusa },
                    orca: { available: slicerPathsOK.orca }
                },
                storage: {
                    outputDir: { accessible: outputDirAccessible }
                },
                queue: getQueueStatus(),
                python: {
                    available: pythonStatus.available,
                    version: pythonStatus.version
                }
            }
        };
        return res.status(healthReport.status === 'OK' ? 200 : 503).json(healthReport);
    } catch (error) {
        console.error('[HEALTH DETAILED ERROR]', error.message);
        return res.status(500).json({
            status: 'ERROR',
            timestamp: new Date().toISOString(),
            error: 'Internal server error while checking system health.'
        });
    }
});

router.get('/favicon.ico', (req, res) => {
    const faviconPath = path.join(APP_ROOT, 'static', 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
        res.sendFile(faviconPath);
    } else {
        res.status(404).end();
    }
});

router.get('/admin/output-files', adminRateLimiter, requireAdmin, outputFilesHandler);
router.get('/admin/download/:fileName', adminRateLimiter, requireAdmin, downloadHandler);

module.exports = router;
