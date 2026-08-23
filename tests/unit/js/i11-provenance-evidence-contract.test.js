'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    EVIDENCE_KEYS,
    EXACT_GHCR_REPOSITORY,
    EXACT_REPOSITORY_SLUG,
    EXACT_SOURCE_REF,
    EXACT_SOURCE_REPOSITORY,
    EXACT_WORKFLOW,
    EXACT_WORKFLOW_PATH,
    MAX_EVIDENCE_BYTES,
    PROVENANCE_PREDICATE,
    SCHEMA_VERSION,
    SIGSTORE_ISSUER,
    SPDX_PREDICATE,
    buildPublicationEvidence,
    validatePublicationEvidence
} = require('../../../scripts/i11-publication-evidence');

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const HASH_F = 'f'.repeat(64);
const LOCAL_ID = `sha256:${HASH_A}`;
const REGISTRY_DIGEST = `sha256:${HASH_B}`;
const DISCOVERY_TAG = `candidate-${SOURCE_SHA}`;
const SUBJECT = `${EXACT_GHCR_REPOSITORY}@${REGISTRY_DIGEST}`;

function attestation(kind) {
    const provenance = kind === 'provenance';
    return {
        id: provenance ? '123456789' : '987654321',
        url: `https://github.com/${EXACT_REPOSITORY_SLUG}/attestations/${
            provenance ? '123456789' : '987654321'
        }`,
        bundle_sha256: provenance ? HASH_E : HASH_F,
        predicate_type: provenance ? PROVENANCE_PREDICATE : SPDX_PREDICATE,
        subject_name: EXACT_GHCR_REPOSITORY,
        subject_digest: REGISTRY_DIGEST,
        signer_repository: EXACT_REPOSITORY_SLUG,
        signer_workflow: EXACT_WORKFLOW_PATH,
        source_ref: EXACT_SOURCE_REF,
        source_digest: SOURCE_SHA,
        push_to_registry: true,
        github_api_verified: true,
        oci_verified: true,
        offline_bundle_verified: true,
        signature_verified: true,
        verification_reason: 'success'
    };
}

function validInput() {
    return {
        schema_version: SCHEMA_VERSION,
        source: {
            repository: EXACT_SOURCE_REPOSITORY,
            repository_slug: EXACT_REPOSITORY_SLUG,
            sha: SOURCE_SHA,
            ref: EXACT_SOURCE_REF
        },
        workflow: {
            name: EXACT_WORKFLOW,
            path: EXACT_WORKFLOW_PATH,
            run_id: '30160000001',
            run_attempt: '1',
            job: 'publish-candidate'
        },
        build_inputs: {
            dockerfile_sha256: HASH_C,
            package_json_sha256: HASH_D,
            package_lock_sha256: HASH_E,
            platform: 'linux/amd64',
            build_count: 1
        },
        image: {
            local_id: LOCAL_ID,
            identity_scope: 'run_local_config_digest_not_registry_manifest',
            configured_user: 'slicer',
            service_uid: '999',
            service_gid: '999'
        },
        registry: {
            repository: EXACT_GHCR_REPOSITORY,
            discovery_tag: DISCOVERY_TAG,
            digest: REGISTRY_DIGEST,
            subject: SUBJECT,
            manifest_digest: REGISTRY_DIGEST,
            config_digest: LOCAL_ID,
            source_revision: SOURCE_SHA,
            platform: 'linux/amd64',
            configured_user: 'slicer',
            tag_points_to_digest: true
        },
        sbom: {file_sha256: HASH_C, spdx_version: 'SPDX-2.3'},
        scanner: {
            file_sha256: HASH_D,
            name: 'grype',
            version: '0.110.0',
            database_timestamp: '2026-07-25T06:59:38Z',
            high: 0,
            critical: 0,
            known_swiper_advisory: 0
        },
        gates: {
            runtime_identity: true,
            orca_cli_smoke: true,
            browser_smoke: true,
            live_abort_no_artifact: true,
            private_peer: true,
            no_host_port: true,
            no_default_route: true,
            api_egress_denied: true,
            native_egress_denied: true,
            sbom: true,
            grype: true,
            artifact_boundary: true,
            prepublication_complete: true
        },
        round_trip: {
            local_image_removed_before_pull: true,
            pulled_by_digest: true,
            pulled_image_id: LOCAL_ID,
            pulled_config_matches_build: true,
            kernel_uid: '999',
            kernel_gid: '999',
            liveness: true,
            orca_cli_smoke: true,
            production_compose_digest: true,
            tag_digest_match: true
        },
        attestations: {
            provenance: attestation('provenance'),
            sbom: attestation('sbom')
        },
        verification: {
            issuer: SIGSTORE_ISSUER,
            certificate_identity:
                `${EXACT_SOURCE_REPOSITORY}/${EXACT_WORKFLOW_PATH}@${EXACT_SOURCE_REF}`,
            exact_digest: true,
            exact_repository: true,
            exact_workflow: true,
            exact_ref: true,
            exact_source: true,
            wrong_digest_rejected: true,
            wrong_repository_rejected: true,
            result: 'success'
        },
        publication: {
            gate_completed_before_login: true,
            tag_absent_before_push: true,
            same_image_pushed: true,
            second_build_absent: true,
            mutable_tag_absent: true,
            overwrite_absent: true,
            remote_digest_preserved: true,
            status: 'published_attested_verified',
            mode: 'publish_new',
            existing_exact_digest_verified: false,
            candidate_manifest_write_performed: true
        },
        cleanup: {
            containers_removed: true,
            networks_removed: true,
            local_tags_removed: true,
            local_digest_image_removed: true,
            temporary_bundles_removed: true,
            bounded_evidence_only: true,
            remote_candidate_preserved: true,
            result: 'success'
        },
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only',
            result: 'I11_MAIN_CANDIDATE_EVIDENCE_READY'
        },
        deployed_digest: 'not_applicable_no_deploy'
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function rejected(value, expected = {}) {
    const result = validatePublicationEvidence(value, expected);
    assert.equal(typeof result, 'string');
    assert.match(result, /^[a-z][a-z0-9_]*$/);
}

test('I11 v1 builder emits a deeply frozen bounded exact-key publication record', () => {
    const evidence = buildPublicationEvidence(validInput());
    assert.equal(validatePublicationEvidence(evidence), null);
    assert.equal(evidence.schema_version, 'i11-main-signed-candidate-provenance-v1');
    assert.ok(Object.isFrozen(evidence));
    assert.ok(Object.isFrozen(evidence.registry));
    assert.ok(Object.isFrozen(evidence.attestations.provenance));
    assert.ok(Buffer.byteLength(`${JSON.stringify(evidence, null, 2)}\n`) <= MAX_EVIDENCE_BYTES);
    for (const key of EVIDENCE_KEYS.root) assert.ok(Object.hasOwn(evidence, key));
    assert.deepEqual(Object.keys(evidence).sort(), [...EVIDENCE_KEYS.root].sort());
    for (const key of [
        'source', 'workflow', 'build_inputs', 'image', 'registry', 'sbom',
        'scanner', 'gates', 'round_trip', 'verification', 'publication',
        'cleanup', 'aggregator'
    ]) {
        assert.deepEqual(Object.keys(evidence[key]).sort(), [...EVIDENCE_KEYS[key]].sort());
    }
    assert.deepEqual(
        Object.keys(evidence.attestations).sort(), [...EVIDENCE_KEYS.attestations].sort()
    );
    assert.deepEqual(
        Object.keys(evidence.attestations.provenance).sort(),
        [...EVIDENCE_KEYS.attestation].sort()
    );
});

test('I11 v1 builder rejects invalid inputs and severs caller-owned mutable state', () => {
    for (const input of [null, [], 'publication', 1]) {
        assert.throws(() => buildPublicationEvidence(input), TypeError);
    }
    const input = validInput();
    const evidence = buildPublicationEvidence(input);
    input.gates.prepublication_complete = false;
    assert.equal(evidence.gates.prepublication_complete, true);
});

test('fresh publication and exact-digest recovery have distinct fail-closed evidence', () => {
    const recovery = validInput();
    Object.assign(recovery.publication, {
        mode: 'recover_exact_digest',
        tag_absent_before_push: false,
        same_image_pushed: false,
        existing_exact_digest_verified: true,
        candidate_manifest_write_performed: false,
        status: 'recovered_attested_verified'
    });
    assert.equal(validatePublicationEvidence(recovery), null);
    assert.ok(Object.isFrozen(buildPublicationEvidence(recovery)));

    const cases = [
        (x) => { x.publication.mode = 'overwrite'; },
        (x) => { x.publication.existing_exact_digest_verified = false; },
        (x) => { x.publication.candidate_manifest_write_performed = true; },
        (x) => { x.publication.tag_absent_before_push = true; },
        (x) => { x.publication.same_image_pushed = true; },
        (x) => { x.publication.status = 'published_attested_verified'; },
        (x) => { x.schema_version = 'i8-s3a-signed-candidate-provenance-v2'; },
        (x) => { x.aggregator.result = 'I8_CANDIDATE_EVIDENCE_READY'; }
    ];
    for (const mutate of cases) {
        const value = clone(recovery);
        mutate(value);
        rejected(value);
    }
});

test('schema rejects missing, extra, malformed, and oversized state', async (t) => {
    const base = validInput();
    const cases = [
        ['not object', null],
        ['missing root', (() => { const x = clone(base); delete x.registry; return x; })()],
        ['extra root', {...clone(base), raw_bundle: 'forbidden'}],
        ['missing nested', (() => { const x = clone(base); delete x.registry.digest; return x; })()],
        ['extra nested', (() => { const x = clone(base); x.verification.certificate = {}; return x; })()],
        ['wrong version', {...clone(base), schema_version: `${SCHEMA_VERSION}-next`}],
        ['oversized', (() => {
            const x = clone(base);
            x.attestations.provenance.url = `https://github.com/${'x'.repeat(MAX_EVIDENCE_BYTES)}`;
            return x;
        })()]
    ];
    for (const [name, value] of cases) await t.test(name, () => rejected(value));
});

test('source, workflow, build, repository, tag, and digest identities fail closed', async (t) => {
    const mutations = [
        ['short source SHA', (x) => { x.source.sha = SOURCE_SHA.slice(0, -1); }],
        ['uppercase source SHA', (x) => { x.source.sha = SOURCE_SHA.toUpperCase(); }],
        ['source repository', (x) => { x.source.repository += '-fork'; }],
        ['source slug', (x) => { x.source.repository_slug = 'other/repository'; }],
        ['source ref', (x) => { x.source.ref = 'refs/heads/codex/i8-s3a-ghcr-signed-candidate'; }],
        ['workflow name', (x) => { x.workflow.name = 'Other'; }],
        ['workflow path', (x) => { x.workflow.path = '.github/workflows/other.yml'; }],
        ['workflow job', (x) => { x.workflow.job = 'job with spaces'; }],
        ['Dockerfile hash', (x) => { x.build_inputs.dockerfile_sha256 = 'short'; }],
        ['lock hash uppercase', (x) => { x.build_inputs.package_lock_sha256 = HASH_E.toUpperCase(); }],
        ['platform', (x) => { x.build_inputs.platform = 'linux/arm64'; }],
        ['second build', (x) => { x.build_inputs.build_count = 2; }],
        ['local ID short', (x) => { x.image.local_id = 'sha256:abc'; }],
        ['local ID uppercase', (x) => { x.image.local_id = `sha256:${HASH_A.toUpperCase()}`; }],
        ['local scope', (x) => { x.image.identity_scope = 'registry_digest'; }],
        ['registry repository', (x) => { x.registry.repository = 'ghcr.io/other/repo'; }],
        ['mutable tag', (x) => { x.registry.discovery_tag = 'latest'; }],
        ['short tag', (x) => { x.registry.discovery_tag = `candidate-${SOURCE_SHA.slice(0, 12)}`; }],
        ['tag as digest', (x) => { x.registry.digest = DISCOVERY_TAG; }],
        ['uppercase digest', (x) => { x.registry.digest = `sha256:${HASH_B.toUpperCase()}`; }],
        ['short digest', (x) => { x.registry.digest = 'sha256:abcd'; }],
        ['tagged subject', (x) => {
            x.registry.subject = `${EXACT_GHCR_REPOSITORY}:${DISCOVERY_TAG}`;
        }],
        ['manifest mismatch', (x) => { x.registry.manifest_digest = `sha256:${HASH_C}`; }],
        ['other build config', (x) => { x.registry.config_digest = `sha256:${HASH_C}`; }],
        ['local ID used as manifest', (x) => {
            x.registry.digest = LOCAL_ID;
            x.registry.manifest_digest = LOCAL_ID;
            x.registry.subject = `${EXACT_GHCR_REPOSITORY}@${LOCAL_ID}`;
        }],
        ['revision mismatch', (x) => { x.registry.source_revision = '9'.repeat(40); }],
        ['tag does not resolve', (x) => { x.registry.tag_points_to_digest = false; }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(validInput());
        mutate(value);
        rejected(value);
    });
});

test('SBOM, Grype, prepublication, and digest round-trip proofs are mandatory', async (t) => {
    const mutations = [
        ['SBOM hash malformed', (x) => { x.sbom.file_sha256 = 'invalid'; }],
        ['SBOM version', (x) => { x.sbom.spdx_version = 'SPDX-2.2'; }],
        ['Grype hash malformed', (x) => { x.scanner.file_sha256 = 'invalid'; }],
        ['Grype version', (x) => { x.scanner.version = 'latest'; }],
        ['HIGH finding', (x) => { x.scanner.high = 1; }],
        ['CRITICAL finding', (x) => { x.scanner.critical = 1; }],
        ['known advisory', (x) => { x.scanner.known_swiper_advisory = 1; }],
        ['pulled different build', (x) => { x.round_trip.pulled_image_id = `sha256:${HASH_C}`; }],
        ['kernel UID mismatch', (x) => { x.round_trip.kernel_uid = '1000'; }],
        ['kernel GID mismatch', (x) => { x.round_trip.kernel_gid = '1000'; }]
    ];
    for (const gate of EVIDENCE_KEYS.gates) {
        mutations.push([`gate ${gate}`, (x) => { x.gates[gate] = false; }]);
    }
    for (const proof of EVIDENCE_KEYS.round_trip.filter((key) => (
        !['pulled_image_id', 'kernel_uid', 'kernel_gid'].includes(key)
    ))) {
        mutations.push([`round-trip ${proof}`, (x) => { x.round_trip[proof] = false; }]);
    }
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(validInput());
        mutate(value);
        rejected(value);
    });
});

test('both signed digest-bound attestations require three verification paths', async (t) => {
    const mutations = [
        ['same attestation ID', (x) => { x.attestations.sbom.id = x.attestations.provenance.id; }],
        ['same bundle', (x) => {
            x.attestations.sbom.bundle_sha256 = x.attestations.provenance.bundle_sha256;
        }],
        ['wrong provenance predicate', (x) => {
            x.attestations.provenance.predicate_type = SPDX_PREDICATE;
        }],
        ['wrong SBOM predicate', (x) => {
            x.attestations.sbom.predicate_type = PROVENANCE_PREDICATE;
        }],
        ['tag subject name', (x) => {
            x.attestations.provenance.subject_name =
                `${EXACT_GHCR_REPOSITORY}:${DISCOVERY_TAG}`;
        }],
        ['wrong subject digest', (x) => {
            x.attestations.provenance.subject_digest = `sha256:${HASH_C}`;
        }],
        ['wrong signer repository', (x) => {
            x.attestations.sbom.signer_repository = 'other/repository';
        }],
        ['wrong signer workflow', (x) => {
            x.attestations.sbom.signer_workflow = '.github/workflows/other.yml';
        }],
        ['wrong source ref', (x) => {
            x.attestations.provenance.source_ref =
                'refs/heads/codex/i8-s3a-ghcr-signed-candidate';
        }],
        ['wrong source digest', (x) => {
            x.attestations.provenance.source_digest = '9'.repeat(40);
        }],
        ['push false', (x) => { x.attestations.sbom.push_to_registry = false; }],
        ['GitHub verification skipped', (x) => {
            x.attestations.provenance.github_api_verified = false;
        }],
        ['OCI verification skipped', (x) => {
            x.attestations.provenance.oci_verified = false;
        }],
        ['offline verification skipped', (x) => {
            x.attestations.sbom.offline_bundle_verified = false;
        }],
        ['unsigned', (x) => { x.attestations.sbom.signature_verified = false; }],
        ['non-success reason', (x) => {
            x.attestations.sbom.verification_reason = 'http_200_only';
        }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(validInput());
        mutate(value);
        rejected(value);
    });
});

test('signature allowlist, negative proofs, publication ordering, cleanup, and no-deploy aggregate', async (t) => {
    const mutations = [
        ['issuer', (x) => { x.verification.issuer = 'https://issuer.example'; }],
        ['certificate identity', (x) => { x.verification.certificate_identity += '-wrong'; }],
        ['verification result', (x) => { x.verification.result = 'skipped'; }],
        ['publication before gate', (x) => {
            x.publication.gate_completed_before_login = false;
        }],
        ['existing tag overwritten', (x) => { x.publication.tag_absent_before_push = false; }],
        ['different image pushed', (x) => { x.publication.same_image_pushed = false; }],
        ['second build present', (x) => { x.publication.second_build_absent = false; }],
        ['mutable tag present', (x) => { x.publication.mutable_tag_absent = false; }],
        ['overwrite present', (x) => { x.publication.overwrite_absent = false; }],
        ['partial mislabeled success', (x) => {
            x.publication.status = 'I8_CANDIDATE_PUBLISHED_UNATTESTED';
        }],
        ['cleanup status', (x) => { x.cleanup.result = 'failure'; }],
        ['boundary removed', (x) => { x.aggregator.evidence_boundary = 'unbounded'; }],
        ['aggregate removed', (x) => { x.aggregator.result = 'success'; }],
        ['deployed digest', (x) => { x.deployed_digest = REGISTRY_DIGEST; }]
    ];
    for (const proof of [
        'exact_digest', 'exact_repository', 'exact_workflow', 'exact_ref',
        'exact_source', 'wrong_digest_rejected', 'wrong_repository_rejected'
    ]) {
        mutations.push([`verification ${proof}`, (x) => { x.verification[proof] = false; }]);
    }
    for (const proof of EVIDENCE_KEYS.cleanup.filter((key) => key !== 'result')) {
        mutations.push([`cleanup ${proof}`, (x) => { x.cleanup[proof] = false; }]);
    }
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(validInput());
        mutate(value);
        rejected(value);
    });
});

test('expected runtime correlation rejects a different SHA, build, digest, tag, or evidence file', () => {
    const base = buildPublicationEvidence(validInput());
    const expected = {
        source_sha: SOURCE_SHA,
        source_ref: EXACT_SOURCE_REF,
        run_id: base.workflow.run_id,
        run_attempt: base.workflow.run_attempt,
        job: base.workflow.job,
        local_image_id: LOCAL_ID,
        registry_digest: REGISTRY_DIGEST,
        discovery_tag: DISCOVERY_TAG,
        sbom_sha256: HASH_C,
        grype_sha256: HASH_D
    };
    assert.equal(validatePublicationEvidence(base, expected), null);
    for (const [key, value] of [
        ['source_sha', '9'.repeat(40)],
        ['run_id', '999'],
        ['local_image_id', `sha256:${HASH_C}`],
        ['registry_digest', `sha256:${HASH_C}`],
        ['discovery_tag', `candidate-${'9'.repeat(40)}`],
        ['sbom_sha256', HASH_A],
        ['grype_sha256', HASH_A]
    ]) {
        rejected(base, {...expected, [key]: value});
    }
});
