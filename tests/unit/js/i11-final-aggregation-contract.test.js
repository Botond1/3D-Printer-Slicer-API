'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/candidate-publication.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');

const INPUTS = Object.freeze([
    ['PREPUBLICATION_OUTCOME', 'steps.exact_image_gate.outcome'],
    ['REGISTRY_WRITE_AUTHORIZATION_OUTCOME',
        'steps.registry_write_authorization.outcome'],
    ['REGISTRY_LOGIN_OUTCOME', 'steps.registry_login.outcome'],
    ['REGISTRY_PREFLIGHT_OUTCOME', 'steps.registry_preflight.outcome'],
    ['PUSH_OUTCOME', 'steps.registry_push.outcome'],
    ['REMOTE_PUBLISHED', 'steps.registry_push.outputs.remote_published'],
    ['REGISTRY_OPERATION', 'steps.registry_push.outputs.registry_operation'],
    ['PUBLICATION_MODE', 'needs.preflight.outputs.publication_mode'],
    ['REGISTRY_IDENTITY_OUTCOME', 'steps.registry_identity.outcome'],
    ['DIGEST_PULL_OUTCOME', 'steps.digest_pull.outcome'],
    ['DIGEST_RUNTIME_IDENTITY_OUTCOME', 'steps.digest_runtime_identity.outcome'],
    ['DIGEST_ROUNDTRIP_OUTCOME', 'steps.digest_roundtrip.outcome'],
    ['PROVENANCE_OUTCOME', 'steps.provenance_attestation.outcome'],
    ['SBOM_ATTESTATION_OUTCOME', 'steps.sbom_attestation.outcome'],
    ['VERIFICATION_OUTCOME', 'steps.verify_attestations.outcome'],
    ['NEGATIVE_OUTCOME', 'steps.negative_verification.outcome'],
    ['FINAL_TAG_IDENTITY_OUTCOME', 'steps.final_tag_identity.outcome'],
    ['PUBLICATION_EVIDENCE_OUTCOME', 'steps.publication_evidence.outcome'],
    ['PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME',
        'steps.publication_evidence_boundary.outcome'],
    ['EVIDENCE_UPLOAD_OUTCOME', 'steps.evidence_upload.outcome'],
    ['PUBLICATION_CLEANUP_OUTCOME', 'steps.publication_cleanup.outcome'],
    ['EVIDENCE_CLEANUP_OUTCOME', 'steps.evidence_cleanup.outcome'],
    ['REGISTRY_DIGEST', 'steps.registry_push.outputs.registry_digest']
]);

function stepBlock(source, id) {
    const lines = source.split('\n');
    const marker = lines.findIndex((line) => line.trim() === 'id: ' + id);
    assert.notEqual(marker, -1, 'missing step ' + id);
    let start = marker;
    while (start >= 0 && !/^\s*-\s+name:/.test(lines[start])) start -= 1;
    let end = marker + 1;
    while (end < lines.length && !/^\s*-\s+name:/.test(lines[end])) end += 1;
    return lines.slice(start, end).join('\n');
}

function contract(source) {
    const evidence = stepBlock(source, 'publication_evidence');
    const final = stepBlock(source, 'final_enforcement');
    assert.match(evidence, /result: 'I11_MAIN_CANDIDATE_EVIDENCE_READY'/);
    assert.doesNotMatch(evidence, /I11_MAIN_SIGNED_CANDIDATE_COMPLETE/);
    assert.doesNotMatch(source.replace(final, ''), /I11_MAIN_SIGNED_CANDIDATE_COMPLETE/);
    assert.ok(final.includes('if: ${{ always() }}'));
    assert.match(final, /classification=I11_MAIN_SIGNED_CANDIDATE_COMPLETE/);
    assert.ok(final.includes(
        'if [ "$classification" != "I11_MAIN_SIGNED_CANDIDATE_COMPLETE" ]; then'
    ));
    assert.ok(final.includes('            exit 1'));
    assert.match(final, /classification=BLOCKED_I11_PREPUBLICATION_GATE/);
    assert.match(final, /classification=BLOCKED_I11_RECOVERY_IDENTITY/);
    assert.match(final, /classification=I11_CANDIDATE_PUBLISHED_UNATTESTED/);
    assert.match(final, /classification=I11_CANDIDATE_ATTESTATION_UNVERIFIED/);
    assert.match(final, /classification=I11_PUBLICATION_INFRASTRUCTURE_FAILURE/);
    assert.ok(final.includes('[ "$REGISTRY_OPERATION" != "recovered_existing" ]'));
    assert.ok(final.includes('[ "$REGISTRY_OPERATION" != "published_new" ]'));
    assert.ok(final.includes('Publication cleanup outcome:'));
    assert.ok(final.includes('$PUBLICATION_CLEANUP_OUTCOME'));
    assert.ok(final.includes('Evidence cleanup outcome:'));
    assert.ok(final.includes('$EVIDENCE_CLEANUP_OUTCOME'));
    assert.ok(final.includes(
        '::error title=I11 cleanup::publication=$PUBLICATION_CLEANUP_OUTCOME,'
            + 'evidence=$EVIDENCE_CLEANUP_OUTCOME'
    ));
    assert.ok(source.indexOf('id: evidence_upload') < source.indexOf('id: final_enforcement'));
    assert.ok(source.indexOf('id: publication_cleanup') < source.indexOf('id: final_enforcement'));
    assert.ok(source.indexOf('id: evidence_cleanup') < source.indexOf('id: final_enforcement'));
    for (const [name, expression] of INPUTS) {
        assert.ok(final.includes(name + ': ${{ ' + expression + ' }}'),
            'missing exact final input ' + name);
        assert.ok(final.includes('$' + name), 'missing final decision use ' + name);
    }
}

test('only post-upload final enforcement may claim I11 completion', () => {
    contract(WORKFLOW);
});

test('every final aggregation env binding is mutation-sensitive one by one', async (t) => {
    for (const [name, expression] of INPUTS) await t.test(name, () => {
        const anchor = name + ': ${{ ' + expression + ' }}';
        const final = stepBlock(WORKFLOW, 'final_enforcement');
        assert.ok(final.includes(anchor), 'missing mutation anchor ' + name);
        const mutatedFinal = final.replace(anchor, name + ': ignored');
        assert.throws(() => contract(WORKFLOW.replace(final, mutatedFinal)));
    });
});

test('every final aggregation shell decision is mutation-sensitive one by one', async (t) => {
    for (const [name] of INPUTS) await t.test(name, () => {
        const final = stepBlock(WORKFLOW, 'final_enforcement');
        assert.ok(final.includes('$' + name), 'missing decision mutation anchor ' + name);
        const mutatedFinal = final.replaceAll('$' + name, '$IGNORED_' + name);
        assert.throws(() => contract(WORKFLOW.replace(final, mutatedFinal)));
    });
});
