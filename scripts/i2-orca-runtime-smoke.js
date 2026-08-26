'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { validateImageId, validateName } = require('./i2-image-runtime-diagnostics');
const fixture = require('./i2-orca-runtime-smoke-fixture');
const containerScript = require('./i2-orca-runtime-smoke-container-script');
const contract = require('./i2-orca-runtime-smoke-contract');
const { DOCKER_TIMEOUT_MS, MAX_OUTPUT_BYTES } = contract;

function runDocker(args, timeout = DOCKER_TIMEOUT_MS) {
    const allowed = new Set([
        'container create', 'container inspect', 'container start', 'container rm'
    ]);
    if (!Array.isArray(args) || !allowed.has(`${args[0]} ${args[1]}`)) {
        throw new Error('docker_command_not_allowlisted');
    }
    const result = spawnSync('docker', args, {
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: false,
        timeout,
        windowsHide: true
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (result.error || Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES ||
        Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        throw new Error('orca_docker_execution_failure');
    }
    return { status: result.status, stdout, stderr };
}

function inspectContainer(reference, docker = runDocker) {
    return contract.parseInspectResult(
        docker(contract.buildInspectArgs(reference), 10_000), reference);
}

function reportFailureDiagnostic(result) {
    const payload = contract.parseFailureDiagnostic(result?.stderr);
    if (payload) process.stderr.write(`I2_ORCA_DIAGNOSTIC ${JSON.stringify(payload)}\n`);
}

function cleanupOwnedContainer(containerId, imageId, docker = runDocker) {
    const record = inspectContainer(containerId, docker);
    contract.assertOwned(record, containerId, imageId);
    const removed = docker(contract.buildRemoveArgs(containerId), 10_000);
    if (removed.status !== 0) throw new Error('container_cleanup_failure');
    if (inspectContainer(containerId, docker) !== null) {
        throw new Error('container_cleanup_incomplete');
    }
}

function appendSuccess(outputPath) {
    if (!outputPath) throw new Error('github_output_missing');
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('github_output_invalid');
    fs.appendFileSync(outputPath,
        'help=success\nsynthetic_slice=success\nclassification=success\n',
        { encoding: 'utf8' });
}

function executeOwnedSmoke(containerId, imageId, outputPath, docker) {
    contract.assertOwned(inspectContainer(containerId, docker), containerId, imageId);
    const started = docker(contract.buildStartArgs(containerId));
    if (started.status !== 0) reportFailureDiagnostic(started);
    contract.parseSmokeResult(started);
    appendSuccess(outputPath);
}

function runSmoke(env = process.env, docker = runDocker) {
    const name = validateName(env.I2_ORCA_PROBE_NAME);
    const imageId = validateImageId(env.EXPECTED_IMAGE_ID);
    if (inspectContainer(name, docker) !== null) throw new Error('probe_name_collision');
    let containerId;
    let failure;
    try {
        containerId = contract.parseCreateResult(docker(contract.buildCreateArgs(
            name, imageId, env.SERVICE_UID, env.SERVICE_GID)));
        executeOwnedSmoke(containerId, imageId, env.GITHUB_OUTPUT, docker);
    } catch (error) {
        failure = error;
    } finally {
        if (containerId) {
            try {
                cleanupOwnedContainer(containerId, imageId, docker);
            } catch (cleanupError) {
                if (!failure) failure = cleanupError;
            }
        }
        const remaining = inspectContainer(name, docker);
        if (remaining !== null && !failure) failure = new Error('probe_name_reused');
    }
    if (failure) throw failure;
}

function main() {
    try {
        if (process.argv.length !== 2) throw new Error('arguments_invalid');
        runSmoke();
    } catch (error) {
        const detail = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
            ? error.message : 'unclassified';
        process.stderr.write(`::error title=I2 Orca runtime smoke::orca_cli_smoke_failure:${detail}\n`);
        process.exitCode = 2;
    }
}

module.exports = Object.freeze({
    ...fixture,
    ...containerScript,
    ...contract,
    appendSuccess,
    cleanupOwnedContainer,
    executeOwnedSmoke,
    inspectContainer,
    runDocker,
    runSmoke
});

if (require.main === module) main();
