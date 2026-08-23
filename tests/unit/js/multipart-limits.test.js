'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const errorHandler = require('../../../app/middleware/errorHandler');
const { resolveMultipartLimits, safeUploadError } = require('../../../app/routes/slice.routes');

test('multipart limits have finite, flat-field defaults', () => {
    assert.deepEqual(resolveMultipartLimits({}), {
        fileSize: 500 * 1024 * 1024, files: 1, fields: 40, parts: 42,
        fieldNameSize: 64, fieldSize: 65_536, fieldNestingDepth: 0
    });
});

test('multipart overrides accept only strict bounded integers and preserve parts relationship', () => {
    assert.deepEqual(resolveMultipartLimits({
        MAX_UPLOAD_BYTES: '1024', MULTIPART_MAX_FIELDS: '64', MULTIPART_MAX_PARTS: '66',
        MULTIPART_MAX_FIELD_NAME_CHARS: '256', MULTIPART_MAX_FIELD_BYTES: '1048576'
    }), {
        fileSize: 1024, files: 1, fields: 64, parts: 66,
        fieldNameSize: 256, fieldSize: 1_048_576, fieldNestingDepth: 0
    });
    for (const env of [
        { MAX_UPLOAD_BYTES: '524288001' },
        { MULTIPART_MAX_FIELDS: '34' },
        { MULTIPART_MAX_PARTS: '1' },
        { MULTIPART_MAX_FIELD_NAME_CHARS: '-1' },
        { MULTIPART_MAX_FIELD_BYTES: '1.5' }
    ]) assert.throws(() => resolveMultipartLimits(env));
});

const mappings = [
    ['LIMIT_FIELD_NESTING', 400, 'UPLOAD_FIELD_NESTING_TOO_DEEP'],
    ['LIMIT_FIELD_KEY', 400, 'UPLOAD_FIELD_NAME_TOO_LONG'],
    ['LIMIT_FIELD_COUNT', 413, 'TOO_MANY_UPLOAD_FIELDS'],
    ['LIMIT_FIELD_VALUE', 413, 'UPLOAD_FIELD_TOO_LARGE'],
    ['LIMIT_PART_COUNT', 413, 'TOO_MANY_MULTIPART_PARTS'],
    ['LIMIT_FILE_COUNT', 400, 'TOO_MANY_UPLOAD_FILES'],
    ['LIMIT_FILE_SIZE', 413, 'UPLOADED_FILE_TOO_LARGE'],
    ['LIMIT_UNEXPECTED_FILE', 400, 'UNEXPECTED_FILE_FIELD']
];

for (const [code, status, errorCode] of mappings) {
    test(`maps ${code} without reflecting parser fields`, () => {
        const err = Object.assign(new Error('attacker text'), { name: 'MulterError', code, field: 'secret[a]' });
        let actual;
        const res = { headersSent: false, status(value) { actual = { status: value }; return this; }, json(body) { actual.body = body; return this; } };
        errorHandler(err, { method: 'POST', originalUrl: '/prusa/slice' }, res, assert.fail);
        assert.equal(actual.status, status);
        assert.equal(actual.body.errorCode, errorCode);
        assert.doesNotMatch(JSON.stringify(actual.body), /attacker|secret/);
    });
}

test('normalizes parser, abort and storage failures to fixed errors', () => {
    assert.equal(safeUploadError(new Error('attacker boundary')).code, 'MALFORMED_MULTIPART_REQUEST');
    assert.equal(safeUploadError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).code, 'UPLOAD_REQUEST_ABORTED');
    assert.equal(safeUploadError(Object.assign(new Error('C:\\private'), { code: 'ENOSPC' })).code, 'UPLOAD_STORAGE_ERROR');
    assert.equal(safeUploadError(Object.assign(new Error('safe'), { code: 'UPLOAD_STORAGE_ERROR' })).code, 'UPLOAD_STORAGE_ERROR');
});
