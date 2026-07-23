'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { SYNTHETIC_STL } = require('./i2-orca-runtime-smoke');

const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const MAX_COMMAND_BYTES = 128 * 1024;
const DOCKER_TIMEOUT_MS = 12 * 60 * 1000;
const EXPECTED_MEMORY = 4 * 1024 * 1024 * 1024;
const EXPECTED_NANO_CPUS = 2 * 1_000_000_000;
const ACTIVE_JOB_STOP_CLASSIFICATION = 'NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION';

function fail(code, capabilityBlocked = false) {
    const safe = /^[a-z0-9_]{1,80}$/.test(code) ? code : 'runtime_contract_failure';
    const classification = capabilityBlocked
        ? 'BLOCKED_S2_RUNTIME_CAPABILITY'
        : 'runtime_resource_contract_failure';
    const error = new Error(safe);
    error.code = safe;
    error.classification = classification;
    throw error;
}

function parsePositiveId(value, label) {
    const text = String(value || '');
    if (!POSITIVE_ID_PATTERN.test(text)) fail(`${label}_invalid`);
    const numeric = Number(text);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) fail(`${label}_invalid`);
    return numeric;
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: options.timeout || DOCKER_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_BYTES
    });
    if (result.error?.code === 'ETIMEDOUT' || result.error?.code === 'ENOENT') {
        fail(options.capability || 'runtime_command_unavailable', true);
    }
    if (result.error || result.status !== (options.status ?? 0) || result.signal) {
        if (options.nonzeroCapability && !result.error && result.status !== (options.status ?? 0)) {
            fail(options.capability || 'runtime_command_unavailable', true);
        }
        fail(options.failure || 'runtime_command_failure');
    }
    if (Buffer.byteLength(result.stdout || '', 'utf8') > MAX_COMMAND_BYTES
        || Buffer.byteLength(result.stderr || '', 'utf8') > MAX_COMMAND_BYTES) {
        fail('runtime_command_output_unbounded');
    }
    return result;
}

function parseInspectOutput(output) {
    const line = String(output || '').trimEnd();
    if (!line || line.includes('\n')) fail('runtime_inspect_shape_failure');
    const fields = line.split('\t');
    if (fields.length !== 16) fail('runtime_inspect_shape_failure');
    let values;
    try {
        values = fields.map((field) => JSON.parse(field));
    } catch {
        fail('runtime_inspect_parse_failure');
    }
    const [
        id, image, readOnly, pids, memory, memorySwap, nanoCpus, logDriver,
        logSize, logFiles, stopTimeout, capDrop, securityOpt, tmpfs, running, pid
    ] = values;
    return {
        id, image, readOnly, pids, memory, memorySwap, nanoCpus, logDriver,
        logSize, logFiles, stopTimeout, capDrop, securityOpt, tmpfs, running, pid
    };
}

function normalizeTmpfsOptions(value) {
    if (typeof value !== 'string') fail('tmpfs_options_invalid');
    return [...new Set(value.split(','))].sort();
}

function expectedTmpfs(uid, gid) {
    const restrictive = `rw,nosuid,nodev,noexec,size=64m,uid=${uid},gid=${gid},mode=0700`;
    return {
        '/app/input': restrictive,
        '/app/output': restrictive,
        '/app/configs/pricing-state': restrictive,
        '/tmp': restrictive
    };
}

function assertRuntimeInspect(record, expected) {
    if (!CONTAINER_ID_PATTERN.test(record.id) || record.image !== expected.imageId
        || record.readOnly !== true || record.pids !== 512
        || record.memory !== EXPECTED_MEMORY || record.memorySwap !== EXPECTED_MEMORY
        || record.nanoCpus !== EXPECTED_NANO_CPUS || record.logDriver !== 'json-file'
        || record.logSize !== '20m' || record.logFiles !== '5'
        || record.stopTimeout !== 30
        || JSON.stringify(record.capDrop) !== JSON.stringify(['ALL'])
        || !Array.isArray(record.securityOpt)
        || !record.securityOpt.includes('no-new-privileges')
        || record.running !== true || !Number.isSafeInteger(record.pid) || record.pid <= 0) {
        fail('runtime_host_config_mismatch');
    }
    if (!record.tmpfs || typeof record.tmpfs !== 'object' || Array.isArray(record.tmpfs)) {
        fail('runtime_tmpfs_shape_failure');
    }
    const expectedMounts = expectedTmpfs(expected.uid, expected.gid);
    if (JSON.stringify(Object.keys(record.tmpfs).sort()) !== JSON.stringify(Object.keys(expectedMounts).sort())) {
        fail('runtime_tmpfs_allowlist_failure');
    }
    for (const [target, options] of Object.entries(expectedMounts)) {
        if (JSON.stringify(normalizeTmpfsOptions(record.tmpfs[target]))
            !== JSON.stringify(normalizeTmpfsOptions(options))) {
            fail('runtime_tmpfs_options_failure');
        }
    }
}

const CONTAINER_PROBE = String.raw`
const fs = require('node:fs');
const [uidText, gidText, stl] = process.argv.slice(1);
const uid = Number(uidText);
const gid = Number(gidText);
const fail = (code) => { process.stderr.write(code); process.exit(41); };
if (process.getuid() !== uid || process.getgid() !== gid || uid <= 0 || gid <= 0) fail('kernel_identity');
const expectedEnvironment = {
  TMPDIR: '/tmp',
  HOME: '/tmp/slicer-home',
  XDG_CACHE_HOME: '/tmp/xdg-cache',
  XDG_CONFIG_HOME: '/tmp/xdg-config',
  XDG_RUNTIME_DIR: '/tmp/xdg-runtime'
};
for (const [key, value] of Object.entries(expectedEnvironment)) {
  if (process.env[key] !== value) fail('runtime_environment');
}
const immutable = [
  '/app/server.js', '/app/node_modules', '/app/configs', '/app/configs/prusa',
  '/app/configs/orca', '/opt/venv', '/opt/prusaslicer', '/opt/orcaslicer'
];
for (const target of immutable) {
  const stat = fs.lstatSync(target);
  if (stat.uid !== 0 || (stat.mode & 0o022) !== 0 || stat.isSymbolicLink()) fail('immutable_mode');
}
const denied = ['/app', '/app/configs', '/app/configs/prusa', '/app/configs/orca'];
for (const directory of denied) {
  const probe = directory + '/.i4-denied-probe';
  try { fs.writeFileSync(probe, 'x', { flag: 'wx', mode: 0o600 }); fail('immutable_write'); }
  catch (error) { if (!['EACCES', 'EROFS', 'EPERM'].includes(error.code)) fail('immutable_write_code'); }
}
const writable = ['/app/input', '/app/output', '/app/configs/pricing-state', '/tmp', '/tmp/slice-jobs'];
for (const directory of [
  '/tmp/slicer-home', '/tmp/xdg-cache', '/tmp/xdg-config', '/tmp/xdg-runtime'
]) writable.push(directory);
for (const directory of writable) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid
      || (stat.mode & 0o777) !== 0o700 || fs.realpathSync(directory) !== directory) fail('writable_mode');
  const probe = directory + '/.i4-write-probe';
  fs.writeFileSync(probe, 'x', { flag: 'wx', mode: 0o600 });
  fs.unlinkSync(probe);
}
async function readBounded(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > 65536) fail('http_response_bound');
    chunks.push(item.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function slice(engine) {
  const form = new FormData();
  form.append('choosenFile', new Blob([stl], { type: 'model/stl' }), 'i4-synthetic-cube.stl');
  form.append('layerHeight', '0.2');
  form.append('material', 'PLA');
  const response = await fetch('http://127.0.0.1:3000/' + engine + '/slice', {
    method: 'POST',
    headers: { 'x-slicer-api-key': process.env.SLICE_SERVICE_API_KEY },
    body: form,
    signal: AbortSignal.timeout(300000)
  });
  const text = await readBounded(response);
  let body;
  try { body = JSON.parse(text); } catch { fail('http_json'); }
  if (response.status !== 200 || body?.success !== true || body?.slicer_engine !== engine
      || !/^job-[a-f0-9]{32}$/.test(body?.job_id || '')
      || !/^artifact-[a-f0-9]{32}$/.test(body?.artifact_id || '')
      || text.includes('/app/') || text.includes('slice-jobs')) fail('slice_contract');
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function adminJson(path) {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    headers: { 'x-api-key': process.env.ADMIN_API_KEY },
    signal: AbortSignal.timeout(5000)
  });
  const text = await readBounded(response);
  let body;
  try { body = JSON.parse(text); } catch { fail('admin_json'); }
  if (response.status !== 200 || body?.success === false) fail('admin_contract');
  return body;
}
function outputEntries() {
  const entries = fs.readdirSync('/app/output').sort();
  if (entries.length > 32 || entries.some((entry) =>
    typeof entry !== 'string' || entry.length < 1 || entry.length > 160
    || entry.includes('/') || entry.includes('\\'))) fail('output_entries_bound');
  return entries;
}
async function outputInventory() {
  const body = await adminJson('/admin/output-files');
  if (body?.success !== true || !Number.isSafeInteger(body.total) || body.total !== body.files?.length
      || body.files.length < 2 || body.files.length > 16) fail('output_inventory_shape');
  return body.files.map((file) => {
    if (typeof file?.fileName !== 'string' || !/\.(?:gcode|sl1)$/.test(file.fileName)
        || !/^artifact-[a-f0-9]{32}$/.test(file?.artifact_id || '')
        || !/^job-[a-f0-9]{32}$/.test(file?.job_id || '')) fail('output_inventory_entry');
    return file.fileName + ':' + file.artifact_id;
  }).sort();
}
async function queueStatus() {
  const body = await adminJson('/health/detailed');
  const queue = body?.subsystems?.queue;
  if (!Number.isSafeInteger(queue?.activeJobs) || queue.activeJobs < 0
      || !Number.isSafeInteger(queue?.queueLength) || queue.queueLength < 0) fail('queue_status_shape');
  return queue;
}
async function awaitBoundedRequest(request) {
  return Promise.race([
    request,
    sleep(5000).then(() => ({ timedOut: true }))
  ]);
}
async function proveClientAbortNoArtifact() {
  const beforeInventory = await outputInventory();
  const beforeEntries = outputEntries();
  const controller = new AbortController();
  const form = new FormData();
  form.append('choosenFile', new Blob([stl], { type: 'model/stl' }), 'i4-aborted-cube.stl');
  form.append('layerHeight', '0.1');
  form.append('material', 'PLA');
  let requestSettled = false;
  const request = fetch('http://127.0.0.1:3000/orca/slice', {
    method: 'POST',
    headers: { 'x-slicer-api-key': process.env.SLICE_SERVICE_API_KEY },
    body: form,
    signal: controller.signal
  }).then(async (response) => ({
    response,
    text: await readBounded(response)
  }), (error) => ({ error })).finally(() => { requestSettled = true; });

  let activeObserved = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const queue = await queueStatus();
    if (queue.activeJobs === 1) {
      activeObserved = true;
      break;
    }
    if (requestSettled) break;
    await sleep(25);
  }
  if (!activeObserved) {
    controller.abort();
    await awaitBoundedRequest(request);
    fail('abort_active_not_observed');
  }
  controller.abort();
  const outcome = await awaitBoundedRequest(request);
  if (outcome.timedOut || !outcome.error || outcome.error.name !== 'AbortError') {
    fail('client_abort_not_observed');
  }

  let settled = false;
  for (const delay of [100, 200, 400, 800, 1600, 3200, 6400]) {
    await sleep(delay);
    const queue = await queueStatus();
    if (queue.activeJobs === 0 && queue.queueLength === 0) {
      settled = true;
      break;
    }
  }
  if (!settled) fail('client_abort_not_settled');
  const afterInventory = await outputInventory();
  const afterEntries = outputEntries();
  if (JSON.stringify(afterInventory) !== JSON.stringify(beforeInventory)
      || JSON.stringify(afterEntries) !== JSON.stringify(beforeEntries)) {
    fail('post_abort_artifact_detected');
  }
}
void (async () => {
  await slice('prusa');
  await slice('orca');
  await proveClientAbortNoArtifact();
  process.stdout.write(JSON.stringify({
    classification: 'success', immutableCount: immutable.length,
    writableCount: writable.length, authenticatedSliceCount: 2,
    authenticatedClientAbortCount: 1, postAbortArtifactDelta: 0
  }) + '\n');
})().catch(() => fail('slice_execution'));
`;

function parseProbeOutput(result) {
    if (result.stderr) fail('container_probe_stderr');
    const line = String(result.stdout || '').trimEnd();
    if (!line || line.includes('\n') || Buffer.byteLength(line, 'utf8') > 4096) {
        fail('container_probe_output');
    }
    let payload;
    try { payload = JSON.parse(line); } catch { fail('container_probe_json'); }
    if (JSON.stringify(payload) !== JSON.stringify({
        classification: 'success',
        immutableCount: 8,
        writableCount: 9,
        authenticatedSliceCount: 2,
        authenticatedClientAbortCount: 1,
        postAbortArtifactDelta: 0
    })) fail('container_probe_contract');
    return payload;
}

function inspectContainer(reference) {
    const format = [
        '{{json .Id}}', '{{json .Image}}', '{{json .HostConfig.ReadonlyRootfs}}',
        '{{json .HostConfig.PidsLimit}}', '{{json .HostConfig.Memory}}',
        '{{json .HostConfig.MemorySwap}}', '{{json .HostConfig.NanoCpus}}',
        '{{json .HostConfig.LogConfig.Type}}',
        '{{json (index .HostConfig.LogConfig.Config "max-size")}}',
        '{{json (index .HostConfig.LogConfig.Config "max-file")}}',
        '{{json .Config.StopTimeout}}', '{{json .HostConfig.CapDrop}}', '{{json .HostConfig.SecurityOpt}}',
        '{{json .HostConfig.Tmpfs}}', '{{json .State.Running}}', '{{json .State.Pid}}'
    ].join('\t');
    return parseInspectOutput(run('docker', [
        'container', 'inspect', '--format', format, reference
    ], { capability: 'docker_container_inspect_unavailable',
        failure: 'runtime_container_inspect_failure' }).stdout);
}

function appendSummary(payload) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '\n### S2 exact-image runtime envelope\n\n'
        + `Read-only root: \`true\`; immutable roots checked: \`${payload.immutableCount}\`; `
        + `writable allowlist checked: \`${payload.writableCount}\`; `
        + `authenticated synthetic slices: \`${payload.authenticatedSliceCount}\`; `
        + `active client-abort checks: \`${payload.authenticatedClientAbortCount}\`; `
        + `post-abort artifact delta: \`${payload.postAbortArtifactDelta}\`.\n`
        + 'Limits: `pids=512`, `memory=4g`, `swap=4g`, `cpus=2`, '
        + '`json-file=20m x 5`; tmpfs mounts are restrictive 64 MiB surfaces.\n');
}

function proveMalformedIdentityRejected(imageId, uid, gid) {
    for (const [expectedUid, expectedGid] of [['slicer', String(gid)], [String(uid), '0']]) {
        const result = run('docker', [
            'run', '--rm', '--pull', 'never', '--network', 'none',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--read-only', '--pids-limit', '64', '--memory', '1g', '--memory-swap', '1g',
            '--cpus', '0.5', '--stop-timeout', '10',
            '--log-driver', 'json-file', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=1',
            '--user', `${uid}:${gid}`,
            '--env', `EXPECTED_SERVICE_UID=${expectedUid}`,
            '--env', `EXPECTED_SERVICE_GID=${expectedGid}`,
            '--env', 'EXPECTED_PIDS_LIMIT=64',
            '--env', 'EXPECTED_MEMORY_BYTES=1073741824',
            '--env', 'EXPECTED_CPU_LIMIT=0.5',
            '--env', 'EXPECTED_LOG_MAX_SIZE=5m',
            '--env', 'EXPECTED_LOG_MAX_FILES=1',
            '--env', 'EXPECTED_STOP_GRACE_PERIOD=10s',
            '--label', 'io.s3a.validation-only=true',
            '--label', `io.s3a.expected-image-id=${imageId}`,
            imageId, '/usr/bin/true'
        ], { status: 78, capability: 'docker_identity_probe_unavailable',
            failure: 'malformed_identity_not_rejected' });
        if (result.stdout || result.stderr) fail('identity_probe_output_failure');
    }
}

function parseTopOutput(output) {
    const text = String(output || '').trim();
    if (!text || Buffer.byteLength(text, 'utf8') > 4096) fail('post_abort_process_output');
    const processes = text.split('\n').map((line) => {
        const match = line.match(/^\s*([1-9][0-9]*)\s+([0-9]+)\s+([A-Za-z0-9_.+-]{1,64})\s*$/);
        if (!match) fail('post_abort_process_shape');
        return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
    });
    if (processes.length < 1 || processes.length > 16
        || processes.some((process) => !Number.isSafeInteger(process.pid)
            || !Number.isSafeInteger(process.ppid))) fail('post_abort_process_bound');
    return processes;
}

function proveNoPostAbortDescendants(record) {
    const delayCell = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = run('docker', [
            'container', 'top', record.id, '-eo', 'pid=,ppid=,comm='
        ], {
            timeout: 5000,
            capability: 'docker_top_unavailable',
            failure: 'post_abort_process_probe_failure',
            nonzeroCapability: true
        });
        if (result.stderr) fail('post_abort_process_stderr');
        const processes = parseTopOutput(result.stdout);
        if (processes.length === 1 && processes[0].pid === record.pid) {
            fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
                'Post-abort process settlement: `PASS`; no descendant/native PID remained.\n');
            return;
        }
        if (attempt < 7) Atomics.wait(delayCell, 0, 0, 250);
    }
    fail('post_abort_orphan_process_detected');
}

function stopAndProveSettlement(record) {
    const stopped = run('docker', ['container', 'stop', '--time', '30', record.id], {
        timeout: 45_000,
        capability: 'docker_stop_unavailable',
        failure: 'graceful_stop_failure'
    });
    if (stopped.stderr || stopped.stdout.trim() !== record.id) fail('graceful_stop_output_failure');
    const format = '{{json .Id}}\t{{json .Image}}\t{{json .State.Running}}\t{{json .State.Pid}}';
    const state = run('docker', ['container', 'inspect', '--format', format, record.id], {
        failure: 'graceful_stop_inspect_failure'
    }).stdout.trimEnd().split('\t').map((field) => JSON.parse(field));
    if (state.length !== 4 || state[0] !== record.id || state[1] !== record.image
        || state[2] !== false || state[3] !== 0) fail('graceful_stop_state_failure');
    const processState = spawnSync('/usr/bin/ps', ['-p', String(record.pid), '-o', 'pid='], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 4096
    });
    if (processState.error?.code === 'ENOENT') fail('host_kernel_process_probe_unavailable', true);
    if (processState.error || processState.status !== 1 || processState.stdout || processState.signal) {
        fail('orphan_process_detected');
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        'Idle graceful stop: `PASS`; prior kernel PID absent after bounded 30-second stop. '
        + `Active-job graceful stop: \`${ACTIVE_JOB_STOP_CLASSIFICATION}\` `
        + '(separate host/container orchestration is not exercised by this bounded helper).\n');
}

function main(env = process.env) {
    const imageId = String(env.EXPECTED_IMAGE_ID || '');
    if (!IMAGE_ID_PATTERN.test(imageId)) fail('expected_image_id_invalid');
    const uid = parsePositiveId(env.SERVICE_UID, 'service_uid');
    const gid = parsePositiveId(env.SERVICE_GID, 'service_gid');
    const reference = String(env.CONTAINER_NAME || '');
    if (!/^s3a-validation-[0-9]+-[0-9]+$/.test(reference)) fail('container_reference_invalid');

    const record = inspectContainer(reference);
    assertRuntimeInspect(record, { imageId, uid, gid });
    proveMalformedIdentityRejected(imageId, uid, gid);
    const probe = run('docker', [
        'container', 'exec', '--user', `${uid}:${gid}`, '--env', 'NODE_NO_WARNINGS=1',
        record.id, '/usr/bin/node', '-e', CONTAINER_PROBE, String(uid), String(gid), SYNTHETIC_STL
    ], { capability: 'docker_exec_unavailable', failure: 'container_probe_failure' });
    const payload = parseProbeOutput(probe);
    appendSummary(payload);
    proveNoPostAbortDescendants(record);
    stopAndProveSettlement(record);
    fs.appendFileSync(env.GITHUB_OUTPUT, 'classification=success\n');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        const classification = error.classification || 'runtime_resource_contract_failure';
        process.stderr.write(`::error title=S2 runtime envelope::${classification}:${error.code || 'failure'}\n`);
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `classification=${classification}\n`);
        }
        process.exitCode = 1;
    }
}

module.exports = {
    CONTAINER_PROBE,
    expectedTmpfs,
    parseInspectOutput,
    parsePositiveId,
    assertRuntimeInspect,
    parseProbeOutput,
    proveMalformedIdentityRejected,
    parseTopOutput,
    proveNoPostAbortDescendants,
    stopAndProveSettlement,
    main
};
