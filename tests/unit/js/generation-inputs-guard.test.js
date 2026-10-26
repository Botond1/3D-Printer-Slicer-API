'use strict';

/**
 * The Bambu `measurement_generation` hashes the files `bambu-generation.js`
 * lists in `processingFiles`. A release that must not move the generation
 * (3.8.1, 3.8.2, 3.8.3) may only touch files outside that list;
 * `scripts/check-generation-inputs.js <base>` proves it against Git. These
 * tests keep the script's reading of the list honest and pin that the 3.8.3
 * runtime files are not generation inputs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const { BUNDLE_AND_BUILD_INPUTS, parseGenerationRecipe } = require('../../../scripts/check-generation-inputs');
const { PROCESSING_SCHEMA } = require('../../../app/services/slice/bambu-generation');

const GENERATION_SOURCE = fs.readFileSync(path.join(ROOT, 'app/services/slice/bambu-generation.js'), 'utf8');

test('the guard reads the processingFiles list and schema exactly as bambu-generation.js declares them', () => {
    const recipe = parseGenerationRecipe(GENERATION_SOURCE);
    assert.equal(recipe.schema, PROCESSING_SCHEMA);
    assert.equal(recipe.files.length, 23);
    for (const name of ['orient.py', 'inspect_mesh.py', 'mesh2stl.py', 'services/slice/input-processing.js',
        'services/slice/pipeline.js', 'services/slice/gcode-metrics.js', 'services/slice/output-lifecycle.js',
        'services/slice/receipt-hash.js']) {
        assert.ok(recipe.files.includes(name), name);
    }
    for (const name of recipe.files) {
        assert.equal(fs.statSync(path.join(ROOT, 'app', name)).isFile(), true, name);
    }
});

test('the 3.8.3 runtime changes live outside every generation input', () => {
    const recipe = parseGenerationRecipe(GENERATION_SOURCE);
    const guarded = [...recipe.files.map((name) => `app/${name}`), ...BUNDLE_AND_BUILD_INPUTS];
    for (const changed of ['app/services/slice/command.js', 'app/services/slice/native-bounds.js', 'app/config/constants.js',
        'app/services/slice/helper-paths.js', 'app/services/slice/errors.js']) {
        assert.equal(guarded.some((entry) => changed === entry || changed.startsWith(`${entry}/`)), false, changed);
    }
    assert.ok(BUNDLE_AND_BUILD_INPUTS.includes('app/services/slice/bambu-generation.js'));
    assert.ok(BUNDLE_AND_BUILD_INPUTS.includes('configs/bambu'));
    assert.ok(BUNDLE_AND_BUILD_INPUTS.includes('Dockerfile'));
});

test('the guard refuses a recipe it cannot read instead of passing it', () => {
    assert.throws(() => parseGenerationRecipe('module.exports = {};'), /no longer declares/);
    assert.throws(() => parseGenerationRecipe("const PROCESSING_SCHEMA = 'x';\nconst processingFiles = [];"), /empty or holds a duplicate/);
    assert.throws(() => parseGenerationRecipe("const PROCESSING_SCHEMA = 'x';\nconst processingFiles = ['a.py', 'a.py'];"), /duplicate/);
});
