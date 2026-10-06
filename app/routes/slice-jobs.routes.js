/** Asynchronous slice job status and cancellation routes (async contract v1). */

const express = require('express');
const { sliceJobRateLimiter } = require('../middleware/rateLimit');
const requireSliceService = require('../middleware/requireSliceService');
const { getDefaultAsyncSliceJobStore } = require('../services/slice/async-jobs');
const { handleJobStatus, handleJobCancel } = require('../services/slice/async-slice');

const SLICE_JOB_ROUTE_PATH = '/bambu/slice/jobs/:job_id';

/**
 * Build the job router with injectable seams for deterministic tests.
 * @param {object} [options] `rateLimiter`, `authenticate`, and `store`.
 * @returns {import('express').Router} Router exposing GET and DELETE on one job.
 */
function createSliceJobsRouter(options = {}) {
    const router = express.Router();
    const rateLimiter = options.rateLimiter || sliceJobRateLimiter;
    const authenticate = options.authenticate || requireSliceService;
    const resolveStore = () => options.store || getDefaultAsyncSliceJobStore();

    // Same order as every slice route: limiter and authentication first.
    router.get(SLICE_JOB_ROUTE_PATH, rateLimiter, authenticate,
        (req, res) => handleJobStatus(req, res, resolveStore()));
    router.delete(SLICE_JOB_ROUTE_PATH, rateLimiter, authenticate,
        (req, res) => handleJobCancel(req, res, resolveStore()));
    return router;
}

module.exports = {
    SLICE_JOB_ROUTE_PATH,
    createSliceJobsRouter
};
