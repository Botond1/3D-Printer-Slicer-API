'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    SLA_PRINTER_REGISTRY_ERROR_CODE,
    SLA_PRINTER_REGISTRY_SCHEMA,
    getDefaultSlaPrinterId,
    getSlaMaterials,
    getSlaPrinter,
    getSlaPrinterRegistry,
    getSlaTimeModel,
    loadSlaPrinterRegistry,
    resolveSlaResinDensity,
    validateSlaPrinterRegistry
} = require('../../../app/services/slice/sla-printer-registry');

function validRegistry(overrides = {}) {
    return {
        schema: SLA_PRINTER_REGISTRY_SCHEMA,
        default_printer: 'SATURN4U',
        printers: {
            SATURN4U: {
                name: 'Elegoo Saturn 4 Ultra',
                technology: 'MSLA',
                declared_build_volume_mm: { x: 218.88, y: 122.88, z: 220 },
                quote_raster_pixels: { x: 768, y: 432 },
                time_model: {
                    version: 'sla-layer-time-v1',
                    bottom_layers: 5,
                    transition_layers: 8,
                    motion_seconds_per_layer: 2.5,
                    motion_seconds_per_bottom_layer: 6.0,
                    exposure_seconds_by_layer_height: { '0.025': 2.0, '0.05': 2.5 },
                    bottom_exposure_seconds: 30,
                    notes: 'test notes'
                },
                resins: {
                    Standard: { density_g_cm3: 1.1 },
                    'ABS-Like': { density_g_cm3: 1.1 },
                    Flexible: { density_g_cm3: 1.05 }
                }
            }
        },
        ...overrides
    };
}

test('the shipped registry loads, freezes, and exposes the Saturn 4 Ultra printer', () => {
    const registry = getSlaPrinterRegistry({ reload: true });
    assert.equal(registry.schema, SLA_PRINTER_REGISTRY_SCHEMA);
    assert.equal(registry.defaultPrinter, 'SATURN4U');
    assert.equal(Object.isFrozen(registry), true);
    assert.equal(Object.isFrozen(registry.printers), true);
    const printer = getSlaPrinter('SATURN4U', registry);
    assert.equal(printer.name, 'Elegoo Saturn 4 Ultra');
    assert.deepEqual(printer.declaredBuildVolumeMm, { x: 218.88, y: 122.88, z: 220 });
    assert.deepEqual(getSlaMaterials('SATURN4U', registry), ['ABS-Like', 'Flexible', 'Standard']);
    assert.equal(getDefaultSlaPrinterId(registry), 'SATURN4U');
    assert.equal(getSlaTimeModel('SATURN4U', registry).version, 'sla-layer-time-v1');
});

test('printer id resolution defaults on omission and case-insensitive resin lookup', () => {
    const registry = validateSlaPrinterRegistry(validRegistry());
    assert.equal(getSlaPrinter(undefined, registry).id, 'SATURN4U');
    assert.equal(resolveSlaResinDensity('Standard', undefined, registry), 1.1);
    assert.equal(resolveSlaResinDensity('abs-like', 'SATURN4U', registry), 1.1);
    assert.equal(resolveSlaResinDensity('FLEXIBLE', 'SATURN4U', registry), 1.05);
    assert.equal(resolveSlaResinDensity('Nylon', 'SATURN4U', registry), null);
    assert.throws(() => getSlaPrinter('UNKNOWN', registry), /Unknown SLA printer id/);
});

test('registry validation fails closed on every structural drift', () => {
    const cases = [
        [{ ...validRegistry(), schema: 'wrong' }, /schema must be/],
        [{ ...validRegistry(), default_printer: 'MISSING' }, /default_printer must name/],
        [(() => { const r = validRegistry(); delete r.printers.SATURN4U.technology; return r; })(), /must contain exactly the keys/],
        [(() => { const r = validRegistry(); r.printers.SATURN4U.technology = 'FDM'; return r; })(), /technology must be MSLA/],
        [(() => { const r = validRegistry(); r.printers.SATURN4U.time_model.bottom_layers = -1; return r; })(), /non-negative integer/],
        [(() => { const r = validRegistry(); r.printers.SATURN4U.time_model.motion_seconds_per_layer = 0; return r; })(), /positive finite number/],
        [(() => { const r = validRegistry(); delete r.printers.SATURN4U.time_model.exposure_seconds_by_layer_height['0.05']; return r; })(), /exactly the keys/],
        [(() => { const r = validRegistry(); r.printers.SATURN4U.resins = {}; return r; })(), /at least one entry/],
        [(() => { const r = validRegistry(); r.printers.SATURN4U.resins.bad_key = { density_g_cm3: 1 }; return r; })(), /not canonical/],
        [(() => { const r = validRegistry(); r.printers.SATURN4U.resins.Standard.density_g_cm3 = -1; return r; })(), /positive finite number/]
    ];
    for (const [raw, pattern] of cases) {
        assert.throws(() => validateSlaPrinterRegistry(raw), pattern, JSON.stringify(raw).slice(0, 80));
    }
    try {
        validateSlaPrinterRegistry({ ...validRegistry(), schema: 'wrong' });
        assert.fail('expected a typed registry error');
    } catch (error) {
        assert.equal(error.code, SLA_PRINTER_REGISTRY_ERROR_CODE);
    }
});

test('loadSlaPrinterRegistry reads and validates the exact configured file', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sla-registry-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const registryPath = path.join(root, 'printers.json');
    await fsp.writeFile(registryPath, JSON.stringify(validRegistry()));
    const loaded = loadSlaPrinterRegistry({ registryPath });
    assert.equal(loaded.defaultPrinter, 'SATURN4U');

    const malformedPath = path.join(root, 'malformed.json');
    fs.writeFileSync(malformedPath, 'not json');
    assert.throws(
        () => loadSlaPrinterRegistry({ registryPath: malformedPath }),
        { code: SLA_PRINTER_REGISTRY_ERROR_CODE }
    );
});
