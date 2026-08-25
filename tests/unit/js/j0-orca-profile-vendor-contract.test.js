'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const {
    PROFILES,
    verifyOrcaProfileVendor
} = require('../../../scripts/verify-orca-profile-vendor');

function copyTree(source, target) {
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
}

test('vendored Orca parents pass semantic identity and the image build enforces the gate', (t) => {
    const source = path.join(ROOT, 'configs', 'orca', 'upstream', 'Custom');
    assert.equal(verifyOrcaProfileVendor(source, source), 'ORCA_PROFILE_VENDOR_CONTRACT=PASS');

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'j0-orca-vendor-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const changed = path.join(temp, 'changed');
    copyTree(source, changed);
    const target = path.join(changed, 'process', 'fdm_process_common.json');
    const profile = JSON.parse(fs.readFileSync(target, 'utf8'));
    profile.outer_wall_speed = '999';
    fs.writeFileSync(target, `${JSON.stringify(profile)}\n`);
    assert.throws(() => verifyOrcaProfileVendor(source, changed), /semantic_mismatch/);

    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /verify-orca-profile-vendor\.js[\s\S]*\/app\/configs\/orca\/upstream\/Custom[\s\S]*\/opt\/orcaslicer\/resources\/profiles\/Custom/);
    assert.deepEqual(PROFILES.map(({ role, name }) => `${role}/${name}`).sort(), [
        'machine/fdm_machine_common',
        'process/fdm_process_common',
        'process/fdm_process_marlin_common'
    ]);
});
