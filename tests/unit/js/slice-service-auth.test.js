'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    SERVICE_AUTH_CONFIGURATION_ERROR,
    SLICE_SERVICE_KEY_LIMITS,
    isValidSliceServiceSecret,
    resolveSliceServiceApiKey
} = require('../../../app/config/service-auth');
const {
    AUTHENTICATION_FAILURE,
    createRequireSliceService
} = require('../../../app/middleware/requireSliceService');

const SERVICE_KEY = 'S'.repeat(40);
const WRONG_EQUAL_LENGTH_KEY = 'T'.repeat(40);

function createResponseRecorder() {
    const state = { statusCode: null, body: null };
    return {
        state,
        response: {
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

function invokeAuth(middleware, supplied, requestOverrides = {}) {
    const { state, response } = createResponseRecorder();
    let nextCalls = 0;
    const req = {
        ip: '203.0.113.7',
        requestId: 'request-auth-test',
        header(name) {
            assert.equal(name, 'x-slicer-api-key');
            return supplied;
        },
        ...requestOverrides
    };
    middleware(req, response, () => { nextCalls += 1; });
    return { ...state, nextCalls };
}

test('slice-service configuration accepts only 32-256 byte printable ASCII secrets', () => {
    const cases = [
        ['minimum boundary', 'A'.repeat(32), true],
        ['maximum boundary', '~'.repeat(256), true],
        ['printable ASCII range', `${'A'.repeat(31)} `, true],
        ['below minimum', 'A'.repeat(31), false],
        ['above maximum', 'A'.repeat(257), false],
        ['tab', `${'A'.repeat(31)}\t`, false],
        ['newline', `${'A'.repeat(31)}\n`, false],
        ['delete', `${'A'.repeat(31)}\x7f`, false],
        ['non-ASCII', `${'A'.repeat(31)}é`, false],
        ['non-string', Buffer.alloc(32, 0x41), false]
    ];

    assert.deepEqual(SLICE_SERVICE_KEY_LIMITS, { minimumBytes: 32, maximumBytes: 256 });
    for (const [name, candidate, expected] of cases) {
        assert.equal(isValidSliceServiceSecret(candidate), expected, name);
    }
});

test('slice-service configuration fails generically and cannot reuse the admin key', () => {
    const adminKey = 'A'.repeat(40);
    const accepted = 'B'.repeat(40);
    assert.equal(resolveSliceServiceApiKey({
        ADMIN_API_KEY: adminKey,
        SLICE_SERVICE_API_KEY: accepted
    }), accepted);

    for (const candidate of [undefined, 'short', `${'C'.repeat(31)}\n`, adminKey]) {
        assert.throws(
            () => resolveSliceServiceApiKey({
                ADMIN_API_KEY: adminKey,
                SLICE_SERVICE_API_KEY: candidate
            }),
            (error) => {
                assert.equal(error.message, SERVICE_AUTH_CONFIGURATION_ERROR);
                assert.doesNotMatch(error.message, /AAAA|short|SLICE_SERVICE_API_KEY/);
                return true;
            }
        );
    }
});

test('slice-service middleware returns the exact 401 contract for missing and wrong keys', () => {
    const middleware = createRequireSliceService({ apiKey: SERVICE_KEY, logger: { warn() {} } });
    for (const candidate of [undefined, WRONG_EQUAL_LENGTH_KEY, 'short']) {
        assert.deepEqual(invokeAuth(middleware, candidate), {
            statusCode: 401,
            body: AUTHENTICATION_FAILURE,
            nextCalls: 0
        });
    }
    assert.deepEqual(AUTHENTICATION_FAILURE, {
        success: false,
        error: 'Slice service authentication is required.',
        errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
    });
});

test('correct and both wrong-length branches use one fixed SHA-256 timing-safe comparison', () => {
    const originalTimingSafeEqual = crypto.timingSafeEqual;
    const calls = [];
    crypto.timingSafeEqual = (left, right) => {
        calls.push({ leftLength: left.length, rightLength: right.length, sameBuffer: left === right });
        return originalTimingSafeEqual(left, right);
    };

    try {
        const middleware = createRequireSliceService({ apiKey: SERVICE_KEY, logger: { warn() {} } });
        const cases = [
            ['correct', SERVICE_KEY, null, 1],
            ['equal-length wrong', WRONG_EQUAL_LENGTH_KEY, 401, 0],
            ['unequal-length wrong', 'short', 401, 0]
        ];
        for (const [name, candidate, statusCode, nextCalls] of cases) {
            const before = calls.length;
            const result = invokeAuth(middleware, candidate);
            assert.equal(result.statusCode, statusCode, name);
            assert.equal(result.nextCalls, nextCalls, name);
            assert.deepEqual(calls.slice(before), [{
                leftLength: 32,
                rightLength: 32,
                sameBuffer: false
            }], name);
        }
    } finally {
        crypto.timingSafeEqual = originalTimingSafeEqual;
    }
});

test('rejection log rejects attacker IP text and contains only sanitized identity metadata', () => {
    const warnings = [];
    const middleware = createRequireSliceService({
        apiKey: SERVICE_KEY,
        logger: { warn(...args) { warnings.push(args); } }
    });
    const supplied = 'credential-value-must-not-appear';
    const result = invokeAuth(middleware, supplied, {
        ip: '203.0.113.7\r\nspoof',
        requestId: 'request\r\nforge',
        method: 'DELETE',
        originalUrl: '/credential-bearing-url'
    });

    assert.equal(result.statusCode, 401);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].length, 2);
    assert.equal(warnings[0][0], '[SLICE AUTH] Authentication rejected.');
    assert.deepEqual(warnings[0][1], {
        requestId: 'request??forge',
        clientIp: 'unknown'
    });
    assert.deepEqual(Object.keys(warnings[0][1]).sort(), ['clientIp', 'requestId']);
    const serialized = JSON.stringify(warnings[0]);
    for (const forbidden of [SERVICE_KEY, supplied, 'DELETE', '/credential-bearing-url']) {
        assert.doesNotMatch(serialized, new RegExp(forbidden));
    }
    assert.doesNotMatch(serialized, /spoof/);

    invokeAuth(middleware, supplied, {
        ip: 'malformed-attacker-text',
        socket: { remoteAddress: '::ffff:192.0.2.44' }
    });
    assert.equal(warnings[1][1].clientIp, '192.0.2.44');
});
