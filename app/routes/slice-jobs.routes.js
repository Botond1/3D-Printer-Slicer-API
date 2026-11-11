/** Asynchronous slice job status and cancellation routes (async contract v1). */

const express = require('express');
const { sliceJobRateLimiter } = require('../middleware/rateLimit');
const requireSliceService = require('../middleware/requireSliceService');
const { createAuthenticateOrCharge } = require('../middleware/sliceAdmission');
const { getDefaultAsyncSliceJobStore } = require('../services/slice/async-jobs');
const { handleJobStatus, handleJobCancel, noStore } = require('../services/slice/async-job-http');

const SLICE_JOB_ROUTE_PATH = '/bambu/slice/jobs/:job_id';

/**
 * Build the job router with injectable seams for deterministic tests.
 * @param {object} [options] `rateLimiter`, `authenticate` (or a ready
 *   `authenticateOrCharge`), `authFailureLimiter`, and `store`.
 * @returns {import('express').Router} Router exposing GET and DELETE on one job.
 */
function createSliceJobsRouter(options = {}) {
    const router = express.Router();
    const rateLimiter = options.rateLimiter || sliceJobRateLimiter;
    const authenticate = options.authenticateOrCharge || createAuthenticateOrCharge({
        authenticate: options.authenticate || requireSliceService,
        failureLimiter: options.authFailureLimiter
    });
    const resolveStore = () => options.store || getDefaultAsyncSliceJobStore();

    // `Cache-Control: no-store` precedes everything, so the authentication
    // 401 and the limiter's 429 carry it too; then the order of every slice
    // route (authentication, then the per-principal job bucket).
    router.get(SLICE_JOB_ROUTE_PATH, noStore, authenticate, rateLimiter,
        (req, res) => handleJobStatus(req, res, resolveStore()));
    router.delete(SLICE_JOB_ROUTE_PATH, noStore, authenticate, rateLimiter,
        (req, res) => handleJobCancel(req, res, resolveStore()));
    return router;
}

module.exports = {
    SLICE_JOB_ROUTE_PATH,
    createSliceJobsRouter
};
