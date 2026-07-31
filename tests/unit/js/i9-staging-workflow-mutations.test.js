'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    CURRENT_DIGEST,
    PREVIOUS_DIGEST,
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
    ['branch broadened', '      - codex/i9-s3b-staging-rollback-foundation', '      - "codex/**"'],
    ['main trigger added', '    branches:\n', '    branches:\n      - main\n'],
    ['concurrency made SHA scoped', '  group: i9-s3b-ephemeral-staging-rollback',
        '  group: i9-s3b-ephemeral-staging-rollback-${{ github.sha }}'],
    ['concurrency cancellation enabled', '  cancel-in-progress: false', '  cancel-in-progress: true'],
    ['top-level contents granted', 'permissions:\n  contents: none', 'permissions:\n  contents: write'],
    ['registry permission writable', '      packages: read', '      packages: write'],
    ['attestation permission writable', '      attestations: read', '      attestations: write'],
    ['actor check removed', '[ "$EVENT_ACTOR" != "Botond1" ] || \\\n', 'false || \\\n'],
    ['exact trailer weakened', 'I9-Rehearsal: RUN_I9_EPHEMERAL_STAGING_ROLLBACK',
        'I9-Rehearsal: RUN'],
    ['remote branch head check removed', '          [ "$remote_sha" = "$REHEARSAL_SHA" ]',
        '          true # remote identity omitted'],
    ['baseline ancestry removed',
        '          git merge-base --is-ancestor "$I9_BASELINE_SHA" "$REHEARSAL_SHA"',
        '          true # baseline ancestry omitted'],
    ['runtime source drift allowed',
        '          git diff --quiet "$CURRENT_SOURCE_SHA" "$REHEARSAL_SHA" -- \\\n',
        '          true # runtime source drift ignored \\\n'],
    ['current digest changed', `CURRENT_REGISTRY_DIGEST: ${CURRENT_DIGEST}`,
        `CURRENT_REGISTRY_DIGEST: ${PREVIOUS_DIGEST}`],
    ['previous digest changed', `PREVIOUS_REGISTRY_DIGEST: ${PREVIOUS_DIGEST}`,
        `PREVIOUS_REGISTRY_DIGEST: ${CURRENT_DIGEST}`],
    ['tag manifest proof removed',
        '            docker buildx imagetools inspect "$tag_ref" --raw > "$tag_raw"',
        '            cp "$digest_raw" "$tag_raw"'],
    ['raw manifest equality removed', '            cmp -- "$tag_raw" "$digest_raw"',
        '            true # manifest equality omitted'],
    ['current attestation verification removed',
        '          verify_candidate current "$CURRENT_SOURCE_SHA" "$CURRENT_REGISTRY_DIGEST"',
        '          true # current verification omitted'],
    ['previous attestation verification removed',
        '          verify_candidate previous "$PREVIOUS_SOURCE_SHA" "$PREVIOUS_REGISTRY_DIGEST"',
        '          true # previous verification omitted'],
    ['provenance predicate replaced', '                predicate="https://slsa.dev/provenance/v1"',
        '                predicate="https://example.invalid/untrusted/v1"'],
    ['SPDX predicate replaced', '                predicate="https://spdx.dev/Document/v2.3"',
        '                predicate="https://example.invalid/sbom/v1"'],
    ['OCI verification removed', ' --bundle-from-oci >', ' >'],
    ['signer digest removed', '--signer-digest "$source_sha"', '--signer-workflow ignored'],
    ['source digest removed', '--source-digest "$source_sha"', '--source-ref "$CANDIDATE_WORKFLOW_REF"'],
    ['OIDC issuer removed', '--cert-oidc-issuer "https://token.actions.githubusercontent.com"',
        '--format json'],
    ['signed subject digest not compared',
        '&& subject?.digest?.sha256 === candidate.digest.slice(7)',
        '&& subject?.digest?.sha256'],
    ['attestation verification cap too small',
        'const MAX_VERIFICATION_RESULT_BYTES = 32 * 1024 * 1024;',
        'const MAX_VERIFICATION_RESULT_BYTES = 512 * 1024;'],
    ['attestation verification cap removed',
        '                    || stat.size > MAX_VERIFICATION_RESULT_BYTES\n',
        ''],
    ['verification cleanup weakened', '            rmdir -- "$verification_dir" || status=1',
        '            true # verification directory retained'],
    ['manifest contract bypassed',
        '          node -e "require(\'./scripts/i9-staging-manifest\').loadStagingManifest(process.cwd())"',
        '          true # manifest validation bypassed'],
    ['digest pull made mutable', '          docker pull "$CURRENT_IMAGE_REF" >/dev/null',
        '          docker pull "$REGISTRY_REPOSITORY:latest" >/dev/null'],
    ['service identity allows root', '          [ "$service_uid" != "0" ] && [ "$service_gid" != "0" ]',
        '          true # root identity accepted'],
    ['runtime network isolation removed',
        '            uid="$(timeout 20s docker run --rm --name "$probe_name" --pull never \\\n              --network none',
        '            uid="$(timeout 20s docker run --rm --name "$probe_name" --pull never \\\n              --network bridge'],
    ['state ownership made world writable', '              -m 0700 -- "$stage_root/$name"',
        '              -m 0777 -- "$stage_root/$name"'],
    ['inert credential entropy removed', '          slice_key="$(openssl rand -hex 32)"',
        '          slice_key="inert"'],
    ['post cleanup loses always', '        id: runtime_post_cleanup\n        if: ${{ always() }}',
        '        id: runtime_post_cleanup\n        if: ${{ success() }}'],
    ['post cleanup loses run ownership',
        '                [ "$run_label" = "$GITHUB_RUN_ID" ] || return 1',
        '                true # run ownership omitted'],
    ['post cleanup removes by reusable name',
        '            docker container rm --force "$container_id" >/dev/null || return 1',
        '            docker container rm --force "$reference" >/dev/null || return 1'],
    ['post cleanup loses network ownership',
        '               [ "$network_project" != "i9-s3b-rehearsal" ] || \\',
        '               false || \\'],
    ['post cleanup retains digest references',
        '              docker image rm "$image_ref" >/dev/null || status=1',
        '              true # digest reference retained'],
    ['rehearsal helper bypassed', '          node scripts/i9-staging-rollback-rehearsal.js',
        '          true # rehearsal bypassed'],
    ['evidence writer bypassed', '          node scripts/i9-write-staging-evidence.js',
        '          true # evidence bypassed'],
    ['upload permits missing evidence', '          if-no-files-found: error',
        '          if-no-files-found: ignore'],
    ['evidence overwrite enabled', '          overwrite: false', '          overwrite: true'],
    ['final enforcement no longer always runs',
        '        if: ${{ always() }}\n        env:\n          REGISTRY_LOGIN_OUTCOME:',
        '        if: ${{ success() }}\n        env:\n          REGISTRY_LOGIN_OUTCOME:'],
    ['failure exit removed',
        '            echo "::error title=I9 rehearsal::$classification"\n            exit 1',
        '            echo "$classification"']
]);

test('every security-sensitive I9 workflow mutation is rejected', async (t) => {
    for (const [name, from, to] of MUTATIONS) await t.test(name, () => {
        const mutated = mutateOnce(WORKFLOW, from, to);
        assert.throws(() => validateWorkflowSource(mutated));
    });
});

test('forbidden deployment surfaces are rejected independently', async (t) => {
    const insertion = '      - name: Re-prove source and immutable candidate identities\n';
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
