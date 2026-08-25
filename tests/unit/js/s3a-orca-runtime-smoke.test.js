'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(ROOT, 'scripts/i2-orca-runtime-smoke.js');
const smoke = require(HELPER_PATH);

const ID = `sha256:${'b'.repeat(64)}`;

test('Orca smoke accepts only positive dynamic identity and an immutable image ID', () => {
    assert.doesNotThrow(() => new Function(smoke.ORCA_CONTAINER_SCRIPT));
    assert.equal(smoke.parsePositiveEnvironmentId('1001', 'uid'), 1001);
    for (const value of ['', '0', '-1', '1\n2', ' 1001', '1001 ']) {
        assert.throws(() => smoke.parsePositiveEnvironmentId(value, 'uid'));
    }
    const args = smoke.buildCreateArgs('orca-probe', ID, '1001', '1002');
    assert.deepEqual(args.slice(0, 4), ['container', 'create', '--pull', 'never']);
    assert.deepEqual(args.slice(-4), ['/usr/bin/node', ID, '-e', smoke.ORCA_CONTAINER_SCRIPT]);
    for (const token of ['--network', 'none', '--cap-drop', 'ALL', '--security-opt',
        'no-new-privileges', '--read-only', '--pids-limit', '256']) assert.ok(args.includes(token));
    assert.ok(args.includes('/tmp:rw,nosuid,nodev,noexec,size=256m,uid=1001,gid=1002,mode=0700'));
    assert.ok(args.includes(`${smoke.IMAGE_LABEL}=${ID}`));
    assert.throws(() => smoke.buildCreateArgs('orca-probe', 'local/image:latest', '1001', '1002'));
});

test('bounded Orca failure diagnostics accept only the exact sanitized schema', () => {
    const payload = {
        phase: 'slice',
        status: null,
        signal: null,
        error_code: 'ENOBUFS',
        stdout_bytes: 65536,
        stderr_bytes: 1024,
        stdout_tail: 'bounded stdout',
        stderr_tail: 'bounded stderr'
    };
    assert.deepEqual(smoke.parseFailureDiagnostic(`${JSON.stringify(payload)}\n`), payload);
    assert.equal(smoke.parseFailureDiagnostic(JSON.stringify({ ...payload, unexpected: true })), null);
    assert.equal(smoke.parseFailureDiagnostic(JSON.stringify({ ...payload, status: 999 })), null);
    assert.equal(smoke.parseFailureDiagnostic('not-json\n'), null);
    assert.equal(smoke.parseFailureDiagnostic('x'.repeat(smoke.MAX_DIAGNOSTIC_BYTES + 1)), null);
});

test('extrusion proof requires a positive G1 value after a model-layer marker', () => {
    for (const accepted of [
        ';BEFORE_LAYER_CHANGE\nG1 X1 E0.0001',
        ';BEFORE_LAYER_CHANGE\r\nG1 E.5 ; extrusion',
        ';BEFORE_LAYER_CHANGE\nG1 E2\nG1 E-1'
    ]) {
        assert.equal(smoke.hasPositiveExtrusionMove(accepted), true, accepted);
    }
    for (const rejected of ['', 'G1 E1', ';BEFORE_LAYER_CHANGE\nG1 X1',
        ';BEFORE_LAYER_CHANGE\nG1 E0', ';BEFORE_LAYER_CHANGE\nG1 E-0.001',
        ';BEFORE_LAYER_CHANGE\nG0 E1']) {
        assert.equal(smoke.hasPositiveExtrusionMove(rejected), false, rejected);
    }
});

test('embedded Orca smoke phases remain cohesive and at most 60 physical lines', () => {
    const phaseNames = ['prepareSmokeDirectories', 'assertHelpContract', 'createSmokeWorkspace',
        'prepareSliceInvocation', 'runSliceProbe', 'assertGeneratedGcode', 'executeSmoke'];
    const lines = smoke.ORCA_CONTAINER_SCRIPT.split('\n');
    for (const name of phaseNames) {
        const start = lines.findIndex((line) =>
            new RegExp(`^(?:async )?function ${name}\\(`).test(line));
        assert.notEqual(start, -1, name);
        const next = lines.findIndex((line, index) =>
            index > start && /^(?:async )?function [A-Za-z]/.test(line));
        const end = next === -1 ? lines.length : next;
        assert.ok(end - start <= 60, `${name} spans ${end - start} lines`);
    }
});

test('synthetic asymmetric prism is closed, consistently wound, and has exact nonzero normals', () => {
    assert.equal(smoke.SYNTHETIC_TRIANGLES.length, 12);
    assert.equal(smoke.SYNTHETIC_STL, smoke.buildSyntheticStl());
    const edges = new Map();
    for (const { normal, vertices } of smoke.SYNTHETIC_TRIANGLES) {
        assert.equal(Math.hypot(...normal), 1);
        const [a, b, c] = vertices;
        const ab = b.map((value, index) => value - a[index]);
        const ac = c.map((value, index) => value - a[index]);
        const cross = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0]
        ];
        assert.ok(cross.reduce((sum, value, index) => sum + value * normal[index], 0) > 0);
        for (const [from, to] of [[a, b], [b, c], [c, a]]) {
            const directed = `${from.join(',')}>${to.join(',')}`;
            const reverse = `${to.join(',')}>${from.join(',')}`;
            if (edges.has(reverse)) edges.set(reverse, edges.get(reverse) + 1);
            else edges.set(directed, 1);
        }
    }
    assert.equal(edges.size, 18);
    assert.ok([...edges.values()].every((count) => count === 2));
    const extents = (triangles) => {
        const vertices = triangles.flatMap((triangle) => triangle.vertices);
        return [0, 1, 2].map((axis) =>
            Math.max(...vertices.map((vertex) => vertex[axis])) -
            Math.min(...vertices.map((vertex) => vertex[axis])));
    };
    assert.deepEqual(extents(smoke.BASE_SYNTHETIC_TRIANGLES), [10, 20, 30]);
    assert.deepEqual(extents(smoke.SYNTHETIC_TRIANGLES), [10, 30, 20]);
    assert.deepEqual(
        smoke.rotateTrianglesX90(smoke.BASE_SYNTHETIC_TRIANGLES),
        smoke.SYNTHETIC_TRIANGLES
    );
    assert.doesNotMatch(smoke.SYNTHETIC_STL, /facet normal 0 0 0/);
});

test('Orca smoke result is exact, bounded, and independently classified', () => {
    assert.doesNotThrow(() => smoke.parseSmokeResult({
        status: 0, stdout: smoke.SUCCESS_MARKER, stderr: ''
    }));
    for (const [status, message] of [[20, 'orca_help_execution_failure'],
        [21, 'orca_help_contract_failure'], [29, 'orca_invocation_policy_failure'],
        [30, 'orca_slice_execution_failure'],
        [31, 'orca_slice_output_count_failure'], [32, 'orca_slice_output_contract_failure'],
        [33, 'orca_slice_content_failure'], [34, 'orca_extrusion_mode_failure'],
        [39, 'orca_smoke_internal_failure'], [99, 'orca_smoke_failure']]) {
        assert.throws(() => smoke.parseSmokeResult({ status, stdout: '', stderr: '' }),
            new RegExp(message));
    }
    assert.throws(() => smoke.parseSmokeResult({ status: 0, stdout: 'PASS\n', stderr: '' }),
        /orca_smoke_output_failure/);
    assert.throws(() => smoke.parseSmokeResult({
        status: 0, stdout: smoke.SUCCESS_MARKER, stderr: 'warning'
    }), /orca_smoke_output_failure/);
});

function inspectRecord(containerId, imageId = ID, validation = 'true', expected = imageId) {
    return {
        status: 0,
        stdout: `${JSON.stringify(containerId)}|${JSON.stringify(imageId)}|` +
            `${JSON.stringify(validation)}|${JSON.stringify(expected)}\n`,
        stderr: ''
    };
}

function absent(reference) {
    return { status: 1, stdout: '', stderr: `Error: No such object: ${reference}\n` };
}

test('ownership parsing rejects foreign labels and exact-ID cleanup never removes by name', () => {
    const containerId = 'c'.repeat(64);
    const owned = smoke.parseInspectResult(inspectRecord(containerId), containerId);
    assert.doesNotThrow(() => smoke.assertOwned(owned, containerId, ID));
    for (const record of [
        inspectRecord(containerId, ID, 'false', ID),
        inspectRecord(containerId, ID, 'true', `sha256:${'d'.repeat(64)}`),
        inspectRecord(containerId, `sha256:${'d'.repeat(64)}`, 'true', ID)
    ]) {
        assert.throws(() => smoke.assertOwned(
            smoke.parseInspectResult(record, containerId), containerId, ID),
        /container_ownership_failure/);
    }
    assert.deepEqual(smoke.buildRemoveArgs(containerId),
        ['container', 'rm', '--force', containerId]);
    assert.throws(() => smoke.buildRemoveArgs('orca-probe'));
});

test('name reuse and foreign ownership are fail-closed without deleting the foreign container', (t) => {
    const containerId = 'c'.repeat(64);
    const outputPath = path.join(os.tmpdir(), `.orca-smoke-output-${process.pid}-${Date.now()}`);
    fs.writeFileSync(outputPath, '');
    t.after(() => fs.rmSync(outputPath, { force: true }));
    const env = {
        I2_ORCA_PROBE_NAME: 'orca-probe',
        EXPECTED_IMAGE_ID: ID,
        SERVICE_UID: '1001',
        SERVICE_GID: '1002',
        GITHUB_OUTPUT: outputPath
    };

    const runScenario = (responses) => {
        const calls = [];
        const docker = (args) => {
            calls.push(args);
            const response = responses.shift();
            assert.ok(response, `unexpected docker call ${args.join(' ')}`);
            return typeof response === 'function' ? response(args) : response;
        };
        assert.throws(() => smoke.runSmoke(env, docker));
        assert.equal(responses.length, 0);
        return calls;
    };

    const foreignCleanupCalls = runScenario([
        absent('orca-probe'),
        { status: 0, stdout: `${containerId}\n`, stderr: '' },
        inspectRecord(containerId),
        { status: 0, stdout: smoke.SUCCESS_MARKER, stderr: '' },
        inspectRecord(containerId, ID, 'false', ID),
        absent('orca-probe')
    ]);
    assert.equal(foreignCleanupCalls.filter((args) => args[1] === 'rm').length, 0);

    const nameReuseCalls = runScenario([
        absent('orca-probe'),
        { status: 0, stdout: `${containerId}\n`, stderr: '' },
        inspectRecord(containerId),
        { status: 0, stdout: smoke.SUCCESS_MARKER, stderr: '' },
        inspectRecord(containerId),
        { status: 0, stdout: `${containerId}\n`, stderr: '' },
        absent(containerId),
        inspectRecord('d'.repeat(64), ID, 'false', ID)
    ]);
    const removals = nameReuseCalls.filter((args) => args[1] === 'rm');
    assert.equal(removals.length, 1);
    assert.equal(removals[0].at(-1), containerId);
});
