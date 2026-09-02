'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    readOrcaFilamentProfileMetadata,
    resolveOrcaFilamentConfigPath
} = require('../../../app/services/slice/filament-profile');

test('supported materials resolve to exact repository profiles and unsupported material stays null', () => {
    assert.equal(path.basename(resolveOrcaFilamentConfigPath('PLA')), 'PLA_generic.json');
    assert.equal(path.basename(resolveOrcaFilamentConfigPath('petg')), 'PETG_generic.json');
    assert.equal(path.basename(resolveOrcaFilamentConfigPath('ABS')), 'ABS_generic.json');
    assert.equal(path.basename(resolveOrcaFilamentConfigPath('tpu')), 'TPU_generic.json');
    assert.equal(resolveOrcaFilamentConfigPath('NYLON'), null);
    assert.equal(resolveOrcaFilamentConfigPath(''), null);
    assert.equal(resolveOrcaFilamentConfigPath('PLA', { orcaFilamentProfile: '../outside.json' }), null);
});

test('used diameter and density come from the exact selected profile', () => {
    assert.deepEqual(readOrcaFilamentProfileMetadata(resolveOrcaFilamentConfigPath('PLA'), 'PLA'), {
        diameterMm: 1.75,
        densityGcm3: 1.24
    });
    assert.deepEqual(readOrcaFilamentProfileMetadata(resolveOrcaFilamentConfigPath('PETG'), 'PETG'), {
        diameterMm: 1.75,
        densityGcm3: 1.27
    });
    assert.deepEqual(readOrcaFilamentProfileMetadata(resolveOrcaFilamentConfigPath('ABS'), 'ABS'), {
        diameterMm: 1.75,
        densityGcm3: 1.04
    });
    assert.deepEqual(readOrcaFilamentProfileMetadata(resolveOrcaFilamentConfigPath('TPU'), 'TPU'), {
        diameterMm: 1.75,
        densityGcm3: 1.24
    });
    assert.equal(readOrcaFilamentProfileMetadata(null, 'NYLON'), null);
});

test('metadata extraction refuses ambiguous, mismatched, and nonpositive values', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j1-filament-profile-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const fixture = path.join(root, 'filament.json');

    const write = (value) => fs.writeFile(fixture, JSON.stringify(value));
    await write({
        type: 'filament', filament_type: ['PLA'],
        filament_diameter: ['1.75', '2.85'], filament_density: ['1.24']
    });
    assert.throws(() => readOrcaFilamentProfileMetadata(fixture, 'PLA'), /exactly one value/);

    await write({
        type: 'filament', filament_type: ['PETG'],
        filament_diameter: ['1.75'], filament_density: ['1.27']
    });
    assert.throws(() => readOrcaFilamentProfileMetadata(fixture, 'PLA'), /does not match/);

    await write({
        type: 'filament', filament_type: ['PETG', 'PLA'],
        filament_diameter: ['1.75'], filament_density: ['1.24']
    });
    assert.throws(() => readOrcaFilamentProfileMetadata(fixture, 'PLA'), /does not match/);

    await write({
        type: 'filament', filament_type: ['PLA'],
        filament_diameter: ['1.75'], filament_density: ['0']
    });
    assert.throws(() => readOrcaFilamentProfileMetadata(fixture, 'PLA'), /must be positive/);
});
