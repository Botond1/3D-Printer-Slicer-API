'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
    verifySourceCompatibility
} = require('../../../scripts/release-rehearsal-input');

const ROOT = path.resolve(__dirname, '../../..');
const PREVIOUS_SHA = '1fffab87960c675a053ae814d374cab331fbb14d';
const CANDIDATE_SHA = '0123456789abcdef0123456789abcdef01234567';

test('source compatibility is bound to ancestry, configs, Compose, and exact HEAD', () => {
    const calls = [];
    const execute = (command, args, options) => {
        calls.push({command, args, options});
        return args[0] === 'rev-parse' ? `${CANDIDATE_SHA}\n` : '';
    };
    assert.deepEqual(
        verifySourceCompatibility(ROOT, PREVIOUS_SHA, CANDIDATE_SHA, execute),
        {
            previous_source_sha: PREVIOUS_SHA,
            candidate_source_sha: CANDIDATE_SHA,
            previous_is_ancestor: true,
            configs_unchanged: true,
            production_compose_unchanged: true
        }
    );
    assert.deepEqual(calls.map(({command, args}) => [command, ...args]), [
        ['git', 'cat-file', '-e', `${PREVIOUS_SHA}^{commit}`],
        ['git', 'cat-file', '-e', `${CANDIDATE_SHA}^{commit}`],
        ['git', 'rev-parse', 'HEAD'],
        ['git', 'merge-base', '--is-ancestor', PREVIOUS_SHA, CANDIDATE_SHA],
        ['git', 'diff', '--quiet', PREVIOUS_SHA, CANDIDATE_SHA, '--', 'configs'],
        [
            'git', 'diff', '--quiet', PREVIOUS_SHA, CANDIDATE_SHA, '--',
            'docker-compose.production.yml'
        ]
    ]);
    assert.ok(calls.every(({options}) => options.cwd === ROOT
        && options.timeout === 30_000 && options.maxBuffer === 256 * 1024));
});

test('source compatibility fails closed when a required git predicate fails', () => {
    const execute = (_command, args) => {
        if (args[0] === 'rev-parse') return `${CANDIDATE_SHA}\n`;
        if (args[0] === 'diff' && args.at(-1) === 'configs') throw new Error('drift');
        return '';
    };
    assert.throws(
        () => verifySourceCompatibility(ROOT, PREVIOUS_SHA, CANDIDATE_SHA, execute),
        (error) => error.code === 'source_compatibility_verification_failure'
    );
});

test('source compatibility rejects identical or non-canonical source identities', () => {
    const execute = () => {
        throw new Error('git must not run for malformed identities');
    };
    for (const [previous, candidate] of [
        [PREVIOUS_SHA, PREVIOUS_SHA],
        ['A'.repeat(40), CANDIDATE_SHA],
        [PREVIOUS_SHA, '0'.repeat(39)]
    ]) {
        assert.throws(
            () => verifySourceCompatibility(ROOT, previous, candidate, execute),
            (error) => error.code === 'source_compatibility_verification_failure'
        );
    }
});
