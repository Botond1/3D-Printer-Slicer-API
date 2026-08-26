'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    isStrictGcodeMetricsEnabled,
    parseOutputDetailed
} = require('../../../app/services/slice/model-stats');

test('strict G-code metrics default true and only explicit false disables them', () => {
    assert.equal(isStrictGcodeMetricsEnabled({}), true);
    assert.equal(isStrictGcodeMetricsEnabled({ SLICE_STRICT_GCODE_METRICS: '' }), true);
    assert.equal(isStrictGcodeMetricsEnabled({ SLICE_STRICT_GCODE_METRICS: 'true' }), true);
    assert.equal(isStrictGcodeMetricsEnabled({ SLICE_STRICT_GCODE_METRICS: '0' }), true);
    assert.equal(isStrictGcodeMetricsEnabled({ SLICE_STRICT_GCODE_METRICS: ' false ' }), false);
});

test('bounded output parsing publishes direct length and gram markers side by side', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j1-model-stats-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = path.join(root, 'result.gcode');
    await fs.writeFile(output, [
        'M73 P0 R2',
        '; filament used [mm] = 1000',
        '; filament used [g] = 3.01',
        'G1 X1 E1',
        ''
    ].join('\n'));
    const previous = process.env.SLICE_STRICT_GCODE_METRICS;
    delete process.env.SLICE_STRICT_GCODE_METRICS;
    t.after(() => {
        if (previous === undefined) delete process.env.SLICE_STRICT_GCODE_METRICS;
        else process.env.SLICE_STRICT_GCODE_METRICS = previous;
    });

    const stats = await parseOutputDetailed(output, 'FDM', 0.2, 10, 'orca');
    assert.equal(stats.print_time_seconds, 120);
    assert.equal(stats.material_used_m, 1);
    assert.equal(stats.material_used_g, 3.01);
    assert.equal(stats.print_time_source, 'm73_p0_r_minutes');
    assert.equal(stats.material_used_g_source, 'filament_used_g');
});

test('Prusa output without a native mass marker remains successful but explicitly manual', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j1-prusa-direct-mass-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = path.join(root, 'result.gcode');
    await fs.writeFile(output, [
        '; estimated printing time (normal mode) = 2m',
        '; filament used [mm] = 1137.04',
        'G1 X1 E1',
        ''
    ].join('\n'));

    const stats = await parseOutputDetailed(output, 'FDM', 0.2, 10, 'prusa');
    assert.equal(stats.print_time_seconds, 120);
    assert.equal(stats.material_used_m, 1.13704);
    assert.equal(stats.material_used_g, null);
    assert.equal(stats.material_used_g_source, null);
});

test('Orca filament qualification still rejects a missing direct mass marker', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j1-orca-direct-mass-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = path.join(root, 'result.gcode');
    await fs.writeFile(output, [
        'M73 P0 R2',
        '; filament used [mm] = 1000',
        ''
    ].join('\n'));

    await assert.rejects(
        parseOutputDetailed(output, 'FDM', 0.2, 10, 'orca'),
        (error) => error?.errorCode === 'SLICE_OUTPUT_UNPARSED' &&
            error?.code === 'GCODE_FILAMENT_UNPARSED'
    );
    const manual = await parseOutputDetailed(
        output,
        'FDM',
        0.2,
        10,
        'orca',
        { requireFilamentGrams: false }
    );
    assert.equal(manual.material_used_g, null);
});

test('default strict integration rejects drift instead of accepting silent zeros', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j1-model-stats-drift-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = path.join(root, 'result.gcode');
    await fs.writeFile(output, [
        '; estimated duration = 2m',
        '; filament used [gram] = 3.01',
        '; filament used [mm] = 1000',
        ''
    ].join('\n'));
    const previous = process.env.SLICE_STRICT_GCODE_METRICS;
    delete process.env.SLICE_STRICT_GCODE_METRICS;
    t.after(() => {
        if (previous === undefined) delete process.env.SLICE_STRICT_GCODE_METRICS;
        else process.env.SLICE_STRICT_GCODE_METRICS = previous;
    });

    await assert.rejects(
        parseOutputDetailed(output, 'FDM', 0.2, 10, 'orca'),
        (error) => error?.errorCode === 'SLICE_OUTPUT_UNPARSED' && error?.code === 'GCODE_TIME_UNPARSED'
    );
});
