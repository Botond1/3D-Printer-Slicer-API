'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    EXACT_GHCR_REPOSITORY,
    IMAGE_KEYS,
    MANIFEST_KEYS,
    MANIFEST_RELATIVE_PATH,
    MANIFEST_SCHEMA_VERSION,
    MAX_MANIFEST_BYTES,
    POLICY_KEYS,
    loadStagingManifest,
    validateStagingManifest
} = require('../../../scripts/i9-staging-manifest');

const ROOT = path.resolve(__dirname, '../../..');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function validManifest() {
    return clone(loadStagingManifest(ROOT).value);
}

function rejected(value) {
    const result = validateStagingManifest(value);
    assert.equal(typeof result, 'string');
    assert.match(result, /^[a-z][a-z0-9_]*$/);
}

test('checked-in rehearsal manifest is bounded, exact-key, immutable-digest-only state', () => {
    const {path: target, value} = loadStagingManifest(ROOT);
    assert.equal(target, path.join(ROOT, MANIFEST_RELATIVE_PATH));
    assert.equal(validateStagingManifest(value), null);
    assert.equal(value.schema_version, MANIFEST_SCHEMA_VERSION);
    assert.equal(value.repository, EXACT_GHCR_REPOSITORY);
    assert.notEqual(value.previous.digest, value.candidate.digest);
    assert.notEqual(value.previous.config_digest, value.candidate.config_digest);
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.previous));
    assert.ok(Object.isFrozen(value.policy));
    assert.deepEqual(Object.keys(value).sort(), [...MANIFEST_KEYS].sort());
    assert.deepEqual(Object.keys(value.previous).sort(), [...IMAGE_KEYS].sort());
    assert.deepEqual(Object.keys(value.candidate).sort(), [...IMAGE_KEYS].sort());
    assert.deepEqual(Object.keys(value.policy).sort(), [...POLICY_KEYS].sort());
    assert.ok(fs.statSync(target).size <= MAX_MANIFEST_BYTES);
});

test('manifest rejects missing, extra, malformed, tagged, equal, or weakened state', async (t) => {
    const mutations = [
        ['not object', () => null],
        ['missing root', (x) => { delete x.policy; }],
        ['extra root', (x) => { x.runtime_output = {}; }],
        ['missing image key', (x) => { delete x.previous.digest; }],
        ['extra image key', (x) => { x.candidate.signature = 'trusted'; }],
        ['wrong version', (x) => { x.schema_version += '-next'; }],
        ['wrong repository', (x) => { x.repository = 'ghcr.io/other/repository'; }],
        ['previous role weakened', (x) => { x.previous.role = 'previous'; }],
        ['candidate role weakened', (x) => { x.candidate.role = 'candidate'; }],
        ['tag instead of digest', (x) => { x.candidate.digest = x.candidate.discovery_tag; }],
        ['uppercase digest', (x) => { x.candidate.digest = x.candidate.digest.toUpperCase(); }],
        ['short source SHA', (x) => { x.previous.source_sha = x.previous.source_sha.slice(1); }],
        ['wrong discovery tag', (x) => { x.candidate.discovery_tag = 'latest'; }],
        ['manifest and config digest equal', (x) => {
            x.candidate.config_digest = x.candidate.digest;
        }],
        ['same source', (x) => { x.previous.source_sha = x.candidate.source_sha; }],
        ['same manifest digest', (x) => { x.previous.digest = x.candidate.digest; }],
        ['same config digest', (x) => {
            x.previous.config_digest = x.candidate.config_digest;
        }],
        ['arm platform', (x) => { x.policy.platform = 'linux/arm64'; }],
        ['registry writes enabled', (x) => { x.policy.registry_writes_forbidden = false; }],
        ['deploy enabled', (x) => { x.policy.deploy_forbidden = false; }],
        ['previous requalification skipped', (x) => {
            x.policy.previous_fresh_attestation_verification_required = false;
        }],
        ['candidate verification skipped', (x) => {
            x.policy.candidate_fresh_attestation_verification_required = false;
        }]
    ];
    for (const [name, mutate] of mutations) await t.test(name, () => {
        const value = validManifest();
        const replacement = mutate(value);
        rejected(replacement === undefined ? value : replacement);
    });
    const oversized = validManifest();
    oversized.repository = 'x'.repeat(MAX_MANIFEST_BYTES);
    rejected(oversized);
});

test('loader rejects absent, malformed, and non-file manifest targets', (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'i9-manifest-'));
    t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
    assert.throws(() => loadStagingManifest(temporary), /manifest_file_boundary_failure/);

    const github = path.join(temporary, '.github');
    fs.mkdirSync(github);
    const target = path.join(temporary, MANIFEST_RELATIVE_PATH);
    fs.writeFileSync(target, '{invalid');
    assert.throws(() => loadStagingManifest(temporary), /manifest_json_parse_failure/);

    fs.rmSync(target);
    fs.mkdirSync(target);
    assert.throws(() => loadStagingManifest(temporary), /manifest_file_boundary_failure/);
});
