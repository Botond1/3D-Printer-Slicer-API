'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveOrcaProfileInheritance } = require('../../../app/services/slice/orca-profile-inheritance');
const { calculateEffectiveProfileSha256 } = require('../../../app/services/slice/profile-digest');
const { snapshotProfileSelection } = require('../../../app/services/slice/profile-snapshot');

const ROOT = path.resolve(__dirname, '../../..');
const ORCA_ROOT = path.join(ROOT, 'configs', 'orca');

function tempRoot(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j0-orca-profile-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}\n`, { flag: 'w' });
}

test('repository Orca profiles resolve the exact v2.3.1 Custom parent chain', () => {
    const processProfile = resolveOrcaProfileInheritance(
        path.join(ORCA_ROOT, 'FDM_0.2mm.json'),
        'process'
    );
    assert.equal(Object.hasOwn(processProfile, 'inherits'), false);
    assert.equal(processProfile.layer_height, '0.2');
    assert.equal(processProfile.outer_wall_acceleration, '1000');
    assert.equal(processProfile.slowdown_for_curled_perimeters, '1');
    assert.deepEqual(processProfile.compatible_printers, ['MyMarlin 0.4 nozzle']);

    const machineProfile = resolveOrcaProfileInheritance(
        path.join(ORCA_ROOT, 'Bambu_P1S_0.4_nozzle.json'),
        'machine'
    );
    assert.equal(Object.hasOwn(machineProfile, 'inherits'), false);
    assert.deepEqual(machineProfile.machine_max_speed_x, ['500']);
    assert.deepEqual(machineProfile.retraction_speed, ['45']);
    assert.equal(machineProfile.printable_height, '250');
});

test('same-named child changes digest when a non-overridden parent value changes', (t) => {
    const root = tempRoot(t);
    const child = path.join(root, 'FDM_0.2mm.json');
    const parent = path.join(root, 'parent.json');
    const machine = path.join(root, 'machine.json');
    const runtime = path.join(root, 'runtime.json');
    writeJson(child, { type: 'process', name: 'child', inherits: 'parent', layer_height: '0.2' });
    writeJson(machine, { type: 'machine', name: 'machine' });
    const parentFiles = { process: { parent } };

    const digestForSpeed = (speed) => {
        writeJson(parent, { type: 'process', name: 'parent', outer_wall_speed: speed });
        const resolved = resolveOrcaProfileInheritance(child, 'process', { parentFiles });
        writeJson(runtime, resolved);
        return calculateEffectiveProfileSha256({
            engine: 'orca',
            technology: 'FDM',
            runtimeConfigFile: runtime,
            orcaMachineConfigFile: machine
        });
    };
    assert.notEqual(digestForSpeed('40'), digestForSpeed('60'));
});

test('unknown, cyclic, and unresolved inheritance fails closed', (t) => {
    const root = tempRoot(t);
    const child = path.join(root, 'child.json');
    const parent = path.join(root, 'parent.json');
    writeJson(child, { type: 'process', name: 'child', inherits: 'missing' });
    assert.throws(() => resolveOrcaProfileInheritance(child, 'process', { parentFiles: { process: {} } }),
        /Unsupported Orca process parent/);

    writeJson(child, { type: 'process', name: 'child', inherits: 'parent' });
    writeJson(parent, { type: 'process', name: 'parent', inherits: 'parent' });
    assert.throws(() => resolveOrcaProfileInheritance(child, 'process', {
        parentFiles: { process: { parent } }
    }), /cycle/);

    writeJson(child, { type: 'process', name: 'child', inherits: 'parent' });
    assert.throws(() => calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', runtimeConfigFile: child,
        orcaMachineConfigFile: path.join(ORCA_ROOT, 'Bambu_P1S_0.4_nozzle.json')
    }), /Unresolved Orca profile inheritance/);
});

test('parent identity, role, depth, and file safety fail closed', (t) => {
    const root = tempRoot(t);
    const child = path.join(root, 'child.json');
    const parent = path.join(root, 'parent.json');
    writeJson(child, { type: 'process', name: 'child', inherits: 'parent' });
    writeJson(parent, { type: 'process', name: 'wrong-name' });
    assert.throws(() => resolveOrcaProfileInheritance(child, 'process', {
        parentFiles: { process: { parent } }
    }), /name does not match/);

    writeJson(parent, { type: 'machine', name: 'parent' });
    assert.throws(() => resolveOrcaProfileInheritance(child, 'process', {
        parentFiles: { process: { parent } }
    }), /type does not match/);

    const parentFiles = { process: {} };
    let previous = child;
    for (let index = 0; index < 9; index += 1) {
        const name = `parent-${index}`;
        const next = path.join(root, `${name}.json`);
        writeJson(previous, {
            type: 'process',
            name: index === 0 ? 'child' : `parent-${index - 1}`,
            inherits: name
        });
        parentFiles.process[name] = next;
        previous = next;
    }
    writeJson(previous, { type: 'process', name: 'parent-8' });
    assert.throws(() => resolveOrcaProfileInheritance(child, 'process', { parentFiles }),
        /exceeds the supported depth/);

    const target = path.join(root, 'regular-parent.json');
    const link = path.join(root, 'linked-parent.json');
    writeJson(target, { type: 'process', name: 'parent' });
    try {
        fs.symlinkSync(target, link, 'file');
    } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return;
        throw error;
    }
    writeJson(child, { type: 'process', name: 'child', inherits: 'parent' });
    assert.throws(() => resolveOrcaProfileInheritance(child, 'process', {
        parentFiles: { process: { parent: link } }
    }), /Unsafe bounded-read file/);
});

test('job snapshots passed downstream are flattened and immutable copies', async (t) => {
    const root = tempRoot(t);
    const workspace = {
        resolveScratchPath(name) { return path.join(root, name); },
        assertScratchContainedPath(candidate) {
            const resolved = path.resolve(candidate);
            assert.equal(path.dirname(resolved), root);
            return resolved;
        }
    };
    const snapshots = await snapshotProfileSelection('orca', {
        baseConfigFile: path.join(ORCA_ROOT, 'FDM_0.2mm.json'),
        orcaMachineConfigFile: path.join(ORCA_ROOT, 'Bambu_P1S_0.4_nozzle.json')
    }, workspace);
    for (const filePath of Object.values(snapshots)) {
        const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(Object.hasOwn(profile, 'inherits'), false);
        assert.equal(path.dirname(filePath), root);
    }
});
