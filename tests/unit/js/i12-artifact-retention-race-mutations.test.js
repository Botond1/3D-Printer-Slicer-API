'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.resolve(__dirname, '../../../app/services/artifact-store.js');
const OUTPUT_PATH = path.resolve(__dirname, '../../../app/services/slice/output-lifecycle.js');
const STORE_SOURCE = fs.readFileSync(STORE_PATH, 'utf8');
const OUTPUT_SOURCE = fs.readFileSync(OUTPUT_PATH, 'utf8');

function assertSerializedRetention(source) {
    const required = [
        'let cleanupTail = Promise.resolve();',
        'const cleanup = cleanupTail.then(() => runCleanup(options));',
        'cleanupTail = cleanup.catch(() => {});',
        'return cleanup;'
    ];
    let cursor = -1;
    for (const contract of required) {
        const next = source.indexOf(contract);
        assert.ok(next > cursor, `missing or reordered cleanup serialization: ${contract}`);
        cursor = next;
    }
    assert.equal(
        source.includes('if (cleanupPromise) return cleanupPromise;'),
        false,
        'concurrent callers must not share a stale in-flight result'
    );
}

function assertPromotionRetentionOrder(source) {
    const promotion = source.indexOf(
        'await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);'
    );
    const cleanup = source.indexOf('const cleanup = await cleanupManagedArtifacts();');
    const enforcement = source.indexOf('if (!cleanup.quotaSatisfied) {');
    assert.ok(promotion >= 0 && cleanup > promotion && enforcement > cleanup,
        'promotion must be followed by its own fail-closed retention result');
}

function replaceRequired(source, before, after) {
    assert.ok(source.includes(before), `mutation fixture missing: ${before}`);
    return source.replace(before, after);
}

test('committed artifact retention and promotion integration satisfy the serialization contract', () => {
    assertSerializedRetention(STORE_SOURCE);
    assertPromotionRetentionOrder(OUTPUT_SOURCE);
});

const storeMutations = [
    ['uninitialized cleanup tail', 'let cleanupTail = Promise.resolve();', 'let cleanupTail;'],
    [
        'stale single-flight restored',
        'const cleanup = cleanupTail.then(() => runCleanup(options));',
        'if (cleanupPromise) return cleanupPromise;\n    const cleanup = runCleanup(options);'
    ],
    [
        'next pass not chained',
        'const cleanup = cleanupTail.then(() => runCleanup(options));',
        'const cleanup = runCleanup(options);'
    ],
    ['tail update removed', 'cleanupTail = cleanup.catch(() => {});', ''],
    ['failed pass poisons lane', 'cleanupTail = cleanup.catch(() => {});', 'cleanupTail = cleanup;'],
    ['caller receives swallowed tail', 'return cleanup;', 'return cleanupTail;']
];

test('artifact retention serialization weakening mutations are rejected', async (t) => {
    for (const [label, before, after] of storeMutations) {
        await t.test(label, () => {
            assert.throws(() => assertSerializedRetention(replaceRequired(STORE_SOURCE, before, after)));
        });
    }
});

const integrationMutations = [
    [
        'cleanup removed',
        'const cleanup = await cleanupManagedArtifacts();',
        'const cleanup = { quotaSatisfied: true };'
    ],
    [
        'retention moved before promotion',
        'await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);\n    throwIfAborted(signal);\n    const cleanup = await cleanupManagedArtifacts();',
        'const cleanup = await cleanupManagedArtifacts();\n    await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);\n    throwIfAborted(signal);'
    ],
    ['quota failure ignored', 'if (!cleanup.quotaSatisfied) {', 'if (false) {']
];

test('promotion retention weakening mutations are rejected', async (t) => {
    for (const [label, before, after] of integrationMutations) {
        await t.test(label, () => {
            assert.throws(() => assertPromotionRetentionOrder(replaceRequired(OUTPUT_SOURCE, before, after)));
        });
    }
});
