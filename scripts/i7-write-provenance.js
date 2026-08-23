'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    EXACT_REPOSITORY,
    EXACT_SLICERS,
    EXACT_SWIPER,
    EXACT_WORKFLOW,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildCandidateEvidence,
    validateCandidateEvidence
} = require('./i7-provenance-evidence');
const {validateTopologyEvidence} = require('./i6-topology-evidence-contract');

const EXPECTED_OUTCOMES = Object.freeze([
    'RUNTIME_IDENTITY_OUTCOME', 'ORCA_CLI_SMOKE_OUTCOME', 'SMOKE_OUTCOME',
    'TOPOLOGY_OUTCOME', 'DIAGNOSTIC_OUTCOME', 'SBOM_OUTCOME', 'SBOM_GATE_OUTCOME',
    'SCAN_OUTCOME', 'SCAN_GATE_OUTCOME', 'TRIAGE_OUTCOME', 'ARTIFACT_BOUNDARY_OUTCOME',
    'CLEANUP_OUTCOME'
]);
const EXPECTED_CLASSIFICATIONS = Object.freeze({
    RUNTIME_IDENTITY_CLASSIFICATION: 'success',
    ORCA_CLI_SMOKE_CLASSIFICATION: 'success',
    SMOKE_CLASSIFICATION: 'success',
    TOPOLOGY_CLASSIFICATION: 'success',
    TOPOLOGY_CONTRACT_REASON: 'success',
    TOPOLOGY_SENTINEL_OPERATIONAL: 'true',
    SBOM_CLASSIFICATION: 'success',
    SCAN_CLASSIFICATION: 'success',
    TRIAGE_CLASSIFICATION: 'success',
    ARTIFACT_BOUNDARY_CLASSIFICATION: 'success',
    CLEANUP_CLASSIFICATION: 'success'
});
const MAX_SCANNER_MATCHES = 100000;
const MAX_RELATED_VULNERABILITIES = 100;
const SCANNER_SEVERITIES = Object.freeze(new Set([
    'negligible', 'low', 'medium', 'high', 'critical', 'unknown'
]));

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function regularContainedFile(root, name, limit) {
    const target = path.join(root, name);
    let details;
    try {
        details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
            || details.size > limit || fs.realpathSync(target) !== target) {
            fail('provenance_input_boundary_failure');
        }
    } catch (error) {
        if (error?.code === 'provenance_input_boundary_failure') throw error;
        fail('provenance_input_boundary_failure');
    }
    return target;
}

function sha256(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function parseJson(target) {
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        fail('provenance_json_parse_failure');
    }
}

function parseIdentity(target) {
    const lines = fs.readFileSync(target, 'utf8').trimEnd().split('\n');
    const identity = Object.fromEntries(lines.map((line) => {
        const separator = line.indexOf('=');
        return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : ['', ''];
    }));
    const keys = [
        'candidate_sha', 'local_image_ref', 'local_image_id', 'build_action_image_id',
        'identity_scope', 'registry_digest', 'signature', 'attestation',
        'configured_user', 'service_uid', 'service_gid', 'kernel_uid', 'kernel_gid'
    ];
    if (lines.length !== keys.length || keys.some((key) => !(key in identity))) {
        fail('provenance_image_identity_schema_failure');
    }
    return identity;
}

function countScannerFindings(report) {
    if (!Array.isArray(report.matches) || report.matches.length > MAX_SCANNER_MATCHES) {
        fail('provenance_scanner_schema_failure');
    }
    const result = {high: 0, critical: 0, knownSwiper: 0};
    for (const match of report.matches) {
        const vulnerability = match?.vulnerability;
        const artifact = match?.artifact;
        const related = match?.relatedVulnerabilities;
        const severity = typeof vulnerability?.severity === 'string'
            ? vulnerability.severity.toLowerCase() : '';
        if (!match || typeof match !== 'object' || Array.isArray(match)
            || typeof vulnerability?.id !== 'string' || vulnerability.id.length < 1
            || vulnerability.id.length > 160 || !SCANNER_SEVERITIES.has(severity)
            || typeof artifact?.name !== 'string' || artifact.name.length < 1
            || artifact.name.length > 512
            || (related !== undefined && (!Array.isArray(related)
                || related.length > MAX_RELATED_VULNERABILITIES
                || related.some((item) => typeof item?.id !== 'string'
                    || item.id.length < 1 || item.id.length > 160)))) {
            fail('provenance_scanner_schema_failure');
        }
        if (severity === 'high' || severity === 'critical') result[severity] += 1;
        const ids = [vulnerability.id, ...(related || []).map((item) => item.id)];
        if (artifact.name.toLowerCase() === 'swiper'
            && ids.some((id) => id === 'GHSA-hmx5-qpq5-p643' || id === 'CVE-2026-27212')) {
            result.knownSwiper += 1;
        }
    }
    return result;
}

function scannerIdentity(report) {
    const descriptor = report?.descriptor;
    return {
        name: descriptor?.name,
        version: descriptor?.version,
        databaseTimestamp: descriptor?.db?.status?.built
    };
}

function requireSuccessfulOutcomes(environment) {
    for (const name of EXPECTED_OUTCOMES) {
        if (environment[name] !== 'success') fail('provenance_aggregator_outcome_failure');
    }
    for (const [name, value] of Object.entries(EXPECTED_CLASSIFICATIONS)) {
        if (environment[name] !== value) fail('provenance_aggregator_classification_failure');
    }
}

function activeLines(source) {
    return source.replace(/\r\n?/g, '\n').split('\n')
        .filter((line) => !/^\s*#/.test(line));
}

function requireSingleExactLine(lines, prefix, expected) {
    if (lines.filter((line) => line.trimStart().startsWith(prefix)).length !== 1
        || lines.filter((line) => line.trim() === expected).length !== 1) {
        fail('provenance_pinned_input_mismatch');
    }
}

function verifyPinnedInputs(dockerfileSource, swiperSource) {
    const dockerfileLines = activeLines(dockerfileSource);
    for (const [name, value] of [
        ['PRUSA_APPIMAGE_URL', EXACT_SLICERS.prusa.url],
        ['ORCA_APPIMAGE_URL', EXACT_SLICERS.orca.url],
        ['PRUSA_APPIMAGE_SHA256', EXACT_SLICERS.prusa.sha256],
        ['ORCA_APPIMAGE_SHA256', EXACT_SLICERS.orca.sha256],
        ['SWIPER_VENDOR_URL', EXACT_SWIPER.url]
    ]) {
        requireSingleExactLine(dockerfileLines, `ARG ${name}=`, `ARG ${name}="${value}"`);
    }
    const swiperLines = activeLines(swiperSource);
    requireSingleExactLine(swiperLines, 'EXPECTED_URL =', `EXPECTED_URL = "${EXACT_SWIPER.url}"`);
    requireSingleExactLine(
        swiperLines,
        'EXPECTED_SHA256 =',
        `EXPECTED_SHA256 = "${EXACT_SWIPER.sha256}"`
    );
    requireSingleExactLine(swiperLines, 'EXPECTED_SHA512 =', 'EXPECTED_SHA512 = (');
    for (const half of [EXACT_SWIPER.sha512.slice(0, 64), EXACT_SWIPER.sha512.slice(64)]) {
        if (swiperLines.filter((line) => line.trim() === `"${half}"`).length !== 1) {
            fail('provenance_pinned_input_mismatch');
        }
    }
}

function buildFromRepository(environment = process.env) {
    requireSuccessfulOutcomes(environment);
    const root = fs.realpathSync(path.resolve(__dirname, '..'));
    const evidenceRoot = path.resolve(environment.RUNNER_TEMP || '', environment.EVIDENCE_SUBDIR || '');
    if (environment.EVIDENCE_DIR !== evidenceRoot || fs.realpathSync(evidenceRoot) !== evidenceRoot) {
        fail('provenance_evidence_root_mismatch');
    }

    const dockerfile = regularContainedFile(root, 'Dockerfile', 1024 * 1024);
    const packageJson = regularContainedFile(root, 'package.json', 1024 * 1024);
    const packageLock = regularContainedFile(root, 'package-lock.json', 10 * 1024 * 1024);
    const swiperInstaller = regularContainedFile(root, 'scripts/install-swiper-vendor.py', 256 * 1024);
    const identityPath = regularContainedFile(evidenceRoot, 'image-identity.txt', 16 * 1024);
    const sbomPath = regularContainedFile(evidenceRoot, 'sbom.spdx.json', 100 * 1024 * 1024);
    const scanPath = regularContainedFile(evidenceRoot, 'grype.json', 100 * 1024 * 1024);
    const topologyPath = regularContainedFile(evidenceRoot, 'topology-evidence.json', 16 * 1024);

    const identity = parseIdentity(identityPath);
    const sbom = parseJson(sbomPath);
    const scan = parseJson(scanPath);
    const topology = parseJson(topologyPath);
    const scannerCounts = countScannerFindings(scan);
    const scanner = scannerIdentity(scan);
    const dockerfileSource = fs.readFileSync(dockerfile, 'utf8');
    const swiperSource = fs.readFileSync(swiperInstaller, 'utf8');
    verifyPinnedInputs(dockerfileSource, swiperSource);

    if (validateTopologyEvidence(topology) !== null || topology.classification !== 'success'
        || topology.contractReason !== 'success' || sbom.spdxVersion !== 'SPDX-2.3') {
        fail('provenance_exact_gate_correlation_failure');
    }
    if (identity.candidate_sha !== environment.CANDIDATE_SHA
        || identity.local_image_ref !== environment.IMAGE_REF
        || identity.local_image_id !== environment.EXPECTED_IMAGE_ID
        || (identity.build_action_image_id
            && identity.build_action_image_id !== identity.local_image_id)
        || identity.identity_scope !== 'run_local_not_registry_digest'
        || identity.registry_digest !== 'not_created'
        || identity.signature !== 'not_created'
        || identity.attestation !== 'not_created'
        || identity.configured_user !== environment.CONFIGURED_USER
        || identity.service_uid !== environment.SERVICE_UID
        || identity.service_gid !== environment.SERVICE_GID
        || identity.kernel_uid !== identity.service_uid
        || identity.kernel_gid !== identity.service_gid) {
        fail('provenance_image_identity_correlation_failure');
    }

    const evidence = buildCandidateEvidence({
        schema_version: SCHEMA_VERSION,
        repository: `https://github.com/${environment.GITHUB_REPOSITORY}`,
        source_sha: environment.CANDIDATE_SHA,
        workflow: {
            name: environment.GITHUB_WORKFLOW,
            run_id: environment.GITHUB_RUN_ID,
            run_attempt: environment.GITHUB_RUN_ATTEMPT,
            job: environment.GITHUB_JOB
        },
        build_inputs: {
            dockerfile_sha256: sha256(dockerfile),
            package_json_sha256: sha256(packageJson),
            package_lock_sha256: sha256(packageLock),
            platform: 'linux/amd64'
        },
        image: {
            id: identity.local_image_id,
            identity_scope: 'run_local_not_registry_digest',
            configured_user: identity.configured_user,
            service_uid: identity.service_uid,
            service_gid: identity.service_gid,
            kernel_uid: identity.kernel_uid,
            kernel_gid: identity.kernel_gid
        },
        slicers: EXACT_SLICERS,
        swiper: EXACT_SWIPER,
        sbom: {
            file_sha256: sha256(sbomPath),
            spdx_version: sbom.spdxVersion
        },
        scanner: {
            name: scanner.name,
            version: scanner.version,
            database_timestamp: scanner.databaseTimestamp,
            high: scannerCounts.high,
            critical: scannerCounts.critical,
            known_swiper_advisory: scannerCounts.knownSwiper
        },
        proofs: {
            private_peer: topology.privatePeerIngress === true
                && topology.authenticatedReadiness === true
                && topology.authRejectionProof === true,
            no_host_port: topology.hostPortAbsent,
            no_default_route: topology.apiNoDefaultRoute,
            api_egress_denied: topology.apiEgressDenied,
            native_egress_denied: topology.nativeEgressDenied,
            live_abort_no_artifact_process_settlement: environment.SMOKE_OUTCOME === 'success'
        },
        aggregator: {cleanup: environment.CLEANUP_OUTCOME, result: 'success'},
        registry_digest: 'not_created',
        signature: 'not_created',
        attestation: 'not_created',
        deployed_digest: 'not_applicable_no_publish'
    });

    const expected = {
        repository: EXACT_REPOSITORY,
        source_sha: environment.CANDIDATE_SHA,
        run_id: environment.GITHUB_RUN_ID,
        run_attempt: environment.GITHUB_RUN_ATTEMPT,
        job: environment.GITHUB_JOB,
        image_id: identity.local_image_id,
        sbom_sha256: sha256(sbomPath)
    };
    const validationError = validateCandidateEvidence(evidence, expected);
    if (validationError) fail(validationError);
    return evidence;
}

function main() {
    try {
        const evidence = buildFromRepository();
        const target = path.join(process.env.EVIDENCE_DIR, 'candidate-provenance.json');
        if (fs.existsSync(target) || fs.lstatSync(process.env.EVIDENCE_DIR).isSymbolicLink()) {
            fail('provenance_output_boundary_failure');
        }
        const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
        fs.writeFileSync(target, serialized, {flag: 'wx', mode: 0o600});
        const details = fs.lstatSync(target);
        if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_EVIDENCE_BYTES
            || path.dirname(fs.realpathSync(target)) !== fs.realpathSync(process.env.EVIDENCE_DIR)) {
            fail('provenance_output_boundary_failure');
        }
        console.log('candidate_provenance=PASS');
    } catch (error) {
        const code = /^[a-z0-9_]{1,80}$/.test(error?.code || error?.message || '')
            ? (error.code || error.message) : 'provenance_generation_failure';
        console.error(code);
        process.exitCode = 2;
    }
}

if (require.main === module) main();

module.exports = Object.freeze({
    EXPECTED_CLASSIFICATIONS,
    EXPECTED_OUTCOMES,
    buildFromRepository,
    countScannerFindings,
    scannerIdentity,
    verifyPinnedInputs
});
