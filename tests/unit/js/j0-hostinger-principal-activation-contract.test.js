'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const RUNBOOK_PATH = path.resolve(__dirname, '../../../ops/hostinger/RUNBOOK.md');
const RUNBOOK = fs.readFileSync(RUNBOOK_PATH, 'utf8').replace(/\r\n?/g, '\n');

const REQUIRED = Object.freeze([
    '### J0 principal-only slice-authentication activation gate',
    '`SLICE_SERVICE_AUTH_MODE=principals`',
    'both\nnamed principal active slots (`woocommerce` and `leadpilot`)',
    'The shared active, shared\nprevious, and migration expiry must all be absent.',
    'every retired shared active/previous credential under `x-slicer-api-key`\n'
        + '  returns exact HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` and creates no\n'
        + '  workspace, queue job, or artifact',
    'a correct principal credential supplied only under `x-api-key` returns exact\n'
        + '  HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` and creates no workspace, queue job,\n'
        + '  or artifact.',
    'STOP_SLICE_PRINCIPAL_ACTIVATION_UNPROVEN',
    '## 3. Start Traefik with routing still disabled'
]);

function validateActivationContract(source) {
    const positions = REQUIRED.map((fragment) => source.indexOf(fragment));
    if (positions.some((position) => position < 0)) return false;
    return positions.every((position, index) => index === 0 || position > positions[index - 1]);
}

function replaceRequired(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replace(from, to);
}

test('route activation is gated by the complete principal-only auth matrix', () => {
    assert.equal(validateActivationContract(RUNBOOK), true);
});

test('principal activation weakening mutations fail the public runbook contract', async (t) => {
    const mutations = [
        ['legacy mode', '`SLICE_SERVICE_AUTH_MODE=principals`',
            '`SLICE_SERVICE_AUTH_MODE=legacy`'],
        ['single principal', 'both\nnamed principal active slots (`woocommerce` and `leadpilot`)',
            'one principal active slot'],
        ['shared material retained', 'The shared active, shared\nprevious, and migration expiry must all be absent.',
            'Shared credentials remain configured.'],
        ['retired key admitted',
            'every retired shared active/previous credential under `x-slicer-api-key`\n'
                + '  returns exact HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` and creates no\n'
                + '  workspace, queue job, or artifact',
            'retired credentials may authorize'],
        ['wrong header admitted',
            'a correct principal credential supplied only under `x-api-key` returns exact\n'
                + '  HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` and creates no workspace, queue job,\n'
                + '  or artifact.',
            'both headers authorize'],
        ['stop removed', 'STOP_SLICE_PRINCIPAL_ACTIVATION_UNPROVEN',
            'CONTINUE_WITH_SHARED_SLICE_KEY'],
        ['pre-Traefik gate removed',
            '### J0 principal-only slice-authentication activation gate',
            '### Principal authentication deferred']
    ];
    for (const [name, from, to] of mutations) await t.test(name, () => {
        const mutated = replaceRequired(RUNBOOK, from, to);
        assert.equal(validateActivationContract(mutated), false);
    });
});
