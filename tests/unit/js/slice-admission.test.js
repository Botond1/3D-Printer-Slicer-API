'use strict';

/**
 * T-AUTH (3.9.0, §4.5 / §11 K1-B2): authentication before the limiters, a
 * per-IP auth-failure bucket, per-principal slice and job buckets, and a
 * wrong key that is ALWAYS today's 401 — never a 429 — on `/bambu/slice` and
 * the job routes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const os = require('node:os');
const express = require('express');

// The slice router's service layer resolves a Python executable at load time.
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const { resolveServiceKeyRing } = require('../../../app/config/service-auth');
const { createRequireSliceService, AUTHENTICATION_FAILURE } = require('../../../app/middleware/requireSliceService');
const {
    TokenBucketRateLimiter,
    createLimiterMiddleware,
    resolveSliceClientKey
} = require('../../../app/middleware/rateLimit');
const {
    createAuthFailureLimiter,
    createAuthenticateOrCharge
} = require('../../../app/middleware/sliceAdmission');
const { createSliceRouter } = require('../../../app/routes/slice.routes');
const { createSliceJobsRouter } = require('../../../app/routes/slice-jobs.routes');
const { createRenderRouter } = require('../../../app/routes/render.routes');
const metrics = require('../../../app/services/observability/metrics');
const { ERROR_ANSWERS } = require('../../contract/live-plugin-29a4a1c7/fixtures');

const FIXTURE_401 = ERROR_ANSWERS.find((answer) => answer.name === '401 with a wrong key');
const FIXTURE_429 = ERROR_ANSWERS.find((answer) => answer.name === '429 limiter');
const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const JOB_PATH = `/bambu/slice/jobs/sj_${'a'.repeat(32)}`;

const key = (name) => `t-auth-${name}-${'k'.repeat(40)}`;
const KEYS = Object.freeze({
    woocommerce: key('woocommerce'),
    woocommercePrevious: key('woocommerce-previous'),
    leadpilot: key('leadpilot'),
    staging: key('staging'),
    wrong: key('wrong')
});

function principalsEnvironment() {
    return {
        SLICE_SERVICE_AUTH_MODE: 'principals',
        SLICE_SERVICE_WOOCOMMERCE_API_KEY: KEYS.woocommerce,
        SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: KEYS.woocommercePrevious,
        SLICE_SERVICE_LEADPILOT_API_KEY: KEYS.leadpilot,
        SLICE_SERVICE_STAGING_API_KEY: KEYS.staging,
        PRICING_API_KEY: key('pricing'),
        ARTIFACT_API_KEY: key('artifact'),
        OPERATIONS_API_KEY: key('operations')
    };
}

/** A token bucket read at a frozen instant, so refills never blur the counts. */
function frozen(limiter, clock) {
    return { allow: (bucketKey) => limiter.allow(bucketKey, clock.now) };
}

function liveLimiters(clock) {
    const failure = createAuthFailureLimiter({
        AUTH_FAILURE_RATE_LIMIT_WINDOW_MS: 60_000,
        AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS: 60,
        AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY: 30
    });
    const failureCalls = [];
    return {
        failureCalls,
        authFailureLimiter: {
            allow(bucketKey) {
                failureCalls.push(bucketKey);
                return failure.allow(bucketKey, clock.now);
            }
        },
        // Live values (§4.5): slice 30/min burst 20; jobs 1 200/min burst 60.
        sliceLimiter: createLimiterMiddleware({
            limiter: frozen(new TokenBucketRateLimiter({ windowMs: 60_000, maxRequests: 30, burstCapacity: 20 }), clock),
            resolveKey: resolveSliceClientKey
        }),
        jobLimiter: createLimiterMiddleware({
            limiter: frozen(new TokenBucketRateLimiter({ windowMs: 60_000, maxRequests: 1_200, burstCapacity: 60 }), clock),
            resolveKey: resolveSliceClientKey
        })
    };
}

async function startHarness(t, options = {}) {
    const clock = { now: NOW };
    const keyRing = options.keyRing || resolveServiceKeyRing(principalsEnvironment(), { now: NOW });
    const authenticate = createRequireSliceService({ keyRing, logger: { warn() {} } });
    const limiters = liveLimiters(clock);
    const handled = [];
    const app = express();
    app.use(createSliceRouter({
        authenticate,
        authFailureLimiter: limiters.authFailureLimiter,
        rateLimiter: limiters.sliceLimiter,
        createWorkspace: async () => ({ id: `job-${'b'.repeat(32)}`, directory: os.tmpdir(), cleanup: async () => {} }),
        attachWorkspace() {},
        detachWorkspace() {},
        upload: { single: () => (req, res, next) => next() },
        handleBambu: async (req, res) => {
            handled.push(req.slicePrincipal);
            res.status(202).json({ accepted: true });
        }
    }));
    app.use(createSliceJobsRouter({
        authenticate,
        authFailureLimiter: limiters.authFailureLimiter,
        rateLimiter: limiters.jobLimiter,
        store: {
            lookup: () => ({ id: 'job' }),
            view: () => ({ status: 'completed' })
        }
    }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return { port: server.address().port, clock, handled, failureCalls: limiters.failureCalls };
}

/** Raw HTTP so an EMPTY `x-slicer-api-key` header really goes on the wire. */
function send(port, method, path, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                text: Buffer.concat(chunks).toString('utf8')
            }));
        });
        request.on('error', reject);
        request.end();
    });
}

const slicePost = (port, headers) => send(port, 'POST', '/bambu/slice', headers);
const jobGet = (port, headers) => send(port, 'GET', JOB_PATH, headers);

function assertFixture401(response, label) {
    assert.equal(response.status, 401, label);
    assert.equal(response.text, JSON.stringify(FIXTURE_401.body), label);
    assert.equal(response.text, JSON.stringify(AUTHENTICATION_FAILURE), label);
}

function assertFixture429(response, label) {
    assert.equal(response.status, 429, label);
    const body = JSON.parse(response.text);
    assert.deepEqual(Object.keys(body), Object.keys(FIXTURE_429.body), label);
    assert.equal(response.text, JSON.stringify({ ...FIXTURE_429.body, retryAfterSeconds: body.retryAfterSeconds }), label);
    assert.ok(Number.isSafeInteger(body.retryAfterSeconds) && body.retryAfterSeconds >= 1, label);
    assert.equal(response.headers['retry-after'], String(body.retryAfterSeconds), label);
}

test('the 3.8.3 fixtures this suite compares against are present', () => {
    assert.equal(FIXTURE_401.status, 401);
    assert.equal(FIXTURE_429.status, 429);
});

test('200 bad-key POSTs and 200 bad-key job GETs are each today\'s 401, never a 429; Retry-After after the burst', async (t) => {
    const harness = await startHarness(t);
    const answers = [];
    for (let index = 0; index < 200; index += 1) {
        answers.push(await slicePost(harness.port, { 'x-slicer-api-key': KEYS.wrong }));
    }
    for (let index = 0; index < 200; index += 1) {
        answers.push(await jobGet(harness.port, { 'x-slicer-api-key': KEYS.wrong }));
    }
    answers.forEach((answer, index) => assertFixture401(answer, `request ${index}`));
    // One failure bucket per source IP across both routes: burst 30.
    answers.slice(0, 30).forEach((answer, index) => assert.equal(answer.headers['retry-after'], undefined, `${index}`));
    answers.slice(30).forEach((answer, index) => {
        assert.match(answer.headers['retry-after'] || '', /^[1-9][0-9]*$/, `${index + 30}`);
    });
    // The job GETs keep `Cache-Control: no-store` on the 401.
    answers.slice(200).forEach((answer) => assert.equal(answer.headers['cache-control'], 'no-store'));
    assert.equal(harness.handled.length, 0);
});

test('an empty x-slicer-api-key header counts as carrying a key: 401, never 429', async (t) => {
    const harness = await startHarness(t);
    const answers = [];
    for (let index = 0; index < 40; index += 1) {
        answers.push(await slicePost(harness.port, { 'x-slicer-api-key': '' }));
    }
    answers.forEach((answer, index) => assertFixture401(answer, `empty ${index}`));
    assert.ok(answers[39].headers['retry-after']);
});

test('31 keyless POSTs give 30 × 401 then the limiter 429 (byte-identical to 3.8.3)', async (t) => {
    const harness = await startHarness(t);
    const answers = [];
    for (let index = 0; index < 31; index += 1) answers.push(await slicePost(harness.port, {}));
    answers.slice(0, 30).forEach((answer, index) => {
        assertFixture401(answer, `keyless ${index}`);
        assert.equal(answer.headers['retry-after'], undefined);
    });
    assertFixture429(answers[30], 'keyless 31');
});

test('100 keyless POSTs then a valid POST from the same IP is admitted (202)', async (t) => {
    const harness = await startHarness(t);
    let limited = 0;
    for (let index = 0; index < 100; index += 1) {
        const answer = await slicePost(harness.port, {});
        if (answer.status === 429) limited += 1;
    }
    assert.equal(limited, 70);
    const valid = await slicePost(harness.port, { 'x-slicer-api-key': KEYS.woocommerce });
    assert.equal(valid.status, 202);
    assert.deepEqual(harness.handled.at(-1), { audience: 'slice', slot: 'woocommerce', rotation: 'active' });
});

test('a valid key in the middle of a bad-key flood from the same IP is always admitted', async (t) => {
    const harness = await startHarness(t);
    for (let index = 0; index < 50; index += 1) {
        await slicePost(harness.port, { 'x-slicer-api-key': KEYS.wrong });
    }
    const failuresBefore = harness.failureCalls.length;
    const valid = await slicePost(harness.port, { 'x-slicer-api-key': KEYS.woocommercePrevious });
    assert.equal(valid.status, 202);
    assert.equal(harness.failureCalls.length, failuresBefore, 'a success never touches the failure bucket');
    for (let index = 0; index < 50; index += 1) {
        assertFixture401(await slicePost(harness.port, { 'x-slicer-api-key': KEYS.wrong }), `after ${index}`);
    }
    assert.equal((await slicePost(harness.port, { 'x-slicer-api-key': KEYS.leadpilot })).status, 202);
});

test('31 valid POSTs a minute from one principal end in today\'s 429; wrong keys never spend its tokens', async (t) => {
    const harness = await startHarness(t);
    for (let index = 0; index < 100; index += 1) {
        await slicePost(harness.port, { 'x-slicer-api-key': KEYS.wrong });
    }
    const answers = [];
    for (let index = 0; index < 31; index += 1) {
        answers.push(await slicePost(harness.port, { 'x-slicer-api-key': KEYS.woocommerce }));
    }
    // Live burst 20: the 100 wrong keys before did not spend one token.
    answers.slice(0, 20).forEach((answer, index) => assert.equal(answer.status, 202, `${index}`));
    answers.slice(20).forEach((answer, index) => assertFixture429(answer, `principal ${index + 20}`));
});

test('the staging slot drained leaves woocommerce at 202 (one bucket per principal)', async (t) => {
    const harness = await startHarness(t);
    let stagingLimited = 0;
    for (let index = 0; index < 25; index += 1) {
        const answer = await slicePost(harness.port, { 'x-slicer-api-key': KEYS.staging });
        if (answer.status === 429) stagingLimited += 1;
    }
    assert.equal(stagingLimited, 5);
    assert.equal(harness.handled[0].slot, 'staging');
    const woo = await slicePost(harness.port, { 'x-slicer-api-key': KEYS.woocommerce });
    assert.equal(woo.status, 202);
    assert.equal(harness.handled.at(-1).slot, 'woocommerce');
});

test('60 bad-key job GETs from the shop\'s IP leave the shop\'s poll at 200', async (t) => {
    const harness = await startHarness(t);
    for (let index = 0; index < 60; index += 1) {
        assertFixture401(await jobGet(harness.port, { 'x-slicer-api-key': KEYS.wrong }), `${index}`);
    }
    const poll = await jobGet(harness.port, { 'x-slicer-api-key': KEYS.woocommerce });
    assert.equal(poll.status, 200);
    assert.equal(poll.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(poll.text).status, 'completed');
});

test('the 503 "authentication unconfigured" answer is never charged', async (t) => {
    const keyRing = { audiences: { slice: { active: '', previous: '' } } };
    const harness = await startHarness(t, { keyRing });
    for (let index = 0; index < 40; index += 1) {
        const answer = await slicePost(harness.port, { 'x-slicer-api-key': KEYS.wrong });
        assert.equal(answer.status, 503);
        assert.equal(answer.headers['retry-after'], undefined);
    }
    assert.equal((await slicePost(harness.port, {})).status, 503);
    assert.deepEqual(harness.failureCalls, []);
});

test('router stacks: auth → limiter → lifecycle on slice and render; noStore → auth → limiter → handler on jobs', () => {
    const sliceLimiter = (req, res, next) => next();
    const sliceRouter = createSliceRouter({ rateLimiter: sliceLimiter, authenticate: (req, res, next) => next() });
    for (const layer of sliceRouter.stack.filter((item) => item.route)) {
        const names = layer.route.stack.map((item) => item.handle);
        assert.equal(names.length, 3, layer.route.path);
        assert.equal(names[0].name, 'authenticateOrCharge', layer.route.path);
        assert.equal(names[1], sliceLimiter, layer.route.path);
    }
    const renderRouter = createRenderRouter({ rateLimiter: sliceLimiter, authenticate: (req, res, next) => next() });
    const render = renderRouter.stack.find((item) => item.route).route.stack;
    assert.equal(render[0].handle.name, 'authenticateOrCharge');
    assert.equal(render[1].handle, sliceLimiter);
    const jobLimiter = (req, res, next) => next();
    const jobsRouter = createSliceJobsRouter({ rateLimiter: jobLimiter, authenticate: (req, res, next) => next() });
    const jobLayers = jobsRouter.stack.filter((item) => item.route);
    assert.deepEqual(jobLayers.map((item) => Object.keys(item.route.methods)[0]).sort(), ['delete', 'get']);
    for (const layer of jobLayers) {
        const stack = layer.route.stack;
        assert.equal(stack.length, 4);
        assert.equal(stack[0].handle.name, 'noStore');
        assert.equal(stack[1].handle.name, 'authenticateOrCharge');
        assert.equal(stack[2].handle, jobLimiter);
    }
});

test('authenticateOrCharge: digest compare always runs; limited 401 counts slicer_auth_failure_limited_total', () => {
    metrics.resetMetricsForTests();
    const keyRing = resolveServiceKeyRing(principalsEnvironment(), { now: NOW });
    let comparisons = 0;
    const authenticate = createRequireSliceService({
        keyRing,
        logger: { warn() {} },
        compareDigests(left, right) {
            comparisons += 1;
            return require('node:crypto').timingSafeEqual(left, right);
        }
    });
    const exhausted = { allow: () => ({ allowed: false, retryAfterSeconds: 7 }) };
    const middleware = createAuthenticateOrCharge({ authenticate, failureLimiter: exhausted });
    const call = (headers) => {
        const observed = { status: null, body: null, headers: {}, next: 0 };
        const req = {
            ip: '192.0.2.10',
            headers,
            header: (name) => headers[name.toLowerCase()]
        };
        const res = {
            status(value) { observed.status = value; return this; },
            json(value) { observed.body = value; return this; },
            setHeader(name, value) { observed.headers[name] = value; }
        };
        middleware(req, res, () => { observed.next += 1; });
        return { observed, req };
    };
    const valid = call({ 'x-slicer-api-key': KEYS.leadpilot });
    assert.equal(valid.observed.next, 1, 'an exhausted bucket never refuses a valid key');
    assert.ok(comparisons > 0);
    const before = comparisons;
    const wrong = call({ 'x-slicer-api-key': KEYS.wrong });
    assert.ok(comparisons > before, 'the compare runs even with the bucket spent');
    assert.equal(wrong.observed.status, 401);
    assert.deepEqual(wrong.observed.body, AUTHENTICATION_FAILURE);
    assert.equal(wrong.observed.headers['Retry-After'], '7');
    const keyless = call({});
    assert.equal(keyless.observed.status, 429);
    assert.deepEqual(keyless.observed.body, {
        success: false, error: 'Too many requests. Please retry later.', errorCode: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: 7
    });
    assert.match(metrics.renderMetrics(), /^slicer_auth_failure_limited_total 2$/m);
    // The hook never outlives the call.
    assert.deepEqual(Object.getOwnPropertySymbols(wrong.req), []);
    metrics.resetMetricsForTests();
});

test('the auth-failure bucket has no adaptive cooldown: it refills at 60/min only', () => {
    const limiter = createAuthFailureLimiter({
        AUTH_FAILURE_RATE_LIMIT_WINDOW_MS: 60_000,
        AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS: 60,
        AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY: 30
    });
    for (let index = 0; index < 30; index += 1) assert.equal(limiter.allow('authfail:a', NOW).allowed, true);
    for (let index = 0; index < 20; index += 1) {
        const decision = limiter.allow('authfail:a', NOW);
        assert.equal(decision.allowed, false);
        assert.equal(decision.retryAfterSeconds, 1, 'no escalation');
    }
    assert.equal(limiter.buckets.get('authfail:a').blockedUntil, 0, 'never blocked beyond the token wait');
    assert.equal(limiter.allow('authfail:a', NOW + 1_000).allowed, true);
    // The same streak on a limiter with today's adaptive cooldown blocks it.
    const adaptive = new TokenBucketRateLimiter({ windowMs: 60_000, maxRequests: 60, burstCapacity: 30 });
    for (let index = 0; index < 50; index += 1) adaptive.allow('k', NOW);
    assert.ok(adaptive.buckets.get('k').blockedUntil > NOW);
});

test('the release-policy defaults drive the shared bucket (60/min, burst 30)', () => {
    const { authFailure } = require('../../../app/config/release-policy');
    const limiter = createAuthFailureLimiter(authFailure);
    assert.equal(limiter.burstCapacity, 30);
    assert.equal(limiter.maxRequests, 60);
    assert.equal(limiter.windowMs, 60_000);
    assert.equal(limiter.adaptiveCooldown, false);
});
