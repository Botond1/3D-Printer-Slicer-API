/**
 * Lightweight in-memory IP rate limiter.
 */

const { DEFAULTS } = require('../config/constants');
const { getClientIp } = require('../utils/client-ip');

/**
 * Parse positive integer values from environment or user input with fallback.
 * @param {string | number | undefined} value Raw input value.
 * @param {number} fallback Value used when parsing fails.
 * @returns {number} A positive integer.
 */
function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build standardized 429 response payload used by rate-limit middleware.
 * @param {import('express').Response} res Express response object.
 * @param {{errorCode: string, errorMessage: string, retryAfterSeconds: number}} input Response fields.
 * @returns {import('express').Response} Serialized response.
 */
function sendRateLimitResponse(res, { errorCode, errorMessage, retryAfterSeconds }) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
        success: false,
        error: errorMessage,
        errorCode,
        retryAfterSeconds
    });
}

/**
 * Fixed-window limiter strategy.
 */
class FixedWindowRateLimiter {
    /**
     * @param {{windowMs: number, maxRequests: number}} config Fixed-window configuration.
     */
    constructor({ windowMs, maxRequests }) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.buckets = new Map();
        this.startCleanup();
    }

    /**
     * Periodically remove expired rate buckets.
     * @returns {void}
     */
    startCleanup() {
        const cleanupIntervalMs = Math.max(this.windowMs * 2, 60_000);
        setInterval(() => {
            const now = Date.now();
            for (const [ip, bucket] of this.buckets) {
                if (now > bucket.resetAt) {
                    this.buckets.delete(ip);
                }
            }
        }, cleanupIntervalMs).unref();
    }

    /**
     * Evaluate request allowance for a client key.
     * @param {string} key Client key.
     * @param {number} now Current timestamp in milliseconds.
     * @returns {{allowed: true} | {allowed: false, retryAfterSeconds: number}}
     */
    allow(key, now) {
        const current = this.buckets.get(key);
        if (!current || now > current.resetAt) {
            this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
            return { allowed: true };
        }

        if (current.count >= this.maxRequests) {
            return {
                allowed: false,
                retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
            };
        }

        current.count += 1;
        return { allowed: true };
    }
}

function computeAdaptiveCooldownMs(rejectionStreak) {
    if (rejectionStreak < 3) return 0;

    const exponent = Math.min(rejectionStreak - 3, 4);
    const cooldownMs = 1000 * (2 ** exponent);
    return Math.min(30_000, cooldownMs);
}

/**
 * Token-bucket limiter strategy.
 */
class TokenBucketRateLimiter {
    /**
     * @param {{windowMs: number, maxRequests: number, burstCapacity: number, adaptiveCooldown?: boolean}} config
     *   Token-bucket configuration. `adaptiveCooldown: false` (the auth-failure
     *   bucket, 3.9.0) answers with the plain token wait and never escalates.
     */
    constructor({ windowMs, maxRequests, burstCapacity, adaptiveCooldown = true }) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.burstCapacity = burstCapacity;
        this.adaptiveCooldown = adaptiveCooldown !== false;
        this.refillRatePerMs = maxRequests / windowMs;
        this.buckets = new Map();
        this.startCleanup();
    }

    /**
     * Periodically remove idle and fully recovered token buckets.
     * @returns {void}
     */
    startCleanup() {
        const cleanupIntervalMs = Math.max(this.windowMs * 2, 60_000);
        setInterval(() => {
            const now = Date.now();
            const staleThresholdMs = cleanupIntervalMs * 2;

            for (const [ip, bucket] of this.buckets) {
                const isIdle = now - bucket.lastSeenAt > staleThresholdMs;
                const isRecovered = bucket.tokens >= this.burstCapacity && bucket.blockedUntil <= now;
                if (isIdle && isRecovered) {
                    this.buckets.delete(ip);
                }
            }
        }, cleanupIntervalMs).unref();
    }

    /**
     * Evaluate request allowance for a client key.
     * @param {string} key Client key.
     * @param {number} now Current timestamp in milliseconds.
     * @returns {{allowed: true} | {allowed: false, retryAfterSeconds: number}}
     */
    allow(key, now) {
        const current = this.buckets.get(key) || {
            tokens: this.burstCapacity,
            lastRefillAt: now,
            lastSeenAt: now,
            blockedUntil: 0,
            rejectionStreak: 0
        };

        const elapsedMs = Math.max(0, now - current.lastRefillAt);
        if (elapsedMs > 0) {
            current.tokens = Math.min(this.burstCapacity, current.tokens + elapsedMs * this.refillRatePerMs);
            current.lastRefillAt = now;
        }
        current.lastSeenAt = now;

        if (current.blockedUntil > now) {
            this.buckets.set(key, current);
            return {
                allowed: false,
                retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil - now) / 1000))
            };
        }

        if (current.tokens >= 1) {
            current.tokens -= 1;
            current.rejectionStreak = 0;
            current.blockedUntil = 0;
            this.buckets.set(key, current);
            return { allowed: true };
        }

        current.rejectionStreak += 1;

        const tokenWaitMs = Math.max(0, (1 - current.tokens) / this.refillRatePerMs);
        const cooldownMs = this.adaptiveCooldown ? computeAdaptiveCooldownMs(current.rejectionStreak) : 0;
        if (cooldownMs > 0) {
            current.blockedUntil = Math.max(current.blockedUntil, now + cooldownMs);
        }

        const retryAfterMs = Math.max(tokenWaitMs, current.blockedUntil - now);
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

        this.buckets.set(key, current);
        return {
            allowed: false,
            retryAfterSeconds
        };
    }
}

/**
 * Resolve the client key used by the slice and job-route rate limiters.
 *
 * 3.9.0 reverses the 3.8.x design on purpose: the limiter is mounted AFTER
 * `x-slicer-api-key` authentication (`authenticate, rateLimiter, ...`, see
 * `sliceAdmission.js`), so it keys on the authenticated principal's slot
 * (`principal:woocommerce`, `principal:leadpilot`, `principal:staging`,
 * `principal:shared`). Wrong-key traffic from a shared egress IP is charged to
 * the separate per-IP auth-failure bucket and never spends a principal's
 * slice tokens. A request that reaches the limiter without a principal (only
 * possible with an injected test authenticator) keeps the per-IP key.
 * @param {import('express').Request} req Express request object.
 * @returns {string} Bounded limiter key.
 */
function resolveSliceClientKey(req) {
    const slot = req?.slicePrincipal?.slot;
    if (typeof slot === 'string' && /^[a-z]{1,32}$/.test(slot)) return `principal:${slot}`;
    return `ip:${getClientIp(req)}`;
}

/**
 * Build an Express middleware wrapper around a limiter strategy.
 * @param {{limiter: {allow(key: string, now: number): {allowed: true} | {allowed: false, retryAfterSeconds: number}}, errorCode?: string, errorMessage?: string, resolveKey?: (req: import('express').Request) => string}} config Wrapper configuration.
 * @returns {import('express').RequestHandler} Rate-limit middleware instance.
 */
function createLimiterMiddleware({
    limiter,
    errorCode = 'RATE_LIMIT_EXCEEDED',
    errorMessage = 'Too many requests. Please retry later.',
    resolveKey = getClientIp
}) {
    return function limiterMiddleware(req, res, next) {
        const now = Date.now();
        const decision = limiter.allow(String(resolveKey(req)), now);

        if (decision.allowed) {
            return next();
        }

        return sendRateLimitResponse(res, {
            errorCode,
            errorMessage,
            retryAfterSeconds: decision.retryAfterSeconds
        });
    };
}

const SLICE_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    process.env.SLICE_RATE_LIMIT_WINDOW_MS,
    DEFAULTS.SLICE_RATE_LIMIT_WINDOW_MS
);
const SLICE_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
    process.env.SLICE_RATE_LIMIT_MAX_REQUESTS,
    DEFAULTS.SLICE_RATE_LIMIT_MAX_REQUESTS
);
const SLICE_RATE_LIMIT_BURST_CAPACITY = parsePositiveInt(
    process.env.SLICE_RATE_LIMIT_BURST_CAPACITY,
    DEFAULTS.SLICE_RATE_LIMIT_BURST_CAPACITY
);
const ADMIN_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS,
    DEFAULTS.ADMIN_RATE_LIMIT_WINDOW_MS
);
const ADMIN_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
    process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS,
    DEFAULTS.ADMIN_RATE_LIMIT_MAX_REQUESTS
);
const SLICE_JOB_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    process.env.SLICE_JOB_RATE_LIMIT_WINDOW_MS,
    DEFAULTS.SLICE_JOB_RATE_LIMIT_WINDOW_MS
);
const SLICE_JOB_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
    process.env.SLICE_JOB_RATE_LIMIT_MAX_REQUESTS,
    DEFAULTS.SLICE_JOB_RATE_LIMIT_MAX_REQUESTS
);
const SLICE_JOB_RATE_LIMIT_BURST_CAPACITY = parsePositiveInt(
    process.env.SLICE_JOB_RATE_LIMIT_BURST_CAPACITY,
    DEFAULTS.SLICE_JOB_RATE_LIMIT_BURST_CAPACITY
);

/**
 * Token-bucket limiter used on slicing endpoints, mounted after authentication
 * and keyed per authenticated principal (`resolveSliceClientKey`).
 */
const sliceRateLimiter = createLimiterMiddleware({
    limiter: new TokenBucketRateLimiter({
        windowMs: SLICE_RATE_LIMIT_WINDOW_MS,
        maxRequests: SLICE_RATE_LIMIT_MAX_REQUESTS,
        burstCapacity: SLICE_RATE_LIMIT_BURST_CAPACITY
    }),
    resolveKey: resolveSliceClientKey
});

/**
 * Per-principal token bucket on the async slice job status/cancel routes. It
 * runs after authentication like the slice limiter, but has its own bucket so
 * status polls never consume slice submissions.
 */
const sliceJobRateLimiter = createLimiterMiddleware({
    limiter: new TokenBucketRateLimiter({
        windowMs: SLICE_JOB_RATE_LIMIT_WINDOW_MS,
        maxRequests: SLICE_JOB_RATE_LIMIT_MAX_REQUESTS,
        burstCapacity: SLICE_JOB_RATE_LIMIT_BURST_CAPACITY
    }),
    resolveKey: resolveSliceClientKey
});

/**
 * IP-based limiter used on admin endpoints to mitigate brute-force API key attempts.
 */
const adminRateLimiter = createLimiterMiddleware({
    limiter: new FixedWindowRateLimiter({
        windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
        maxRequests: ADMIN_RATE_LIMIT_MAX_REQUESTS
    }),
    errorCode: 'ADMIN_RATE_LIMIT_EXCEEDED',
    errorMessage: 'Too many admin requests. Please retry later.'
});

module.exports = {
    sliceRateLimiter,
    sliceJobRateLimiter,
    adminRateLimiter,
    TokenBucketRateLimiter,
    createLimiterMiddleware,
    resolveSliceClientKey,
    sendRateLimitResponse
};
