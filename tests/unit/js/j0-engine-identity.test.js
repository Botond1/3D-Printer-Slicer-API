'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_VERSION_OUTPUT_BYTES,
    VERSION_QUERY_ARGS,
    getSlicerEngineVersion,
    initializeSlicerEngineVersions,
    parseEngineVersionOutput,
    resolveSlicerEngineVersion
} = require('../../../app/services/slice/engine-version');
const { buildSlicerCommandArgs, resolveSlicerInvocationPolicy } = require('../../../app/services/slice/engine');
const { requireEngineVersion } = require('../../../app/services/slice/response');

test('actual native version output is parsed for both pinned engine families', () => {
    assert.equal(parseEngineVersionOutput('prusa', {
        stdout: 'PrusaSlicer-2.8.1+linux-x64-GTK3\nUsage: prusa-slicer [ OPTIONS ]\n --help Show help\n'
    }), '2.8.1+linux-x64-GTK3');
    assert.equal(parseEngineVersionOutput('orca', {
        stderr: '[warning] Current OrcaSlicer Version 02.03.01.00\n' +
            'Usage: orca-slicer [ OPTIONS ]\nOPTIONS:\n --help Show help\n'
    }), '02.03.01.00');
});

test('version resolution executes the selected binary once and caches exact output', async () => {
    const calls = [];
    const cache = new Map();
    const runner = async (...args) => {
        calls.push(args);
        return { stdout: 'OrcaSlicer-2.3.1\nUsage: orca-slicer [ OPTIONS ]\nOPTIONS:\n --help\n', stderr: '' };
    };
    assert.equal(await resolveSlicerEngineVersion('orca', { runner, cache }), '2.3.1');
    assert.equal(await resolveSlicerEngineVersion('orca', { runner, cache }), '2.3.1');
    assert.deepEqual(calls, [['orca-slicer', ['--help']]]);
    assert.deepEqual(VERSION_QUERY_ARGS.prusa, ['--help']);
    assert.deepEqual(VERSION_QUERY_ARGS.orca, ['--help']);
});

test('failed version resolution is evicted and malformed output fails closed', async () => {
    let attempt = 0;
    const cache = new Map();
    const runner = async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('transient');
        return { stdout: 'OrcaSlicer-2.3.1\nUsage: orca-slicer [ OPTIONS ]\nOPTIONS:\n --help\n' };
    };
    await assert.rejects(resolveSlicerEngineVersion('orca', { runner, cache }), /transient/);
    assert.equal(await resolveSlicerEngineVersion('orca', { runner, cache }), '2.3.1');
    assert.equal(attempt, 2);
    assert.throws(() => parseEngineVersionOutput('prusa', { stdout: '2.8.1' }), /could not be verified/);
    assert.throws(() => parseEngineVersionOutput('orca', {
        stdout: `OrcaSlicer-2.3.1\nUsage: orca-slicer OPTIONS: --help${'x'.repeat(MAX_VERSION_OUTPUT_BYTES)}`
    }), /bounded envelope/);
    assert.throws(() => parseEngineVersionOutput('orca', {
        stdout: 'OrcaSlicer-2.3.1\nOrcaSlicer-2.3.2\nUsage: orca-slicer\nOPTIONS:\n--help\n'
    }), /could not be verified/);
});

test('startup initialization is atomic and request lookup launches no child process', async () => {
    const cache = new Map();
    const initialized = new Map([['sentinel', 'unchanged']]);
    const calls = [];
    const runner = async (executable, args) => {
        calls.push([executable, args]);
        return executable === 'prusa-slicer'
            ? { stdout: 'PrusaSlicer-2.8.1\nUsage: prusa-slicer\n --help\n' }
            : { stdout: 'OrcaSlicer-2.3.1:\nUsage: orca-slicer\nOPTIONS:\n --help\n' };
    };
    assert.deepEqual(await initializeSlicerEngineVersions({ runner, cache, initialized }), {
        prusa: '2.8.1', orca: '2.3.1'
    });
    assert.equal(getSlicerEngineVersion('prusa', { initialized }), '2.8.1');
    assert.equal(getSlicerEngineVersion('orca', { initialized }), '2.3.1');
    assert.equal(calls.length, 2);

    const failedInitialized = new Map([['sentinel', 'unchanged']]);
    await assert.rejects(initializeSlicerEngineVersions({
        cache: new Map(),
        initialized: failedInitialized,
        runner: async (executable) => {
            if (executable === 'orca-slicer') throw new Error('native failure');
            return { stdout: 'PrusaSlicer-2.8.1\nUsage: prusa-slicer\n --help\n' };
        }
    }), (error) => error.code === 'STARTUP_SLICER_VERSION_FAILED' &&
        error.cause?.message === 'native failure');
    assert.deepEqual([...failedInitialized], [['sentinel', 'unchanged']]);
    assert.throws(() => getSlicerEngineVersion('orca', { initialized: failedInitialized }),
        /not verified during startup/);
});

test('Orca native policy places but never reorients the transformed and bounds-checked model', () => {
    assert.deepEqual(resolveSlicerInvocationPolicy('orca', 'FDM'), {
        arrange: '1', orient: '0', slice: '0', settingsPrecedence: ['machine', 'process']
    });
    const args = buildSlicerCommandArgs('FDM', 'process.json', 'out/result.gcode', '20%', 'orca', 'machine.json');
    const arrangeIndex = args.indexOf('--arrange');
    const orientIndex = args.indexOf('--orient');
    assert.ok(arrangeIndex >= 0);
    assert.ok(orientIndex >= 0);
    assert.equal(args[arrangeIndex + 1], '1');
    assert.equal(args[orientIndex + 1], '0');
});

test('success contract accepts only a verified machine-readable engine version', () => {
    assert.equal(requireEngineVersion('2.8.1+linux-x64-GTK3'), '2.8.1+linux-x64-GTK3');
    assert.equal(requireEngineVersion('02.03.01.00'), '02.03.01.00');
    assert.throws(() => requireEngineVersion('unknown'), /unavailable/);
});
