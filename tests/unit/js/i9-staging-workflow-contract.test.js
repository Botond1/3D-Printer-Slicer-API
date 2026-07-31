'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/staging-rollback-rehearsal.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');

const BRANCH = 'codex/i9-s3b-staging-rollback-foundation';
const REF = `refs/heads/${BRANCH}`;
const TRAILER = 'I9-Rehearsal: RUN_I9_EPHEMERAL_STAGING_ROLLBACK';
const REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const CURRENT_SOURCE = '1fffab87960c675a053ae814d374cab331fbb14d';
const CURRENT_DIGEST = 'sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5';
const PREVIOUS_SOURCE = '71e3a7df1972b78a7c8cc2cc03508558186027ce';
const PREVIOUS_DIGEST = 'sha256:26df5afe5ad48062c8e1d5213b305282d9386688e1666e2ef0a56487de5e8b6c';

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

function validateWorkflowSource(source) {
    assert.equal(typeof source, 'string');
    assert.ok(Buffer.byteLength(source, 'utf8') < 128 * 1024, 'workflow must remain bounded');
    assert.doesNotMatch(source, /\t|\r/, 'workflow must use LF and spaces');
    assert.match(source,
        /^name: S3b Ephemeral Staging and Rollback Rehearsal \(NO DEPLOY\)$/m);
    assert.match(source, /^  push:\n    branches:\n      - codex\/i9-s3b-staging-rollback-foundation$/m);
    assert.doesNotMatch(source, /^  (?:schedule|pull_request|workflow_run|release):/m);
    assert.doesNotMatch(source, /^      - main$/m);
    assert.match(source, /^permissions:\n  contents: none$/m);
    assert.match(source,
        /^concurrency:\n  group: i9-s3b-ephemeral-staging-rollback\n  cancel-in-progress: false$/m);
    assert.doesNotMatch(source, /group:.*\$\{\{/, 'deployment-shaped concurrency must be global');

    for (const value of [
        `CURRENT_SOURCE_SHA: ${CURRENT_SOURCE}`,
        `CURRENT_REGISTRY_DIGEST: ${CURRENT_DIGEST}`,
        `PREVIOUS_SOURCE_SHA: ${PREVIOUS_SOURCE}`,
        `PREVIOUS_REGISTRY_DIGEST: ${PREVIOUS_DIGEST}`,
        `REGISTRY_REPOSITORY: ${REPOSITORY}`
    ]) assert.equal(occurrences(source, value), 1, `exact identity drift: ${value}`);
    assert.match(source, new RegExp(`EVENT_REF\" != \"${REF.replaceAll('/', '\\/')}\"`));
    assert.match(source, /EVENT_ACTOR\" != \"Botond1\"/);
    assert.match(source, /EVENT_REPOSITORY\" != \"Botond1\/3D-Printer-Slicer-API\"/);
    assert.match(source, new RegExp(TRAILER));
    assert.match(source, /git ls-remote --exit-code origin/);
    assert.match(source, /\[ \"\$remote_sha\" = \"\$REHEARSAL_SHA\" \]/);
    assert.match(source, /git merge-base --is-ancestor \"\$I9_BASELINE_SHA\" \"\$REHEARSAL_SHA\"/);
    assert.match(source, /git diff --quiet \"\$CURRENT_SOURCE_SHA\" \"\$REHEARSAL_SHA\" --/);
    assert.match(source, /docker-compose\.production\.yml configs Dockerfile package\.json package-lock\.json app/);

    const preflight = source.slice(source.indexOf('  preflight:'),
        source.indexOf('  staging-rollback-rehearsal:'));
    assert.match(preflight, /permissions:\n      contents: read/);
    assert.doesNotMatch(preflight, /packages:|attestations:|id-token:/);
    const rehearsal = source.slice(source.indexOf('  staging-rollback-rehearsal:'));
    assert.match(rehearsal,
        /permissions:\n      contents: read\n      packages: read\n      attestations: read/);
    assert.doesNotMatch(rehearsal, /packages: write|attestations: write|id-token: write/);

    for (const action of [
        'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8',
        'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
        'docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd',
        'docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7',
        'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'
    ]) assert.match(source, new RegExp(action.replaceAll('/', '\\/')));
    assert.equal(occurrences(source, 'persist-credentials: false'), 2);
    assert.doesNotMatch(source, /^\s+install:/m,
        'setup-buildx must not receive an unsupported install input');

    const identity = stepBlock(source, 'registry_identity');
    for (const fragment of [
        'inspect_candidate current', 'inspect_candidate previous',
        'docker buildx imagetools inspect "$tag_ref" --raw',
        'docker buildx imagetools inspect "$digest_ref" --raw',
        '[ "$tag_hash" = "$expected_digest" ]',
        '[ "$digest_hash" = "$expected_digest" ]',
        'cmp -- "$tag_raw" "$digest_raw"',
        "image?.config?.User !== 'slicer'",
        "image?.config?.Labels?.['org.opencontainers.image.revision']",
        "image?.config?.Labels?.['org.opencontainers.image.source']"
    ]) assert.ok(identity.includes(fragment), `missing registry identity contract: ${fragment}`);
    const manifestContract = stepBlock(source, 'manifest_contract');
    assert.match(manifestContract, /i9-staging-manifest'\)\.loadStagingManifest\(process\.cwd\(\)\)/);

    const verification = stepBlock(source, 'attestation_verification');
    assert.match(verification, /predicate=\"https:\/\/slsa\.dev\/provenance\/v1\"/);
    assert.match(verification, /predicate=\"https:\/\/spdx\.dev\/Document\/v2\.3\"/);
    for (const fragment of [
        'verify_candidate current', 'verify_candidate previous',
        'https://slsa.dev/provenance/v1', 'https://spdx.dev/Document/v2.3',
        '--bundle-from-oci', '--cert-identity "$cert_identity"',
        '--signer-digest "$source_sha"', '--source-ref "$CANDIDATE_WORKFLOW_REF"',
        '--source-digest "$source_sha"',
        '--cert-oidc-issuer "https://token.actions.githubusercontent.com"',
        'const MAX_VERIFICATION_RESULT_BYTES = 32 * 1024 * 1024;',
        'stat.size > MAX_VERIFICATION_RESULT_BYTES',
        "for (const mode of ['api', 'oci'])",
        'subject?.name === process.env.REGISTRY_REPOSITORY',
        'subject?.digest?.sha256 === candidate.digest.slice(7)',
        'certificate?.buildSignerDigest === candidate.source',
        'certificate?.sourceRepositoryDigest === candidate.source'
    ]) assert.ok(verification.includes(fragment), `missing attestation contract: ${fragment}`);
    assert.equal(occurrences(verification, 'gh attestation verify "oci://$digest_ref"'), 2,
        'API and OCI verifier invocations must both remain');
    assert.doesNotMatch(verification, /512 \* 1024/,
        'signed SPDX verification output is known to exceed the old 512 KiB cap');

    const cleanup = stepBlock(source, 'verification_cleanup');
    assert.match(cleanup, /if: \$\{\{ always\(\) \}\}/);
    assert.match(cleanup, /find \"\$verification_dir\" -mindepth 1 -maxdepth 1 -print0/);
    assert.match(cleanup, /rmdir -- \"\$verification_dir\"/);
    assert.doesNotMatch(cleanup, /rm\s+-rf|docker\s+(?:system|image|container|network)\s+prune/);

    const runtimeImages = stepBlock(source, 'runtime_images');
    for (const fragment of [
        'docker pull "$PREVIOUS_IMAGE_REF"', 'docker pull "$CURRENT_IMAGE_REF"',
        "record=\"$(docker image inspect --format '{{.Id}}|{{json .Config.User}}' \"$image_ref\")\"",
        '--pull never', '--network none', '--read-only', '--cap-drop ALL',
        '--security-opt no-new-privileges', '--entrypoint /usr/bin/id',
        '[[ "$uid" =~ ^[1-9][0-9]*$ ]]', '[ "$previous_identity" = "$candidate_identity" ]',
        '[ "$service_uid" != "0" ]', '[ "$service_gid" != "0" ]'
    ]) assert.ok(runtimeImages.includes(fragment), `missing runtime image contract: ${fragment}`);
    assert.equal(occurrences(runtimeImages, '--network none --read-only --cap-drop ALL'), 2);
    const runtimeSetup = stepBlock(source, 'runtime_setup');
    for (const fragment of [
        'stage_root="$RUNNER_TEMP/i9-stage-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"',
        'sudo --non-interactive install -d -o "$SLICER_UID" -g "$SLICER_GID"',
        'openssl rand -hex 32', 'SLICE_SERVICE_API_KEY=%s',
        'OPERATIONS_API_KEY=%s', 'I9_STAGE_ROOT=$stage_root',
        'SLICER_PRICING_STATE_DIR=$stage_root/pricing-state'
    ]) assert.ok(runtimeSetup.includes(fragment), `missing runtime setup contract: ${fragment}`);
    assert.equal(occurrences(runtimeSetup, '-m 0700 -- "$stage_root/$name"'), 1);
    assert.equal(occurrences(runtimeSetup, 'openssl rand -hex 32'), 4);
    assert.doesNotMatch(runtimeSetup, /echo\s+"\$(?:slice|pricing|artifact|operations)_key"/);
    const runtimePostCleanup = stepBlock(source, 'runtime_post_cleanup');
    assert.match(runtimePostCleanup, /if: \$\{\{ always\(\) \}\}/);
    assert.match(runtimePostCleanup, /rm --recursive --force --one-file-system -- "\$stage_root"/);
    for (const fragment of [
        'io.s3b.rehearsal', 'io.s3b.run-id', 'com.docker.compose.project',
        'com.docker.compose.service', '[ "$run_label" = "$GITHUB_RUN_ID" ]',
        'docker container rm --force "$container_id"',
        'if record="$(docker container inspect --format',
        'if network_record="$(docker network inspect --format',
        '[ "$network_project" != "i9-s3b-rehearsal" ]',
        '[ "$network_role" != "slicer-api-private" ]',
        'docker network rm "$network_id"',
        'for image_ref in "$CURRENT_IMAGE_REF" "$PREVIOUS_IMAGE_REF"',
        'docker image rm "$image_ref"'
    ]) assert.ok(runtimePostCleanup.includes(fragment), `missing exact cleanup contract: ${fragment}`);
    assert.doesNotMatch(runtimePostCleanup, /docker container rm --force "\$reference"/);
    assert.doesNotMatch(runtimePostCleanup, /docker\s+(?:system|image|container|network)\s+prune/);

    assert.match(source, /node scripts\/i9-staging-rollback-rehearsal\.js/);
    assert.match(source, /node scripts\/i9-write-staging-evidence\.js/);
    assert.match(source, /require\('\.\/scripts\/i9-staging-evidence'\)/);
    assert.match(source, /validateStagingEvidence\(value, \{/);
    for (const key of [
        'repository', 'rehearsal_sha', 'run_id', 'run_attempt', 'job',
        'previous_source_sha', 'previous_registry_digest', 'previous_config_digest',
        'current_source_sha', 'current_registry_digest', 'current_config_digest'
    ]) assert.match(source, new RegExp(`${key}: process\\.env\\.`));
    for (const staleKey of ['source_sha', 'source_ref', 'previous_digest',
        'candidate_source_sha', 'candidate_digest']) {
        assert.doesNotMatch(source, new RegExp(`\\b${staleKey}: process\\.env\\.`));
    }
    assert.match(source,
        /path: \$\{\{ runner\.temp \}\}\/\$\{\{ env\.EVIDENCE_SUBDIR \}\}\/i9-staging-rollback-evidence\.json/);
    assert.match(source, /if-no-files-found: error/);
    assert.match(source, /overwrite: false/);
    assert.match(source, /include-hidden-files: false/);

    for (const forbidden of [
        /\bdocker\s+push\b/, /\bdocker\s+build\b/, /\bactions\/attest@/,
        /\bssh\b/, /\bscp\b/, /\brsync\b/, /\bgh\s+release\b/,
        /\bkubectl\b/, /\bhostinger\b/i, /\bVPS_HOST\b/, /\benvironment:\s*production\b/
    ]) assert.doesNotMatch(source, forbidden, `forbidden deployment surface: ${forbidden}`);

    const final = stepBlock(source, 'final_enforcement');
    assert.match(final, /if: \$\{\{ always\(\) \}\}/);
    assert.match(final,
        /ROLLBACK_CLASSIFICATION: \$\{\{ steps\.rehearsal\.outputs\.rollback_classification \}\}/);
    assert.match(final,
        /RUNTIME_CLEANUP_CLASSIFICATION: \$\{\{ steps\.rehearsal\.outputs\.cleanup_classification \}\}/);
    assert.match(final, /classification=I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE/);
    assert.match(final, /classification=BLOCKED_I9_CLEANUP_FAILURE/);
    assert.match(final, /classification=BLOCKED_I9_MANIFEST_CONTRACT/);
    assert.match(final, /classification=BLOCKED_I9_REGISTRY_READ_CAPABILITY/);
    assert.match(final, /classification=BLOCKED_I9_ATTESTATION_VERIFICATION/);
    assert.match(final, /classification=BLOCKED_I9_RUNTIME_IDENTITY_MISMATCH/);
    assert.match(final, /classification=BLOCKED_I9_HOST_OWNERSHIP_CAPABILITY/);
    assert.match(final, /classification=BLOCKED_I9_ROLLBACK_FAILURE/);
    assert.match(final, /classification=BLOCKED_I9_REHEARSAL_GATE/);
    assert.match(final, /classification=BLOCKED_I9_EVIDENCE_FAILURE/);
    assert.match(final,
        /if \[ \"\$classification\" != \"I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE\" \]; then[\s\S]*exit 1/);
    assert.equal(occurrences(source, 'I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE'), 2,
        'completion may appear only in final initialization and comparison');
}

if (require.main === module) {
    test('I9 workflow is an exact read-only hosted rehearsal with no deploy path', () => {
        validateWorkflowSource(WORKFLOW);
    });

    test('both immutable candidates receive API and OCI provenance and SBOM verification', () => {
        const verification = stepBlock(WORKFLOW, 'attestation_verification');
        assert.ok(verification.indexOf('verify_candidate current')
            < verification.indexOf('verify_candidate previous'));
        assert.ok(WORKFLOW.indexOf('id: attestation_verification')
            < WORKFLOW.indexOf('id: rehearsal'));
        assert.ok(WORKFLOW.indexOf('id: rehearsal')
            < WORKFLOW.indexOf('id: evidence_write'));
    });
}

module.exports = Object.freeze({
    BRANCH,
    CURRENT_DIGEST,
    CURRENT_SOURCE,
    PREVIOUS_DIGEST,
    PREVIOUS_SOURCE,
    REF,
    TRAILER,
    WORKFLOW,
    stepBlock,
    validateWorkflowSource
});
