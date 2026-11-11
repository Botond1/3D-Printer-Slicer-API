'use strict';

// The signed publication's last bookkeeping step ("Require the exact bounded
// publication evidence set") ran on 2026-11-11 against an evidence dir whose
// grype.yaml held the two rendered apt entries and refused it, although the
// image was pushed, attested and verified: the step admitted only an EMPTY
// grype.yaml. This test runs the step's own script (extracted from the
// workflow) against a temporary evidence dir: grype.yaml is admitted only when
// empty or byte-equal to what tests/golden/grype-ignore-policy.js renders from
// ops/security/grype-ignore.yaml; syft.yaml only when empty.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'candidate-publication.yml');
const policy = require('../../golden/grype-ignore-policy.js');

function stepScript() {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    const start = text.indexOf('        id: publication_evidence_boundary\n');
    assert.ok(start > 0, 'the publication_evidence_boundary step exists');
    const open = text.indexOf("node <<'NODE'\n", start);
    const close = text.indexOf('\n          NODE\n', open);
    assert.ok(open > start && close > open, 'the step carries one node heredoc');
    return text.slice(open + "node <<'NODE'\n".length, close + 1)
        .split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
}

function rendered() {
    const entries = policy.parseIgnoreFile(fs.readFileSync(path.join(ROOT, 'ops/security/grype-ignore.yaml'), 'utf8'));
    assert.deepEqual(policy.validateEntries(entries), [], 'the repository ignore list is admitted today');
    return policy.renderGrypeConfig(entries);
}

function evidenceDir(t, overrides = {}) {
    const runnerTemp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-pub-boundary-')));
    t.after(() => fs.rmSync(runnerTemp, { recursive: true, force: true }));
    const subdir = 'evidence';
    const root = path.join(runnerTemp, subdir);
    fs.mkdirSync(root);
    const files = {
        'i11-publication-draft.json': '{}\n', 'i11-main-candidate-provenance.json': '{}\n',
        'image-identity.txt': 'id\n', 'runtime-diagnostics.json': '{}\n', 'topology-evidence.json': '{}\n',
        'sbom.spdx.json': '{}\n', 'grype.json': '{}\n', 'syft.yaml': '', 'grype.yaml': rendered(), ...overrides
    };
    for (const [name, content] of Object.entries(files)) {
        if (content !== null) fs.writeFileSync(path.join(root, name), content);
    }
    return { RUNNER_TEMP: runnerTemp, EVIDENCE_SUBDIR: subdir, EVIDENCE_DIR: root };
}

function run(env) {
    // cwd = the checkout, as in the workflow step (relative require and read).
    return spawnSync(process.execPath, ['-e', stepScript()], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('the step admits grype.yaml as the rendered ignore list (the 2026-11-11 refusal)', (t) => {
    assert.ok(rendered().length > 0, 'the repository list renders entries, as on 2026-11-11');
    const result = run(evidenceDir(t));
    assert.equal(result.status, 0, result.stderr);
});

test('the step admits the gate\'s empty grype.yaml', (t) => {
    const result = run(evidenceDir(t, { 'grype.yaml': '' }));
    assert.equal(result.status, 0, result.stderr);
});

test('the step refuses any other grype.yaml content', (t) => {
    const good = rendered();
    for (const content of [
        `${good}\n`, good.slice(0, -1), good.replace('ignore:', 'ignore: '), 'ignore: []\n',
        `${good}  - vulnerability: "CVE-2026-0001"\n`, 'x', `${good}`.replace(/"CVE-[0-9-]+"/, '"CVE-2026-99999"')
    ]) {
        assert.notEqual(content, good);
        const result = run(evidenceDir(t, { 'grype.yaml': content }));
        assert.equal(result.status, 2, `admitted ${JSON.stringify(content.slice(0, 40))}`);
    }
});

test('the step still refuses a non-empty syft.yaml, a missing file and an extra file', (t) => {
    assert.equal(run(evidenceDir(t, { 'syft.yaml': 'x' })).status, 2);
    assert.equal(run(evidenceDir(t, { 'grype.yaml': null })).status, 2);
    assert.equal(run(evidenceDir(t, { 'extra.txt': 'x' })).status, 2);
    assert.equal(run(evidenceDir(t, { 'grype.json': '' })).status, 2);
});

test('the step refuses a grype.yaml over its bound even if the policy rendered it', (t) => {
    const huge = `${rendered()}${'#'.repeat(16 * 1024)}`;
    assert.equal(run(evidenceDir(t, { 'grype.yaml': huge })).status, 2);
});
