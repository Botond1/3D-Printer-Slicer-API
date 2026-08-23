'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/candidate-publication.yml');
const IMAGE_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const BRANCH = 'codex/i8-s3a-ghcr-signed-candidate';
const REF = `refs/heads/${BRANCH}`;
const ACTOR = 'Botond1';
const REPOSITORY = 'Botond1/3D-Printer-Slicer-API';
const REGISTRY = 'ghcr.io/botond1/3d-printer-slicer-api';
const CONFIRMATION = 'PUBLISH_I8_SIGNED_GHCR_CANDIDATE';
const TRAILER = `I8-Publication: ${CONFIRMATION}`;

function read(target) {
    return fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
}

const ORIGINAL = read(WORKFLOW_PATH);
const IMAGE_WORKFLOW = read(IMAGE_WORKFLOW_PATH);

function occurrences(source, value) {
    return source.split(value).length - 1;
}

function validateTriggerContract(source) {
    const errors = [];
    const require = (condition, code) => {
        if (!condition) errors.push(code);
    };
    const triggerBlock = source.match(/^on:\n([\s\S]*?)^\npermissions:/m)?.[1] || '';
    const preflightBlock = source.match(/^  preflight:\n[\s\S]*?^  publication:/m)?.[0] || '';
    require(triggerBlock.includes('  workflow_dispatch:\n'), 'manual_trigger_missing');
    require(triggerBlock.includes(`  push:\n    branches:\n      - ${BRANCH}\n`),
        'exact_push_branch_missing');
    require(!/\bbranches-ignore:|\btags(?:-ignore)?:|\bpull_request:|\bschedule:|\brelease:|\brepository_dispatch:/.test(triggerBlock),
        'unexpected_trigger');
    require(occurrences(triggerBlock, '  push:\n') === 1, 'push_trigger_count_mismatch');

    require(source.includes('EVENT_NAME: ${{ github.event_name }}'), 'event_name_not_bound');
    require(source.includes('EVENT_ACTOR: ${{ github.actor }}'), 'event_actor_not_bound');
    require(source.includes('EVENT_SHA: ${{ github.sha }}'), 'event_sha_not_bound');
    require(source.includes(`exact_ref="${REF}"`), 'exact_ref_missing');
    require(source.includes(`exact_repository="${REPOSITORY}"`), 'exact_repository_missing');
    require(source.includes(`exact_registry_repository="${REGISTRY}"`), 'exact_registry_missing');
    require(source.includes(
        'if [ "$EVENT_REPOSITORY" != "$exact_repository" ] || [ "$EVENT_REF" != "$exact_ref" ]; then'
    ), 'repository_ref_guard_missing');
    require(source.includes('case "$EVENT_NAME" in')
        && source.includes('workflow_dispatch)') && source.includes('push)')
        && source.includes('Unsupported Candidate Publication event: $EVENT_NAME'),
    'fail_closed_event_adapter_missing');
    require(source.includes('candidate_sha="$REQUESTED_SHA"'), 'manual_sha_contract_missing');
    require(source.includes('candidate_sha="$EVENT_SHA"'), 'push_sha_contract_missing');
    require(source.includes('[ "$candidate_sha" != "$EVENT_SHA" ]'),
        'candidate_event_sha_guard_missing');
    require(source.includes(`if [ "$EVENT_ACTOR" != "${ACTOR}" ]; then`),
        'push_actor_contract_missing');
    require(source.includes(`exact_confirmation="${CONFIRMATION}"`)
        && source.includes('if [ "$REQUESTED_CONFIRMATION" != "$exact_confirmation" ]; then'),
    'manual_confirmation_contract_missing');
    require(source.includes('if [ "$registry_repository" != "$exact_registry_repository" ]; then'),
        'fixed_registry_guard_missing');
    require(source.includes(`required_trailer="${TRAILER}"`)
        && source.includes('git show -s --format=%B "$CANDIDATE_SHA"')
        && source.includes('if [ "$last_nonempty_line" != "$required_trailer" ]; then'),
    'push_trailer_contract_missing');
    require(!/contains\s*\(|\$\{[^}\n]*:-|\*"\$required_trailer"\*/.test(preflightBlock),
        'fallback_or_substring_authorization');
    require(source.includes('registry_repository: ${{ steps.candidate.outputs.registry_repository }}')
        && source.includes('REGISTRY_REPOSITORY: ${{ needs.preflight.outputs.registry_repository }}'),
    'canonical_registry_output_missing');
    require(source.includes('    permissions:\n      contents: read\n    outputs:')
        && source.includes('      packages: write\n      attestations: write\n      id-token: write'),
    'permission_matrix_mismatch');
    require(!/packages:\s*write|attestations:\s*write|id-token:\s*write/.test(IMAGE_WORKFLOW),
        'normal_image_validation_has_write_permission');
    return errors;
}

function replaceRequired(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replace(from, to);
}

test('S3a I8 publication trigger accepts only the exact manual or authorized candidate push path', () => {
    assert.deepEqual(validateTriggerContract(ORIGINAL), []);
});

test('S3a I8 publication trigger weakening mutations fail closed', async (t) => {
    const mutations = [
        ['push branch wildcard', (s) => replaceRequired(s, `      - ${BRANCH}`, "      - '**'")],
        ['different push branch', (s) => replaceRequired(s, `      - ${BRANCH}`, '      - main')],
        ['different actor', (s) => replaceRequired(s, `"${ACTOR}" ]; then`, '"OtherActor" ]; then')],
        ['actor check removed', (s) => replaceRequired(
            s, `if [ "$EVENT_ACTOR" != "${ACTOR}" ]; then`, 'if false; then')],
        ['trailer removed', (s) => replaceRequired(s, `required_trailer="${TRAILER}"`, 'required_trailer=""')],
        ['trailer substring accepted', (s) => replaceRequired(
            s,
            'if [ "$last_nonempty_line" != "$required_trailer" ]; then',
            'if [[ "$last_nonempty_line" != *"$required_trailer"* ]]; then'
        )],
        ['different confirmation', (s) => replaceRequired(
            s, `exact_confirmation="${CONFIRMATION}"`, 'exact_confirmation="PUBLISH"')],
        ['different registry', (s) => s.replaceAll(REGISTRY, 'ghcr.io/other/repository')],
        ['push uses manual SHA input', (s) => replaceRequired(
            s, 'candidate_sha="$EVENT_SHA"', 'candidate_sha="$REQUESTED_SHA"')],
        ['event adapter fallback', (s) => replaceRequired(
            s, 'candidate_sha="$EVENT_SHA"', 'candidate_sha="${REQUESTED_SHA:-$EVENT_SHA}"')],
        ['manual dispatch removed', (s) => replaceRequired(s, '  workflow_dispatch:\n', '  schedule:\n')],
        ['preflight write permission', (s) => replaceRequired(
            s,
            '    permissions:\n      contents: read\n    outputs:',
            '    permissions:\n      contents: write\n    outputs:'
        )],
        ['repository/ref guard removed', (s) => replaceRequired(
            s,
            'if [ "$EVENT_REPOSITORY" != "$exact_repository" ] || [ "$EVENT_REF" != "$exact_ref" ]; then',
            'if false; then'
        )],
        ['fixed registry guard removed', (s) => replaceRequired(
            s, 'if [ "$registry_repository" != "$exact_registry_repository" ]; then', 'if false; then')],
        ['candidate/event SHA guard removed', (s) => replaceRequired(
            s, '[ "$candidate_sha" != "$EVENT_SHA" ]', '[ "$candidate_sha" != "$candidate_sha" ]')]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        assert.notDeepEqual(validateTriggerContract(mutate(ORIGINAL)), []);
    });
});
