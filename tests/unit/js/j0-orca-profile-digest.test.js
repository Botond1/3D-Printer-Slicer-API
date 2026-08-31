'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    calculateEffectiveProfileSha256,
    createEffectiveProfileIdentity
} = require('../../../app/services/slice/profile-digest');
const { resolveSlicerInvocationPolicy } = require('../../../app/services/slice/engine');

async function createFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j0-profile-digest-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

test('Orca digest excludes request overrides but covers machine, process, and server invariants', async (t) => {
    const root = await createFixture(t);
    const machineA = path.join(root, 'machine-a.json');
    const machineB = path.join(root, 'machine-b.json');
    const machineChanged = path.join(root, 'machine-changed.json');
    const machineLayerResetChanged = path.join(root, 'machine-layer-reset-changed.json');
    const processA = path.join(root, 'process-a.json');
    const processB = path.join(root, 'process-b.json');
    const processRequestChanged = path.join(root, 'process-request-changed.json');
    const processChanged = path.join(root, 'process-changed.json');
    const processInvariantChanged = path.join(root, 'process-invariant-changed.json');
    const processRelativeInvariantChanged = path.join(root, 'process-relative-invariant-changed.json');
    const filamentA = path.join(root, 'filament-a.json');
    const filamentB = path.join(root, 'filament-b.json');
    const filamentChanged = path.join(root, 'filament-changed.json');

    await fs.writeFile(machineA, JSON.stringify({
        name: 'P1S', printable: { height: '250', area: ['0x0', '250x250'] },
        layer_change_gcode: 'G92 E0'
    }));
    await fs.writeFile(machineB, JSON.stringify({
        layer_change_gcode: 'G92 E0',
        printable: { area: ['0x0', '250x250'], height: '250' }, name: 'P1S'
    }, null, 4));
    await fs.writeFile(machineChanged, JSON.stringify({
        name: 'P1S', printable: { height: '260', area: ['0x0', '250x250'] },
        layer_change_gcode: 'G92 E0'
    }));
    await fs.writeFile(machineLayerResetChanged, JSON.stringify({
        name: 'P1S', printable: { height: '250', area: ['0x0', '250x250'] },
        layer_change_gcode: 'G92 E1'
    }));
    await fs.writeFile(processA, JSON.stringify({
        layer_height: '0.2', sparse_infill_density: '20%', walls: { count: '2' },
        layer_gcode: 'G92 E0', use_relative_e_distances: '0'
    }));
    await fs.writeFile(processB, JSON.stringify({
        use_relative_e_distances: '0', walls: { count: '2' },
        sparse_infill_density: '20%', layer_gcode: 'G92 E0', layer_height: '0.2'
    }, null, 2));
    await fs.writeFile(processRequestChanged, JSON.stringify({
        layer_height: '0.3', sparse_infill_density: '80%', walls: { count: '2' },
        layer_gcode: 'G92 E0', use_relative_e_distances: '0'
    }));
    await fs.writeFile(processChanged, JSON.stringify({
        layer_height: '0.2', sparse_infill_density: '20%', walls: { count: '3' },
        layer_gcode: 'G92 E0', use_relative_e_distances: '0'
    }));
    await fs.writeFile(processInvariantChanged, JSON.stringify({
        layer_height: '0.2', sparse_infill_density: '20%', walls: { count: '2' },
        layer_gcode: 'G92 E1', use_relative_e_distances: '0'
    }));
    await fs.writeFile(processRelativeInvariantChanged, JSON.stringify({
        layer_height: '0.2', sparse_infill_density: '20%', walls: { count: '2' },
        layer_gcode: 'G92 E0', use_relative_e_distances: '1'
    }));
    await fs.writeFile(filamentA, JSON.stringify({
        type: 'filament', inherits: 'fdm_filament_pla', filament_type: ['PLA'],
        filament_density: ['1.24'], filament_diameter: ['1.75']
    }));
    await fs.writeFile(filamentB, JSON.stringify({
        filament_diameter: ['1.75'], filament_density: ['1.24'],
        filament_type: ['PLA'], inherits: 'fdm_filament_pla', type: 'filament'
    }, null, 4));
    await fs.writeFile(filamentChanged, JSON.stringify({
        type: 'filament', inherits: 'fdm_filament_pla', filament_type: ['PLA'],
        filament_density: ['1.25'], filament_diameter: ['1.75']
    }));

    const digest = (runtimeConfigFile, orcaMachineConfigFile, orcaFilamentConfigFile = filamentA,
        material = 'PLA') => calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', material,
        runtimeConfigFile, orcaMachineConfigFile, orcaFilamentConfigFile
    });
    assert.equal(digest(processA, machineA), digest(processB, machineB));
    assert.equal(digest(processA, machineA), digest(processA, machineA, filamentB, 'pla'));
    assert.equal(digest(processA, machineA), digest(processRequestChanged, machineA));
    assert.notEqual(digest(processA, machineA), digest(processA, machineChanged));
    assert.notEqual(digest(processA, machineA), digest(processA, machineLayerResetChanged));
    assert.notEqual(digest(processA, machineA), digest(processChanged, machineA));
    assert.notEqual(digest(processA, machineA), digest(processInvariantChanged, machineA));
    assert.notEqual(digest(processA, machineA), digest(processRelativeInvariantChanged, machineA));
    assert.notEqual(digest(processA, machineA), digest(processA, machineA, filamentChanged));
    assert.notEqual(digest(processA, machineA), digest(processA, machineA, null));
    assert.notEqual(digest(processA, machineA), digest(processA, machineA, filamentA, 'PETG'));
});

test('effective digest refuses incomplete or unsupported profile contexts', async (t) => {
    const root = await createFixture(t);
    const processProfile = path.join(root, 'process.json');
    await fs.writeFile(processProfile, '{}');

    assert.throws(
        () => calculateEffectiveProfileSha256({
            engine: 'orca', technology: 'FDM', runtimeConfigFile: processProfile
        }),
        /machine profile is required/
    );
    assert.throws(
        () => calculateEffectiveProfileSha256({
            engine: 'unknown', technology: 'FDM', runtimeConfigFile: processProfile
        }),
        /Unsupported slicer engine/
    );
});

test('profile identity binds the request-independent native invocation policy', async (t) => {
    const root = await createFixture(t);
    const prusaProfile = path.join(root, 'profile.ini');
    const orcaProcess = path.join(root, 'process.json');
    const orcaMachine = path.join(root, 'machine.json');
    await fs.writeFile(prusaProfile, 'perimeters = 2\n');
    await fs.writeFile(orcaProcess, '{}');
    await fs.writeFile(orcaMachine, '{}');

    const orcaPolicy = resolveSlicerInvocationPolicy('orca', 'FDM');
    assert.deepEqual(orcaPolicy, {
        arrange: '1', orient: '0', allowRotations: '0', slice: '0',
        settingsPrecedence: ['machine', 'process'], filamentOption: '--load-filaments'
    });
    assert.notDeepEqual(orcaPolicy, {
        ...orcaPolicy, settingsPrecedence: ['process', 'machine']
    });
    assert.deepEqual(resolveSlicerInvocationPolicy('prusa', 'FDM'), {
        center: '100,100',
        supportMaterial: true,
        supportMaterialAuto: true,
        gcodeFlavor: 'marlin',
        export: 'gcode'
    });
    assert.deepEqual(resolveSlicerInvocationPolicy('prusa', 'SLA'), {
        center: '100,100', export: 'sla'
    });
    assert.deepEqual(createEffectiveProfileIdentity({
        engine: 'prusa', technology: 'FDM', runtimeConfigFile: prusaProfile
    }).invocation, resolveSlicerInvocationPolicy('prusa', 'FDM'));
    assert.equal(
        calculateEffectiveProfileSha256({
            engine: 'prusa', technology: 'FDM', material: 'PLA', runtimeConfigFile: prusaProfile
        }),
        calculateEffectiveProfileSha256({
            engine: 'prusa', technology: 'FDM', material: 'PETG', runtimeConfigFile: prusaProfile
        })
    );
    assert.deepEqual(createEffectiveProfileIdentity({
        engine: 'orca', technology: 'FDM', runtimeConfigFile: orcaProcess,
        orcaMachineConfigFile: orcaMachine, material: 'ABS', orcaFilamentConfigFile: null
    }).invocation, resolveSlicerInvocationPolicy('orca', 'FDM'));
    assert.equal(createEffectiveProfileIdentity({
        engine: 'orca', technology: 'FDM', runtimeConfigFile: orcaProcess,
        orcaMachineConfigFile: orcaMachine, material: 'ABS', orcaFilamentConfigFile: null
    }).filament, null);
});
