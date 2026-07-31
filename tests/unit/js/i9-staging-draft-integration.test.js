'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DRAFT_FILE,
    loadManifest,
    writeDraft
} = require('../../../scripts/i9-staging-rollback-rehearsal');
const {
    validateStagingEvidence
} = require('../../../scripts/i9-staging-evidence');

test('runtime draft maps the exact manifest and three runtime generations into evidence', (t) => {
    const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i9-draft-'));
    t.after(() => fs.rmSync(evidenceDir, { recursive: true, force: true }));
    const manifest = loadManifest({});
    const runtime = (character, pid) => ({
        container_id: character.repeat(64),
        pid,
        kernel_uid: '999',
        kernel_gid: '999'
    });
    const state = {
        previousInitial: runtime('a', 101),
        candidateRuntime: runtime('b', 202),
        previousRollback: runtime('c', 303),
        readiness: {
            previous: true,
            candidate: true,
            storageFailureObserved: true,
            rollback: true
        },
        synthetic: { previous: true, candidate: true, rollback: true },
        cleanup: true,
        temporaryStateRemoved: true,
        classification: 'success'
    };
    writeDraft({
        evidenceDir,
        uid: '999',
        gid: '999',
        runId: '12345',
        runAttempt: '1',
        CANDIDATE_SHA: 'd'.repeat(40)
    }, manifest, state);
    const target = path.join(evidenceDir, DRAFT_FILE);
    const stat = fs.lstatSync(target);
    assert.ok(stat.isFile());
    assert.ok(!stat.isSymbolicLink());
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(validateStagingEvidence(value), null);
    assert.equal(value.images.previous.digest, manifest.raw.previous.digest);
    assert.equal(value.images.candidate.digest, manifest.raw.candidate.digest);
    assert.equal(value.rollback.transition.restored_digest, manifest.raw.previous.digest);
    assert.equal(value.deployed_digest, 'not_applicable_ephemeral_no_deploy');
});
