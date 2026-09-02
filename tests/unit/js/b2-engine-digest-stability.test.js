'use strict';

/**
 * Prusa and Orca effective-profile digests must stay byte-identical across the
 * Bambu placement work. The pinned values below were computed on the
 * integration-branch base (commit ce639a6) with the exact fixture bytes written
 * here; any change to the Prusa/Orca invocation policy, canonicalization, or
 * digest schema changes them and must be a deliberate, documented decision.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { calculateEffectiveProfileSha256 } = require('../../../app/services/slice/profile-digest');
const { resolveSlicerInvocationPolicy } = require('../../../app/services/slice/engine');

const PINNED_DIGESTS = Object.freeze({
    prusaFdm: '836ce4b05fb4dfa3d0c6a901b03b4c21904fa85a6a801c520834cd1594ade4f7',
    prusaSla: '8e490377f40a390dfd4b89f58cffe36c13801e4cc0c373689e46c1edc6601bc1',
    orcaPla: '6629acd7d42857e420409b0da6cf193b32dd270a165fbfced653b045cb8232e7',
    orcaNoFilament: 'edce09f4f42e07e6859940870c2b3648044e27f2a1b111554d80163610706ae7'
});

async function writeFixtures(root) {
    const prusaFdm = path.join(root, 'prusa-fdm.ini');
    const prusaSla = path.join(root, 'prusa-sla.ini');
    const machine = path.join(root, 'machine.json');
    const process = path.join(root, 'process.json');
    const filament = path.join(root, 'filament.json');
    await fs.writeFile(prusaFdm, '# fixed\n[print]\nlayer_height = 0.2\nfill_density = 20%\nperimeters = 2\nsupport_material = 0\n');
    await fs.writeFile(prusaSla, 'layer_height = 0.05\nsupports_enable = 1\n');
    await fs.writeFile(machine, JSON.stringify({
        name: 'P1S', printable_area: ['0x0', '256x256'], printable_height: '250', layer_change_gcode: 'G92 E0'
    }));
    await fs.writeFile(process, JSON.stringify({
        layer_height: '0.2', sparse_infill_density: '20%', wall_loops: '2',
        layer_gcode: '', use_relative_e_distances: '1', enable_support: '1'
    }));
    await fs.writeFile(filament, JSON.stringify({
        name: 'Generic PLA', filament_diameter: ['1.75'], filament_density: ['1.24']
    }));
    return { prusaFdm, prusaSla, machine, process, filament };
}

test('Prusa and Orca effective digests are byte-identical to the pre-placement baseline', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-digest-stability-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const fixtures = await writeFixtures(root);

    assert.equal(calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'FDM', runtimeConfigFile: fixtures.prusaFdm
    }), PINNED_DIGESTS.prusaFdm);
    assert.equal(calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'SLA', runtimeConfigFile: fixtures.prusaSla
    }), PINNED_DIGESTS.prusaSla);
    assert.equal(calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', material: 'PLA', runtimeConfigFile: fixtures.process,
        orcaMachineConfigFile: fixtures.machine, orcaFilamentConfigFile: fixtures.filament
    }), PINNED_DIGESTS.orcaPla);
    assert.equal(calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', material: 'Custom', runtimeConfigFile: fixtures.process,
        orcaMachineConfigFile: fixtures.machine, orcaFilamentConfigFile: null
    }), PINNED_DIGESTS.orcaNoFilament);
});

test('only the Bambu invocation policy disables arrangement; Prusa and Orca policies are unchanged', () => {
    assert.deepEqual(resolveSlicerInvocationPolicy('prusa', 'FDM'), {
        center: '100,100', supportMaterial: true, supportMaterialAuto: true,
        gcodeFlavor: 'marlin', export: 'gcode'
    });
    assert.deepEqual(resolveSlicerInvocationPolicy('prusa', 'SLA'), {
        center: '100,100', export: 'sla'
    });
    assert.deepEqual(resolveSlicerInvocationPolicy('orca', 'FDM'), {
        arrange: '1', orient: '0', allowRotations: '0', slice: '0',
        settingsPrecedence: ['machine', 'process'], filamentOption: '--load-filaments'
    });
    assert.equal(resolveSlicerInvocationPolicy('bambu', 'FDM').arrange, '0');
    assert.equal(resolveSlicerInvocationPolicy('bambu', 'FDM').orient, '0');
    assert.equal(Object.hasOwn(resolveSlicerInvocationPolicy('bambu', 'FDM'), 'allowRotations'), false);
});
