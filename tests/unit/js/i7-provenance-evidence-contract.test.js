'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    EVIDENCE_KEYS,
    MAX_EVIDENCE_BYTES,
    SCHEMA_VERSION,
    buildCandidateEvidence,
    validateCandidateEvidence
} = require('../../../scripts/i7-provenance-evidence');
const HASH_A = '0123456789abcdef'.repeat(4);
const HASH_B = 'abcdef0123456789'.repeat(4);
const SHA512 =
    'e2020bac8def5d9aa8661ef52353c02eaba4085824fa0a4ec1ed6d3afcf9b84f'
    + '641ed9768130f39987e5602c16bd1e0b3af0ab262e9410453e827b96e41b6481';
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const WORKFLOW_NAME = 'Image Validation - Build Once (NO PUSH / NO DEPLOY)';
const WORKFLOW_JOB = 'validate-image';
const EXPECTED_KEYS = Object.freeze({
    top: [
        'aggregator', 'attestation', 'build_inputs', 'deployed_digest', 'image',
        'proofs', 'registry_digest', 'repository', 'sbom', 'scanner',
        'schema_version', 'signature', 'slicers', 'source_sha', 'swiper', 'workflow'
    ],
    workflow: ['job', 'name', 'run_attempt', 'run_id'],
    build_inputs: ['dockerfile_sha256', 'package_json_sha256', 'package_lock_sha256', 'platform'],
    image: ['configured_user', 'id', 'identity_scope', 'kernel_gid', 'kernel_uid', 'service_gid', 'service_uid'],
    slicers: ['bambu', 'orca', 'prusa'],
    slicer: ['sha256', 'url', 'version'],
    swiper: ['sha256', 'sha512', 'url', 'version'],
    sbom: ['file_sha256', 'spdx_version'],
    scanner: ['critical', 'database_timestamp', 'high', 'known_swiper_advisory', 'name', 'version'],
    proofs: [
        'api_egress_denied', 'live_abort_no_artifact_process_settlement',
        'native_egress_denied', 'no_default_route', 'no_host_port', 'private_peer'
    ],
    aggregator: ['cleanup', 'result']
});
function validInput() {
    return {
        schema_version: SCHEMA_VERSION,
        repository: 'https://github.com/Botond1/3D-Printer-Slicer-API',
        source_sha: SOURCE_SHA,
        workflow: {
            name: WORKFLOW_NAME,
            run_id: '123456789',
            run_attempt: '1',
            job: WORKFLOW_JOB
        },
        build_inputs: {
            dockerfile_sha256: HASH_A,
            package_json_sha256: HASH_B,
            package_lock_sha256: HASH_A,
            platform: 'linux/amd64'
        },
        image: {
            id: `sha256:${HASH_B}`,
            identity_scope: 'run_local_not_registry_digest',
            configured_user: 'slicer',
            service_uid: '10001',
            service_gid: '10001',
            kernel_uid: '10001',
            kernel_gid: '10001'
        },
        slicers: {
            prusa: {version: '2.8.1',
                url: 'https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage',
                sha256: '565f2f4bd4dbb05904a459d54db1916b6932124709c1d17b5aacfe9f5f2f1b03'},
            orca: {version: '2.3.1',
                url: 'https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage',
                sha256: 'f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701'},
            bambu: {version: '02.08.02.61',
                url: 'https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/BambuStudio_ubuntu24.04-v02.08.02.61-20260820225108.AppImage',
                sha256: 'd501b103fac5424513ec0e8d6bc145fb30719de2c7d94d7320d723740c81a7fd'}
        },
        swiper: {
            version: '12.1.2',
            url: 'https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz',
            sha512: SHA512,
            sha256: '7780a8143baf0f021fcc3de927cc95c6b79e8fdc6d38e1f5ba2d0ed17d943457'
        },
        sbom: {file_sha256: HASH_B, spdx_version: 'SPDX-2.3'},
        scanner: {name: 'grype', version: '0.110.0',
            database_timestamp: '2026-07-25T00:00:00Z',
            high: 0, critical: 0, known_swiper_advisory: 0},
        proofs: {
            private_peer: true,
            no_host_port: true,
            no_default_route: true,
            api_egress_denied: true,
            native_egress_denied: true,
            live_abort_no_artifact_process_settlement: true
        },
        aggregator: {cleanup: 'success', result: 'success'},
        registry_digest: 'not_created',
        signature: 'not_created',
        attestation: 'not_created',
        deployed_digest: 'not_applicable_no_publish'
    };
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function assertExactKeys(value, expected, label) {
    assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
}
function assertRejected(value, expected = {}) {
    const result = validateCandidateEvidence(value, expected);
    assert.equal(typeof result, 'string');
    assert.match(result, /^[a-z][a-z0-9_]*$/);
}
test('builder emits one frozen, bounded, exact-schema successful evidence object', () => {
    const evidence = buildCandidateEvidence(validInput());
    assert.equal(validateCandidateEvidence(evidence), null);
    assert.equal(evidence.schema_version, 'i7-s3a-candidate-provenance-v2');
    assert.ok(Object.isFrozen(evidence));
    assert.ok(Object.isFrozen(evidence.workflow));
    assert.ok(Object.isFrozen(evidence.slicers.prusa));
    assert.ok(Object.isFrozen(evidence.slicers.bambu));
    assert.ok(Buffer.byteLength(JSON.stringify(evidence), 'utf8') <= MAX_EVIDENCE_BYTES);
    assertExactKeys(evidence, EXPECTED_KEYS.top, 'top-level allowlist');
    assert.deepEqual([...EVIDENCE_KEYS.root].sort(), [...EXPECTED_KEYS.top].sort());
    for (const key of ['workflow', 'build_inputs', 'image', 'swiper', 'sbom', 'scanner', 'proofs', 'aggregator']) {
        assertExactKeys(evidence[key], EXPECTED_KEYS[key], key);
        assert.deepEqual([...EVIDENCE_KEYS[key]].sort(), [...EXPECTED_KEYS[key]].sort());
    }
    assertExactKeys(evidence.slicers, EXPECTED_KEYS.slicers, 'slicers');
    assertExactKeys(evidence.slicers.prusa, EXPECTED_KEYS.slicer, 'Prusa');
    assertExactKeys(evidence.slicers.orca, EXPECTED_KEYS.slicer, 'Orca');
    assertExactKeys(evidence.slicers.bambu, EXPECTED_KEYS.slicer, 'Bambu');
});

test('validator rejects v1-shaped evidence that omits the pinned Bambu Studio slicer', () => {
    const value = validInput();
    delete value.slicers.bambu;
    assert.equal(validateCandidateEvidence(value), 'slicers_schema_mismatch');
    value.schema_version = 'i7-s3a-candidate-provenance-v1';
    assert.equal(validateCandidateEvidence(value), 'evidence_version_mismatch');
});
test('builder rejects non-object input and does not retain caller-owned mutable state', () => {
    for (const value of [null, [], 'evidence', 1]) {
        assert.throws(() => buildCandidateEvidence(value), TypeError);
    }
    const input = validInput();
    const evidence = buildCandidateEvidence(input);
    input.proofs.private_peer = false;
    assert.equal(evidence.proofs.private_peer, true);
});

test('validator rejects missing, extra, malformed, and oversized schema state', async (t) => {
    const base = buildCandidateEvidence(validInput());
    const cases = [
        ['not an object', null],
        ['missing top-level field', (() => { const x = clone(base); delete x.sbom; return x; })()],
        ['extra top-level field', {...clone(base), raw_docker_inspect: {}}],
        ['missing nested field', (() => { const x = clone(base); delete x.image.kernel_gid; return x; })()],
        ['extra nested field', (() => { const x = clone(base); x.scanner.raw_matches = []; return x; })()],
        ['wrong schema version', {...clone(base), schema_version: `${SCHEMA_VERSION}-next`}],
        ['oversized evidence', {...clone(base), repository: 'x'.repeat(MAX_EVIDENCE_BYTES)}]
    ];
    for (const [name, value] of cases) await t.test(name, () => assertRejected(value));
});

test('validator binds source, workflow, build, image, and runtime identity', async (t) => {
    const base = buildCandidateEvidence(validInput());
    const expected = {
        repository: base.repository,
        source_sha: base.source_sha,
        run_id: base.workflow.run_id,
        run_attempt: base.workflow.run_attempt,
        job: base.workflow.job,
        image_id: base.image.id,
        sbom_sha256: base.sbom.file_sha256
    };
    assert.equal(validateCandidateEvidence(base, expected), null);
    const mutations = [
        ['short source SHA', (x) => { x.source_sha = x.source_sha.slice(0, -1); }],
        ['uppercase source SHA', (x) => { x.source_sha = x.source_sha.toUpperCase(); }],
        ['repository mismatch', (x) => { x.repository = 'https://github.com/other/repository'; }],
        ['workflow mismatch', (x) => { x.workflow.name = 'Other Validation Workflow'; }],
        ['job mismatch', (x) => { x.workflow.job = 'other-job'; }],
        ['Dockerfile hash malformed', (x) => { x.build_inputs.dockerfile_sha256 = 'abc'; }],
        ['package hash uppercase', (x) => { x.build_inputs.package_json_sha256 = HASH_A.toUpperCase(); }],
        ['platform changed', (x) => { x.build_inputs.platform = 'linux/arm64'; }],
        ['registry identity claimed', (x) => { x.image.identity_scope = 'registry_digest'; }],
        ['image ID malformed', (x) => { x.image.id = HASH_A; }],
        ['configured user mismatch', (x) => { x.image.configured_user = '10001:10001'; }],
        ['kernel UID mismatch', (x) => { x.image.kernel_uid = '10002'; }],
        ['kernel GID mismatch', (x) => { x.image.kernel_gid = '10002'; }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(base);
        mutate(value);
        assertRejected(value, expected);
    });
    for (const [name, key, value] of [
        ['expected run ID mismatch', 'run_id', '987654321'],
        ['expected run attempt mismatch', 'run_attempt', '2'],
        ['expected image mismatch', 'image_id', `sha256:${HASH_A}`],
        ['expected SBOM mismatch', 'sbom_sha256', HASH_A]
    ]) {
        await t.test(name, () => assertRejected(base, {...expected, [key]: value}));
    }
});

test('validator binds pinned tool metadata, successful proofs, and no-publication state', async (t) => {
    const base = buildCandidateEvidence(validInput());
    const mutations = [
        ['Prusa version', (x) => { x.slicers.prusa.version = '2.8.2'; }],
        ['Prusa hash', (x) => { x.slicers.prusa.sha256 = HASH_A; }],
        ['Orca URL', (x) => { x.slicers.orca.url += '?mirror=1'; }],
        ['Bambu version', (x) => { x.slicers.bambu.version = '2.8.2.61'; }],
        ['Bambu hash', (x) => { x.slicers.bambu.sha256 = HASH_A; }],
        ['Bambu URL', (x) => { x.slicers.bambu.url += '?mirror=1'; }],
        ['Bambu extra field', (x) => { x.slicers.bambu.wrapper = '/usr/local/bin/bambu-studio'; }],
        ['Swiper version', (x) => { x.swiper.version = '12.1.3'; }],
        ['Swiper URL', (x) => { x.swiper.url += '?mirror=1'; }],
        ['Swiper SHA256', (x) => { x.swiper.sha256 = HASH_A; }],
        ['Swiper SHA512', (x) => { x.swiper.sha512 = HASH_A; }],
        ['SPDX version', (x) => { x.sbom.spdx_version = 'SPDX-2.2'; }],
        ['SBOM hash', (x) => { x.sbom.file_sha256 = 'invalid'; }],
        ['scanner name', (x) => { x.scanner.name = 'other'; }],
        ['scanner version', (x) => { x.scanner.version = 'latest'; }],
        ['scanner timestamp', (x) => { x.scanner.database_timestamp = 'yesterday'; }],
        ['HIGH finding', (x) => { x.scanner.high = 1; }],
        ['CRITICAL count malformed', (x) => { x.scanner.critical = -1; }],
        ['known Swiper advisory', (x) => { x.scanner.known_swiper_advisory = 1; }],
        ['cleanup failed', (x) => { x.aggregator.cleanup = 'failure'; }],
        ['aggregate failed', (x) => { x.aggregator.result = 'failure'; }],
        ['registry digest created', (x) => { x.registry_digest = `sha256:${HASH_A}`; }],
        ['signature created', (x) => { x.signature = 'created'; }],
        ['attestation created', (x) => { x.attestation = 'created'; }],
        ['deployed digest claimed', (x) => { x.deployed_digest = `sha256:${HASH_A}`; }]
    ];
    for (const key of EXPECTED_KEYS.proofs) {
        mutations.push([`${key} false`, (x) => { x.proofs[key] = false; }]);
    }
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(base);
        mutate(value);
        assertRejected(value);
    });
});
