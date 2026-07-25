'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {
    API_ALIAS,
    API_IP,
    IMAGE_LABEL,
    INTERNAL_SUBNET,
    PEER_ALIAS,
    PEER_IP,
    SENTINEL_IP,
    SENTINEL_SUBNET,
    TOPOLOGY_CONTRACT_REASONS,
    VALIDATION_LABEL,
    validateApiTopology,
    validatePeerTopology,
    validateSentinelTopology
} = require('./i6-topology-contract');
const {
    API_RUNTIME_PROBE,
    ENCODED_EVAL,
    NATIVE_CHILD_WRAPPER,
    NODE_TRANSPORT_PROBE,
    PEER_HOLD,
    PEER_HTTP_PROBE,
    PYTHON_TRANSPORT_PROBE,
    SENTINEL_HOST,
    SENTINEL_LISTENER
} = require('./i6-topology-probes');

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const POSITIVE_ID = /^[1-9][0-9]*$/;
const MAX_OUTPUT = 64 * 1024;
const CALIBRATION_API_IP = '192.0.2.3';
const ORIGIN = 'https://i6.validation.invalid';
const OPERATIONS_KEY = 'i6-validation-operations-active-260725-d1';
const CREDENTIALS = Object.freeze({
    SLICE_SERVICE_API_KEY: 'i6-validation-slice-active-260725-a1',
    SLICE_SERVICE_API_KEY_PREVIOUS: 'i6-validation-slice-previous-260725-a2',
    PRICING_API_KEY: 'i6-validation-pricing-active-260725-b1',
    PRICING_API_KEY_PREVIOUS: 'i6-validation-pricing-previous-260725-b2',
    ARTIFACT_API_KEY: 'i6-validation-artifact-active-260725-c1',
    ARTIFACT_API_KEY_PREVIOUS: 'i6-validation-artifact-previous-260725-c2',
    OPERATIONS_API_KEY: OPERATIONS_KEY,
    OPERATIONS_API_KEY_PREVIOUS: 'i6-validation-operations-previous-260725-d2'
});

function fail(code, classification = 'topology_gate_failure') {
    const safe = /^[a-z0-9_]{1,80}$/.test(code) ? code : 'unclassified_failure';
    const error = new Error(safe);
    error.classification = classification;
    throw error;
}

function run(args, options = {}) {
    const result = spawnSync('docker', args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: options.timeout || 30_000,
        maxBuffer: MAX_OUTPUT
    });
    if (Buffer.byteLength(result.stdout || '') > MAX_OUTPUT
        || Buffer.byteLength(result.stderr || '') > MAX_OUTPUT) {
        fail('docker_output_unbounded');
    }
    if (result.error?.code === 'ETIMEDOUT' || result.error?.code === 'ENOENT') {
        fail(options.capability || 'docker_command_unavailable',
            options.capabilityClassification || 'BLOCKED_I6_RUNTIME_CAPABILITY');
    }
    if (result.error || result.signal || result.status !== (options.status ?? 0)) {
        fail(options.failure || 'docker_command_failure',
            options.failureClassification || 'topology_gate_failure');
    }
    return result;
}

function validateEnvironment(env) {
    const values = {
        imageRef: String(env.IMAGE_REF || ''),
        imageId: String(env.EXPECTED_IMAGE_ID || ''),
        apiName: String(env.I6_TOPOLOGY_API_NAME || ''),
        peerName: String(env.I6_PRIVATE_PEER_NAME || ''),
        networkName: String(env.I6_PRIVATE_NETWORK_NAME || ''),
        sentinelName: String(env.I6_EGRESS_SENTINEL_NAME || ''),
        sentinelNetworkName: String(env.I6_SENTINEL_NETWORK_NAME || ''),
        uid: String(env.SERVICE_UID || ''),
        gid: String(env.SERVICE_GID || ''),
        evidenceDir: String(env.EVIDENCE_DIR || ''),
        runnerTemp: String(env.RUNNER_TEMP || ''),
        evidenceSubdir: String(env.EVIDENCE_SUBDIR || '')
    };
    const names = [
        values.apiName,
        values.peerName,
        values.networkName,
        values.sentinelName,
        values.sentinelNetworkName
    ];
    if (!values.imageRef || values.imageRef.length > 512 || !IMAGE_ID.test(values.imageId)
        || names.some((value) => !NAME.test(value)) || new Set(names).size !== names.length
        || !POSITIVE_ID.test(values.uid) || !POSITIVE_ID.test(values.gid)) {
        fail('environment_contract_failure');
    }
    const expectedEvidence = path.resolve(values.runnerTemp, values.evidenceSubdir);
    if (values.evidenceDir !== expectedEvidence
        || fs.realpathSync(expectedEvidence) !== expectedEvidence) {
        fail('evidence_boundary_failure');
    }
    return values;
}

function encode(source) {
    return Buffer.from(source, 'utf8').toString('base64');
}

function parseJsonResult(result, label) {
    if (result.stderr || Buffer.byteLength(result.stdout || '') > 4096) {
        fail(`${label}_output_failure`);
    }
    try {
        return JSON.parse(String(result.stdout || '').trim());
    } catch {
        fail(`${label}_json_failure`);
    }
}

function parseTransport(result, label) {
    const payload = parseJsonResult(result, label);
    const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).sort() : [];
    if (JSON.stringify(keys) !== JSON.stringify(['dns', 'tcp', 'udp'])
        || Object.values(payload).some((value) => typeof value !== 'boolean')) {
        fail(`${label}_probe_failure`);
    }
    return payload;
}

function allTransport(payload, expected) {
    return ['dns', 'tcp', 'udp'].every((key) => payload[key] === expected);
}

function validationLabels(values) {
    return [
        '--label', `${VALIDATION_LABEL}=true`,
        '--label', `${IMAGE_LABEL}=${values.imageId}`
    ];
}

function hardenedArgs(values, limits) {
    return [
        '--user', `${values.uid}:${values.gid}`,
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--read-only',
        '--pids-limit', limits.pids,
        '--memory', limits.memory,
        '--memory-swap', limits.memory,
        '--cpus', limits.cpus,
        '--stop-timeout', limits.stop,
        '--no-healthcheck',
        '--log-driver', 'json-file',
        '--log-opt', `max-size=${limits.logSize}`,
        '--log-opt', `max-file=${limits.logFiles}`
    ];
}

function createNetworks(values) {
    run([
        'network', 'create', '--driver', 'bridge', '--internal', '--subnet', INTERNAL_SUBNET,
        ...validationLabels(values), values.networkName
    ], {failure: 'private_network_create_failure'});
    run([
        'network', 'create', '--driver', 'bridge', '--subnet', SENTINEL_SUBNET,
        ...validationLabels(values), values.sentinelNetworkName
    ], {failure: 'sentinel_network_create_failure'});
}

function createSentinel(values) {
    run([
        'run', '--detach', '--name', values.sentinelName, '--pull', 'never', '--restart', 'no',
        '--network', values.sentinelNetworkName, '--ip', SENTINEL_IP,
        ...hardenedArgs(values, {
            pids: '64', memory: '128m', cpus: '0.25', stop: '5', logSize: '1m', logFiles: '1'
        }),
        '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0',
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=16m,uid=${values.uid},gid=${values.gid},mode=0700`,
        ...validationLabels(values), '--entrypoint', 'node', values.imageRef,
        '-e', ENCODED_EVAL, encode(SENTINEL_LISTENER), SENTINEL_HOST, SENTINEL_IP
    ], {failure: 'sentinel_container_start_failure'});
}

function createApi(values) {
    const args = [
        'run', '--detach', '--name', values.apiName, '--pull', 'never', '--restart', 'no',
        '--network', values.networkName, '--ip', API_IP, '--network-alias', API_ALIAS,
        '--dns', SENTINEL_IP,
        ...hardenedArgs(values, {
            pids: '512', memory: '4g', cpus: '2', stop: '30', logSize: '20m', logFiles: '5'
        }),
        '--tmpfs', `/app/input:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--tmpfs', `/app/output:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--tmpfs', `/app/configs/pricing-state:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--env', `EXPECTED_SERVICE_UID=${values.uid}`,
        '--env', `EXPECTED_SERVICE_GID=${values.gid}`,
        '--env', 'EXPECTED_PIDS_LIMIT=512',
        '--env', 'EXPECTED_MEMORY_BYTES=4294967296',
        '--env', 'EXPECTED_CPU_LIMIT=2.0',
        '--env', 'EXPECTED_LOG_MAX_SIZE=20m',
        '--env', 'EXPECTED_LOG_MAX_FILES=5',
        '--env', 'EXPECTED_STOP_GRACE_PERIOD=30s',
        '--env', 'TRUST_PROXY=true',
        '--env', `TRUST_PROXY_CIDRS=${PEER_IP}`,
        '--env', `SLICE_CORS_ALLOWED_ORIGINS=${ORIGIN}`,
        '--env', `PRICING_CORS_ALLOWED_ORIGINS=${ORIGIN}`,
        '--env', `ARTIFACT_CORS_ALLOWED_ORIGINS=${ORIGIN}`,
        '--env', `OPERATIONS_CORS_ALLOWED_ORIGINS=${ORIGIN}`
    ];
    for (const [name, value] of Object.entries(CREDENTIALS)) {
        args.push('--env', `${name}=${value}`);
    }
    args.push(...validationLabels(values), values.imageRef);
    run(args, {failure: 'api_container_start_failure'});
}

function createPeer(values) {
    run([
        'run', '--detach', '--name', values.peerName, '--pull', 'never', '--restart', 'no',
        '--network', values.networkName, '--ip', PEER_IP, '--network-alias', PEER_ALIAS,
        ...hardenedArgs(values, {
            pids: '64', memory: '128m', cpus: '0.25', stop: '5', logSize: '1m', logFiles: '1'
        }),
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=16m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--env', `OPERATIONS_API_KEY=${OPERATIONS_KEY}`,
        ...validationLabels(values), '--entrypoint', 'node', values.imageRef,
        '-e', ENCODED_EVAL, encode(PEER_HOLD)
    ], {failure: 'peer_container_start_failure'});
}

function inspectJson(kind, name) {
    const output = run([kind, 'inspect', name]).stdout;
    try {
        const parsed = JSON.parse(output);
        if (!Array.isArray(parsed) || parsed.length !== 1) fail('docker_command_failure');
        return parsed[0];
    } catch {
        fail('docker_command_failure');
    }
}

function inspectSentinel(values) {
    const result = validateSentinelTopology({
        network: inspectJson('network', values.sentinelNetworkName),
        container: inspectJson('container', values.sentinelName),
        networkName: values.sentinelNetworkName,
        imageId: values.imageId,
        uid: values.uid,
        gid: values.gid,
        syntheticIp: SENTINEL_IP
    });
    if (!result.ok) fail(result.reason);
}

function apiRuntimeProbe(values) {
    const result = run([
        'exec', values.apiName, 'node', '-e', ENCODED_EVAL, encode(API_RUNTIME_PROBE)
    ], {
        timeout: 10_000,
        capability: 'private_runtime_probe_unavailable',
        failure: 'private_runtime_probe_execution_failure'
    });
    if (result.stderr || Buffer.byteLength(result.stdout || '') > 4096) {
        fail('private_runtime_probe_execution_failure');
    }
    try {
        return JSON.parse(String(result.stdout || '').trim());
    } catch {
        fail('private_runtime_probe_execution_failure');
    }
}

function inspectTopology(values) {
    const api = validateApiTopology({
        network: inspectJson('network', values.networkName),
        container: inspectJson('container', values.apiName),
        networkName: values.networkName,
        containerName: values.apiName,
        imageId: values.imageId,
        uid: values.uid,
        gid: values.gid,
        runtimeProbe: apiRuntimeProbe(values)
    });
    if (!api.ok) fail(api.reason);
    const peer = validatePeerTopology({
        container: inspectJson('container', values.peerName),
        networkName: values.networkName,
        containerName: values.peerName,
        imageId: values.imageId,
        uid: values.uid,
        gid: values.gid,
        operationsKey: OPERATIONS_KEY
    });
    if (!peer.ok) fail(peer.reason);
}

function probeNodeTransport(values) {
    return run([
        'exec', values.apiName, 'node', '-e', ENCODED_EVAL,
        encode(NODE_TRANSPORT_PROBE), SENTINEL_HOST, SENTINEL_IP
    ], {timeout: 10_000, failure: 'api_egress_probe_execution_failure'});
}

function probeNativeTransport(values) {
    return run([
        'exec', values.apiName, 'node', '-e', ENCODED_EVAL,
        encode(NATIVE_CHILD_WRAPPER), encode(PYTHON_TRANSPORT_PROBE)
    ], {timeout: 10_000, failure: 'native_egress_probe_execution_failure'});
}

async function calibrateSentinel(values) {
    inspectSentinel(values);
    run([
        'network', 'connect', '--ip', CALIBRATION_API_IP,
        values.sentinelNetworkName, values.apiName
    ], {failure: 'sentinel_probe_attach_failure'});
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const api = parseTransport(probeNodeTransport(values), 'api');
        const native = parseTransport(probeNativeTransport(values), 'native');
        if (allTransport(api, true) && allTransport(native, true)) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    fail('sentinel_not_operational');
}

function detachSentinel(values) {
    run([
        'network', 'disconnect', values.sentinelNetworkName, values.apiName
    ], {failure: 'sentinel_probe_detach_failure'});
}

function proveEgressDenied(values) {
    const api = parseTransport(probeNodeTransport(values), 'api');
    const native = parseTransport(probeNativeTransport(values), 'native');
    return {
        api: allTransport(api, false),
        native: allTransport(native, false)
    };
}

function egressFailureReason(denied) {
    if (!denied.api && !denied.native) return 'api_and_native_egress_not_denied';
    return denied.api ? 'native_egress_not_denied' : 'api_egress_not_denied';
}

function probePrivatePeer(values) {
    const result = run([
        'exec', values.peerName, 'node', '-e', ENCODED_EVAL,
        encode(PEER_HTTP_PROBE), API_ALIAS, '3000'
    ], {
        timeout: 10_000,
        capability: 'private_peer_probe_unavailable',
        capabilityClassification: 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY',
        failure: 'private_peer_probe_execution_failure',
        failureClassification: 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY'
    });
    const payload = parseJsonResult(result, 'private_peer');
    const expected = ['authRejectionProof', 'authenticatedReadiness', 'privatePeerIngress'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(expected)
        || Object.values(payload).some((value) => typeof value !== 'boolean')) {
        fail('private_peer_probe_shape_failure');
    }
    return payload;
}

async function awaitPrivatePeer(values) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const proof = probePrivatePeer(values);
        if (proof.privatePeerIngress) return proof;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
        privatePeerIngress: false,
        authenticatedReadiness: false,
        authRejectionProof: false
    };
}

function writeEvidence(values, evidence) {
    const target = path.join(values.evidenceDir, 'topology-evidence.json');
    fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600
    });
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024
        || path.dirname(fs.realpathSync(target)) !== values.evidenceDir) {
        fail('topology_evidence_boundary_failure');
    }
}

function writeOutputs(classification, sentinelOperational, contractReason) {
    if (!process.env.GITHUB_OUTPUT) return;
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `classification=${classification}\nsentinel_operational=${sentinelOperational}\n`
        + `contract_reason=${contractReason}\n`);
}

function blankEvidence() {
    return {
        version: 'i6-s5-private-peer-v1',
        classification: 'topology_gate_failure',
        contractReason: 'unclassified_failure',
        privatePeerIngress: false,
        authenticatedReadiness: false,
        authRejectionProof: false,
        apiEgressDenied: false,
        nativeEgressDenied: false,
        hostPortAbsent: false,
        apiNoDefaultRoute: false,
        internalNetwork: false,
        sentinelOperational: false
    };
}

async function main() {
    let values;
    const evidence = blankEvidence();
    try {
        values = validateEnvironment(process.env);
        createNetworks(values);
        createSentinel(values);
        createApi(values);
        createPeer(values);
        await calibrateSentinel(values);
        evidence.sentinelOperational = true;
        detachSentinel(values);
        inspectTopology(values);
        evidence.hostPortAbsent = true;
        evidence.apiNoDefaultRoute = true;
        evidence.internalNetwork = true;
        const denied = proveEgressDenied(values);
        evidence.apiEgressDenied = denied.api;
        evidence.nativeEgressDenied = denied.native;
        if (!denied.api || !denied.native) {
            fail(egressFailureReason(denied), 'BLOCKED_I6_EGRESS_ENFORCEMENT');
        }
        Object.assign(evidence, await awaitPrivatePeer(values));
        if (!evidence.privatePeerIngress) {
            fail('private_peer_ingress_unavailable', 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY');
        }
        if (!evidence.authenticatedReadiness && !evidence.authRejectionProof) {
            fail('authenticated_readiness_and_auth_rejection_unavailable',
                'BLOCKED_I6_PRIVATE_PEER_CAPABILITY');
        }
        if (!evidence.authenticatedReadiness) {
            fail('authenticated_readiness_unavailable', 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY');
        }
        if (!evidence.authRejectionProof) {
            fail('auth_rejection_proof_unavailable', 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY');
        }
        evidence.classification = 'success';
        evidence.contractReason = 'success';
        writeEvidence(values, evidence);
        writeOutputs('success', true, 'success');
    } catch (error) {
        const detail = TOPOLOGY_CONTRACT_REASONS.includes(error?.message)
            ? error.message : 'unclassified_failure';
        const classification = error?.classification || 'topology_gate_failure';
        evidence.classification = classification;
        evidence.contractReason = detail;
        if (values && !fs.existsSync(path.join(values.evidenceDir, 'topology-evidence.json'))) {
            writeEvidence(values, evidence);
        }
        writeOutputs(classification, evidence.sentinelOperational, detail);
        process.stderr.write(`::error title=I6 topology gate::${classification}:${detail}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) void main();

module.exports = {
    API_RUNTIME_PROBE,
    awaitPrivatePeer,
    calibrateSentinel,
    inspectTopology,
    probePrivatePeer,
    proveEgressDenied
};
