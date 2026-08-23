'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const MAX_ATTEMPTS = 120;
const WAIT_MS = 2000;
const MAX_STATE_BYTES = 16 * 1024;
const MAX_LOG_BYTES = 32 * 1024;
const MAX_STATE_ERROR_BYTES = 4096;
const MAX_ID_VALUE = 2147483647;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_NAME_PATTERN =
    /^(?:s3a-(?:validation|publication)|i8-digest)-[0-9]+-[0-9]+$/;
const INSPECT_FORMAT = [
    '{{json .Id}}',
    '{{json .Image}}',
    '{{json .State.Status}}',
    '{{json .State.Running}}',
    '{{json .State.Paused}}',
    '{{json .State.Restarting}}',
    '{{json .State.Dead}}',
    '{{json .State.Pid}}',
    '{{if .State.Health}}{{json .State.Health.Status}}{{else}}"missing"{{end}}',
    '{{json .State.ExitCode}}',
    '{{json .State.OOMKilled}}',
    '{{json .State.Error}}'
].join('\t');

class RuntimeProofError extends Error {
    constructor(code, state = null) {
        super(code);
        this.code = code;
        this.state = state;
    }
}

function fail(code, state = null) {
    throw new RuntimeProofError(code, state);
}

function validateContainerName(value) {
    if (typeof value !== 'string' || value.length > 128
        || !CONTAINER_NAME_PATTERN.test(value)) {
        fail('runtime_container_name_invalid');
    }
    return value;
}

function validateContainerId(value) {
    if (typeof value !== 'string' || !CONTAINER_ID_PATTERN.test(value)) {
        fail('runtime_container_id_invalid');
    }
    return value;
}

function validateImageId(value) {
    if (typeof value !== 'string' || !IMAGE_ID_PATTERN.test(value)) {
        fail('runtime_image_id_invalid');
    }
    return value;
}

function parsePositiveId(value, label) {
    if (!['uid', 'gid'].includes(label) || typeof value !== 'string'
        || !/^[1-9][0-9]*$/.test(value)) fail(`runtime_service_${label}_invalid`);
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric > MAX_ID_VALUE) {
        fail(`runtime_service_${label}_invalid`);
    }
    return numeric;
}

function buildInspectArgs(containerName) {
    return [
        'container', 'inspect', '--format', INSPECT_FORMAT,
        validateContainerName(containerName)
    ];
}

function normalizeResult(result, failureCode) {
    const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
    if (!result || result.error || result.signal || result.status !== 0 || stderr !== '') {
        fail(failureCode);
    }
    return { stdout, stderr, status: result.status };
}

function runExact(command, args, timeout, maxBuffer) {
    return spawnSync(command, args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout,
        maxBuffer
    });
}

function inspectContainer(containerName) {
    const result = runExact('docker', buildInspectArgs(containerName), 10_000, MAX_STATE_BYTES);
    return normalizeResult(result, 'runtime_inspect_failure').stdout;
}

function readKernelIdentity(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_ID_VALUE) {
        fail('runtime_pid_malformed');
    }
    return runExact('/usr/bin/ps', ['-o', 'uid=,gid=', '-p', String(pid)], 10_000, 4096);
}

function parseState(output, expected) {
    if (typeof output !== 'string'
        || Buffer.byteLength(output, 'utf8') > MAX_STATE_BYTES) {
        fail('runtime_state_shape_failure');
    }
    const line = output.endsWith('\n') ? output.slice(0, -1).replace(/\r$/, '') : output;
    if (!line || /[\r\n]/.test(line)) fail('runtime_state_shape_failure');
    const fields = line.split('\t');
    if (fields.length !== 12) fail('runtime_state_shape_failure');
    let values;
    try {
        values = fields.map((field) => JSON.parse(field));
    } catch {
        fail('runtime_state_shape_failure');
    }
    const [
        id, image, status, running, paused, restarting, dead,
        pid, health, exitCode, oomKilled, stateError
    ] = values;
    const state = {
        id, image, status, running, paused, restarting, dead,
        pid, health, exitCode, oomKilled, stateError
    };
    if (!CONTAINER_ID_PATTERN.test(id) || id !== expected.containerId) {
        fail('runtime_container_id_mismatch', state);
    }
    if (!IMAGE_ID_PATTERN.test(image) || image !== expected.imageId) {
        fail('runtime_image_id_mismatch', state);
    }
    if (typeof status !== 'string'
        || !['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']
            .includes(status)) {
        fail('runtime_status_shape_failure', state);
    }
    if (typeof running !== 'boolean') fail('runtime_running_shape_failure', state);
    if (typeof paused !== 'boolean') fail('runtime_paused_shape_failure', state);
    if (typeof restarting !== 'boolean') fail('runtime_restarting_shape_failure', state);
    if (typeof dead !== 'boolean') fail('runtime_dead_shape_failure', state);
    if (!Number.isSafeInteger(pid) || pid < 0 || pid > MAX_ID_VALUE) {
        fail('runtime_pid_malformed', state);
    }
    if (typeof health !== 'string'
        || !['starting', 'healthy', 'unhealthy', 'missing'].includes(health)) {
        fail('runtime_health_shape_failure', state);
    }
    if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
        fail('runtime_exit_code_shape_failure', state);
    }
    if (typeof oomKilled !== 'boolean') fail('runtime_oom_shape_failure', state);
    if (typeof stateError !== 'string'
        || Buffer.byteLength(stateError, 'utf8') > MAX_STATE_ERROR_BYTES) {
        fail('runtime_state_error_shape_failure', state);
    }
    return state;
}

function isReady(state) {
    if (state.oomKilled) fail('runtime_oom_killed', state);
    if (state.stateError !== '') fail('runtime_state_error', state);
    if (state.dead || state.status === 'dead') fail('runtime_dead', state);
    if (state.restarting || state.status === 'restarting') fail('runtime_restarting', state);
    if (state.paused || state.status === 'paused') fail('runtime_paused', state);
    if (state.status !== 'running' || !state.running) fail('runtime_exited', state);
    if (state.health === 'missing') fail('runtime_health_missing', state);
    if (state.health === 'unhealthy') fail('runtime_unhealthy', state);
    return state.health === 'healthy' && /^[1-9][0-9]*$/.test(String(state.pid));
}

function parseKernelIdentity(result, expected, state) {
    const normalized = normalizeResult(result, 'runtime_kernel_process_failure');
    const match = /^[ \t]*([0-9]+)[ \t]+([0-9]+)[ \t]*\r?\n?$/.exec(normalized.stdout);
    if (!match) fail('runtime_kernel_identity_shape_failure', state);
    const uid = Number(match[1]);
    const gid = Number(match[2]);
    if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)
        || uid <= 0 || gid <= 0 || uid > MAX_ID_VALUE || gid > MAX_ID_VALUE
        || uid !== expected.uid || gid !== expected.gid) {
        fail('runtime_kernel_identity_mismatch', state);
    }
    return { uid, gid };
}

function wait(milliseconds) {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
}

function appendOutputs(outputPath, identity) {
    if (typeof outputPath !== 'string' || !outputPath) fail('github_output_invalid');
    let details;
    try {
        details = fs.lstatSync(outputPath);
    } catch {
        fail('github_output_invalid');
    }
    if (!details.isFile() || details.isSymbolicLink()) fail('github_output_invalid');
    fs.appendFileSync(
        outputPath,
        `kernel_uid=${identity.uid}\nkernel_gid=${identity.gid}\n`,
        { encoding: 'utf8' }
    );
}

function readEnvironment(env) {
    return {
        containerName: validateContainerName(env.CONTAINER_NAME),
        containerId: validateContainerId(env.EXPECTED_CONTAINER_ID),
        imageId: validateImageId(env.EXPECTED_IMAGE_ID),
        uid: parsePositiveId(env.SERVICE_UID, 'uid'),
        gid: parsePositiveId(env.SERVICE_GID, 'gid'),
        outputPath: env.GITHUB_OUTPUT
    };
}

function proveRuntime(env = process.env, dependencies = {}) {
    const expected = readEnvironment(env);
    const inspect = dependencies.inspect || inspectContainer;
    const ps = dependencies.ps || readKernelIdentity;
    const sleep = dependencies.sleep || wait;
    const writeOutputs = dependencies.appendOutputs || appendOutputs;
    let readyState = null;
    let lastState = null;
    let priorHealthyPid = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        lastState = parseState(inspect(expected.containerName), expected);
        if (isReady(lastState)) {
            if (priorHealthyPid === lastState.pid) {
                readyState = lastState;
                break;
            }
            priorHealthyPid = lastState.pid;
        } else {
            priorHealthyPid = null;
        }
        if (attempt < MAX_ATTEMPTS) sleep(WAIT_MS);
    }
    if (!readyState) fail('runtime_state_timeout', lastState);
    const identity = parseKernelIdentity(ps(readyState.pid), expected, readyState);
    const confirmedState = parseState(inspect(expected.containerName), expected);
    if (!isReady(confirmedState) || confirmedState.pid !== readyState.pid) {
        fail('runtime_state_changed_during_kernel_proof', confirmedState);
    }
    writeOutputs(expected.outputPath, identity);
    return Object.freeze({ ...identity, pid: readyState.pid, state: confirmedState });
}

function clipUtf8(value, maxBytes) {
    const buffer = Buffer.from(String(value || ''), 'utf8');
    return buffer.length <= maxBytes ? buffer.toString('utf8')
        : buffer.subarray(0, maxBytes).toString('utf8');
}

function sanitizeLog(value) {
    const redacted = String(value || '')
        .replace(
            /\b((?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|TOKEN|SECRET)(?:_PREVIOUS)?)\s*([:=])\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi,
            '$1$2[REDACTED]'
        )
        .replace(/\b(x-(?:slicer-)?api-key\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
        .replace(/\b(authorization\s*:\s*)(?:bearer|basic)\s+\S+/gi, '$1[REDACTED]')
        .replace(/[^\x09\x0a\x20-\x7e]/g, '?');
    return clipUtf8(redacted.split('\n').slice(-200)
        .map((line) => line.slice(0, 512)).join('\n'), MAX_LOG_BYTES);
}

function readBoundedLogs(containerName) {
    const result = runExact(
        'docker', ['logs', '--tail', '200', validateContainerName(containerName)],
        10_000, MAX_LOG_BYTES * 2
    );
    if (result.error || result.signal || !Number.isInteger(result.status)) {
        return 'runtime_container_log_unavailable';
    }
    return sanitizeLog(`${result.stdout || ''}${result.stderr || ''}`);
}

function safeStateEvidence(state) {
    if (!state || typeof state !== 'object') return null;
    return {
        id: CONTAINER_ID_PATTERN.test(state.id) ? state.id : 'invalid',
        image: IMAGE_ID_PATTERN.test(state.image) ? state.image : 'invalid',
        status: typeof state.status === 'string' ? state.status : 'invalid',
        running: typeof state.running === 'boolean' ? state.running : 'invalid',
        paused: typeof state.paused === 'boolean' ? state.paused : 'invalid',
        restarting: typeof state.restarting === 'boolean' ? state.restarting : 'invalid',
        dead: typeof state.dead === 'boolean' ? state.dead : 'invalid',
        pid: Number.isSafeInteger(state.pid) ? state.pid : 'invalid',
        health: typeof state.health === 'string' ? state.health : 'invalid',
        exitCode: Number.isSafeInteger(state.exitCode) ? state.exitCode : 'invalid',
        oomKilled: typeof state.oomKilled === 'boolean' ? state.oomKilled : 'invalid',
        stateError: sanitizeLog(state.stateError).slice(0, 1024)
    };
}

function main() {
    try {
        if (process.argv.length !== 2) fail('arguments_invalid');
        proveRuntime();
    } catch (error) {
        const code = error instanceof RuntimeProofError
            ? error.code : 'runtime_state_unclassified';
        process.stderr.write(`::error title=I8 runtime state proof::${code}\n`);
        const evidence = safeStateEvidence(error?.state);
        if (evidence) process.stderr.write(`runtime_state_evidence=${JSON.stringify(evidence)}\n`);
        try {
            const logs = readBoundedLogs(process.env.CONTAINER_NAME);
            if (logs) process.stderr.write(`runtime_container_log_begin\n${logs}\nruntime_container_log_end\n`);
        } catch {
            process.stderr.write('runtime_container_log_unavailable\n');
        }
        process.exitCode = 2;
    }
}

module.exports = Object.freeze({
    MAX_ATTEMPTS,
    WAIT_MS,
    INSPECT_FORMAT,
    RuntimeProofError,
    validateContainerName,
    validateContainerId,
    validateImageId,
    parsePositiveId,
    buildInspectArgs,
    parseState,
    isReady,
    parseKernelIdentity,
    proveRuntime,
    sanitizeLog,
    safeStateEvidence
});

if (require.main === module) main();
