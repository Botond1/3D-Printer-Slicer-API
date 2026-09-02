'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ZipArchive } = require('archiver');
const { DEFAULTS } = require('../../../app/config/constants');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const {
    SLA_PRINT_TIME_SOURCES,
    applySlaEstimateIfNeeded,
    parseOutputDetailed,
    validateSliceStats
} = require('../../../app/services/slice/model-stats');

async function makeSl1(target, config) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' });
        const archive = new ZipArchive({ zlib: { level: 9 } });
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
        archive.pipe(output);
        archive.append(config, { name: 'config.ini', store: true });
        archive.append(Buffer.from([1, 2, 3]), { name: '0.png', store: true });
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
        print_time_seconds: 120,
        print_time_readable: '0h 2m (Est.)',
        material_used_m: 0,
        material_used_g: null,
        print_time_source: SLA_PRINT_TIME_SOURCES.SYNTHETIC_ESTIMATE,
        material_used_g_source: null,
        material_used_ml: 4.25,
        object_height_mm: 30,
        estimated_price_huf: 0,
        ...overrides
    };
}

test('SLA responses publish material_used_g null and mark print time as an estimate', async (t) => {
    const root = await fixture(t);
    const synthetic = path.join(root, 'synthetic.sl1');
    await makeSl1(synthetic, 'usedMaterial=4.25\n');
    const stats = await parseOutputDetailed(synthetic, 'SLA', 0.05, 30, 'prusa');
    const expectedLayers = Math.ceil(30 / 0.05);
    assert.equal(stats.material_used_g, null);
    assert.equal(stats.material_used_g_source, null);
    assert.equal(stats.material_used_ml, 4.25);
    assert.equal(stats.print_time_seconds, DEFAULTS.SLA_BASE_TIME_SECONDS + expectedLayers * DEFAULTS.SLA_SECONDS_PER_LAYER);
    assert.equal(stats.print_time_source, 'sla_synthetic_estimate');
    assert.match(stats.print_time_readable, /\(Est\.\)$/);

    const metadata = path.join(root, 'metadata.sl1');
    await makeSl1(metadata, 'printTime=900\nusedMaterial=4.25\n');
    const fromMetadata = await parseOutputDetailed(metadata, 'SLA', 0.05, 30, 'prusa');
    assert.equal(fromMetadata.material_used_g, null);
    assert.equal(fromMetadata.print_time_seconds, 900);
    assert.equal(fromMetadata.print_time_source, 'sla_sl1_metadata_estimate');
    assert.match(fromMetadata.print_time_readable, /\(Est\.\)$/);
});

test('SLA validation refuses a published resin mass or an unmarked print time', () => {
    const policy = resolveResourcePolicy({});
    assert.equal(validateSliceStats(slaStats(), 'SLA', policy).material_used_g, null);
    assert.throws(() => validateSliceStats(slaStats({ material_used_g: 0 }), 'SLA', policy), /must not publish a resin mass/);
    assert.throws(() => validateSliceStats(slaStats({ material_used_g: 12.5 }), 'SLA', policy), /must not publish a resin mass/);
    assert.throws(() => validateSliceStats(slaStats({ print_time_source: null }), 'SLA', policy), /marked as an estimate/);
    assert.throws(() => validateSliceStats(slaStats({ print_time_source: 'gcode_time' }), 'SLA', policy), /marked as an estimate/);
});

test('the SLA estimate helper never touches FDM statistics', () => {
    const fdm = { print_time_seconds: 0, object_height_mm: 30, print_time_source: null };
    applySlaEstimateIfNeeded(fdm, 'FDM', 0.2);
    assert.deepEqual(fdm, { print_time_seconds: 0, object_height_mm: 30, print_time_source: null });

    const sla = { print_time_seconds: 0, object_height_mm: 10, print_time_source: null };
    applySlaEstimateIfNeeded(sla, 'SLA', 0.05);
    assert.equal(sla.print_time_seconds, DEFAULTS.SLA_BASE_TIME_SECONDS + 200 * DEFAULTS.SLA_SECONDS_PER_LAYER);
    assert.equal(sla.print_time_source, SLA_PRINT_TIME_SOURCES.SYNTHETIC_ESTIMATE);

    const fromMetadata = { print_time_seconds: 300, object_height_mm: 10, print_time_source: null };
    applySlaEstimateIfNeeded(fromMetadata, 'SLA', 0.05);
    assert.equal(fromMetadata.print_time_seconds, 300);
    assert.equal(fromMetadata.print_time_source, SLA_PRINT_TIME_SOURCES.SL1_METADATA_ESTIMATE);
});
