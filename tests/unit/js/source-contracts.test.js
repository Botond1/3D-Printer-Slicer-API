const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function assertNearestResponseStatus(source, errorCode, expectedStatus) {
    const marker = `errorCode: '${errorCode}'`;
    const markerIndex = source.indexOf(marker);
    assert.notEqual(markerIndex, -1, `Missing ${errorCode}`);
    const prefix = source.slice(Math.max(0, markerIndex - 1600), markerIndex);
    const statusMatches = [...prefix.matchAll(/res\.status\((\d+)\)\.json/g)];
    assert.ok(statusMatches.length > 0, `Missing HTTP status near ${errorCode}`);
    assert.equal(Number(statusMatches.at(-1)[1]), expectedStatus, errorCode);
}

function assertNearestRuleStatus(source, errorCode, expectedStatus) {
    const marker = `errorCode: '${errorCode}'`;
    const markerIndex = source.indexOf(marker);
    assert.notEqual(markerIndex, -1, `Missing ${errorCode}`);
    const prefix = source.slice(Math.max(0, markerIndex - 500), markerIndex);
    const statusMatches = [...prefix.matchAll(/status:\s*(\d+)/g)];
    assert.ok(statusMatches.length > 0, `Missing rule status near ${errorCode}`);
    assert.equal(Number(statusMatches.at(-1)[1]), expectedStatus, errorCode);
}

test('processing-error source retains selected fail-fast and timeout mappings', () => {
    const source = readSource('app/services/slice/errors.js');
    assertNearestResponseStatus(source, 'FILE_PROCESSING_TIMEOUT', 422);
    assertNearestResponseStatus(source, 'INVALID_SOURCE_GEOMETRY', 400);
    assertNearestResponseStatus(source, 'INVALID_SOURCE_ARCHIVE', 400);
    assertNearestResponseStatus(source, 'ORCA_PROFILE_INCOMPATIBLE', 422);
    assertNearestResponseStatus(source, 'INTERNAL_PROCESSING_ERROR', 500);
    assert.match(source, /Automatic repair is disabled to preserve exact model fidelity\./);
});

test('queue source retains typed stable status/error-code metadata', () => {
    const source = readSource('app/services/slice/queue.js');
    assert.match(
        source,
        /class SliceQueueFullError[\s\S]{0,300}?super\([^;]+, 503, 'SLICE_QUEUE_FULL'\);/
    );
    assert.match(
        source,
        /class SliceQueueTimeoutError[\s\S]{0,300}?super\([^;]+, 503, 'SLICE_QUEUE_TIMEOUT'\);/
    );
    assert.match(
        source,
        /class SliceQueueClientLimitError[\s\S]{0,300}?super\([^;]+, 429, 'SLICE_QUEUE_CLIENT_LIMIT'\);/
    );
});

test('global error-handler source retains selected middleware mappings', () => {
    const source = readSource('app/middleware/errorHandler.js');
    assertNearestRuleStatus(source, 'ADMIN_CORS_ORIGIN_NOT_ALLOWED', 403);
    assertNearestRuleStatus(source, 'INVALID_JSON_BODY', 400);
    assertNearestRuleStatus(source, 'PAYLOAD_TOO_LARGE', 413);
    assertNearestRuleStatus(source, 'UPLOADED_FILE_TOO_LARGE', 413);
    assertNearestRuleStatus(source, 'UNEXPECTED_FILE_FIELD', 400);
    assertNearestRuleStatus(source, 'UNSUPPORTED_FILE_FORMAT', 400);
    assertNearestRuleStatus(source, 'UPLOAD_ERROR', 400);
    assert.match(source, /Unexpected file field\. Use "choosenFile" for uploads\./);
});
