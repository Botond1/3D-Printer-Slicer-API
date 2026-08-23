'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('process-tree settlement polling keeps an otherwise idle host alive', () => {
    const processTreePath = require.resolve('../../../app/services/slice/process-tree');
    const script = `
        const { createProcessTreeTerminator } = require(${JSON.stringify(processTreePath)});
        const pid = 49117;
        let probes = 0;
        const terminator = createProcessTreeTerminator({ pid }, {
            platform: 'linux', ownPid: process.pid, graceMs: 50, pollMs: 5,
            kill(target, signal) {
                if (target !== -pid) throw new Error('unexpected target');
                if (signal === 0 && ++probes >= 2) {
                    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
                }
            }
        });
        terminator.terminate().then(() => process.stdout.write('SETTLED:2'));
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        timeout: 2000,
        windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'SETTLED:2');
});
