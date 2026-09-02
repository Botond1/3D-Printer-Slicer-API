'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/bambu-profiles');
process.env.BAMBU_PROFILES_ROOT = FIXTURE_ROOT;

const {
    BAMBU_PRINTER_REGISTRY_ERROR_CODE,
    BAMBU_PRINTER_REGISTRY_SCHEMA,
    getBambuAllowedLayerKeys,
    getBambuMaterials,
    getBambuPrinterRegistry,
    getBambuProcessNames,
    listBambuRegistryProfileReferences,
    loadBambuPrinterRegistry,
    resolveBambuFilamentName,
    resolveBambuLayerKey,
    resolveBambuPrinterId,
    resolveBambuProcessName,
    validateBambuPrinterRegistry
} = require('../../../app/services/slice/bambu-printer-registry');
const {
    BAMBU_PROFILE_CHAIN_ERROR_CODE,
    MAX_INHERITANCE_DEPTH,
    flattenBambuProfile,
    resolveBambuProfilePath,
    resolveBambuProfilesRoot,
    verifyBambuRegistryChains
} = require('../../../app/services/slice/bambu-profile-chain');
const { BAMBU_DEFAULT_PROFILES_ROOT } = require('../../../app/config/constants');
const {
    readBambuFilamentProfileMetadata,
    readOrcaFilamentProfileMetadata
} = require('../../../app/services/slice/filament-profile');

function validRegistry() {
    return JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../../configs/bambu/printers.json'), 'utf8'
    ));
}

test('the shipped registry loads, freezes, and exposes the owner-approved printer selection', () => {
    const registry = getBambuPrinterRegistry();
    assert.equal(registry.schema, BAMBU_PRINTER_REGISTRY_SCHEMA);
    assert.equal(registry.defaultPrinter, 'P1S');
    assert.equal(Object.isFrozen(registry), true);
    assert.equal(Object.isFrozen(registry.printers.P1S.processes), true);
    assert.deepEqual(Object.keys(registry.printers).sort(), ['H2D', 'P1S']);
    assert.equal(registry.printers.P1S.machine, 'Bambu Lab P1S 0.4 nozzle');
    assert.equal(registry.printers.H2D.machine, 'Bambu Lab H2D 0.4 nozzle');
    assert.equal(registry.printers.P1S.bedType, 'Textured PEI Plate');
    assert.deepEqual(getBambuAllowedLayerKeys('P1S'), ['0.08', '0.1', '0.12', '0.16', '0.2', '0.24', '0.28']);
    assert.deepEqual(getBambuAllowedLayerKeys('H2D'), ['0.08', '0.1', '0.12', '0.16', '0.2', '0.24']);
    assert.deepEqual(getBambuMaterials('P1S'), ['ABS', 'PETG', 'PLA', 'TPU']);
    // 0.1 maps to the vendor 0.12 process (layer height is overridden at runtime); 0.3 is never offered.
    assert.equal(resolveBambuProcessName('P1S', '0.1'), '0.12mm Fine @BBL X1C');
    assert.equal(resolveBambuProcessName('P1S', '0.12'), '0.12mm Fine @BBL X1C');
    assert.equal(resolveBambuProcessName('H2D', '0.1'), '0.12mm Fine @BBL H2D');
    assert.equal(resolveBambuProcessName('P1S', '0.3'), null);
    assert.equal(resolveBambuProcessName('P1S', '0.2', '0.16mm Optimal @BBL X1C'), '0.16mm Optimal @BBL X1C');
    assert.equal(resolveBambuProcessName('P1S', '0.2', '0.16mm Standard @BBL H2D'), null);
    assert.equal(getBambuProcessNames('P1S').length, 6);
    assert.equal(resolveBambuFilamentName('H2D', 'petg'), 'Generic PETG @BBL H2D');
    assert.equal(resolveBambuFilamentName('P1S', 'NYLON'), null);
    assert.equal(listBambuRegistryProfileReferences().length, 21);
});

test('printer ids resolve case-insensitively, default on omission, and reject unknown values', () => {
    assert.equal(resolveBambuPrinterId(undefined), 'P1S');
    assert.equal(resolveBambuPrinterId(''), 'P1S');
    assert.equal(resolveBambuPrinterId('  '), 'P1S');
    assert.equal(resolveBambuPrinterId('h2d'), 'H2D');
    assert.equal(resolveBambuPrinterId(' P1s '), 'P1S');
    assert.equal(resolveBambuPrinterId('X1C'), null);
    assert.equal(resolveBambuPrinterId(42), null);
    assert.equal(resolveBambuPrinterId({}), null);
    assert.equal(resolveBambuLayerKey(0.2, 'P1S'), '0.2');
    assert.equal(resolveBambuLayerKey(0.28, 'H2D'), null);
    assert.equal(resolveBambuLayerKey(0.3, 'P1S'), null);
    assert.equal(resolveBambuLayerKey(Number.NaN, 'P1S'), null);
});

test('registry validation fails closed on every structural drift', () => {
    assert.equal(validateBambuPrinterRegistry(validRegistry()).defaultPrinter, 'P1S');
    const mutate = (change) => {
        const candidate = validRegistry();
        change(candidate);
        return candidate;
    };
    const cases = [
        ['schema', mutate((r) => { r.schema = 'r3d-bambu-printer-registry-v0'; })],
        ['unknown default', mutate((r) => { r.default_printer = 'X1C'; })],
        ['extra top-level key', mutate((r) => { r.extra = 1; })],
        ['missing printer key', mutate((r) => { delete r.printers.P1S.bed_type; })],
        ['extra printer key', mutate((r) => { r.printers.P1S.nozzle = '0.4'; })],
        ['non-canonical layer key', mutate((r) => { r.printers.P1S.processes['0.20'] = '0.20mm Standard @BBL X1C'; })],
        ['zero layer key', mutate((r) => { r.printers.P1S.processes['0'] = '0.20mm Standard @BBL X1C'; })],
        ['path in profile name', mutate((r) => { r.printers.P1S.machine = '../Bambu Lab P1S 0.4 nozzle'; })],
        ['non-string profile name', mutate((r) => { r.printers.P1S.filaments.PLA = 7; })],
        ['lowercase material key', mutate((r) => { r.printers.P1S.filaments.pla = 'Generic PLA'; })],
        ['empty processes', mutate((r) => { r.printers.P1S.processes = {}; })],
        ['lowercase printer id', mutate((r) => { r.printers.p1s = r.printers.P1S; delete r.printers.P1S; r.default_printer = 'p1s'; })],
        ['array printers', mutate((r) => { r.printers = []; })]
    ];
    for (const [name, candidate] of cases) {
        assert.throws(
            () => validateBambuPrinterRegistry(candidate),
            (error) => error.code === BAMBU_PRINTER_REGISTRY_ERROR_CODE,
            name
        );
    }
    assert.throws(
        () => loadBambuPrinterRegistry({ registryPath: path.join(FIXTURE_ROOT, 'does-not-exist.json') }),
        (error) => error.code === BAMBU_PRINTER_REGISTRY_ERROR_CODE
    );
});

test('profile root honours BAMBU_PROFILES_ROOT only as an absolute path', () => {
    assert.equal(resolveBambuProfilesRoot({}), BAMBU_DEFAULT_PROFILES_ROOT);
    assert.equal(BAMBU_DEFAULT_PROFILES_ROOT, '/opt/bambustudio/resources/profiles/BBL');
    assert.equal(resolveBambuProfilesRoot({ BAMBU_PROFILES_ROOT: FIXTURE_ROOT }), path.resolve(FIXTURE_ROOT));
    assert.throws(() => resolveBambuProfilesRoot({ BAMBU_PROFILES_ROOT: 'relative/profiles' }), /absolute/);
});

test('profile names are validated before any path is built and stay inside the role directory', () => {
    const resolved = resolveBambuProfilePath('machine', 'Bambu Lab P1S 0.4 nozzle', FIXTURE_ROOT);
    assert.equal(path.dirname(resolved), path.join(path.resolve(FIXTURE_ROOT), 'machine'));
    assert.equal(path.basename(resolved), 'Bambu Lab P1S 0.4 nozzle.json');
    for (const name of ['', ' padded ', '../escape', 'nested/name', 'nested\\name', 'a'.repeat(129), 'bad;name', 42, null]) {
        assert.throws(() => resolveBambuProfilePath('machine', name, FIXTURE_ROOT), /name is invalid/, String(name));
        assert.throws(() => flattenBambuProfile('machine', name), /name is invalid/, String(name));
    }
    assert.throws(() => flattenBambuProfile('printer', 'Bambu Lab P1S 0.4 nozzle'), /Unsupported Bambu profile role/);
});

test('machine chains flatten parent-first, drop structural keys, and keep the file identity', () => {
    const p1s = flattenBambuProfile('machine', 'Bambu Lab P1S 0.4 nozzle');
    assert.equal(p1s.name, 'Bambu Lab P1S 0.4 nozzle');
    assert.equal(p1s.type, 'machine');
    assert.equal(Object.hasOwn(p1s, 'inherits'), false);
    assert.equal(Object.hasOwn(p1s, 'include'), false);
    assert.deepEqual(p1s.printable_area, ['0x0', '256x0', '256x256', '0x256']);
    assert.equal(p1s.printable_height, '250');
    assert.deepEqual(p1s.bed_exclude_area, ['0x0', '18x0', '18x28', '0x28']);
    assert.deepEqual(p1s.nozzle_diameter, ['0.4']);
    assert.deepEqual(p1s.min_layer_height, ['0.08']);
    assert.deepEqual(p1s.max_layer_height, ['0.28']);
    assert.equal(p1s.gcode_flavor, 'marlin');
    // Grandparent-only keys survive, mid-chain overrides win over the root.
    assert.deepEqual(p1s.machine_max_speed_x, ['500', '200']);
    assert.equal(p1s.printer_structure, 'corexy');
    assert.equal(p1s.instantiation, 'true');
});

test('include templates merge in order after the parent chain and before the child keys', () => {
    const h2d = flattenBambuProfile('machine', 'Bambu Lab H2D 0.4 nozzle');
    assert.equal(h2d.name, 'Bambu Lab H2D 0.4 nozzle');
    assert.equal(Object.hasOwn(h2d, 'include'), false);
    assert.deepEqual(h2d.printable_area, ['0x0', '350x0', '350x320', '0x320']);
    assert.equal(h2d.printable_height, '325');
    assert.deepEqual(h2d.nozzle_diameter, ['0.4', '0.4']);
    assert.match(h2d.machine_start_gcode, /h2d start template/);
    assert.match(h2d.machine_end_gcode, /h2d end template/);
    // parent says 'from-parent', first include 'from-include-template', second include wins.
    assert.equal(h2d.template_marker, 'end-template-wins');
    // Child's own keys still override include templates.
    assert.equal(h2d.default_print_profile, '0.20mm Standard @BBL H2D');
});

test('process and filament chains resolve the owner-verified vendor keys', () => {
    const standard = flattenBambuProfile('process', '0.20mm Standard @BBL X1C');
    assert.equal(standard.layer_height, '0.2');
    assert.equal(standard.sparse_infill_density, '15%');
    assert.equal(standard.enable_support, '0');
    assert.equal(standard.support_type, 'tree(auto)');
    assert.equal(standard.wall_loops, '2');
    assert.ok(standard.compatible_printers.includes('Bambu Lab P1S 0.4 nozzle'));
    assert.equal(flattenBambuProfile('process', '0.12mm Fine @BBL X1C').layer_height, '0.12');

    const pla = flattenBambuProfile('filament', 'Generic PLA');
    assert.deepEqual(pla.filament_type, ['PLA']);
    assert.deepEqual(pla.filament_density, ['1.24']);
    assert.deepEqual(pla.filament_diameter, ['1.75']);
    assert.deepEqual(pla.filament_max_volumetric_speed, ['12']);
    const plaH2d = flattenBambuProfile('filament', 'Generic PLA @BBL H2D');
    assert.deepEqual(plaH2d.filament_density, ['1.24', '1.24']);
    assert.deepEqual(plaH2d.filament_type, ['PLA', 'PLA']);
    assert.deepEqual(flattenBambuProfile('filament', 'Generic ABS').filament_density, ['1.04']);
});

test('cycles, name mismatches, wrong roles, missing parents, and bad includes fail closed', () => {
    const cases = [
        ['Cycle A', /cycle/],
        ['Self Cycle', /cycle/],
        ['Name Mismatch', /name does not match/],
        ['Wrong Role', /type does not match/],
        ['Missing Parent', /ENOENT|Unsafe bounded-read/],
        ['Include Inherits', /cannot inherit or include/],
        ['Include Wrong Role', /template role does not match/],
        ['Does Not Exist At All', /ENOENT|Unsafe bounded-read/]
    ];
    for (const [name, pattern] of cases) {
        assert.throws(() => flattenBambuProfile('machine', name), pattern, name);
    }
    assert.throws(() => flattenBambuProfile('process', 'Bambu Lab P1S 0.4 nozzle'), /ENOENT|Unsafe bounded-read/);
});

test('inheritance depth is bounded at the documented maximum', () => {
    assert.equal(MAX_INHERITANCE_DEPTH, 8);
    assert.equal(flattenBambuProfile('machine', 'Deep 7').printable_height, '200');
    assert.throws(() => flattenBambuProfile('machine', 'Deep 8'), /exceeds the supported depth/);
    assert.throws(() => flattenBambuProfile('machine', 'Deep 9'), /exceeds the supported depth/);
});

test('startup verification flattens every registry-referenced profile or refuses with a typed code', () => {
    assert.deepEqual(verifyBambuRegistryChains({ root: FIXTURE_ROOT }), {
        root: path.resolve(FIXTURE_ROOT),
        verified: 21
    });
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-bambu-empty-'));
    try {
        assert.throws(
            () => verifyBambuRegistryChains({ root: emptyRoot }),
            (error) => error.code === BAMBU_PROFILE_CHAIN_ERROR_CODE
                && /could not be flattened/.test(error.message)
                && error.cause instanceof Error
        );
    } finally {
        fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
});

test('Bambu filament metadata accepts identical per-extruder arrays while Orca stays strict', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-bambu-filament-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (name, value) => {
        const target = path.join(root, `${name}.json`);
        fs.writeFileSync(target, JSON.stringify(value));
        return target;
    };
    const single = write('single', flattenBambuProfile('filament', 'Generic PLA'));
    const dual = write('dual', flattenBambuProfile('filament', 'Generic PLA @BBL H2D'));
    const ambiguous = write('ambiguous', flattenBambuProfile('filament', 'Ambiguous Density'));
    assert.deepEqual(readBambuFilamentProfileMetadata(single, 'PLA'), { diameterMm: 1.75, densityGcm3: 1.24 });
    assert.deepEqual(readBambuFilamentProfileMetadata(dual, 'pla'), { diameterMm: 1.75, densityGcm3: 1.24 });
    assert.deepEqual(readOrcaFilamentProfileMetadata(single, 'PLA'), { diameterMm: 1.75, densityGcm3: 1.24 });
    // Orca's strict reader refuses the duplicated per-extruder arrays outright
    // (the duplicated filament_type is the first check to fail closed).
    assert.throws(() => readOrcaFilamentProfileMetadata(dual, 'PLA'), /does not match|exactly one value/);
    assert.throws(() => readBambuFilamentProfileMetadata(ambiguous, 'PLA'), /exactly one value/);
    assert.throws(() => readBambuFilamentProfileMetadata(dual, 'PETG'), /does not match/);
    assert.equal(readBambuFilamentProfileMetadata(null, 'PLA'), null);
});
