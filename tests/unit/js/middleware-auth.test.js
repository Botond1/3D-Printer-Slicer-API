const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const errorHandler = require(path.join(REPO_ROOT, 'app/middleware/errorHandler'));
const requireAdmin = require(path.join(REPO_ROOT, 'app/middleware/requireAdmin'));

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

function invokeAdmin(apiKey) {
    const { state, response } = createResponseRecorder();
    let nextCalls = 0;
    requireAdmin(createAdminRequest(apiKey), response, () => {
        nextCalls += 1;
    });
    return { ...state, nextCalls };
}

test('global error middleware preserves known status and error-code mappings', async (t) => {
    const cases = [
        ['admin CORS', { code: 'ADMIN_CORS_ORIGIN_NOT_ALLOWED' }, 403, 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'],
        ['invalid JSON', { type: 'entity.parse.failed' }, 400, 'INVALID_JSON_BODY'],
        ['large body', { type: 'entity.too.large' }, 413, 'PAYLOAD_TOO_LARGE'],
        ['large upload', { code: 'LIMIT_FILE_SIZE' }, 413, 'UPLOADED_FILE_TOO_LARGE'],
        ['unexpected upload field', { code: 'LIMIT_UNEXPECTED_FILE' }, 400, 'UNEXPECTED_FILE_FIELD'],
        ['unsupported format', { code: 'UNSUPPORTED_FILE_FORMAT' }, 400, 'UNSUPPORTED_FILE_FORMAT'],
        ['other Multer error', { name: 'MulterError' }, 400, 'UPLOAD_ERROR']
    ];

    for (const [name, fields, expectedStatus, expectedCode] of cases) {
        await t.test(name, () => {
            const { state, response } = createResponseRecorder();
            const error = Object.assign(new Error('test failure'), fields);
            errorHandler(error, { method: 'POST', originalUrl: '/prusa/slice' }, response, assert.fail);
            assert.equal(state.statusCode, expectedStatus);
            assert.equal(state.body.success, false);
            assert.equal(state.body.errorCode, expectedCode);
        });
    }
});

test('global error middleware hides server details and preserves safe client failures', () => {
    const clientResult = createResponseRecorder();
    const clientError = Object.assign(new Error('Missing resource.'), { status: 404 });
    errorHandler(
        clientError,
        { method: 'GET', originalUrl: '/missing' },
        clientResult.response,
        assert.fail
    );
    assert.equal(clientResult.state.statusCode, 404);
    assert.deepEqual(clientResult.state.body, {
        success: false,
        error: 'Missing resource.',
        errorCode: 'REQUEST_FAILED'
    });

    const serverResult = createResponseRecorder();
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        errorHandler(
            new Error('sensitive implementation detail'),
            { method: 'GET', originalUrl: '/failure' },
            serverResult.response,
            assert.fail
        );
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(serverResult.state.statusCode, 500);
    assert.deepEqual(serverResult.state.body, {
        success: false,
        error: 'Internal server error.',
        errorCode: 'INTERNAL_SERVER_ERROR'
    });
});

test('global error middleware delegates after headers have been sent', () => {
    const { state, response } = createResponseRecorder();
    state.headersSent = true;
    const error = new Error('stream failed');
    let delegated = null;

    errorHandler(error, {}, response, (received) => {
        delegated = received;
    });

    assert.equal(delegated, error);
    assert.equal(state.statusCode, null);
    assert.equal(state.body, null);
});

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

test('admin comparison structurally invokes timingSafeEqual for equal and unequal lengths', () => {
    const source = fs.readFileSync(
        path.join(REPO_ROOT, 'app/middleware/requireAdmin.js'),
        'utf8'
    );

    assert.match(
        source,
        /if \(bufA\.length !== bufB\.length\) \{\s*crypto\.timingSafeEqual\(bufA, bufA\);\s*return false;\s*\}/
    );
    assert.match(source, /return crypto\.timingSafeEqual\(bufA, bufB\);/);
});
