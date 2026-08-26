'use strict';

const { validateImageId, validateName } = require('./i2-image-runtime-diagnostics');
const { ORCA_CONTAINER_SCRIPT } = require('./i2-orca-runtime-smoke-container-script');

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const DOCKER_TIMEOUT_MS = 300_000;
const SUCCESS_MARKER = '{"orca_cli_help":"pass","synthetic_slice":"pass"}\n';
const VALIDATION_LABEL = 'io.s3a.validation-only';
const IMAGE_LABEL = 'io.s3a.expected-image-id';
const INSPECT_FORMAT = `{{json .Id}}|{{json .Image}}|{{json (index .Config.Labels "${VALIDATION_LABEL}")}}|` +
    `{{json (index .Config.Labels "${IMAGE_LABEL}")}}`;

function parsePositiveEnvironmentId(value, label) {
    if (!['uid', 'gid'].includes(label) || typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
        throw new Error(`${label}_shape`);
    }
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 2147483647) {
        throw new Error(`${label}_invalid`);
    }
    return numeric;
}

function buildCreateArgs(name, imageId, uidValue, gidValue) {
    const uid = parsePositiveEnvironmentId(uidValue, 'uid');
    const gid = parsePositiveEnvironmentId(gidValue, 'gid');
    const exactImageId = validateImageId(imageId);
    return [
        'container', 'create', '--pull', 'never', '--network', 'none',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '256', '--memory', '4g', '--cpus', '2',
        '--read-only', '--name', validateName(name),
        '--label', `${VALIDATION_LABEL}=true`,
        '--label', `${IMAGE_LABEL}=${exactImageId}`,
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=256m,uid=${uid},gid=${gid},mode=0700`,
        '--entrypoint', '/usr/bin/node',
        exactImageId, '-e', ORCA_CONTAINER_SCRIPT
    ];
}

function buildInspectArgs(reference) {
    const value = /^[0-9a-f]{64}$/.test(reference) ? reference : validateName(reference);
    return ['container', 'inspect', '--format', INSPECT_FORMAT, value];
}

function buildStartArgs(containerId) {
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('container_id_invalid');
    return ['container', 'start', '--attach', containerId];
}

function buildRemoveArgs(containerId) {
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('container_id_invalid');
    return ['container', 'rm', '--force', containerId];
}

function parseInspectResult(result, reference) {
    if (!result || !Number.isInteger(result.status) || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string') throw new Error('container_lookup_shape');
    if (result.status === 0) {
        const pattern = /^("[0-9a-f]{64}")\|("sha256:[0-9a-f]{64}")\|("[A-Za-z0-9_.:-]{1,100}")\|("sha256:[0-9a-f]{64}")\r?\n?$/;
        const match = pattern.exec(result.stdout);
        if (!match || result.stderr !== '') throw new Error('container_lookup_shape');
        return {
            id: JSON.parse(match[1]),
            imageId: JSON.parse(match[2]),
            validationLabel: JSON.parse(match[3]),
            expectedImageId: JSON.parse(match[4])
        };
    }
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const absent = new RegExp(`^(?:Error: No such (?:object|container): |` +
        `Error response from daemon: No such container: )${escaped}\\r?\\n?$`);
    if (result.status !== 1 || !/^(?:\r?\n|\[\]\r?\n?)?$/.test(result.stdout) ||
        !absent.test(result.stderr)) throw new Error('container_lookup_failure');
    return null;
}

function assertOwned(record, containerId, imageId) {
    if (!record || record.id !== containerId || record.imageId !== imageId ||
        record.validationLabel !== 'true' || record.expectedImageId !== imageId) {
        throw new Error('container_ownership_failure');
    }
}

function parseCreateResult(result) {
    if (!result || result.status !== 0 || result.stderr !== '' ||
        !/^[0-9a-f]{64}\r?\n$/.test(result.stdout)) {
        throw new Error('orca_container_create_failure');
    }
    return result.stdout.replace(/\r?\n$/, '');
}

function parseSmokeResult(result) {
    if (!result || !Number.isInteger(result.status) || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string') throw new Error('orca_smoke_result_shape');
    const failures = new Map([
        [20, 'orca_help_execution_failure'], [21, 'orca_help_contract_failure'],
        [29, 'orca_invocation_policy_failure'], [30, 'orca_slice_execution_failure'],
        [31, 'orca_slice_output_count_failure'], [32, 'orca_slice_output_contract_failure'],
        [33, 'orca_slice_content_failure'], [34, 'orca_extrusion_mode_failure'],
        [39, 'orca_smoke_internal_failure']
    ]);
    if (result.status !== 0) throw new Error(failures.get(result.status) || 'orca_smoke_failure');
    if (result.stderr !== '' || result.stdout !== SUCCESS_MARKER) {
        throw new Error('orca_smoke_output_failure');
    }
}

function parseFailureDiagnostic(stderr) {
    if (typeof stderr !== 'string' || Buffer.byteLength(stderr) > MAX_DIAGNOSTIC_BYTES) return null;
    let payload;
    try {
        payload = JSON.parse(stderr.replace(/\r?\n$/, ''));
    } catch {
        return null;
    }
    const keys = Object.keys(payload).sort();
    const expectedKeys = ['error_code', 'phase', 'signal', 'status', 'stderr_bytes',
        'stderr_tail', 'stdout_bytes', 'stdout_tail'];
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys.sort()) ||
        !['help', 'slice'].includes(payload.phase) ||
        !(payload.status === null || (Number.isInteger(payload.status) &&
            payload.status >= 0 && payload.status <= 255)) ||
        !(payload.signal === null || /^[A-Z0-9]{1,20}$/.test(payload.signal)) ||
        !(payload.error_code === null || /^[A-Z0-9_]{1,40}$/.test(payload.error_code)) ||
        !Number.isSafeInteger(payload.stdout_bytes) || payload.stdout_bytes < 0 ||
        payload.stdout_bytes > 20 * 1024 * 1024 ||
        !Number.isSafeInteger(payload.stderr_bytes) || payload.stderr_bytes < 0 ||
        payload.stderr_bytes > 20 * 1024 * 1024 ||
        typeof payload.stdout_tail !== 'string' || typeof payload.stderr_tail !== 'string' ||
        Buffer.byteLength(payload.stdout_tail) > 4096 ||
        Buffer.byteLength(payload.stderr_tail) > 4096) return null;
    return payload;
}

module.exports = Object.freeze({
    DOCKER_TIMEOUT_MS, IMAGE_LABEL, INSPECT_FORMAT, MAX_DIAGNOSTIC_BYTES, MAX_OUTPUT_BYTES,
    SUCCESS_MARKER, VALIDATION_LABEL, assertOwned, buildCreateArgs, buildInspectArgs,
    buildRemoveArgs, buildStartArgs, parseCreateResult, parseFailureDiagnostic,
    parseInspectResult, parsePositiveEnvironmentId, parseSmokeResult
});
