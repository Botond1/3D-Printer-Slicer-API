'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(ROOT, 'scripts/i8-runtime-state-proof.js');
const helper = require(HELPER_PATH);

const CONTAINER_ID = 'c'.repeat(64);
const IMAGE_ID = `sha256:${'b'.repeat(64)}`;

function stateLine(overrides = {}) {
    const state = {
        id: CONTAINER_ID,
        image: IMAGE_ID,
        status: 'running',
        running: true,
        paused: false,
        restarting: false,
        dead: false,
        pid: 4321,
        health: 'healthy',
        exitCode: 0,
        oomKilled: false,
        stateError: '',
        ...overrides
    };
    return [
        state.id, state.image, state.status, state.running, state.paused,
        state.restarting, state.dead, state.pid, state.health, state.exitCode,
        state.oomKilled, state.stateError
    ].map(JSON.stringify).join('\t') + '\n';
}

function environment(overrides = {}) {
    return {
        CONTAINER_NAME: 'i8-digest-30545194754-1',
        EXPECTED_CONTAINER_ID: CONTAINER_ID,
        EXPECTED_IMAGE_ID: IMAGE_ID,
        SERVICE_UID: '999',
        SERVICE_GID: '999',
        GITHUB_OUTPUT: 'fixture-output',
        ...overrides
    };
}

function fixture(states, psResult = { status: 0, stdout: ' 999 999\n', stderr: '' }) {
    const calls = [];
    const outputs = [];
    let index = 0;
    return {
        calls,
        outputs,
        dependencies: {
            inspect(name) {
                calls.push(`inspect:${name}`);
                const current = states[Math.min(index, states.length - 1)];
                index += 1;
                return current;
            },
            ps(pid) {
                calls.push(`ps:${pid}`);
                return psResult;
            },
            sleep(milliseconds) {
                calls.push(`sleep:${milliseconds}`);
            },
            appendOutputs(outputPath, identity) {
                calls.push(`output:${outputPath}`);
                outputs.push(identity);
            }
        }
    };
}

function expectFailure(callback, code) {
    assert.throws(callback, (error) => error instanceof helper.RuntimeProofError
        && error.code === code);
}

test('PID zero transitions to a repeated positive coherent state before host ps runs', () => {
    const fake = fixture([
        stateLine({ pid: 0, health: 'starting' }),
        stateLine({ pid: 4321, health: 'healthy' }),
        stateLine({ pid: 4321, health: 'healthy' }),
        stateLine({ pid: 4321, health: 'healthy' })
    ]);
    const result = helper.proveRuntime(environment(), fake.dependencies);
    assert.equal(result.pid, 4321);
    assert.deepEqual(fake.outputs, [{ uid: 999, gid: 999 }]);
    assert.deepEqual(fake.calls, [
        'inspect:i8-digest-30545194754-1',
        `sleep:${helper.WAIT_MS}`,
        'inspect:i8-digest-30545194754-1',
        `sleep:${helper.WAIT_MS}`,
        'inspect:i8-digest-30545194754-1',
        'ps:4321',
        'inspect:i8-digest-30545194754-1',
        'output:fixture-output'
    ]);
});

test('malformed, empty, negative, and identity-mismatched state fails closed', async (t) => {
    const cases = [
        ['empty PID', stateLine({ pid: '' }), 'runtime_pid_malformed'],
        ['negative PID', stateLine({ pid: -1 }), 'runtime_pid_malformed'],
        ['text PID', stateLine({ pid: '4321' }), 'runtime_pid_malformed'],
        ['wrong container', stateLine({ id: 'd'.repeat(64) }), 'runtime_container_id_mismatch'],
        ['wrong image', stateLine({ image: `sha256:${'d'.repeat(64)}` }), 'runtime_image_id_mismatch']
    ];
    for (const [name, state, code] of cases) await t.test(name, () => {
        const fake = fixture([state, state]);
        expectFailure(() => helper.proveRuntime(environment(), fake.dependencies), code);
        assert.ok(!fake.calls.some((call) => call.startsWith('ps:')));
    });
});

test('non-running, unhealthy, OOM, and state-error paths fail immediately', async (t) => {
    const cases = [
        ['non-running status', { status: 'exited', running: false, pid: 0 }, 'runtime_exited'],
        ['exited', { running: false, pid: 0 }, 'runtime_exited'],
        ['paused flag', { paused: true }, 'runtime_paused'],
        ['paused status', { status: 'paused' }, 'runtime_paused'],
        ['restarting flag', { restarting: true }, 'runtime_restarting'],
        ['restarting status', { status: 'restarting' }, 'runtime_restarting'],
        ['dead flag', { dead: true }, 'runtime_dead'],
        ['dead status', { status: 'dead', running: false, pid: 0 }, 'runtime_dead'],
        ['unhealthy', { health: 'unhealthy' }, 'runtime_unhealthy'],
        ['missing health', { health: 'missing' }, 'runtime_health_missing'],
        ['OOM', { oomKilled: true }, 'runtime_oom_killed'],
        ['state error', { stateError: 'failed to start' }, 'runtime_state_error']
    ];
    for (const [name, override, code] of cases) await t.test(name, () => {
        const fake = fixture([stateLine(override)]);
        expectFailure(() => helper.proveRuntime(environment(), fake.dependencies), code);
        assert.equal(fake.calls.filter((call) => call.startsWith('inspect:')).length, 1);
        assert.ok(!fake.calls.some((call) => call.startsWith('ps:')));
    });
});

test('status and transition flag shapes fail closed before host ps runs', async (t) => {
    const cases = [
        ['unknown status', { status: 'unknown' }, 'runtime_status_shape_failure'],
        ['numeric status', { status: 1 }, 'runtime_status_shape_failure'],
        ['text paused', { paused: 'false' }, 'runtime_paused_shape_failure'],
        ['text restarting', { restarting: 'false' }, 'runtime_restarting_shape_failure'],
        ['text dead', { dead: 'false' }, 'runtime_dead_shape_failure']
    ];
    for (const [name, override, code] of cases) await t.test(name, () => {
        const fake = fixture([stateLine(override)]);
        expectFailure(() => helper.proveRuntime(environment(), fake.dependencies), code);
        assert.ok(!fake.calls.some((call) => call.startsWith('ps:')));
    });
});

test('the wait is bounded to 120 inspect attempts and 119 two-second intervals', () => {
    const fake = fixture([stateLine({ pid: 0, health: 'starting' })]);
    expectFailure(
        () => helper.proveRuntime(environment(), fake.dependencies),
        'runtime_state_timeout'
    );
    assert.equal(fake.calls.filter((call) => call.startsWith('inspect:')).length, 120);
    assert.equal(fake.calls.filter((call) => call === `sleep:${helper.WAIT_MS}`).length, 119);
    assert.ok(!fake.calls.some((call) => call.startsWith('ps:')));
});

test('kernel identity must be exactly two positive matching decimal fields', async (t) => {
    const cases = [
        ['root UID', '0 999\n', 'runtime_kernel_identity_mismatch'],
        ['root GID', '999 0\n', 'runtime_kernel_identity_mismatch'],
        ['different UID', '1000 999\n', 'runtime_kernel_identity_mismatch'],
        ['malformed', '999\n', 'runtime_kernel_identity_shape_failure'],
        ['extra field', '999 999 999\n', 'runtime_kernel_identity_shape_failure']
    ];
    for (const [name, stdout, code] of cases) await t.test(name, () => {
        const fake = fixture(
            [stateLine(), stateLine(), stateLine()],
            { status: 0, stdout, stderr: '' }
        );
        expectFailure(() => helper.proveRuntime(environment(), fake.dependencies), code);
    });
});

test('a changed positive PID must stabilize again before host ps runs', () => {
    const fake = fixture([
        stateLine({ pid: 4321 }),
        stateLine({ pid: 5432 }),
        stateLine({ pid: 5432 }),
        stateLine({ pid: 5432 })
    ]);
    const result = helper.proveRuntime(environment(), fake.dependencies);
    assert.equal(result.pid, 5432);
    assert.deepEqual(fake.calls.filter((call) => call.startsWith('ps:')), ['ps:5432']);
});

test('a post-ps state transition fails closed before evidence is emitted', () => {
    const fake = fixture([
        stateLine({ pid: 4321 }),
        stateLine({ pid: 4321 }),
        stateLine({ pid: 5432 })
    ]);
    expectFailure(
        () => helper.proveRuntime(environment(), fake.dependencies),
        'runtime_state_changed_during_kernel_proof'
    );
    assert.deepEqual(fake.calls.filter((call) => call.startsWith('ps:')), ['ps:4321']);
    assert.equal(fake.outputs.length, 0);
});

test('a post-ps paused transition fails closed before evidence is emitted', () => {
    const fake = fixture([
        stateLine(),
        stateLine(),
        stateLine({ paused: true })
    ]);
    expectFailure(() => helper.proveRuntime(environment(), fake.dependencies), 'runtime_paused');
    assert.deepEqual(fake.calls.filter((call) => call.startsWith('ps:')), ['ps:4321']);
    assert.equal(fake.outputs.length, 0);
});

test('container namespaces are exact, bounded, and cover both shared modes and digest proof', async (t) => {
    const valid = [
        's3a-validation-1-1',
        's3a-publication-30545194754-2',
        'i8-digest-30545194754-2'
    ];
    for (const value of valid) await t.test(`accept ${value}`, () => {
        assert.equal(helper.validateContainerName(value), value);
    });
    const invalid = [
        '', 's3a-validation-1', 'S3a-validation-1-1', 's3a-production-1-1',
        'i8-digest-1-1-suffix', `i8-digest-${'1'.repeat(120)}-1`
    ];
    for (const value of invalid) await t.test(`reject ${value.slice(0, 32)}`, () => {
        expectFailure(() => helper.validateContainerName(value), 'runtime_container_name_invalid');
    });
});

test('failure evidence exposes only bounded allowlisted state and sanitized logs', () => {
    const evidence = helper.safeStateEvidence(helper.parseState(stateLine({
        stateError: 'engine\nerror'
    }), { containerId: CONTAINER_ID, imageId: IMAGE_ID }));
    assert.deepEqual(Object.keys(evidence), [
        'id', 'image', 'status', 'running', 'paused', 'restarting', 'dead',
        'pid', 'health', 'exitCode', 'oomKilled', 'stateError'
    ]);
    const hostile = [
        'OPERATIONS_API_KEY=secret',
        'OPERATIONS_API_KEY_PREVIOUS: old-secret',
        'API_KEY: generic-secret',
        'Authorization: Bearer bearer-secret',
        'x-slicer-api-key=header-secret\u0001',
        'TOKEN=\"token-secret\"',
        'SECRET: \'quoted-secret\'',
        'safe=value',
        'x'.repeat(600)
    ].join('\n').repeat(250);
    const sanitized = helper.sanitizeLog(hostile);
    assert.doesNotMatch(sanitized,
        /secret|bearer-secret|header-secret|token-secret|quoted-secret|\u0001/);
    assert.match(sanitized, /\[REDACTED\]/);
    assert.ok(sanitized.split('\n').length <= 200);
    assert.ok(Buffer.byteLength(sanitized, 'utf8') <= 32 * 1024);
});
