'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCUMENT_VERSION = 1;
const MAX_EVIDENCE_BYTES = 128 * 1024;
const MAX_COMMAND_BYTES = 32 * 1024;
const DOCKER_TIMEOUT_MS = 30_000;
const PATHS = Object.freeze(['/app', '/app/input', '/app/output', '/app/configs']);
const TMPFS_DEFAULT = Object.freeze([
    '/app/input:rw,nosuid,nodev,noexec,size=64m',
    '/app/output:rw,nosuid,nodev,noexec,size=64m'
]);
const NAME_KEYS = Object.freeze([
    'CONTAINER_NAME', 'I2_UID_PROBE_NAME', 'I2_GID_PROBE_NAME',
    'I2_PROBE_A_NAME', 'I2_PROBE_B_NAME', 'I2_PROBE_C_NAME'
]);

// This fixed program reads metadata only for the four declared runtime paths.
const PROBE_PROGRAM = String.raw`'use strict';
const fs=require('node:fs');
const paths=['/app','/app/input','/app/output','/app/configs'];
const safeCode=e=>e&&typeof e.code==='string'&&/^[A-Z0-9_]{1,32}$/.test(e.code)?e.code:'UNKNOWN';
function writeProbe(base){
  const directory=base+'/.i2-runtime-ownership-probe',target=directory+'/bounded-file';
  const result={directoryCreated:false,fileWritten:false,statUid:null,statGid:null,statMode:null,
    fileRemoved:false,directoryRemoved:false,errorCode:null};
  try{
    fs.mkdirSync(directory,{mode:0o700}); result.directoryCreated=true;
    fs.writeFileSync(target,Buffer.from('i2'),{flag:'wx',mode:0o600}); result.fileWritten=true;
    const stat=fs.lstatSync(target);
    result.statUid=stat.uid; result.statGid=stat.gid;
    result.statMode=(stat.mode&0o7777).toString(8).padStart(4,'0');
  }catch(error){result.errorCode=safeCode(error);}
  finally{
    if(result.fileWritten){try{fs.unlinkSync(target);result.fileRemoved=true;}catch(error){result.errorCode??=safeCode(error);}}
    if(result.directoryCreated){try{fs.rmdirSync(directory);result.directoryRemoved=true;}catch(error){result.errorCode??=safeCode(error);}}
  }
  return result;
}
function metadata(target){
  const stat=fs.lstatSync(target);
  return {path:target,isDirectory:stat.isDirectory(),isSymbolicLink:stat.isSymbolicLink(),
    realpath:fs.realpathSync(target),uid:stat.uid,gid:stat.gid,
    mode:(stat.mode&0o7777).toString(8).padStart(4,'0'),write:writeProbe(target)};
}
function mount(target){
  const lines=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n');
  const line=lines.find(value=>value.split(' ')[4]===target);
  if(!line)return null;
  const halves=line.split(' - '); if(halves.length!==2)throw new Error('mount_shape');
  const left=halves[0].split(' '),right=halves[1].split(' ');
  const allowed=new Set(['rw','ro','nosuid','nodev','noexec']);
  const options=[...left[5].split(','),...(right[2]||'').split(',')].filter(option=>
    allowed.has(option)||/^(?:size|uid|gid|mode)=[0-9a-z]+$/.test(option));
  const normalized=[...new Set(options.map(option=>option.startsWith('mode=')?
    'mode='+option.slice(5).padStart(4,'0'):option))].sort();
  return {type:right[0],options:normalized};
}
console.log(JSON.stringify({version:1,paths:paths.map(metadata),mounts:{
  input:mount('/app/input'),output:mount('/app/output')}}));`;

function exactKeys(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_shape`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${label}_keys`);
    }
}

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

function validateId(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new Error(`${label}_invalid`);
    return value;
}

function parseInspectOutput(output, expectedId) {
    const match = /^((?:"sha256:[0-9a-f]{64}"))\|("[^"]+")\r?\n?$/.exec(output);
    if (!match) throw new Error('image_inspect_shape');
    const id = JSON.parse(match[1]);
    const configuredUser = JSON.parse(match[2]);
    if (id !== expectedId || configuredUser !== 'slicer') throw new Error('image_identity_mismatch');
    return { id, configuredUser };
}

function parsePositiveId(output, label) {
    if (!/^[0-9]+\r?\n?$/.test(output)) throw new Error(`${label}_shape`);
    return validateId(Number(output.replace(/\r?\n$/, '')), label);
}

function validateWrite(value, label) {
    const booleans = ['directoryCreated', 'fileWritten', 'fileRemoved', 'directoryRemoved'];
    exactKeys(value, [...booleans, 'statUid', 'statGid', 'statMode', 'errorCode'], label);
    if (booleans.some((key) => typeof value[key] !== 'boolean')) throw new Error(`${label}_boolean`);
    if (value.errorCode !== null && !/^[A-Z0-9_]{1,32}$/.test(value.errorCode)) throw new Error(`${label}_error`);
    if (value.fileWritten) {
        if (!Number.isSafeInteger(value.statUid) || value.statUid < 0 ||
            !Number.isSafeInteger(value.statGid) || value.statGid < 0 ||
            !/^[0-7]{4}$/.test(value.statMode)) throw new Error(`${label}_stat`);
    } else if (value.statUid !== null || value.statGid !== null || value.statMode !== null) {
        throw new Error(`${label}_consistency`);
    }
    if ((!value.directoryCreated && (value.fileWritten || value.fileRemoved || value.directoryRemoved)) ||
        (!value.fileWritten && value.fileRemoved) ||
        (!value.directoryCreated && value.errorCode === null)) throw new Error(`${label}_consistency`);
    const complete = booleans.every((key) => value[key] === true);
    if ((complete && value.errorCode !== null) || (!complete && value.errorCode === null)) {
        throw new Error(`${label}_completion`);
    }
}

function validateMount(value, scenario, label, uid, gid) {
    if (scenario === 'A') {
        if (value !== null) throw new Error(`${label}_unexpected`);
        return;
    }
    exactKeys(value, ['type', 'options'], label);
    if (value.type !== 'tmpfs' || !Array.isArray(value.options) || value.options.length > 16 ||
        value.options.some((item) => typeof item !== 'string' ||
            !/^(?:rw|ro|nosuid|nodev|noexec|(?:size|uid|gid|mode)=[0-9a-z]+)$/.test(item)) ||
        new Set(value.options).size !== value.options.length) throw new Error(`${label}_invalid`);
    for (const required of ['rw', 'nosuid', 'nodev', 'noexec']) {
        if (!value.options.includes(required)) throw new Error(`${label}_${required}`);
    }
    const sizes = value.options.filter((item) => item.startsWith('size='));
    if (sizes.length !== 1 || !['size=64m', 'size=65536k', 'size=67108864'].includes(sizes[0])) {
        throw new Error(`${label}_size`);
    }
    if (scenario === 'C') {
        for (const expected of [`uid=${uid}`, `gid=${gid}`, 'mode=0700']) {
            if (!value.options.includes(expected)) throw new Error(`${label}_identity`);
        }
    }
}

function validateProbeResult(value, scenario, uid, gid) {
    exactKeys(value, ['version', 'paths', 'mounts'], `probe_${scenario}`);
    if (value.version !== 1 || !Array.isArray(value.paths) || value.paths.length !== PATHS.length) {
        throw new Error(`probe_${scenario}_shape`);
    }
    value.paths.forEach((entry, index) => {
        exactKeys(entry, ['path', 'isDirectory', 'isSymbolicLink', 'realpath', 'uid', 'gid', 'mode', 'write'],
            `probe_${scenario}_path`);
        if (entry.path !== PATHS[index] || entry.realpath !== PATHS[index] || entry.isDirectory !== true ||
            entry.isSymbolicLink !== false || !Number.isSafeInteger(entry.uid) || entry.uid < 0 ||
            !Number.isSafeInteger(entry.gid) || entry.gid < 0 || !/^[0-7]{4}$/.test(entry.mode)) {
            throw new Error(`probe_${scenario}_path_value`);
        }
        validateWrite(entry.write, `probe_${scenario}_write`);
        if (scenario === 'C' && (entry.path === '/app/input' || entry.path === '/app/output') &&
            (entry.uid !== uid || entry.gid !== gid || entry.mode !== '0700')) {
            throw new Error('probe_C_tmpfs_ownership');
        }
    });
    exactKeys(value.mounts, ['input', 'output'], `probe_${scenario}_mounts`);
    validateMount(value.mounts.input, scenario, `probe_${scenario}_input_mount`, uid, gid);
    validateMount(value.mounts.output, scenario, `probe_${scenario}_output_mount`, uid, gid);
    return value;
}

function validateCleanup(value, label, requirePresent) {
    exactKeys(value, ['name', 'presentBefore', 'removeAttempted', 'removeExitCode', 'absentAfter'], label);
    validateName(value.name);
    if (typeof value.presentBefore !== 'boolean' || typeof value.removeAttempted !== 'boolean' ||
        value.absentAfter !== true || (requirePresent && value.presentBefore !== true)) {
        throw new Error(`${label}_invalid`);
    }
    if (value.presentBefore) {
        if (value.removeAttempted !== true || value.removeExitCode !== 0) throw new Error(`${label}_removal`);
    } else if (value.removeAttempted !== false || value.removeExitCode !== null) {
        throw new Error(`${label}_removal`);
    }
}

function validateOwnershipDocument(document, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('options_shape');
    if (Object.prototype.hasOwnProperty.call(options, 'requireMainCleanup') &&
        typeof options.requireMainCleanup !== 'boolean') throw new Error('options_value');
    const requireMainCleanup = options.requireMainCleanup === true;
    if (Object.keys(options).some((key) => key !== 'requireMainCleanup')) throw new Error('options_keys');
    exactKeys(document, ['version', 'image', 'probes', 'cleanup'], 'document');
    if (document.version !== DOCUMENT_VERSION) throw new Error('document_version');
    exactKeys(document.image, ['reference', 'id', 'configuredUser', 'uid', 'gid'], 'image');
    validateImageRef(document.image.reference); validateImageId(document.image.id);
    if (document.image.configuredUser !== 'slicer') throw new Error('configured_user');
    const uid = validateId(document.image.uid, 'uid');
    const gid = validateId(document.image.gid, 'gid');
    exactKeys(document.probes, ['A', 'B', 'C'], 'probes');
    for (const scenario of ['A', 'B', 'C']) {
        exactKeys(document.probes[scenario], ['name', 'result'], `probe_${scenario}_record`);
        validateName(document.probes[scenario].name);
        validateProbeResult(document.probes[scenario].result, scenario, uid, gid);
    }
    const cleanupKeys = requireMainCleanup ? ['uid', 'gid', 'A', 'B', 'C', 'main'] : ['uid', 'gid', 'A', 'B', 'C'];
    exactKeys(document.cleanup, cleanupKeys, 'cleanup');
    for (const key of cleanupKeys) validateCleanup(document.cleanup[key], `cleanup_${key}`, key === 'main');
    const names = [document.cleanup.uid.name, document.cleanup.gid.name,
        ...['A', 'B', 'C'].map((key) => document.probes[key].name)];
    if (requireMainCleanup) names.push(document.cleanup.main.name);
    if (new Set(names).size !== names.length) throw new Error('document_names_not_unique');
    for (const key of ['A', 'B', 'C']) {
        if (document.cleanup[key].name !== document.probes[key].name) throw new Error('cleanup_name_mismatch');
    }
    return document;
}

function buildInspectArgs(imageRef) {
    validateImageRef(imageRef);
    return ['image', 'inspect', '--format', '{{json .Id}}|{{json .Config.User}}', imageRef];
}

function baseRunArgs(name) {
    validateName(name);
    return ['run', '--rm', '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--name', name];
}

function buildResolverArgs(name, imageId, selector) {
    if (selector !== '-u' && selector !== '-g') throw new Error('resolver_selector');
    return [...baseRunArgs(name), '--entrypoint', '/usr/bin/id', validateImageId(imageId), selector];
}

function buildProbeArgs(scenario, name, imageId, uid, gid) {
    if (!['A', 'B', 'C'].includes(scenario)) throw new Error('probe_scenario');
    const args = baseRunArgs(name);
    const mounts = scenario === 'A' ? [] : scenario === 'B' ? TMPFS_DEFAULT : [
        `/app/input:rw,nosuid,nodev,noexec,size=64m,uid=${validateId(uid, 'uid')},gid=${validateId(gid, 'gid')},mode=0700`,
        `/app/output:rw,nosuid,nodev,noexec,size=64m,uid=${uid},gid=${gid},mode=0700`
    ];
    for (const mount of mounts) args.push('--tmpfs', mount);
    return [...args, '--entrypoint', '/usr/bin/node', validateImageId(imageId), '-e', PROBE_PROGRAM];
}

function buildPresenceArgs(name) {
    return ['container', 'inspect', '--format', '{{json .Id}}', validateName(name)];
}

function buildRemoveArgs(name) {
    return ['container', 'rm', '--force', validateName(name)];
}

function runDocker(args, timeout = DOCKER_TIMEOUT_MS) {
    const allowed = new Set(['image inspect', 'run --rm', 'container inspect', 'container rm']);
    const signature = args[0] === 'run' ? `${args[0]} ${args[1]}` : `${args[0]} ${args[1]}`;
    if (!allowed.has(signature)) throw new Error('docker_command_not_allowlisted');
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: MAX_COMMAND_BYTES,
        windowsHide: true, shell: false });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (Buffer.byteLength(stdout) > MAX_COMMAND_BYTES || Buffer.byteLength(stderr) > MAX_COMMAND_BYTES ||
        result.error) throw new Error('docker_execution_failure');
    return { status: result.status, stdout, stderr };
}

function isPresent(name) {
    const result = runDocker(buildPresenceArgs(name), 10_000);
    if (result.status === 0) {
        if (!/^"[0-9a-f]{64}"\r?\n?$/.test(result.stdout)) throw new Error('container_lookup_shape');
        return true;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const absent = new RegExp(`^(?:Error: No such (?:object|container): |` +
        `Error response from daemon: No such container: )${escaped}\\r?\\n?$`);
    if (result.status !== 1 || result.stdout !== '' || !absent.test(result.stderr)) {
        throw new Error('container_lookup_failure');
    }
    return false;
}

function cleanupName(name) {
    const presentBefore = isPresent(name);
    const removed = presentBefore ? runDocker(buildRemoveArgs(name), 10_000) : null;
    const absentAfter = !isPresent(name);
    return { name, presentBefore, removeAttempted: presentBefore,
        removeExitCode: removed ? removed.status : null, absentAfter };
}

function runNamed(name, args, parser) {
    if (isPresent(name)) throw new Error('container_name_already_present');
    let result;
    try {
        result = runDocker(args);
        if (result.status !== 0) throw new Error('docker_child_failure');
        return parser(result.stdout);
    } finally {
        const cleanup = cleanupName(name);
        runNamed.lastCleanup = cleanup;
        if (!cleanup.absentAfter) throw new Error('container_cleanup_failure');
    }
}

function parseProbeOutput(output, scenario, uid, gid) {
    if (Buffer.byteLength(output) > MAX_COMMAND_BYTES || !/^\{[^\r\n]*\}\r?\n?$/.test(output)) {
        throw new Error('probe_output_shape');
    }
    let parsed;
    try { parsed = JSON.parse(output); } catch { throw new Error('probe_json_invalid'); }
    return validateProbeResult(parsed, scenario, uid, gid);
}

function validateEvidenceDirectory(env) {
    const runnerInput = requireString(env.RUNNER_TEMP, /\S/, 'runner_temp');
    const evidenceInput = requireString(env.EVIDENCE_DIR, /\S/, 'evidence_dir');
    if (!path.isAbsolute(runnerInput) || !path.isAbsolute(evidenceInput) ||
        path.normalize(runnerInput) !== runnerInput || path.normalize(evidenceInput) !== evidenceInput) {
        throw new Error('evidence_boundary');
    }
    const runner = path.resolve(runnerInput);
    const evidence = path.resolve(evidenceInput);
    if (path.dirname(evidenceInput) !== runnerInput || evidenceInput === runnerInput ||
        path.dirname(evidence) !== runner || evidence === runner) throw new Error('evidence_boundary');
    const stat = fs.lstatSync(evidence);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(evidence) !== evidence) {
        throw new Error('evidence_boundary');
    }
    return evidence;
}

function writeExclusiveJson(file, document) {
    const content = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(content) > MAX_EVIDENCE_BYTES) throw new Error('evidence_too_large');
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function atomicRewriteJson(file, document) {
    const content = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(content) > MAX_EVIDENCE_BYTES) throw new Error('evidence_too_large');
    const temporary = `${file}.tmp-${process.pid}`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd);
        fs.renameSync(temporary, file);
    } catch (error) {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(temporary); } catch {}
        throw error;
    }
}

function readDocument(file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
        throw new Error('evidence_file_invalid');
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function appendClassification(outputPath, classification) {
    if (!outputPath) return;
    if (!/^[a-z_]{1,48}$/.test(classification)) throw new Error('classification_invalid');
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('github_output_invalid');
    fs.appendFileSync(outputPath, `classification=${classification}\n`, { encoding: 'utf8' });
}

function readEnvironment(env) {
    const values = {
        imageRef: validateImageRef(env.IMAGE_REF), expectedImageId: validateImageId(env.EXPECTED_IMAGE_ID),
        evidenceDir: validateEvidenceDirectory(env), names: {}
    };
    for (const key of NAME_KEYS) values.names[key] = validateName(env[key]);
    if (new Set(Object.values(values.names)).size !== NAME_KEYS.length) throw new Error('container_names_not_unique');
    return values;
}

function characterize(env = process.env) {
    const values = readEnvironment(env);
    const inspected = runDocker(buildInspectArgs(values.imageRef), 10_000);
    if (inspected.status !== 0) throw new Error('image_inspect_failure');
    const identity = parseInspectOutput(inspected.stdout, values.expectedImageId);
    const cleanup = {};
    const resolve = (key, selector, label) => {
        const name = values.names[key];
        const id = runNamed(name, buildResolverArgs(name, identity.id, selector),
            (output) => parsePositiveId(output, label));
        cleanup[label] = runNamed.lastCleanup;
        return id;
    };
    const uid = resolve('I2_UID_PROBE_NAME', '-u', 'uid');
    const gid = resolve('I2_GID_PROBE_NAME', '-g', 'gid');
    const probes = {};
    for (const scenario of ['A', 'B', 'C']) {
        const name = values.names[`I2_PROBE_${scenario}_NAME`];
        const result = runNamed(name, buildProbeArgs(scenario, name, identity.id, uid, gid),
            (output) => parseProbeOutput(output, scenario, uid, gid));
        probes[scenario] = { name, result };
        cleanup[scenario] = runNamed.lastCleanup;
    }
    const document = { version: DOCUMENT_VERSION,
        image: { reference: values.imageRef, id: identity.id, configuredUser: identity.configuredUser, uid, gid },
        probes, cleanup };
    validateOwnershipDocument(document, { requireMainCleanup: false });
    writeExclusiveJson(path.join(values.evidenceDir, 'runtime-ownership.json'), document);
    appendClassification(env.GITHUB_OUTPUT, 'success');
    return document;
}

function finalize(env = process.env) {
    const values = readEnvironment(env);
    const file = path.join(values.evidenceDir, 'runtime-ownership.json');
    let document;
    let evidenceError;
    try {
        document = validateOwnershipDocument(readDocument(file), { requireMainCleanup: false });
        if (document.image.reference !== values.imageRef || document.image.id !== values.expectedImageId) {
            throw new Error('finalize_identity_mismatch');
        }
        const bindings = { uid: 'I2_UID_PROBE_NAME', gid: 'I2_GID_PROBE_NAME',
            A: 'I2_PROBE_A_NAME', B: 'I2_PROBE_B_NAME', C: 'I2_PROBE_C_NAME' };
        for (const [key, environmentKey] of Object.entries(bindings)) {
            if (document.cleanup[key].name !== values.names[environmentKey] ||
                (['A', 'B', 'C'].includes(key) && document.probes[key].name !== values.names[environmentKey])) {
                throw new Error('finalize_name_mismatch');
            }
        }
    } catch (error) { evidenceError = error; }
    const main = cleanupName(values.names.CONTAINER_NAME);
    if (evidenceError) throw evidenceError;
    document.cleanup.main = main;
    atomicRewriteJson(file, document);
    validateOwnershipDocument(document, { requireMainCleanup: true });
    appendClassification(env.GITHUB_OUTPUT, 'success');
    return document;
}

function main() {
    const mode = process.argv[2];
    try {
        if (process.argv.length !== 3 || !['characterize', 'finalize'].includes(mode)) throw new Error('mode_invalid');
        if (mode === 'characterize') characterize(); else finalize();
    } catch {
        try { appendClassification(process.env.GITHUB_OUTPUT, 'runtime_ownership_failure'); } catch {}
        process.stderr.write('runtime_ownership_failure\n');
        process.exitCode = 2;
    }
}

module.exports = Object.freeze({ DOCUMENT_VERSION, MAX_EVIDENCE_BYTES, PROBE_PROGRAM,
    validateImageRef, validateImageId, validateName, parseInspectOutput, parsePositiveId,
    validateProbeResult, validateOwnershipDocument, buildInspectArgs, buildResolverArgs,
    buildProbeArgs, buildPresenceArgs, buildRemoveArgs, characterize, finalize });

if (require.main === module) main();
