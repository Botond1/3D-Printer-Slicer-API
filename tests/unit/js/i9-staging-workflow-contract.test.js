'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/staging-rollback-rehearsal.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');

const PUBLICATION_WORKFLOW = 'Candidate Publication - Signed GHCR (NO DEPLOY)';
const PUBLICATION_PATH = '.github/workflows/candidate-publication.yml';
const REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const COMPLETION = 'SIGNED_MAIN_CANDIDATE_EPHEMERAL_REHEARSAL_COMPLETE';

function occurrences(source, fragment) {
    return source.split(fragment).length - 1;
}

function stepBlock(source, id) {
    const lines = source.split('\n');
    const marker = lines.findIndex((line) => line.trim() === `id: ${id}`);
    assert.notEqual(marker, -1, `missing step ${id}`);
    let start = marker;
    while (start >= 0 && !/^\s*-\s+name:/.test(lines[start])) start -= 1;
    assert.notEqual(start, -1, `missing step start ${id}`);
    let end = marker + 1;
    while (end < lines.length && !/^\s*-\s+name:/.test(lines[end])) end += 1;
    return lines.slice(start, end).join('\n');
}

function requireFragments(source, fragments, label) {
    for (const fragment of fragments) {
        assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
    }
}

function validateWorkflowSource(source) {
    assert.equal(typeof source, 'string');
    assert.ok(Buffer.byteLength(source, 'utf8') < 128 * 1024, 'workflow must remain bounded');
    assert.doesNotMatch(source, /\t|\r/, 'workflow must use LF and spaces');
    assert.match(source,
        /^name: Signed Main Candidate Ephemeral Rehearsal \(NO DEPLOY\)$/m);
    assert.match(source,
        /^on:\n  workflow_run:\n    workflows:\n      - Candidate Publication - Signed GHCR \(NO DEPLOY\)\n    types:\n      - completed\n    branches:\n      - main$/m);
    assert.doesNotMatch(source, /^  (?:push|pull_request|workflow_dispatch|schedule|release):/m);
    assert.match(source, /^permissions: \{\}$/m);
    assert.match(source,
        /^concurrency:\n  group: signed-main-candidate-ephemeral-rehearsal\n  cancel-in-progress: false$/m);
    assert.doesNotMatch(source, /group:.*\$\{\{/,
        'rehearsal concurrency must serialize all candidate rehearsals');

    const preflight = source.slice(source.indexOf('  preflight:'),
        source.indexOf('  staging-rollback-rehearsal:'));
    const rehearsal = source.slice(source.indexOf('  staging-rollback-rehearsal:'));
    assert.match(preflight, /permissions:\n      contents: read\n      actions: read/);
    assert.doesNotMatch(preflight, /packages:|attestations:|id-token:|contents: write|actions: write/);
    assert.match(rehearsal,
        /permissions:\n      contents: read\n      actions: read\n      packages: read\n      attestations: read/);
    assert.doesNotMatch(rehearsal,
        /(?:contents|actions|packages|attestations): write|id-token: write/);

    for (const action of [
        'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8',
        'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
        'docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd',
        'docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7',
        'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'
    ]) assert.ok(source.includes(action), `missing pinned action ${action}`);
    assert.equal(occurrences(source, 'persist-credentials: false'), 2);
    assert.doesNotMatch(source, /^\s+install:/m,
        'setup-buildx must not receive an unsupported install input');

    const upstream = stepBlock(source, 'upstream');
    requireFragments(upstream, [
        'EVENT_NAME: ${{ github.event_name }}',
        'UPSTREAM_NAME: ${{ github.event.workflow_run.name }}',
        'UPSTREAM_PATH: ${{ github.event.workflow_run.path }}',
        'UPSTREAM_EVENT: ${{ github.event.workflow_run.event }}',
        'UPSTREAM_CONCLUSION: ${{ github.event.workflow_run.conclusion }}',
        'UPSTREAM_BRANCH: ${{ github.event.workflow_run.head_branch }}',
        'UPSTREAM_SHA: ${{ github.event.workflow_run.head_sha }}',
        'UPSTREAM_REPOSITORY: ${{ github.event.workflow_run.head_repository.full_name }}',
        'UPSTREAM_RUN_ID: ${{ github.event.workflow_run.id }}',
        'UPSTREAM_RUN_ATTEMPT: ${{ github.event.workflow_run.run_attempt }}',
        'UPSTREAM_WORKFLOW_ID: ${{ github.event.workflow_run.workflow_id }}',
        '[ "$EVENT_NAME" != "workflow_run" ]',
        `[ "$UPSTREAM_NAME" != "${PUBLICATION_WORKFLOW}" ]`,
        `[ "$UPSTREAM_PATH" != "${PUBLICATION_PATH}" ]`,
        '[ "$UPSTREAM_EVENT" != "workflow_dispatch" ]',
        '[ "$UPSTREAM_CONCLUSION" != "success" ]',
        '[ "$UPSTREAM_BRANCH" != "main" ]',
        '[ "$UPSTREAM_REPOSITORY" != "$EVENT_REPOSITORY" ]',
        '[[ ! "$UPSTREAM_SHA" =~ ^[0-9a-f]{40}$ ]]',
        '[[ ! "$UPSTREAM_RUN_ID" =~ ^[1-9][0-9]*$ ]]'
    ], 'workflow_run authorization');

    requireFragments(preflight, [
        'ref: ${{ steps.upstream.outputs.candidate_sha }}',
        'fetch-depth: 0',
        'git fetch --no-tags --depth=1 origin refs/heads/main',
        'git merge-base --is-ancestor "$CANDIDATE_SHA" "$main_sha"',
        'gh api "repos/$GITHUB_REPOSITORY/actions/runs/$PUBLICATION_RUN_ID"',
        '(.workflow_id | tostring) == $workflow',
        `.name == "${PUBLICATION_WORKFLOW}"`,
        `.path == "${PUBLICATION_PATH}"`,
        '.event == "workflow_dispatch" and .conclusion == "success"',
        '.head_branch == "main" and .head_sha == $sha'
    ], 'upstream API reproof');
    assert.equal(occurrences(source,
        'git merge-base --is-ancestor "$CANDIDATE_SHA" "$main_sha"'), 2,
    'both preflight and rehearsal jobs must independently re-prove candidate ancestry');

    const artifact = stepBlock(source, 'artifact');
    requireFragments(artifact, [
        'actions/runs/$PUBLICATION_RUN_ID/artifacts?per_page=100',
        'expected_name="i11-main-signed-candidate-$CANDIDATE_SHA-$PUBLICATION_RUN_ID-$PUBLICATION_RUN_ATTEMPT"',
        '.total_count == 1 and (.artifacts | length) == 1',
        '.artifacts[0].name == $name and .artifacts[0].expired == false',
        '.artifacts[0].size_in_bytes > 0 and .artifacts[0].size_in_bytes <= 136314880',
        'test("^sha256:[0-9a-f]{64}$")',
        'publication_artifact_digest=$artifact_digest'
    ], 'publication artifact discovery');
    const preflightCleanup = stepBlock(source, 'preflight_cleanup');
    requireFragments(preflightCleanup, [
        'if: ${{ always() }}',
        'publication-run-$PUBLICATION_RUN_ID.json',
        'publication-artifacts-$PUBLICATION_RUN_ID.json',
        '[ "$(dirname "$(realpath "$target")")" = "$RUNNER_TEMP" ]',
        'rm -- "$target"'
    ], 'preflight cleanup');

    const publicationArtifact = stepBlock(source, 'publication_artifact');
    requireFragments(publicationArtifact, [
        'actions/artifacts/$PUBLICATION_ARTIFACT_ID/zip',
        'archive_size="$(stat -c \'%s\' "$archive")"',
        '[ "$archive_size" -gt 0 ] && [ "$archive_size" -le 136314880 ]',
        'archive_digest="sha256:$(sha256sum "$archive"',
        '[ "$archive_digest" = "$PUBLICATION_ARTIFACT_DIGEST" ]',
        "'i11-main-candidate-provenance.json': 96 * 1024",
        "'sbom.spdx.json': 16 * 1024 * 1024",
        "'grype.json': 100 * 1024 * 1024",
        'len(names) != len(set(names)) or sorted(names) != sorted(limits)',
        "pure.is_absolute() or '..' in pure.parts",
        'mode == stat.S_IFLNK',
        'info.flag_bits & 0x1',
        "target.open('xb')",
        'actual.st_size != info.file_size or target.resolve() != target'
    ], 'bounded artifact extraction');

    const rehearsalInput = stepBlock(source, 'rehearsal_input');
    requireFragments(rehearsalInput, [
        'node scripts/release-rehearsal-input.js',
        "require('./scripts/staging-rehearsal-manifest')",
        'loadStagingRehearsalManifest',
        'CURRENT_REGISTRY_DIGEST: manifest.candidate.digest',
        'CURRENT_CONFIG_DIGEST: manifest.candidate.config_digest',
        'CURRENT_IMAGE_REF: `${manifest.repository}@${manifest.candidate.digest}`',
        'CANDIDATE_SOURCE_REF: manifest.candidate.attestation.source_ref',
        'CANDIDATE_SIGNER_WORKFLOW: manifest.candidate.attestation.signer_workflow',
        'PREVIOUS_REGISTRY_DIGEST: manifest.previous.digest',
        'PREVIOUS_CONFIG_DIGEST: manifest.previous.config_digest',
        'PREVIOUS_IMAGE_REF: `${manifest.repository}@${manifest.previous.digest}`',
        'PREVIOUS_SOURCE_REF: manifest.previous.attestation.source_ref',
        'PREVIOUS_SIGNER_WORKFLOW: manifest.previous.attestation.signer_workflow'
    ], 'digest-only rehearsal input');
    assert.doesNotMatch(rehearsalInput, /:latest|discovery_tag|candidate_tag/);
    assert.doesNotMatch(source, /^\s+(?:CURRENT|PREVIOUS)_REGISTRY_DIGEST:\s+sha256:/m,
        'candidate digests must come from the verified artifact and policy, not workflow constants');

    const identity = stepBlock(source, 'registry_identity');
    requireFragments(identity, [
        'inspect_candidate candidate', 'inspect_candidate previous',
        'local digest_ref="$REGISTRY_REPOSITORY@$expected_digest"',
        'docker buildx imagetools inspect "$digest_ref" --raw > "$digest_raw"',
        "docker buildx imagetools inspect \"$digest_ref\" --format '{{json .}}'",
        'digest_hash="sha256:$(sha256sum "$digest_raw"',
        '[ "$digest_hash" = "$expected_digest" ]',
        'raw?.config?.digest !== process.env.EXPECTED_CONFIG',
        'summary?.manifest?.digest !== process.env.EXPECTED_DIGEST',
        "image?.os !== 'linux' || image?.architecture !== 'amd64'",
        "image?.config?.User !== 'slicer'",
        "image?.config?.Labels?.['org.opencontainers.image.revision']",
        "image?.config?.Labels?.['org.opencontainers.image.source']"
    ], 'digest-only registry identity');
    assert.doesNotMatch(identity, /tag_ref|:latest|imagetools inspect "\$REGISTRY_REPOSITORY:/,
        'registry identity must never resolve a mutable tag');

    const verification = stepBlock(source, 'attestation_verification');
    requireFragments(verification, [
        'verify_candidate candidate "$CURRENT_SOURCE_SHA" "$CANDIDATE_SOURCE_REF"',
        '"$CANDIDATE_SIGNER_WORKFLOW" "$CURRENT_REGISTRY_DIGEST"',
        'verify_candidate previous "$PREVIOUS_SOURCE_SHA" "$PREVIOUS_SOURCE_REF"',
        '"$PREVIOUS_SIGNER_WORKFLOW" "$PREVIOUS_REGISTRY_DIGEST"',
        'local cert_identity="https://github.com/$GITHUB_REPOSITORY/$signer_workflow@$source_ref"',
        'https://slsa.dev/provenance/v1', 'https://spdx.dev/Document/v2.3',
        '--bundle-from-oci', '--cert-identity "$cert_identity"',
        '--signer-digest "$source_sha"', '--source-ref "$source_ref"',
        '--source-digest "$source_sha"',
        '--cert-oidc-issuer "https://token.actions.githubusercontent.com"',
        'const MAX_VERIFICATION_RESULT_BYTES = 32 * 1024 * 1024;',
        "for (const mode of ['api', 'oci'])",
        'subject?.name === process.env.REGISTRY_REPOSITORY',
        'subject?.digest?.sha256 === candidate.digest.slice(7)',
        'certificate?.buildSignerDigest === candidate.source',
        'certificate?.sourceRepositoryRef === candidate.sourceRef',
        'certificate?.sourceRepositoryDigest === candidate.source'
    ], 'per-image provenance and SPDX verification');
    assert.equal(occurrences(verification, 'gh attestation verify "oci://$digest_ref"'), 2,
        'API and OCI verifier invocations must both remain in the per-image verifier');
    assert.equal(occurrences(verification, 'https://slsa.dev/provenance/v1'), 2,
        'both verifier execution and result validation must bind SLSA provenance');
    assert.equal(occurrences(verification, 'https://spdx.dev/Document/v2.3'), 2,
        'both verifier execution and result validation must bind SPDX');
    assert.ok(verification.includes('stat.size > MAX_VERIFICATION_RESULT_BYTES'),
        'every verifier result must enforce the declared size cap');
    assert.doesNotMatch(verification, /512 \* 1024/,
        'signed SPDX verification output exceeds the historical cap');

    const verificationCleanup = stepBlock(source, 'verification_cleanup');
    requireFragments(verificationCleanup, [
        'if: ${{ always() }}',
        "allowed='^(candidate|previous)-(digest-raw|digest-summary|provenance-api|provenance-oci|sbom-api|sbom-oci)\\.json$'",
        'find "$verification_dir" -mindepth 1 -maxdepth 1 -print0',
        'rmdir -- "$verification_dir"'
    ], 'verification cleanup');

    const runtimeImages = stepBlock(source, 'runtime_images');
    requireFragments(runtimeImages, [
        'docker pull "$PREVIOUS_IMAGE_REF"', 'docker pull "$CURRENT_IMAGE_REF"',
        "record=\"$(docker image inspect --format '{{.Id}}|{{json .Config.User}}' \"$image_ref\")\"",
        '[ "$record" = "$expected_config|\\\"slicer\\\"" ]',
        '--pull never', '--network none', '--read-only', '--cap-drop ALL',
        '--security-opt no-new-privileges', '--entrypoint /usr/bin/id',
        '[[ "$uid" =~ ^[1-9][0-9]*$ ]]',
        '[ "$previous_identity" = "$candidate_identity" ]',
        '[ "$service_uid" != "0" ] && [ "$service_gid" != "0" ]'
    ], 'runtime image identity');
    assert.equal(occurrences(runtimeImages, '--network none --read-only --cap-drop ALL'), 2,
        'both numeric identity probes must remain network-isolated');
    assert.doesNotMatch(runtimeImages, /:latest/);

    const runtimeSetup = stepBlock(source, 'runtime_setup');
    requireFragments(runtimeSetup, [
        'stage_root="$RUNNER_TEMP/i9-stage-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"',
        'sudo --non-interactive install -d -o "$SLICER_UID" -g "$SLICER_GID"',
        '-m 0700 -- "$stage_root/$name"',
        'openssl rand -hex 32', 'SLICE_SERVICE_API_KEY=%s',
        'OPERATIONS_API_KEY=%s', 'I9_STAGE_ROOT=$stage_root',
        'SLICER_PRICING_STATE_DIR=$stage_root/pricing-state'
    ], 'run-owned runtime setup');
    assert.equal(occurrences(runtimeSetup, 'openssl rand -hex 32'), 4);

    const runtimeCleanup = stepBlock(source, 'runtime_post_cleanup');
    requireFragments(runtimeCleanup, [
        'if: ${{ always() }}',
        'io.s3b.rehearsal', 'io.s3b.run-id', 'com.docker.compose.project',
        '[ "$run_label" = "$GITHUB_RUN_ID" ]',
        'docker container rm --force "$container_id"',
        '[ "$network_project" != "i9-s3b-rehearsal" ]',
        '[ "$network_role" != "slicer-api-private" ]',
        'docker network rm "$network_id"',
        'for image_ref in "$CURRENT_IMAGE_REF" "$PREVIOUS_IMAGE_REF"',
        'docker image rm "$image_ref"',
        'rm --recursive --force --one-file-system -- "$stage_root"'
    ], 'exact runtime cleanup');
    assert.doesNotMatch(runtimeCleanup, /docker container rm --force "\$reference"/);

    requireFragments(source, [
        'node scripts/i9-staging-rollback-rehearsal.js',
        'node scripts/write-staging-rehearsal-evidence.js',
        "require('./scripts/staging-rehearsal-evidence')",
        'validateStagingRehearsalEvidence(value, {',
        'publication_run_id: manifest.artifact.publication_run_id',
        'publication_artifact_digest: manifest.artifact.artifact_digest',
        'candidate_registry_digest: manifest.candidate.digest',
        'previous_registry_digest: manifest.previous.digest',
        'path: ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/signed-main-candidate-staging-rollback-evidence.json',
        'if-no-files-found: error', 'overwrite: false', 'include-hidden-files: false'
    ], 'artifact-bound rehearsal evidence');
    const evidenceCleanup = stepBlock(source, 'evidence_cleanup');
    requireFragments(evidenceCleanup, [
        'if: ${{ always() }}',
        'remove_allowlisted_dir "$RUNNER_TEMP/$EVIDENCE_SUBDIR" "$evidence_allowed"',
        'remove_allowlisted_dir "$RUNNER_TEMP/$REHEARSAL_INPUT_SUBDIR" "$input_allowed"',
        'remove_allowlisted_dir "$RUNNER_TEMP/$PUBLICATION_ARTIFACT_SUBDIR" "$artifact_allowed"',
        "artifact_allowed='^(i11-main-candidate-provenance\\.json|image-identity\\.txt|runtime-diagnostics\\.json|topology-evidence\\.json|sbom\\.spdx\\.json|grype\\.json)$'"
    ], 'bounded input and evidence cleanup');

    for (const forbidden of [
        /\bdocker\s+push\b/, /\bdocker\s+build\b/, /\bactions\/attest@/,
        /\bssh\b/, /\bscp\b/, /\brsync\b/, /\bgh\s+release\b/,
        /\bkubectl\b/, /\bhostinger\b/i, /\bVPS_HOST\b/,
        /environment:\s*(?:production|staging)/, /docker\s+(?:system|image|container|network)\s+prune/
    ]) assert.doesNotMatch(source, forbidden, `forbidden deploy/write surface: ${forbidden}`);

    const final = stepBlock(source, 'final_enforcement');
    requireFragments(final, [
        'if: ${{ always() }}',
        `classification=${COMPLETION}`,
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_CLEANUP_FAILURE',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_ARTIFACT',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL_INPUT',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_REGISTRY_READ',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_ATTESTATION',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_RUNTIME_IDENTITY',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_HOST_OWNERSHIP',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_ROLLBACK',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL',
        'classification=BLOCKED_SIGNED_MAIN_CANDIDATE_EVIDENCE',
        `if [ "$classification" != "${COMPLETION}" ]; then`,
        'exit 1'
    ], 'final aggregation');
    assert.equal(occurrences(source, COMPLETION), 2,
        'only final initialization and comparison may claim completion');
}

if (require.main === module) {
    test('I11 workflow consumes one successful main publication artifact without a deploy path', () => {
        validateWorkflowSource(WORKFLOW);
    });

    test('both digest-only candidates receive independent provenance and SPDX verification', () => {
        const verification = stepBlock(WORKFLOW, 'attestation_verification');
        assert.ok(verification.indexOf('verify_candidate candidate')
            < verification.indexOf('verify_candidate previous'));
        assert.ok(WORKFLOW.indexOf('id: publication_artifact')
            < WORKFLOW.indexOf('id: rehearsal_input'));
        assert.ok(WORKFLOW.indexOf('\n        id: attestation_verification\n')
            < WORKFLOW.indexOf('\n        id: rehearsal\n'));
        assert.ok(WORKFLOW.indexOf('\n        id: rehearsal\n')
            < WORKFLOW.indexOf('\n        id: evidence_write\n'));
    });
}

module.exports = Object.freeze({
    COMPLETION,
    PUBLICATION_PATH,
    PUBLICATION_WORKFLOW,
    REPOSITORY,
    WORKFLOW,
    occurrences,
    stepBlock,
    validateWorkflowSource
});
