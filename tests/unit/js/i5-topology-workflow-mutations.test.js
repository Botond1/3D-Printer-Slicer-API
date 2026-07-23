'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(ROOT, 'scripts/i5-topology-runtime-gate.js');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8').replace(/\r\n?/g, '\n');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');

function requireAnchors(source, anchors) {
    for (const anchor of anchors) assert.ok(source.includes(anchor), `missing contract: ${anchor}`);
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

function validateTopology(source) {
    requireAnchors(source, [
        "const MAX_OUTPUT = 64 * 1024;",
        "spawnSync('docker', args, {",
        'shell: false',
        'I5_EGRESS_SENTINEL_NAME',
        'I5_SENTINEL_NETWORK_NAME',
        "'network', 'create', '--driver', 'bridge', '--internal'",
        "'--publish', `127.0.0.1:${HOST_PORT}:3000`",
        "'--pull', 'never'",
        "'--dns', SYNTHETIC_IP",
        'net.createServer',
        "dgram.createSocket('udp4')",
        'sentinelOperational: false',
        'container?.Image !== values.imageId',
        'Object.keys(container?.NetworkSettings?.Networks || {}).length !== 1',
        'network?.Internal !== true',
        "const dns=require('node:dns').promises,net=require('node:net'),dgram=require('node:dgram');",
        'await dns.lookup(host)',
        'tcp:await tcp()',
        'udp:await udp()',
        `socket.getaddrinfo("\${SYNTHETIC_HOST}",0)`,
        `socket.create_connection(("\${SYNTHETIC_IP}",41234),1.5)`,
        'socket.SOCK_DGRAM',
        "JSON.stringify({ dns: false, tcp: false, udp: false })",
        "return { api: parseDenial(api, 'api'), native: parseDenial(native, 'native') };",
        "fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\\n`, { flag: 'wx', mode: 0o600 });",
        'stat.size < 2 || stat.size > 16 * 1024',
        'path.dirname(fs.realpathSync(target)) !== values.evidenceDir',
        'apiEgressDenied: false',
        'nativeEgressDenied: false'
    ]);
    requirePatterns(source, [
        ['run-owned sentinel container is started',
            /'run',\s*'--detach',\s*'--name',\s*values\.sentinelName[\s\S]{0,1600}'--network',\s*values\.sentinelNetworkName/],
        ['sentinel uses the synthetic target IP',
            /'--ip',\s*SYNTHETIC_IP/],
        ['sentinel ownership label is exact',
            /`io\.s3a\.expected-image-id=\$\{values\.imageId\}`/],
        ['sentinel liveness is proven before denial probes',
            /(?:awaitSentinel|verifySentinel|proveSentinel)[A-Za-z]*\s*\(/],
        ['sentinel liveness gates successful evidence',
            /evidence\.sentinelOperational\s*=\s*true/]
    ]);
}

function validateWorkflow(source) {
    const topology = workflowStep(source, 'topology_gate');
    const boundary = workflowStep(source, 'artifact_boundary');
    const cleanup = workflowStep(source, 'exact_cleanup');
    const final = workflowStep(source, 'final_enforcement');
    requireAnchors(topology, [
        "if: ${{ steps.runtime_identity.outcome == 'success' }}",
        'node scripts/i5-topology-runtime-gate.js'
    ]);
    requireAnchors(boundary, [
        "'topology-evidence.json': 16 * 1024",
        "'classification', 'sentinelOperational', 'internalNetwork', 'loopbackIngress'",
        "'authenticatedReadiness', 'apiEgressDenied', 'nativeEgressDenied'",
        'topology_evidence_schema_failure'
    ]);
    requireAnchors(cleanup, [
        '"$I5_TOPOLOGY_PROBE_NAME"',
        '"$I5_EGRESS_SENTINEL_NAME"',
        'docker network inspect "$I5_PRIVATE_NETWORK_NAME"',
        'docker network inspect "$I5_SENTINEL_NETWORK_NAME"',
        '[ "$expected_label" != "$EXPECTED_IMAGE_ID" ]',
        '[ "$internal_flag" != "true" ]',
        'docker network rm "$network_id"',
        'network_cleanup_verification_failure',
        'topology-evidence.json',
        'evidence_directory_boundary_failure',
        'rmdir -- "$expected_evidence_dir"',
        'classification=cleanup_failure'
    ]);
    requireAnchors(final, [
        'TOPOLOGY_OUTCOME: ${{ steps.topology_gate.outcome }}',
        'TOPOLOGY_CLASSIFICATION: ${{ steps.topology_gate.outputs.classification }}',
        'CLEANUP_OUTCOME: ${{ steps.exact_cleanup.outcome }}',
        "if (process.env.TOPOLOGY_OUTCOME !== 'success'\n"
            + "              || process.env.TOPOLOGY_CLASSIFICATION !== 'success') {",
        "failures.push(process.env.TOPOLOGY_CLASSIFICATION === 'BLOCKED_S4_EGRESS_CAPABILITY'",
        "failures.push('cleanup_failure');",
        'if (classifications.length > 0)',
        'process.exit(1);'
    ]);
}

function mutate(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replace(from, to);
}

test('topology runtime gate rejects exact-image, private-ingress, and egress mutations', async (t) => {
    validateTopology(SCRIPT);
    const cases = [
        ['exact image identity ignored', 'container?.Image !== values.imageId', 'false'],
        ['sentinel container start removed', "'--name', values.sentinelName", "'--name', values.containerName"],
        ['sentinel network attachment removed',
            "'--network', values.sentinelNetworkName", "'--network', values.networkName"],
        ['sentinel synthetic IP removed', "'--ip', SYNTHETIC_IP", "'--ip', '127.0.0.1'"],
        ['API DNS target detached from sentinel', "'--dns', SYNTHETIC_IP", "'--dns', '127.0.0.1'"],
        ['sentinel liveness result ignored',
            'evidence.sentinelOperational = true', 'evidence.sentinelOperational = false'],
        ['internal network removed', "'--internal', '--subnet'", "'--subnet'"],
        ['loopback publish broadened', '127.0.0.1:${HOST_PORT}:3000', '0.0.0.0:${HOST_PORT}:3000'],
        ['API DNS probe disabled', 'await dns.lookup(host)', 'Promise.resolve({address:null})'],
        ['API TCP probe disabled', 'tcp:await tcp()', 'tcp:false'],
        ['API UDP probe disabled', 'udp:await udp()', 'udp:false'],
        ['native DNS probe disabled', `socket.getaddrinfo("\${SYNTHETIC_HOST}",0)`, '[]'],
        ['native TCP probe disabled',
            `socket.create_connection(("\${SYNTHETIC_IP}",41234),1.5)`, 'None'],
        ['native UDP probe disabled', 'socket.SOCK_DGRAM', 'socket.SOCK_STREAM'],
        ['evidence exclusive create weakened', "flag: 'wx'", "flag: 'w'"],
        ['evidence size bound relaxed', 'stat.size > 16 * 1024', 'stat.size > 32 * 1024']
    ];
    for (const [name, from, to] of cases) await t.test(name, () => {
        assert.throws(() => validateTopology(mutate(SCRIPT, from, to)), assert.AssertionError);
    });
});

test('image workflow rejects evidence, cleanup, and final aggregation mutations', async (t) => {
    validateWorkflow(WORKFLOW);
    const cases = [
        ['topology gate invocation removed',
            'node scripts/i5-topology-runtime-gate.js', 'node --version'],
        ['topology evidence bound relaxed',
            "'topology-evidence.json': 16 * 1024", "'topology-evidence.json': 32 * 1024"],
        ['sentinel container omitted from cleanup',
            '"$I5_EGRESS_SENTINEL_NAME"', '"$I5_TOPOLOGY_PROBE_NAME"'],
        ['sentinel network omitted from cleanup',
            'docker network inspect "$I5_SENTINEL_NETWORK_NAME"',
            'docker network inspect "$I5_PRIVATE_NETWORK_NAME"'],
        ['topology probe omitted from cleanup',
            '"$I2_ORCA_PROBE_NAME" "$I5_TOPOLOGY_PROBE_NAME" "$CONTAINER_NAME"',
            '"$I2_ORCA_PROBE_NAME" "$CONTAINER_NAME"'],
        ['exact network removal omitted',
            'docker network rm "$network_id"', 'true'],
        ['topology evidence omitted from cleanup',
            'topology-evidence.json sbom.spdx.json', 'sbom.spdx.json'],
        ['topology omitted from final aggregation',
            "if (process.env.TOPOLOGY_OUTCOME !== 'success'\n"
                + "              || process.env.TOPOLOGY_CLASSIFICATION !== 'success') {",
            'if (false) {'],
        ['cleanup omitted from final aggregation',
            "failures.push('cleanup_failure');", 'failures.push();']
    ];
    for (const [name, from, to] of cases) await t.test(name, () => {
        assert.throws(() => validateWorkflow(mutate(WORKFLOW, from, to)), assert.AssertionError);
    });
});
