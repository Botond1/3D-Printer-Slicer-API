'use strict';

/**
 * The 3.9.0 generation gate (§4.11): `bambu-generation.js` passes only with
 * allowed hunks (the `assertBambuBuildCurrent` body and one marked block
 * after `module.exports`), every processing file, bundle input and the
 * measurement configuration stay blob-identical. The cases run the real
 * `runCheck` over an in-memory reader that answers like Git, so no Git object
 * is ever written.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '../../..');
const {
    ALLOWED_EDIT_LABEL,
    MONITOR_BLOCK_BEGIN,
    MONITOR_BLOCK_END,
    LEGACY_LOOP_EXPRESSION,
    checkGenerationModule,
    normalizeAllowedEdit,
    parseGenerationRecipe,
    runCheck
} = require('../../../scripts/check-generation-inputs');

const BASE_GENERATION = fs.readFileSync(
    path.join(ROOT, 'tests/unit/fixtures/generation-inputs/bambu-generation-3.8.3.js.txt'), 'utf8').replace(/\r\n/g, '\n');
const RECIPE = parseGenerationRecipe(BASE_GENERATION);

function gitBlobId(text) {
    const bytes = Buffer.from(text, 'utf8');
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** A tree shaped like the repository at 3.8.3, with stand-in bytes for every guarded file. */
function baseTree() {
    const tree = { 'app/services/slice/bambu-generation.js': BASE_GENERATION };
    for (const name of RECIPE.files) tree[`app/${name}`] = `// stand-in for ${name}\n`;
    tree['app/services/slice/bambu-printer-registry.js'] = 'module.exports = {};\n';
    tree['app/services/slice/profile-readers.js'] = 'module.exports = {};\n';
    tree['app/config/paths.js'] = 'module.exports = {};\n';
    tree['configs/bambu/registry.json'] = '{}\n';
    tree.Dockerfile = 'FROM scratch\n';
    tree['app/config/constants.js'] = "const BAMBU_DEFAULT_PROFILES_ROOT = '/opt/bambustudio/resources/profiles';\nmodule.exports = { PORT: 3000 };\n";
    tree['app/config/resource-policy.js'] = 'module.exports = { RESOURCE_DEFINITIONS: {} };\n';
    tree['README.md'] = 'readme\n';
    return tree;
}

function memoryReader(revisions) {
    const at = (revision) => {
        const tree = revisions[revision === null ? 'WORKTREE' : revision];
        if (!tree) throw new Error(`unknown revision ${revision}`);
        return tree;
    };
    const under = (tree, entries) => Object.keys(tree).filter((file) => entries.some((entry) => entry === '.'
        || file === entry || file.startsWith(`${entry}/`)));
    return {
        verify: (revision) => { at(revision); },
        read: (revision, file) => {
            const text = at(revision)[file];
            if (text === undefined) throw new Error(`missing ${file}`);
            return text;
        },
        blob: (revision, file) => (at(revision)[file] === undefined ? null : gitBlobId(at(revision)[file])),
        sha256: (revision, file) => createHash('sha256').update(at(revision)[file]).digest('hex'),
        changedPaths: (base, revision, entries) => {
            const before = at(base);
            const after = at(revision);
            const files = new Set([...under(before, entries), ...under(after, entries)]);
            return [...files].filter((file) => before[file] !== after[file]).sort();
        }
    };
}

function check(mutate) {
    const base = baseTree();
    const current = { ...base };
    mutate(current);
    const out = [];
    const err = [];
    const status = runCheck({
        base: 'BASE', ref: 'HEAD', reader: memoryReader({ BASE: base, HEAD: current }),
        log: (line) => out.push(line), error: (line) => err.push(line)
    });
    return { status, out: out.join('\n'), err: err.join('\n') };
}

function withGeneration(transform) {
    return (tree) => { tree['app/services/slice/bambu-generation.js'] = transform(tree['app/services/slice/bambu-generation.js']); };
}

const NEW_ASSERT = [
    'function assertBambuBuildCurrent() {',
    '    if (nativeIdentityMonitorEnabled()) return assertMonitoredBuildCurrent();',
    `    if (!generation || ${LEGACY_LOOP_EXPRESSION}) {`,
    "        throw new Error('Bambu runtime build changed after startup.');",
    '    }',
    '}'
].join('\n');
const OLD_ASSERT = /function assertBambuBuildCurrent\(\) \{\n[\s\S]*?\n\}\n/.exec(BASE_GENERATION)[0].slice(0, -1);
const MONITOR_BLOCK = [
    MONITOR_BLOCK_BEGIN,
    'function nativeIdentityMonitorEnabled() { return process.env.NATIVE_IDENTITY_MONITOR !== \'off\'; }',
    'function assertMonitoredBuildCurrent() { return undefined; }',
    'function startNativeIdentityMonitor() { return nativeIdentity.map(({ file }) => file); }',
    'module.exports.startNativeIdentityMonitor = startNativeIdentityMonitor;',
    MONITOR_BLOCK_END,
    ''
].join('\n');

function allowedEdit(source) {
    return `${source.replace(OLD_ASSERT, NEW_ASSERT).replace(/\n$/, '')}\n${MONITOR_BLOCK}`;
}

test('an unchanged tree passes and names nothing as changed', () => {
    const result = check(() => {});
    assert.equal(result.status, 0, result.err);
    assert.match(result.out, /bambu-generation\.js: unchanged/);
    assert.doesNotMatch(result.out, /CHANGED/);
});

test('a new assertBambuBuildCurrent body plus the block after exports passes with the one allowed line', () => {
    const result = check(withGeneration(allowedEdit));
    assert.equal(result.status, 0, result.err);
    assert.ok(result.out.split('\n').includes(ALLOWED_EDIT_LABEL));
    assert.equal(result.out.split('\n').filter((line) => line.includes('CHANGED')).length, 1);
});

test('the allowed edit is recognised by the pure module check too', () => {
    assert.equal(checkGenerationModule(BASE_GENERATION, allowedEdit(BASE_GENERATION)).status, 'allowed');
    assert.equal(checkGenerationModule(BASE_GENERATION, BASE_GENERATION.replace(/\n/g, '\r\n')).status, 'unchanged');
});

test('a comment inside initializeBambuGeneration fails', () => {
    const result = check(withGeneration((source) => source.replace(
        'function initializeBambuGeneration(version, options = {}) {\n',
        'function initializeBambuGeneration(version, options = {}) {\n    // harmless?\n')));
    assert.equal(result.status, 1);
    assert.match(result.err, /changed outside the assertBambuBuildCurrent body/);
});

test('an edit inside getBambuGeneration fails', () => {
    const result = check(withGeneration((source) => allowedEdit(source).replace(
        "throw new Error('Bambu runtime identity is unavailable.')", "throw new Error('Bambu identity unavailable.')")));
    assert.equal(result.status, 1);
    assert.match(result.err, /changed outside/);
});

test('an edit inside catalogueGenerationFields fails', () => {
    const result = check(withGeneration((source) => source.replace(
        'profile_bundle_sha256: current.bundle_sha256 }', 'profile_bundle_sha256: current.bundle_sha256, extra: 1 }')));
    assert.equal(result.status, 1);
    assert.match(result.err, /changed outside/);
});

test('a changed require binding fails', () => {
    const result = check(withGeneration((source) => source.replace(
        "const { hashValue } = require('./receipt-hash');", "const { hashValue } = require('./receipt-hash.js');")));
    assert.equal(result.status, 1);
});

test('module.exports.getBambuGeneration = … in the block fails', () => {
    const result = check(withGeneration((source) => allowedEdit(source).replace(
        'module.exports.startNativeIdentityMonitor = startNativeIdentityMonitor;',
        'module.exports.getBambuGeneration = () => null;')));
    assert.equal(result.status, 1);
    assert.match(result.err, /replaces the existing export getBambuGeneration/);
});

test('assigning module.exports, generation, nativeIdentity or a frozen function in the block fails', () => {
    for (const line of ['module.exports = {};', 'generation = null;', 'nativeIdentity = [];', 'nativeIdentity.length = 0;',
        'nativeIdentity[0].sha256 = "x";', 'nativeIdentity.push({});', 'hashNativeFile = () => "x";',
        'function hashNativeFile() { return "x"; }', 'fs.readFileSync = () => Buffer.alloc(0);',
        'Object.assign(module.exports, {});', 'eval("generation = null");']) {
        const result = check(withGeneration((source) => allowedEdit(source).replace(
            'function assertMonitoredBuildCurrent() { return undefined; }', line)));
        assert.equal(result.status, 1, line);
    }
});

test('the block placed before module.exports fails', () => {
    const result = check(withGeneration((source) => {
        const edited = source.replace(OLD_ASSERT, NEW_ASSERT);
        return edited.replace(/^module\.exports = /m, `${MONITOR_BLOCK}module.exports = `);
    }));
    assert.equal(result.status, 1);
    assert.match(result.err, /monitor block must start on the line right after module\.exports/);
});

test('a second block, a stray marker or content after the block fails', () => {
    assert.equal(check(withGeneration((source) => `${allowedEdit(source)}${MONITOR_BLOCK}`)).status, 1);
    assert.equal(check(withGeneration((source) => `${allowedEdit(source)}const late = 1;\n`)).status, 1);
    assert.equal(check(withGeneration((source) => source.replace('\'use strict\';', `'use strict';\n${MONITOR_BLOCK_END}`))).status, 1);
});

test('a new body that drops the 3.8.3 loop expression or assigns generation fails', () => {
    const dropped = check(withGeneration((source) => allowedEdit(source).replace(LEGACY_LOOP_EXPRESSION, 'false')));
    assert.equal(dropped.status, 1);
    assert.match(dropped.err, /keep the 3\.8\.3 loop expression/);
    const assigns = check(withGeneration((source) => allowedEdit(source).replace(
        '    if (nativeIdentityMonitorEnabled())', '    generation = null;\n    if (nativeIdentityMonitorEnabled())')));
    assert.equal(assigns.status, 1);
    assert.match(assigns.err, /assigns the frozen binding generation/);
});

test('a planted comment in orient.py fails', () => {
    const result = check((tree) => { tree['app/orient.py'] = `# planted\n${tree['app/orient.py']}`; });
    assert.equal(result.status, 1);
    assert.match(result.err, /app\/orient\.py/);
});

test('any constants.js or resource-policy.js edit fails, the profiles-root line included', () => {
    for (const file of ['app/config/constants.js', 'app/config/resource-policy.js']) {
        const result = check((tree) => { tree[file] = `${tree[file]}// one comment byte\n`; });
        assert.equal(result.status, 1, file);
        assert.match(result.err, new RegExp(`${file.replace(/[.]/g, '\\.')} changed`));
    }
});

test('the Dockerfile and configs/bambu stay blob-identical; files outside the inputs are only listed', () => {
    assert.equal(check((tree) => { tree.Dockerfile = 'FROM scratch\n# x\n'; }).status, 1);
    assert.equal(check((tree) => { tree['configs/bambu/registry.json'] = '{"x":1}\n'; }).status, 1);
    const other = check((tree) => { tree['README.md'] = 'changed\n'; });
    assert.equal(other.status, 0, other.err);
    assert.match(other.out, /outside the generation inputs \(1\): README\.md/);
});

test('normalizeAllowedEdit freezes everything except the two hunks', () => {
    const before = normalizeAllowedEdit(BASE_GENERATION);
    const after = normalizeAllowedEdit(allowedEdit(BASE_GENERATION));
    assert.equal(before.normalized, after.normalized);
    assert.equal(before.block, '');
    assert.match(after.block, /startNativeIdentityMonitor/);
    assert.ok(before.body.includes(LEGACY_LOOP_EXPRESSION));
    assert.deepEqual(before.exportNames, ['PROCESSING_SCHEMA', 'initializeBambuGeneration', 'getBambuGeneration',
        'catalogueGenerationFields', 'assertBambuBuildCurrent']);
});

test('the 3.8.3 fixture copy of bambu-generation.js is the dbc539e blob when the history is present', (t) => {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('git', ['cat-file', 'blob', 'dbc539e:app/services/slice/bambu-generation.js'], { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) {
        t.skip('dbc539e is not in this clone');
        return;
    }
    assert.equal(result.stdout, BASE_GENERATION);
});
