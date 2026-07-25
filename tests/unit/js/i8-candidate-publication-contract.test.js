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
const BASELINE_SHA = 'c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6';
const BRANCH = 'codex/i8-s3a-ghcr-signed-candidate';
const GHCR_REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const GITHUB_REPOSITORY = 'Botond1/3D-Printer-Slicer-API';
const CONFIRMATION = 'PUBLISH_I8_SIGNED_GHCR_CANDIDATE';
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
    assert.deepEqual(directKeys(trigger), ['workflow_dispatch'], 'publication is manual-only');
    const dispatch = mappingBlock(publication, 'workflow_dispatch', 2);
    const inputs = mappingBlock(dispatch.text, 'inputs', 4);
    const inputKeys = directKeys(inputs);
    assert.ok([
        JSON.stringify(['candidate_sha', 'confirmation']),
        JSON.stringify(['candidate_sha', 'confirmation', 'registry_repository'])
    ].includes(JSON.stringify(inputKeys)), 'only exact authorization inputs are accepted');
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
        CONFIRMATION, '^[0-9a-f]{40}$', 'cancel-in-progress: false',
        'git merge-base --is-ancestor', 'persist-credentials: false', 'fetch-depth: 0'
    ], 'preflight');

    assert.deepEqual(directKeys(mappingBlock(publication, 'jobs', 0)), ['preflight', 'publication']);
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
    assert.doesNotMatch(publication, /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)|\benvironment:|docker\s+(?:system|image|container)\s+prune\b|docker\s+(?:manifest|image)\s+(?:rm|delete)\b.*ghcr\.io|(?:latest|staging|production|release):/i);

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
        'id: digest_roundtrip', 'docker pull "$DIGEST_REF"',
        'node scripts/i7-production-compose-contract.js'
    ], 'registry identity');
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
    requireIncludes(stepText(publication, 'negative_verification'), [
        'wrong_digest', 'wrong_repository', 'gh attestation verify',
        'wrong_digest_status', 'wrong_repository_status',
        'provided artifact digest does not match any digest in statement',
        'expected SourceRepositoryURI to be https://github.com/Botond1/3D-Printer-Slicer-API-wrong',
        'wrong_digest_reason=artifact_digest_policy_mismatch',
        'wrong_repository_reason=source_repository_uri_policy_mismatch'
    ], 'negative verification');

    const evidence = stepText(publication, 'publication_evidence');
    requireIncludes(evidence, [
        'scripts/i8-write-publication-evidence.js', 'i8-s3a-signed-candidate-provenance-v2',
        'registry_digest', 'bundle_sha256'
    ], 'publication evidence');
    const evidenceBoundary = stepText(publication, 'publication_evidence_boundary');
    const boundaryFiles = [...evidenceBoundary.matchAll(
        /^\s+\['([^']+)',\s*[^\]]+\],?$/gm
    )].map((match) => match[1]).sort();
    assert.deepEqual(boundaryFiles, [
        'grype.json', 'grype.yaml', 'i8-candidate-provenance.json',
        'i8-publication-draft.json', 'image-identity.txt', 'runtime-diagnostics.json',
        'sbom.spdx.json', 'syft.yaml', 'topology-evidence.json'
    ], 'publication evidence boundary has the exact nine-file allowlist');
    requireIncludes(evidenceBoundary, [
        'fs.realpathSync(root) !== root', 'fs.lstatSync(root).isSymbolicLink()',
        'JSON.stringify(actual) !== JSON.stringify(expected)',
        '!details.isFile()', 'details.isSymbolicLink()',
        'path.dirname(fs.realpathSync(target)) !== root',
        "['i8-publication-draft.json', 96 * 1024]",
        "['i8-candidate-provenance.json', 96 * 1024]",
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
        'BLOCKED_I8_PREPUBLICATION_GATE', 'I8_CANDIDATE_PUBLISHED_UNATTESTED',
        'I8_CANDIDATE_ATTESTATION_UNVERIFIED', 'id: publication_cleanup',
        'id: final_enforcement', 'if: ${{ always() }}', 'I8_PUBLICATION_INFRASTRUCTURE_FAILURE',
        'cleanup_failure'
    ], 'partial-state/final enforcement');
    const registryPush = stepText(publication, 'registry_push');
    assert.ok(registryPush.indexOf('docker push "$TAG_REF"')
        < registryPush.indexOf('remote_publication_state=matching'),
    'remote publication is observed only after the push attempt');
    requireIncludes(registryPush, [
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
        'i8-digest-identity-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.txt',
        'i8-final-tag-raw-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json',
        'i8-wrong-digest-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.err',
        'i8-wrong-repository-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.err',
        'created_attestation_paths.txt',
        'exact_container_cleanup "$I8_DIGEST_CONTAINER_NAME"',
        'exact_container_cleanup "$I2_UID_PROBE_NAME"',
        'exact_container_cleanup "$I2_GID_PROBE_NAME"',
        'exact_container_cleanup "$I2_ORCA_PROBE_NAME"',
        'docker logout ghcr.io'
    ], 'publication cleanup');
    assert.doesNotMatch(cleanup, /\bdocker\s+(?:system|image|container|builder|volume)\s+prune\b/);
    const final = stepText(publication, 'final_enforcement');
    requireIncludes(final, [
        'REMOTE_PUBLISHED: ${{ steps.registry_push.outputs.remote_published }}',
        '[ "$REMOTE_PUBLISHED" = "matching" ]',
        '[ "$REMOTE_PUBLISHED" != "matching" ]',
        'FINAL_TAG_IDENTITY_OUTCOME: ${{ steps.final_tag_identity.outcome }}',
        '[ "$FINAL_TAG_IDENTITY_OUTCOME" != "success" ]',
        'PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME: ${{ steps.publication_evidence_boundary.outcome }}',
        '[ "$PUBLICATION_EVIDENCE_BOUNDARY_OUTCOME" != "success" ]',
        'classification=BLOCKED_I8_PREPUBLICATION_GATE'
    ], 'partial publication classification');
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

test('Candidate Publication is manual, least-privilege, build-once, digest-bound, and fail-closed', () => {
    validateContract(ORIGINAL);
});

test('publication authorization, identity, attestation, evidence, and cleanup mutations fail closed', async (t) => {
    const loginId = stepIdContaining(ORIGINAL.publication, LOGIN_ACTION);
    const uploadId = stepIdContaining(ORIGINAL.publication, 'actions/upload-artifact@');
    const cases = [
        mutation('non-manual trigger', 'publication', (s) => s.replace('on:\n', 'on:\n  push:\n')),
        mutation('wrong target branch', 'publication', (s) => replaceAllRequired(s, BRANCH, 'main')),
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
        mutation('different build config accepted', 'publication', (s) => replaceAllRequired(
            s, 'configDigest !== process.env.EXPECTED_LOCAL_IMAGE_ID',
            'configDigest === process.env.EXPECTED_LOCAL_IMAGE_ID')),
        mutation('local image ID used as registry digest', 'publication', (s) => replaceRequired(
            s, 'subject-digest: ${{ steps.registry_push.outputs.registry_digest }}',
            'subject-digest: ${{ steps.exact_image_gate.outputs.image-id }}')),
        mutation('tag used instead of attested digest', 'publication', (s) => replaceRequired(
            s, 'subject-digest: ${{ steps.registry_push.outputs.registry_digest }}',
            'subject-digest: ${{ steps.candidate.outputs.candidate_tag }}')),
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
        mutation('OCI verification omitted', 'publication', (s) => replaceAllRequired(s, '--bundle-from-oci', '--format')),
        mutation('offline verification omitted', 'publication', (s) => replaceRequired(s, '--bundle', '--format')),
        mutation('negative checks omitted', 'publication', (s) => removeStep(s, 'negative_verification')),
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
        mutation('exact container absence proof omitted', 'publication', (s) => replaceAllRequired(
            s, 'container_cleanup_verification_failure', 'cleanup_failure')),
        mutation('exact image absence proof omitted', 'publication', (s) => replaceAllRequired(
            s, 'image_cleanup_verification_failure', 'cleanup_failure')),
        mutation('prepublication partial state omitted', 'publication', (s) => replaceAllRequired(s, 'BLOCKED_I8_PREPUBLICATION_GATE', 'publication_failure')),
        mutation('published-unattested state omitted', 'publication', (s) => replaceAllRequired(s, 'I8_CANDIDATE_PUBLISHED_UNATTESTED', 'publication_failure')),
        mutation('attestation-unverified state omitted', 'publication', (s) => replaceAllRequired(s, 'I8_CANDIDATE_ATTESTATION_UNVERIFIED', 'publication_failure')),
        mutation('final aggregator omitted', 'publication', (s) => removeStep(s, 'final_enforcement'))
    ];
    for (const [name, buildMutation] of cases) await t.test(name, () => {
        assert.throws(() => validateContract(buildMutation()), assert.AssertionError);
    });
});
