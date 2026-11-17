'use strict';

/**
 * Small-model fast lane (3.10.0).
 *
 * A slice whose upload is a small STL may start while every normal slot
 * (the configured slice concurrency) is busy, at most ONE such extra job at a time, so
 * a model that slices in a few seconds does not wait minutes behind large
 * ones. Normal jobs keep the normal slots and their order; the lane never
 * takes a normal slot away and never starts during a solo hold (the
 * retry-alone of a system-killed native).
 *
 * Eligibility is decided before the queue from what the upload middleware
 * already knows, without reading the file: the original name ends in `.stl`
 * and the upload is at most the lane's byte limit (the SLICE_FAST_LANE_MAX_BYTES
 * environment value, default 2 500 084
 * bytes = a binary STL of 50 000 triangles; an ASCII STL of that size holds
 * far fewer). Compressed and CAD formats are never eligible: their size says
 * nothing about the mesh they expand to.
 *
 * `SLICE_FAST_LANE=off` removes the lane; the queue is then 3.9.0's.
 */

const path = require('node:path');

const FAST_LANE_DEFAULT_MAX_BYTES = 84 + (50 * 50_000);
const FAST_LANE_MAX_BYTES_RANGE = Object.freeze({ min: 84, max: 16 * 1024 * 1024 });
const FAST_LANE_EXTENSION = '.stl';
const FAST_LANE_MAX_JOBS = 1;

/**
 * Resolve the lane's policy from the environment.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {Readonly<{enabled: boolean, maxBytes: number, maxJobs: number}>} Policy.
 */
function resolveFastLanePolicy(env = process.env) {
    const raw = typeof env.SLICE_FAST_LANE_MAX_BYTES === 'string' ? env.SLICE_FAST_LANE_MAX_BYTES.trim() : '';
    const parsed = /^[1-9][0-9]{0,8}$/.test(raw) ? Number(raw) : Number.NaN;
    const maxBytes = Number.isSafeInteger(parsed)
        && parsed >= FAST_LANE_MAX_BYTES_RANGE.min && parsed <= FAST_LANE_MAX_BYTES_RANGE.max
        ? parsed
        : FAST_LANE_DEFAULT_MAX_BYTES;
    const enabled = String(env.SLICE_FAST_LANE || '').trim().toLowerCase() !== 'off';
    return Object.freeze({ enabled, maxBytes, maxJobs: FAST_LANE_MAX_JOBS });
}

/** Process-wide policy, resolved once at load like the other queue limits. */
const FAST_LANE_POLICY = resolveFastLanePolicy();

/**
 * Whether a request's upload may use the fast lane.
 * @param {{file?: {originalname?: unknown, size?: unknown, fieldname?: unknown}}} req Request after the upload middleware.
 * @param {{enabled: boolean, maxBytes: number}} [policy] Lane policy.
 * @returns {boolean} True for a small STL upload while the lane is enabled.
 */
function isFastLaneUpload(req, policy = FAST_LANE_POLICY) {
    if (!policy.enabled) return false;
    const file = req?.file;
    if (!file || file.fieldname !== 'choosenFile' || typeof file.originalname !== 'string') return false;
    if (path.extname(file.originalname).toLowerCase() !== FAST_LANE_EXTENSION) return false;
    return Number.isSafeInteger(file.size) && file.size > 0 && file.size <= policy.maxBytes;
}

module.exports = {
    FAST_LANE_DEFAULT_MAX_BYTES,
    FAST_LANE_MAX_BYTES_RANGE,
    FAST_LANE_MAX_JOBS,
    FAST_LANE_POLICY,
    resolveFastLanePolicy,
    isFastLaneUpload
};
