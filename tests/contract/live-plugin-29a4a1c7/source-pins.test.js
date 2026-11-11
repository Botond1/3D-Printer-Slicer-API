'use strict';

/**
 * SOURCE-PINS.json names the PHP files the port follows and their sha256 at
 * 29a4a1c7. With `R3D_PLUGIN_REPO` pointing at a plugin checkout that holds
 * 29a4a1c7 the test recomputes every pin from the Git blobs; the pin set is
 * always checked for shape, so a re-pin that drops a file fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const PINS = require('./SOURCE-PINS.json');

const EXPECTED_FILES = ['Slicer/TechnicalReceipt.php', 'Slicer/AsyncSliceAcceptance.php', 'Slicer/AsyncSliceStatus.php',
    'Slicer/HttpSlicerClient.php', 'Slicer/SlicerContract.php', 'Pricing/IdentitySignature.php', 'Quote/QuoteService.php'];

test('the pins name the live build and every ported file once, with a sha256', () => {
    assert.equal(PINS.build, '29a4a1c7');
    assert.match(PINS.commit, /^29a4a1c7[0-9a-f]{32}$/);
    assert.deepEqual(Object.keys(PINS.files).sort(), [...EXPECTED_FILES].sort());
    for (const [file, pin] of Object.entries(PINS.files)) {
        assert.match(pin.sha256, /^[a-f0-9]{64}$/, file);
        assert.ok(Array.isArray(pin.ported) && pin.ported.length > 0, file);
    }
});

test('the pins equal the plugin repository\'s blobs at 29a4a1c7 (when R3D_PLUGIN_REPO is set)', (t) => {
    const repository = process.env.R3D_PLUGIN_REPO;
    if (!repository) {
        t.skip('R3D_PLUGIN_REPO is not set (the plugin repository is not part of this CI)');
        return;
    }
    for (const [file, pin] of Object.entries(PINS.files)) {
        const blob = spawnSync('git', ['cat-file', 'blob', `${PINS.commit}:${PINS.root}/${file}`], { cwd: path.resolve(repository), maxBuffer: 64 * 1024 * 1024 });
        assert.equal(blob.status, 0, `${file}: ${String(blob.stderr)}`);
        assert.equal(createHash('sha256').update(blob.stdout).digest('hex'), pin.sha256, file);
    }
});
