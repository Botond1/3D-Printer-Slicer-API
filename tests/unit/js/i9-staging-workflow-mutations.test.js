'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    PUBLICATION_PATH,
    PUBLICATION_WORKFLOW,
    WORKFLOW,
    validateWorkflowSource
} = require('./i9-staging-workflow-contract.test');

function mutateOnce(source, from, to) {
    assert.equal(source.split(from).length - 1, 1, `mutation anchor must be unique: ${from}`);
    const result = source.replace(from, to);
    assert.notEqual(result, source);
    return result;
}

const MUTATIONS = Object.freeze([
    ['upstream workflow broadened', `      - ${PUBLICATION_WORKFLOW}`, '      - "*"'],
    ['upstream main branch broadened', '      - main\n\npermissions: {}',
        '      - "**"\n\npermissions: {}'],
    ['manual trigger added', 'on:\n  workflow_run:', 'on:\n  workflow_dispatch:\n  workflow_run:'],
    ['concurrency made SHA scoped', '  group: signed-main-candidate-ephemeral-rehearsal',
        '  group: signed-main-candidate-ephemeral-rehearsal-${{ github.sha }}'],
    ['concurrency cancellation enabled', '  cancel-in-progress: false', '  cancel-in-progress: true'],
    ['top-level contents granted', 'permissions: {}', 'permissions:\n  contents: write'],
    ['registry permission writable', '      packages: read', '      packages: write'],
    ['attestation permission writable', '      attestations: read', '      attestations: write'],
    ['workflow_run success guard removed', '[ "$UPSTREAM_CONCLUSION" != "success" ] || \\\n',
        'false || \\\n'],
    ['workflow path guard changed', `[ "$UPSTREAM_PATH" != "${PUBLICATION_PATH}" ]`,
        '[ "$UPSTREAM_PATH" != "untrusted.yml" ]'],
    ['head repository guard removed', '[ "$UPSTREAM_REPOSITORY" != "$EVENT_REPOSITORY" ]',
        'false'],
    ['upstream run API identity removed', '.head_branch == "main" and .head_sha == $sha and',
        'true and'],
    ['candidate ancestry proof removed',
        '          git merge-base --is-ancestor "$CANDIDATE_SHA" "$main_sha"\n'
            + '          run_file="$RUNNER_TEMP/publication-run-$PUBLICATION_RUN_ID.json"',
        '          true # ancestry omitted\n'
            + '          run_file="$RUNNER_TEMP/publication-run-$PUBLICATION_RUN_ID.json"'],
    ['main refresh truncates ancestry history',
        '          git fetch --no-tags origin refs/heads/main\n'
            + '          [ "$(git rev-parse --is-shallow-repository)" = "false" ]\n'
            + '          main_sha="$(git rev-parse FETCH_HEAD)"\n'
            + '          [[ "$main_sha" =~ ^[0-9a-f]{40}$ ]]',
        '          git fetch --no-tags --depth=1 origin refs/heads/main\n'
            + '          [ "$(git rev-parse --is-shallow-repository)" = "false" ]\n'
            + '          main_sha="$(git rev-parse FETCH_HEAD)"\n'
            + '          [[ "$main_sha" =~ ^[0-9a-f]{40}$ ]]'],
    ['non-shallow history proof removed',
        '          [ "$(git rev-parse --is-shallow-repository)" = "false" ]\n'
            + '          main_sha="$(git rev-parse FETCH_HEAD)"\n'
            + '          [[ "$main_sha" =~ ^[0-9a-f]{40}$ ]]',
        '          true # non-shallow proof omitted\n'
            + '          main_sha="$(git rev-parse FETCH_HEAD)"\n'
            + '          [[ "$main_sha" =~ ^[0-9a-f]{40}$ ]]'],
    ['artifact uniqueness weakened', '.total_count == 1 and (.artifacts | length) == 1',
        '.total_count >= 1 and (.artifacts | length) >= 1'],
    ['artifact size cap removed',
        '.artifacts[0].size_in_bytes > 0 and .artifacts[0].size_in_bytes <= 136314880',
        '.artifacts[0].size_in_bytes > 0'],
    ['artifact digest syntax removed',
        '(.artifacts[0].digest | test("^sha256:[0-9a-f]{64}$"))',
        '(.artifacts[0].digest | type == "string")'],
    ['downloaded archive digest ignored',
        '          [ "$archive_digest" = "$PUBLICATION_ARTIFACT_DIGEST" ]',
        '          true # artifact digest ignored'],
    ['artifact allowlist accepts extras',
        'if len(names) != len(set(names)) or sorted(names) != sorted(limits):',
        'if len(names) != len(set(names)):'],
    ['artifact symlinks accepted',
        'or info.is_dir() or mode == stat.S_IFLNK or info.flag_bits & 0x1 \\\n',
        'or info.is_dir() or info.flag_bits & 0x1 \\\n'],
    ['rehearsal input materializer bypassed', '          node scripts/release-rehearsal-input.js',
        '          true # materializer bypassed'],
    ['candidate image becomes mutable',
        'CURRENT_IMAGE_REF: `${manifest.repository}@${manifest.candidate.digest}`',
        'CURRENT_IMAGE_REF: `${manifest.repository}:latest`'],
    ['previous image becomes mutable',
        'PREVIOUS_IMAGE_REF: `${manifest.repository}@${manifest.previous.digest}`',
        'PREVIOUS_IMAGE_REF: `${manifest.repository}:latest`'],
    ['digest manifest hash check removed', '            [ "$digest_hash" = "$expected_digest" ]',
        '            true # digest hash omitted'],
    ['config digest binding removed', 'raw?.config?.digest !== process.env.EXPECTED_CONFIG',
        'raw?.config?.digest === process.env.EXPECTED_CONFIG'],
    ['linux platform binding removed', "image?.os !== 'linux' || image?.architecture !== 'amd64'",
        'false'],
    ['non-root image user binding removed', "image?.config?.User !== 'slicer'", 'false'],
    ['candidate attestation verification removed',
        '          verify_candidate candidate "$CURRENT_SOURCE_SHA" "$CANDIDATE_SOURCE_REF" \\\n',
        '          true # candidate verification omitted \\\n'],
    ['previous attestation verification removed',
        '          verify_candidate previous "$PREVIOUS_SOURCE_SHA" "$PREVIOUS_SOURCE_REF" \\\n',
        '          true # previous verification omitted \\\n'],
    ['provenance predicate replaced', '                predicate="https://slsa.dev/provenance/v1"',
        '                predicate="https://example.invalid/provenance"'],
    ['SPDX predicate replaced', '                predicate="https://spdx.dev/Document/v2.3"',
        '                predicate="https://example.invalid/sbom"'],
    ['OCI verification removed', ' --bundle-from-oci > \\\n', ' > \\\n'],
    ['per-image signer workflow ignored',
        'local cert_identity="https://github.com/$GITHUB_REPOSITORY/$signer_workflow@$source_ref"',
        'local cert_identity="https://github.com/$GITHUB_REPOSITORY/untrusted.yml@$source_ref"'],
    ['signer digest removed', '--signer-digest "$source_sha"', '--signer-workflow ignored'],
    ['source digest removed', '--source-digest "$source_sha"', '--source-ref "$source_ref"'],
    ['OIDC issuer removed', '--cert-oidc-issuer "https://token.actions.githubusercontent.com"',
        '--format json'],
    ['attestation result size cap removed',
        '                    || stat.size > MAX_VERIFICATION_RESULT_BYTES\n', ''],
    ['verification cleanup loses always',
        '        id: verification_cleanup\n        if: ${{ always() }}',
        '        id: verification_cleanup\n        if: ${{ success() }}'],
    ['verification cleanup allowlist broadened',
        "allowed='^(candidate|previous)-(digest-raw|digest-summary|provenance-api|provenance-oci|sbom-api|sbom-oci)\\.json$'",
        "allowed='.*'"],
    ['runtime digest pull made mutable', '          docker pull "$CURRENT_IMAGE_REF" >/dev/null',
        '          docker pull "$REGISTRY_REPOSITORY:latest" >/dev/null'],
    ['runtime network isolation removed',
        '            uid="$(timeout 20s docker run --rm --name "$probe_name" --pull never \\\n'
            + '              --network none --read-only --cap-drop ALL \\\n',
        '            uid="$(timeout 20s docker run --rm --name "$probe_name" --pull never \\\n'
            + '              --network bridge --read-only --cap-drop ALL \\\n'],
    ['service identity allows root',
        '          [ "$service_uid" != "0" ] && [ "$service_gid" != "0" ]',
        '          true # root accepted'],
    ['state ownership made world writable', '              -m 0700 -- "$stage_root/$name"',
        '              -m 0777 -- "$stage_root/$name"'],
    ['runtime cleanup loses always',
        '        id: runtime_post_cleanup\n        if: ${{ always() }}',
        '        id: runtime_post_cleanup\n        if: ${{ success() }}'],
    ['runtime cleanup reads an unset candidate ref',
        '          current_image_ref="${CURRENT_IMAGE_REF-}"',
        '          current_image_ref="$CURRENT_IMAGE_REF"'],
    ['runtime cleanup accepts a partial identity tuple',
        '          elif [ "$runtime_identity_count" -ne 0 ]; then',
        '          elif [ "$runtime_identity_count" -lt 0 ]; then'],
    ['runtime cleanup removes images without a complete valid identity tuple',
        '          if [ "$runtime_identity_ready" -eq 1 ]; then\n'
            + '            for image_ref in "$current_image_ref" "$previous_image_ref"; do',
        '          if true; then\n'
            + '            for image_ref in "$current_image_ref" "$previous_image_ref"; do'],
    ['runtime cleanup accepts an owned container without digest identities',
        '            if [ "$runtime_identity_ready" -ne 1 ]; then return 1; fi',
        '            true # missing identity accepted'],
    ['runtime cleanup loses run ownership',
        '                [ "$run_label" = "$GITHUB_RUN_ID" ] || return 1',
        '                true # ownership omitted'],
    ['runtime cleanup removes by reusable name',
        '            docker container rm --force "$container_id" >/dev/null || return 1',
        '            docker container rm --force "$reference" >/dev/null || return 1'],
    ['runtime cleanup loses network ownership',
        '               [ "$network_project" != "i9-s3b-rehearsal" ] || \\\n',
        '               false || \\\n'],
    ['rehearsal helper bypassed', '          node scripts/i9-staging-rollback-rehearsal.js',
        '          true # rehearsal bypassed'],
    ['evidence writer bypassed', '          node scripts/write-staging-rehearsal-evidence.js',
        '          true # evidence writer bypassed'],
    ['evidence loses publication artifact correlation',
        '            publication_artifact_digest: manifest.artifact.artifact_digest,',
        '            publication_artifact_digest: process.env.PUBLICATION_ARTIFACT_DIGEST,'],
    ['upload permits missing evidence', '          if-no-files-found: error',
        '          if-no-files-found: ignore'],
    ['evidence cleanup loses always',
        '        id: evidence_cleanup\n        if: ${{ always() }}',
        '        id: evidence_cleanup\n        if: ${{ success() }}'],
    ['publication artifact cleanup allowlist broadened',
        "artifact_allowed='^(i11-main-candidate-provenance\\.json|image-identity\\.txt|runtime-diagnostics\\.json|topology-evidence\\.json|sbom\\.spdx\\.json|grype\\.json)$'",
        "artifact_allowed='.*'"],
    ['final enforcement no longer always runs',
        '        id: final_enforcement\n        if: ${{ always() }}',
        '        id: final_enforcement\n        if: ${{ success() }}'],
    ['failure exit removed',
        '            echo "::error title=Signed main candidate rehearsal::$classification"\n            exit 1',
        '            echo "$classification"']
]);

test('every security-sensitive I11 workflow mutation is rejected', async (t) => {
    for (const [name, from, to] of MUTATIONS) await t.test(name, () => {
        const mutated = mutateOnce(WORKFLOW, from, to);
        assert.throws(() => validateWorkflowSource(mutated));
    });
});

test('forbidden publication and deployment surfaces are rejected independently', async (t) => {
    const insertion = '      - name: Re-prove the protected-main source boundary\n';
    for (const [name, command] of [
        ['registry push', 'docker push "$CURRENT_IMAGE_REF"'],
        ['image build', 'docker build -t mutable .'],
        ['remote shell', 'ssh production.invalid true'],
        ['release', 'gh release create mutable']
    ]) await t.test(name, () => {
        const injected = mutateOnce(WORKFLOW, insertion,
            `${insertion}        run: ${command}\n`);
        assert.throws(() => validateWorkflowSource(injected));
    });
});
