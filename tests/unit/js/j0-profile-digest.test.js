'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { calculateEffectiveProfileSha256 } = require('../../../app/services/slice/profile-digest');
const { createRuntimeSlicerProfile } = require('../../../app/services/slice/profiles');

async function createFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'j0-profile-digest-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

test('Prusa effective digest is path, comment, key-order, and request-identity independent', async (t) => {
    const root = await createFixture(t);
    const first = path.join(root, 'scratch-a.ini');
    const second = path.join(root, 'unrelated-name.ini');
    await fs.writeFile(first, [
        '# generated in one request',
        '[print]',
        'layer_height = 0.2',
        'fill_density = 20%',
        'perimeters = 2',
        ''
    ].join('\n'));
    await fs.writeFile(second, [
        '; generated elsewhere',
        '[print]',
        'perimeters=2',
        'fill_density=20%',
        'layer_height=0.2',
        ''
    ].join('\r\n'));

    const firstDigest = calculateEffectiveProfileSha256({
        engine: 'prusa',
        technology: 'FDM',
        runtimeConfigFile: first,
        jobId: 'job-must-not-participate',
        processableFile: 'customer-model.stl',
        generatedAt: '2099-01-01T00:00:00Z'
    });
    const secondDigest = calculateEffectiveProfileSha256({
        engine: 'prusa',
        technology: 'FDM',
        runtimeConfigFile: second,
        jobId: 'different-job',
        processableFile: 'different-model.stl',
        generatedAt: '2100-01-01T00:00:00Z'
    });

    assert.match(firstDigest, /^[a-f0-9]{64}$/);
    assert.equal(firstDigest, secondDigest);
});
test('Prusa digest excludes request layer/infill but covers other profile settings and technology', async (t) => {
    const root = await createFixture(t);
    const baseline = path.join(root, 'baseline.ini');
    const requestOverridesChanged = path.join(root, 'request-overrides-changed.ini');
    const changed = path.join(root, 'changed.ini');
    await fs.writeFile(baseline, 'layer_height = 0.2\nfill_density = 20%\nperimeters = 2\n');
    await fs.writeFile(
        requestOverridesChanged,
        'layer_height = 0.3\nfill_density = 80%\nperimeters = 2\n'
    );
    await fs.writeFile(changed, 'layer_height = 0.2\nfill_density = 20%\nperimeters = 3\n');

    const digest = (runtimeConfigFile, technology = 'FDM') => calculateEffectiveProfileSha256({
        engine: 'prusa', technology, runtimeConfigFile
    });
    assert.equal(digest(baseline), digest(requestOverridesChanged));
    assert.notEqual(digest(baseline), digest(changed));
    assert.notEqual(digest(baseline, 'FDM'), digest(baseline, 'SLA'));
});

test('Prusa digest preserves case-sensitive section and key identity', async (t) => {
    const root = await createFixture(t);
    const lowercaseKey = path.join(root, 'lowercase.ini');
    const uppercaseKey = path.join(root, 'uppercase.ini');
    const lowercaseSection = path.join(root, 'lowercase-section.ini');
    const uppercaseSection = path.join(root, 'uppercase-section.ini');
    await fs.writeFile(lowercaseKey, 'perimeters = 2\n');
    await fs.writeFile(uppercaseKey, 'PERIMETERS = 2\n');
    await fs.writeFile(lowercaseSection, '[print]\nperimeters = 2\n');
    await fs.writeFile(uppercaseSection, '[PRINT]\nperimeters = 2\n');
    const digest = (runtimeConfigFile) => calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'FDM', runtimeConfigFile
    });
    assert.notEqual(digest(lowercaseKey), digest(uppercaseKey));
    assert.notEqual(digest(lowercaseSection), digest(uppercaseSection));
});

test('same selected profile path produces a new digest after profile-only changes', async (t) => {
    const root = await createFixture(t);
    const prusaProfile = path.join(root, 'selected.ini');
    const orcaProcess = path.join(root, 'selected.json');
    const orcaMachine = path.join(root, 'machine.json');
    await fs.writeFile(prusaProfile, 'perimeters = 2\n');
    await fs.writeFile(orcaProcess, JSON.stringify({ wall_loops: '2' }));
    await fs.writeFile(orcaMachine, JSON.stringify({ name: 'machine' }));

    const firstPrusa = calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'FDM', runtimeConfigFile: prusaProfile
    });
    const firstOrca = calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', runtimeConfigFile: orcaProcess,
        orcaMachineConfigFile: orcaMachine
    });
    await fs.writeFile(prusaProfile, 'perimeters = 3\n');
    await fs.writeFile(orcaProcess, JSON.stringify({ wall_loops: '3' }));

    assert.notEqual(firstPrusa, calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'FDM', runtimeConfigFile: prusaProfile
    }));
    assert.notEqual(firstOrca, calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', runtimeConfigFile: orcaProcess,
        orcaMachineConfigFile: orcaMachine
    }));
});

test('Prusa profile identity and runtime generation reject exact duplicate keys', async (t) => {
    const root = await createFixture(t);
    const scratch = path.join(root, 'scratch');
    const base = path.join(root, 'base.ini');
    await fs.mkdir(scratch);
    await fs.writeFile(base, [
        'layer_height = 0.1',
        'fill_density = 10%',
        'perimeters = 2',
        'layer_height = 0.3',
        'fill_density = 90%',
        ''
    ].join('\n'));
    const workspace = {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) { return path.resolve(candidate); }
    };
    await assert.rejects(
        createRuntimeSlicerProfile('prusa', base, 'FDM', 0.2, '20%', workspace),
        /Duplicate slicer profile key/
    );
    assert.throws(
        () => calculateEffectiveProfileSha256({
            engine: 'prusa', technology: 'FDM', runtimeConfigFile: base
        }),
        /Duplicate slicer profile key/
    );
});
