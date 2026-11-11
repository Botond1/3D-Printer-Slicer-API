'use strict';

/**
 * Production-model export routes (3.9.0 §2.2–2.3).
 *
 * Mounted only when `EXPORT_ROUTE_ENABLED=true`: when the operator has the
 * export off, the router is empty and every export path falls through to the
 * application's 404 `ROUTE_NOT_FOUND`, exactly as on 3.8.x.
 *
 * Order on `POST /bambu/export`: `authenticateOrCharge` (slice key; wrong
 * keys charge the per-IP failure bucket) → the export's own per-principal
 * bucket (`EXPORT_RATE_LIMIT_*`, 6/min, burst 3; never the slice bucket) →
 * the shared upload lifecycle (`createUploadLifecycle`, label `export`).
 * The job routes: `noStore` → `authenticateOrCharge` → the job-route bucket
 * → handler.
 */

const express = require('express');
const { export: exportPolicy } = require('../config/release-policy');
const {
    sliceJobRateLimiter,
    TokenBucketRateLimiter,
    createLimiterMiddleware,
    resolveSliceClientKey
} = require('../middleware/rateLimit');
const requireSliceService = require('../middleware/requireSliceService');
const { createAuthenticateOrCharge } = require('../middleware/sliceAdmission');
const { noStore } = require('../services/slice/async-job-http');
const { createExportHandlers } = require('../services/export/export.service');
const { createUploadLifecycle, markAsyncHandoff, transferRequestWorkspace } = require('./upload-lifecycle');

const EXPORT_ROUTE_PATH = '/bambu/export';
const EXPORT_JOB_ROUTE_PATH = '/bambu/export/jobs/:job_id';
const EXPORT_JOB_FILE_ROUTE_PATH = '/bambu/export/jobs/:job_id/file';

/**
 * The export's own per-principal token bucket (6/min, burst 3).
 * @param {object} [policy] The `export` release-policy section.
 * @returns {import('express').RequestHandler} Limiter middleware.
 */
function createExportRateLimiter(policy = exportPolicy) {
    return createLimiterMiddleware({
        limiter: new TokenBucketRateLimiter({
            windowMs: policy.EXPORT_RATE_LIMIT_WINDOW_MS,
            maxRequests: policy.EXPORT_RATE_LIMIT_MAX_REQUESTS,
            burstCapacity: policy.EXPORT_RATE_LIMIT_BURST_CAPACITY
        }),
        resolveKey: resolveSliceClientKey
    });
}

function engineGate(isEngineAvailable) {
    return function exportEngineGate(req, res, next) {
        if (isEngineAvailable('bambu')) return next();
        return res.status(503).json({
            success: false,
            error: 'The selected slicer engine is unavailable.',
            errorCode: 'SLICER_ENGINE_UNAVAILABLE'
        });
    };
}

/**
 * Build the export router.
 * @param {object} [options] `enabled` (default `EXPORT_ROUTE_ENABLED`),
 *   `authenticate` / `authenticateOrCharge` / `authFailureLimiter`,
 *   `rateLimiter` (export bucket), `jobRateLimiter`, `isEngineAvailable`,
 *   `handlers` (or the `createExportHandlers` seams), plus every
 *   `createUploadLifecycle` seam.
 * @returns {import('express').Router} Router; empty when the export is off.
 */
function createExportRouter(options = {}) {
    const router = express.Router();
    const enabled = options.enabled !== undefined ? options.enabled === true : exportPolicy.EXPORT_ROUTE_ENABLED === true;
    if (!enabled) return router;

    const authenticate = options.authenticateOrCharge || createAuthenticateOrCharge({
        authenticate: options.authenticate || requireSliceService,
        failureLimiter: options.authFailureLimiter
    });
    const exportLimiter = options.rateLimiter || createExportRateLimiter(options.policy);
    const jobLimiter = options.jobRateLimiter || sliceJobRateLimiter;
    const handlers = options.handlers || createExportHandlers({
        transferWorkspace: transferRequestWorkspace,
        markHandoff: markAsyncHandoff,
        ...options
    });
    const lifecycle = createUploadLifecycle(options);
    const postStack = [authenticate, exportLimiter];
    if (typeof options.isEngineAvailable === 'function') postStack.push(engineGate(options.isEngineAvailable));

    router.post(EXPORT_ROUTE_PATH, ...postStack, lifecycle(handlers.handleExport, 'export'));
    router.get(EXPORT_JOB_FILE_ROUTE_PATH, noStore, authenticate, jobLimiter, handlers.handleJobFile);
    router.get(EXPORT_JOB_ROUTE_PATH, noStore, authenticate, jobLimiter, handlers.handleJobStatus);
    router.delete(EXPORT_JOB_ROUTE_PATH, noStore, authenticate, jobLimiter, handlers.handleJobDelete);
    return router;
}

module.exports = {
    EXPORT_JOB_FILE_ROUTE_PATH,
    EXPORT_JOB_ROUTE_PATH,
    EXPORT_ROUTE_PATH,
    createExportRateLimiter,
    createExportRouter
};
