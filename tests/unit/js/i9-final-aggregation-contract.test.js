'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW = fs.readFileSync(
    path.join(ROOT, '.github/workflows/staging-rollback-rehearsal.yml'), 'utf8'
).replace(/\r\n?/g, '\n');

const INPUTS = Object.freeze([
    ['REGISTRY_LOGIN_OUTCOME', 'steps.registry_login.outcome'],
    ['MANIFEST_OUTCOME', 'steps.manifest_contract.outcome'],
    ['REGISTRY_IDENTITY_OUTCOME', 'steps.registry_identity.outcome'],
    ['ATTESTATION_VERIFICATION_OUTCOME', 'steps.attestation_verification.outcome'],
    ['VERIFICATION_CLEANUP_OUTCOME', 'steps.verification_cleanup.outcome'],
    ['EVIDENCE_SETUP_OUTCOME', 'steps.evidence_setup.outcome'],
    ['RUNTIME_IMAGES_OUTCOME', 'steps.runtime_images.outcome'],
    ['RUNTIME_SETUP_OUTCOME', 'steps.runtime_setup.outcome'],
    ['REHEARSAL_OUTCOME', 'steps.rehearsal.outcome'],
    ['REHEARSAL_CLASSIFICATION', 'steps.rehearsal.outputs.classification'],
    ['ROLLBACK_CLASSIFICATION', 'steps.rehearsal.outputs.rollback_classification'],
    ['RUNTIME_CLEANUP_CLASSIFICATION', 'steps.rehearsal.outputs.cleanup_classification'],
    ['RUNTIME_POST_CLEANUP_OUTCOME', 'steps.runtime_post_cleanup.outcome'],
    ['EVIDENCE_WRITE_OUTCOME', 'steps.evidence_write.outcome'],
    ['EVIDENCE_BOUNDARY_OUTCOME', 'steps.evidence_boundary.outcome'],
    ['EVIDENCE_UPLOAD_OUTCOME', 'steps.evidence_upload.outcome'],
    ['EVIDENCE_CLEANUP_OUTCOME', 'steps.evidence_cleanup.outcome']
]);

function stepBlock(source, id) {
    const lines = source.split('\n');
    const marker = lines.findIndex((line) => line.trim() === `id: ${id}`);
    assert.notEqual(marker, -1, `missing step ${id}`);
    let start = marker;
    while (start >= 0 && !/^\s*-\s+name:/.test(lines[start])) start -= 1;
    let end = marker + 1;
    while (end < lines.length && !/^\s*-\s+name:/.test(lines[end])) end += 1;
    return lines.slice(start, end).join('\n');
}

function normalized(value) {
    return value.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

function assertFinalContract(source) {
    const final = stepBlock(source, 'final_enforcement');
    const withoutFinal = source.replace(final, '');
    assert.match(final, /if: \$\{\{ always\(\) \}\}/);
    assert.doesNotMatch(withoutFinal, /I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE/,
        'only final enforcement may claim completion');
    assert.equal(final.split('I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE').length - 1, 2);
    for (const [name, expression] of INPUTS) {
        assert.match(final, new RegExp(
            `${name}: \\$\\{\\{ ${expression.replaceAll('.', '\\.')} \\}\\}`
        ), `missing final binding ${name}`);
        assert.match(final, new RegExp(`\\$${name}\\b`), `missing final decision input ${name}`);
    }
    const normalizedFinal = normalized(final);
    for (const branch of [
        'classification=BLOCKED_I9_CLEANUP_FAILURE\nfailed_step=cleanup',
        'classification=BLOCKED_I9_MANIFEST_CONTRACT\nfailed_step=manifest',
        'classification=BLOCKED_I9_REGISTRY_READ_CAPABILITY\nfailed_step=registry_identity',
        'classification=BLOCKED_I9_ATTESTATION_VERIFICATION\nfailed_step=attestation_verification',
        'classification=BLOCKED_I9_RUNTIME_IDENTITY_MISMATCH\nfailed_step=runtime_images',
        'classification=BLOCKED_I9_HOST_OWNERSHIP_CAPABILITY\nfailed_step=runtime_setup',
        'classification=BLOCKED_I9_CLEANUP_FAILURE\nfailed_step=runtime_cleanup',
        'classification=BLOCKED_I9_ROLLBACK_FAILURE\nfailed_step=rollback',
        'classification=BLOCKED_I9_REHEARSAL_GATE\nfailed_step=rehearsal',
        'classification=BLOCKED_I9_EVIDENCE_FAILURE\nfailed_step=evidence'
    ]) assert.ok(normalizedFinal.includes(branch), `missing final branch ${branch}`);
    assert.ok(final.indexOf('BLOCKED_I9_CLEANUP_FAILURE')
        < final.indexOf('BLOCKED_I9_REGISTRY_READ_CAPABILITY'),
    'cleanup failure must remain independently fail-closed before primary classifications');
    assert.match(final,
        /if \[ \"\$classification\" != \"I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE\" \]; then[\s\S]*exit 1/);
    assert.match(final, /Runtime cleanup:.*RUNTIME_CLEANUP_CLASSIFICATION/);
    assert.match(final, /Evidence cleanup:.*EVIDENCE_CLEANUP_OUTCOME/);
    assert.match(final, /hosted ephemeral Docker only; it did not deploy to a VPS or production/);
}

test('only final always-running aggregation may claim I9 rehearsal completion', () => {
    assertFinalContract(WORKFLOW);
});

test('every final aggregation binding is mutation-sensitive', async (t) => {
    const final = stepBlock(WORKFLOW, 'final_enforcement');
    for (const [name, expression] of INPUTS) await t.test(name, () => {
        const anchor = `${name}: \${{ ${expression} }}`;
        assert.equal(final.split(anchor).length - 1, 1, `missing unique binding ${name}`);
        const mutated = final.replace(anchor, `${name}: ignored`);
        assert.throws(() => assertFinalContract(WORKFLOW.replace(final, mutated)));
    });
});

test('every final aggregation decision input is mutation-sensitive', async (t) => {
    const final = stepBlock(WORKFLOW, 'final_enforcement');
    for (const [name] of INPUTS) await t.test(name, () => {
        const shellAnchor = `$${name}`;
        assert.ok(final.includes(shellAnchor), `missing shell input ${name}`);
        const mutated = final.replaceAll(shellAnchor, `$IGNORED_${name}`);
        assert.throws(() => assertFinalContract(WORKFLOW.replace(final, mutated)));
    });
});

module.exports = Object.freeze({ INPUTS, assertFinalContract, stepBlock });
