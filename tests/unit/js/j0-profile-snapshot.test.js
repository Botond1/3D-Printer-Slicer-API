'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { snapshotProfileSelection } = require('../../../app/services/slice/profile-snapshot');

async function createFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j0-profile-digest-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

test('resolved selected profiles are snapshotted before later source replacement', async (t) => {
    const root = await createFixture(t);
    const scratch = path.join(root, 'scratch');
    const processProfile = path.join(root, 'process.json');
    const machineProfile = path.join(root, 'machine.json');
    const filamentProfile = path.join(root, 'filament.json');
    const processValue = { type: 'process', name: 'process', walls: '2' };
    const machineValue = { type: 'machine', name: 'machine', printable_height: '250' };
    const filamentValue = {
        type: 'filament', name: 'filament', inherits: 'fdm_filament_pla',
        filament_type: ['PLA'], filament_diameter: ['1.75'], filament_density: ['1.24']
    };
    const processBytes = Buffer.from(`${JSON.stringify(processValue)}\n`);
    const machineBytes = Buffer.from(`${JSON.stringify(machineValue)}\n`);
    await fs.mkdir(scratch);
    await fs.writeFile(processProfile, processBytes);
    await fs.writeFile(machineProfile, machineBytes);
    await fs.writeFile(filamentProfile, `${JSON.stringify(filamentValue)}\n`);
    const workspace = {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) {
            const resolved = path.resolve(candidate);
            const relative = path.relative(scratch, resolved);
            assert.equal(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), false);
            return resolved;
        }
    };

    const snapshots = await snapshotProfileSelection('orca', {
        baseConfigFile: processProfile,
        orcaMachineConfigFile: machineProfile,
        orcaFilamentConfigFile: filamentProfile
    }, workspace);
    await fs.writeFile(processProfile, '{"type":"process","name":"replacement","walls":"9"}\n');
    await fs.writeFile(machineProfile, '{"type":"machine","name":"replacement","printable_height":"999"}\n');
    await fs.writeFile(filamentProfile, '{"type":"filament","name":"replacement"}\n');

    assert.deepEqual(JSON.parse(await fs.readFile(snapshots.baseConfigFile, 'utf8')), processValue);
    assert.deepEqual(JSON.parse(await fs.readFile(snapshots.orcaMachineConfigFile, 'utf8')), machineValue);
    assert.deepEqual(JSON.parse(await fs.readFile(snapshots.orcaFilamentConfigFile, 'utf8')), filamentValue);
    assert.match(path.basename(snapshots.baseConfigFile), /^orca-base-profile-[a-f0-9]{16}\.json$/);
    assert.match(path.basename(snapshots.orcaMachineConfigFile), /^orca-machine-profile-[a-f0-9]{16}\.json$/);
    assert.match(path.basename(snapshots.orcaFilamentConfigFile), /^orca-filament-profile-[a-f0-9]{16}\.json$/);
    if (process.platform !== 'win32') {
        assert.equal((await fs.stat(snapshots.baseConfigFile)).mode & 0o777, 0o600);
        assert.equal((await fs.stat(snapshots.orcaMachineConfigFile)).mode & 0o777, 0o600);
        assert.equal((await fs.stat(snapshots.orcaFilamentConfigFile)).mode & 0o777, 0o600);
    }
});

test('profile snapshot refuses non-regular sources', async (t) => {
    const root = await createFixture(t);
    const scratch = path.join(root, 'scratch');
    const directory = path.join(root, 'not-a-profile.ini');
    await fs.mkdir(scratch);
    await fs.mkdir(directory);
    const workspace = {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) { return path.resolve(candidate); }
    };
    await assert.rejects(
        snapshotProfileSelection('prusa', {
            baseConfigFile: directory,
            orcaMachineConfigFile: null
        }, workspace),
        /Unsafe bounded-read file/
    );
});

test('profile snapshot rejects a symlinked parent path', async (t) => {
    const root = await createFixture(t);
    const realDirectory = path.join(root, 'real');
    const linkedDirectory = path.join(root, 'linked');
    const scratch = path.join(root, 'scratch');
    await fs.mkdir(realDirectory);
    await fs.mkdir(scratch);
    await fs.writeFile(path.join(realDirectory, 'profile.ini'), 'perimeters = 2\n');
    try {
        await fs.symlink(realDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
            t.skip('This host cannot create the symlink fixture.');
            return;
        }
        throw error;
    }
    const workspace = {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) { return path.resolve(candidate); }
    };
    await assert.rejects(
        snapshotProfileSelection('prusa', {
            baseConfigFile: path.join(linkedDirectory, 'profile.ini'),
            orcaMachineConfigFile: null
        }, workspace),
        /Unsafe bounded-read file/
    );
});

test('profile snapshot growth race reads only the validated size plus one byte', async (t) => {
    const root = await createFixture(t);
    const scratch = path.join(root, 'scratch');
    const profile = path.join(root, 'profile.ini');
    const original = Buffer.from('walls=2\n');
    await fs.mkdir(scratch);
    await fs.writeFile(profile, original);
    const workspace = {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) { return path.resolve(candidate); }
    };
    const originalReadSync = fsSync.readSync;
    let requestedLength = null;
    let grown = false;
    t.mock.method(fsSync, 'readSync', (...args) => {
        requestedLength = args[3];
        if (!grown) {
            grown = true;
            fsSync.appendFileSync(profile, Buffer.alloc(2 * 1024 * 1024, 0x78));
        }
        return originalReadSync(...args);
    });

    await assert.rejects(
        snapshotProfileSelection('prusa', {
            baseConfigFile: profile,
            orcaMachineConfigFile: null
        }, workspace),
        /File changed during bounded read/
    );
    assert.equal(requestedLength, original.length + 1);
});
