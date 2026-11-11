'use strict';

/**
 * Slice admission (3.9.0): authentication first, then the per-principal
 * limiters, with a separate per-IP bucket that only failed authentications
 * spend.
 *
 * Order on POST `/bambu|prusa|orca/slice` and `/render`:
 * `authenticateOrCharge` → `sliceRateLimiter` (keyed `principal:<slot>`) →
 * lifecycle. On GET/DELETE `/bambu/slice/jobs/:id`: `noStore` →
 * `authenticateOrCharge` → `sliceJobRateLimiter` → handler.
 *
 * `authenticateOrCharge` always runs the authenticator's digest comparison
 * first; it is never skipped, also when the caller's failure bucket is empty,
 * so a valid key is never refused because of someone else's wrong key, and a
 * success never touches the failure bucket. A failure charges `authfail:<ip>`
 * (`AUTH_FAILURE_RATE_LIMIT_*`, 60/min, burst 30, no adaptive cooldown):
 * - a request that CARRIES `x-slicer-api-key` (present, even empty) always
 *   gets today's 401 with today's body (`SLICE_SERVICE_AUTH_REQUIRED`); once
 *   the bucket is spent the 401 also carries `Retry-After`. The live plugin
 *   reads a 401 on a job poll as a refused key but a 429 as transient, so a
 *   429 for a wrong key would hide a key failure as "busy" (§11 K1-B2);
 * - only a request with NO key header gets today's limiter 429
 *   (`RATE_LIMIT_EXCEEDED`, `Retry-After`) once the bucket is spent;
 * - the 503 "authentication unconfigured" answer is not charged.
 */

const releasePolicy = require('../config/release-policy');
const { getClientIp } = require('../utils/client-ip');
const { AUTH_REJECTION_HOOK } = require('./requireAudience');
const { TokenBucketRateLimiter, sendRateLimitResponse } = require('./rateLimit');
const { incrementAuthFailureLimited } = require('../services/observability/metrics');

const RATE_LIMIT_ERROR_CODE = 'RATE_LIMIT_EXCEEDED';
const RATE_LIMIT_ERROR_MESSAGE = 'Too many requests. Please retry later.';

/**
 * Build the per-IP auth-failure token bucket (no adaptive cooldown).
 * @param {{AUTH_FAILURE_RATE_LIMIT_WINDOW_MS: number, AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS: number,
 *   AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY: number}} [policy] The `authFailure` release-policy section.
 * @returns {TokenBucketRateLimiter} Limiter instance.
 */
function createAuthFailureLimiter(policy = releasePolicy.authFailure) {
    return new TokenBucketRateLimiter({
        windowMs: policy.AUTH_FAILURE_RATE_LIMIT_WINDOW_MS,
        maxRequests: policy.AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS,
        burstCapacity: policy.AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY,
        adaptiveCooldown: false
    });
}

let defaultAuthFailureLimiter;

/**
 * The process-wide auth-failure bucket shared by every slice-key route, so a
 * flood split across `/bambu/slice`, the job routes and `/render` spends one
 * bucket per source IP.
 * @returns {TokenBucketRateLimiter} Shared limiter.
 */
function getDefaultAuthFailureLimiter() {
    if (!defaultAuthFailureLimiter) defaultAuthFailureLimiter = createAuthFailureLimiter();
    return defaultAuthFailureLimiter;
}

/**
 * Wrap an `x-slicer-api-key` authenticator built by `createRequireSliceService`
 * (or `createRequireAudience`) so its failures are charged to the per-IP
 * failure bucket. An authenticator that does not honour the rejection hook
 * (an injected test stub) passes through unchanged.
 * @param {{authenticate: import('express').RequestHandler,
 *   failureLimiter?: {allow(key: string, now: number): {allowed: boolean, retryAfterSeconds?: number}},
 *   clock?: () => number, onFailureLimited?: () => void}} options Seams.
 * @returns {import('express').RequestHandler} Middleware named `authenticateOrCharge`.
 */
function createAuthenticateOrCharge(options = {}) {
    const { authenticate } = options;
    if (typeof authenticate !== 'function') throw new TypeError('An authenticator is required.');
    const failureLimiter = options.failureLimiter || getDefaultAuthFailureLimiter();
    const clock = options.clock || Date.now;
    const onFailureLimited = options.onFailureLimited || incrementAuthFailureLimited;

    function chargeFailure(req, res, { status, keyPresent }) {
        // 503: the service has no slice key at all; the caller did nothing wrong.
        if (status !== 401) return false;
        const decision = failureLimiter.allow(`authfail:${getClientIp(req)}`, clock());
        if (decision.allowed) return false;
        try {
            onFailureLimited();
        } catch {
            // A metric never owns the answer.
        }
        if (keyPresent) {
            // Today's 401 and body, with the wait added (§11 K1-B2).
            res.setHeader('Retry-After', String(decision.retryAfterSeconds));
            return false;
        }
        sendRateLimitResponse(res, {
            errorCode: RATE_LIMIT_ERROR_CODE,
            errorMessage: RATE_LIMIT_ERROR_MESSAGE,
            retryAfterSeconds: decision.retryAfterSeconds
        });
        return true;
    }

    return function authenticateOrCharge(req, res, next) {
        req[AUTH_REJECTION_HOOK] = (response, verdict) => chargeFailure(req, response, verdict);
        try {
            return authenticate(req, res, next);
        } finally {
            delete req[AUTH_REJECTION_HOOK];
        }
    };
}

/** Reset the shared failure bucket (tests only). */
function resetDefaultAuthFailureLimiterForTests() {
    defaultAuthFailureLimiter = undefined;
}

module.exports = {
    createAuthFailureLimiter,
    createAuthenticateOrCharge,
    getDefaultAuthFailureLimiter,
    resetDefaultAuthFailureLimiterForTests
};
