'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/candidate-publication.yml');
const IMAGE_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const MAIN_REF = 'refs/heads/main';
const ACTOR = 'Botond1';
const REPOSITORY = 'Botond1/3D-Printer-Slicer-API';
const REGISTRY = 'ghcr.io/botond1/3d-printer-slicer-api';
const PUBLISH_CONFIRMATION = 'PUBLISH_SIGNED_MAIN_CANDIDATE';
const RECOVERY_CONFIRMATION = 'RECOVER_SIGNED_MAIN_CANDIDATE';

function read(target) {
    return fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
}

const ORIGINAL = read(WORKFLOW_PATH);
const IMAGE_WORKFLOW = read(IMAGE_WORKFLOW_PATH);

function occurrences(source, value) {
    return source.split(value).length - 1;
}

function between(source, start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, 'missing bounded block: ' + start);
    return source.slice(startIndex, endIndex);
}

function validateTriggerContract(source) {
    const errors = [];
    const require = (condition, code) => {
        if (!condition) errors.push(code);
    };
    const triggerBlock = source.match(/^on:\n([\s\S]*?)^\npermissions:/m)?.[1] || '';
    const preflightBlock = source.match(/^  preflight:\n[\s\S]*?^  publication:/m)?.[0] || '';
    const recoveryBlock = between(
        source,
        '          if [ "$PUBLICATION_MODE" = "recover_exact_digest" ]; then',
        '          [ "$PUBLICATION_MODE" = "publish_new" ]'
    );

    require(triggerBlock.includes('  workflow_dispatch:\n'), 'manual_trigger_missing');
    require(!/\bpush:|\bpull_request:|\bschedule:|\brelease:|\brepository_dispatch:/.test(triggerBlock),
        'unexpected_trigger');
    require(occurrences(triggerBlock, '  workflow_dispatch:\n') === 1,
        'manual_trigger_count_mismatch');
    require(triggerBlock.includes('publication_mode:\n')
        && triggerBlock.includes('default: publish_new')
        && triggerBlock.includes('type: choice')
        && triggerBlock.includes(
            '        options:\n          - publish_new\n          - recover_exact_digest\n'
        )
        && occurrences(triggerBlock, '          - ') === 2,
    'mode_input_contract_missing');
    require(triggerBlock.includes('existing_registry_digest:\n')
        && triggerBlock.includes("default: ''"), 'recovery_digest_input_missing');

    require(source.includes('EVENT_NAME: ${{ github.event_name }}'), 'event_name_not_bound');
    require(source.includes('EVENT_ACTOR: ${{ github.actor }}'), 'event_actor_not_bound');
    require(source.includes('EVENT_SHA: ${{ github.sha }}'), 'event_sha_not_bound');
    require(source.includes('exact_ref="' + MAIN_REF + '"'), 'exact_main_ref_missing');
    require(source.includes('exact_repository="' + REPOSITORY + '"'), 'exact_repository_missing');
    require(source.includes('exact_registry_repository="' + REGISTRY + '"'), 'exact_registry_missing');
    require(source.includes('[ "$EVENT_NAME" != "workflow_dispatch" ]')
        && source.includes('[ "$EVENT_ACTOR" != "' + ACTOR + '" ]')
        && source.includes('[ "$EVENT_REPOSITORY" != "$exact_repository" ]')
        && source.includes('[ "$EVENT_REF" != "$exact_ref" ]'),
    'exact_manual_identity_guard_missing');
    require(source.includes('publish_confirmation="' + PUBLISH_CONFIRMATION + '"')
        && source.includes('recovery_confirmation="' + RECOVERY_CONFIRMATION + '"'),
    'mode_confirmation_contract_missing');
    require(source.includes('case "$publication_mode" in')
        && source.includes('[[ "$existing_registry_digest" =~ ^sha256:[0-9a-f]{64}$ ]]')
        && source.includes('[ -z "$existing_registry_digest" ]'),
    'mode_digest_cross_product_missing');
    require(source.includes('[ "$candidate_sha" != "$EVENT_SHA" ]')
        && source.includes('refs/heads/main | awk')
        && source.includes('[ "$remote_sha" = "$CANDIDATE_SHA" ]')
        && source.includes('git merge-base --is-ancestor'),
    'main_sha_ancestry_guard_missing');
    require(source.includes('group: main-candidate-publication\n')
        && !source.includes('group: main-candidate-publication-${{ github.sha }}'),
    'global_concurrency_missing');
    require(source.includes('    environment:\n      name: candidate-publication\n      deployment: false'),
        'no_deployment_environment_contract_missing');

    require(recoveryBlock.includes('[ "$TAG_STATE" = "matching_existing" ]')
        && recoveryBlock.includes('[ "$registry_digest" = "$EXISTING_REGISTRY_DIGEST" ]')
        && recoveryBlock.includes('[ "$remote_config_digest" = "$EXPECTED_LOCAL_IMAGE_ID" ]')
        && recoveryBlock.includes('registry_operation=recovered_existing'),
    'recovery_identity_contract_missing');
    require(!/docker\s+(?:push|tag)|imagetools\s+create|\b(?:DELETE|PUT)\b/.test(recoveryBlock),
        'recovery_remote_mutation_present');
    require(source.includes('[ "$TAG_STATE" = "absent" ]')
        && source.includes('docker push "$TAG_REF"')
        && source.includes('registry_operation=published_new'),
    'new_publication_contract_missing');
    require(source.includes('mode: process.env.PUBLICATION_MODE')
        && source.includes('existing_exact_digest_verified: recovering')
        && source.includes('candidate_manifest_write_performed: !recovering'),
    'mode_evidence_contract_missing');
    require(source.includes('BLOCKED_I11_RECOVERY_IDENTITY')
        && source.includes('[ "$REGISTRY_OPERATION" != "recovered_existing" ]'),
    'recovery_final_aggregation_missing');

    require(!/contains\s*\(|$\{[^}\n]*:-/.test(preflightBlock),
        'fallback_or_substring_authorization');
    require(source.includes('    permissions:\n      contents: read\n    outputs:')
        && source.includes('      packages: write\n      attestations: write\n      id-token: write'),
    'permission_matrix_mismatch');
    require(!/packages:\s*write|attestations:\s*write|id-token:\s*write/.test(IMAGE_WORKFLOW),
        'normal_image_validation_has_write_permission');
    return errors;
}

function replaceRequired(source, from, to) {
    assert.ok(source.includes(from), 'missing mutation seam: ' + from);
    return source.replace(from, to);
}

test('I11 main publication accepts only exact manual publish or exact-digest recovery', () => {
    assert.deepEqual(validateTriggerContract(ORIGINAL), []);
});

test('I11 main publication authorization and recovery weakening mutations fail closed', async (t) => {
    const mutations = [
        ['push trigger', (s) => replaceRequired(s, '  workflow_dispatch:\n', '  push:\n')],
        ['different actor', (s) => replaceRequired(s, '[ "$EVENT_ACTOR" != "' + ACTOR + '" ]',
            '[ "$EVENT_ACTOR" != "OtherActor" ]')],
        ['actor guard removed', (s) => replaceRequired(s, '[ "$EVENT_ACTOR" != "' + ACTOR + '" ]',
            '[ "$EVENT_ACTOR" != "$EVENT_ACTOR" ]')],
        ['different main ref', (s) => replaceRequired(s, 'exact_ref="' + MAIN_REF + '"',
            'exact_ref="refs/heads/other"')],
        ['different confirmation', (s) => replaceRequired(s,
            'publish_confirmation="' + PUBLISH_CONFIRMATION + '"', 'publish_confirmation="PUBLISH"')],
        ['recovery confirmation collapsed', (s) => replaceRequired(s,
            'recovery_confirmation="' + RECOVERY_CONFIRMATION + '"',
            'recovery_confirmation="' + PUBLISH_CONFIRMATION + '"')],
        ['digest regex weakened', (s) => replaceRequired(s,
            '^sha256:[0-9a-f]{64}$', '^sha256:.+$')],
        ['fresh digest emptiness removed', (s) => replaceRequired(s,
            '[ -z "$existing_registry_digest" ]', 'true')],
        ['third mode', (s) => replaceRequired(s,
            '          - recover_exact_digest', '          - recover_exact_digest\n          - overwrite')],
        ['candidate event SHA guard removed', (s) => replaceRequired(s,
            '[ "$candidate_sha" != "$EVENT_SHA" ]', '[ "$candidate_sha" != "$candidate_sha" ]')],
        ['remote main guard removed', (s) => replaceRequired(s,
            '[ "$remote_sha" = "$CANDIDATE_SHA" ]', 'true')],
        ['concurrency becomes SHA scoped', (s) => replaceRequired(s,
            'group: main-candidate-publication', 'group: main-candidate-publication-${{ github.sha }}')],
        ['deployment suppression removed', (s) => replaceRequired(s,
            '      deployment: false\n', '')],
        ['recovery exact digest equality removed', (s) => replaceRequired(s,
            '[ "$registry_digest" = "$EXISTING_REGISTRY_DIGEST" ]',
            '[ "$registry_digest" = "$registry_digest" ]')],
        ['recovery config equality removed', (s) => replaceRequired(s,
            '[ "$remote_config_digest" = "$EXPECTED_LOCAL_IMAGE_ID" ]',
            '[ "$remote_config_digest" = "$remote_config_digest" ]')],
        ['recovery remote push', (s) => replaceRequired(s,
            '            remote_raw="$RUNNER_TEMP/i8-recovery-manifest-',
            '            docker push "$TAG_REF"\n            remote_raw="$RUNNER_TEMP/i8-recovery-manifest-')],
        ['recovery operation mislabeled', (s) => replaceRequired(s,
            'registry_operation=recovered_existing', 'registry_operation=published_new')],
        ['mode evidence removed', (s) => replaceRequired(s,
            'mode: process.env.PUBLICATION_MODE', "mode: 'publish_new'")],
        ['recovery final classification removed', (s) => replaceRequired(s,
            'BLOCKED_I11_RECOVERY_IDENTITY', 'I11_PUBLICATION_INFRASTRUCTURE_FAILURE')]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        assert.notDeepEqual(validateTriggerContract(mutate(ORIGINAL)), []);
    });
});
