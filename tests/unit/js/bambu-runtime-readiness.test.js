'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.PYTHON_EXECUTABLE ||= process.execPath;
const { createBambuReadiness } = require('../../../app/services/slice/bambu-readiness');

test('Bambu readiness requires verified common imports/build, independently reports absent optional engines', async () => {
    let altered = false;
    const runtime = createBambuReadiness({ runner: async () => ({ stdout: JSON.stringify(Array(8).fill(__filename)) }),
        assertBuild() { if (altered) throw Error('changed'); } });
    assert.equal(runtime.getStatus().commonDependenciesReady, false);
    await runtime.initialize({ bambu: '02.08.02.61', prusa: null, orca: null });
    assert.equal(runtime.isEngineAvailable('bambu'), true);
    assert.equal(runtime.isEngineAvailable('orca'), false);
    assert.equal(runtime.getStatus().engines.prusa.required_for_bambu, false);
    altered = true;
    assert.equal(runtime.isEngineAvailable('bambu'), false);
    altered = false;
    assert.equal(runtime.isEngineAvailable('bambu'), true);
});

test('failed dependency import does not establish readiness', async () => {
    const runtime = createBambuReadiness({ runner: async () => { throw Error('missing import'); }, assertBuild() {} });
    await assert.rejects(runtime.initialize({ bambu: '02.08.02.61' }));
    assert.equal(runtime.getStatus().commonDependenciesReady, false);
});
