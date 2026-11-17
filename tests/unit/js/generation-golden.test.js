'use strict';

/**
 * The goldens (§4.11; moved deliberately by 3.10.0): the 23-file processing digest recomputed from
 * the committed blobs (`git cat-file blob HEAD:app/<name>`, never the working
 * tree: CRLF checkouts) equals the golden, and the image gate's
 * comparisons refuse a moved digest, a moved Python package and one altered
 * catalogue row. A change to the digest needs a CHANGELOG line
 * "generation changes" and a new golden.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const { hashValue } = require('../../../app/services/slice/receipt-hash');
const { parseGenerationRecipe } = require('../../../scripts/check-generation-inputs');
const {
    catalogueView,
    compareCatalogue,
    compareFreeze,
    compareGenerationInputs,
    computeGenerationInputs,
    cubeStl,
    loadGoldens
} = require('../../golden/image-golden-gate');

const GOLDENS = loadGoldens();
/** 3.10.0 moved the generation deliberately; these are the five files it changed. */
const CHANGED_IN_3_10_0 = ['orient.py', 'inspect_mesh.py', 'services/slice/bambu-receipt.js',
    'services/slice/bambu-source.js', 'services/slice/pipeline.js'];
const GENERATION_3_10_0 = '363ba36daac0ecd8eb78d8c7f6c53c2a6d97c4d52cba0c4ca73503c3b5f1dda3';

function blobAtHead(repositoryPath) {
    const result = spawnSync('git', ['cat-file', 'blob', `HEAD:${repositoryPath}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, 0, String(result.stderr));
    return result.stdout;
}

test('the generation golden is the 23 processing files of the 3.10.0 release commit', () => {
    const golden = GOLDENS.generation;
    assert.equal(golden.captured_from.release, '3.10.0');
    assert.match(golden.captured_from.source_commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(golden.captured_from.changed_files, CHANGED_IN_3_10_0);
    assert.equal(golden.captured_from.measurement_generation, GENERATION_3_10_0);
    assert.equal(golden.processing_schema, 'r3d-bambu-processing-v1');
    assert.equal(golden.files.length, 23);
    assert.equal(golden.processing_sha256, hashValue(golden.files));
});

test('the committed processing files at HEAD hash to the 3.10.0 golden', () => {
    const recipe = parseGenerationRecipe(blobAtHead('app/services/slice/bambu-generation.js').toString('utf8'));
    const actual = { processing_schema: recipe.schema,
        ...computeGenerationInputs(recipe.files, (name) => blobAtHead(`app/${name}`), hashValue) };
    assert.deepEqual(compareGenerationInputs(actual, GOLDENS.generation), []);
});

test('a one-byte change in a processing file is refused by the digest comparison', () => {
    const names = GOLDENS.generation.files.map((file) => file.name);
    const actual = computeGenerationInputs(names, (name) => {
        const bytes = blobAtHead(`app/${name}`);
        return name === 'orient.py' ? Buffer.concat([Buffer.from('# planted\n'), bytes]) : bytes;
    }, hashValue);
    const reasons = compareGenerationInputs(actual, GOLDENS.generation);
    assert.ok(reasons.some((reason) => reason.startsWith('orient.py ')));
    assert.ok(reasons.some((reason) => reason.startsWith('processing_sha256')));
});

test('the Python geometry stack golden is the 3.8.3 freeze and requirements.txt pins each package at that version', () => {
    const golden = GOLDENS.freeze.trim().split(/\r?\n/);
    assert.deepEqual(golden.map((line) => line.split('==')[0]).sort(),
        ['gmsh', 'lxml', 'networkx', 'numpy', 'packaging', 'pillow', 'scipy', 'trimesh']);
    const requirements = fs.readFileSync(path.join(ROOT, 'requirements.txt'), 'utf8').trim().split(/\r?\n/);
    assert.deepEqual(requirements.map((line) => line.toLowerCase()).sort(), golden.map((line) => line.toLowerCase()).sort());
    for (const line of requirements) assert.match(line, /^[A-Za-z0-9_.-]+==[0-9][0-9A-Za-z.+-]*$/);
});

test('the freeze comparison ignores pip, setuptools and wheel and refuses a moved or extra package', () => {
    const image = `${GOLDENS.freeze}pip==26.2.2\nsetuptools==84.2.1\nwheel==0.48.0\n`;
    assert.deepEqual(compareFreeze(image, GOLDENS.freeze), []);
    assert.ok(compareFreeze(image.replace('numpy==2.5.2', 'numpy==2.5.3'), GOLDENS.freeze).length >= 2);
    assert.ok(compareFreeze(`${image}requests==2.0.0\n`, GOLDENS.freeze).some((reason) => reason.includes('requests')));
    assert.ok(compareFreeze(image.replace('packaging==26.3\n', ''), GOLDENS.freeze).some((reason) => reason.includes('packaging')));
});

function goldenAsViews() {
    const clone = structuredClone(GOLDENS.catalogue);
    return { v2: clone.v2, v3: clone.v3 };
}

test('the catalogue golden carries both 3.10.0 catalogue hashes and 96 rows each', () => {
    assert.equal(GOLDENS.catalogue.v2.catalogue_sha256, '3623aab2ff63d9959c09f882714d3eb6918c8df0545aadcc2d86f2f5d7af998b');
    assert.equal(GOLDENS.catalogue.v3.catalogue_sha256, '2dca687c09000c4ef3e0992b782dbea06642309e3b31eca39262c888d81aec75');
    assert.equal(GOLDENS.catalogue.v3.schema, 'r3d-profile-catalogue-v3');
    for (const key of ['v2', 'v3']) {
        assert.equal(GOLDENS.catalogue[key].rows.length, 96);
        assert.equal(GOLDENS.catalogue[key].row_count, 96);
        const bambu = GOLDENS.catalogue[key].rows.filter((row) => row.id.startsWith('bambu:'));
        assert.equal(bambu.length, 60);
        assert.equal(new Set(bambu.map((row) => row.measurement_generation)).size, 1);
        assert.equal(bambu[0].measurement_generation, GENERATION_3_10_0);
        assert.equal(GOLDENS.generation.captured_from.measurement_generation, hashValue({
            build_sha256: bambu[0].engine_build_sha256, bundle_sha256: bambu[0].profile_bundle_sha256,
            processing_schema: GOLDENS.generation.processing_schema, processing_sha256: GOLDENS.generation.processing_sha256 }));
    }
    assert.deepEqual(compareCatalogue(goldenAsViews(), GOLDENS.catalogue), []);
});

test('the catalogue image step fails when one row\'s effective_profile_sha256 is altered', () => {
    const views = goldenAsViews();
    views.v3.rows[17].effective_profile_sha256 = '0'.repeat(64);
    const reasons = compareCatalogue(views, GOLDENS.catalogue);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /effective_profile_sha256/);
});

test('the catalogue comparison refuses a moved catalogue hash, a lost or extra row and a key that appears', () => {
    let views = goldenAsViews();
    views.v2.catalogue_sha256 = 'f'.repeat(64);
    assert.ok(compareCatalogue(views, GOLDENS.catalogue).some((reason) => reason.includes('catalogue_sha256')));
    views = goldenAsViews();
    views.v2.rows.pop();
    assert.ok(compareCatalogue(views, GOLDENS.catalogue).some((reason) => reason.includes('missing')));
    views = goldenAsViews();
    const orca = views.v3.rows.find((row) => row.id.startsWith('orca:'));
    orca.measurement_generation = 'a'.repeat(64);
    assert.ok(compareCatalogue(views, GOLDENS.catalogue).some((reason) => reason.includes(orca.id)));
});

test('catalogueView reduces a body to its identity keys and keeps absent keys absent', () => {
    const body = JSON.stringify({ schema: 's', catalogue_sha256: 'c', profiles: [
        { id: 'bambu:x', measurement_generation: 'g', engine_version: 'v', engine_build_sha256: 'b', profile_bundle_sha256: 'p',
            effective_profile_sha256: 'e', material: 'PLA' },
        { id: 'orca:y', engine_version: 'o', effective_profile_sha256: 'e2' }] });
    const view = catalogueView('/profiles', 200, body);
    assert.deepEqual(view.rows[1], { id: 'orca:y', engine_version: 'o', effective_profile_sha256: 'e2' });
    assert.equal(view.rows[0].material, undefined);
    assert.match(view.body_sha256, /^[a-f0-9]{64}$/);
});

test('the export smoke cube is a 12-triangle binary STL of 40 mm', () => {
    const stl = cubeStl();
    assert.equal(stl.length, 84 + 12 * 50);
    assert.equal(stl.readUInt32LE(80), 12);
    let max = 0;
    for (let face = 0; face < 12; face += 1) {
        for (let value = 0; value < 9; value += 1) max = Math.max(max, stl.readFloatLE(84 + face * 50 + 12 + value * 4));
    }
    assert.equal(max, 40);
});
