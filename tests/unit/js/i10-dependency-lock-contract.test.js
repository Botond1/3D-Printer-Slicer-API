'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const BRACE_EXPANSION_KEY = 'node_modules/brace-expansion';
const EXPECTED = Object.freeze({
    version: '5.0.12',
    resolved: 'https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz',
    integrity: 'sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ=='
});
function validateBraceExpansionLock(lock) {
    const entry = lock?.packages?.[BRACE_EXPANSION_KEY];
    const errors = [];
    if (!entry || entry.version !== EXPECTED.version) errors.push('brace_expansion_version_mismatch');
    if (!entry || entry.resolved !== EXPECTED.resolved) errors.push('brace_expansion_source_mismatch');
    if (!entry || entry.integrity !== EXPECTED.integrity) errors.push('brace_expansion_integrity_mismatch');
    return errors;
}

test('production lock pins the reviewed brace-expansion 5.0.12 artifact', () => {
    assert.deepEqual(validateBraceExpansionLock(LOCK), []);
});

test('brace-expansion downgrade, source drift, and integrity drift fail closed', async (t) => {
    const mutations = [
        ['downgrade', (entry) => { entry.version = '5.0.11'; }, /version/],
        ['source drift', (entry) => { entry.resolved = 'https://example.invalid/archive.tgz'; }, /source/],
        ['integrity drift', (entry) => { entry.integrity = `sha512-${'A'.repeat(88)}`; }, /integrity/]
    ];

    for (const [name, mutate, expected] of mutations) {
        await t.test(name, () => {
            const candidate = structuredClone(LOCK);
            mutate(candidate.packages[BRACE_EXPANSION_KEY]);
            assert.match(validateBraceExpansionLock(candidate).join('\n'), expected);
        });
    }
});
