const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const REQUIRE_ADMIN_PATH = path.join(REPO_ROOT, 'app/middleware/requireAdmin.js');
const requireAdmin = require(REQUIRE_ADMIN_PATH);

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

test('legacy admin middleware export stays fail closed even when broad environment key exists', () => {
    const inertKey = 's0-inert-admin-key';
    const originalAdminKey = process.env.ADMIN_API_KEY;

    try {
        process.env.ADMIN_API_KEY = inertKey;
        for (const candidate of [undefined, inertKey, 'short']) {
            const result = invokeAdmin(candidate);
            assert.equal(result.statusCode, 503);
            assert.deepEqual(result.body, {
                success: false,
                error: 'Admin API key is not configured on server.'
            });
            assert.equal(result.nextCalls, 0);
        }
    } finally {
        if (originalAdminKey === undefined) {
            delete process.env.ADMIN_API_KEY;
        } else {
            process.env.ADMIN_API_KEY = originalAdminKey;
        }
    }
});

test('legacy admin compatibility path cannot read or compare broad environment credentials', () => {
    const source = fs.readFileSync(REQUIRE_ADMIN_PATH, 'utf8');
    assert.doesNotMatch(source, /process\.env\.ADMIN_API_KEY/);
    assert.doesNotMatch(source, /req\.header\(['"]x-api-key['"]\)/);
});
