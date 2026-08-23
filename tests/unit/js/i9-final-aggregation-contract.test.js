'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW = fs.readFileSync(
    path.join(ROOT, '.github/workflows/staging-rollback-rehearsal.yml'), 'utf8'
).replace(/\r\n?/g, '\n');

const COMPLETION = 'SIGNED_MAIN_CANDIDATE_EPHEMERAL_REHEARSAL_COMPLETE';
const INPUTS = Object.freeze([
    ['PUBLICATION_ARTIFACT_OUTCOME', 'steps.publication_artifact.outcome'],
    ['REHEARSAL_INPUT_OUTCOME', 'steps.rehearsal_input.outcome'],
    ['REGISTRY_LOGIN_OUTCOME', 'steps.registry_login.outcome'],
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
    assert.doesNotMatch(withoutFinal, new RegExp(COMPLETION),
        'only final enforcement may claim completion');
    assert.equal(final.split(COMPLETION).length - 1, 2);
    for (const [name, expression] of INPUTS) {
        assert.match(final, new RegExp(
            `${name}: \\$\\{\\{ ${expression.replaceAll('.', '\\.')} \\}\\}`
        ), `missing final binding ${name}`);
        assert.match(final, new RegExp(`\\$${name}\\b`), `missing final decision input ${name}`);
    }
    const normalizedFinal = normalized(final);
    for (const branch of [
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_CLEANUP_FAILURE\nfailed_step=cleanup',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_ARTIFACT\nfailed_step=publication_artifact',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL_INPUT\nfailed_step=rehearsal_input',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_REGISTRY_READ\nfailed_step=registry_identity',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_ATTESTATION\nfailed_step=attestation_verification',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_RUNTIME_IDENTITY\nfailed_step=runtime_images',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_HOST_OWNERSHIP\nfailed_step=runtime_setup',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_CLEANUP_FAILURE\nfailed_step=runtime_cleanup',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_ROLLBACK\nfailed_step=rollback',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL\nfailed_step=rehearsal',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_EVIDENCE\nfailed_step=evidence'
    ]) assert.ok(normalizedFinal.includes(branch), `missing final branch ${branch}`);
    assert.ok(final.indexOf('BLOCKED_SIGNED_MAIN_CANDIDATE_CLEANUP_FAILURE')
        < final.indexOf('BLOCKED_SIGNED_MAIN_CANDIDATE_ARTIFACT'),
    'cleanup failure must remain independently fail-closed before primary classifications');
    assert.ok(final.indexOf('BLOCKED_SIGNED_MAIN_CANDIDATE_ARTIFACT')
        < final.indexOf('BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL_INPUT')
        && final.indexOf('BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL_INPUT')
        < final.indexOf('BLOCKED_SIGNED_MAIN_CANDIDATE_REGISTRY_READ'),
    'artifact and manifest failures must precede registry/runtime classifications');
    assert.match(final, new RegExp(
        `if \\[ "\\$classification" != "${COMPLETION}" \\]; then[\\s\\S]*exit 1`
    ));
    assert.match(final, /Runtime cleanup:.*RUNTIME_CLEANUP_CLASSIFICATION/);
    assert.match(final, /Evidence cleanup:.*EVIDENCE_CLEANUP_OUTCOME/);
    assert.match(final, /hosted ephemeral Docker only; it did not deploy to a VPS or production/);
}

test('only the always-running I11 final aggregation may claim rehearsal completion', () => {
    assertFinalContract(WORKFLOW);
});

test('every I11 final aggregation binding is mutation-sensitive', async (t) => {
    const final = stepBlock(WORKFLOW, 'final_enforcement');
    for (const [name, expression] of INPUTS) await t.test(name, () => {
        const anchor = `${name}: \${{ ${expression} }}`;
        assert.equal(final.split(anchor).length - 1, 1, `missing unique binding ${name}`);
        const mutated = final.replace(anchor, `${name}: ignored`);
        assert.throws(() => assertFinalContract(WORKFLOW.replace(final, mutated)));
    });
});

test('every I11 final aggregation decision input is mutation-sensitive', async (t) => {
    const final = stepBlock(WORKFLOW, 'final_enforcement');
    for (const [name] of INPUTS) await t.test(name, () => {
        const shellAnchor = `$${name}`;
        assert.ok(final.includes(shellAnchor), `missing shell input ${name}`);
        const mutated = final.replaceAll(shellAnchor, `$IGNORED_${name}`);
        assert.throws(() => assertFinalContract(WORKFLOW.replace(final, mutated)));
    });
});

module.exports = Object.freeze({COMPLETION, INPUTS, assertFinalContract, stepBlock});
