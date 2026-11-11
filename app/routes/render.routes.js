/** Preview-render route definition sharing the slice upload lifecycle. */

const express = require('express');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const requireSliceService = require('../middleware/requireSliceService');
const { createAuthenticateOrCharge } = require('../middleware/sliceAdmission');
const { handleRender } = require('../services/render.service');
const { createUploadLifecycle } = require('./upload-lifecycle');

const RENDER_ROUTE_PATH = '/render';

/**
 * Build the preview router with injectable lifecycle seams for deterministic tests.
 * @param {object} [options] Same seams as `createSliceRouter`, plus `handleRender`.
 * @returns {import('express').Router} Router exposing `POST /render`.
 */
function createRenderRouter(options = {}) {
    const router = express.Router();
    const rateLimiter = options.rateLimiter || sliceRateLimiter;
    const authenticate = options.authenticateOrCharge || createAuthenticateOrCharge({
        authenticate: options.authenticate || requireSliceService,
        failureLimiter: options.authFailureLimiter
    });
    const handler = options.handleRender || handleRender;
    const lifecycle = createUploadLifecycle(options);

    // Authentication and rate limiting must reject before request-owned
    // allocation; authentication runs first so the limiter keys on the principal.
    router.post(RENDER_ROUTE_PATH, authenticate, rateLimiter, lifecycle(handler, 'render'));
    return router;
}

const router = createRenderRouter();

module.exports = router;
module.exports.createRenderRouter = createRenderRouter;
module.exports.RENDER_ROUTE_PATH = RENDER_ROUTE_PATH;
