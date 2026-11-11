'use strict';

/**
 * No `errorCode` the live plugin does not know (§7, R2): the working tree
 * holds no code literal that 3.8.3 did not hold, except the 3.9.0 names the
 * specification gives to other surfaces (`EXPORT_*` on the export routes only,
 * `ARCHIVE_*` as the additive `archive_rule` body key, `NATIVE_IDENTITY_*` on
 * `/operations/readiness` only, and the §6 environment key names). The
 * pre-existing processing rules still answer the 3.8.3 status and code, and
 * each reads with its 29a4a1c7 classification.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PYTHON_EXECUTABLE ||= process.execPath;
const V = require('./validator');
const { workingTreeLiterals } = require('./codes');
const PINNED = require('./emitted-codes-3.8.3.json');
const { handleProcessingError } = require('../../../app/services/slice/errors');

const NEW_SURFACE_PREFIXES = Object.freeze(['EXPORT_', 'ARCHIVE_', 'NATIVE_IDENTITY_']);
/** §6: environment key names, never answer codes. */
const ENVIRONMENT_KEYS = Object.freeze(['ARTIFACT_SWEEP_INTERVAL_MS', 'ARTIFACT_SWEEP_MAX_MS', 'MAX_3MF_EXPANDED_TRIANGLES',
    'MAX_3MF_EXPANDED_INSTANCES', 'MAX_3MF_MODEL_OBJECTS', 'AUTH_FAILURE_RATE_LIMIT_WINDOW_MS', 'AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS',
    'AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY', 'CHILD_OOM_SCORE_ADJ', 'SLICE_SERVICE_STAGING_API_KEY',
    'SLICE_SERVICE_STAGING_API_KEY_PREVIOUS']);
/**
 * 3.9.0 names that never reach an answer body (added by the integrator, each
 * checked at its use): log event codes, readiness reasons, export names and
 * pre-existing config keys newly named in comments.
 */
const NON_ANSWER_NAMES = Object.freeze([
    // retention-adapter.js: `artifact.cleanup` event error_code only (§4.2).
    'ARTIFACT_SCAN_INCOMPLETE',
    // service-auth.js / requireAudience.js: /operations/readiness reason and the
    // `auth.legacy_migration_expired` event; the refused request keeps today's 401 body (§4.5).
    'LEGACY_SLICE_SLOT_EXPIRED',
    // spawn-file.js comment: choom's own exit statuses, translated back to Node's ENOENT/EACCES (§4.6).
    'EX_EXEC_ENOENT', 'EX_EXEC_FAILED',
    // metrics.js / bambu-generation.js: export names of the reason enums (§4.1, §4.9).
    'IDENTITY_FAILURE_METRIC_REASONS', 'IDENTITY_FAILURE_REASONS',
    // Pre-existing resource-policy / constants keys, named in pricing.routes.js and archive-preflight.js comments and reads.
    'JSON_BODY_LIMIT', 'FORM_BODY_LIMIT', 'MAX_SLICE_QUEUE_LENGTH',
    // three-mf-expansion.js comment: the mesh2stl.py depth constant it mirrors (§4.4).
    'THREE_MF_MAX_DEPTH'
]);

test('the 3.8.3 code vocabulary was recorded at dbc539e and holds the live plugin\'s codes', () => {
    assert.match(PINNED.recorded_from, /dbc539e/);
    for (const code of ['MODEL_OUT_OF_PRINTER_BOUNDS', 'INVALID_SOURCE_GEOMETRY', 'UNSLICEABLE_SOURCE_GEOMETRY', 'AMBIGUOUS_MANUFACTURING_SCOPE',
        'SLICE_QUEUE_FULL', 'SLICE_ASYNC_JOBS_FULL', 'SLICE_DEADLINE_EXCEEDED', 'SLICE_SERVICE_AUTH_REQUIRED', 'RATE_LIMIT_EXCEEDED']) {
        assert.ok(PINNED.literals.includes(code), code);
    }
});

test('no code literal outside the 3.8.3 vocabulary and the named 3.9.0 surfaces', () => {
    const known = new Set(PINNED.literals);
    const unexpected = [...workingTreeLiterals()].filter((literal) => !known.has(literal)
        && !NEW_SURFACE_PREFIXES.some((prefix) => literal.startsWith(prefix))
        && !ENVIRONMENT_KEYS.includes(literal)
        && !NON_ANSWER_NAMES.includes(literal)).sort();
    assert.deepEqual(unexpected, [], `new code-like literals reach app/: ${unexpected.join(', ')} — a new errorCode on /bambu/slice or its jobs is read as SlicerDown by the live plugin (R2)`);
});

test('the new 3.9.0 names never collide with the live classifier\'s outage words when they reach a body', () => {
    for (const code of ['EXPORT_FORMAT_INVALID', 'EXPORT_SOURCE_MISMATCH', 'EXPORT_GEOMETRY_MISMATCH', 'EXPORT_REQUEST_INVALID',
        'EXPORT_QUEUE_FULL', 'EXPORT_WRITE_FAILED', 'EXPORT_DEADLINE_EXCEEDED', 'EXPORT_JOB_NOT_FOUND', 'EXPORT_NOT_READY']) {
        const mapped = V.mapErrorCode(409, JSON.stringify({ errorCode: code }));
        for (const word of ['bed', 'bound', 'envelope', 'timeout', 'missing', 'unavailable', 'auth', 'transport', 'rate_limit', 'breaker', 'circuit', 'unhealthy', 'orphaned']) {
            assert.equal(mapped.includes(word), false, `${code} contains ${word}`);
        }
    }
});

function answerOf(error) {
    const res = { statusCode: 0, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
    handleProcessingError(error, res, null, null, () => '.stl, .3mf');
    return res;
}

/** 3.8.3's processing rules (errors.js at dbc539e), with the plugin's reading at 29a4a1c7. */
const PROCESSING_RULES = Object.freeze([
    { error: { code: 'SLICE_RESOURCE_LIMIT_EXCEEDED', message: 'limit' }, status: 413, code: 'SLICE_RESOURCE_LIMIT_EXCEEDED', reason: 'slicer_down' },
    { error: { code: 'AMBIGUOUS_MANUFACTURING_SCOPE', message: 'scope' }, status: 422, code: 'AMBIGUOUS_MANUFACTURING_SCOPE', reason: 'geometry_rejected' },
    { error: { code: 'SLICE_IDENTITY_MISMATCH', message: 'stale' }, status: 409, code: 'SLICE_IDENTITY_MISMATCH', reason: 'slicer_down' },
    { error: { code: 'INVALID_SOURCE_ARCHIVE', message: 'archive' }, status: 400, code: 'INVALID_SOURCE_ARCHIVE', reason: 'slicer_down' },
    { error: { message: 'converter', stderr: 'INVALID_SOURCE_GEOMETRY|empty\n' }, status: 400, code: 'INVALID_SOURCE_GEOMETRY', reason: 'geometry_rejected' },
    { error: { code: 'ETIMEDOUT', message: 'helper timed out' }, status: 422, code: 'FILE_PROCESSING_TIMEOUT', reason: 'slicer_down' },
    { error: Object.assign(new Error('native died'), { cmd: 'bambu-studio', signal: 'SIGKILL', stderr: '' }), status: 500,
        code: 'INTERNAL_PROCESSING_ERROR', reason: 'slicer_down', native: { killed_by_system: true } },
    { error: new Error('anything else'), status: 500, code: 'INTERNAL_PROCESSING_ERROR', reason: 'slicer_down' }
]);

test('the pre-existing processing rules answer the 3.8.3 status and code, read as at 29a4a1c7', () => {
    for (const rule of PROCESSING_RULES) {
        const answer = answerOf(rule.error);
        assert.equal(answer.statusCode, rule.status, rule.code);
        assert.equal(answer.body.errorCode, rule.code);
        assert.equal(answer.body.success, false);
        assert.equal(Object.hasOwn(answer.body, 'code'), false, 'no `code` key');
        if (rule.native) assert.equal(answer.body.native.killed_by_system, true);
        else assert.equal(Object.hasOwn(answer.body, 'native'), false);
        assert.equal(V.classifyFailure(V.mapErrorCode(answer.statusCode, JSON.stringify(answer.body))), rule.reason, rule.code);
    }
});
