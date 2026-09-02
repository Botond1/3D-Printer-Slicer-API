/** Preview-render route definition sharing the slice upload lifecycle. */

const express = require('express');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const requireSliceService = require('../middleware/requireSliceService');
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
    const authenticate = options.authenticate || requireSliceService;
    const handler = options.handleRender || handleRender;
    const lifecycle = createUploadLifecycle(options);

    // Rate limiting and authentication must reject before request-owned allocation.
    router.post(RENDER_ROUTE_PATH, rateLimiter, authenticate, lifecycle(handler, 'render'));
    return router;
}

const router = createRenderRouter();

module.exports = router;
module.exports.createRenderRouter = createRenderRouter;
module.exports.RENDER_ROUTE_PATH = RENDER_ROUTE_PATH;
