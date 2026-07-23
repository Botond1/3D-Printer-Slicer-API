'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const POSITIVE_ID = /^[1-9][0-9]*$/;
const MAX_OUTPUT = 64 * 1024;
const HOST_PORT = 31000;
const PRIVATE_SUBNET = '198.51.100.0/28';
const SENTINEL_SUBNET = '192.0.2.0/28';
const SYNTHETIC_HOST = 'i5-egress-sentinel.validation';
const SYNTHETIC_IP = '192.0.2.2';
const ORIGIN = 'https://i5.validation.invalid';
const VALIDATION_LABEL = 'io.s3a.validation-only';
const IMAGE_LABEL = 'io.s3a.expected-image-id';
const CREDENTIALS = Object.freeze({
    SLICE_SERVICE_API_KEY: 'i5-validation-slice-active-260723-a1',
    SLICE_SERVICE_API_KEY_PREVIOUS: 'i5-validation-slice-previous-260723-a2',
    PRICING_API_KEY: 'i5-validation-pricing-active-260723-b1',
    PRICING_API_KEY_PREVIOUS: 'i5-validation-pricing-previous-260723-b2',
    ARTIFACT_API_KEY: 'i5-validation-artifact-active-260723-c1',
    ARTIFACT_API_KEY_PREVIOUS: 'i5-validation-artifact-previous-260723-c2',
    OPERATIONS_API_KEY: 'i5-validation-operations-active-260723-d1',
    OPERATIONS_API_KEY_PREVIOUS: 'i5-validation-operations-previous-260723-d2'
});

function fail(code, classification = 'topology_gate_failure') {
    const error = new Error(/^[a-z0-9_]{1,80}$/.test(code) ? code : 'unclassified_failure');
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
    if (result.error || result.signal || result.status !== (options.status ?? 0)) {
        fail(options.failure || 'docker_command_failure');
    }
    if (Buffer.byteLength(result.stdout || '') > MAX_OUTPUT
        || Buffer.byteLength(result.stderr || '') > MAX_OUTPUT) {
        fail('docker_output_unbounded');
    }
    return result;
}

function validateEnvironment(env) {
    const values = {
        imageRef: String(env.IMAGE_REF || ''),
        imageId: String(env.EXPECTED_IMAGE_ID || ''),
        containerName: String(env.I5_TOPOLOGY_PROBE_NAME || ''),
        networkName: String(env.I5_PRIVATE_NETWORK_NAME || ''),
        sentinelName: String(env.I5_EGRESS_SENTINEL_NAME || ''),
        sentinelNetworkName: String(env.I5_SENTINEL_NETWORK_NAME || ''),
        uid: String(env.SERVICE_UID || ''),
        gid: String(env.SERVICE_GID || ''),
        evidenceDir: String(env.EVIDENCE_DIR || ''),
        runnerTemp: String(env.RUNNER_TEMP || ''),
        evidenceSubdir: String(env.EVIDENCE_SUBDIR || '')
    };
    const names = [
        values.containerName, values.networkName, values.sentinelName, values.sentinelNetworkName
    ];
    if (!values.imageRef || !IMAGE_ID.test(values.imageId)
        || names.some((value) => !NAME.test(value)) || new Set(names).size !== names.length
        || !POSITIVE_ID.test(values.uid) || !POSITIVE_ID.test(values.gid)) {
        fail('environment_contract_failure');
    }
    const expectedEvidence = path.resolve(values.runnerTemp, values.evidenceSubdir);
    if (values.evidenceDir !== expectedEvidence || fs.realpathSync(expectedEvidence) !== expectedEvidence) {
        fail('evidence_boundary_failure');
    }
    return values;
}

function encode(source) {
    return Buffer.from(source, 'utf8').toString('base64');
}

const ENCODED_EVAL = String.raw`
const source=Buffer.from(process.argv[1],'base64').toString('utf8');
process.argv.splice(1,1);
eval(source);
`;

const SENTINEL_LISTENER = String.raw`
const net=require('node:net'),dgram=require('node:dgram');
const host=process.argv[1],ip=process.argv[2],token='i5-sentinel-live';
const ipBytes=Buffer.from(ip.split('.').map(Number));
const fail=()=>process.exit(41);
const tcp=net.createServer(socket=>{socket.on('error',()=>{});socket.end(token);});
const udp=dgram.createSocket('udp4');
const dns=dgram.createSocket('udp4');
for(const server of [tcp,udp,dns])server.on('error',fail);
udp.on('message',(_,peer)=>udp.send(token,peer.port,peer.address));
dns.on('message',(query,peer)=>{
  if(query.length<17)return;
  let offset=12;
  const labels=[];
  while(offset<query.length&&query[offset]!==0){
    const length=query[offset++];
    if(length===0||length>63||offset+length>query.length)return;
    labels.push(query.subarray(offset,offset+length).toString('ascii'));
    offset+=length;
  }
  const questionEnd=offset+5;
  if(questionEnd>query.length)return;
  const matches=labels.join('.').toLowerCase()===host
    &&query.readUInt16BE(offset+1)===1&&query.readUInt16BE(offset+3)===1;
  const header=Buffer.alloc(12);
  query.copy(header,0,0,2);
  header.writeUInt16BE(matches?0x8180:0x8183,2);
  header.writeUInt16BE(1,4);
  header.writeUInt16BE(matches?1:0,6);
  const question=query.subarray(12,questionEnd);
  const answer=matches
    ?Buffer.concat([Buffer.from([0xc0,0x0c,0x00,0x01,0x00,0x01,0,0,0,0,0,4]),ipBytes])
    :Buffer.alloc(0);
  dns.send(Buffer.concat([header,question,answer]),peer.port,peer.address);
});
Promise.all([
  new Promise(resolve=>tcp.listen(41234,'0.0.0.0',resolve)),
  new Promise(resolve=>udp.bind(41235,'0.0.0.0',resolve)),
  new Promise(resolve=>dns.bind(53,'0.0.0.0',resolve))
]).then(()=>process.stdout.write('sentinel-ready\n'),fail);
`;

const NODE_EGRESS_PROBE = String.raw`
const dns=require('node:dns').promises,net=require('node:net'),dgram=require('node:dgram');
const host=process.argv[1],ip=process.argv[2];
const tcp=()=>new Promise(resolve=>{
  const socket=net.createConnection({host:ip,port:41234});
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
  socket.setTimeout(1500,()=>finish(false));
  socket.once('connect',()=>finish(true));
  socket.once('error',()=>finish(false));
});
const udp=()=>new Promise(resolve=>{
  const socket=dgram.createSocket('udp4');
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();resolve(value);};
  const timer=setTimeout(()=>finish(false),1500);
  socket.once('message',()=>finish(true));
  socket.send(Buffer.from('i5'),41235,ip,error=>{if(error)finish(false);});
});
void(async()=>{
  let dnsResult=false;
  try{dnsResult=(await dns.lookup(host)).address===ip;}catch{}
  process.stdout.write(JSON.stringify({dns:dnsResult,tcp:await tcp(),udp:await udp()}));
})().catch(()=>process.exit(41));
`;

const PYTHON_EGRESS_PROBE = `
import json,socket
r={"dns":False,"tcp":False,"udp":False}
try:
 r["dns"]=socket.getaddrinfo("${SYNTHETIC_HOST}",0)[0][4][0]=="${SYNTHETIC_IP}"
except OSError: pass
try:
 s=socket.create_connection(("${SYNTHETIC_IP}",41234),1.5); s.close(); r["tcp"]=True
except OSError: pass
try:
 s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(1.5)
 s.sendto(b"i5",("${SYNTHETIC_IP}",41235)); s.recvfrom(32); s.close(); r["udp"]=True
except OSError: pass
print(json.dumps(r,separators=(",",":")))
`;

const NATIVE_CHILD_WRAPPER = String.raw`
const {spawnSync}=require('node:child_process');
const source=Buffer.from(process.argv[1],'base64').toString('utf8');
const child=spawnSync('/usr/bin/python3',['-c',source],{
  encoding:'utf8',timeout:6000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}
});
if(child.error||child.signal||child.status!==0||child.stderr)process.exit(42);
process.stdout.write(child.stdout);
`;

function parseProbe(result, label, expected) {
    if (result.stderr || Buffer.byteLength(result.stdout || '') > 4096) fail(`${label}_output_failure`);
    let payload;
    try {
        payload = JSON.parse(String(result.stdout || '').trim());
    } catch {
        fail(`${label}_json_failure`);
    }
    if (JSON.stringify(payload) !== JSON.stringify(expected)) fail(`${label}_probe_failure`);
    return payload;
}

function exactImageMismatch(container, values) {
    return container?.Image !== values.imageId;
}

function inspectSentinel(values) {
    const network = JSON.parse(run(['network', 'inspect', values.sentinelNetworkName]).stdout)[0];
    const container = JSON.parse(run(['container', 'inspect', values.sentinelName]).stdout)[0];
    const attachment = container?.NetworkSettings?.Networks?.[values.sentinelNetworkName];
    if (network?.Internal !== false || network?.Driver !== 'bridge'
        || network?.Labels?.[VALIDATION_LABEL] !== 'true'
        || network?.Labels?.[IMAGE_LABEL] !== values.imageId
        || Object.keys(container?.NetworkSettings?.Networks || {}).length !== 1
        || attachment?.IPAddress !== SYNTHETIC_IP
        || exactImageMismatch(container, values)
        || container?.Config?.Labels?.[VALIDATION_LABEL] !== 'true'
        || container?.Config?.Labels?.[IMAGE_LABEL] !== values.imageId
        || container?.HostConfig?.ReadonlyRootfs !== true
        || JSON.stringify(container?.HostConfig?.CapDrop) !== JSON.stringify(['ALL'])
        || container?.HostConfig?.Sysctls?.['net.ipv4.ip_unprivileged_port_start'] !== '0'
        || !container?.HostConfig?.SecurityOpt?.includes('no-new-privileges')) {
        fail('sentinel_topology_contract_failure');
    }
}

function inspectTopology(values) {
    const network = JSON.parse(run(['network', 'inspect', values.networkName]).stdout)[0];
    const container = JSON.parse(run(['container', 'inspect', values.containerName]).stdout)[0];
    const attachment = container?.NetworkSettings?.Networks?.[values.networkName];
    const published = container?.NetworkSettings?.Ports?.['3000/tcp'];
    const publish = Array.isArray(published) && published.length === 1 ? published[0] : null;
    if (network?.Internal !== true || network?.Driver !== 'bridge'
        || network?.Labels?.[VALIDATION_LABEL] !== 'true'
        || network?.Labels?.[IMAGE_LABEL] !== values.imageId
        || Object.keys(container?.NetworkSettings?.Networks || {}).length !== 1
        || !attachment || attachment.Gateway !== ''
        || exactImageMismatch(container, values)
        || container?.Config?.Labels?.[VALIDATION_LABEL] !== 'true'
        || container?.Config?.Labels?.[IMAGE_LABEL] !== values.imageId
        || JSON.stringify(container?.HostConfig?.Dns) !== JSON.stringify([SYNTHETIC_IP])
        || container?.HostConfig?.ReadonlyRootfs !== true
        || JSON.stringify(container?.HostConfig?.CapDrop) !== JSON.stringify(['ALL'])
        || !container?.HostConfig?.SecurityOpt?.includes('no-new-privileges')
        || publish?.HostIp !== '127.0.0.1' || publish?.HostPort !== String(HOST_PORT)) {
        fail('private_topology_contract_failure');
    }
}

function validationLabels(values) {
    return [
        '--label', 'io.s3a.validation-only=true',
        '--label', `io.s3a.expected-image-id=${values.imageId}`
    ];
}

function createNetworkAndContainer(values) {
    run([
        'network', 'create', '--driver', 'bridge', '--internal', '--subnet', PRIVATE_SUBNET,
        ...validationLabels(values), values.networkName
    ], { failure: 'private_network_create_failure' });
    run([
        'network', 'create', '--driver', 'bridge', '--subnet', SENTINEL_SUBNET,
        ...validationLabels(values), values.sentinelNetworkName
    ], { failure: 'sentinel_network_create_failure' });
    run([
        'run', '--detach', '--name', values.sentinelName, '--pull', 'never', '--restart', 'no',
        '--network', values.sentinelNetworkName, '--ip', SYNTHETIC_IP,
        '--user', `${values.uid}:${values.gid}`, '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--read-only', '--pids-limit', '64',
        '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0',
        '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.25',
        '--stop-timeout', '5', '--no-healthcheck', '--log-driver', 'json-file',
        '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1',
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=16m,uid=${values.uid},gid=${values.gid},mode=0700`,
        ...validationLabels(values), '--entrypoint', 'node', values.imageRef,
        '-e', ENCODED_EVAL, encode(SENTINEL_LISTENER), SYNTHETIC_HOST, SYNTHETIC_IP
    ], { failure: 'sentinel_container_start_failure' });
    const args = [
        'run', '--detach', '--name', values.containerName, '--pull', 'never', '--restart', 'no',
        '--network', values.networkName, '--publish', `127.0.0.1:${HOST_PORT}:3000`,
        '--dns', SYNTHETIC_IP,
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
        '--pids-limit', '512', '--memory', '4g', '--memory-swap', '4g', '--cpus', '2',
        '--stop-timeout', '30', '--log-driver', 'json-file',
        '--log-opt', 'max-size=20m', '--log-opt', 'max-file=5',
        '--tmpfs', `/app/input:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--tmpfs', `/app/output:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--tmpfs', `/app/configs/pricing-state:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=64m,uid=${values.uid},gid=${values.gid},mode=0700`,
        '--env', `EXPECTED_SERVICE_UID=${values.uid}`, '--env', `EXPECTED_SERVICE_GID=${values.gid}`,
        '--env', 'EXPECTED_PIDS_LIMIT=512', '--env', 'EXPECTED_MEMORY_BYTES=4294967296',
        '--env', 'EXPECTED_CPU_LIMIT=2.0', '--env', 'EXPECTED_LOG_MAX_SIZE=20m',
        '--env', 'EXPECTED_LOG_MAX_FILES=5', '--env', 'EXPECTED_STOP_GRACE_PERIOD=30s',
        '--env', `SLICE_CORS_ALLOWED_ORIGINS=${ORIGIN}`,
        '--env', `PRICING_CORS_ALLOWED_ORIGINS=${ORIGIN}`,
        '--env', `ARTIFACT_CORS_ALLOWED_ORIGINS=${ORIGIN}`,
        '--env', `OPERATIONS_CORS_ALLOWED_ORIGINS=${ORIGIN}`
    ];
    for (const [name, value] of Object.entries(CREDENTIALS)) args.push('--env', `${name}=${value}`);
    args.push(...validationLabels(values), values.imageRef);
    run(args, { failure: 'private_container_start_failure' });
}

function probeNode(values, failure) {
    return run([
        'exec', values.containerName, 'node', '-e', ENCODED_EVAL,
        encode(NODE_EGRESS_PROBE), SYNTHETIC_HOST, SYNTHETIC_IP
    ], { timeout: 10_000, failure });
}

async function awaitSentinelOperational(values) {
    inspectSentinel(values);
    run(['network', 'connect', values.sentinelNetworkName, values.containerName],
        { failure: 'sentinel_probe_attach_failure' });
    try {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                parseProbe(probeNode(values, 'sentinel_probe_execution_failure'), 'sentinel',
                    { dns: true, tcp: true, udp: true });
                return true;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
        fail('sentinel_not_operational');
    } finally {
        run(['network', 'disconnect', values.sentinelNetworkName, values.containerName],
            { failure: 'sentinel_probe_detach_failure' });
    }
}

async function boundedFetch(route, key) {
    const response = await fetch(`http://127.0.0.1:${HOST_PORT}${route}`, {
        headers: key ? { 'x-api-key': key } : {},
        signal: AbortSignal.timeout(1000)
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 32 * 1024) fail('ingress_response_unbounded');
    return { status: response.status, text };
}

async function awaitIngress() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const live = await boundedFetch('/health');
            const ready = await boundedFetch('/ready');
            const operations = await boundedFetch('/operations/readiness', CREDENTIALS.OPERATIONS_API_KEY);
            if (live.status === 200 && ready.status === 200 && operations.status === 200) {
                const body = JSON.parse(operations.text);
                if (body?.ready !== true) fail('authenticated_readiness_shape_failure');
                return true;
            }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

function parseDenial(result, label) {
    const expected = JSON.stringify({ dns: false, tcp: false, udp: false });
    const payload = parseProbe(result, label, JSON.parse(expected));
    return payload;
}

function runEgressProbes(values) {
    const api = probeNode(values, 'api_egress_probe_execution_failure');
    const native = run([
        'exec', values.containerName, 'node', '-e', ENCODED_EVAL,
        encode(NATIVE_CHILD_WRAPPER), encode(PYTHON_EGRESS_PROBE)
    ], { timeout: 10_000, failure: 'native_egress_probe_execution_failure' });
    return { api: parseDenial(api, 'api'), native: parseDenial(native, 'native') };
}

function writeEvidence(values, evidence) {
    const target = path.join(values.evidenceDir, 'topology-evidence.json');
    fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024
        || path.dirname(fs.realpathSync(target)) !== values.evidenceDir) {
        fail('topology_evidence_boundary_failure');
    }
}

function writeOutputs(classification, sentinelOperational) {
    if (!process.env.GITHUB_OUTPUT) return;
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `classification=${classification}\nsentinel_operational=${sentinelOperational}\n`);
}

async function main() {
    let values;
    const evidence = {
        classification: 'topology_gate_failure',
        sentinelOperational: false,
        internalNetwork: false,
        loopbackIngress: false,
        authenticatedReadiness: false,
        apiEgressDenied: false,
        nativeEgressDenied: false
    };
    try {
        values = validateEnvironment(process.env);
        createNetworkAndContainer(values);
        await awaitSentinelOperational(values);
        evidence.sentinelOperational = true;
        inspectTopology(values);
        evidence.internalNetwork = true;
        const denied = runEgressProbes(values);
        evidence.apiEgressDenied = Object.values(denied.api).every((value) => value === false);
        evidence.nativeEgressDenied = Object.values(denied.native).every((value) => value === false);
        evidence.loopbackIngress = await awaitIngress();
        if (!evidence.loopbackIngress) {
            evidence.classification = 'BLOCKED_S4_EGRESS_CAPABILITY';
            writeEvidence(values, evidence);
            fail('internal_network_loopback_ingress_unavailable', 'BLOCKED_S4_EGRESS_CAPABILITY');
        }
        evidence.authenticatedReadiness = true;
        evidence.classification = 'success';
        writeEvidence(values, evidence);
        writeOutputs('success', true);
    } catch (error) {
        if (values && !fs.existsSync(path.join(values.evidenceDir, 'topology-evidence.json'))) {
            evidence.classification = error?.classification || 'topology_gate_failure';
            writeEvidence(values, evidence);
        }
        const classification = error?.classification || 'topology_gate_failure';
        const detail = /^[a-z0-9_]{1,80}$/.test(error?.message || '')
            ? error.message : 'unclassified_failure';
        writeOutputs(classification, evidence.sentinelOperational);
        process.stderr.write(`::error title=I5 topology gate::${classification}:${detail}\n`);
        process.exitCode = 1;
    }
}

void main();
