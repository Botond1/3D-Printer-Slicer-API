'use strict';

const SCHEMA_VERSION = 'i7-s3a-candidate-provenance-v1';
const MAX_EVIDENCE_BYTES = 64 * 1024;
const EXACT_REPOSITORY = 'https://github.com/Botond1/3D-Printer-Slicer-API';
const EXACT_WORKFLOW = 'Image Validation - Build Once (NO PUSH / NO DEPLOY)';
const EXACT_SLICERS = Object.freeze({
    prusa: Object.freeze({
        version: '2.8.1',
        url: 'https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage',
        sha256: '565f2f4bd4dbb05904a459d54db1916b6932124709c1d17b5aacfe9f5f2f1b03'
    }),
    orca: Object.freeze({
        version: '2.3.1',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage',
        sha256: 'f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701'
    })
});
const EXACT_SWIPER = Object.freeze({
    version: '12.1.2',
    url: 'https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz',
    sha512: 'e2020bac8def5d9aa8661ef52353c02eaba4085824fa0a4ec1ed6d3afcf9b84f641ed9768130f39987e5602c16bd1e0b3af0ab262e9410453e827b96e41b6481',
    sha256: '7780a8143baf0f021fcc3de927cc95c6b79e8fdc6d38e1f5ba2d0ed17d943457'
});

const EVIDENCE_KEYS = Object.freeze({
    root: Object.freeze([
        'schema_version', 'repository', 'source_sha', 'workflow', 'build_inputs',
        'image', 'slicers', 'swiper', 'sbom', 'scanner', 'proofs', 'aggregator',
        'registry_digest', 'signature', 'attestation', 'deployed_digest'
    ]),
    workflow: Object.freeze(['name', 'run_id', 'run_attempt', 'job']),
    build_inputs: Object.freeze([
        'dockerfile_sha256', 'package_json_sha256', 'package_lock_sha256', 'platform'
    ]),
    image: Object.freeze([
        'id', 'identity_scope', 'configured_user', 'service_uid', 'service_gid',
        'kernel_uid', 'kernel_gid'
    ]),
    slicers: Object.freeze(['prusa', 'orca']),
    slicer: Object.freeze(['version', 'url', 'sha256']),
    swiper: Object.freeze(['version', 'url', 'sha512', 'sha256']),
    sbom: Object.freeze(['file_sha256', 'spdx_version']),
    scanner: Object.freeze([
        'name', 'version', 'database_timestamp', 'high', 'critical',
        'known_swiper_advisory'
    ]),
    proofs: Object.freeze([
        'private_peer', 'no_host_port', 'no_default_route', 'api_egress_denied',
        'native_egress_denied', 'live_abort_no_artifact_process_settlement'
    ]),
    aggregator: Object.freeze(['cleanup', 'result'])
});

const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
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

function validateWorkflow(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.workflow)) return 'workflow_schema_mismatch';
    if (value.name !== EXACT_WORKFLOW
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
        || value.platform !== 'linux/amd64') return 'build_inputs_malformed';
    return null;
}

function validateImage(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.image)) return 'image_schema_mismatch';
    if (!IMAGE_ID.test(value.id)
        || value.identity_scope !== 'run_local_not_registry_digest'
        || value.configured_user !== 'slicer'
        || !canonicalPositiveInteger(value.service_uid)
        || !canonicalPositiveInteger(value.service_gid)
        || value.kernel_uid !== value.service_uid
        || value.kernel_gid !== value.service_gid) return 'image_identity_malformed';
    return null;
}

function validateSlicer(value, expected) {
    if (!exactKeys(value, EVIDENCE_KEYS.slicer)) return 'slicer_schema_mismatch';
    if (EVIDENCE_KEYS.slicer.some((key) => value[key] !== expected[key])) {
        return 'slicer_metadata_malformed';
    }
    return null;
}

function validateSlicers(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.slicers)) return 'slicers_schema_mismatch';
    return validateSlicer(value.prusa, EXACT_SLICERS.prusa)
        || validateSlicer(value.orca, EXACT_SLICERS.orca);
}

function validateSwiper(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.swiper)) return 'swiper_schema_mismatch';
    if (!HEX_128.test(value.sha512) || !HEX_64.test(value.sha256)
        || EVIDENCE_KEYS.swiper.some((key) => value[key] !== EXACT_SWIPER[key])) {
        return 'swiper_metadata_malformed';
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
    if (value.name !== 'grype' || value.version !== '0.110.0'
        || !exactTimestamp(value.database_timestamp)
        || value.high !== 0 || value.critical !== 0 || value.known_swiper_advisory !== 0) {
        return 'scanner_metadata_malformed';
    }
    return null;
}

function validateProofs(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.proofs)) return 'proofs_schema_mismatch';
    if (EVIDENCE_KEYS.proofs.some((key) => value[key] !== true)) return 'proofs_not_all_true';
    return null;
}

function validateAggregator(value) {
    if (!exactKeys(value, EVIDENCE_KEYS.aggregator)) return 'aggregator_schema_mismatch';
    if (value.cleanup !== 'success' || value.result !== 'success') {
        return 'aggregator_not_successful';
    }
    return null;
}

function validateExpected(evidence, expected) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
        return 'expected_identity_malformed';
    }
    const comparisons = [
        ['repository', evidence.repository],
        ['source_sha', evidence.source_sha],
        ['run_id', evidence.workflow.run_id],
        ['run_attempt', evidence.workflow.run_attempt],
        ['job', evidence.workflow.job],
        ['image_id', evidence.image.id],
        ['sbom_sha256', evidence.sbom.file_sha256]
    ];
    for (const [key, actual] of comparisons) {
        if (Object.hasOwn(expected, key) && expected[key] !== actual) {
            return 'expected_identity_mismatch';
        }
    }
    return null;
}

function validateCandidateEvidence(evidence, expected = {}) {
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
    if (evidence.repository !== EXACT_REPOSITORY || !HEX_40.test(evidence.source_sha)) {
        return 'source_identity_malformed';
    }
    const nestedError = validateWorkflow(evidence.workflow)
        || validateBuildInputs(evidence.build_inputs)
        || validateImage(evidence.image)
        || validateSlicers(evidence.slicers)
        || validateSwiper(evidence.swiper)
        || validateSbom(evidence.sbom)
        || validateScanner(evidence.scanner)
        || validateProofs(evidence.proofs)
        || validateAggregator(evidence.aggregator);
    if (nestedError) return nestedError;
    if (evidence.registry_digest !== 'not_created'
        || evidence.signature !== 'not_created'
        || evidence.attestation !== 'not_created'
        || evidence.deployed_digest !== 'not_applicable_no_publish') {
        return 'publication_status_mismatch';
    }
    return validateExpected(evidence, expected);
}

function buildCandidateEvidence(input) {
    let evidence;
    try {
        evidence = JSON.parse(JSON.stringify(input));
    } catch {
        throw new TypeError('candidate evidence input must be JSON serializable');
    }
    const validationError = validateCandidateEvidence(evidence);
    if (validationError) throw new TypeError(validationError);
    const freeze = (value) => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        for (const child of Object.values(value)) freeze(child);
        return Object.freeze(value);
    };
    return freeze(evidence);
}

module.exports = Object.freeze({
    EVIDENCE_KEYS,
    EXACT_REPOSITORY,
    EXACT_SLICERS,
    EXACT_SWIPER,
    EXACT_WORKFLOW,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildCandidateEvidence,
    validateCandidateEvidence
});
