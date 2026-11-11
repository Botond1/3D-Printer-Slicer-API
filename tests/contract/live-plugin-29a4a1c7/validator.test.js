'use strict';

/**
 * The port of the live plugin's validators reads the fixtures the way the
 * PHP classes at 29a4a1c7 do: the success answer is admitted, the receipt
 * digest of the slicer's `hashValue` equals the plugin's `javascriptJson`
 * digest, a planted `{}`, numeric keys, a non-ASCII key order or a float where
 * PHP wants an integer are refused, and every refusal maps to the code,
 * classification and breaker effect pinned for 3.8.3.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashValue } = require('../../../app/services/slice/receipt-hash');
const V = require('./validator');
const { ERROR_ANSWERS, sliceRequest, successBody } = require('./fixtures');

const REQUEST = sliceRequest();

function refusal(fn) {
    try {
        fn();
    } catch (error) {
        assert.ok(error instanceof V.PluginRefusal, String(error && error.stack));
        return error;
    }
    return assert.fail('expected a refusal');
}

function submitSync(body, status = 200) {
    return V.readSubmission(REQUEST, { status, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

/** Re-seal a receipt as the slicer would, then plant raw JSON text into the answer. */
function plantedAnswer(mutateReceipt, rawReplace) {
    const body = successBody(REQUEST, (answer) => mutateReceipt(answer.technical_receipt));
    let text = JSON.stringify(body);
    if (rawReplace) text = rawReplace(text);
    return text;
}

test('the success answer passes TechnicalReceipt, toSliceResult and SlicerContract', () => {
    const outcome = submitSync(successBody());
    assert.equal(outcome.kind, 'result');
    assert.equal(outcome.result.printTimeS, 829);
    assert.equal(outcome.result.filamentG, 1.78);
});

test('the slicer\'s receipt hashValue equals the plugin\'s javascriptJson digest for an ordinary receipt', () => {
    const receipt = successBody().technical_receipt;
    const { receipt_sha256: sealed, ...unsealed } = receipt;
    assert.equal(sealed, hashValue(unsealed));
    assert.equal(V.technicalReceiptDigest(V.fromJs(unsealed)), sealed);
});

test('a planted {} in the receipt is refused (PHP reads it as [])', () => {
    const error = refusal(() => submitSync(plantedAnswer((receipt) => { receipt.applied.extra = {}; })));
    assert.equal(error.code, 'r3d_contract_receipt_invalid');
    assert.equal(error.context.receipt_rule, 'receipt_sha256.digest');
});

test('an object with numeric keys in the receipt is refused (PHP makes it a list)', () => {
    const error = refusal(() => submitSync(plantedAnswer((receipt) => { receipt.applied.layers = { 0: 'a', 1: 'b' }; })));
    assert.equal(error.context.receipt_rule, 'receipt_sha256.digest');
});

test('non-ASCII keys whose UTF-16 and UTF-8 orders differ are refused', () => {
    const error = refusal(() => submitSync(plantedAnswer((receipt) => { receipt.applied.notes = { '～': 1, '\u{1f600}': 2 }; })));
    assert.equal(error.context.receipt_rule, 'receipt_sha256.digest');
    const ascii = submitSync(plantedAnswer((receipt) => { receipt.applied.notes = { b: 1, a: 2, 'é': 3 }; }));
    assert.equal(ascii.kind, 'result');
});

test('a non-finite number cannot be written into the canonical JSON', () => {
    assert.throws(() => V.javascriptJson(Number.POSITIVE_INFINITY), V.PluginRefusal);
    assert.equal(V.javascriptJson(V.phpJsonDecode('[1.0, -0.0, 1e21, 0.000001, 1e-7, 5]')), '[1,0,1e+21,0.000001,1e-7,5]');
});

test('the receipt\'s closed enums and integer counts are enforced', () => {
    const cases = [
        [(r) => { r.geometry.volume_source = 'guess'; }, 'geometry.volume_source'],
        [(r) => { r.engine.platform = 'freebsd'; }, 'engine.platform'],
        [(r) => { r.source.format = 'gcode'; }, 'source.format'],
        [(r) => { r.warnings = [{ code: 'X', severity: 'warning', source: 'plugin' }]; }, 'warnings.source'],
        [(r) => { r.warnings = [{ code: 'lower', severity: 'warning', source: 'native' }]; }, 'warnings.code'],
        [(r) => { r.warnings = [{ code: 'X', severity: 'info', source: 'native' }]; }, 'warnings.severity'],
        [(r) => { r.scope.kind = 'assembly'; }, 'scope.kind'],
        [(r) => { r.artifact.retention_seconds = 0; }, 'artifact.retention_seconds'],
        [(r) => { r.geometry.watertight = 'yes'; }, 'geometry.watertight'],
        [(r) => { r.geometry.open_edge_count = -1; }, 'geometry.open_edge_count'],
        [(r) => { delete r.estimates.support_material_g; }, 'estimates.support_material_g'],
        [(r) => { r.identity.processing_schema = 'r3d-bambu-processing-v2'; }, 'identity.processing_schema'],
        [(r) => { r.measurement_generation = 'a'.repeat(64); }, 'measurement_generation']
    ];
    for (const [mutate, rule] of cases) {
        const error = refusal(() => submitSync(plantedAnswer(mutate)));
        assert.equal(error.context.receipt_rule, rule, rule);
    }
});

test('a float where PHP wants an integer is refused although the digest still matches', () => {
    const text = plantedAnswer(() => {}, (raw) => raw.replace('"component_count":1,', '"component_count":1.0,'));
    const error = refusal(() => submitSync(text));
    assert.equal(error.context.receipt_rule, 'geometry.component_count');
});

test('the 3.6.0 description counters stay optional (a 3.5.0 receipt validates)', () => {
    const outcome = submitSync(plantedAnswer((receipt) => {
        for (const key of ['closed_component_count', 'open_edge_count', 'dropped_degenerate_faces', 'dropped_duplicate_faces']) delete receipt.geometry[key];
    }));
    assert.equal(outcome.kind, 'result');
});

test('the receipt binds to the request: a scale, rotation or layer it did not ask for is refused', () => {
    assert.equal(refusal(() => submitSync(plantedAnswer((receipt) => { receipt.geometry.model_transform.scale_factors.x = 1.001; })))
        .context.receipt_rule, 'geometry.model_transform.scale_factors.x');
    assert.equal(refusal(() => submitSync(plantedAnswer((receipt) => { receipt.geometry.model_transform = { ...receipt.geometry.model_transform, size_unit: 'in' }; })))
        .context.receipt_rule, 'geometry.model_transform');
    const scaled = sliceRequest({ scalePercent: 333.4 });
    const body = successBody(scaled, (answer) => {
        for (const axis of ['x', 'y', 'z']) {
            answer.model_transform.scale_factors[axis] = 3.334;
        }
    });
    assert.equal(V.readSubmission(scaled, { status: 200, body: JSON.stringify(body) }).kind, 'result');
});

test('toSliceResult refuses inconsistent provenance and a moved profile', () => {
    assert.equal(refusal(() => submitSync(successBody(REQUEST, (answer) => { answer.material = 'PETG'; }))).code, 'r3d_contract_provenance_invalid');
    assert.equal(refusal(() => submitSync(successBody(REQUEST, (answer) => { answer.engine_version = '02.08.02.62'; }))).code, 'r3d_contract_profile_changed');
    assert.equal(refusal(() => submitSync(successBody(REQUEST, (answer) => { answer.stats.print_time_seconds = 829.5; }))).code, 'r3d_contract_stats_invalid');
    assert.equal(refusal(() => submitSync(successBody(REQUEST, (answer) => { answer.model_transform.final_dimensions_mm.z = 300; }))).code,
        'r3d_contract_dimensions_invalid');
    assert.equal(submitSync(successBody(REQUEST, (answer) => { answer.model_transform.final_dimensions_mm.x = 237; answer.model_transform.final_dimensions_mm.y = 250; })).kind,
        'result', 'the P1S L-shaped footprint (D119)');
    assert.equal(refusal(() => submitSync('{"success":false}')).code, 'r3d_slicer_malformed_response');
});

test('every 3.8.3 refusal maps to the pinned code, classification and breaker effect', () => {
    for (const answer of ERROR_ANSWERS) {
        const error = refusal(() => V.readSubmission(REQUEST, { status: answer.status, body: JSON.stringify(answer.body), retryAfter: answer.headers?.['retry-after'] }));
        assert.equal(error.code, answer.code, answer.name);
        assert.equal(V.classifyFailure(error.code), answer.reason, answer.name);
        assert.equal(error.context.breakerStrike === true, answer.strike, `${answer.name} strike`);
        const async = refusal(() => V.readSubmission(REQUEST, { status: answer.status, body: JSON.stringify(answer.body), preferAsync: true }));
        assert.equal(async.code, answer.asyncCode || answer.code, `${answer.name} async`);
    }
});

test('a finished job\'s own 5xx is its verdict and never strikes the breaker (D146)', () => {
    for (const answer of ERROR_ANSWERS.filter((candidate) => candidate.finishedStrike === false)) {
        const view = V.asyncStatus(200, JSON.stringify({ success: true, async_contract: 1, job_id: `sj_${'a'.repeat(32)}`, status: 'completed',
            elapsed_ms: 10, result_status: answer.status, result: answer.body }), null, `sj_${'a'.repeat(32)}`);
        assert.equal(view.kind, 'completed');
        const error = refusal(() => V.readCompleted(REQUEST, view, JSON.stringify(answer.body)));
        assert.equal(error.code, answer.code);
        assert.equal(error.context.breakerStrike, false);
    }
});

test('the code extractor: code before errorCode, error.code objects, bounded names, the deadline alias', () => {
    assert.equal(V.mapErrorCode(400, '{"code":"A_B","errorCode":"C"}'), 'r3d_slicer_a_b');
    assert.equal(V.mapErrorCode(400, '{"errorCode":"C","error":"geometry words"}'), 'r3d_slicer_c');
    assert.equal(V.mapErrorCode(400, '{"error":{"code":"NESTED"}}'), 'r3d_slicer_nested');
    assert.equal(V.mapErrorCode(400, `{"errorCode":"${'A'.repeat(54)}"}`), 'r3d_slicer_http_400');
    assert.equal(V.mapErrorCode(422, '{"errorCode":"bad-code"}'), 'r3d_slicer_http_422');
    assert.equal(V.mapErrorCode(504, '{"errorCode":"SLICE_DEADLINE_EXCEEDED"}'), V.DEADLINE_EXCEEDED_CODE);
    assert.equal(V.mapErrorCode(502, '<html>bad gateway</html>'), 'r3d_slicer_http_502');
    assert.equal(V.gatewayGap(502, '<html>'), true);
    assert.equal(V.gatewayGap(503, '{"errorCode":"SLICE_QUEUE_FULL"}'), false);
    assert.equal(V.machineCode(V.phpJsonDecode('{"code":"X","errorCode":"Y"}')), 'Y');
});

test('the classifier keeps its 29a4a1c7 order: outage codes first, mesh verdicts, then bounds', () => {
    assert.equal(V.classifyFailure('r3d_contract_dimensions_invalid'), 'out_of_bounds');
    assert.equal(V.classifyFailure('r3d_effective_geometry_sig_invalid'), 'slicer_down');
    assert.equal(V.classifyFailure('r3d_slicer_invalid_source_geometry'), 'geometry_rejected');
    assert.equal(V.classifyFailure('r3d_slicer_some_bed_envelope'), 'out_of_bounds');
    assert.equal(V.classifyFailure('r3d_slicer_bed_timeout'), 'slicer_down');
    assert.equal(V.classifyFailure('r3d_slicer_export_geometry_mismatch'), 'slicer_down');
    assert.equal(V.classifyFailure(''), 'slicer_down');
});

test('AsyncSliceAcceptance admits the contract\'s 202 and refuses anything else', () => {
    const jobId = `sj_${'b'.repeat(32)}`;
    const body = { success: true, async_contract: 1, job_id: jobId, status: 'queued', status_url: `/bambu/slice/jobs/${jobId}`,
        poll_after_ms: 2000, deadline_at: '2026-11-11T10:00:00.000Z', deadline_ms: 900000 };
    const accepted = V.asyncAcceptance(JSON.stringify(body), '2', 'bambu');
    assert.deepEqual([accepted.jobId, accepted.pollAfterMs, accepted.retryAfterSeconds, accepted.deadlineMs], [jobId, 2000, 2, 900000]);
    const text = JSON.stringify(body);
    for (const bad of [
        text.replace('"async_contract":1', '"async_contract":2'),
        text.replace('"async_contract":1', '"async_contract":1.0'),
        text.replace(/sj_b{32}/g, `ex_${'b'.repeat(32)}`),
        text.replace('"status":"queued"', '"status":"completed"'),
        text.replace(`"status_url":"/bambu/slice/jobs/${jobId}"`, '"status_url":"/bambu/export/jobs/x"'),
        text.replace('"success":true', '"success":"true"')
    ]) {
        assert.notEqual(bad, text);
        assert.throws(() => V.asyncAcceptance(bad, null, 'bambu'), V.PluginRefusal);
    }
});

test('AsyncSliceStatus: 404, 401, transient answers, pending, completed and a list result', () => {
    const jobId = `sj_${'c'.repeat(32)}`;
    assert.equal(V.asyncStatus(404, '', null, jobId).kind, 'not_found');
    assert.equal(V.asyncStatus(401, JSON.stringify(ERROR_ANSWERS.find((a) => a.status === 401).body), null, jobId).errorCode,
        'r3d_slicer_slice_service_auth_required');
    assert.equal(V.asyncStatus(429, '{}', '7', jobId).kind, 'unavailable');
    assert.equal(V.asyncStatus(429, '{}', '7', jobId).retryAfterSeconds, 7);
    const pending = V.asyncStatus(200, JSON.stringify({ success: true, async_contract: 1, job_id: jobId, status: 'queued', queue_position: 2,
        elapsed_ms: 5, deadline_at: 'x', poll_after_ms: 2000 }), null, jobId);
    assert.deepEqual([pending.kind, pending.queuePosition], ['pending', 2]);
    assert.equal(V.asyncStatus(200, JSON.stringify({ success: true, async_contract: 1, job_id: `sj_${'d'.repeat(32)}`, status: 'queued' }), null, jobId).kind,
        'unavailable');
    assert.equal(V.asyncStatus(200, JSON.stringify({ success: true, async_contract: 1, job_id: jobId, status: 'completed', result_status: 200,
        result: [1, 2] }), null, jobId).kind, 'malformed');
    assert.equal(V.asyncStatus(200, JSON.stringify({ success: true, async_contract: 1, job_id: jobId, status: 'completed', result_status: 200,
        result: {} }), null, jobId).kind, 'completed');
});
