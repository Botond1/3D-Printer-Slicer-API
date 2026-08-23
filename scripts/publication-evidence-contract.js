'use strict';

const MAX_EVIDENCE_BYTES = 96 * 1024;
const EXACT_SOURCE_REPOSITORY = 'https://github.com/Botond1/3D-Printer-Slicer-API';
const EXACT_REPOSITORY_SLUG = 'Botond1/3D-Printer-Slicer-API';
const EXACT_GHCR_REPOSITORY = 'ghcr.io/botond1/3d-printer-slicer-api';
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const SPDX_PREDICATE = 'https://spdx.dev/Document/v2.3';
const SIGSTORE_ISSUER = 'https://token.actions.githubusercontent.com';

const BASE_EVIDENCE_KEYS = Object.freeze({
    root: Object.freeze([
        'schema_version', 'source', 'workflow', 'build_inputs', 'image', 'registry',
        'sbom', 'scanner', 'gates', 'round_trip', 'attestations', 'verification',
        'publication', 'cleanup', 'aggregator', 'deployed_digest'
    ]),
    source: Object.freeze(['repository', 'repository_slug', 'sha', 'ref']),
    workflow: Object.freeze(['name', 'path', 'run_id', 'run_attempt', 'job']),
    build_inputs: Object.freeze([
        'dockerfile_sha256', 'package_json_sha256', 'package_lock_sha256',
        'platform', 'build_count'
    ]),
    image: Object.freeze([
        'local_id', 'identity_scope', 'configured_user', 'service_uid', 'service_gid'
    ]),
    registry: Object.freeze([
        'repository', 'discovery_tag', 'digest', 'subject', 'manifest_digest',
        'config_digest', 'source_revision', 'platform', 'configured_user',
        'tag_points_to_digest'
    ]),
    sbom: Object.freeze(['file_sha256', 'spdx_version']),
    scanner: Object.freeze([
        'file_sha256', 'name', 'version', 'database_timestamp', 'high', 'critical',
        'known_swiper_advisory'
    ]),
    gates: Object.freeze([
        'runtime_identity', 'orca_cli_smoke', 'browser_smoke',
        'live_abort_no_artifact', 'private_peer', 'no_host_port',
        'no_default_route', 'api_egress_denied', 'native_egress_denied',
        'sbom', 'grype', 'artifact_boundary', 'prepublication_complete'
    ]),
    round_trip: Object.freeze([
        'local_image_removed_before_pull', 'pulled_by_digest', 'pulled_image_id',
        'pulled_config_matches_build', 'kernel_uid', 'kernel_gid', 'liveness',
        'orca_cli_smoke', 'production_compose_digest', 'tag_digest_match'
    ]),
    attestations: Object.freeze(['provenance', 'sbom']),
    attestation: Object.freeze([
        'id', 'url', 'bundle_sha256', 'predicate_type', 'subject_name',
        'subject_digest', 'signer_repository', 'signer_workflow', 'source_ref',
        'source_digest', 'push_to_registry', 'github_api_verified', 'oci_verified',
        'offline_bundle_verified', 'signature_verified', 'verification_reason'
    ]),
    verification: Object.freeze([
        'issuer', 'certificate_identity', 'exact_digest', 'exact_repository',
        'exact_workflow', 'exact_ref', 'exact_source', 'wrong_digest_rejected',
        'wrong_repository_rejected', 'result'
    ]),
    publication: Object.freeze([
        'gate_completed_before_login', 'tag_absent_before_push', 'same_image_pushed',
        'second_build_absent', 'mutable_tag_absent', 'overwrite_absent',
        'remote_digest_preserved', 'status'
    ]),
    cleanup: Object.freeze([
        'containers_removed', 'networks_removed', 'local_tags_removed',
        'local_digest_image_removed', 'temporary_bundles_removed',
        'bounded_evidence_only', 'remote_candidate_preserved', 'result'
    ]),
    aggregator: Object.freeze(['evidence_boundary', 'result'])
});

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;


const PROFILE_KEYS = Object.freeze([
    'schemaVersion', 'sourceRef', 'workflowName', 'workflowPath', 'aggregatorResult',
    'publicationPolicy'
]);

function createPublicationEvidenceContract(inputProfile) {
    const inputKeys = inputProfile && typeof inputProfile === 'object'
        && !Array.isArray(inputProfile) ? Object.keys(inputProfile).sort() : [];
    if (JSON.stringify(inputKeys) !== JSON.stringify([...PROFILE_KEYS].sort())
        || typeof inputProfile.schemaVersion !== 'string'
        || !/^[a-z0-9-]{1,80}$/.test(inputProfile.schemaVersion)
        || typeof inputProfile.sourceRef !== 'string'
        || !/^refs\/heads\/[A-Za-z0-9._\/-]{1,200}$/.test(inputProfile.sourceRef)
        || typeof inputProfile.workflowName !== 'string'
        || inputProfile.workflowName.length < 1 || inputProfile.workflowName.length > 160
        || typeof inputProfile.workflowPath !== 'string'
        || !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(inputProfile.workflowPath)
        || typeof inputProfile.aggregatorResult !== 'string'
        || !/^[A-Z0-9_]{1,80}$/.test(inputProfile.aggregatorResult)
        || !['fresh_only', 'recoverable'].includes(inputProfile.publicationPolicy)) {
        throw new TypeError('publication_evidence_profile_invalid');
    }
    const profile = Object.freeze({...inputProfile});
    const SCHEMA_VERSION = profile.schemaVersion;
    const EXACT_SOURCE_REF = profile.sourceRef;
    const EXACT_WORKFLOW = profile.workflowName;
    const EXACT_WORKFLOW_PATH = profile.workflowPath;
    const AGGREGATOR_RESULT = profile.aggregatorResult;
    const EVIDENCE_KEYS = Object.freeze({
        ...BASE_EVIDENCE_KEYS,
        publication: profile.publicationPolicy === 'recoverable'
            ? Object.freeze([
                ...BASE_EVIDENCE_KEYS.publication, 'mode',
                'existing_exact_digest_verified', 'candidate_manifest_write_performed'
            ])
            : BASE_EVIDENCE_KEYS.publication
    });

function exactKeys(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalPositiveInteger(value) {
    return typeof value === 'string' && POSITIVE_DECIMAL.test(value)
        && Number.isSafeInteger(Number(value));
}

function exactTimestamp(value) {
    if (typeof value !== 'string' || value.length > 64
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return false;
    return !Number.isNaN(Date.parse(value));
}

function allTrue(value, keys) {
    return keys.every((key) => value[key] === true);
}

function validateSource(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.source)) return 'source_schema_mismatch';
    if (value.repository !== EXACT_SOURCE_REPOSITORY
        || value.repository_slug !== EXACT_REPOSITORY_SLUG
        || !HEX_40.test(value.sha) || value.ref !== EXACT_SOURCE_REF) {
        return 'source_identity_malformed';
    }
    return null;
}

function validateWorkflow(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.workflow)) return 'workflow_schema_mismatch';
    if (value.name !== EXACT_WORKFLOW || value.path !== EXACT_WORKFLOW_PATH
        || !canonicalPositiveInteger(value.run_id)
        || !canonicalPositiveInteger(value.run_attempt)
        || typeof value.job !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(value.job)) {
        return 'workflow_identity_malformed';
    }
    return null;
}

function validateBuildInputs(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.build_inputs)) return 'build_inputs_schema_mismatch';
    if (!HEX_64.test(value.dockerfile_sha256)
        || !HEX_64.test(value.package_json_sha256)
        || !HEX_64.test(value.package_lock_sha256)
        || value.platform !== 'linux/amd64' || value.build_count !== 1) {
        return 'build_inputs_malformed';
    }
    return null;
}

function validateImage(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.image)) return 'image_schema_mismatch';
    if (!DIGEST.test(value.local_id)
        || value.identity_scope !== 'run_local_config_digest_not_registry_manifest'
        || value.configured_user !== 'slicer'
        || !canonicalPositiveInteger(value.service_uid)
        || !canonicalPositiveInteger(value.service_gid)) {
        return 'local_image_identity_malformed';
    }
    return null;
}

function validateRegistry(value, source, image) {
    if (!exactKeys(value, EVIDENCE_KEYS.registry)) return 'registry_schema_mismatch';
    const tag = `candidate-${source.sha}`;
    const subject = `${EXACT_GHCR_REPOSITORY}@${value.digest}`;
    if (value.repository !== EXACT_GHCR_REPOSITORY
        || value.discovery_tag !== tag || !DIGEST.test(value.digest)
        || value.subject !== subject || value.manifest_digest !== value.digest
        || !DIGEST.test(value.config_digest) || value.config_digest !== image.local_id
        || value.digest === image.local_id || value.source_revision !== source.sha
        || value.platform !== 'linux/amd64' || value.configured_user !== 'slicer'
        || value.tag_points_to_digest !== true) {
        return 'registry_identity_malformed';
    }
    return null;
}

function validateSbom(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.sbom)) return 'sbom_schema_mismatch';
    if (!HEX_64.test(value.file_sha256) || value.spdx_version !== 'SPDX-2.3') {
        return 'sbom_metadata_malformed';
    }
    return null;
}

function validateScanner(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.scanner)) return 'scanner_schema_mismatch';
    if (!HEX_64.test(value.file_sha256) || value.name !== 'grype'
        || value.version !== '0.110.0' || !exactTimestamp(value.database_timestamp)
        || value.high !== 0 || value.critical !== 0 || value.known_swiper_advisory !== 0) {
        return 'scanner_metadata_malformed';
    }
    return null;
}

function validateGates(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.gates)) return 'gates_schema_mismatch';
    return allTrue(value, EVIDENCE_KEYS.gates) ? null : 'prepublication_gate_incomplete';
}

function validateRoundTrip(value, image) {
    if (!exactKeys(value, EVIDENCE_KEYS.round_trip)) return 'round_trip_schema_mismatch';
    const booleanKeys = EVIDENCE_KEYS.round_trip.filter((key) => (
        !['pulled_image_id', 'kernel_uid', 'kernel_gid'].includes(key)
    ));
    if (!allTrue(value, booleanKeys) || value.pulled_image_id !== image.local_id
        || value.kernel_uid !== image.service_uid || value.kernel_gid !== image.service_gid) {
        return 'digest_round_trip_mismatch';
    }
    return null;
}

function validateAttestation(value, expectedPredicate, source, registry) {
    if (!exactKeys(value, EVIDENCE_KEYS.attestation)) return 'attestation_schema_mismatch';
    const exactUrlPrefix = `https://github.com/${EXACT_REPOSITORY_SLUG}/attestations/`;
    if (!ID.test(value.id) || typeof value.url !== 'string'
        || !value.url.startsWith(exactUrlPrefix) || value.url.length > 512
        || !HEX_64.test(value.bundle_sha256) || value.predicate_type !== expectedPredicate
        || value.subject_name !== EXACT_GHCR_REPOSITORY
        || value.subject_digest !== registry.digest
        || value.signer_repository !== EXACT_REPOSITORY_SLUG
        || value.signer_workflow !== EXACT_WORKFLOW_PATH
        || value.source_ref !== source.ref || value.source_digest !== source.sha
        || value.push_to_registry !== true || value.github_api_verified !== true
        || value.oci_verified !== true || value.offline_bundle_verified !== true
        || value.signature_verified !== true || value.verification_reason !== 'success') {
        return 'attestation_identity_or_verification_mismatch';
    }
    return null;
}

function validateAttestations(value, source, registry) {
    if (!exactKeys(value, EVIDENCE_KEYS.attestations)) return 'attestations_schema_mismatch';
    const provenanceError = validateAttestation(
        value.provenance, PROVENANCE_PREDICATE, source, registry
    );
    if (provenanceError) return provenanceError;
    const sbomError = validateAttestation(value.sbom, SPDX_PREDICATE, source, registry);
    if (sbomError) return sbomError;
    if (value.provenance.id === value.sbom.id
        || value.provenance.bundle_sha256 === value.sbom.bundle_sha256) {
        return 'attestations_not_distinct';
    }
    return null;
}

function validateVerification(value, source) {
    if (!exactKeys(value, EVIDENCE_KEYS.verification)) return 'verification_schema_mismatch';
    const certificateIdentity =
        `${EXACT_SOURCE_REPOSITORY}/${EXACT_WORKFLOW_PATH}@${source.ref}`;
    const booleanKeys = [
        'exact_digest', 'exact_repository', 'exact_workflow', 'exact_ref',
        'exact_source', 'wrong_digest_rejected', 'wrong_repository_rejected'
    ];
    if (value.issuer !== SIGSTORE_ISSUER || value.certificate_identity !== certificateIdentity
        || !allTrue(value, booleanKeys) || value.result !== 'success') {
        return 'signature_verification_mismatch';
    }
    return null;
}

function validatePublication(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.publication)) return 'publication_schema_mismatch';
    if (profile.publicationPolicy === 'fresh_only') {
        const booleanKeys = EVIDENCE_KEYS.publication.filter((key) => key !== 'status');
        return allTrue(value, booleanKeys) && value.status === 'published_attested_verified'
            ? null : 'publication_status_mismatch';
    }
    const commonTrue = [
        'gate_completed_before_login', 'second_build_absent', 'mutable_tag_absent',
        'overwrite_absent', 'remote_digest_preserved'
    ];
    const publishNew = value.mode === 'publish_new'
        && value.tag_absent_before_push === true && value.same_image_pushed === true
        && value.existing_exact_digest_verified === false
        && value.candidate_manifest_write_performed === true
        && value.status === 'published_attested_verified';
    const recoverExact = value.mode === 'recover_exact_digest'
        && value.tag_absent_before_push === false && value.same_image_pushed === false
        && value.existing_exact_digest_verified === true
        && value.candidate_manifest_write_performed === false
        && value.status === 'recovered_attested_verified';
    if (!allTrue(value, commonTrue) || (!publishNew && !recoverExact)) {
        return 'publication_status_mismatch';
    }
    return null;
}

function validateCleanup(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.cleanup)) return 'cleanup_schema_mismatch';
    const booleanKeys = EVIDENCE_KEYS.cleanup.filter((key) => key !== 'result');
    if (!allTrue(value, booleanKeys) || value.result !== 'success') {
        return 'cleanup_status_mismatch';
    }
    return null;
}

function validateAggregator(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.aggregator)) return 'aggregator_schema_mismatch';
    if (value.evidence_boundary !== 'bounded_allowlist_only'
        || value.result !== AGGREGATOR_RESULT) {
        return 'aggregator_status_mismatch';
    }
    return null;
}

function validateExpected(evidence, expected) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
        return 'expected_identity_malformed';
    }
    const comparisons = [
        ['source_sha', evidence.source.sha],
        ['source_ref', evidence.source.ref],
        ['run_id', evidence.workflow.run_id],
        ['run_attempt', evidence.workflow.run_attempt],
        ['job', evidence.workflow.job],
        ['local_image_id', evidence.image.local_id],
        ['registry_digest', evidence.registry.digest],
        ['discovery_tag', evidence.registry.discovery_tag],
        ['sbom_sha256', evidence.sbom.file_sha256],
        ['grype_sha256', evidence.scanner.file_sha256]
    ];
    for (const [key, actual] of comparisons) {
        if (Object.hasOwn(expected, key) && expected[key] !== actual) {
            return 'expected_identity_mismatch';
        }
    }
    return null;
}

function validatePublicationEvidence(evidence, expected = {}) {
    if (!exactKeys(evidence, EVIDENCE_KEYS.root)) return 'evidence_schema_mismatch';
    let serialized;
    try {
        serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    } catch {
        return 'evidence_not_serializable';
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) {
        return 'evidence_size_exceeded';
    }
    if (evidence.schema_version !== SCHEMA_VERSION) return 'evidence_version_mismatch';
    const nestedError = validateSource(evidence.source)
        || validateWorkflow(evidence.workflow)
        || validateBuildInputs(evidence.build_inputs)
        || validateImage(evidence.image)
        || validateRegistry(evidence.registry, evidence.source, evidence.image)
        || validateSbom(evidence.sbom)
        || validateScanner(evidence.scanner)
        || validateGates(evidence.gates)
        || validateRoundTrip(evidence.round_trip, evidence.image)
        || validateAttestations(evidence.attestations, evidence.source, evidence.registry)
        || validateVerification(evidence.verification, evidence.source)
        || validatePublication(evidence.publication)
        || validateCleanup(evidence.cleanup)
        || validateAggregator(evidence.aggregator);
    if (nestedError) return nestedError;
    if (evidence.deployed_digest !== 'not_applicable_no_deploy') {
        return 'deployment_status_mismatch';
    }
    return validateExpected(evidence, expected);
}

function buildPublicationEvidence(input) {
    let evidence;
    try {
        evidence = JSON.parse(JSON.stringify(input));
    } catch {
        throw new TypeError('publication evidence input must be JSON serializable');
    }
    const validationError = validatePublicationEvidence(evidence);
    if (validationError) throw new TypeError(validationError);
    const freeze = (value) => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        for (const child of Object.values(value)) freeze(child);
        return Object.freeze(value);
    };
    return freeze(evidence);
}

return Object.freeze({
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
});
}

module.exports = Object.freeze({createPublicationEvidenceContract});
