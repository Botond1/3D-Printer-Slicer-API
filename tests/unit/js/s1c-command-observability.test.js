'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandRunner } = require('../../../app/services/slice/command');
const { handleProcessingError } = require('../../../app/services/slice/errors');

test('22 native telemetry remains bounded and never serializes output or child environment', async () => {
    const logs = [];
    const originalInfo = console.info;
    console.info = (value) => logs.push(String(value));
    try {
        const runner = createCommandRunner({
            debug: true, timeoutMs: 1000, createChildEnvironment: () => ({ PATH: 'only-path' }),
            setTimeout: () => ({ unref() {} }), clearTimeout() {},
            execFile(_exe, _args, options, callback) {
                assert.deepEqual(options.env, { PATH: 'only-path' });
                callback(null, 'x'.repeat(20_000), '');
                return { pid: 12345 };
            }
        });
        await runner('inert', []);
    } finally {
        console.info = originalInfo;
    }
    assert.equal(logs.length, 2);
    assert.deepEqual(logs.map((line) => JSON.parse(line).event),
        ['native.started', 'native.completed']);
    assert.ok(logs.every((line) => line.length < 20_000));
    assert.doesNotMatch(logs.join('\n'), /x{16}|only-path|ADMIN_API_KEY|SECRET_MARKER/);
});

test('21 environment and native output never enter the public response or normal logs', async () => {
    const captured = [];
    const originalError = console.error;
    console.error = (value) => captured.push(String(value));
    try {
        const marker = ['SECRET', 'MARKER'].join('_');
        const runner = createCommandRunner({
            debug: false, timeoutMs: 1000, createChildEnvironment: () => ({ [marker]: String(61) }),
            setTimeout: () => ({ unref() {} }), clearTimeout() {},
            execFile(_exe, _args, _options, callback) {
                callback(new Error('native failure'), '', `${marker}=61`);
                return { pid: 12346 };
            }
        });
        let commandError;
        try { await runner('inert', []); } catch (error) { commandError = error; }
        const state = {};
        const response = {
            status(value) { state.status = value; return this; },
            json(value) { state.body = value; return this; }
        };
        handleProcessingError(commandError, response, null, null, () => '.stl');
        assert.equal(state.status, 500);
        assert.equal(state.body.errorCode, 'INTERNAL_PROCESSING_ERROR');
        assert.doesNotMatch(JSON.stringify(state.body), new RegExp(marker));
        assert.doesNotMatch(captured.join('\n'), new RegExp(marker));
    } finally {
        console.error = originalError;
    }
});
