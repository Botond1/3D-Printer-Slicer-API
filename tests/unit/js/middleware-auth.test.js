const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const REQUIRE_ADMIN_PATH = path.join(REPO_ROOT, 'app/middleware/requireAdmin.js');
const requireAdmin = require(REQUIRE_ADMIN_PATH);
const {
    loadCommonJsFromSource
} = require('./helpers/load-commonjs-from-source');

function createResponseRecorder() {
    const state = {
        statusCode: null,
        body: null,
        headersSent: false
    };

    return {
        state,
        response: {
            get headersSent() {
                return state.headersSent;
            },
            set headersSent(value) {
                state.headersSent = value;
            },
            status(statusCode) {
                state.statusCode = statusCode;
                return this;
            },
            json(body) {
                state.body = body;
                return this;
            }
        }
    };
}

function createAdminRequest(apiKey) {
    return {
        ip: '127.0.0.1',
        method: 'GET',
        originalUrl: '/admin/output-files',
        requestId: 'unit-request-id',
        header(name) {
            assert.equal(name, 'x-api-key');
            return apiKey;
        }
    };
}

function invokeAdmin(apiKey, middleware = requireAdmin) {
    const { state, response } = createResponseRecorder();
    let nextCalls = 0;
    middleware(createAdminRequest(apiKey), response, () => {
        nextCalls += 1;
    });
    return { ...state, nextCalls };
}

function observeAdminTimingSafeContract(middleware) {
    const inertKey = 's01-inert-admin-key';
    const wrongEqualLength = 's01-inert-admin-keX';
    assert.equal(wrongEqualLength.length, inertKey.length);

    const originalAdminKey = process.env.ADMIN_API_KEY;
    const originalTimingSafeEqual = crypto.timingSafeEqual;
    const originalConsoleWarn = console.warn;
    const calls = [];

    crypto.timingSafeEqual = (left, right) => {
        calls.push({
            leftLength: left.length,
            rightLength: right.length,
            sameBuffer: left === right
        });
        return originalTimingSafeEqual(left, right);
    };
    console.warn = () => {};
    process.env.ADMIN_API_KEY = inertKey;

    function invokeObserved(apiKey) {
        const firstCallIndex = calls.length;
        const result = invokeAdmin(apiKey, middleware);
        return {
            result,
            calls: calls.slice(firstCallIndex)
        };
    }

    try {
        return {
            correct: invokeObserved(inertKey),
            wrongEqualLength: invokeObserved(wrongEqualLength),
            wrongUnequalLength: invokeObserved('short')
        };
    } finally {
        crypto.timingSafeEqual = originalTimingSafeEqual;
        console.warn = originalConsoleWarn;
        if (originalAdminKey === undefined) {
            delete process.env.ADMIN_API_KEY;
        } else {
            process.env.ADMIN_API_KEY = originalAdminKey;
        }
    }
}

function assertAdminTimingSafeContract(observation) {
    assert.equal(observation.correct.result.statusCode, null);
    assert.equal(observation.correct.result.nextCalls, 1);
    assert.equal(
        observation.correct.calls.length,
        1,
        'A correct admin key must invoke crypto.timingSafeEqual exactly once.'
    );
    assert.equal(observation.correct.calls[0].sameBuffer, false);
    assert.equal(
        observation.correct.calls[0].leftLength,
        observation.correct.calls[0].rightLength
    );

    assert.equal(observation.wrongEqualLength.result.statusCode, 401);
    assert.equal(observation.wrongEqualLength.result.nextCalls, 0);
    assert.equal(
        observation.wrongEqualLength.calls.length,
        1,
        'An equal-length wrong admin key must invoke crypto.timingSafeEqual exactly once.'
    );
    assert.equal(observation.wrongEqualLength.calls[0].sameBuffer, false);
    assert.equal(
        observation.wrongEqualLength.calls[0].leftLength,
        observation.wrongEqualLength.calls[0].rightLength
    );

    assert.equal(observation.wrongUnequalLength.result.statusCode, 401);
    assert.equal(observation.wrongUnequalLength.result.nextCalls, 0);
    assert.equal(
        observation.wrongUnequalLength.calls.length,
        1,
        'An unequal-length wrong admin key must invoke the dummy crypto.timingSafeEqual comparison.'
    );
    assert.equal(observation.wrongUnequalLength.calls[0].sameBuffer, true);
    assert.equal(
        observation.wrongUnequalLength.calls[0].leftLength,
        observation.wrongUnequalLength.calls[0].rightLength
    );
}

test('admin middleware handles missing configuration and all inert-key comparisons', () => {
    const inertKey = 's0-inert-admin-key';
    const wrongEqualLength = 's0-inert-admin-keX';
    assert.equal(wrongEqualLength.length, inertKey.length);

    const originalAdminKey = process.env.ADMIN_API_KEY;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};

    try {
        delete process.env.ADMIN_API_KEY;
        assert.deepEqual(invokeAdmin(undefined), {
            statusCode: 503,
            body: { success: false, error: 'Admin API key is not configured on server.' },
            headersSent: false,
            nextCalls: 0
        });

        process.env.ADMIN_API_KEY = inertKey;

        for (const candidate of [undefined, wrongEqualLength, 'short']) {
            const result = invokeAdmin(candidate);
            assert.equal(result.statusCode, 401);
            assert.deepEqual(result.body, { success: false, error: 'Unauthorized' });
            assert.equal(result.nextCalls, 0);
        }

        const accepted = invokeAdmin(inertKey);
        assert.equal(accepted.statusCode, null);
        assert.equal(accepted.body, null);
        assert.equal(accepted.nextCalls, 1);
    } finally {
        if (originalAdminKey === undefined) {
            delete process.env.ADMIN_API_KEY;
        } else {
            process.env.ADMIN_API_KEY = originalAdminKey;
        }
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    }
});

test('live admin middleware invokes timingSafeEqual for all key comparison branches', () => {
    assertAdminTimingSafeContract(observeAdminTimingSafeContract(requireAdmin));
});

test('live timing-safe proof rejects direct equality with an unused timing-safe helper', () => {
    const source = fs.readFileSync(REQUIRE_ADMIN_PATH, 'utf8');
    const mutatedSource = source.replace(
        'if (!apiKey || !timingSafeCompare(apiKey, adminApiKey)) {',
        'if (!apiKey || apiKey !== adminApiKey) {'
    );
    assert.notEqual(mutatedSource, source, 'Direct-equality mutation seam did not apply.');
    assert.match(mutatedSource, /crypto\.timingSafeEqual/);

    const mutatedMiddleware = loadCommonJsFromSource(REQUIRE_ADMIN_PATH, mutatedSource);
    const observation = observeAdminTimingSafeContract(mutatedMiddleware);
    assert.equal(observation.correct.calls.length, 0, 'Mutation seam must bypass the live primitive.');
    assert.throws(
        () => assertAdminTimingSafeContract(observation),
        /correct admin key must invoke crypto\.timingSafeEqual/i
    );
});
