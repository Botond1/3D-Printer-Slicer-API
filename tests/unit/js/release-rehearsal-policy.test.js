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
const PREVIOUS_SOURCE = '1fffab87960c675a053ae814d374cab331fbb14d';
const PREVIOUS_DIGEST =
    'sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test('committed release policy pins only the immutable previous candidate', () => {
    const record = loadReleaseRehearsalPolicy(ROOT);
    assert.equal(validateReleaseRehearsalPolicy(record.value), null);
    assert.equal(record.value.schema_version, POLICY_SCHEMA_VERSION);
    assert.equal(record.value.previous.source_sha, PREVIOUS_SOURCE);
    assert.equal(record.value.previous.digest, PREVIOUS_DIGEST);
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
