'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/candidate-publication.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');

const INPUTS = Object.freeze([
    ['PREPUBLICATION_OUTCOME', 'steps.exact_image_gate.outcome', 'success'],
    ['REGISTRY_LOGIN_OUTCOME', 'steps.registry_login.outcome', 'success'],
    ['REGISTRY_PREFLIGHT_OUTCOME', 'steps.registry_preflight.outcome', 'success'],
    ['PUSH_OUTCOME', 'steps.registry_push.outcome', 'success'],
    ['REMOTE_PUBLISHED', 'steps.registry_push.outputs.remote_published', 'matching'],
    ['REGISTRY_IDENTITY_OUTCOME', 'steps.registry_identity.outcome', 'success'],
    ['DIGEST_PULL_OUTCOME', 'steps.digest_pull.outcome', 'success'],
    ['DIGEST_RUNTIME_IDENTITY_OUTCOME', 'steps.digest_runtime_identity.outcome', 'success'],
    ['DIGEST_ROUNDTRIP_OUTCOME', 'steps.digest_roundtrip.outcome', 'success'],
    ['PROVENANCE_OUTCOME', 'steps.provenance_attestation.outcome', 'success'],
    ['SBOM_ATTESTATION_OUTCOME', 'steps.sbom_attestation.outcome', 'success'],
    ['VERIFICATION_OUTCOME', 'steps.verify_attestations.outcome', 'success'],
    ['NEGATIVE_OUTCOME', 'steps.negative_verification.outcome', 'success'],
    ['FINAL_TAG_IDENTITY_OUTCOME', 'steps.final_tag_identity.outcome', 'success'],
    ['PUBLICATION_EVIDENCE_OUTCOME', 'steps.publication_evidence.outcome', 'success'],
    ['PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME',
        'steps.publication_evidence_boundary.outcome', 'success'],
    ['EVIDENCE_UPLOAD_OUTCOME', 'steps.evidence_upload.outcome', 'success'],
    ['PUBLICATION_CLEANUP_OUTCOME', 'steps.publication_cleanup.outcome', 'success'],
    ['EVIDENCE_CLEANUP_OUTCOME', 'steps.evidence_cleanup.outcome', 'success'],
    ['REGISTRY_DIGEST', 'steps.registry_push.outputs.registry_digest', null]
]);

function normalizedLines(value) {
    return value.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

const PARTIAL_BRANCH = Object.freeze({
    PUSH_OUTCOME: normalizedLines(`
        elif [ "$REMOTE_PUBLISHED" = "matching" ] && \\
        [ "$PUSH_OUTCOME" != "success" ]; then
        classification=I8_CANDIDATE_PUBLISHED_UNATTESTED
        failed_step=registry_push`),
    REGISTRY_IDENTITY_OUTCOME: normalizedLines(`
        elif [ "$REMOTE_PUBLISHED" = "matching" ] && \\
        [ "$REGISTRY_IDENTITY_OUTCOME" != "success" ]; then
        classification=I8_CANDIDATE_PUBLISHED_UNATTESTED
        failed_step=registry_identity`),
    DIGEST_PULL_OUTCOME: normalizedLines(`
        elif [ "$REMOTE_PUBLISHED" = "matching" ] && \\
        [ "$DIGEST_PULL_OUTCOME" != "success" ]; then
        classification=I8_CANDIDATE_PUBLISHED_UNATTESTED
        failed_step=digest_pull`),
    DIGEST_RUNTIME_IDENTITY_OUTCOME: normalizedLines(`
        elif [ "$REMOTE_PUBLISHED" = "matching" ] && \\
        [ "$DIGEST_RUNTIME_IDENTITY_OUTCOME" != "success" ]; then
        classification=I8_CANDIDATE_PUBLISHED_UNATTESTED
        failed_step=digest_runtime_identity`),
    DIGEST_ROUNDTRIP_OUTCOME: normalizedLines(`
        elif [ "$REMOTE_PUBLISHED" = "matching" ] && \\
        [ "$DIGEST_ROUNDTRIP_OUTCOME" != "success" ]; then
        classification=I8_CANDIDATE_PUBLISHED_UNATTESTED
        failed_step=digest_roundtrip`)
});

const ATTESTATION_BRANCH = normalizedLines(`
    elif [ "$REMOTE_PUBLISHED" = "matching" ] && { \\
    [ "$PROVENANCE_OUTCOME" != "success" ] || [ "$SBOM_ATTESTATION_OUTCOME" != "success" ]; }; then
    classification=I8_CANDIDATE_PUBLISHED_UNATTESTED
    if [ "$PROVENANCE_OUTCOME" != "success" ]; then
    failed_step=provenance_attestation
    else
    failed_step=sbom_attestation
    fi`);

const VERIFICATION_BRANCH = normalizedLines(`
    elif [ "$REMOTE_PUBLISHED" = "matching" ] && { \\
    [ "$VERIFICATION_OUTCOME" != "success" ] || [ "$NEGATIVE_OUTCOME" != "success" ]; }; then
    classification=I8_CANDIDATE_ATTESTATION_UNVERIFIED
    if [ "$VERIFICATION_OUTCOME" != "success" ]; then
    failed_step=verify_attestations
    else
    failed_step=negative_verification
    fi`);

const LOGIN_BRANCH = normalizedLines(`
    elif [ "$REGISTRY_LOGIN_OUTCOME" != "success" ] || \\
    [ "$REGISTRY_PREFLIGHT_OUTCOME" != "success" ]; then
    classification=BLOCKED_I8_PREPUBLICATION_GATE
    if [ "$REGISTRY_LOGIN_OUTCOME" != "success" ]; then
    failed_step=registry_login
    else
    failed_step=registry_preflight
    fi`);

const GENERIC_FAILURE_BRANCH = normalizedLines(`
    elif [ "$REMOTE_PUBLISHED" != "matching" ] || [ "$PUSH_OUTCOME" != "success" ] || \\
    [ "$REGISTRY_IDENTITY_OUTCOME" != "success" ] || \\
    [ "$DIGEST_PULL_OUTCOME" != "success" ] || \\
    [ "$DIGEST_RUNTIME_IDENTITY_OUTCOME" != "success" ] || \\
    [ "$DIGEST_ROUNDTRIP_OUTCOME" != "success" ] || \\
    [ "$PUBLICATION_EVIDENCE_OUTCOME" != "success" ] || \\
    [ "$FINAL_TAG_IDENTITY_OUTCOME" != "success" ] || \\
    [ "$PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME" != "success" ] || \\
    [ "$EVIDENCE_UPLOAD_OUTCOME" != "success" ] || \\
    [ "$PUBLICATION_CLEANUP_OUTCOME" != "success" ] || \\
    [ "$EVIDENCE_CLEANUP_OUTCOME" != "success" ] || \\
    [[ ! "$REGISTRY_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    classification=I8_PUBLICATION_INFRASTRUCTURE_FAILURE
    failed_step=publication_or_evidence_boundary`);

const DECISION_BLOCKS = Object.freeze({
    PREPUBLICATION_OUTCOME: normalizedLines(`
        if [ "$PREPUBLICATION_OUTCOME" != "success" ]; then
        classification=BLOCKED_I8_PREPUBLICATION_GATE
        failed_step=exact_image_gate`),
    REGISTRY_LOGIN_OUTCOME: LOGIN_BRANCH,
    REGISTRY_PREFLIGHT_OUTCOME: LOGIN_BRANCH,
    PUSH_OUTCOME: PARTIAL_BRANCH.PUSH_OUTCOME,
    REMOTE_PUBLISHED: GENERIC_FAILURE_BRANCH,
    REGISTRY_IDENTITY_OUTCOME: PARTIAL_BRANCH.REGISTRY_IDENTITY_OUTCOME,
    DIGEST_PULL_OUTCOME: PARTIAL_BRANCH.DIGEST_PULL_OUTCOME,
    DIGEST_RUNTIME_IDENTITY_OUTCOME: PARTIAL_BRANCH.DIGEST_RUNTIME_IDENTITY_OUTCOME,
    DIGEST_ROUNDTRIP_OUTCOME: PARTIAL_BRANCH.DIGEST_ROUNDTRIP_OUTCOME,
    PROVENANCE_OUTCOME: ATTESTATION_BRANCH,
    SBOM_ATTESTATION_OUTCOME: ATTESTATION_BRANCH,
    VERIFICATION_OUTCOME: VERIFICATION_BRANCH,
    NEGATIVE_OUTCOME: VERIFICATION_BRANCH,
    FINAL_TAG_IDENTITY_OUTCOME: normalizedLines(`
        elif [ "$FINAL_TAG_IDENTITY_OUTCOME" != "success" ]; then
        classification=I8_PUBLICATION_INFRASTRUCTURE_FAILURE
        failed_step=final_tag_identity`),
    PUBLICATION_EVIDENCE_OUTCOME: GENERIC_FAILURE_BRANCH,
    PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME: GENERIC_FAILURE_BRANCH,
    EVIDENCE_UPLOAD_OUTCOME: GENERIC_FAILURE_BRANCH,
    PUBLICATION_CLEANUP_OUTCOME: GENERIC_FAILURE_BRANCH,
    EVIDENCE_CLEANUP_OUTCOME: GENERIC_FAILURE_BRANCH,
    REGISTRY_DIGEST: GENERIC_FAILURE_BRANCH
});

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

function contract(source) {
    const evidence = stepBlock(source, 'publication_evidence');
    const final = stepBlock(source, 'final_enforcement');
    assert.match(evidence, /result: 'I8_CANDIDATE_EVIDENCE_READY'/);
    assert.doesNotMatch(evidence, /I8_SIGNED_CANDIDATE_COMPLETE/);
    assert.doesNotMatch(source.replace(final, ''), /I8_SIGNED_CANDIDATE_COMPLETE/);
    assert.match(final, /if: \$\{\{ always\(\) \}\}/);
    assert.match(final, /classification=I8_SIGNED_CANDIDATE_COMPLETE/);
    assert.match(final,
        /if \[ "\$classification" != "I8_SIGNED_CANDIDATE_COMPLETE" \]; then[\s\S]*exit 1/);
    assert.match(final,
        /Publication cleanup outcome:.*\$PUBLICATION_CLEANUP_OUTCOME/);
    assert.match(final,
        /Evidence cleanup outcome:.*\$EVIDENCE_CLEANUP_OUTCOME/);
    assert.match(final,
        /::error title=I8 cleanup::publication=\$PUBLICATION_CLEANUP_OUTCOME,evidence=\$EVIDENCE_CLEANUP_OUTCOME/);
    assert.ok(source.indexOf('id: evidence_upload') < source.indexOf('id: final_enforcement'));
    assert.ok(source.indexOf('id: publication_cleanup') < source.indexOf('id: final_enforcement'));
    assert.ok(source.indexOf('id: evidence_cleanup') < source.indexOf('id: final_enforcement'));
    const normalizedFinal = normalizedLines(final);
    for (const [name, expression] of INPUTS) {
        assert.match(final, new RegExp(
            `${name}: \\$\\{\\{ ${expression.replace(/\./g, '\\.')} \\}\\}`
        ), `missing exact final input ${name}`);
        assert.ok(normalizedFinal.includes(DECISION_BLOCKS[name]),
            `missing exact final decision branch ${name}`);
    }
}

test('only post-upload final enforcement may claim signed-candidate completion', () => {
    contract(WORKFLOW);
});

test('every final aggregation env binding is mutation-sensitive one by one', async (t) => {
    for (const [name, expression] of INPUTS) await t.test(name, () => {
        const anchor = `${name}: \${{ ${expression} }}`;
        const final = stepBlock(WORKFLOW, 'final_enforcement');
        assert.ok(final.includes(anchor), `missing mutation anchor ${name}`);
        const mutatedFinal = final.replace(anchor, `${name}: ignored`);
        assert.throws(() => contract(WORKFLOW.replace(final, mutatedFinal)));
    });
});

test('every final aggregation shell decision is mutation-sensitive one by one', async (t) => {
    for (const [name] of INPUTS) await t.test(name, () => {
        const final = stepBlock(WORKFLOW, 'final_enforcement');
        assert.ok(final.includes(`$${name}`), `missing decision mutation anchor ${name}`);
        const mutatedFinal = final.replaceAll(`$${name}`, `$IGNORED_${name}`);
        assert.throws(() => contract(WORKFLOW.replace(final, mutatedFinal)));
    });
});
