'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const ENVELOPE_PATH = path.join(ROOT, 'scripts/i4-image-runtime-envelope.js');
const SOURCE = fs.readFileSync(ENVELOPE_PATH, 'utf8').replace(/\r\n?/g, '\n');
const {
    ABORT_TRANSPORT_FAILURES,
    ABORT_TRANSPORT_REPRESENTATIONS,
    evaluateAbortTransport
} = require(path.join(ROOT, 'scripts/i4-abort-transport-contract'));

function abortSourceContract(source) {
    for (const anchor of [
        'const controller = new AbortController();',
        'queue.activeJobs === 1',
        'controller.abort();',
        'if (!controller.signal.aborted)',
        'evaluateAbortTransport(controller.signal.aborted, outcome)',
        'if (!abortTransport.ok) fail(abortTransport.reason);',
        'queue.activeJobs === 0 && queue.queueLength === 0',
        'JSON.stringify(afterInventory) !== JSON.stringify(beforeInventory)',
        'JSON.stringify(afterEntries) !== JSON.stringify(beforeEntries)',
        'proveNoPostAbortDescendants(record);',
        'stderrReasons: CONTAINER_PROBE_FAILURES',
        'options.stderrReasons.includes(innerReason)',
        ")).catch((error) => ({ error })).finally("
    ]) {
        assert.ok(source.includes(anchor), `missing abort contract anchor: ${anchor}`);
    }
    assert.ok(source.split('controller.abort();').length - 1 >= 2,
        'active-path and fail-closed abort calls are both required');
    assert.doesNotMatch(source, /outcome\.error\.name\s*!==\s*['"]AbortError['"]/);
}

test('abort transport accepts only bounded semantic termination representations', () => {
    assert.deepEqual(evaluateAbortTransport(true, {
        error: Object.assign(new Error(), { name: 'AbortError' })
    }), { ok: true, representation: 'abort_exception' });
    assert.deepEqual(evaluateAbortTransport(true, {
        error: Object.assign(new Error(), { name: 'TypeError' })
    }), { ok: true, representation: 'transport_close' });
    assert.deepEqual(evaluateAbortTransport(true, {
        response: { status: 499 },
        text: '{"errorCode":"REQUEST_ABORTED"}'
    }), { ok: true, representation: 'terminal_response' });
    assert.deepEqual(evaluateAbortTransport(true, {
        response: { status: 503 },
        text: ''
    }), { ok: true, representation: 'terminal_response' });
    assert.deepEqual([...ABORT_TRANSPORT_REPRESENTATIONS].sort(), [
        'abort_exception', 'terminal_response', 'transport_close'
    ]);
});

test('abort transport rejects success, timeout, missing abort, and unbounded or unknown outcomes', () => {
    const cases = [
        [false, { error: { name: 'AbortError' } }, 'abort_signal_not_set'],
        [true, { timedOut: true }, 'abort_request_timeout'],
        [true, { response: { status: 200 }, text: '{"success":true}' }, 'abort_success_response'],
        [true, { response: { status: 400 }, text: 'x'.repeat(65_537) },
            'abort_terminal_response_unbounded'],
        [true, { error: { name: 'RangeError' } }, 'abort_transport_unexpected'],
        [true, { response: { status: 302 }, text: '' }, 'abort_transport_unexpected'],
        [true, { error: { name: 'AbortError' }, response: { status: 499 }, text: '' },
            'abort_transport_unexpected'],
        [true, null, 'abort_transport_unexpected']
    ];
    for (const [signalAborted, outcome, reason] of cases) {
        assert.deepEqual(evaluateAbortTransport(signalAborted, outcome), { ok: false, reason });
        assert.ok(ABORT_TRANSPORT_FAILURES.includes(reason));
    }
});

test('active observation, abort, settlement, and both artifact inventories resist mutations', async (t) => {
    abortSourceContract(SOURCE);
    const cases = [
        ['abort call removed', '  controller.abort();\n  if (!controller.signal.aborted)',
            '  if (!controller.signal.aborted)'],
        ['active observation removed', 'queue.activeJobs === 1', 'false'],
        ['final queue not empty accepted',
            'queue.activeJobs === 0 && queue.queueLength === 0', 'queue.activeJobs === 0'],
        ['native settlement removed', '    proveNoPostAbortDescendants(record);\n', ''],
        ['API inventory delta ignored',
            'JSON.stringify(afterInventory) !== JSON.stringify(beforeInventory)', 'false'],
        ['filesystem inventory delta ignored',
            'JSON.stringify(afterEntries) !== JSON.stringify(beforeEntries)', 'false'],
        ['transport catch removed', ')).catch((error) => ({ error })).finally(',
            ')).finally('],
        ['inner reason propagation removed', 'stderrReasons: CONTAINER_PROBE_FAILURES',
            'stderrReasons: []']
    ];
    for (const [name, from, to] of cases) {
        await t.test(name, () => {
            assert.ok(SOURCE.includes(from), `missing mutation anchor: ${from}`);
            assert.throws(() => abortSourceContract(SOURCE.replace(from, to)));
        });
    }
});
