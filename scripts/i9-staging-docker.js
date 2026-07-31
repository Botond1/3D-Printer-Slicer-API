'use strict';

const { spawnSync } = require('node:child_process');
const {
    validateDegradedObservation,
    validateHealthyObservation,
    validateRuntimeInspect
} = require('./i9-staging-contract');
const { PEER_HOLD, PEER_READINESS_PROBE } = require('./i9-staging-peer-probes');
const { API_RUNTIME_PROBE, ENCODED_EVAL } = require('./i6-topology-probes');

const MAX_COMMAND_BYTES = 64 * 1024;
const DOCKER_TIMEOUT_MS = 300_000;
const PROJECT = 'i9-s3b-rehearsal';
const API_NAME = '3d-psa-backend-server';
const NETWORK_NAME = 'slicer-api-private';
const ALLOWED_DOCKER = new Set([
    'compose config', 'compose up', 'compose down', 'compose ps',
    'container inspect', 'container run', 'container exec', 'container rm',
    'network inspect', 'image inspect', 'image rm'
]);

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function boundedRun(file, args, options = {}) {
    const result = spawnSync(file, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        encoding: 'utf8',
        maxBuffer: MAX_COMMAND_BYTES,
        shell: false,
        timeout: options.timeout || DOCKER_TIMEOUT_MS,
        windowsHide: true
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (result.error || Buffer.byteLength(stdout) > MAX_COMMAND_BYTES
        || Buffer.byteLength(stderr) > MAX_COMMAND_BYTES) fail(options.failure || 'command_failure');
    if (options.accept?.includes(result.status)) return { status: result.status, stdout, stderr };
    if (result.status !== 0) fail(options.failure || 'command_failure');
    return { status: result.status, stdout, stderr };
}

function docker(args, options = {}) {
    const command = args[0] === 'compose'
        ? `${args[0]} ${args.find((item) => ['config', 'up', 'down', 'ps'].includes(item)) || ''}`
        : `${args[0]} ${args[1]}`;
    if (!ALLOWED_DOCKER.has(command)) fail('docker_command_not_allowlisted');
    return boundedRun('docker', args, options);
}

function composeArgs(command) {
    return ['compose', '-f', 'docker-compose.production.yml', '-p', PROJECT, ...command];
}

function composeEnv(base, reference) {
    return { ...base, SLICER_API_IMAGE: reference, COMPOSE_PROJECT_NAME: PROJECT };
}

function inspectContainer(reference) {
    const output = docker(['container', 'inspect', reference], {
        failure: 'container_inspect_failure', timeout: 15_000
    }).stdout;
    let record;
    try {
        const values = JSON.parse(output);
        if (!Array.isArray(values) || values.length !== 1) fail('container_inspect_shape');
        record = values[0];
    } catch {
        fail('container_inspect_shape');
    }
    return {
        id: record.Id,
        imageId: record.Image,
        configuredImage: record.Config?.Image,
        running: record.State?.Running,
        paused: record.State?.Paused,
        restarting: record.State?.Restarting,
        oomKilled: record.State?.OOMKilled,
        health: record.State?.Health?.Status,
        pid: record.State?.Pid,
        user: record.Config?.User,
        portBindings: record.HostConfig?.PortBindings || {},
        networks: Object.keys(record.NetworkSettings?.Networks || {}).sort()
    };
}

function requireAbsent() {
    const container = docker(['container', 'inspect', API_NAME], {
        accept: [0, 1], failure: 'preexisting_container_probe_failure', timeout: 10_000
    });
    if (container.status === 0) fail('preexisting_container_collision');
    const network = docker(['network', 'inspect', NETWORK_NAME], {
        accept: [0, 1], failure: 'preexisting_network_probe_failure', timeout: 10_000
    });
    if (network.status === 0) fail('preexisting_network_collision');
}

function sleep(milliseconds) {
    boundedRun(process.execPath, ['-e', `setTimeout(()=>{},${milliseconds})`], {
        timeout: milliseconds + 2000, failure: 'bounded_wait_failure'
    });
}

function waitForHealthy(reference, env) {
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]) {
        const lookup = docker(composeArgs(['ps', '-q', 'slicer-api']), {
            cwd: env.repositoryRoot, env: composeEnv(env, reference),
            failure: 'compose_container_lookup_failure', timeout: 15_000
        }).stdout.trim();
        if (/^[0-9a-f]{64}$/.test(lookup)) {
            const inspect = inspectContainer(lookup);
            if (inspect.running && inspect.health === 'healthy') return inspect;
        }
        sleep(delay);
    }
    fail('container_health_timeout');
}

function inspectNetwork() {
    const output = docker(['network', 'inspect', NETWORK_NAME], {
        failure: 'network_inspect_failure', timeout: 15_000
    }).stdout;
    let record;
    try {
        const values = JSON.parse(output);
        if (!Array.isArray(values) || values.length !== 1) fail('network_inspect_shape');
        record = values[0];
    } catch {
        fail('network_inspect_shape');
    }
    if (record.Internal !== true || record.Driver !== 'bridge'
        || record.Name !== NETWORK_NAME) fail('private_network_contract_failure');
}

function startPeer(name, imageId, runId) {
    const result = docker([
        'container', 'run', '--detach', '--name', name, '--pull', 'never',
        '--restart', 'no', '--network', NETWORK_NAME, '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m',
        '--cpus', '0.5', '--label', 'io.s3b.rehearsal=true',
        '--label', `io.s3b.run-id=${runId}`, '--entrypoint', '/usr/bin/node',
        imageId, '-e', PEER_HOLD
    ], { failure: 'private_peer_start_failure', timeout: 30_000 });
    const id = result.stdout.trim();
    if (!/^[0-9a-f]{64}$/.test(id)) fail('private_peer_identity_failure');
    return id;
}

function removePeer(id, runId) {
    const record = inspectContainer(id);
    const raw = docker(['container', 'inspect', id], {
        failure: 'private_peer_inspect_failure', timeout: 10_000
    }).stdout;
    const labels = JSON.parse(raw)[0]?.Config?.Labels || {};
    if (record.id !== id || labels['io.s3b.rehearsal'] !== 'true'
        || labels['io.s3b.run-id'] !== runId) fail('private_peer_ownership_failure');
    docker(['container', 'rm', '--force', id], {
        failure: 'private_peer_cleanup_failure', timeout: 15_000
    });
}

function peerProbe(peerId, operationsKey, mode) {
    const childEnv = { ...process.env, OPERATIONS_API_KEY: operationsKey };
    const encoded = Buffer.from(PEER_READINESS_PROBE, 'utf8').toString('base64');
    const loader = "const s=Buffer.from(process.argv[1],'base64').toString('utf8');" +
        "process.argv.splice(1,1);eval(s);";
    const result = docker([
        'container', 'exec', '--env', 'OPERATIONS_API_KEY', peerId,
        '/usr/bin/node', '-e', loader, encoded, API_NAME, mode
    ], { env: childEnv, failure: 'private_peer_probe_failure', timeout: 20_000 });
    try {
        return JSON.parse(result.stdout);
    } catch {
        fail('private_peer_probe_shape');
    }
}

function proveReadiness(peerId, operationsKey) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const error = validateHealthyObservation(peerProbe(peerId, operationsKey, 'healthy'));
        if (error) fail(error);
    }
}

function kernelIdentity(containerId, expectedUid, expectedGid) {
    const read = (flag) => docker([
        'container', 'exec', containerId, '/usr/bin/id', flag
    ], { failure: 'kernel_identity_probe_failure', timeout: 10_000 }).stdout.trim();
    const uid = read('-u');
    const gid = read('-g');
    if (uid !== expectedUid || gid !== expectedGid
        || !/^[1-9][0-9]*$/.test(uid) || !/^[1-9][0-9]*$/.test(gid)) {
        fail('kernel_identity_mismatch');
    }
    return { uid, gid };
}

function proveNoDefaultRoute(containerId, expectedUid, expectedGid) {
    const encoded = Buffer.from(API_RUNTIME_PROBE, 'utf8').toString('base64');
    const result = docker([
        'container', 'exec', containerId, '/usr/bin/node', '-e', ENCODED_EVAL, encoded
    ], { failure: 'api_runtime_probe_failure', timeout: 10_000 });
    let proof;
    try {
        proof = JSON.parse(result.stdout);
    } catch {
        fail('api_runtime_probe_shape');
    }
    if (proof?.uid !== Number(expectedUid) || proof?.gid !== Number(expectedGid)
        || proof?.externalDefaultRoute !== false) fail('api_default_route_present');
}

function startStage(candidate, env, label) {
    let peerId;
    let started = false;
    try {
        docker(composeArgs(['config', '-q']), {
            cwd: env.repositoryRoot, env: composeEnv(env, candidate.reference),
            failure: 'production_compose_contract_failure', timeout: 20_000
        });
        docker(composeArgs([
            'up', '--detach', '--no-build', '--pull', 'never', '--force-recreate', 'slicer-api'
        ]), {
            cwd: env.repositoryRoot, env: composeEnv(env, candidate.reference),
            failure: `${label}_compose_start_failure`
        });
        started = true;
        const inspect = waitForHealthy(candidate.reference, env);
        const error = validateRuntimeInspect(inspect, {
            configId: candidate.config_id,
            reference: candidate.reference,
            uid: env.uid,
            gid: env.gid
        });
        if (error) fail(error);
        const kernel = kernelIdentity(inspect.id, env.uid, env.gid);
        proveNoDefaultRoute(inspect.id, env.uid, env.gid);
        inspectNetwork();
        peerId = startPeer(`i9-peer-${label}-${env.runId}-${env.runAttempt}`,
            candidate.config_id, env.runId);
        proveReadiness(peerId, env.operationsKey);
        return { inspect, kernel, peerId };
    } catch (error) {
        if (peerId) {
            try { removePeer(peerId, env.runId); } catch {}
        }
        if (started) {
            try {
                docker(composeArgs(['down', '--timeout', '30', '--remove-orphans']), {
                    cwd: env.repositoryRoot, env: composeEnv(env, candidate.reference),
                    failure: 'compose_cleanup_failure', timeout: 90_000
                });
            } catch {}
        }
        throw error;
    }
}

function stopStage(candidate, env, peerId) {
    if (peerId) removePeer(peerId, env.runId);
    docker(composeArgs(['down', '--timeout', '30', '--remove-orphans']), {
        cwd: env.repositoryRoot, env: composeEnv(env, candidate.reference),
        failure: 'compose_cleanup_failure', timeout: 90_000
    });
}

function sudoChmod(mode, target) {
    boundedRun('sudo', ['--non-interactive', 'chmod', mode, '--', target], {
        timeout: 10_000, failure: 'host_ownership_capability_failure'
    });
}

function removeImages(candidates) {
    for (const candidate of candidates) {
        const result = docker(['image', 'rm', candidate.reference], {
            accept: [0, 1], failure: 'image_cleanup_failure', timeout: 60_000
        });
        if (result.status !== 0 && !/No such image/.test(result.stderr)) {
            fail('image_cleanup_failure');
        }
        const probe = docker(['image', 'inspect', candidate.reference], {
            accept: [0, 1], failure: 'image_cleanup_probe_failure', timeout: 15_000
        });
        if (probe.status === 0) fail('image_cleanup_incomplete');
    }
}

function observeStorageFailure(peerId, operationsKey) {
    const degraded = peerProbe(peerId, operationsKey, 'degraded');
    const error = validateDegradedObservation(degraded);
    if (error) fail(error);
}

module.exports = Object.freeze({
    ALLOWED_DOCKER,
    API_NAME,
    NETWORK_NAME,
    PROJECT,
    boundedRun,
    composeArgs,
    docker,
    fail,
    inspectContainer,
    observeStorageFailure,
    peerProbe,
    removeImages,
    requireAbsent,
    sleep,
    startStage,
    stopStage,
    sudoChmod
});
