'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const {
    RESOURCE_DEFINITIONS,
    resolveResourcePolicy
} = require('../../../app/config/resource-policy');
const { assertDeclaredEntryPolicy } = require('../../../app/services/slice/zip-policy');
const { validateActualBytes } = require('../../../app/services/slice/zip-stream');
const { validateSliceStats } = require('../../../app/services/slice/model-stats');
const { PricingRepository } = require('../../../app/services/pricing/repository');
const { PricingCatalog } = require('../../../app/services/pricing/catalog');
const { createPricingMutationCoordinator } = require('../../../app/services/pricing.service');
const { parseConfig } = require('../../../app/services/slice/sl1-stats');
const {
    assertBoundedModelFile
} = require('../../../app/services/slice/pipeline');
const { runUploadWithinDeadline } = require('../../../app/routes/slice.routes');
const {
    createPartialArtifactMetadata,
    finalizeArtifactMetadata,
    cleanupManagedArtifacts
} = require('../../../app/services/artifact-store');
const { acquireArtifactLease } = require('../../../app/services/artifact-leases');

const DEFAULT_PRICING = { FDM: { PLA: 800 }, SLA: { Standard: 1800 } };

test('central resource policy accepts inclusive bounds and rejects every malformed integer form', () => {
    for (const [name, definition] of Object.entries(RESOURCE_DEFINITIONS)) {
        assert.equal(resolveResourcePolicy({ [name]: String(definition.min) })[name], definition.min);
        assert.equal(resolveResourcePolicy({ [name]: String(definition.max) })[name], definition.max);
        for (const invalid of ['', '0', '-1', '1.0', '1e3', '+1', '01', '9007199254740992']) {
            assert.throws(() => resolveResourcePolicy({ [name]: invalid }), new RegExp(name));
        }
        if (definition.min > 1) {
            assert.throws(() => resolveResourcePolicy({ [name]: String(definition.min - 1) }), new RegExp(name));
        }
        assert.throws(() => resolveResourcePolicy({ [name]: String(definition.max + 1) }), new RegExp(name));
    }
    assert.equal(resolveResourcePolicy({}).MAX_UPLOAD_BYTES, 500 * 1024 * 1024);
});

test('synthetic archive characterization separates legal models from a repeated-byte bomb', () => {
    const policy = resolveResourcePolicy({});
    const facet = 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 1 1 0\nendloop\nendfacet\n';
    const generated = {
        asciiCubeStl: Buffer.from(`solid cube\n${facet.repeat(12)}endsolid cube\n`),
        cubeObj: Buffer.from('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n'),
        validStatsGcode: Buffer.from('; estimated printing time = 1m\n; filament used [mm] = 10\nG1 X1 E1\n'),
        repeatedByteBomb: Buffer.alloc(1024 * 1024, 0x41)
    };
    const samples = Object.fromEntries(Object.entries(generated).map(([name, buffer]) => [
        name,
        buffer.length / zlib.deflateRawSync(buffer, { level: 9 }).length
    ]));
    assert.ok(samples.asciiCubeStl < policy.MAX_ZIP_COMPRESSION_RATIO);
    assert.ok(samples.cubeObj < policy.MAX_ZIP_COMPRESSION_RATIO);
    assert.ok(samples.validStatsGcode < policy.MAX_ZIP_COMPRESSION_RATIO);
    assert.ok(samples.repeatedByteBomb > policy.MAX_ZIP_COMPRESSION_RATIO);
    assert.doesNotThrow(() => assertDeclaredEntryPolicy({
        fileName: 'cube.stl',
        uncompressedSize: generated.asciiCubeStl.length,
        compressedSize: zlib.deflateRawSync(generated.asciiCubeStl, { level: 9 }).length,
        externalFileAttributes: 0
    }, policy));
    assert.throws(() => assertDeclaredEntryPolicy({
        fileName: 'nested/cube.stl',
        uncompressedSize: 1153,
        compressedSize: 140,
        externalFileAttributes: 0
    }, policy), /nesting/);
    assert.throws(() => validateActualBytes(generated.repeatedByteBomb.length, {
        declaredBytes: generated.repeatedByteBomb.length,
        compressedBytes: zlib.deflateRawSync(generated.repeatedByteBomb, { level: 9 }).length
    }, policy), { code: 'SLICE_RESOURCE_LIMIT_EXCEEDED' });
});

test('technology-specific stats reject NaN, Infinity, negative, zero-required and unreasonable values', () => {
    const policy = resolveResourcePolicy({});
    const validFdm = {
        print_time_seconds: 60,
        print_time_readable: '0h 1m',
        material_used_m: 0.01,
        material_used_g: 0.03,
        material_used_ml: 0,
        object_height_mm: 20,
        estimated_price_huf: 0
    };
    assert.deepEqual(validateSliceStats({ ...validFdm }, 'FDM', policy), validFdm);
    for (const invalid of [NaN, Infinity, -1, 0, policy.MAX_PRINT_TIME_SECONDS + 1]) {
        assert.throws(() => validateSliceStats({ ...validFdm, print_time_seconds: invalid }, 'FDM', policy), {
            code: 'INVALID_SLICE_STATS'
        });
    }
    assert.throws(() => validateSliceStats({ ...validFdm, material_used_m: 0 }, 'FDM', policy));
    assert.throws(() => validateSliceStats({ ...validFdm, material_used_g: 0 }, 'FDM', policy));
    assert.doesNotThrow(() => validateSliceStats({ ...validFdm, material_used_g: null }, 'FDM', policy));
    assert.throws(() => validateSliceStats({ ...validFdm, material_used_g: NaN }, 'FDM', policy));
    assert.throws(() => validateSliceStats({
        ...validFdm, material_used_g: policy.MAX_MATERIAL_USED_GRAMS + 1
    }, 'FDM', policy));
    assert.doesNotThrow(() => validateSliceStats({
        ...validFdm, material_used_m: 0, material_used_g: 0, material_used_ml: 1
    }, 'SLA', policy));
    assert.throws(() => validateSliceStats({
        ...validFdm, material_used_m: 0, material_used_g: 0, material_used_ml: 0
    }, 'SLA', policy));
});

test('SLA config requires positive finite usedMaterial and accepts bounded printTime', () => {
    assert.deepEqual(parseConfig('printTime = 120\nusedMaterial = 4.25\n'), {
        print_time_seconds: 120,
        material_used_ml: 4.25
    });
    for (const value of ['0', '-1', 'NaN', 'Infinity']) {
        assert.throws(() => parseConfig(`printTime=120\nusedMaterial=${value}\n`), {
            code: 'INVALID_SLICE_STATS'
        });
    }
});

test('model/intermediate byte validation rejects empty, oversized and non-regular outputs', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bounded-model-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const workspace = {
        assertContainedPath(candidate) {
            const resolved = path.resolve(candidate);
            assert.equal(path.dirname(resolved), path.resolve(root));
            return resolved;
        }
    };
    const model = path.join(root, 'model.stl');
    await fsp.writeFile(model, 'solid cube');
    assert.equal(await assertBoundedModelFile(model, workspace, {
        ...resolveResourcePolicy({}), MAX_MODEL_FILE_BYTES: 10
    }), model);
    await fsp.writeFile(model, '01234567890');
    await assert.rejects(assertBoundedModelFile(model, workspace, {
        ...resolveResourcePolicy({}), MAX_MODEL_FILE_BYTES: 10
    }), { code: 'SLICE_RESOURCE_LIMIT_EXCEEDED' });
});

test('upload deadline aborts active storage and awaits middleware settlement', async () => {
    let middlewareSettled = false;
    let callback;
    const req = {
        destroy(error) {
            middlewareSettled = true;
            callback(error);
        }
    };
    const middleware = (request, response, next) => { callback = next; };
    await assert.rejects(runUploadWithinDeadline(middleware, req, {}, 1, {
        setTimeout(handler) { queueMicrotask(handler); return 1; },
        clearTimeout() {}
    }), { code: 'UPLOAD_TOTAL_TIMEOUT' });
    assert.equal(middlewareSettled, true);
});

test('atomic pricing repository writes restrictive same-directory temp and cleans every rename failure', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pricing-atomic-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const state = path.join(root, 'pricing-state');
    const primary = path.join(state, 'pricing.json');
    const repository = new PricingRepository({
        primaryFile: primary,
        pricingStateRoot: state,
        legacyFile: path.join(root, 'pricing.json'),
        defaultPricing: DEFAULT_PRICING,
        resourcePolicy: resolveResourcePolicy({}),
        randomBytes: () => Buffer.from('11'.repeat(16), 'hex')
    });
    repository.saveToPrimary(DEFAULT_PRICING);
    assert.deepEqual(JSON.parse(await fsp.readFile(primary, 'utf8')), DEFAULT_PRICING);
    if (process.platform !== 'win32') assert.equal((await fsp.stat(primary)).mode & 0o777, 0o600);

    const failingFs = { ...fs, renameSync() { const error = new Error('rename failed'); error.code = 'EIO'; throw error; } };
    const failing = new PricingRepository({
        primaryFile: primary,
        pricingStateRoot: state,
        legacyFile: path.join(root, 'pricing.json'),
        defaultPricing: DEFAULT_PRICING,
        fs: failingFs,
        resourcePolicy: resolveResourcePolicy({}),
        randomBytes: () => Buffer.from('22'.repeat(16), 'hex')
    });
    assert.throws(() => failing.saveToPrimary({ FDM: { PLA: 900 }, SLA: { Standard: 1800 } }), /rename failed/);
    assert.deepEqual(await fsp.readdir(state), ['pricing.json']);
});

test('pricing coordinator persists candidate before memory commit and serializes mutations', async () => {
    const catalog = new PricingCatalog(DEFAULT_PRICING);
    const persisted = [];
    const repository = {
        saveToPrimary(candidate) {
            persisted.push(structuredClone(candidate));
            if (candidate.FDM.FAIL) throw new Error('synthetic persistence failure');
        }
    };
    const commit = createPricingMutationCoordinator(repository, catalog);
    await assert.rejects(commit((candidate) => { candidate.FDM.FAIL = 1; }));
    assert.deepEqual(catalog.getPricing(), DEFAULT_PRICING);
    const first = commit((candidate) => { candidate.FDM.PLA = 900; return 'first'; });
    const second = commit((candidate) => { candidate.FDM.PLA = 1000; return 'second'; });
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
    assert.equal(catalog.getPricing().FDM.PLA, 1000);
    assert.equal(persisted.at(-2).FDM.PLA, 900);
    assert.equal(persisted.at(-1).FDM.PLA, 1000);
});

test('managed artifact cleanup is TTL-bounded, idempotent, and preserves active downloads', async (t) => {
    const outputRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'artifact-retention-'));
    t.after(() => fsp.rm(outputRoot, { recursive: true, force: true }));
    const artifactId = 'artifact-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const fileName = `cube-output-${artifactId}.gcode`;
    const artifactPath = path.join(outputRoot, fileName);
    await fsp.writeFile(artifactPath, '');
    await createPartialArtifactMetadata({
        outputRoot, artifactId,
        jobId: 'job-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        fileName, createdAt: 1
    });
    await fsp.writeFile(artifactPath, 'G1 X1\n', { flag: 'a' });
    await finalizeArtifactMetadata({
        outputRoot, artifactId,
        jobId: 'job-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        fileName, tempToken: 'cccccccccccccccc'
    });
    const policy = { ...resolveResourcePolicy({}), ARTIFACT_TTL_MS: 60_000 };
    const lease = acquireArtifactLease([artifactPath]);
    const active = await cleanupManagedArtifacts({ outputRoot, resourcePolicy: policy, clock: () => 120_000 });
    assert.equal(active.active, 1);
    await fsp.access(artifactPath);
    lease.release();
    const removed = await cleanupManagedArtifacts({ outputRoot, resourcePolicy: policy, clock: () => 120_000 });
    assert.equal(removed.removedArtifacts, 1);
    assert.equal(removed.quotaSatisfied, true);
    const again = await cleanupManagedArtifacts({ outputRoot, resourcePolicy: policy, clock: () => 120_000 });
    assert.equal(again.removed, 0);
});
