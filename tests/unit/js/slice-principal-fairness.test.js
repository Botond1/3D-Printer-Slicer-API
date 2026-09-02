'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SHARED_SLOT,
    createRequireAudience,
    resolveMatchedSlot
} = require('../../../app/middleware/requireAudience');
const { createRequireSliceService } = require('../../../app/middleware/requireSliceService');
const {
    createLimiterMiddleware,
    resolveSliceClientKey
} = require('../../../app/middleware/rateLimit');
const {
    CLIENT_LIMIT_RETRY_AFTER_SECONDS,
    SliceQueueClientLimitError,
    SliceQueueFullError,
    sendQueueErrorResponse,
    toQueueErrorResponse
} = require('../../../app/services/slice/queue');

const SHARED_KEY = 'shared-slice-key-0123456789abcdefghij';
const WOO_KEY = 'woocommerce-slice-key-0123456789abcdef';
const WOO_PREVIOUS = 'woocommerce-previous-key-0123456789abc';
const LEAD_KEY = 'leadpilot-slice-key-0123456789abcdefgh';

function keyRing(mode) {
    return Object.freeze({
        audiences: Object.freeze({
            slice: Object.freeze({
                active: mode === 'principals' ? '' : SHARED_KEY,
                previous: '',
                principals: Object.freeze({
                    woocommerce: Object.freeze({ active: WOO_KEY, previous: WOO_PREVIOUS }),
                    leadpilot: Object.freeze({ active: LEAD_KEY, previous: '' })
                })
            }),
            pricing: Object.freeze({ active: 'pricing-key-0123456789abcdefghijklmnop', previous: '' })
        }),
        sliceCredentialMode: Object.freeze({
            mode,
            legacyAccepted: mode !== 'principals',
            expiresAt: mode === 'migration' ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null
        })
    });
}

function request(headers) {
    return {
        header: (name) => headers[name.toLowerCase()],
        requestId: 'req-1',
        ip: '203.0.113.10',
        socket: { remoteAddress: '203.0.113.10' }
    };
}

function response() {
    const observed = { status: null, payload: null, headers: {} };
    return {
        observed,
        res: {
            status(value) { observed.status = value; return this; },
            json(value) { observed.payload = value; return this; },
            setHeader(name, value) { observed.headers[name] = value; }
        }
    };
}

function authenticate(middleware, req) {
    const { observed, res } = response();
    let passed = false;
    middleware(req, res, () => { passed = true; });
    return { passed, observed };
}

test('a successful slice match attaches a frozen principal naming only the rotation family', () => {
    const middleware = createRequireSliceService({ keyRing: keyRing('migration'), logger: { warn() {} } });
    const cases = [
        [SHARED_KEY, 'shared'],
        [WOO_KEY, 'woocommerce'],
        [WOO_PREVIOUS, 'woocommerce'],
        [LEAD_KEY, 'leadpilot']
    ];
    for (const [key, slot] of cases) {
        const req = request({ 'x-slicer-api-key': key });
        const result = authenticate(middleware, req);
        assert.equal(result.passed, true, slot);
        assert.deepEqual(req.slicePrincipal, { audience: 'slice', slot });
        assert.equal(Object.isFrozen(req.slicePrincipal), true);
        assert.doesNotMatch(JSON.stringify(req.slicePrincipal), /key/i);
    }
    assert.equal(SHARED_SLOT, 'shared');
    assert.equal(resolveMatchedSlot(0, ['leadpilot', 'woocommerce']), 'shared');
    assert.equal(resolveMatchedSlot(3, ['leadpilot', 'woocommerce']), 'leadpilot');
    assert.equal(resolveMatchedSlot(4, ['leadpilot', 'woocommerce']), 'woocommerce');
});

test('rejected slice requests and non-slice audiences attach no principal', () => {
    const slice = createRequireSliceService({ keyRing: keyRing('principals'), logger: { warn() {} } });
    const rejected = request({ 'x-slicer-api-key': SHARED_KEY });
    const result = authenticate(slice, rejected);
    assert.equal(result.passed, false);
    assert.equal(result.observed.status, 401);
    assert.equal('slicePrincipal' in rejected, false);

    const pricing = createRequireAudience({
        audience: 'pricing', keyRing: keyRing('legacy'), logger: { warn() {} }
    });
    const req = request({ 'x-api-key': 'pricing-key-0123456789abcdefghijklmnop' });
    assert.equal(authenticate(pricing, req).passed, true);
    assert.equal('slicePrincipal' in req, false);
});

test('slice limiter keys on the authenticated principal and falls back to the client IP', () => {
    const anonymous = request({});
    assert.equal(resolveSliceClientKey(anonymous), 'ip:203.0.113.10');
    const principal = request({});
    principal.slicePrincipal = Object.freeze({ audience: 'slice', slot: 'leadpilot' });
    assert.equal(resolveSliceClientKey(principal), 'principal:leadpilot');
    const malformed = request({});
    malformed.slicePrincipal = { audience: 'slice', slot: 'Bad Slot/../x' };
    assert.equal(resolveSliceClientKey(malformed), 'ip:203.0.113.10');

    const keys = [];
    const middleware = createLimiterMiddleware({
        limiter: { allow(key) { keys.push(key); return { allowed: keys.length < 3 }; } },
        resolveKey: resolveSliceClientKey
    });
    let passes = 0;
    middleware(principal, response().res, () => { passes += 1; });
    middleware(anonymous, response().res, () => { passes += 1; });
    assert.deepEqual(keys, ['principal:leadpilot', 'ip:203.0.113.10']);
    assert.equal(passes, 2);

    const defaultKeyed = createLimiterMiddleware({
        limiter: { allow(key) { keys.push(key); return { allowed: true }; } }
    });
    defaultKeyed(principal, response().res, () => {});
    assert.equal(keys[2], '203.0.113.10', 'admin limiters keep pure IP keying');
});

test('SLICE_QUEUE_CLIENT_LIMIT carries Retry-After and retryAfterSeconds like the rate limiter', () => {
    assert.equal(CLIENT_LIMIT_RETRY_AFTER_SECONDS, 5);
    const mapping = toQueueErrorResponse(new SliceQueueClientLimitError());
    assert.equal(mapping.status, 429);
    assert.deepEqual(mapping.headers, { 'Retry-After': '5' });
    assert.deepEqual(mapping.body, {
        success: false,
        error: 'Too many queued slice jobs for this client. Please wait and retry.',
        errorCode: 'SLICE_QUEUE_CLIENT_LIMIT',
        retryAfterSeconds: 5
    });
    const custom = toQueueErrorResponse(new SliceQueueClientLimitError(12));
    assert.equal(custom.body.retryAfterSeconds, 12);
    assert.equal(custom.headers['Retry-After'], '12');

    const legacy = toQueueErrorResponse(new Error('QUEUE_CLIENT_LIMIT|Too many queued.'));
    assert.equal(legacy.status, 429);
    assert.equal(legacy.body.retryAfterSeconds, 5);
    assert.equal(legacy.headers['Retry-After'], '5');

    const full = toQueueErrorResponse(new SliceQueueFullError());
    assert.equal(full.status, 503);
    assert.deepEqual(full.headers, {});
    assert.equal('retryAfterSeconds' in full.body, false);

    const { observed, res } = response();
    sendQueueErrorResponse(res, mapping);
    assert.equal(observed.status, 429);
    assert.deepEqual(observed.headers, { 'Retry-After': '5' });
    assert.equal(observed.payload.retryAfterSeconds, 5);
});

test('slice handlers send queue rejections through sendQueueErrorResponse so Retry-After reaches the wire', async (t) => {
    // The slice service loads the Python runtime resolver, which fails closed without an absolute executable.
    const previousPythonExecutable = process.env.PYTHON_EXECUTABLE;
    process.env.PYTHON_EXECUTABLE = process.execPath;
    t.after(() => {
        if (previousPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
        else process.env.PYTHON_EXECUTABLE = previousPythonExecutable;
    });
    const { createSliceHandlers } = require('../../../app/services/slice.service');
    const binding = () => ({ signal: new AbortController().signal, dispose() {} });
    const queueKeys = [];
    const build = (error) => createSliceHandlers({
        enqueueSliceJobImpl: async (_task, options) => {
            queueKeys.push(options.queueKey);
            throw error;
        },
        getClientIpImpl: () => '203.0.113.10',
        bindRequestAbortImpl: binding,
        setResponseAbortSignalImpl: () => {},
        processSliceImpl: async () => { throw new Error('must not run'); }
    });

    const limited = response();
    const principalRequest = { slicePrincipal: { slot: 'leadpilot' } };
    assert.equal(await build(new SliceQueueClientLimitError(7)).handleSliceBambu(principalRequest, limited.res), limited.res);
    assert.equal(limited.observed.status, 429);
    assert.deepEqual(limited.observed.headers, { 'Retry-After': '7' });
    assert.equal(limited.observed.payload.errorCode, 'SLICE_QUEUE_CLIENT_LIMIT');
    assert.equal(limited.observed.payload.retryAfterSeconds, 7);
    // The principal queue key is kept: every address of one principal shares one fairness key.
    assert.deepEqual(queueKeys, ['principal:leadpilot']);

    const full = response();
    await build(new SliceQueueFullError()).handleSlicePrusa({}, full.res);
    assert.equal(full.observed.status, 503);
    assert.deepEqual(full.observed.headers, {});
    assert.equal(full.observed.payload.errorCode, 'SLICE_QUEUE_FULL');
    assert.deepEqual(queueKeys, ['principal:leadpilot', '203.0.113.10']);

    const internal = response();
    await build(new Error('unexpected queue failure')).handleSliceOrca({}, internal.res);
    assert.equal(internal.observed.status, 500);
    assert.deepEqual(internal.observed.headers, {});
    assert.equal(internal.observed.payload.errorCode, 'QUEUE_INTERNAL_ERROR');
});
