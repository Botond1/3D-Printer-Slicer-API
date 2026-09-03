'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ZipArchive } = require('archiver');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const {
    SLA_PRINT_TIME_SOURCE,
    parseOutputDetailed,
    validateSliceStats
} = require('../../../app/services/slice/model-stats');

async function makeSl1(target, config, pngCount = 1) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' });
        const archive = new ZipArchive({ zlib: { level: 9 } });
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
        archive.pipe(output);
        archive.append(config, { name: 'config.ini', store: true });
        for (let index = 0; index < pngCount; index++) {
            archive.append(Buffer.from([1, 2, 3]), { name: `${index}.png`, store: true });
        }
        archive.finalize();
    });
}

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sla-estimate-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

function slaStats(overrides = {}) {
    return {
        print_time_seconds: 4265,
        print_time_readable: '1h 11m (Est.)',
        material_used_m: 0,
        material_used_g: 4.68,
        print_time_source: SLA_PRINT_TIME_SOURCE,
        material_used_g_source: 'sla_resin_density_model',
        material_used_ml: 4.25,
        layer_count: 800,
        model_volume_ml: null,
        support_volume_ml: null,
        object_height_mm: 40,
        estimated_price_huf: 0,
        ...overrides
    };
}

test('SLA output derives a positive resin mass and the deterministic layer-time model', async (t) => {
    const root = await fixture(t);
    const sl1 = path.join(root, 'model.sl1');
    // 800 total layers at 0.05 mm: 5 x 36 + 8 x (16.25 + 2.5) + 787 x 5 = 4265 s
    // with the registry defaults (bottom 5, transition 8, exposure 2.5,
    // bottom exposure 30, motion 2.5/6.0).
    await makeSl1(sl1, 'usedMaterial=4.25\nlayerHeight=0.05\nnumFast=795\nnumSlow=5\nnumFade=8\n');
    const stats = await parseOutputDetailed(sl1, 'SLA', 0.05, 40, 'prusa', { material: 'Standard' });
    assert.equal(stats.material_used_ml, 4.25);
    assert.equal(stats.material_used_g, 4.68);
    assert.equal(stats.material_used_g_source, 'sla_resin_density_model');
    assert.equal(stats.layer_count, 800);
    assert.equal(stats.print_time_seconds, 4265);
    assert.equal(stats.print_time_source, SLA_PRINT_TIME_SOURCE);
    assert.equal(stats.model_volume_ml, null);
    assert.equal(stats.support_volume_ml, null);
    assert.match(stats.print_time_readable, /\(Est\.\)$/);
});

test('SLA resin density is resolved case-insensitively across the three registered materials', async (t) => {
    const root = await fixture(t);
    for (const [material, expectedDensity] of [['Standard', 1.1], ['abs-like', 1.1], ['FLEXIBLE', 1.05]]) {
        const sl1 = path.join(root, `${material.toLowerCase()}.sl1`);
        await makeSl1(sl1, 'usedMaterial=2\nlayerHeight=0.025\nnumFast=10\nnumSlow=2\n');
        const stats = await parseOutputDetailed(sl1, 'SLA', 0.025, 5, 'prusa', { material });
        assert.equal(stats.material_used_g, Math.round(2 * expectedDensity * 100) / 100, material);
    }
});

test('SLA output propagates a measured model volume into model/support volume', async (t) => {
    const root = await fixture(t);
    const sl1 = path.join(root, 'with-volume.sl1');
    await makeSl1(sl1, 'usedMaterial=28.91\nlayerHeight=0.05\nnumFast=990\nnumSlow=10\n');
    const stats = await parseOutputDetailed(sl1, 'SLA', 0.05, 44, 'prusa', {
        material: 'Standard',
        modelVolumeMm3: 24_320
    });
    assert.equal(stats.model_volume_ml, 24.32);
    assert.equal(stats.support_volume_ml, Math.round((28.91 - 24.32) * 100) / 100);
});

test('a synthetic .sl1 with 1200 PNG entries parses; 20001 entries is refused', async (t) => {
    const root = await fixture(t);
    const withinBudget = path.join(root, 'within-budget.sl1');
    await makeSl1(withinBudget, 'usedMaterial=1\nlayerHeight=0.05\nnumFast=1190\nnumSlow=10\n', 1200);
    const stats = await parseOutputDetailed(withinBudget, 'SLA', 0.05, 60, 'prusa', { material: 'Standard' });
    assert.equal(stats.layer_count, 1200);

    const overBudget = path.join(root, 'over-budget.sl1');
    await makeSl1(overBudget, 'usedMaterial=1\nlayerHeight=0.05\nnumFast=19990\nnumSlow=11\n', 20000);
    await assert.rejects(
        parseOutputDetailed(overBudget, 'SLA', 0.05, 60, 'prusa', { material: 'Standard' }),
        { code: 'SLICE_RESOURCE_LIMIT_EXCEEDED' }
    );
});

test('SLA validation requires a positive resin mass, a positive layer count, and the layer-time model source', () => {
    const policy = resolveResourcePolicy({});
    assert.deepEqual(validateSliceStats(slaStats(), 'SLA', policy), slaStats());
    assert.throws(() => validateSliceStats(slaStats({ material_used_g: 0 }), 'SLA', policy), /positive resin mass/);
    assert.throws(() => validateSliceStats(slaStats({ material_used_g: null }), 'SLA', policy), /positive resin mass/);
    assert.throws(() => validateSliceStats(slaStats({ material_used_ml: 0 }), 'SLA', policy), /required material usage/);
    assert.throws(() => validateSliceStats(slaStats({ layer_count: 0 }), 'SLA', policy), /positive layer count/);
    assert.throws(() => validateSliceStats(slaStats({ layer_count: null }), 'SLA', policy), /positive layer count/);
    assert.throws(() => validateSliceStats(slaStats({ print_time_source: null }), 'SLA', policy), /layer-time model/);
    assert.throws(
        () => validateSliceStats(slaStats({ print_time_source: 'sla_synthetic_estimate' }), 'SLA', policy),
        /layer-time model/
    );
    assert.throws(() => validateSliceStats(slaStats({ model_volume_ml: -1 }), 'SLA', policy), /model volume/);
    assert.throws(() => validateSliceStats(slaStats({ support_volume_ml: -1 }), 'SLA', policy), /support volume/);
    assert.doesNotThrow(
        () => validateSliceStats(slaStats({ model_volume_ml: 24.32, support_volume_ml: 4.59 }), 'SLA', policy)
    );
});
