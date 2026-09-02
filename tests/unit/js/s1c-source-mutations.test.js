'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'app/services/slice', name), 'utf8');
const count = (source, regex) => (source.match(regex) || []).length;

function validate(sources) {
    const { command, tree, environment, helpers, input, model, output, pipeline } = sources;
    assert.match(command, /if \(options\.signal\?\.aborted\) return Promise\.reject\(abortReason\(options\.signal\)\)/);
    assert.match(command, /if \(this\.terminationComplete\) this\.settle\(this\.reject/);
    assert.match(command, /terminatorFactory\(this\.child\)\.terminate\(\)/);
    assert.match(command, /signal\?\.removeEventListener\('abort', this\.onAbort\)/);
    assert.match(tree, /kill\(-pid, 'SIGTERM'|sendPosixSignal\(pid, 'SIGTERM'/);
    assert.match(tree, /sendPosixSignal\(pid, 'SIGKILL'/);
    assert.match(tree, /\['\/PID', String\(pid\), '\/T'\]/);
    assert.match(tree, /if \(force\) args\.push\('\/F'\)/);
    assert.match(tree, /path\.join\(systemRoot, 'System32', 'taskkill\.exe'\)/);
    assert.doesNotMatch(tree, /taskkill\s+\/IM|process-name/i);
    assert.doesNotMatch(environment, /\.\.\.process\.env|\.\.\.source/);
    for (const key of ['ADMIN_API_KEY', 'SECRET_MARKER', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN']) {
        assert.doesNotMatch(environment, new RegExp(key));
    }
    assert.match(environment, /PYTHONNOUSERSITE: '1'/);
    assert.match(helpers, /path\.resolve\(__dirname, '\.\.', '\.\.'\)/);
    for (const helper of ['mesh2stl.py', 'cad2stl.py', 'orient.py', 'scale_model.py', 'render_preview.py']) {
        assert.match(helpers, new RegExp(helper.replace('.', '\\.')));
    }
    assert.match(input, /catch \(error_\) \{\s*if \(isAbortError\(error_, signal\)\)/);
    assert.match(model, /catch \(err\) \{\s*if \(isAbortError\(err, signal\)\)/);
    assert.match(output, /throwIfAborted\(signal\);\s*await workspace\.promoteOutputCandidate[\s\S]{0,120}?throwIfAborted\(signal\)/);
    assert.match(pipeline, /async function processSlice[\s\S]{0,300}?throwIfAborted\(options\.signal\)/);
    assert.match(pipeline, /try \{\s*throwIfAborted\(options\.signal\);\s*const resolved/);
    assert.match(pipeline, /if \(isAbortError\(err, options\.signal\)\)/);
    assert.ok(count(pipeline, /throwIfAborted\(/g) >= 12);
}

test('S1c source mutations are rejected for lifecycle, environment, helper, fallback, and promotion guards', async (t) => {
    const sources = {
        command: read('command.js'), tree: read('process-tree.js'),
        environment: read('child-environment.js'), helpers: read('helper-paths.js'),
        input: read('input-processing.js'), model: read('model-stats.js'),
        output: read('output-lifecycle.js'), pipeline: read('pipeline.js')
    };
    validate(sources);
    const mutations = [
        ['pre-abort spawn reopened', 'command', 'if (options.signal?.aborted) return Promise.reject', 'if (false) return Promise.reject'],
        ['settlement no longer waits for tree', 'command', 'if (this.terminationComplete) this.settle', 'if (true) this.settle'],
        // Both forced passes (first SIGKILL and the single retry) must be removed to
        // prove the guard; a global pattern keeps the seam honest after the retry landed.
        ['forced POSIX escalation removed', 'tree', /sendPosixSignal\(pid, 'SIGKILL'/g, "sendPosixSignal(pid, 'SIGTERM'"],
        ['Windows force flag removed', 'tree', "if (force) args.push('/F')", "if (force) args.push('/T')"],
        ['parent environment spread restored', 'environment', 'return { ...environment, ...SAFE_PYTHON_ENV }', 'return { ...source, ...SAFE_PYTHON_ENV }'],
        ['module helper anchor replaced by cwd', 'helpers', "path.resolve(__dirname, '..', '..')", 'path.resolve(process.cwd())'],
        ['orientation abort fallback swallowed', 'input', 'if (isAbortError(error_, signal))', 'if (false && isAbortError(error_, signal))'],
        ['model-info abort fallback swallowed', 'model', 'if (isAbortError(err, signal))', 'if (false && isAbortError(err, signal))'],
        ['post-promotion abort guard removed', 'output', /await workspace\.promoteOutputCandidate\(outputCandidate, effectiveOutputPath\);\r?\n    throwIfAborted\(signal\);/, 'await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);'],
        ['process entry abort guard removed', 'pipeline', '        throwIfAborted(options.signal);', '        // guard removed']
    ];
    for (const [name, key, from, to] of mutations) {
        await t.test(name, () => {
            const seamExists = from instanceof RegExp ? from.test(sources[key]) : sources[key].includes(from);
            assert.ok(seamExists, `missing mutation seam: ${name}`);
            const mutated = { ...sources, [key]: sources[key].replace(from, to) };
            assert.throws(() => validate(mutated), assert.AssertionError);
        });
    }
});
