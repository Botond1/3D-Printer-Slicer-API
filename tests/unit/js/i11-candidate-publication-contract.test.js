'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const PATHS = Object.freeze({
    publication: '.github/workflows/candidate-publication.yml',
    image: '.github/workflows/image-validation.yml',
    gate: '.github/actions/exact-image-gate/action.yml'
});
const BASELINE_SHA = '8253160eef1c3e00c1e40826ec61fd97563ddd9b';
const BRANCH = 'main';
const GHCR_REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const GITHUB_REPOSITORY = 'Botond1/3D-Printer-Slicer-API';
const PUSH_ACTOR = 'Botond1';
const CONFIRMATION = 'PUBLISH_SIGNED_MAIN_CANDIDATE';
const RECOVERY_CONFIRMATION = 'RECOVER_SIGNED_MAIN_CANDIDATE';
const ATTEST_ACTION = 'actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6';
const LOGIN_ACTION = 'docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7';
const BUILD_ACTION = 'docker/build-push-action@d08e5c354a6adb9ed34480a06d141179aa583294';
const SHARED_GATE = './.github/actions/exact-image-gate';
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const SBOM_PREDICATE = 'https://spdx.dev/Document/v2.3';

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n?/g, '\n');
}

const ORIGINAL = Object.freeze(Object.fromEntries(
    Object.entries(PATHS).map(([name, relativePath]) => [name, read(relativePath)])
));

function count(source, pattern) {
    return [...source.matchAll(pattern)].length;
}

function lines(source) {
    return source.split('\n');
}

function indentation(line) {
    return line.match(/^ */)[0].length;
}

function mappingBlock(source, key, expectedIndent) {
    const sourceLines = lines(source);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {${expectedIndent}}${escaped}:\\s*(?:#.*)?$`);
    const indexes = sourceLines.flatMap((line, index) => match.test(line) ? [index] : []);
    assert.equal(indexes.length, 1, `expected one ${key} mapping at indent ${expectedIndent}`);
    const start = indexes[0];
    let end = sourceLines.length;
    for (let index = start + 1; index < sourceLines.length; index += 1) {
        if (sourceLines[index].trim() && indentation(sourceLines[index]) <= expectedIndent) {
            end = index;
            break;
        }
    }
    return {start, end, text: sourceLines.slice(start, end).join('\n')};
}

function directKeys(block) {
    const blockLines = lines(block.text);
    const parentIndent = indentation(blockLines[0]);
    const children = blockLines.slice(1).filter((line) => line.trim() && !line.trimStart().startsWith('#')
        && indentation(line) > parentIndent);
    if (children.length === 0) return [];
    const childIndent = Math.min(...children.map(indentation));
    return children.filter((line) => indentation(line) === childIndent)
        .map((line) => line.trim().match(/^([A-Za-z0-9_.-]+):/))
        .filter(Boolean)
        .map((match) => match[1]);
}

function stepRange(source, id) {
    const sourceLines = lines(source);
    const idPattern = new RegExp(`^\\s+id:\\s*${id}\\s*(?:#.*)?$`);
    const idIndex = sourceLines.findIndex((line) => idPattern.test(line));
    assert.notEqual(idIndex, -1, `missing step id: ${id}`);
    let start = idIndex;
    while (start >= 0 && !/^\s*-\s+(?:name|id|uses|run):/.test(sourceLines[start])) start -= 1;
    assert.ok(start >= 0, `missing step boundary: ${id}`);
    const stepIndent = indentation(sourceLines[start]);
    let end = sourceLines.length;
    for (let index = start + 1; index < sourceLines.length; index += 1) {
        if (indentation(sourceLines[index]) === stepIndent && /^\s*-\s+/.test(sourceLines[index])) {
            end = index;
            break;
        }
    }
    return {start, end, text: sourceLines.slice(start, end).join('\n')};
}

function stepText(source, id) {
    return stepRange(source, id).text;
}

function stepIdContaining(source, marker) {
    const sourceLines = lines(source);
    const markerIndex = sourceLines.findIndex((line) => line.includes(marker));
    assert.notEqual(markerIndex, -1, `missing step marker: ${marker}`);
    let start = markerIndex;
    while (start >= 0 && !/^\s*-\s+(?:name|id|uses|run):/.test(sourceLines[start])) start -= 1;
    const stepIndent = indentation(sourceLines[start]);
    let end = sourceLines.length;
    for (let index = start + 1; index < sourceLines.length; index += 1) {
        if (indentation(sourceLines[index]) === stepIndent && /^\s*-\s+/.test(sourceLines[index])) {
            end = index;
            break;
        }
    }
    const idLine = sourceLines.slice(start, end).find((line) => /^\s+id:\s*[A-Za-z0-9_-]+\s*$/.test(line));
    assert.ok(idLine, `step containing ${marker} must have an id`);
    return idLine.trim().slice(3).trim();
}

function permissions(source, indent) {
    const blocks = [];
    const sourceLines = lines(source);
    for (let index = 0; index < sourceLines.length; index += 1) {
        if (sourceLines[index] !== `${' '.repeat(indent)}permissions:`) continue;
        const entries = [];
        for (let cursor = index + 1; cursor < sourceLines.length; cursor += 1) {
            if (!sourceLines[cursor].trim()) continue;
            if (indentation(sourceLines[cursor]) <= indent) break;
            if (indentation(sourceLines[cursor]) === indent + 2) {
                const match = sourceLines[cursor].trim().match(/^([a-z-]+):\s*(read|write|none)$/);
                assert.ok(match, `unsupported permissions entry: ${sourceLines[cursor].trim()}`);
                entries.push([match[1], match[2]]);
            }
        }
        blocks.push(entries);
    }
    return blocks;
}

function requireIncludes(source, values, label) {
    for (const value of values) assert.ok(source.includes(value), `${label}: missing ${value}`);
}

function validateContract(sources) {
    const {publication, image, gate} = sources;
    assert.doesNotMatch(`${publication}\n${image}\n${gate}`, /\t|\r/, 'workflow sources use spaces/LF');

    const trigger = mappingBlock(publication, 'on', 0);
    assert.deepEqual(directKeys(trigger), ['workflow_dispatch'],
        'publication accepts only exact manual events');
    const dispatch = mappingBlock(publication, 'workflow_dispatch', 2);
    const inputs = mappingBlock(dispatch.text, 'inputs', 4);
    const inputKeys = directKeys(inputs);
    assert.deepEqual(inputKeys, [
        'candidate_sha', 'publication_mode', 'existing_registry_digest',
        'confirmation', 'registry_repository'
    ], 'only exact authorization and recovery inputs are accepted');
    for (const inputName of ['candidate_sha', 'confirmation']) {
        const input = mappingBlock(inputs.text, inputName, 6);
        requireIncludes(input.text, ['required: true', 'type: string'], `${inputName} input`);
    }
    if (inputKeys.includes('registry_repository')) {
        requireIncludes(mappingBlock(inputs.text, 'registry_repository', 6).text,
            [`default: ${GHCR_REPOSITORY}`, 'type: string'], 'fixed registry input');
    }
    requireIncludes(publication, [
        BASELINE_SHA, `refs/heads/${BRANCH}`, GHCR_REPOSITORY, GITHUB_REPOSITORY,
        CONFIRMATION, RECOVERY_CONFIRMATION, '^[0-9a-f]{40}$', 'cancel-in-progress: false',
        'group: main-candidate-publication',
        'git merge-base --is-ancestor', 'persist-credentials: false', 'fetch-depth: 0'
    ], 'preflight');
    const eventAdapter = stepText(publication, 'candidate');
    requireIncludes(eventAdapter, [
        'EVENT_NAME: ${{ github.event_name }}',
        'EVENT_ACTOR: ${{ github.actor }}',
        'EVENT_SHA: ${{ github.sha }}',
        'EVENT_REF: ${{ github.ref }}',
        'EVENT_REPOSITORY: ${{ github.repository }}',
        '[ "$EVENT_NAME" != "workflow_dispatch" ]',
        `[ "$EVENT_ACTOR" != "${PUSH_ACTOR}" ]`,
        '[ "$EVENT_REPOSITORY" != "$exact_repository" ]',
        '[ "$EVENT_REF" != "$exact_ref" ]',
        'case "$publication_mode" in',
        'publish_new)',
        'recover_exact_digest)',
        'candidate_sha="$REQUESTED_SHA"',
        'if [ "$registry_repository" != "$exact_registry_repository" ]; then',
        '[ "$candidate_sha" != "$EVENT_SHA" ]',
        'echo "registry_repository=$registry_repository"',
        'Unsupported candidate publication mode'
    ], 'event adapter');
    assert.doesNotMatch(eventAdapter, /contains\s*\(|\$\{[^}\n]*:-/,
        'event adapter must not use substring authorization or fallback defaults');
    const authorizationProof = stepText(publication, 'authorization_proof');
    requireIncludes(authorizationProof, [
        'refs/heads/main',
        '[ "$remote_sha" = "$CANDIDATE_SHA" ]',
        'git merge-base --is-ancestor'
    ], 'post-checkout authorization proof');
    const preflightJob = mappingBlock(publication, 'preflight', 2);
    assert.ok(!directKeys(preflightJob).includes('if')
        && !directKeys(preflightJob).includes('continue-on-error'),
    'preflight job must fail closed without a job-level bypass');
    assert.doesNotMatch(preflightJob.text, /^\s+continue-on-error:\s*true\s*$/m,
        'no preflight authorization step may ignore failure');
    const preflightOutputs = mappingBlock(preflightJob.text, 'outputs', 4);
    assert.deepEqual(directKeys(preflightOutputs), [
        'candidate_sha', 'image_ref', 'discovery_tag', 'registry_repository',
        'publication_mode', 'existing_registry_digest'
    ], 'canonical preflight output key set');
    requireIncludes(preflightOutputs.text, [
        'candidate_sha: ${{ steps.candidate.outputs.sha }}',
        'image_ref: ${{ steps.candidate.outputs.image_ref }}',
        'discovery_tag: ${{ steps.candidate.outputs.discovery_tag }}',
        'registry_repository: ${{ steps.candidate.outputs.registry_repository }}'
    ], 'canonical preflight output mappings');
    requireIncludes(mappingBlock(publication, 'env', 4).text, [
        'REGISTRY_REPOSITORY: ${{ needs.preflight.outputs.registry_repository }}'
    ], 'canonical publication environment');

    assert.deepEqual(directKeys(mappingBlock(publication, 'jobs', 0)), ['preflight', 'publication']);
    const publicationJob = mappingBlock(publication, 'publication', 2);
    assert.ok(directKeys(publicationJob).includes('needs')
        && publicationJob.text.includes('    needs: preflight'),
    'publication must depend on the successful preflight job');
    assert.ok(!directKeys(publicationJob).includes('if')
        && !directKeys(publicationJob).includes('continue-on-error'),
    'publication job must not bypass a failed preflight');
    assert.deepEqual(permissions(publication, 0), [[['contents', 'none']]]);
    assert.deepEqual(permissions(mappingBlock(publication, 'preflight', 2).text, 4), [
        [['contents', 'read']]
    ]);
    assert.deepEqual(permissions(mappingBlock(publication, 'publication', 2).text, 4), [[
        ['contents', 'read'], ['packages', 'write'], ['attestations', 'write'], ['id-token', 'write']
    ]]);
    const allUses = [...publication.matchAll(/^\s+uses:\s+([^#\s]+)(?:\s+#\s+(\S+))?\s*$/gm)]
        .map((match) => [match[1], match[2] || '']);
    assert.deepEqual(allUses.map(([reference]) => reference).sort(), [
        'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8',
        'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8',
        ATTEST_ACTION, ATTEST_ACTION,
        'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
        LOGIN_ACTION, SHARED_GATE
    ].sort(), 'only the exact audited action multiset is allowed');
    const externalUses = allUses.filter(([reference]) => !reference.startsWith('./'));
    for (const [reference, version] of externalUses) {
        assert.match(reference, /@[0-9a-f]{40}$/);
        const expectedVersion = reference.startsWith('actions/checkout@') ? 'v5.0.0'
            : reference.startsWith('actions/upload-artifact@') ? 'v6.0.0'
                : reference === LOGIN_ACTION ? 'v4.5.1' : 'v4.2.0';
        assert.equal(version, expectedVersion, `${reference} has exact audited version metadata`);
    }
    assert.equal(count(publication, /persist-credentials: false/g), 2,
        'both exact checkouts disable credential persistence');
    for (const entries of permissions(image, 0).concat(permissions(image, 4))) {
        assert.deepEqual(entries, [['contents', 'read']], 'normal image validation stays read-only');
    }
    assert.doesNotMatch(image, /packages:\s*write|attestations:\s*write|id-token:\s*write|docker\/login-action|actions\/attest|docker push/);
    assert.match(publication,
        /environment:\n\s+name: candidate-publication\n\s+deployment: false/);
    assert.doesNotMatch(publication, /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)|docker\s+(?:system|image|container)\s+prune\b|docker\s+(?:manifest|image)\s+(?:rm|delete)\b.*ghcr\.io|(?:latest|staging|production|release):/i);
    assert.doesNotMatch(publication, /\bgh\s+api\b/i,
        'the bounded publication workflow has no GitHub API mutation path');
    const joinedPublicationShell = publication.replace(/\\\r?\n\s*/g, ' ');
    assert.doesNotMatch(joinedPublicationShell,
        /\bcurl\b[^\n]*-X\s+DELETE\b|\boras\s+manifest\s+delete\b/i,
        'the publication workflow must never delete a registry artifact');

    assert.equal(count(publication, new RegExp(`uses: ${SHARED_GATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')), 1);
    assert.equal(count(image, new RegExp(`uses: ${SHARED_GATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')), 1);
    assert.equal(count(`${publication}\n${image}\n${gate}`, new RegExp(BUILD_ACTION, 'g')), 1,
        'one shared implementation owns the only build');
    assert.doesNotMatch(`${publication}\n${gate}`,
        /\bdocker\s+(?:build(?:\s|$)|buildx\s+build\b|compose(?:\s+--?\S+)*\s+build\b)/m,
        'shell builds are forbidden across publication and the shared gate');
    requireIncludes(gate, [
        `uses: ${BUILD_ACTION} # v7.0.0`, 'platforms: linux/amd64', 'load: true',
        'push: false', 'id: shared_gate_enforcement', 'id: exact_cleanup',
        "echo \"classification=success\" >> \"$GITHUB_OUTPUT\"",
        'org.opencontainers.image.title=', 'org.opencontainers.image.description=',
        '[ "$INPUT_RETAIN_IMAGE" = "false" ] && [ "$INPUT_PUBLISH_MODE" = "false" ]',
        '[ "$INPUT_RETAIN_IMAGE" = "true" ] && [ "$INPUT_PUBLISH_MODE" = "true" ]',
        'exact normal false/false or publication true/true pair'
    ], 'shared gate');
    assert.doesNotMatch(gate, /org\.opencontainers\.image\.licenses=/,
        'custom non-SPDX license metadata must not be misrepresented');
    assert.ok(stepRange(gate, 'build').start < stepRange(gate, 'shared_gate_enforcement').start);
    assert.ok(stepRange(gate, 'exact_cleanup').start < stepRange(gate, 'shared_gate_enforcement').start);
    requireIncludes(stepText(publication, 'exact_image_gate'), [
        "retain-image: 'true'", "publish-mode: 'true'"
    ], 'publication gate invocation');

    const loginId = stepIdContaining(publication, LOGIN_ACTION);
    assert.ok(stepRange(publication, 'exact_image_gate').start < stepRange(publication, loginId).start,
        'login is after the complete gate');
    const registryWriteAuthorization = stepText(publication, 'registry_write_authorization');
    requireIncludes(registryWriteAuthorization, [
        "if: ${{ steps.exact_image_gate.outcome == 'success' }}",
        'EXPECTED_MAIN_SHA: ${{ needs.preflight.outputs.candidate_sha }}',
        'git ls-remote --exit-code origin refs/heads/main',
        '[ "$remote_sha" = "$EXPECTED_MAIN_SHA" ]',
        'classification=success'
    ], 'registry-write main-head reauthorization');
    assert.ok(stepRange(publication, 'exact_image_gate').start
            < stepRange(publication, 'registry_write_authorization').start
        && stepRange(publication, 'registry_write_authorization').start
            < stepRange(publication, loginId).start,
    'the protected-main head is re-proved after the full gate and immediately before login');
    requireIncludes(stepText(publication, loginId), [
        "if: ${{ steps.registry_write_authorization.outcome == 'success' }}"
    ], 'registry login authorization');
    assert.ok(stepRange(publication, 'exact_image_gate').start < stepRange(publication, 'registry_push').start,
        'push is after the complete gate');
    assert.ok(stepRange(publication, 'registry_preflight').start < stepRange(publication, 'registry_push').start,
        'absence check is before push');
    requireIncludes(publication, [
        `uses: ${LOGIN_ACTION} # v4.5.1`, 'registry: ghcr.io',
        'id: registry_preflight', 'id: registry_push', 'id: registry_identity',
        'candidate-$CANDIDATE_SHA', '^[0-9a-f]{40}$',
        '^sha256:[0-9a-f]{64}$', 'docker push "$TAG_REF"',
        'Refusing to overwrite existing discovery tag', 'docker buildx imagetools inspect',
        "['org.opencontainers.image.title']", "['org.opencontainers.image.description']",
        'configDigest !== process.env.EXPECTED_LOCAL_IMAGE_ID',
        'id: digest_runtime_identity', 'id: digest_roundtrip', 'docker pull "$DIGEST_REF"',
        'node scripts/i7-production-compose-contract.js'
    ], 'registry identity');
    const registryPreflight = stepText(publication, 'registry_preflight');
    requireIncludes(registryPreflight, [
        'docker buildx imagetools inspect "$tag_ref" --raw >"$raw_file"',
        'observed_digest="sha256:$(sha256sum "$raw_file"'
    ], 'recovery raw-manifest byte identity');
    const registryPush = stepText(publication, 'registry_push');
    requireIncludes(registryPush, [
        'docker buildx imagetools inspect "$TAG_REF" --raw > "$remote_raw"',
        'registry_digest="sha256:$(sha256sum "$remote_raw"',
        'docker image tag "$IMAGE_REF" "$TAG_REF"',
        'echo "local_tag_created=true" >> "$GITHUB_OUTPUT"'
    ], 'publication raw-manifest byte identity');
    assert.ok(registryPush.includes(
        '          docker image tag "$IMAGE_REF" "$TAG_REF"\n'
        + '          echo "local_tag_created=true" >> "$GITHUB_OUTPUT"'
    ), 'the fresh local discovery tag is recorded immediately after creation');
    const registryIdentity = stepText(publication, 'registry_identity');
    requireIncludes(registryIdentity, [
        'docker buildx imagetools inspect "$TAG_REF" --raw > "$tag_raw"',
        'docker buildx imagetools inspect "$DIGEST_REF" --raw > "$digest_raw"',
        'tag_hash="sha256:$(sha256sum "$tag_raw"',
        'digest_hash="sha256:$(sha256sum "$digest_raw"',
        'cmp -- "$tag_raw" "$digest_raw"'
    ], 'tag and digest exact-byte identity');
    assert.doesNotMatch(publication, /raw_manifest="\$\(/,
        'raw registry manifests must never pass through newline-stripping command substitution');
    const digestPull = stepText(publication, 'digest_pull');
    requireIncludes(digestPull, [
        'RUNTIME_IMAGE_REF: ${{ needs.preflight.outputs.image_ref }}',
        '[ "$RUNTIME_IMAGE_REF" = "local/slicer-api-publication:$CANDIDATE_SHA" ]',
        '[ "$PUBLICATION_MODE" = "publish_new" ]',
        '[ "$(docker image inspect --format \'{{.Id}}\' "$TAG_REF")" = "$EXPECTED_LOCAL_IMAGE_ID" ]',
        'docker image rm "$TAG_REF"',
        'elif [ "$PUBLICATION_MODE" = "publish_new" ]; then',
        'The run-owned fresh publication tag is missing before digest pull.',
        'docker image rm "$RUNTIME_IMAGE_REF"',
        'docker image rm "$EXPECTED_LOCAL_IMAGE_ID"',
        'docker image inspect "$EXPECTED_LOCAL_IMAGE_ID" >/dev/null 2>&1 ||',
        'docker image inspect "$RUNTIME_IMAGE_REF" >/dev/null 2>&1 ||',
        'docker image inspect "$TAG_REF" >/dev/null 2>&1; then',
        '             docker image inspect "$TAG_REF" >/dev/null 2>&1; then',
        'docker pull "$DIGEST_REF"',
        'pulled_image_id="$(docker image inspect --format \'{{.Id}}\' "$DIGEST_REF")"',
        'if [ "$pulled_image_id" != "$EXPECTED_LOCAL_IMAGE_ID" ]; then',
        'docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"',
        'runtime_alias_image_id="$(docker image inspect --format \'{{.Id}}\' "$RUNTIME_IMAGE_REF")"',
        'if [ "$runtime_alias_image_id" != "$pulled_image_id" ]',
        '[ "$runtime_alias_image_id" != "$EXPECTED_LOCAL_IMAGE_ID" ]',
        'pulled_image_id=$pulled_image_id',
        'runtime_alias_image_id=$runtime_alias_image_id',
        'runtime_image_ref=$RUNTIME_IMAGE_REF'
    ], 'digest pull and local publication alias');
    assert.ok(digestPull.includes(
        '          if docker image inspect "$TAG_REF" >/dev/null 2>&1; then\n'
        + '            [ "$PUBLICATION_MODE" = "publish_new" ]\n'
        + '            [ "$(docker image inspect --format \'{{.Id}}\' "$TAG_REF")" = "$EXPECTED_LOCAL_IMAGE_ID" ]\n'
        + '            docker image rm "$TAG_REF"\n'
        + '          elif [ "$PUBLICATION_MODE" = "publish_new" ]; then'
    ), 'only an exact run-owned fresh tag may be removed before digest pull');
    assert.ok(
        digestPull.indexOf('docker image rm "$TAG_REF"')
            < digestPull.indexOf('docker pull "$DIGEST_REF"')
            && digestPull.indexOf('docker image rm "$RUNTIME_IMAGE_REF"')
            < digestPull.indexOf('docker pull "$DIGEST_REF"')
            && digestPull.indexOf('docker image rm "$EXPECTED_LOCAL_IMAGE_ID"')
            < digestPull.indexOf('docker pull "$DIGEST_REF"')
            && digestPull.indexOf('docker image inspect "$TAG_REF" >/dev/null 2>&1; then')
            < digestPull.indexOf('docker pull "$DIGEST_REF"'),
        'every original local identity and the complete absence proof must precede the digest pull'
    );
    assert.ok(
        digestPull.indexOf('docker pull "$DIGEST_REF"')
            < digestPull.indexOf('pulled_image_id="$(docker image inspect'),
        'the exact registry digest must be pulled before its local image ID is inspected'
    );
    assert.ok(
        digestPull.indexOf('pulled_image_id="$(docker image inspect')
            < digestPull.indexOf('docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"'),
        'the digest-pulled image ID must be captured before the local alias is created'
    );
    assert.ok(
        digestPull.includes(
            '            exit 2\n'
            + '          fi\n'
            + '          docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"'
        ),
        'the digest-pulled image ID mismatch branch must close before the local alias is created'
    );
    assert.ok(
        digestPull.indexOf('docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"')
            < digestPull.indexOf('runtime_alias_image_id="$(docker image inspect'),
        'the local alias must be created before its image ID is independently resolved'
    );
    assert.ok(
        digestPull.indexOf('[ "$runtime_alias_image_id" != "$EXPECTED_LOCAL_IMAGE_ID" ]; then')
            < digestPull.indexOf('echo "pulled_image_id=$pulled_image_id" >> "$GITHUB_OUTPUT"')
            && digestPull.includes(
                '            exit 2\n'
                + '          fi\n'
                + '          echo "pulled_image_id=$pulled_image_id" >> "$GITHUB_OUTPUT"'
            ),
        'digest-pull outputs must be emitted only after alias, pulled, and gated image IDs agree'
    );
    const digestIdentity = stepText(publication, 'digest_runtime_identity');
    requireIncludes(digestIdentity, [
        "if: ${{ steps.digest_pull.outcome == 'success' }}",
        'EXPECTED_IMAGE_ID: ${{ steps.exact_image_gate.outputs.image-id }}',
        'IMAGE_REF: ${{ steps.digest_pull.outputs.runtime_image_ref }}',
        'node scripts/i2-image-runtime-diagnostics.js'
    ], 'digest-pulled runtime identity');
    assert.doesNotMatch(digestIdentity, /registry_identity\.outputs\.digest_ref|DIGEST_REF|ghcr\.io/,
        'the local-only identity helper must not receive a registry or digest reference');
    const digestRoundtrip = stepText(publication, 'digest_roundtrip');
    requireIncludes(digestRoundtrip, [
        'name: Re-prove runtime and Compose from the digest-pulled exact image',
        "if: ${{ steps.digest_runtime_identity.outcome == 'success' }}",
        'CONFIGURED_USER: ${{ steps.digest_runtime_identity.outputs.configured_user }}',
        'DIGEST_REF: ${{ steps.registry_identity.outputs.digest_ref }}',
        'RUNTIME_IMAGE_REF: ${{ steps.digest_pull.outputs.runtime_image_ref }}',
        'SERVICE_UID: ${{ steps.digest_runtime_identity.outputs.uid }}',
        'SERVICE_GID: ${{ steps.digest_runtime_identity.outputs.gid }}',
        'SLICER_API_IMAGE: ${{ steps.registry_identity.outputs.digest_ref }}',
        '[ "$SLICER_API_IMAGE" = "$DIGEST_REF" ]',
        'docker image inspect --format \'{{.Id}}\' "$RUNTIME_IMAGE_REF"',
        'docker image inspect --format \'{{.Id}}\' "$DIGEST_REF"',
        'node scripts/i2-orca-runtime-smoke.js',
        '--log-driver json-file --log-opt max-size=20m --log-opt max-file=5',
        '--env "EXPECTED_SERVICE_UID=$SERVICE_UID"',
        '--env "EXPECTED_SERVICE_GID=$SERVICE_GID"',
        '--env EXPECTED_PIDS_LIMIT=512',
        '--env EXPECTED_MEMORY_BYTES=4294967296',
        '--env EXPECTED_CPU_LIMIT=2.0',
        '--env EXPECTED_LOG_MAX_SIZE=20m',
        '--env EXPECTED_LOG_MAX_FILES=5',
        '--env EXPECTED_STOP_GRACE_PERIOD=30s',
        '"$RUNTIME_IMAGE_REF"',
        'node scripts/i7-production-compose-contract.js'
    ], 'digest round trip');
    assert.doesNotMatch(digestRoundtrip, /i2-image-runtime-diagnostics|PUBLICATION_IMAGE_REF|\$IMAGE_REF\b/,
        'identity resolution must remain a separate local-alias step');
    assert.doesNotMatch(publication, /candidate-(?:latest|main)|:(?:latest|staging|production|prod|release)\b/i);

    assert.equal(count(publication, new RegExp(ATTEST_ACTION, 'g')), 2, 'exactly two signed attestations');
    for (const id of ['provenance_attestation', 'sbom_attestation']) {
        const attestation = stepText(publication, id);
        requireIncludes(attestation, [
            `uses: ${ATTEST_ACTION} # v4.2.0`, `subject-name: ${GHCR_REPOSITORY}`,
            'subject-digest: ${{ steps.registry_push.outputs.registry_digest }}',
            'push-to-registry: true'
        ], id);
        const subjectLines = lines(attestation).map((line) => line.trim())
            .filter((line) => line.startsWith('subject-name:'));
        assert.deepEqual(subjectLines, [`subject-name: ${GHCR_REPOSITORY}`],
            `${id} has one exact tag-free subject name`);
    }
    assert.match(stepText(publication, 'sbom_attestation'), /sbom-path:.*sbom\.spdx\.json/);
    assert.equal(count(publication, /subject-digest: \$\{\{ steps\.registry_push\.outputs\.registry_digest \}\}/g), 2);

    const verification = stepText(publication, 'verify_attestations');
    requireIncludes(verification, [
        'gh attestation verify', '--bundle-from-oci', '--bundle',
        'REGISTRY_DIGEST: ${{ steps.registry_push.outputs.registry_digest }}',
        PROVENANCE_PREDICATE, SBOM_PREDICATE, '--cert-identity',
        '--source-digest', '--source-ref', '--repo "$GITHUB_REPOSITORY"',
        '.github/workflows/candidate-publication.yml',
        '"$verification_dir/$label-api.json"',
        '"$verification_dir/$label-oci.json"',
        '"$verification_dir/$label-offline.json"',
        'verificationResult', 'verifiedTimestamps', 'subject?.name === process.env.REGISTRY_REPOSITORY',
        'subject?.digest?.sha256 === process.env.REGISTRY_DIGEST.slice(7)',
        'certificate?.subjectAlternativeName === process.env.CERT_IDENTITY',
        'certificate?.buildSignerURI === process.env.CERT_IDENTITY',
        'certificate?.buildSignerDigest === process.env.CANDIDATE_SHA',
        'certificate?.sourceRepositoryURI === `https://github.com/${process.env.GITHUB_REPOSITORY}`',
        'certificate?.sourceRepositoryRef === process.env.GITHUB_REF',
        'certificate?.sourceRepositoryDigest === process.env.CANDIDATE_SHA',
        "certificate?.issuer === 'https://token.actions.githubusercontent.com'",
        'provenance_bundle_sha256=', 'sbom_bundle_sha256='
    ], 'attestation verification');
    assert.doesNotMatch(verification, /--signer-workflow/,
        'mutually exclusive gh verifier identity flags must not be combined');
    const negativeVerification = stepText(publication, 'negative_verification');
    requireIncludes(negativeVerification, [
        "if: ${{ steps.verify_attestations.outcome == 'success' }}",
        'REGISTRY_DIGEST: ${{ steps.registry_push.outputs.registry_digest }}',
        'wrong_digest_artifact="$RUNNER_TEMP/i8-wrong-digest-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.bin"',
        '[ -e "$wrong_digest_artifact" ] || [ -L "$wrong_digest_artifact" ]',
        "printf 'i8-local-wrong-digest-probe:%s\\n' \"$CANDIDATE_SHA\" > \"$wrong_digest_artifact\"",
        'sha256sum "$wrong_digest_artifact"',
        '[ "$wrong_digest" != "$REGISTRY_DIGEST" ]',
        'wrong_repository="Botond1/3D-Printer-Slicer-API-wrong"',
        '[ "$wrong_repository" != "$GITHUB_REPOSITORY" ]',
        'cert_identity="https://github.com/$GITHUB_REPOSITORY/.github/workflows/candidate-publication.yml@$GITHUB_REF"',
        'identity_args=(--cert-identity "$cert_identity"',
        '--signer-digest "$CANDIDATE_SHA" --source-ref "$GITHUB_REF"',
        '--source-digest "$CANDIDATE_SHA"',
        '--cert-oidc-issuer "https://token.actions.githubusercontent.com" --format json)',
        'verified_provenance="$I8_VERIFICATION_DIR/provenance-offline.json"',
        '[ -f "$verified_provenance" ] && [ ! -L "$verified_provenance" ]',
        '[[ "$PROVENANCE_BUNDLE_SHA256" =~ ^[0-9a-f]{64}$ ]]',
        '"$PROVENANCE_BUNDLE_SHA256" ]',
        'VERIFIED_PROVENANCE="$verified_provenance" WRONG_DIGEST="$wrong_digest" node',
        "verification?.statement?.predicateType === 'https://slsa.dev/provenance/v1'",
        'subject?.name === process.env.REGISTRY_REPOSITORY',
        'subject?.digest?.sha256 === expectedDigest',
        'certificate?.sourceRepositoryURI',
        'subject?.digest?.sha256 === wrongDigest',
        'if (!exactSubject || wrongSubject) process.exit(2);',
        'gh attestation verify "$wrong_digest_artifact"',
        '--repo "$GITHUB_REPOSITORY" "${identity_args[@]}"',
        'gh attestation verify "oci://$DIGEST_REF"',
        '--repo "$wrong_repository" "${identity_args[@]}"',
        '--bundle "$PROVENANCE_BUNDLE_PATH" >/dev/null 2>/dev/null',
        'set +e', 'set -e',
        'if [ "$wrong_digest_status" -eq 0 ]; then',
        'if [ "$wrong_repository_status" -eq 0 ]; then',
        'wrong_digest_reason=artifact_digest_policy_mismatch',
        'wrong_repository_reason=source_repository_uri_policy_mismatch'
    ], 'negative verification');
    assert.equal(count(negativeVerification,
        /--predicate-type "https:\/\/slsa\.dev\/provenance\/v1"/g), 2,
    'both negative probes keep the exact positively verified predicate');
    assert.equal(count(negativeVerification,
        /--bundle "\$PROVENANCE_BUNDLE_PATH" >\/dev\/null 2>\/dev\/null/g), 2,
    'both negative probes discard diagnostics with a zero-byte sink');
    assert.ok(
        negativeVerification.indexOf('set +e')
            < negativeVerification.indexOf('wrong_digest_status=$?')
        && negativeVerification.indexOf('wrong_digest_status=$?')
            < negativeVerification.indexOf('wrong_repository_status=$?')
        && negativeVerification.indexOf('wrong_repository_status=$?')
            < negativeVerification.lastIndexOf('set -e')
        && negativeVerification.lastIndexOf('set -e')
            < negativeVerification.indexOf('if [ "$wrong_digest_status" -eq 0 ]; then')
        && negativeVerification.indexOf('if [ "$wrong_digest_status" -eq 0 ]; then')
            < negativeVerification.indexOf('if [ "$wrong_repository_status" -eq 0 ]; then'),
    'negative verifier status capture and restored fail-closed shell order');
    assert.doesNotMatch(negativeVerification,
        /oci:\/\/\$REGISTRY_REPOSITORY@\$wrong_digest/,
        'the wrong-digest probe must reach offline bundle policy instead of registry lookup');
    assert.doesNotMatch(negativeVerification,
        /\bgrep\b|provided artifact digest|SourceRepositoryURI|wrong_(?:digest|repository)_error|\.err\b/,
        'negative acceptance must not depend on version-specific verifier diagnostics');

    const evidence = stepText(publication, 'publication_evidence');
    requireIncludes(evidence, [
        'scripts/i11-write-publication-evidence.js', 'i11-main-signed-candidate-provenance-v1',
        'registry_digest', 'bundle_sha256',
        'REGISTRY_DIGEST: ${{ steps.registry_push.outputs.registry_digest }}',
        'REGISTRY_OPERATION: ${{ steps.registry_push.outputs.registry_operation }}',
        'subject: `${process.env.REGISTRY_REPOSITORY}@${process.env.REGISTRY_DIGEST}`',
        'manifest_digest: process.env.REGISTRY_DIGEST',
        'DIGEST_RUNTIME_OUTCOME: ${{ steps.digest_runtime_identity.outcome }}',
        'COMPOSE_ROUNDTRIP_OUTCOME: ${{ steps.digest_roundtrip.outcome }}'
    ], 'publication evidence');
    const evidenceBoundary = stepText(publication, 'publication_evidence_boundary');
    const boundaryFiles = [...evidenceBoundary.matchAll(
        /^\s+\['([^']+)',\s*[^\]]+\],?$/gm
    )].map((match) => match[1]).sort();
    assert.deepEqual(boundaryFiles, [
        'grype.json', 'grype.yaml', 'i11-main-candidate-provenance.json',
        'i11-publication-draft.json', 'image-identity.txt', 'runtime-diagnostics.json',
        'sbom.spdx.json', 'syft.yaml', 'topology-evidence.json'
    ], 'publication evidence boundary has the exact nine-file allowlist');
    requireIncludes(evidenceBoundary, [
        'fs.realpathSync(root) !== root', 'fs.lstatSync(root).isSymbolicLink()',
        'JSON.stringify(actual) !== JSON.stringify(expected)',
        '!details.isFile()', 'details.isSymbolicLink()',
        'path.dirname(fs.realpathSync(target)) !== root',
        "['i11-publication-draft.json', 96 * 1024]",
        "['i11-main-candidate-provenance.json', 96 * 1024]",
        "['sbom.spdx.json', 16 * 1024 * 1024]",
        "['grype.json', 100 * 1024 * 1024]"
    ], 'publication evidence boundary');
    const uploadId = stepIdContaining(publication, 'actions/upload-artifact@');
    const upload = stepText(publication, uploadId);
    requireIncludes(upload, [
        "if: ${{ steps.publication_evidence_boundary.outcome == 'success' }}",
        'if-no-files-found: error', 'overwrite: false', 'include-hidden-files: false'
    ], 'evidence upload');
    assert.doesNotMatch(upload, /bundle(?:s)?[./_-]|verification(?:s)?[./_-]/i, 'raw bundles/verifier output are not uploaded');

    requireIncludes(publication, [
        'BLOCKED_I11_PREPUBLICATION_GATE', 'I11_CANDIDATE_PUBLISHED_UNATTESTED',
        'I11_CANDIDATE_ATTESTATION_UNVERIFIED', 'BLOCKED_I11_RECOVERY_IDENTITY',
        'id: publication_cleanup', 'id: final_enforcement', 'if: ${{ always() }}',
        'I11_PUBLICATION_INFRASTRUCTURE_FAILURE',
        'cleanup_failure'
    ], 'partial-state/final enforcement');
    const registryPushFinal = stepText(publication, 'registry_push');
    assert.ok(registryPushFinal.indexOf('docker push "$TAG_REF"')
        < registryPushFinal.indexOf('remote_publication_state=matching'),
    'remote publication is observed only after the push attempt');
    requireIncludes(registryPushFinal, [
        'push_status="${PIPESTATUS[0]}"', 'docker buildx imagetools inspect "$TAG_REF" --raw',
        'remote_publication_state=matching', 'remote_publication_state=foreign',
        'remote_publication_state=unknown',
        'remote_config_digest', '[ "$remote_config_digest" = "$EXPECTED_LOCAL_IMAGE_ID" ]',
        'remote_published=$remote_publication_state',
        'registry_digest=$registry_digest'
    ], 'post-push remote observation');
    const finalTagIdentity = stepText(publication, 'final_tag_identity');
    requireIncludes(finalTagIdentity, [
        "if: ${{ steps.negative_verification.outcome == 'success' }}",
        'docker buildx imagetools inspect "$TAG_REF" --raw',
        '[ "$observed_digest" = "$REGISTRY_DIGEST" ]',
        "m?.config?.digest!==process.env.EXPECTED_LOCAL_IMAGE_ID"
    ], 'final discovery-tag identity recheck');
    const cleanup = stepText(publication, 'publication_cleanup');
    requireIncludes(cleanup, [
        'container_inspect_failure', 'container_cleanup_verification_failure',
        'image_inspect_failure', 'image_cleanup_verification_failure',
        'i8-existing-manifest.json', 'i8-existing-manifest.err',
        'i8-push-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.log',
        'i8-pushed-manifest-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-tag-raw-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-digest-raw-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-tag-summary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-digest-summary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-final-tag-raw-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-wrong-digest-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.bin',
        'created_attestation_paths.txt',
        'exact_container_cleanup "$I8_DIGEST_CONTAINER_NAME"',
        'exact_container_cleanup "$I2_UID_PROBE_NAME"',
        'exact_container_cleanup "$I2_GID_PROBE_NAME"',
        'exact_container_cleanup "$I2_ORCA_PROBE_NAME"',
        'docker logout ghcr.io',
        'RUNTIME_IMAGE_REF: ${{ needs.preflight.outputs.image_ref }}',
        'LOCAL_TAG_CREATED: ${{ steps.registry_push.outputs.local_tag_created }}',
        '[ "$LOCAL_TAG_CREATED" = "true" ] || cleanup_error local_tag_creation_proof_failure',
        '[ -z "$LOCAL_TAG_CREATED" ] || cleanup_error local_tag_creation_proof_failure',
        'if [ "$PUBLICATION_MODE" = "publish_new" ] &&',
        '[ "$LOCAL_TAG_CREATED" = "true" ] &&',
        '[ "$tag_actual_id" = "$EXPECTED_LOCAL_IMAGE_ID" ]; then',
        'for exact_ref in "$RUNTIME_IMAGE_REF" "$DIGEST_REF"; do',
        'if [ "$actual_id" != "$EXPECTED_LOCAL_IMAGE_ID" ]; then',
        'runner_temp_real="$(realpath -e -- "$RUNNER_TEMP")"',
        'case "$bundle" in "$RUNNER_TEMP"/*) ;; *) cleanup_status=1; continue ;; esac',
        '[ "$(basename -- "$bundle")" != "attestation.json" ]',
        '[ ! -f "$bundle" ] || [ -L "$bundle" ]',
        '[ ! -d "$bundle_parent" ] || [ -L "$bundle_parent" ]',
        'bundle_real="$(realpath -e -- "$bundle")"',
        'bundle_parent_real="$(realpath -e -- "$bundle_parent")"',
        '[ "$(dirname -- "$bundle_parent_real")" != "$runner_temp_real" ]',
        '[ "$bundle_real" != "$bundle_parent_real/attestation.json" ]',
        'rm -- "$bundle" || {',
        'rmdir -- "$bundle_dir"',
        '[ -e "$bundle_dir" ] || [ -L "$bundle_dir" ]',
        'bundle_parent_cleanup_verification_failure'
    ], 'publication cleanup');
    assert.doesNotMatch(cleanup, /\bdocker\s+(?:system|image|container|builder|volume)\s+prune\b/);
    assert.doesNotMatch(cleanup, /i8-(?:wrong-digest|wrong-repository).*\.err/,
        'zero-byte negative diagnostics must not create cleanup-owned stderr files');
    const final = stepText(publication, 'final_enforcement');
    requireIncludes(final, [
        'REMOTE_PUBLISHED: ${{ steps.registry_push.outputs.remote_published }}',
        'REGISTRY_IDENTITY_OUTCOME: ${{ steps.registry_identity.outcome }}',
        'DIGEST_PULL_OUTCOME: ${{ steps.digest_pull.outcome }}',
        'DIGEST_RUNTIME_IDENTITY_OUTCOME: ${{ steps.digest_runtime_identity.outcome }}',
        'DIGEST_ROUNDTRIP_OUTCOME: ${{ steps.digest_roundtrip.outcome }}',
        'PUSH_OUTCOME: ${{ steps.registry_push.outcome }}',
        '[ "$REMOTE_PUBLISHED" = "matching" ]',
        '[ "$REMOTE_PUBLISHED" != "matching" ]',
        'FINAL_TAG_IDENTITY_OUTCOME: ${{ steps.final_tag_identity.outcome }}',
        '[ "$FINAL_TAG_IDENTITY_OUTCOME" != "success" ]',
        'PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME: ${{ steps.publication_evidence_boundary.outcome }}',
        '[ "$PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME" != "success" ]',
        'PUBLICATION_CLEANUP_OUTCOME: ${{ steps.publication_cleanup.outcome }}',
        '[ "$PUBLICATION_CLEANUP_OUTCOME" != "success" ]',
        'classification=BLOCKED_I11_PREPUBLICATION_GATE',
        '[ "$PUBLICATION_MODE" != "publish_new" ] &&',
        '[ "$PUBLICATION_MODE" != "recover_exact_digest" ]; then',
        'failed_step=publication_mode',
        '[ "$REGISTRY_LOGIN_OUTCOME" != "success" ]; then',
        'failed_step=registry_login',
        '[ "$PUSH_OUTCOME" != "success" ]',
        'failed_step=registry_push',
        '[ "$REGISTRY_IDENTITY_OUTCOME" != "success" ]',
        'failed_step=registry_identity',
        '[ "$DIGEST_PULL_OUTCOME" != "success" ]',
        'failed_step=digest_pull',
        '[ "$DIGEST_RUNTIME_IDENTITY_OUTCOME" != "success" ]',
        'failed_step=digest_runtime_identity',
        '[ "$DIGEST_ROUNDTRIP_OUTCOME" != "success" ]',
        'failed_step=digest_roundtrip'
    ], 'partial publication classification');
    assert.match(final,
        /elif \[ "\$REMOTE_PUBLISHED" = "matching" \] && \\\n\s+\[ "\$PUSH_OUTCOME" != "success" \]; then\n\s+classification=I11_CANDIDATE_PUBLISHED_UNATTESTED\n\s+failed_step=registry_push\n\s+elif \[ "\$REMOTE_PUBLISHED" = "matching" \] && \\\n\s+\[ "\$REGISTRY_IDENTITY_OUTCOME" != "success" \]; then\n\s+classification=I11_CANDIDATE_PUBLISHED_UNATTESTED\n\s+failed_step=registry_identity\n\s+elif \[ "\$REMOTE_PUBLISHED" = "matching" \] && \\\n\s+\[ "\$DIGEST_PULL_OUTCOME" != "success" \]; then\n\s+classification=I11_CANDIDATE_PUBLISHED_UNATTESTED\n\s+failed_step=digest_pull\n\s+elif \[ "\$REMOTE_PUBLISHED" = "matching" \] && \\\n\s+\[ "\$DIGEST_RUNTIME_IDENTITY_OUTCOME" != "success" \]; then\n\s+classification=I11_CANDIDATE_PUBLISHED_UNATTESTED\n\s+failed_step=digest_runtime_identity\n\s+elif \[ "\$REMOTE_PUBLISHED" = "matching" \] && \\\n\s+\[ "\$DIGEST_ROUNDTRIP_OUTCOME" != "success" \]; then\n\s+classification=I11_CANDIDATE_PUBLISHED_UNATTESTED\n\s+failed_step=digest_roundtrip/,
        'post-publication blockers must be classified in exact execution order with matching labels');
    assert.match(final,
        /if \[ "\$classification" != "I11_MAIN_SIGNED_CANDIDATE_COMPLETE" \]; then\n\s+echo "::error title=I11 publication::\$classification"\n\s+exit 1\n\s+fi\s*$/,
        'the final aggregator must terminate every non-complete classification with failure');
    assert.ok(stepRange(publication, 'publication_cleanup').start < stepRange(publication, 'final_enforcement').start);
}

function cloneSources() {
    return {...ORIGINAL};
}

function replaceRequired(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replace(from, to);
}

function replaceAllRequired(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replaceAll(from, to);
}

function removeStep(source, id) {
    const range = stepRange(source, id);
    const sourceLines = lines(source);
    sourceLines.splice(range.start, range.end - range.start);
    return sourceLines.join('\n');
}

function moveStepBefore(source, id, beforeId) {
    const moving = stepRange(source, id);
    const block = lines(source).slice(moving.start, moving.end);
    const without = lines(source);
    without.splice(moving.start, moving.end - moving.start);
    const target = stepRange(without.join('\n'), beforeId);
    without.splice(target.start, 0, ...block);
    return without.join('\n');
}

function duplicateStep(source, id) {
    const range = stepRange(source, id);
    const sourceLines = lines(source);
    sourceLines.splice(range.end, 0, ...sourceLines.slice(range.start, range.end));
    return sourceLines.join('\n');
}

function mutation(name, surface, transform) {
    return [name, () => {
        const sources = cloneSources();
        sources[surface] = transform(sources[surface]);
        return sources;
    }];
}

test('Candidate Publication accepts only exact manual publish/recovery authorization and remains least-privilege, build-once, digest-bound, and fail-closed', () => {
    validateContract(ORIGINAL);
});

test('publication authorization, identity, attestation, evidence, and cleanup mutations fail closed', async (t) => {
    const loginId = stepIdContaining(ORIGINAL.publication, LOGIN_ACTION);
    const uploadId = stepIdContaining(ORIGINAL.publication, 'actions/upload-artifact@');
    const cases = [
        mutation('manual dispatch contract removed', 'publication', (s) => replaceRequired(
            s, '  workflow_dispatch:\n', '  schedule:\n')),
        mutation('preflight gains write permission', 'publication', (s) => replaceRequired(
            s,
            '    permissions:\n      contents: read\n    outputs:',
            '    permissions:\n      contents: write\n    outputs:'
        )),
        mutation('preflight ignores authorization failure', 'publication', (s) => replaceRequired(
            s,
            '    permissions:\n      contents: read\n    outputs:',
            '    permissions:\n      contents: read\n    continue-on-error: true\n    outputs:'
        )),
        mutation('authorization proof ignores failure', 'publication', (s) => replaceRequired(
            s,
            '        id: authorization_proof\n',
            '        id: authorization_proof\n        continue-on-error: true\n'
        )),
        mutation('repository guard removed', 'publication', (s) => replaceRequired(
            s, '[ "$EVENT_REPOSITORY" != "$exact_repository" ]',
            '[ "$EVENT_REPOSITORY" != "$EVENT_REPOSITORY" ]')),
        mutation('fixed registry comparison removed', 'publication', (s) => replaceRequired(
            s, 'if [ "$registry_repository" != "$exact_registry_repository" ]; then', 'if false; then')),
        mutation('candidate and event SHA comparison removed', 'publication', (s) => replaceRequired(
            s, '[ "$candidate_sha" != "$EVENT_SHA" ]', '[ "$candidate_sha" != "$candidate_sha" ]')),
        mutation('publication bypasses failed preflight', 'publication', (s) => replaceRequired(
            s, '    needs: preflight\n', '    needs: preflight\n    if: ${{ always() }}\n')),
        mutation('canonical registry output is replaced', 'publication', (s) => replaceRequired(
            s,
            'registry_repository: ${{ steps.candidate.outputs.registry_repository }}',
            'registry_repository: ghcr.io/other/repository'
        )),
        mutation('wrong target branch', 'publication', (s) => replaceAllRequired(s, BRANCH, 'other')),
        mutation('wrong baseline', 'publication', (s) => replaceAllRequired(s, BASELINE_SHA, 'a'.repeat(40))),
        mutation('wrong registry repository', 'publication', (s) => replaceAllRequired(s, GHCR_REPOSITORY, 'ghcr.io/other/repository')),
        mutation('wrong GitHub repository', 'publication', (s) => replaceAllRequired(s, GITHUB_REPOSITORY, 'Other/Repository')),
        mutation('wrong confirmation', 'publication', (s) => replaceAllRequired(s, CONFIRMATION, 'PUBLISH')),
        mutation('publication package permission removed', 'publication', (s) => replaceRequired(s, 'packages: write', 'packages: read')),
        mutation('publication attestation permission removed', 'publication',
            (s) => replaceRequired(s, 'attestations: write', 'attestations: read')),
        mutation('publication OIDC permission removed', 'publication',
            (s) => replaceRequired(s, 'id-token: write', 'id-token: none')),
        mutation('publication contents permission broadened', 'publication',
            (s) => replaceRequired(s, 'contents: none', 'contents: write')),
        mutation('normal validation gains write permission', 'image',
            (s) => replaceRequired(s, 'permissions:\n  contents: read', 'permissions:\n  contents: read\n  packages: write')),
        mutation('checkout credentials persist', 'publication',
            (s) => replaceAllRequired(s, 'persist-credentials: false', 'persist-credentials: true')),
        mutation('attestation action floats', 'publication',
            (s) => replaceAllRequired(s, ATTEST_ACTION, 'actions/attest@v4')),
        mutation('extra local action added', 'publication', (s) => replaceRequired(
            s, `uses: ${SHARED_GATE}`, `uses: ${SHARED_GATE}\n      - uses: ./.github/actions/unreviewed`)),
        mutation('login precedes full gate', 'publication', (s) => moveStepBefore(s, loginId, 'exact_image_gate')),
        mutation('registry-write main-head reauthorization omitted', 'publication',
            (s) => removeStep(s, 'registry_write_authorization')),
        mutation('registry login bypasses the main-head reauthorization', 'publication',
            (s) => replaceRequired(
                s,
                "if: ${{ steps.registry_write_authorization.outcome == 'success' }}",
                "if: ${{ steps.exact_image_gate.outcome == 'success' }}"
            )),
        mutation('registry-write main-head equality guard removed', 'publication',
            (s) => replaceRequired(
                s, '[ "$remote_sha" = "$EXPECTED_MAIN_SHA" ]',
                '[ "$remote_sha" = "$remote_sha" ]'
            )),
        mutation('push precedes full gate', 'publication', (s) => moveStepBefore(s, 'registry_push', 'exact_image_gate')),
        mutation('shell docker build added', 'publication', (s) => replaceRequired(
            s, 'docker push "$TAG_REF"', 'docker build .\n          docker push "$TAG_REF"')),
        mutation('shell docker buildx build added', 'gate', (s) => replaceRequired(
            s, 'docker image inspect', 'docker buildx build .\n          docker image inspect')),
        mutation('shell docker compose build added', 'publication', (s) => replaceRequired(
            s, 'docker pull "$DIGEST_REF"', 'docker compose build\n          docker pull "$DIGEST_REF"')),
        mutation('publication mode typo accepted', 'gate', (s) => replaceRequired(
            s,
            '[ "$INPUT_RETAIN_IMAGE" = "true" ] && [ "$INPUT_PUBLISH_MODE" = "true" ]',
            '[ "$INPUT_RETAIN_IMAGE" = "true" ] && [ "$INPUT_PUBLISH_MODE" = "ture" ]')),
        mutation('illegal mixed mode pair accepted', 'gate', (s) => replaceRequired(
            s,
            '[ "$INPUT_RETAIN_IMAGE" = "false" ] && [ "$INPUT_PUBLISH_MODE" = "false" ]',
            '[ "$INPUT_RETAIN_IMAGE" = "false" ] && [ "$INPUT_PUBLISH_MODE" = "true" ]')),
        mutation('final publication mode enum guard removed', 'publication', (s) => replaceRequired(
            s,
            '          elif [ "$PUBLICATION_MODE" != "publish_new" ] && \\\n'
                + '               [ "$PUBLICATION_MODE" != "recover_exact_digest" ]; then\n'
                + '            classification=BLOCKED_I11_PREPUBLICATION_GATE\n'
                + '            failed_step=publication_mode\n',
            ''
        )),
        mutation('final login failure is absorbed into recovery identity', 'publication',
            (s) => replaceRequired(
                s,
                '          elif [ "$REGISTRY_LOGIN_OUTCOME" != "success" ]; then\n'
                    + '            classification=BLOCKED_I11_PREPUBLICATION_GATE\n'
                    + '            failed_step=registry_login\n',
                ''
            )),
        mutation('remote publication observation omitted', 'publication', (s) => replaceAllRequired(
            s, 'remote_publication_state=matching', 'remote_state_omitted=matching')),
        mutation('remote publication unknown state omitted', 'publication', (s) => replaceAllRequired(
            s, 'remote_publication_state=unknown', 'remote_publication_state=indeterminate')),
        mutation('foreign remote digest accepted as matching', 'publication', (s) => replaceRequired(
            s, 'remote_publication_state=foreign', 'remote_publication_state=matching')),
        mutation('final aggregator ignores remote publication', 'publication', (s) => replaceAllRequired(
            s, 'REMOTE_PUBLISHED: ${{ steps.registry_push.outputs.remote_published }}',
            'REMOTE_PUBLISHED: ignored')),
        mutation('second build', 'gate', (s) => duplicateStep(s, 'build')),
        mutation('mutable candidate tag', 'publication', (s) => replaceRequired(s, 'candidate-$CANDIDATE_SHA', 'candidate-latest')),
        mutation('short candidate tag', 'publication', (s) => replaceRequired(s, '^[0-9a-f]{40}$', '^[0-9a-f]{7}$')),
        mutation('uppercase candidate tag accepted', 'publication', (s) => replaceRequired(
            s, '^[0-9a-f]{40}$', '^[0-9A-Fa-f]{40}$')),
        mutation('malformed registry digest accepted', 'publication', (s) => replaceAllRequired(
            s, '^sha256:[0-9a-f]{64}$', '^sha256:.+$')),
        mutation('short registry digest accepted', 'publication', (s) => replaceAllRequired(
            s, '^sha256:[0-9a-f]{64}$', '^sha256:[0-9a-f]{12}$')),
        mutation('uppercase registry digest accepted', 'publication', (s) => replaceAllRequired(
            s, '^sha256:[0-9a-f]{64}$', '^sha256:[0-9A-Fa-f]{64}$')),
        mutation('overwrite preflight removed', 'publication', (s) => removeStep(s, 'registry_preflight')),
        mutation('recovery manifest passes through newline-stripping command substitution',
            'publication', (s) => replaceRequired(
                s,
                '              docker buildx imagetools inspect "$tag_ref" --raw >"$raw_file" 2>"$error_file"\n'
                    + '              observed_digest="sha256:$(sha256sum "$raw_file" | awk \'{print $1}\')"',
                '              raw_manifest="$(docker buildx imagetools inspect "$tag_ref" --raw 2>"$error_file")"\n'
                    + '              printf \'%s\' "$raw_manifest" >"$raw_file"\n'
                    + '              observed_digest="sha256:$(printf \'%s\' "$raw_manifest" | sha256sum | awk \'{print $1}\')"'
            )),
        mutation('tag and digest raw equality becomes decoded shell-string equality',
            'publication', (s) => replaceRequired(
                s, '          cmp -- "$tag_raw" "$digest_raw"',
                '          [ "$(cat "$tag_raw")" = "$(cat "$digest_raw")" ]'
            )),
        mutation('different build config accepted', 'publication', (s) => replaceAllRequired(
            s, 'configDigest !== process.env.EXPECTED_LOCAL_IMAGE_ID',
            'configDigest === process.env.EXPECTED_LOCAL_IMAGE_ID')),
        mutation('fresh local discovery tag creation is not recorded', 'publication',
            (s) => replaceRequired(s, '          echo "local_tag_created=true" >> "$GITHUB_OUTPUT"\n', '')),
        mutation('digest-pulled and gated image ID mismatch ignored', 'publication', (s) => replaceRequired(
            s,
            'if [ "$pulled_image_id" != "$EXPECTED_LOCAL_IMAGE_ID" ]; then',
            'if false; then'
        )),
        mutation('discovery-tag identity is not removed before digest pull', 'publication',
            (s) => replaceRequired(s, '          docker image rm "$TAG_REF"\n', '')),
        mutation('local discovery tag ownership guard removed', 'publication',
            (s) => replaceRequired(
                s,
                '            [ "$(docker image inspect --format \'{{.Id}}\' "$TAG_REF")" = "$EXPECTED_LOCAL_IMAGE_ID" ]\n',
                ''
            )),
        mutation('recovery accepts a preexisting local discovery tag', 'publication',
            (s) => replaceRequired(
                s,
                '            [ "$PUBLICATION_MODE" = "publish_new" ]\n'
                    + '            [ "$(docker image inspect --format \'{{.Id}}\' "$TAG_REF")" = "$EXPECTED_LOCAL_IMAGE_ID" ]',
                '            [ "$PUBLICATION_MODE" = "$PUBLICATION_MODE" ]\n'
                    + '            [ "$(docker image inspect --format \'{{.Id}}\' "$TAG_REF")" = "$EXPECTED_LOCAL_IMAGE_ID" ]'
            )),
        mutation('expected local image ID is not removed before digest pull', 'publication',
            (s) => replaceRequired(s, '            docker image rm "$EXPECTED_LOCAL_IMAGE_ID"\n', '')),
        mutation('complete pre-pull identity absence proof is weakened', 'publication',
            (s) => replaceRequired(
                s,
                '             docker image inspect "$TAG_REF" >/dev/null 2>&1; then',
                '             false; then'
            )),
        mutation('digest pull precedes original identity removal', 'publication', (s) => {
            const line = '          docker pull "$DIGEST_REF"\n';
            return replaceRequired(
                replaceRequired(s, line, ''),
                '          docker image rm "$TAG_REF"\n',
                `${line}          docker image rm "$TAG_REF"\n`
            );
        }),
        mutation('digest-pulled local publication alias omitted', 'publication', (s) => replaceRequired(
            s, '          docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"\n', '')),
        mutation('local publication alias created before digest pull', 'publication', (s) => {
            const line = '          docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"\n';
            return replaceRequired(
                replaceRequired(s, line, ''),
                '          docker pull "$DIGEST_REF"\n',
                `${line}          docker pull "$DIGEST_REF"\n`
            );
        }),
        mutation('local publication alias created before digest image ID equality', 'publication', (s) => {
            const line = '          docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"\n';
            const without = replaceRequired(s, line, '');
            return replaceRequired(
                without,
                '          pulled_image_id="$(docker image inspect --format \'{{.Id}}\' "$DIGEST_REF")"\n',
                `${line}          pulled_image_id="$(docker image inspect --format '{{.Id}}' "$DIGEST_REF")"\n`
            );
        }),
        mutation('local publication alias created inside digest mismatch branch', 'publication', (s) => {
            const line = '          docker image tag "$DIGEST_REF" "$RUNTIME_IMAGE_REF"\n';
            const without = replaceRequired(s, line, '');
            return replaceRequired(
                without,
                '            exit 2\n          fi\n',
                `            ${line.trim()}\n            exit 2\n          fi\n`
            );
        }),
        mutation('local publication alias image ID verification omitted', 'publication',
            (s) => replaceRequired(
                s,
                'if [ "$runtime_alias_image_id" != "$pulled_image_id" ]',
                'if false'
             )),
        mutation('runtime alias output emitted before alias image ID equality', 'publication', (s) => {
            const line = '          echo "pulled_image_id=$pulled_image_id" >> "$GITHUB_OUTPUT"\n';
            return replaceRequired(
                replaceRequired(s, line, ''),
                '          if [ "$runtime_alias_image_id" != "$pulled_image_id" ] || \\\n',
                `${line}          if [ "$runtime_alias_image_id" != "$pulled_image_id" ] || \\\n`
            );
        }),
        mutation('runtime alias is derived from the discovery tag', 'publication',
            (s) => replaceRequired(
                s,
                'RUNTIME_IMAGE_REF: ${{ needs.preflight.outputs.image_ref }}',
                'RUNTIME_IMAGE_REF: ${{ steps.registry_preflight.outputs.tag_ref }}'
            )),
        mutation('runtime alias is not bound to the canonical candidate SHA', 'publication',
            (s) => replaceRequired(
                s,
                '[ "$RUNTIME_IMAGE_REF" = "local/slicer-api-publication:$CANDIDATE_SHA" ]',
                '[ "$RUNTIME_IMAGE_REF" = "local/slicer-api-publication:0000000000000000000000000000000000000000" ]'
            )),
        mutation('runtime diagnostics receives registry digest instead of bounded local alias',
            'publication', (s) => replaceRequired(
                s,
                'IMAGE_REF: ${{ steps.digest_pull.outputs.runtime_image_ref }}',
                'IMAGE_REF: ${{ steps.registry_identity.outputs.digest_ref }}'
            )),
        mutation('digest runtime identity step omitted', 'publication',
            (s) => removeStep(s, 'digest_runtime_identity')),
        mutation('round trip bypasses digest runtime identity failure', 'publication',
            (s) => replaceRequired(
                s,
                "if: ${{ steps.digest_runtime_identity.outcome == 'success' }}",
                "if: ${{ steps.digest_pull.outcome == 'success' }}"
            )),
        mutation('round trip service UID is not identity-step bound', 'publication',
            (s) => replaceRequired(
                s,
                'SERVICE_UID: ${{ steps.digest_runtime_identity.outputs.uid }}',
                'SERVICE_UID: 999'
            )),
        mutation('Compose loses digest-pinned image reference', 'publication',
            (s) => replaceRequired(
                s,
                'SLICER_API_IMAGE: ${{ steps.registry_identity.outputs.digest_ref }}',
                'SLICER_API_IMAGE: "${{ needs.preflight.outputs.image_ref }}"'
            )),
        mutation('local image ID used as registry digest', 'publication', (s) => replaceRequired(
            s, 'subject-digest: ${{ steps.registry_push.outputs.registry_digest }}',
            'subject-digest: ${{ steps.exact_image_gate.outputs.image-id }}')),
        mutation('tag used instead of attested digest', 'publication', (s) => replaceRequired(
            s, 'subject-digest: ${{ steps.registry_push.outputs.registry_digest }}',
            'subject-digest: ${{ steps.candidate.outputs.candidate_tag }}')),
        mutation('publication provenance registry identity uses the local alias', 'publication', (s) => {
            const block = stepText(s, 'publication_evidence');
            return replaceRequired(s, block, replaceRequired(
                block,
                'REGISTRY_DIGEST: ${{ steps.registry_push.outputs.registry_digest }}',
                'REGISTRY_DIGEST: ${{ steps.digest_pull.outputs.runtime_image_ref }}'
            ));
        }),
        mutation('attestation registry push disabled', 'publication', (s) => replaceRequired(s, 'push-to-registry: true', 'push-to-registry: false')),
        mutation('build provenance omitted', 'publication', (s) => removeStep(s, 'provenance_attestation')),
        mutation('SBOM attestation omitted', 'publication', (s) => removeStep(s, 'sbom_attestation')),
        mutation('different SBOM attested', 'publication', (s) => replaceRequired(
            s, 'sbom-path: ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/sbom.spdx.json',
            'sbom-path: ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/other.spdx.json')),
        mutation('wrong provenance predicate', 'publication', (s) => replaceAllRequired(s, PROVENANCE_PREDICATE, 'https://example.invalid/provenance')),
        mutation('wrong SBOM predicate', 'publication', (s) => replaceAllRequired(s, SBOM_PREDICATE, 'https://spdx.dev/Document/v2.2')),
        mutation('tag added to attestation subject', 'publication', (s) => replaceRequired(
            s, `subject-name: ${GHCR_REPOSITORY}`, `subject-name: ${GHCR_REPOSITORY}:candidate`)),
        mutation('workflow identity omitted', 'publication', (s) => replaceAllRequired(s, '--cert-identity', '--predicate-type')),
        mutation('mutually exclusive signer workflow flag introduced', 'publication', (s) => replaceRequired(
            s, 'common_args=(--repo "$GITHUB_REPOSITORY"',
            'common_args=(--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/candidate-publication.yml" --repo "$GITHUB_REPOSITORY"')),
        mutation('wrong signer workflow', 'publication', (s) => replaceAllRequired(
            s, '.github/workflows/candidate-publication.yml', '.github/workflows/image-validation.yml')),
        mutation('source ref omitted', 'publication', (s) => replaceAllRequired(s, '--source-ref', '--format')),
        mutation('online verification omitted', 'publication', (s) => replaceAllRequired(
            s, '"$verification_dir/$label-api.json"', '"$verification_dir/$label-skipped.json"')),
        mutation('verification registry digest binding omitted', 'publication', (s) => {
            const block = stepText(s, 'verify_attestations');
            return replaceRequired(s, block, replaceRequired(
                block,
                '          REGISTRY_DIGEST: ${{ steps.registry_push.outputs.registry_digest }}\n',
                ''
            ));
        }),
        mutation('OCI verification omitted', 'publication', (s) => replaceAllRequired(s, '--bundle-from-oci', '--format')),
        mutation('offline verification omitted', 'publication', (s) => replaceRequired(s, '--bundle', '--format')),
        mutation('negative checks omitted', 'publication', (s) => removeStep(s, 'negative_verification')),
        mutation('negative checks bypass positive verification', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                "if: ${{ steps.verify_attestations.outcome == 'success' }}",
                'if: ${{ always() }}'
            ));
        }),
        mutation('negative verification registry digest binding omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                '          REGISTRY_DIGEST: ${{ steps.registry_push.outputs.registry_digest }}\n',
                ''
            ));
        }),
        mutation('wrong digest distinctness proof bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, '[ "$wrong_digest" != "$REGISTRY_DIGEST" ]', 'true'));
        }),
        mutation('wrong repository distinctness proof bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, '[ "$wrong_repository" != "$GITHUB_REPOSITORY" ]', 'true'));
        }),
        mutation('wrong digest probe uses a nonexistent registry manifest', 'publication', (s) =>
            replaceRequired(s, 'gh attestation verify "$wrong_digest_artifact"',
                'gh attestation verify "oci://$REGISTRY_REPOSITORY@$wrong_digest"')),
        mutation('wrong digest probe changes repository too', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                '--repo "$GITHUB_REPOSITORY" "${identity_args[@]}"',
                '--repo "$wrong_repository" "${identity_args[@]}"'
            ));
        }),
        mutation('wrong repository probe changes digest too', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, 'gh attestation verify "oci://$DIGEST_REF"',
                'gh attestation verify "$wrong_digest_artifact"'));
        }),
        mutation('wrong repository probe restores correct repository', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                'wrong_repository="Botond1/3D-Printer-Slicer-API-wrong"',
                'wrong_repository="$GITHUB_REPOSITORY"'
            ));
        }),
        mutation('wrong digest probe changes predicate too', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, PROVENANCE_PREDICATE, 'https://example.invalid/provenance'));
        }),
        mutation('negative certificate identity omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, '--cert-identity "$cert_identity"', '--owner Botond1'));
        }),
        mutation('negative signer digest omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, '--signer-digest "$CANDIDATE_SHA"', '--owner Botond1'));
        }),
        mutation('negative source ref omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, '--source-ref "$GITHUB_REF"', '--owner Botond1'));
        }),
        mutation('negative source digest omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, '--source-digest "$CANDIDATE_SHA"', '--owner Botond1'));
        }),
        mutation('negative OIDC issuer omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                '--cert-oidc-issuer "https://token.actions.githubusercontent.com"',
                '--owner Botond1'
            ));
        }),
        mutation('negative verified provenance file guard bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                '[ -f "$verified_provenance" ] && [ ! -L "$verified_provenance" ]',
                'true'
            ));
        }),
        mutation('negative provenance bundle identity bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                '[ "$(sha256sum "$PROVENANCE_BUNDLE_PATH" | awk \'{print $1}\')" = \\\n'
                    + '            "$PROVENANCE_BUNDLE_SHA256" ]',
                'true'
            ));
        }),
        mutation('negative signed subject correlation bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, 'if (!exactSubject || wrongSubject) process.exit(2);',
                'if (false) process.exit(2);'));
        }),
        mutation('wrong digest nonzero requirement bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, 'if [ "$wrong_digest_status" -eq 0 ]; then', 'if false; then'));
        }),
        mutation('wrong repository nonzero requirement bypassed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block, 'if [ "$wrong_repository_status" -eq 0 ]; then', 'if false; then'));
        }),
        mutation('negative verifier fail-closed shell restoration omitted', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(block, '          set -e\n', ''));
        }),
        mutation('negative zero-byte diagnostic sink removed', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                '--bundle "$PROVENANCE_BUNDLE_PATH" >/dev/null 2>/dev/null',
                '--bundle "$PROVENANCE_BUNDLE_PATH" >/dev/null 2>"$RUNNER_TEMP/unbounded.err"'
            ));
        }),
        mutation('negative acceptance restores diagnostic prose coupling', 'publication', (s) => {
            const block = stepText(s, 'negative_verification');
            return replaceRequired(s, block, replaceRequired(
                block,
                'echo "wrong_digest_reason=artifact_digest_policy_mismatch"',
                'grep -Fq "provided artifact digest" "$wrong_digest_error"'
            ));
        }),
        mutation('final discovery-tag identity recheck omitted', 'publication',
            (s) => removeStep(s, 'final_tag_identity')),
        mutation('final discovery-tag digest comparison omitted', 'publication', (s) => replaceRequired(
            s, '[ "$observed_digest" = "$REGISTRY_DIGEST" ]', 'true')),
        mutation('final aggregator ignores discovery-tag identity', 'publication', (s) => replaceAllRequired(
            s, 'FINAL_TAG_IDENTITY_OUTCOME: ${{ steps.final_tag_identity.outcome }}',
            'FINAL_TAG_IDENTITY_OUTCOME: ignored')),
        mutation('raw bundle uploaded', 'publication', (s) => {
            const block = stepText(s, uploadId);
            return replaceRequired(s, block, `${block}\n          path: raw-bundles/`);
        }),
        mutation('publication evidence boundary omitted', 'publication',
            (s) => removeStep(s, 'publication_evidence_boundary')),
        mutation('publication evidence boundary bypassed by upload', 'publication', (s) => {
            const block = stepText(s, 'evidence_upload');
            return replaceRequired(s, block, replaceRequired(
                block,
                "steps.publication_evidence_boundary.outcome == 'success'",
                "steps.publication_evidence.outcome == 'success'"
            ));
        }),
        mutation('final aggregator ignores publication evidence boundary', 'publication',
            (s) => replaceAllRequired(
                s,
                'PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME: ${{ steps.publication_evidence_boundary.outcome }}',
                'PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME: ignored'
            )),
        mutation('exact cleanup omitted', 'publication', (s) => removeStep(s, 'publication_cleanup')),
        mutation('wrong-digest probe artifact cleanup omitted', 'publication', (s) => replaceRequired(
            s,
            '            "$RUNNER_TEMP/i8-wrong-digest-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.bin"\n',
            ''
        )),
        mutation('attestation bundle parent containment omitted', 'publication', (s) => replaceRequired(
            s,
            '               [ "$(dirname -- "$bundle_parent_real")" != "$runner_temp_real" ] || \\\n',
            ''
        )),
        mutation('attestation bundle lexical containment omitted', 'publication', (s) => replaceRequired(
            s,
            '            case "$bundle" in "$RUNNER_TEMP"/*) ;; *) cleanup_status=1; continue ;; esac\n',
            ''
        )),
        mutation('attestation bundle file type guard omitted', 'publication', (s) => replaceRequired(
            s,
            '               [ ! -f "$bundle" ] || [ -L "$bundle" ] || \\\n',
            ''
        )),
        mutation('attestation bundle parent type guard omitted', 'publication', (s) => replaceRequired(
            s,
            '               [ ! -d "$bundle_parent" ] || [ -L "$bundle_parent" ]; then\n',
            '               false; then\n'
        )),
        mutation('attestation bundle realpath omitted', 'publication', (s) => replaceRequired(
            s,
            '            bundle_real="$(realpath -e -- "$bundle")" || {\n',
            '            bundle_real="$bundle" || {\n'
        )),
        mutation('attestation bundle parent realpath omitted', 'publication', (s) => replaceRequired(
            s,
            '            bundle_parent_real="$(realpath -e -- "$bundle_parent")" || {\n',
            '            bundle_parent_real="$bundle_parent" || {\n'
        )),
        mutation('attestation bundle file removal omitted', 'publication', (s) => replaceRequired(
            s,
            '            rm -- "$bundle" || {\n',
            '            false || {\n'
        )),
        mutation('attestation bundle parent cleanup omitted', 'publication', (s) => replaceRequired(
            s,
            '            rmdir -- "$bundle_dir" || cleanup_error bundle_parent_remove_failure\n',
            ''
        )),
        mutation('attestation bundle parent absence verification bypassed', 'publication', (s) => replaceRequired(
            s,
            '            if [ -e "$bundle_dir" ] || [ -L "$bundle_dir" ]; then\n',
            '            if false; then\n'
        )),
        mutation('local publication alias cleanup omitted', 'publication', (s) => replaceRequired(
            s,
            'for exact_ref in "$RUNTIME_IMAGE_REF" "$DIGEST_REF"; do',
            'for exact_ref in "$DIGEST_REF"; do'
        )),
        mutation('recovery cleanup deletes a preexisting local discovery tag', 'publication',
            (s) => replaceRequired(
                s,
                '              if [ "$PUBLICATION_MODE" = "publish_new" ] && \\\n'
                    + '                 [ "$LOCAL_TAG_CREATED" = "true" ] && \\\n'
                    + '                 [ "$tag_actual_id" = "$EXPECTED_LOCAL_IMAGE_ID" ]; then',
                '              if [ "$tag_actual_id" = "$EXPECTED_LOCAL_IMAGE_ID" ]; then'
            )),
        mutation('cleanup removes a reference without exact image ownership', 'publication',
            (s) => replaceRequired(
                s,
                'if [ "$actual_id" != "$EXPECTED_LOCAL_IMAGE_ID" ]; then',
                'if false; then'
            )),
        mutation('registry artifact delete added', 'publication', (s) => replaceRequired(
            s,
            'docker logout ghcr.io',
            'gh api --method DELETE repos/Botond1/3D-Printer-Slicer-API/packages/container/3d-printer-slicer-api\n'
                + '          docker logout ghcr.io'
        )),
        mutation('multiline registry artifact delete added', 'publication', (s) => replaceRequired(
            s,
            'docker logout ghcr.io',
            'gh api \\\n'
                + '            --method DELETE \\\n'
                + '            repos/Botond1/3D-Printer-Slicer-API/packages/container/3d-printer-slicer-api\n'
                + '          docker logout ghcr.io'
        )),
        mutation('final aggregator ignores registry identity', 'publication', (s) => replaceAllRequired(
            s,
            'REGISTRY_IDENTITY_OUTCOME: ${{ steps.registry_identity.outcome }}',
            'REGISTRY_IDENTITY_OUTCOME: ignored'
        )),
        mutation('final aggregator ignores registry push outcome', 'publication', (s) => replaceAllRequired(
            s,
            'PUSH_OUTCOME: ${{ steps.registry_push.outcome }}',
            'PUSH_OUTCOME: ignored'
        )),
        mutation('final aggregator swaps registry identity and digest-pull blocker labels',
            'publication', (s) => replaceRequired(
                replaceRequired(
                    replaceRequired(s, 'failed_step=registry_identity', 'failed_step=temporary_identity'),
                    'failed_step=digest_pull',
                    'failed_step=registry_identity'
                ),
                'failed_step=temporary_identity',
                'failed_step=digest_pull'
            )),
        mutation('final aggregator ignores digest runtime identity', 'publication', (s) => replaceAllRequired(
            s,
            'DIGEST_RUNTIME_IDENTITY_OUTCOME: ${{ steps.digest_runtime_identity.outcome }}',
            'DIGEST_RUNTIME_IDENTITY_OUTCOME: ignored'
        )),
        mutation('final aggregator ignores digest pull', 'publication', (s) => replaceAllRequired(
            s,
            'DIGEST_PULL_OUTCOME: ${{ steps.digest_pull.outcome }}',
            'DIGEST_PULL_OUTCOME: ignored'
        )),
        mutation('final aggregator ignores digest round trip', 'publication', (s) => replaceAllRequired(
            s,
            'DIGEST_ROUNDTRIP_OUTCOME: ${{ steps.digest_roundtrip.outcome }}',
            'DIGEST_ROUNDTRIP_OUTCOME: ignored'
        )),
        mutation('final aggregator ignores publication cleanup', 'publication', (s) => replaceAllRequired(
            s,
            'PUBLICATION_CLEANUP_OUTCOME: ${{ steps.publication_cleanup.outcome }}',
            'PUBLICATION_CLEANUP_OUTCOME: ignored'
        )),
        mutation('exact container absence proof omitted', 'publication', (s) => replaceAllRequired(
            s, 'container_cleanup_verification_failure', 'cleanup_failure')),
        mutation('exact image absence proof omitted', 'publication', (s) => replaceAllRequired(
            s, 'image_cleanup_verification_failure', 'cleanup_failure')),
        mutation('prepublication partial state omitted', 'publication', (s) => replaceAllRequired(s, 'BLOCKED_I11_PREPUBLICATION_GATE', 'publication_failure')),
        mutation('published-unattested state omitted', 'publication', (s) => replaceAllRequired(s, 'I11_CANDIDATE_PUBLISHED_UNATTESTED', 'publication_failure')),
        mutation('attestation-unverified state omitted', 'publication', (s) => replaceAllRequired(s, 'I11_CANDIDATE_ATTESTATION_UNVERIFIED', 'publication_failure')),
        mutation('final aggregator exits successfully on failure', 'publication', (s) => {
            const block = stepText(s, 'final_enforcement');
            return replaceRequired(s, block, replaceRequired(
                block,
                '            exit 1\n          fi',
                '            exit 0\n          fi'
            ));
        }),
        mutation('final aggregator omitted', 'publication', (s) => removeStep(s, 'final_enforcement'))
    ];
    for (const [name, buildMutation] of cases) await t.test(name, () => {
        assert.throws(() => validateContract(buildMutation()), assert.AssertionError);
    });
});
