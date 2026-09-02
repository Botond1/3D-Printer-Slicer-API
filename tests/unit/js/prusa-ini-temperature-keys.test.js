'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const PRUSA_DIR = path.join(ROOT, 'configs', 'prusa');
const FDM_PROFILES = Object.freeze([
    'FDM_0.1mm.ini',
    'FDM_0.2mm.ini',
    'FDM_0.3mm.ini',
    'FDM_P1S_H2D_SIZE_QUOTING_0.1mm.ini',
    'FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini',
    'FDM_P1S_H2D_SIZE_QUOTING_0.3mm.ini'
]);

function keyValue(content, key) {
    const match = new RegExp(`^${key} = (\\S+)$`, 'm').exec(content);
    return match ? match[1] : null;
}

test('the six FDM Prusa profiles use PrusaSlicer temperature keys, not the Orca nozzle_temperature key', () => {
    for (const name of FDM_PROFILES) {
        const content = fs.readFileSync(path.join(PRUSA_DIR, name), 'utf8');
        assert.doesNotMatch(content, /^nozzle_temperature\s*=/m, `${name} must not carry the OrcaSlicer key`);
        const temperature = Number(keyValue(content, 'temperature'));
        const firstLayer = Number(keyValue(content, 'first_layer_temperature'));
        const bed = Number(keyValue(content, 'bed_temperature'));
        const firstLayerBed = Number(keyValue(content, 'first_layer_bed_temperature'));
        for (const [label, value] of [['temperature', temperature], ['first_layer_temperature', firstLayer], ['bed_temperature', bed], ['first_layer_bed_temperature', firstLayerBed]]) {
            assert.ok(Number.isSafeInteger(value) && value > 0, `${name}: ${label} must be a positive integer`);
        }
        assert.ok(temperature >= 180 && temperature <= 260, `${name}: nozzle temperature ${temperature} is outside the PLA/PETG range`);
        assert.equal((content.match(/^temperature = /gm) || []).length, 1, `${name}: exactly one temperature key`);
    }
});

test('the temperature rename left every other profile line untouched', () => {
    for (const name of FDM_PROFILES) {
        const lines = fs.readFileSync(path.join(PRUSA_DIR, name), 'utf8').split(/\r?\n/);
        const temperatureIndex = lines.findIndex((line) => line.startsWith('temperature = '));
        assert.ok(temperatureIndex > 0, name);
        assert.equal(lines[temperatureIndex + 1].startsWith('first_layer_temperature = '), true, name);
        assert.match(lines[temperatureIndex - 1], /^# Temperature/, name);
    }
});

test('requirements.txt pins exactly the signed production image versions without numpy-stl', () => {
    const content = fs.readFileSync(path.join(ROOT, 'requirements.txt'), 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
    assert.deepEqual(lines, [
        'gmsh==4.15.2',
        'lxml==6.1.2',
        'networkx==3.6.1',
        'numpy==2.5.2',
        'scipy==1.18.1',
        'trimesh==5.1.0'
    ]);
    for (const line of lines) assert.match(line, /^[a-z0-9_-]+==\d+\.\d+\.\d+$/);
    assert.doesNotMatch(content, /numpy-stl/);

    const pythonSources = ['mesh2stl.py', 'cad2stl.py', 'orient.py', 'scale_model.py']
        .map((file) => fs.readFileSync(path.join(ROOT, 'app', file), 'utf8'))
        .join('\n');
    assert.doesNotMatch(pythonSources, /^\s*(?:from|import)\s+stl\b/m, 'numpy-stl is not imported by any helper');
});
