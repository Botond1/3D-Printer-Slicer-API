'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PYTHON_EXECUTABLE ||= process.execPath;
const { validateAppliedConfig, validateNativeScope, parseConfig, collectWarnings } = require('../../../app/services/slice/bambu-receipt');
const { verifyBambuArtifact } = require('../../../app/services/slice/bambu-artifact');
const { hashValue } = require('../../../app/services/slice/receipt-hash');
const { parseGcodeMetricsStrict } = require('../../../app/services/slice/gcode-metrics');
const fixture = path.resolve(__dirname, '../fixtures/bambu-native-receipt');
const gcode = fs.readFileSync(path.join(fixture, 'plate_1.gcode'), 'utf8');
const result = JSON.parse(fs.readFileSync(path.join(fixture, 'result.json')));
const context = { layerHeight: .2, infillPercentage: '20%', supports: true, material: 'PLA', profileOverrides: { bambuPrinter: 'P1S' } };
const metrics = parseGcodeMetricsStrict(gcode, { engine: 'bambu', requireFilamentGrams: true });
const stats = { print_time_seconds: metrics.print_time_seconds, print_time_source: metrics.print_time_source,
    material_used_g: metrics.filament_used_g, material_used_g_source: metrics.filament_used_g_source };

test('native fixture config and independent result.json agree at documented source precision', () => {
    const applied = validateAppliedConfig(gcode, context, '02.08.02.61').applied;
    assert.deepEqual([applied.layer_height_mm, applied.infill_percent, applied.supports, applied.material], [.2, 20, true, 'PLA']);
    assert.equal(validateNativeScope(result, gcode, stats).id, 1);
    assert.equal(stats.print_time_seconds, 829);
    assert.equal(stats.material_used_g, 1.78);
});

for (const material of ['PLA', 'pla', 'PlA', ' PLA ']) {
    test(`accepted material spelling ${JSON.stringify(material)} matches the native receipt`, () => {
        const { parseSliceOptions } = require('../../../app/services/slice/options');
        const parsed = parseSliceOptions({ layerHeight: '0.2', material, infill: '20%', supports: 'true' }, 'FDM', 'bambu');
        assert.equal(parsed.isValid, true);
        const applied = validateAppliedConfig(gcode, parsed.options, '02.08.02.61').applied;
        assert.equal(applied.material, 'PLA');
    });
}

for (const material of ['petg', ' ABS ', 'tpu']) {
    test(`accepted foreign material ${JSON.stringify(material)} cannot authorize a PLA receipt`, () => {
        const { parseSliceOptions } = require('../../../app/services/slice/options');
        const parsed = parseSliceOptions({ layerHeight: '0.2', material, infill: '20%', supports: 'true' }, 'FDM', 'bambu');
        assert.equal(parsed.isValid, true);
        assert.throws(() => validateAppliedConfig(gcode, parsed.options, '02.08.02.61'), { code: 'BAMBU_RESULT_UNVERIFIED' });
    });
}

for (const [key, value] of [['layer_height', '0.1'], ['sparse_infill_density', '30%'],
    ['enable_support', '0'], ['filament_type', 'ABS'], ['printer_settings_id', 'foreign'], ['curr_bed_type', 'foreign']]) {
    test(`native ${key} mutation cannot become an applied fact`, () => {
        const altered = gcode.replace(new RegExp(`^; ${key} = .*`, 'm'), `; ${key} = ${value}`);
        assert.throws(() => validateAppliedConfig(altered, context, '02.08.02.61'), { code: 'BAMBU_RESULT_UNVERIFIED' });
        assert.equal(validateAppliedConfig(gcode, context, '02.08.02.61').applied.layer_height_mm, .2);
    });
}
test('missing, duplicate or foreign native configuration/build fails closed', () => {
    assert.throws(() => parseConfig(''), { code: 'BAMBU_RESULT_UNVERIFIED' });
    assert.throws(() => parseConfig(gcode.replace('; layer_height = 0.2', '; layer_height = 0.2\n; layer_height = 0.2')));
    assert.throws(() => validateAppliedConfig(gcode, context, '99.0.0'));
    assert.throws(() => validateAppliedConfig(gcode.replace('; enable_support = 1\n', ''), context, '02.08.02.61'));
});
for (const mutation of [
    r => { r.sliced_plates.push(structuredClone(r.sliced_plates[0])); },
    r => { r.sliced_plates[0].filaments.push(structuredClone(r.sliced_plates[0].filaments[0])); },
    r => { r.sliced_plates[0].id = 2; },
    r => { r.sliced_plates[0].total_predication = 0; },
    r => { r.sliced_plates[0].filaments[0].total_used_g = 0; },
    r => { r.return_code = 1; }
]) {
    test('artificial native scope/total mutation is rejected; restored control passes', () => {
        const copy = structuredClone(result); mutation(copy);
        assert.throws(() => validateNativeScope(copy, gcode, stats), { code: 'BAMBU_RESULT_UNVERIFIED' });
        assert.equal(validateNativeScope(result, gcode, stats).id, 1);
    });
}
test('retained native artifact contains exactly the parsed G-code bytes', async () => {
    const file = path.join(fixture, 'control.gcode.3mf');
    await verifyBambuArtifact(file, '72a2f51c82ccfe056218c7368d66dd2ca7d1f0aefa5caa9786d0bd53a035f894');
    await assert.rejects(verifyBambuArtifact(file, '0'.repeat(64)), { code: 'BAMBU_RESULT_UNVERIFIED' });
});
test('receipt hash canonicalizes keys while retaining null/zero distinction', () => {
    assert.equal(hashValue({ b: [null, 0], a: .2 }), hashValue({ a: .2, b: [null, 0] }));
    assert.notEqual(hashValue({ a: null }), hashValue({ a: 0 }));
    assert.throws(() => hashValue({ a: NaN }));
});

test('successful native warnings remain bounded and path-free; unrelated stderr is not an error', () => {
    const warnings = collectWarnings({}, { warning_message: 'private-model warning' },
        { orientation_outcome: 'fallback_unmodified' }, { stderr: 'WARNING secret-path' });
    assert.equal(warnings.length, 2);
    assert.doesNotMatch(JSON.stringify(warnings), /private-model|secret-path/);
    assert.deepEqual(collectWarnings({}, {}, {}, { stderr: 'progress complete' }), []);
});

test('malformed identity preconditions reject before queued processing', () => {
    const { parseSliceOptions } = require('../../../app/services/slice/options');
    for (const field of ['expectedProfileSha256', 'expectedMeasurementGeneration']) {
        for (const value of [null, '', ['a'.repeat(64)], 'A'.repeat(64), 'bad']) {
            const result = parseSliceOptions({ layerHeight: '.2', material: 'PLA', [field]: value }, 'FDM', 'bambu');
            assert.equal(result.response.errorCode, 'INVALID_SLICE_IDENTITY');
        }
    }
});
