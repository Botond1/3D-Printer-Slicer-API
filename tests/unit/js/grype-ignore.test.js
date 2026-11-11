'use strict';

/**
 * `ops/security/grype-ignore.yaml` (R21): every ignore entry carries a reason
 * and an expiry; an expired or reason-less entry fails this test and the
 * image gate step that renders the list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const POLICY = path.join(ROOT, 'ops/security/grype-ignore.yaml');
const SCRIPT = path.join(ROOT, 'tests/golden/grype-ignore-policy.js');
const { PolicyError, parseIgnoreFile, renderGrypeConfig, validateEntries } = require('../../golden/grype-ignore-policy');

const NOW = new Date('2026-11-11T12:00:00Z');
const GOOD = [
    'ignore:',
    '  - vulnerability: CVE-2026-12345',
    '    package: example-package',
    '    reason: "Not reachable: the binary is never executed in the image."',
    '    expires: 2026-12-31',
    ''
].join('\n');

test('the repository ignore list parses and every entry is admitted today', () => {
    const entries = parseIgnoreFile(fs.readFileSync(POLICY, 'utf8'));
    assert.deepEqual(validateEntries(entries), []);
    for (const entry of entries) {
        assert.ok(entry.reason, entry.vulnerability);
        assert.ok(entry.expires, entry.vulnerability);
    }
});

test('a complete entry is admitted and renders into the Grype ignore rule', () => {
    const entries = parseIgnoreFile(GOOD);
    assert.deepEqual(validateEntries(entries, NOW), []);
    assert.equal(renderGrypeConfig(entries), 'ignore:\n  - vulnerability: "CVE-2026-12345"\n    package:\n      name: "example-package"\n');
    assert.equal(renderGrypeConfig([]), '');
    assert.deepEqual(parseIgnoreFile('# none\nignore: []\n'), []);
});

test('an expired entry fails', () => {
    const problems = validateEntries(parseIgnoreFile(GOOD.replace('2026-12-31', '2026-11-10')), NOW);
    assert.ok(problems.some((problem) => /expired on 2026-11-10/.test(problem)));
    assert.deepEqual(validateEntries(parseIgnoreFile(GOOD.replace('2026-12-31', '2026-11-11')), NOW), []);
});

test('an entry without a reason, without an expiry or with a far expiry fails', () => {
    const noReason = GOOD.replace(/ {4}reason: .*\n/, '');
    assert.ok(validateEntries(parseIgnoreFile(noReason), NOW).some((problem) => /reason/.test(problem)));
    assert.ok(validateEntries(parseIgnoreFile(GOOD.replace(/"Not reachable.*"/, '"short"')), NOW).some((problem) => /reason/.test(problem)));
    const noExpiry = GOOD.replace(/ {4}expires: .*\n/, '');
    assert.ok(validateEntries(parseIgnoreFile(noExpiry), NOW).some((problem) => /expires/.test(problem)));
    assert.ok(validateEntries(parseIgnoreFile(GOOD.replace('2026-12-31', '2027-12-31')), NOW).some((problem) => /180 days/.test(problem)));
    assert.ok(validateEntries(parseIgnoreFile(GOOD.replace('2026-12-31', '2026-02-30')), NOW).some((problem) => /real YYYY-MM-DD/.test(problem)));
});

test('malformed files and ids are refused instead of read loosely', () => {
    assert.throws(() => parseIgnoreFile(''), PolicyError);
    assert.throws(() => parseIgnoreFile('ignore:\n'), PolicyError);
    assert.throws(() => parseIgnoreFile(GOOD.replace('package:', 'severity:')), PolicyError);
    assert.throws(() => parseIgnoreFile(GOOD.replace('    package', '      package')), PolicyError);
    assert.throws(() => parseIgnoreFile(`${GOOD}    reason: "twice is not allowed here at all"\n`), PolicyError);
    assert.ok(validateEntries(parseIgnoreFile(GOOD.replace('CVE-2026-12345', 'ANY')), NOW).some((problem) => /CVE or GHSA/.test(problem)));
    assert.ok(validateEntries(parseIgnoreFile(`${GOOD}${GOOD.split('\n').slice(1).join('\n')}`), NOW).some((problem) => /duplicate/.test(problem)));
});

test('the renderer CLI writes the run-local config for admitted entries and refuses an expired list', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grype-policy-'));
    try {
        const target = path.join(directory, 'grype.yaml');
        fs.writeFileSync(target, '');
        const emptyPolicy = path.join(directory, 'empty.yaml');
        fs.writeFileSync(emptyPolicy, 'ignore: []\n');
        const empty = spawnSync(process.execPath, [SCRIPT, emptyPolicy, target], { encoding: 'utf8' });
        assert.equal(empty.status, 0, empty.stderr);
        assert.equal(fs.readFileSync(target, 'utf8'), '');

        const expired = path.join(directory, 'expired.yaml');
        fs.writeFileSync(expired, GOOD.replace('2026-12-31', '2020-01-01'));
        const refused = spawnSync(process.execPath, [SCRIPT, expired, target], { encoding: 'utf8' });
        assert.equal(refused.status, 1);
        assert.match(refused.stderr, /expired/);
        assert.equal(fs.readFileSync(target, 'utf8'), '');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
