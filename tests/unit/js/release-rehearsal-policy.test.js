'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
    POLICY_SCHEMA_VERSION,
    loadReleaseRehearsalPolicy,
    validateReleaseRehearsalPolicy
} = require('../../../scripts/release-rehearsal-input');

const ROOT = path.resolve(__dirname, '../../..');
const PREVIOUS_SOURCE = '4539c539d15dacb19cde7e246aab690cc11170e7';
const PREVIOUS_DIGEST =
    'sha256:1c784b627fc5783b633b9a0b7c2b086588fbe149c00770d7f0cac5594860efb9';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test('committed release policy pins only the immutable previous candidate', () => {
    const record = loadReleaseRehearsalPolicy(ROOT);
    assert.equal(validateReleaseRehearsalPolicy(record.value), null);
    assert.equal(record.value.schema_version, POLICY_SCHEMA_VERSION);
    assert.equal(record.value.previous.source_sha, PREVIOUS_SOURCE);
    assert.equal(record.value.previous.digest, PREVIOUS_DIGEST);
    assert.equal(record.value.previous.config_digest,
        'sha256:7b77f8a495abb13d78d8714afc863728a435bcbdd21720d11fd9b4eccfd8bd6e');
    assert.equal(record.value.previous.attestation.source_ref, 'refs/heads/main');
    assert.equal(record.value.previous.attestation.source_digest, PREVIOUS_SOURCE);
    assert.equal(record.value.candidate.source_ref, 'refs/heads/main');
    assert.equal(Object.hasOwn(record.value.candidate, 'digest'), false);
    assert.equal(Object.hasOwn(record.value.previous, 'discovery_tag'), false);
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
});

test('policy exact keys reject candidate identity, tag, attestation, and control drift', async (t) => {
    const base = loadReleaseRehearsalPolicy(ROOT).value;
    const mutations = [
        ['candidate digest injected', (x) => { x.candidate.digest = PREVIOUS_DIGEST; }],
        ['candidate branch changed', (x) => { x.candidate.source_ref = 'refs/heads/release'; }],
        ['candidate workflow changed', (x) => {
            x.candidate.publication_workflow_path = '.github/workflows/other.yml';
        }],
        ['previous discovery tag injected', (x) => {
            x.previous.discovery_tag = `candidate-${PREVIOUS_SOURCE}`;
        }],
        ['previous digest replaced by config', (x) => {
            x.previous.digest = x.previous.config_digest;
        }],
        ['previous source binding changed', (x) => {
            x.previous.attestation.source_digest = '9'.repeat(40);
        }],
        ['previous signer changed', (x) => {
            x.previous.attestation.signer_repository = 'other/repository';
        }],
        ['digest-only control disabled', (x) => {
            x.controls.digest_only_runtime_required = false;
        }],
        ['registry writes enabled', (x) => { x.controls.registry_writes_forbidden = false; }],
        ['deploy enabled', (x) => { x.controls.deploy_forbidden = false; }],
        ['platform changed', (x) => { x.platform = 'linux/arm64'; }],
        ['unknown root field', (x) => { x.release_tag = 'latest'; }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = clone(base);
        mutate(value);
        assert.notEqual(validateReleaseRehearsalPolicy(value), null);
    });
});
