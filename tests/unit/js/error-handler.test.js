const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const errorHandler = require(path.join(REPO_ROOT, 'app/middleware/errorHandler'));

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

test('global error middleware preserves known status and error-code mappings', async (t) => {
    const cases = [
        ['admin CORS', { code: 'ADMIN_CORS_ORIGIN_NOT_ALLOWED' }, 403, 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'],
        ['slice CORS', { code: 'SLICE_CORS_ORIGIN_NOT_ALLOWED' }, 403, 'SLICE_CORS_ORIGIN_NOT_ALLOWED'],
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

test('global error middleware preserves the exact slice CORS rejection payload', () => {
    const { state, response } = createResponseRecorder();
    const error = Object.assign(new Error('untrusted implementation message'), {
        code: 'SLICE_CORS_ORIGIN_NOT_ALLOWED'
    });

    errorHandler(error, {
        method: 'POST',
        originalUrl: '/prusa/slice'
    }, response, assert.fail);

    assert.equal(state.statusCode, 403);
    assert.deepEqual(state.body, {
        success: false,
        error: 'Origin is not allowed for slicing endpoints.',
        errorCode: 'SLICE_CORS_ORIGIN_NOT_ALLOWED'
    });
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
