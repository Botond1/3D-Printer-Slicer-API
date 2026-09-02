'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createRuntimeSlicerProfile } = require('../../../app/services/slice/profiles');
const { resolveMaterialFilamentMetadata } = require('../../../app/services/slice/filament-profile');

const BASE_INI = [
    'layer_height = 0.2',
    'fill_density = 20%',
    'filament_diameter = 1.75',
    'perimeters = 2'
].join('\n');

async function withWorkspace(run) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'prusa-density-'));
    const workspace = {
        resolvePath(...segments) { return path.join(root, ...segments); },
        assertContainedPath(candidate) {
            const resolved = path.resolve(candidate);
            if (!resolved.startsWith(path.resolve(root))) throw new Error('escape');
            return resolved;
        }
    };
    try {
        return await run(root, workspace);
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
}

function readKey(content, key) {
    const match = new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm').exec(content);
    return match ? match[1].trim() : null;
}

test('Prusa runtime profile carries the supplied filament density', async () => {
    await withWorkspace(async (root, workspace) => {
        const base = path.join(root, 'base.ini');
        await fsp.writeFile(base, BASE_INI);
        const runtime = await createRuntimeSlicerProfile(
            'prusa', base, 'FDM', 0.2, '20%', workspace,
            { filamentDensityGcm3: 1.24 }
        );
        const content = await fsp.readFile(runtime, 'utf8');
        assert.equal(readKey(content, 'filament_density'), '1.24');
        // The other runtime overrides must survive alongside it.
        assert.equal(readKey(content, 'layer_height'), '0.2');
        assert.equal(readKey(content, 'fill_density'), '20%');
    });
});

test('Prusa runtime profile omits density when none is supplied', async () => {
    await withWorkspace(async (root, workspace) => {
        const base = path.join(root, 'base.ini');
        await fsp.writeFile(base, BASE_INI);
        const runtime = await createRuntimeSlicerProfile(
            'prusa', base, 'FDM', 0.2, '20%', workspace, {}
        );
        const content = await fsp.readFile(runtime, 'utf8');
        // A material with no catalogue entry must not get an invented density.
        // Silently defaulting one would misprice every such request rather than
        // routing it to manual pricing, which is the safe outcome.
        assert.equal(readKey(content, 'filament_density'), null);
    });
});

test('an existing density in the base profile is replaced, not duplicated', async () => {
    await withWorkspace(async (root, workspace) => {
        const base = path.join(root, 'base.ini');
        await fsp.writeFile(base, `${BASE_INI}\nfilament_density = 9.99`);
        const runtime = await createRuntimeSlicerProfile(
            'prusa', base, 'FDM', 0.2, '20%', workspace,
            { filamentDensityGcm3: 1.27 }
        );
        const content = await fsp.readFile(runtime, 'utf8');
        assert.equal(readKey(content, 'filament_density'), '1.27');
        assert.equal(content.match(/^filament_density\s*=/gm).length, 1);
    });
});

test('the shipped materials resolve to positive, distinct densities', () => {
    const pla = resolveMaterialFilamentMetadata('PLA');
    const petg = resolveMaterialFilamentMetadata('PETG');
    const abs = resolveMaterialFilamentMetadata('ABS');
    const tpu = resolveMaterialFilamentMetadata('TPU');
    assert.ok(pla.densityGcm3 > 0);
    assert.ok(petg.densityGcm3 > 0);
    assert.ok(abs.densityGcm3 > 0);
    assert.ok(tpu.densityGcm3 > 0);
    // Distinct on purpose: a single hardcoded density is exactly the defect
    // this seam exists to avoid, and equality here would hide it.
    assert.notEqual(pla.densityGcm3, petg.densityGcm3);
    assert.notEqual(pla.densityGcm3, abs.densityGcm3);
    assert.equal(abs.densityGcm3, 1.04);
    // A material with no catalogue entry still routes to manual pricing.
    assert.equal(resolveMaterialFilamentMetadata('NYLON'), null);
});
