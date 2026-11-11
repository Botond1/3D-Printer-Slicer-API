'use strict';

/**
 * `app/config/constants.js` and `app/config/resource-policy.js` are read by
 * hashed processing code (§4.11) and are frozen in 3.9.0: their exported
 * values must equal the 3.8.3 capture. A child process loads them so the
 * test sees a fresh module with `PORT` unset, exactly as the capture did.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden/measurement-config-3.8.3.json'), 'utf8'));

const LOADER = `
'use strict';
const path = require('node:path');
const root = process.argv[1];
const constants = require(path.join(root, 'app/config/constants.js'));
const policy = require(path.join(root, 'app/config/resource-policy.js'));
process.stdout.write(JSON.stringify({
    constants: JSON.parse(JSON.stringify(constants)),
    resolveResourcePolicy_empty_env: JSON.parse(JSON.stringify(policy.resolveResourcePolicy({}))),
    RESOURCE_DEFINITIONS: JSON.parse(JSON.stringify(policy.RESOURCE_DEFINITIONS))
}));
`;

function loadCurrent() {
    const env = { ...process.env };
    delete env.PORT;
    const result = spawnSync(process.execPath, ['-e', LOADER, ROOT], { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('the measurement configuration golden is a 3.8.3 capture with the three sections', () => {
    assert.equal(GOLDEN.captured_from.release, '3.8.3');
    for (const key of ['constants', 'resolveResourcePolicy_empty_env', 'RESOURCE_DEFINITIONS']) {
        assert.equal(typeof GOLDEN[key], 'object', key);
    }
    assert.equal(GOLDEN.constants.BAMBU_DEFAULT_PROFILES_ROOT.length > 0, true);
});

test('constants.js and resource-policy.js export exactly the 3.8.3 values, key order included', () => {
    const current = loadCurrent();
    for (const key of ['constants', 'resolveResourcePolicy_empty_env', 'RESOURCE_DEFINITIONS']) {
        assert.equal(JSON.stringify(current[key]), JSON.stringify(GOLDEN[key]), `${key} differs from the 3.8.3 capture`);
    }
});
