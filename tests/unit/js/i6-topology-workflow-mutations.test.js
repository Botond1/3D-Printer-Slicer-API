'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(ROOT, 'scripts/i6-topology-runtime-gate.js');
const PROBES_PATH = path.join(ROOT, 'scripts/i6-topology-probes.js');
const CONTRACT_PATH = path.join(ROOT, 'scripts/i6-topology-contract.js');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8').replace(/\r\n?/g, '\n');
const PROBES = fs.readFileSync(PROBES_PATH, 'utf8').replace(/\r\n?/g, '\n');
const CONTRACT = fs.readFileSync(CONTRACT_PATH, 'utf8').replace(/\r\n?/g, '\n');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');

function requireAnchors(source, anchors) {
    for (const anchor of anchors) {
        assert.ok(source.includes(anchor), `missing contract: ${anchor}`);
    }
}

function requirePatterns(source, patterns) {
    for (const [label, pattern] of patterns) {
        assert.match(source, pattern, `missing contract: ${label}`);
    }
}

function workflowStep(source, id) {
    const lines = source.split('\n');
    const idLine = lines.findIndex((line) => line === `        id: ${id}`);
    assert.notEqual(idLine, -1, `missing workflow step ${id}`);
    let start = idLine;
    while (start >= 0 && !lines[start].startsWith('      - name:')) start -= 1;
    let end = idLine + 1;
    while (end < lines.length && !lines[end].startsWith('      - name:')) end += 1;
    return lines.slice(start, end).join('\n');
}

function validateTopology(source, probes) {
    requireAnchors(source, [
        'const MAX_OUTPUT = 64 * 1024;',
        "spawnSync('docker', args, {",
        'shell: false',
        'I6_TOPOLOGY_API_NAME',
        'I6_PRIVATE_PEER_NAME',
        'I6_PRIVATE_NETWORK_NAME',
        'I6_EGRESS_SENTINEL_NAME',
        'I6_SENTINEL_NETWORK_NAME',
        "'network', 'create', '--driver', 'bridge', '--internal', '--subnet', INTERNAL_SUBNET",
        "'--network', values.networkName, '--ip', API_IP, '--network-alias', API_ALIAS",
        "'--network', values.networkName, '--ip', PEER_IP, '--network-alias', PEER_ALIAS",
        "'--env', `OPERATIONS_API_KEY=${OPERATIONS_KEY}`",
        "'exec', values.peerName, 'node', '-e', ENCODED_EVAL",
        "'--env', 'TRUST_PROXY=true'",
        "'--env', `TRUST_PROXY_CIDRS=${PEER_IP}`",
        "'--pull', 'never'",
        "'network', 'connect', '--ip', CALIBRATION_API_IP",
        "'network', 'disconnect', values.sentinelNetworkName, values.apiName",
        'const api = parseTransport(probeNodeTransport(values)',
        'const native = parseTransport(probeNativeTransport(values)',
        'if (allTransport(api, true) && allTransport(native, true)) return;',
        'api: allTransport(api, false)',
        'native: allTransport(native, false)',
        'validateApiTopology({',
        'validatePeerTopology({',
        'validateSentinelTopology({',
        "encode(PEER_HTTP_PROBE), API_ALIAS, '3000'",
        "fail('private_peer_ingress_unavailable', 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY')",
        "fail(egressFailureReason(denied), 'BLOCKED_I6_EGRESS_ENFORCEMENT')",
        'hostPortAbsent: false',
        'apiNoDefaultRoute: false',
        'authRejectionProof: false',
        "fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\\n`, {",
        "flag: 'wx'",
        'stat.size > 16 * 1024',
        'path.dirname(fs.realpathSync(target)) !== values.evidenceDir'
    ]);
    assert.doesNotMatch(source, /'--publish'|--network host|docker\.sock/);
    requirePatterns(source, [
        ['sentinel is attached before calibration',
            /calibrateSentinel[\s\S]{0,1200}'network',\s*'connect'/],
        ['sentinel calibration requires both Node and native transport probes',
            /async function calibrateSentinel[\s\S]{0,1400}const api = parseTransport\(probeNodeTransport\(values\)[\s\S]{0,300}const native = parseTransport\(probeNativeTransport\(values\)[\s\S]{0,300}allTransport\(api, true\) && allTransport\(native, true\)/],
        ['sentinel detachment precedes exact topology inspection',
            /detachSentinel\(values\);[\s\S]{0,120}inspectTopology\(values\);/],
        ['exact-image peer is hardened before entrypoint override',
            /function createPeer[\s\S]{0,1800}hardenedArgs[\s\S]{0,1800}'--entrypoint',\s*'node',\s*values\.imageRef/]
    ]);
    requireAnchors(probes, [
        "await request('/health')",
        "await request('/ready')",
        "await request('/operations/readiness',process.env.OPERATIONS_API_KEY)",
        "await request('/operations/readiness')",
        "'i6-wrong-operations-key-260725-z9'",
        "value.body.errorCode==='OPERATIONS_AUTH_REQUIRED'",
        "exactKeys(value.body,['status','uptime'])",
        "exactKeys(value.body,['status'])",
        "exactKeys(body,['checkedAt','ready','admissionOpen','probes','reasonCodes','queue','legacyMigration'])",
        'if(size>32768)',
        'socket.getaddrinfo("${SENTINEL_HOST}",0)',
        'socket.create_connection(("${SENTINEL_IP}",41234),1.5)',
        'socket.SOCK_DGRAM',
        'externalDefaultRoute'
    ]);
}

function validateContract(source) {
    requireAnchors(source, [
        "const INTERNAL_SUBNET = '198.51.100.0/28';",
        "const API_IP = '198.51.100.2';",
        "const PEER_IP = '198.51.100.3';",
        "const API_ALIAS = 'i6-api.private';",
        "const PEER_ALIAS = 'i6-peer.private';",
        'network.IPAM.Config[0].Subnet !== INTERNAL_SUBNET',
        'host.NetworkMode !== expected.networkName',
        'endpoint.IPAddress !== expected.ip',
        'JSON.stringify(endpoint.Aliases) !== JSON.stringify([expected.alias])',
        'containerId.slice(0, 12)',
        'Array.isArray(endpoint.DNSNames)',
        "if (container.Image !== imageId) return { ok: false, reason: 'api_image_mismatch' };",
        'container.Config.User !== `${uid}:${gid}`',
        'host.ReadonlyRootfs !== true',
        "JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])",
        'host.CapAdd',
        "JSON.stringify(host.SecurityOpt) !== JSON.stringify(['no-new-privileges'])",
        'host.PublishAllPorts !== false',
        'api_default_route_present',
        'host.Privileged !== false',
        "host.PidMode === 'host'",
        'host.Binds',
        'container.Mounts',
        'SCOPED_CREDENTIALS',
        "`OPERATIONS_API_KEY=${operationsKey}`",
        "`TRUST_PROXY_CIDRS=${PEER_IP}`"
    ]);
}

function validateWorkflow(source) {
    requireAnchors(source, [
        'I6_TOPOLOGY_API_NAME:',
        'I6_PRIVATE_PEER_NAME:',
        'I6_PRIVATE_NETWORK_NAME:',
        'I6_EGRESS_SENTINEL_NAME:',
        'I6_SENTINEL_NETWORK_NAME:'
    ]);
    const topology = workflowStep(source, 'topology_gate');
    const boundary = workflowStep(source, 'artifact_boundary');
    const cleanup = workflowStep(source, 'exact_cleanup');
    const evidenceCleanup = workflowStep(source, 'evidence_cleanup');
    const final = workflowStep(source, 'final_enforcement');
    requireAnchors(topology, [
        "if: ${{ steps.runtime_identity.outcome == 'success' }}",
        'node scripts/i6-topology-runtime-gate.js'
    ]);
    requireAnchors(boundary, [
        "'topology-evidence.json': 16 * 1024",
        "require('./scripts/i6-topology-evidence-contract')",
        'validateTopologyEvidence(topology)',
        'failBoundary(topologyEvidenceError)'
    ]);
    requireAnchors(cleanup, [
        '"$I6_TOPOLOGY_API_NAME"',
        '"$I6_PRIVATE_PEER_NAME"',
        '"$I6_EGRESS_SENTINEL_NAME"',
        'docker network inspect "$I6_PRIVATE_NETWORK_NAME"',
        'docker network inspect "$I6_SENTINEL_NETWORK_NAME"',
        '[ "$expected_label" != "$EXPECTED_IMAGE_ID" ]',
        'docker network rm "$network_id"',
        'network_cleanup_verification_failure',
        'classification=cleanup_failure'
    ]);
    requireAnchors(evidenceCleanup, [
        'topology-evidence.json',
        '${EVIDENCE_DIR:-}',
        'rmdir -- "$expected_evidence_dir"',
        'classification=evidence_cleanup_failure'
    ]);
    requireAnchors(final, [
        'TOPOLOGY_OUTCOME: ${{ steps.topology_gate.outcome }}',
        'TOPOLOGY_CLASSIFICATION: ${{ steps.topology_gate.outputs.classification }}',
        'TOPOLOGY_CONTRACT_REASON: ${{ steps.topology_gate.outputs.contract_reason }}',
        'CLEANUP_OUTCOME: ${{ steps.exact_cleanup.outcome }}',
        "'BLOCKED_I6_PRIVATE_PEER_CAPABILITY'",
        "'BLOCKED_I6_EGRESS_ENFORCEMENT'",
        "'BLOCKED_I6_RUNTIME_CAPABILITY'",
        "failures.push([",
        "? process.env.TOPOLOGY_CLASSIFICATION : 'topology_gate_failure'",
        "process.env.TOPOLOGY_CONTRACT_REASON !== 'success'",
        "failures.push('cleanup_failure');",
        'if (classifications.length > 0)',
        'process.exit(1);'
    ]);
}

function mutate(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replace(from, to);
}

test('topology runtime and probe sources reject private-peer and calibration mutations', async (t) => {
    validateTopology(SCRIPT, PROBES);
    const scriptCases = [
        ['internal network removed', "'--internal', '--subnet'", "'--subnet'"],
        ['API static IP changed', "'--ip', API_IP", "'--ip', '198.51.100.4'"],
        ['peer static IP changed', "'--ip', PEER_IP", "'--ip', '198.51.100.4'"],
        ['peer credential removed',
            "'--env', `OPERATIONS_API_KEY=${OPERATIONS_KEY}`", "'--env', 'PATH=/usr/bin'"],
        ['peer probe moved onto API container',
            "'exec', values.peerName, 'node', '-e', ENCODED_EVAL",
            "'exec', values.apiName, 'node', '-e', ENCODED_EVAL"],
        ['exact peer trust broadened',
            "'--env', `TRUST_PROXY_CIDRS=${PEER_IP}`", "'--env', 'TRUST_PROXY_CIDRS=198.51.100.0/28'"],
        ['sentinel calibration Node proof removed',
            'const api = parseTransport(probeNodeTransport(values)', 'const api = {dns:true,tcp:true,udp:true}; //'],
        ['sentinel calibration native proof removed',
            'const native = parseTransport(probeNativeTransport(values)', 'const native = {dns:true,tcp:true,udp:true}; //'],
        ['exact detachment removed',
            "'network', 'disconnect', values.sentinelNetworkName, values.apiName",
            "'network', 'inspect', values.sentinelNetworkName"],
        ['API denial ignored', 'api: allTransport(api, false)', 'api: true'],
        ['native denial ignored', 'native: allTransport(native, false)', 'native: true'],
        ['evidence exclusive create weakened', "flag: 'wx'", "flag: 'w'"],
        ['evidence size bound relaxed', 'stat.size > 16 * 1024', 'stat.size > 32 * 1024']
    ];
    for (const [name, from, to] of scriptCases) await t.test(name, () => {
        assert.throws(() => validateTopology(mutate(SCRIPT, from, to), PROBES), assert.AssertionError);
    });
    const probeCases = [
        ['health omitted', "await request('/health')", 'Promise.resolve({status:200,body:{}})'],
        ['ready omitted', "await request('/ready')", 'Promise.resolve({status:200,body:{}})'],
        ['authenticated readiness omitted',
            "await request('/operations/readiness',process.env.OPERATIONS_API_KEY)",
            'Promise.resolve({status:200,body:{ready:true}})'],
        ['missing auth rejection omitted',
            "await request('/operations/readiness')", 'Promise.resolve({status:401,body:{}})'],
        ['wrong auth rejection omitted',
            "'i6-wrong-operations-key-260725-z9'", 'process.env.OPERATIONS_API_KEY'],
        ['response bound relaxed', 'if(size>32768)', 'if(size>65536)'],
        ['Python TCP calibration omitted',
            'socket.create_connection(("${SENTINEL_IP}",41234),1.5)', 'None']
    ];
    for (const [name, from, to] of probeCases) await t.test(name, () => {
        assert.throws(() => validateTopology(SCRIPT, mutate(PROBES, from, to)), assert.AssertionError);
    });
});

test('pure inspect validators reject every high-risk topology mutation seam', async (t) => {
    validateContract(CONTRACT);
    const cases = [
        ['private subnet ignored',
            'network.IPAM.Config[0].Subnet !== INTERNAL_SUBNET', 'false'],
        ['network mode ignored', 'host.NetworkMode !== expected.networkName', 'false'],
        ['static IP ignored', 'endpoint.IPAddress !== expected.ip', 'false'],
        ['network alias ignored',
            'JSON.stringify(endpoint.Aliases) !== JSON.stringify([expected.alias])', 'false'],
        ['Docker DNS names ignored', 'Array.isArray(endpoint.DNSNames)', 'Array.isArray([])'],
        ['exact image ignored',
            "if (container.Image !== imageId) return { ok: false, reason: 'api_image_mismatch' };",
            'if (false) return { ok: false, reason: \'api_image_mismatch\' };'],
        ['published ports ignored', 'host.PublishAllPorts !== false', 'false'],
        ['privilege ignored', 'host.Privileged !== false', 'false'],
        ['host PID namespace ignored', "host.PidMode === 'host'", 'false'],
        ['credential scope ignored',
            "`OPERATIONS_API_KEY=${operationsKey}`", "'OPERATIONS_API_KEY=anything'"]
    ];
    for (const [name, from, to] of cases) await t.test(name, () => {
        assert.throws(() => validateContract(mutate(CONTRACT, from, to)), assert.AssertionError);
    });
});

test('image workflow rejects I6 invocation, evidence, cleanup, and enforcement mutations', async (t) => {
    validateWorkflow(WORKFLOW);
    const cases = [
        ['topology gate invocation removed',
            'node scripts/i6-topology-runtime-gate.js', 'node --version'],
        ['topology evidence bound relaxed',
            "'topology-evidence.json': 16 * 1024", "'topology-evidence.json': 32 * 1024"],
        ['topology reason validator removed', 'validateTopologyEvidence(topology)', 'null'],
        ['peer omitted from cleanup',
            '"$I6_PRIVATE_PEER_NAME"', '"$I6_TOPOLOGY_API_NAME"'],
        ['sentinel network omitted from cleanup',
            'docker network inspect "$I6_SENTINEL_NETWORK_NAME"',
            'docker network inspect "$I6_PRIVATE_NETWORK_NAME"'],
        ['exact network removal omitted', 'docker network rm "$network_id"', 'true'],
        ['topology evidence omitted from cleanup',
            'runtime-diagnostics.json topology-evidence.json sbom.spdx.json',
            'runtime-diagnostics.json sbom.spdx.json'],
        ['private-peer classification dropped',
            "'BLOCKED_I6_PRIVATE_PEER_CAPABILITY'", "'topology_gate_failure'"],
        ['egress classification dropped',
            "'BLOCKED_I6_EGRESS_ENFORCEMENT'", "'topology_gate_failure'"],
        ['runtime classification dropped',
            "'BLOCKED_I6_RUNTIME_CAPABILITY'", "'topology_gate_failure'"],
        ['topology success reason enforcement dropped',
            "process.env.TOPOLOGY_CONTRACT_REASON !== 'success'", 'false'],
        ['cleanup omitted from final aggregation',
            "failures.push('cleanup_failure');", 'failures.push();']
    ];
    for (const [name, from, to] of cases) await t.test(name, () => {
        assert.throws(() => validateWorkflow(mutate(WORKFLOW, from, to)), assert.AssertionError);
    });
});
