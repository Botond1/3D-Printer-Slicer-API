'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const MAX_COMMAND_BYTES = 16 * 1024;
const DOCKER_TIMEOUT_MS = 30_000;

function requireString(value, pattern, label) {
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label}_invalid`);
    return value;
}

function validateImageRef(value) {
    return requireString(value, /^local\/slicer-api-validation:[0-9a-f]{40}$/, 'image_ref');
}

function validateImageId(value) {
    return requireString(value, /^sha256:[0-9a-f]{64}$/, 'image_id');
}

function validateName(value) {
    return requireString(value, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'container_name');
}

function parseInspectOutput(output, expectedId) {
    const match = /^("sha256:[0-9a-f]{64}")\|("[^"]+")\r?\n?$/.exec(output);
    if (!match) throw new Error('image_inspect_shape');
    const id = JSON.parse(match[1]);
    const configuredUser = JSON.parse(match[2]);
    if (id !== validateImageId(expectedId) || configuredUser !== 'slicer') {
        throw new Error('image_identity_mismatch');
    }
    return { id, configuredUser };
}

function parsePositiveId(output, label) {
    if (!['uid', 'gid'].includes(label) || !/^[0-9]+\r?\n?$/.test(output)) {
        throw new Error(`${label}_shape`);
    }
    const value = Number(output.replace(/\r?\n$/, ''));
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
        throw new Error(`${label}_invalid`);
    }
    return value;
}

function buildInspectArgs(imageRef) {
    return ['image', 'inspect', '--format', '{{json .Id}}|{{json .Config.User}}', validateImageRef(imageRef)];
}

function buildResolverArgs(name, imageId, selector) {
    if (!['-u', '-g'].includes(selector)) throw new Error('resolver_selector');
    const exactImageId = validateImageId(imageId);
    return ['run', '--rm', '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--name', validateName(name),
        '--label', 'io.s3a.validation-only=true',
        '--label', `io.s3a.expected-image-id=${exactImageId}`,
        '--entrypoint', '/usr/bin/id', exactImageId, selector];
}

function buildPresenceArgs(name) {
    return ['container', 'inspect', '--format', '{{json .Id}}', validateName(name)];
}

function runDocker(args, timeout = DOCKER_TIMEOUT_MS) {
    const allowed = new Set(['image inspect', 'run --rm', 'container inspect']);
    const signature = `${args[0]} ${args[1]}`;
    if (!allowed.has(signature)) throw new Error('docker_command_not_allowlisted');
    const result = spawnSync('docker', args, {
        encoding: 'utf8', timeout, maxBuffer: MAX_COMMAND_BYTES, windowsHide: true, shell: false
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (result.error || Buffer.byteLength(stdout) > MAX_COMMAND_BYTES ||
        Buffer.byteLength(stderr) > MAX_COMMAND_BYTES) throw new Error('docker_execution_failure');
    return { status: result.status, stdout, stderr };
}

function parsePresenceResult(result, name) {
    validateName(name);
    if (!result || !Number.isInteger(result.status) || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string') throw new Error('container_lookup_shape');
    if (result.status === 0) {
        if (!/^"[0-9a-f]{64}"\r?\n?$/.test(result.stdout) || result.stderr !== '') {
            throw new Error('container_lookup_shape');
        }
        return true;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const absent = new RegExp(`^(?:Error: No such (?:object|container): |` +
        `Error response from daemon: No such container: )${escaped}\\r?\\n?$`);
    if (result.status !== 1 || !/^(?:\r?\n|\[\]\r?\n?)?$/.test(result.stdout) || !absent.test(result.stderr)) {
        throw new Error('container_lookup_failure');
    }
    return false;
}

function isPresent(name) {
    return parsePresenceResult(runDocker(buildPresenceArgs(name), 10_000), name);
}

function resolveOne(name, imageId, selector, label) {
    if (isPresent(name)) throw new Error('probe_name_collision');
    let result;
    try {
        result = runDocker(buildResolverArgs(name, imageId, selector));
        if (result.status !== 0 || result.stderr !== '') throw new Error(`${label}_lookup_failure`);
        return parsePositiveId(result.stdout, label);
    } finally {
        if (isPresent(name)) throw new Error('container_cleanup_incomplete');
    }
}

function appendOutputs(outputPath, identity) {
    if (!outputPath) throw new Error('github_output_missing');
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('github_output_invalid');
    fs.appendFileSync(outputPath,
        `configured_user=${identity.configuredUser}\nuid=${identity.uid}\ngid=${identity.gid}\nclassification=success\n`,
        { encoding: 'utf8' });
}

function readEnvironment(env) {
    const values = {
        imageRef: validateImageRef(env.IMAGE_REF),
        expectedImageId: validateImageId(env.EXPECTED_IMAGE_ID),
        uidName: validateName(env.I2_UID_PROBE_NAME),
        gidName: validateName(env.I2_GID_PROBE_NAME)
    };
    if (values.uidName === values.gidName) throw new Error('container_names_not_unique');
    return values;
}

function resolveRuntimeIdentity(env = process.env) {
    const values = readEnvironment(env);
    const inspected = runDocker(buildInspectArgs(values.imageRef), 10_000);
    if (inspected.status !== 0 || inspected.stderr !== '') throw new Error('image_inspect_failure');
    const image = parseInspectOutput(inspected.stdout, values.expectedImageId);
    const identity = {
        ...image,
        uid: resolveOne(values.uidName, image.id, '-u', 'uid'),
        gid: resolveOne(values.gidName, image.id, '-g', 'gid')
    };
    appendOutputs(env.GITHUB_OUTPUT, identity);
    return identity;
}

function main() {
    try {
        if (process.argv.length !== 2) throw new Error('arguments_invalid');
        resolveRuntimeIdentity();
    } catch (error) {
        const detail = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
            ? error.message : 'unclassified';
        process.stderr.write(`::error title=I2 runtime identity::runtime_identity_failure:${detail}\n`);
        process.exitCode = 2;
    }
}

module.exports = Object.freeze({ MAX_COMMAND_BYTES, validateImageRef, validateImageId, validateName,
    parseInspectOutput, parsePositiveId, buildInspectArgs, buildResolverArgs, buildPresenceArgs,
    parsePresenceResult, isPresent, resolveRuntimeIdentity });

if (require.main === module) main();
