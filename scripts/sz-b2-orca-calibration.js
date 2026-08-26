'use strict';

/**
 * Measure private calibration inputs through the Orca CLI without publishing
 * their host paths or basenames.
 *
 * The required manifest is an out-of-band JSON array. Each entry contains only
 * `id` (`M01` through `M10`), `sha256` (exact lowercase SHA-256), and `path`
 * (the private host path). The path is consumed in memory and is never copied to
 * a result record.
 *
 * Usage:
 *   node scripts/sz-b2-orca-calibration.js --manifest <private-json> \
 *        --image <ref> --memory 2g --machine <profile-json> \
 *        --material PLA --layer 0.2
 *
 * Stdout contains one privacy-safe JSON result per manifest entry followed by
 * an anonymous Markdown table. Stderr contains anonymous progress identities.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULTS = Object.freeze({
    image: null,
    memory: '2g',
    cpus: '1.0',
    machine: 'Bambu_P1S_0.4_nozzle.json',
    material: 'PLA',
    layer: '0.2',
    infill: '20%',
    timeoutMs: 300_000
});

const MATERIAL_FILAMENT_PROFILE = Object.freeze({
    PLA: 'PLA_generic.json',
    PETG: 'PETG_generic.json'
});
const CALIBRATION_FILAMENT_PROFILES = new Set(Object.values(MATERIAL_FILAMENT_PROFILE));
const CALIBRATION_TIME_SOURCES = new Set([
    'm73_p0_r_minutes', 'estimated_printing_time', 'total_estimated_time', 'time_seconds'
]);
const CALIBRATION_GRAM_SOURCES = new Set([
    'filament_used_g', 'total_filament_used_g', 'filament_used_grams_word'
]);

const ANONYMOUS_ID_PATTERN = /^M(?:0[1-9]|10)$/;
const LOWERCASE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EXACT_IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MACHINE_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/;
const MATERIAL_KEY_PATTERN = /^[A-Z][A-Z0-9_-]{0,31}$/;
const LAYER_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const INFILL_PATTERN = /^(?:100|[0-9]{1,2})%$/;
const MEMORY_PATTERN = /^(?:[1-9][0-9]{0,4})(?:m|g)$/;
const CPU_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_CALIBRATION_INPUT_BYTES = 500 * 1024 * 1024;
const FILE_READ_CHUNK_BYTES = 1024 * 1024;
const CALIBRATION_RUN_LABEL = 'com.rocket3d.calibration.run';
const CALIBRATION_PURPOSE_LABEL = 'com.rocket3d.calibration.purpose';
const CALIBRATION_PURPOSE = 'j1-private-model-measurement';
const CONTAINER_NAME_PATTERN = /^r3d-calibration-[1-9][0-9]{0,9}-[a-f0-9]{32}$/;
const REDACTION = '[private-model]';
const OPTION_NAMES = new Set([
    'manifest', 'image', 'memory', 'cpus', 'machine', 'material', 'layer', 'infill', 'timeoutMs'
]);

class CalibrationInputError extends Error {
    constructor(code) {
        super(code);
        this.name = 'CalibrationInputError';
        this.code = code;
    }
}

function inputError(code) {
    throw new CalibrationInputError(code);
}

/**
 * Parse the strict `--key value` command-line contract.
 * @param {string[]} argv Raw argv slice.
 * @returns {{options: Record<string, string | number>}} Parsed options.
 */
function parseArgs(argv) {
    const options = { ...DEFAULTS, manifest: null };
    const seen = new Set();

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (typeof argument !== 'string' || !argument.startsWith('--')) {
            inputError('POSITIONAL_MODEL_ARGUMENT_FORBIDDEN');
        }

        const key = argument.slice(2);
        if (!OPTION_NAMES.has(key)) inputError('UNSUPPORTED_CALIBRATION_OPTION');
        if (seen.has(key)) inputError('DUPLICATE_CALIBRATION_OPTION');

        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
            inputError('CALIBRATION_OPTION_VALUE_REQUIRED');
        }

        seen.add(key);
        options[key] = value;
        index += 1;
    }

    if (!options.manifest) inputError('CALIBRATION_MANIFEST_REQUIRED');
    validateOptions(options);
    return { options };
}

function validateOptions(options) {
    if (typeof options.image !== 'string' || options.image.trim() === '') {
        inputError('CALIBRATION_IMAGE_INVALID');
    }
    if (typeof options.machine !== 'string' ||
        !MACHINE_PROFILE_PATTERN.test(options.machine) ||
        options.machine.includes('..')) {
        inputError('CALIBRATION_MACHINE_PROFILE_INVALID');
    }
    if (typeof options.material !== 'string' || !MATERIAL_KEY_PATTERN.test(options.material)) {
        inputError('CALIBRATION_MATERIAL_INVALID');
    }
    if (typeof options.layer !== 'string' ||
        !LAYER_PATTERN.test(options.layer) ||
        !Number.isFinite(Number(options.layer)) ||
        Number(options.layer) <= 0) {
        inputError('CALIBRATION_LAYER_INVALID');
    }
    if (typeof options.infill !== 'string' || !INFILL_PATTERN.test(options.infill)) {
        inputError('CALIBRATION_INFILL_INVALID');
    }
    if (typeof options.memory !== 'string' || !MEMORY_PATTERN.test(options.memory)) {
        inputError('CALIBRATION_MEMORY_INVALID');
    }
    const memoryMatch = /^([1-9][0-9]{0,4})(m|g)$/.exec(options.memory);
    const memoryBytes = Number(memoryMatch[1]) * (memoryMatch[2] === 'g' ? 1024 ** 3 : 1024 ** 2);
    if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 256 * 1024 ** 2 ||
        memoryBytes > 16 * 1024 ** 3) {
        inputError('CALIBRATION_MEMORY_INVALID');
    }
    if (typeof options.cpus !== 'string' || !CPU_PATTERN.test(options.cpus)) {
        inputError('CALIBRATION_CPUS_INVALID');
    }
    const cpus = Number(options.cpus);
    if (!Number.isFinite(cpus) || cpus < 0.1 || cpus > 16) {
        inputError('CALIBRATION_CPUS_INVALID');
    }

    const timeoutMs = Number(options.timeoutMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000) {
        inputError('CALIBRATION_TIMEOUT_INVALID');
    }
}

function readBoundedRegularFile(filePath, maximumBytes, failureCode) {
    let descriptor;
    try {
        const lexicalStat = fs.lstatSync(filePath);
        if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink() ||
            lexicalStat.size < 0 || lexicalStat.size > maximumBytes) {
            inputError(failureCode);
        }
        const canonicalPath = fs.realpathSync.native(filePath);
        descriptor = fs.openSync(canonicalPath, 'r');
        const openedStat = fs.fstatSync(descriptor);
        if (!openedStat.isFile() || openedStat.size !== lexicalStat.size ||
            openedStat.size > maximumBytes) {
            inputError(failureCode);
        }

        const chunks = [];
        let total = 0;
        while (true) {
            const remaining = maximumBytes + 1 - total;
            if (remaining <= 0) inputError(failureCode);
            const buffer = Buffer.allocUnsafe(Math.min(FILE_READ_CHUNK_BYTES, remaining));
            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            chunks.push(buffer.subarray(0, bytesRead));
            total += bytesRead;
        }
        if (total !== openedStat.size || total > maximumBytes) inputError(failureCode);
        return { bytes: Buffer.concat(chunks, total), canonicalPath };
    } catch (error) {
        if (error instanceof CalibrationInputError) throw error;
        inputError(failureCode);
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* fail code already hides private identity */ }
        }
    }
}

/**
 * Validate and normalize an already-parsed private manifest.
 * @param {unknown} value Parsed JSON value.
 * @returns {Array<{id: string, sha256: string, privatePath: string}>} Entries.
 */
function validateManifest(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
        inputError('CALIBRATION_MANIFEST_CARDINALITY_INVALID');
    }

    const seenIds = new Set();
    return value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            inputError('CALIBRATION_MANIFEST_ENTRY_INVALID');
        }

        const keys = Object.keys(entry).sort();
        if (keys.length !== 3 || keys[0] !== 'id' || keys[1] !== 'path' || keys[2] !== 'sha256') {
            inputError('CALIBRATION_MANIFEST_ENTRY_SHAPE_INVALID');
        }
        if (typeof entry.id !== 'string' || !ANONYMOUS_ID_PATTERN.test(entry.id)) {
            inputError('CALIBRATION_MANIFEST_ID_INVALID');
        }
        if (seenIds.has(entry.id)) inputError('CALIBRATION_MANIFEST_ID_DUPLICATE');
        if (typeof entry.sha256 !== 'string' || !LOWERCASE_SHA256_PATTERN.test(entry.sha256)) {
            inputError('CALIBRATION_MANIFEST_SHA256_INVALID');
        }
        if (typeof entry.path !== 'string' || entry.path.trim() === '' || entry.path.includes('\0')) {
            inputError('CALIBRATION_MANIFEST_PRIVATE_PATH_INVALID');
        }

        seenIds.add(entry.id);
        return Object.freeze({
            id: entry.id,
            sha256: entry.sha256,
            privatePath: entry.path
        });
    });
}

function loadManifest(manifestPath) {
    let raw;
    try {
        raw = readBoundedRegularFile(
            manifestPath,
            MAX_MANIFEST_BYTES,
            'CALIBRATION_MANIFEST_FILE_INVALID'
        ).bytes.toString('utf8');
    } catch (error) {
        if (error instanceof CalibrationInputError) throw error;
        inputError('CALIBRATION_MANIFEST_READ_FAILED');
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        inputError('CALIBRATION_MANIFEST_JSON_INVALID');
    }
    return validateManifest(parsed);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addPathVariants(tokens, value) {
    if (typeof value !== 'string' || value.length === 0) return;
    tokens.add(value);
    tokens.add(value.replace(/\\/g, '/'));
    tokens.add(value.replace(/\//g, '\\'));
    tokens.add(value.replace(/\\/g, '\\\\'));
}

/**
 * Build a pure text redactor for all host-path identities and optional
 * container-side aliases associated with one private input.
 * @param {string} privatePath Private manifest value.
 * @param {string[]} [additionalTokens] Container-side aliases.
 * @returns {(value: unknown) => string} Redactor.
 */
function createPathRedactor(privatePath, additionalTokens = []) {
    const absolutePath = path.resolve(privatePath);
    const tokens = new Set();
    addPathVariants(tokens, privatePath);
    addPathVariants(tokens, absolutePath);
    addPathVariants(tokens, path.dirname(absolutePath));
    addPathVariants(tokens, path.basename(absolutePath));
    for (const token of additionalTokens) addPathVariants(tokens, token);

    const patterns = [...tokens]
        .filter((token) => token.length > 0)
        .sort((left, right) => right.length - left.length)
        .map((token) => new RegExp(escapeRegExp(token), process.platform === 'win32' ? 'gi' : 'g'));

    return (value) => {
        let text = String(value ?? '');
        for (const pattern of patterns) text = text.replace(pattern, REDACTION);
        return text;
    };
}

/**
 * Recursively sanitize strings while preserving JSON-safe structure.
 * @param {unknown} value Value to sanitize.
 * @param {(value: unknown) => string} redact Active path redactor.
 * @returns {unknown} Sanitized copy.
 */
function sanitizePrivateValue(value, redact) {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map((item) => sanitizePrivateValue(item, redact));
    if (value && typeof value === 'object') {
        const sanitized = {};
        for (const [key, item] of Object.entries(value)) {
            sanitized[key] = sanitizePrivateValue(item, redact);
        }
        return sanitized;
    }
    return value;
}

function inspectPrivateFile(absolutePath) {
    let descriptor;
    try {
        const lexicalStat = fs.lstatSync(absolutePath);
        if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink() ||
            lexicalStat.size <= 0 || lexicalStat.size > MAX_CALIBRATION_INPUT_BYTES) {
            return { ok: false, code: 'CALIBRATION_INPUT_FILE_INVALID' };
        }
        const canonicalPath = fs.realpathSync.native(absolutePath);
        descriptor = fs.openSync(canonicalPath, 'r');
        const openedStat = fs.fstatSync(descriptor);
        if (!openedStat.isFile() || openedStat.size !== lexicalStat.size ||
            openedStat.size <= 0 || openedStat.size > MAX_CALIBRATION_INPUT_BYTES) {
            return { ok: false, code: 'CALIBRATION_INPUT_FILE_INVALID' };
        }

        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
        let total = 0;
        while (true) {
            const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            total += bytesRead;
            if (total > MAX_CALIBRATION_INPUT_BYTES) {
                return { ok: false, code: 'CALIBRATION_INPUT_FILE_INVALID' };
            }
            hash.update(buffer.subarray(0, bytesRead));
        }
        if (total !== openedStat.size) {
            return { ok: false, code: 'CALIBRATION_INPUT_CHANGED_DURING_READ' };
        }
        return {
            ok: true,
            bytes: total,
            sha256: hash.digest('hex'),
            canonicalPath
        };
    } catch {
        return { ok: false, code: 'CALIBRATION_INPUT_READ_FAILED' };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* response remains code-only */ }
        }
    }
}

function readStagedPathIdentity(targetPath, expectedType) {
    const lexical = fs.lstatSync(targetPath, { bigint: true });
    if (lexical.isSymbolicLink()) return null;
    if (expectedType === 'directory' && !lexical.isDirectory()) return null;
    if (expectedType === 'file' && !lexical.isFile()) return null;
    const canonicalPath = fs.realpathSync.native(targetPath);
    const birthtimeNs = typeof lexical.birthtimeNs === 'bigint'
        ? lexical.birthtimeNs.toString()
        : String(Math.trunc(Number(lexical.birthtimeMs) * 1e6));
    return Object.freeze({
        type: expectedType,
        canonicalPath,
        dev: lexical.dev.toString(),
        ino: lexical.ino.toString(),
        birthtimeNs
    });
}

function stagedPathIdentityMatches(targetPath, expectedIdentity, expectedType) {
    if (!expectedIdentity || expectedIdentity.type !== expectedType) return false;
    const current = readStagedPathIdentity(targetPath, expectedType);
    return current !== null &&
        current.canonicalPath === expectedIdentity.canonicalPath &&
        current.dev === expectedIdentity.dev &&
        current.ino === expectedIdentity.ino &&
        current.birthtimeNs === expectedIdentity.birthtimeNs;
}

function stagedPathIsAbsent(targetPath) {
    try {
        fs.lstatSync(targetPath);
        return false;
    } catch (error) {
        if (error && error.code === 'ENOENT') return true;
        throw error;
    }
}

function cleanupStagedModel(stage) {
    if (!stage || typeof stage.root !== 'string' || typeof stage.filePath !== 'string') return false;
    const root = path.resolve(stage.root);
    const filePath = path.resolve(stage.filePath);
    const temporaryRoot = path.resolve(os.tmpdir());
    if (!root.startsWith(`${temporaryRoot}${path.sep}`) ||
        !/^r3d-calibration-[A-Za-z0-9]{6}$/.test(path.basename(root)) ||
        path.dirname(filePath) !== root ||
        !/^input(?:\.[a-z0-9]{1,8})?$/.test(path.basename(filePath))) return false;
    try {
        if (!stagedPathIsAbsent(filePath)) {
            if (!stagedPathIdentityMatches(filePath, stage.fileIdentity, 'file')) return false;
            fs.unlinkSync(filePath);
            if (!stagedPathIsAbsent(filePath)) return false;
        }
        if (!stagedPathIsAbsent(root)) {
            if (!stagedPathIdentityMatches(root, stage.rootIdentity, 'directory')) return false;
            fs.rmdirSync(root);
        }
        return stagedPathIsAbsent(filePath) && stagedPathIsAbsent(root);
    } catch {
        return false;
    }
}

function stagePrivateModel(entry, inspected) {
    let stage = null;
    try {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-calibration-'));
        stage = {
            root,
            filePath: path.join(root, 'input'),
            rootIdentity: readStagedPathIdentity(root, 'directory'),
            fileIdentity: null
        };
        if (stage.rootIdentity === null) inputError('CALIBRATION_STAGE_IDENTITY_MISMATCH');
        fs.chmodSync(root, 0o700);
        const extension = path.extname(inspected.canonicalPath).toLowerCase();
        const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '';
        const filePath = path.join(root, `input${safeExtension}`);
        stage = { ...stage, filePath };
        fs.copyFileSync(inspected.canonicalPath, filePath, fs.constants.COPYFILE_EXCL);
        stage = { ...stage, fileIdentity: readStagedPathIdentity(filePath, 'file') };
        if (stage.fileIdentity === null) inputError('CALIBRATION_STAGE_IDENTITY_MISMATCH');
        fs.chmodSync(filePath, 0o600);
        const staged = inspectPrivateFile(filePath);
        if (!staged.ok || staged.bytes !== inspected.bytes || staged.sha256 !== entry.sha256) {
            inputError('CALIBRATION_STAGE_IDENTITY_MISMATCH');
        }
        if (staged.canonicalPath !== stage.fileIdentity.canonicalPath) {
            inputError('CALIBRATION_STAGE_IDENTITY_MISMATCH');
        }
        return Object.freeze({
            root,
            filePath,
            canonicalPath: staged.canonicalPath,
            rootIdentity: stage.rootIdentity,
            fileIdentity: stage.fileIdentity
        });
    } catch (error) {
        const cleaned = stage === null || cleanupStagedModel(stage);
        if (!cleaned) inputError('CALIBRATION_STAGE_CLEANUP_FAILED');
        if (error instanceof CalibrationInputError) throw error;
        inputError('CALIBRATION_STAGE_FAILED');
    }
}

function parsePositiveRuntimeId(value, label) {
    if (!['uid', 'gid'].includes(label) || typeof value !== 'string' || !/^[0-9]+\r?\n?$/.test(value)) {
        inputError('CALIBRATION_RUNTIME_IDENTITY_INVALID');
    }
    const numeric = Number(value.replace(/\r?\n$/, ''));
    if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 2_147_483_647) {
        inputError('CALIBRATION_RUNTIME_IDENTITY_INVALID');
    }
    return numeric;
}

function resolveExactImageId(imageReference) {
    const result = spawnSync('docker', [
        'image', 'inspect', '--format', '{{json .Id}}', String(imageReference)
    ], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024,
        shell: false,
        timeout: 30_000,
        windowsHide: true
    });
    if (result.error || result.signal || result.status !== 0 || result.stderr !== '' ||
        !/^"sha256:[a-f0-9]{64}"\r?\n?$/.test(result.stdout)) {
        inputError('CALIBRATION_IMAGE_IDENTITY_LOOKUP_FAILED');
    }
    const imageId = JSON.parse(result.stdout);
    if (!EXACT_IMAGE_ID_PATTERN.test(imageId)) {
        inputError('CALIBRATION_IMAGE_IDENTITY_INVALID');
    }
    return imageId;
}

function runRuntimeIdentityProbe(imageId, selector) {
    const result = spawnSync('docker', [
        'run', '--rm', '--pull', 'never', '--network', 'none',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '64', '--read-only',
        '--entrypoint', '/usr/bin/id', imageId, selector
    ], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024,
        shell: false,
        timeout: 30_000,
        windowsHide: true
    });
    if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
        inputError('CALIBRATION_RUNTIME_IDENTITY_LOOKUP_FAILED');
    }
    return parsePositiveRuntimeId(result.stdout, selector === '-u' ? 'uid' : 'gid');
}

function resolveImageRuntimeIdentity(imageReference) {
    const imageId = resolveExactImageId(imageReference);
    return {
        imageId,
        uid: runRuntimeIdentityProbe(imageId, '-u'),
        gid: runRuntimeIdentityProbe(imageId, '-g')
    };
}

/**
 * The in-container measurement program. It uses the current asynchronous,
 * workspace-contained J0 runtime-profile API.
 */
const CONTAINER_SCRIPT = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { spawnSync } = require('node:child_process');",
    "const { createRuntimeSlicerProfile } = require('/app/services/slice/profiles');",
    "const { parseGcodeMetricsStrict } = require('/app/services/slice/gcode-metrics');",
    "const { snapshotProfileSelection } = require('/app/services/slice/profile-snapshot');",
    "const { calculateEffectiveProfileSha256 } = require('/app/services/slice/profile-digest');",
    "const { readOrcaFilamentProfileMetadata } = require('/app/services/slice/filament-profile');",
    "const { parseEngineVersionOutput } = require('/app/services/slice/engine-version');",
    'const job = JSON.parse(process.env.SZ_B2_JOB);',
    "const root = '/tmp/sz-b2';",
    "const output = path.join(root, 'output');",
    'const childEnvironment = Object.freeze({',
    "    HOME: process.env.HOME, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',",
    "    PATH: '/usr/local/bin:/usr/bin:/bin', QT_QPA_PLATFORM: 'offscreen',",
    '    TMPDIR: process.env.TMPDIR, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,',
    '    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,',
    '    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR',
    '});',
    'function safeCode(value, fallback) {',
    "    return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value) ? value : fallback;",
    '}',
    'function runOrca(args, timeout) {',
    "    return spawnSync('/usr/local/bin/orca-slicer', args, {",
    "        encoding: 'utf8', env: childEnvironment, maxBuffer: 1024 * 10000,",
    '        shell: false, timeout, windowsHide: true',
    '    });',
    '}',
    'function emit(record) {',
    "    process.stdout.write(JSON.stringify(record) + '\\n');",
    '}',
    'function createWorkspace() {',
    '    const assertContained = (candidatePath) => {',
    '        const resolved = path.resolve(candidatePath);',
    '        if (resolved !== root && !resolved.startsWith(root + path.sep)) {',
    "            const error = new Error('runtime_profile_escape');",
    "            error.code = 'RUNTIME_PROFILE_ESCAPE';",
    '            throw error;',
    '        }',
    '        return resolved;',
    '    };',
    '    return {',
    '        resolveScratchPath: (...segments) => path.resolve(root, ...segments),',
    '        resolvePath: (...segments) => path.resolve(root, ...segments),',
    '        assertScratchContainedPath: assertContained,',
    '        assertContainedPath: assertContained',
    '    };',
    '}',
    'async function execute() {',
    "    if (typeof process.getuid !== 'function' || process.getuid() === 0) {",
    "        emit({ ok: false, phase: 'isolation', code: 'NON_ROOT_RUNTIME_REQUIRED' });",
    '        return;',
    '    }',
    '    for (const dir of [root, output, process.env.HOME, process.env.XDG_CACHE_HOME,',
    '        process.env.XDG_CONFIG_HOME, process.env.XDG_RUNTIME_DIR]) {',
    '        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });',
    '    }',
    "    const machineProfile = '/app/configs/orca/' + job.machine;",
    "    const processProfile = '/app/configs/orca/FDM_' + job.layer + 'mm.json';",
    "    const filamentProfile = job.filament ? '/app/configs/orca/filament/' + job.filament : null;",
    '    const workspace = createWorkspace();',
    "    const snapshots = await snapshotProfileSelection('orca', {",
    '        baseConfigFile: processProfile,',
    '        orcaMachineConfigFile: machineProfile,',
    '        orcaFilamentConfigFile: filamentProfile',
    '    }, workspace);',
    '    const runtimeProcessProfile = await createRuntimeSlicerProfile(',
    "        'orca', snapshots.baseConfigFile, 'FDM', Number(job.layer), job.infill, workspace);",
    '    const filamentMetadata = readOrcaFilamentProfileMetadata(',
    '        snapshots.orcaFilamentConfigFile, job.material);',
    '    const effectiveProfileSha256 = calculateEffectiveProfileSha256({',
    "        engine: 'orca', technology: 'FDM', material: job.material,",
    '        runtimeConfigFile: runtimeProcessProfile,',
    '        orcaMachineConfigFile: snapshots.orcaMachineConfigFile,',
    '        orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile',
    '    });',
    "    const help = runOrca(['--help'], 60_000);",
    '    if (help.error || help.signal || help.status !== 0) {',
    "        emit({ ok: false, phase: 'identity', code: 'ENGINE_VERSION_PROBE_FAILED',",
    '            status: Number.isInteger(help.status) ? help.status : null });',
    '        return;',
    '    }',
    '    let engineVersion;',
    '    try {',
    "        engineVersion = parseEngineVersionOutput('orca', help);",
    '    } catch {',
    "        emit({ ok: false, phase: 'identity', code: 'ENGINE_VERSION_INVALID' });",
    '        return;',
    '    }',
    '    const settings = [snapshots.orcaMachineConfigFile, runtimeProcessProfile,',
    '        snapshots.orcaFilamentConfigFile]',
    "        .filter(Boolean).join(';');",
    '    const started = Date.now();',
    '    const sliced = runOrca([',
    "        '--load-settings', settings, '--arrange', '1', '--orient', '0',",
    "        '--slice', '0', '--outputdir', output, job.input",
    '    ], job.timeoutMs);',
    '    const wallMs = Date.now() - started;',
    '    if (sliced.error || sliced.signal || sliced.status !== 0) {',
    '        emit({',
    "            ok: false, phase: 'slice', status: sliced.status, signal: sliced.signal,",
    "            wall_ms: wallMs, code: sliced.error ? 'ORCA_EXECUTION_FAILED' : 'ORCA_EXIT_NONZERO'",
    '        });',
    '        return;',
    '    }',
    "    const produced = fs.readdirSync(output).filter((name) => name.toLowerCase().endsWith('.gcode'));",
    '    if (produced.length !== 1) {',
    "        emit({ ok: false, phase: 'output', code: 'GCODE_OUTPUT_CARDINALITY',",
    '            count: produced.length, wall_ms: wallMs });',
    '        return;',
    '    }',
    '    const generatedPath = path.join(output, produced[0]);',
    '    const generatedStat = fs.lstatSync(generatedPath);',
    '    if (!generatedStat.isFile() || generatedStat.isSymbolicLink() ||',
    '        generatedStat.size <= 0 || generatedStat.size > 500 * 1024 * 1024) {',
    "        emit({ ok: false, phase: 'output', code: 'GCODE_OUTPUT_INVALID',",
    '            wall_ms: wallMs });',
    '        return;',
    '    }',
    "    const gcode = fs.readFileSync(generatedPath, 'utf8');",
    "    if (Buffer.byteLength(gcode, 'utf8') !== generatedStat.size) {",
    "        emit({ ok: false, phase: 'output', code: 'GCODE_OUTPUT_CHANGED',",
    '            wall_ms: wallMs });',
    '        return;',
    '    }',
    '    try {',
    '        const metrics = parseGcodeMetricsStrict(gcode);',
    '        emit({',
    '            ok: true, wall_ms: wallMs, gcode_bytes: Buffer.byteLength(gcode),',
    "            engine_version: engineVersion, effective_profile_sha256: effectiveProfileSha256,",
    '            filament_profile: job.filament,',
    '            filament_diameter_mm: filamentMetadata ? filamentMetadata.diameterMm : null,',
    '            filament_density_g_cm3: filamentMetadata ? filamentMetadata.densityGcm3 : null,',
    '            print_time_seconds: metrics.print_time_seconds,',
    '            print_time_source: metrics.print_time_source,',
    '            filament_used_g: metrics.filament_used_g,',
    '            filament_used_g_source: metrics.filament_used_g_source,',
    '            filament_used_mm: metrics.filament_used_mm',
    '        });',
    '    } catch (error) {',
    "        emit({ ok: false, phase: 'metrics',",
    "            code: safeCode(error && error.code, 'GCODE_METRICS_INVALID'),",
    '            wall_ms: wallMs });',
    '    }',
    '}',
    'execute().catch((error) => {',
    "    emit({ ok: false, phase: 'container',",
    "        code: safeCode(error && error.code, 'CONTAINER_SCRIPT_FAILED') });",
    '});'
].join('\n');

function createContainerOwnership() {
    const runId = crypto.randomBytes(16).toString('hex');
    const containerName = `r3d-calibration-${process.pid}-${runId}`;
    if (!CONTAINER_NAME_PATTERN.test(containerName)) {
        inputError('CALIBRATION_CONTAINER_IDENTITY_INVALID');
    }
    return Object.freeze({ containerName, runId });
}

function validateContainerOwnership(ownership) {
    if (!ownership || typeof ownership.runId !== 'string' ||
        !/^[a-f0-9]{32}$/.test(ownership.runId) ||
        typeof ownership.containerName !== 'string' ||
        !CONTAINER_NAME_PATTERN.test(ownership.containerName) ||
        !ownership.containerName.endsWith(`-${ownership.runId}`)) {
        inputError('CALIBRATION_CONTAINER_IDENTITY_INVALID');
    }
    return ownership;
}

function runDockerControl(args, runner) {
    return runner('docker', args, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 30_000,
        windowsHide: true
    });
}

function verifyCalibrationContainerAbsent(containerName, runner = spawnSync) {
    const result = runDockerControl([
        'container', 'ls', '--all', '--no-trunc',
        '--filter', `name=^/${containerName}$`,
        '--format', '{{json .Names}}'
    ], runner);
    return !result.error && !result.signal && result.status === 0 &&
        result.stderr === '' && /^\s*$/.test(String(result.stdout || ''));
}

function cleanupCalibrationContainer(ownership, imageId, runner = spawnSync) {
    try {
        validateContainerOwnership(ownership);
        if (typeof imageId !== 'string' || !EXACT_IMAGE_ID_PATTERN.test(imageId)) return false;

        const inspected = runDockerControl([
            'container', 'inspect', ownership.containerName
        ], runner);
        if (inspected.error || inspected.signal) return false;
        if (inspected.status !== 0) {
            return verifyCalibrationContainerAbsent(ownership.containerName, runner);
        }
        if (inspected.stderr !== '' ||
            Buffer.byteLength(String(inspected.stdout || ''), 'utf8') > 1024 * 1024) {
            return false;
        }

        let identity;
        try {
            const parsed = JSON.parse(inspected.stdout);
            if (!Array.isArray(parsed) || parsed.length !== 1) return false;
            identity = parsed[0];
        } catch {
            return false;
        }
        const labels = identity?.Config?.Labels;
        if (!identity || typeof identity !== 'object' ||
            !/^[a-f0-9]{64}$/.test(String(identity.Id || '')) ||
            identity.Name !== `/${ownership.containerName}` ||
            identity.Image !== imageId ||
            !labels || typeof labels !== 'object' ||
            labels[CALIBRATION_RUN_LABEL] !== ownership.runId ||
            labels[CALIBRATION_PURPOSE_LABEL] !== CALIBRATION_PURPOSE) {
            return false;
        }

        const removed = runDockerControl([
            'container', 'rm', '--force', ownership.containerName
        ], runner);
        if (removed.error || removed.signal || removed.status !== 0 || removed.stderr !== '') {
            return verifyCalibrationContainerAbsent(ownership.containerName, runner);
        }
        return verifyCalibrationContainerAbsent(ownership.containerName, runner);
    } catch {
        return false;
    }
}

function buildDockerInvocation(stagedPath, options, runtimeIdentity, requestedOwnership = null) {
    const imageId = runtimeIdentity?.imageId;
    if (typeof imageId !== 'string' || !EXACT_IMAGE_ID_PATTERN.test(imageId)) {
        inputError('CALIBRATION_IMAGE_IDENTITY_INVALID');
    }
    const uid = parsePositiveRuntimeId(String(runtimeIdentity?.uid), 'uid');
    const gid = parsePositiveRuntimeId(String(runtimeIdentity?.gid), 'gid');
    const ownership = validateContainerOwnership(requestedOwnership || createContainerOwnership());
    const extension = path.extname(stagedPath).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '';
    const containerInput = `/models/input${safeExtension}`;
    const filament = MATERIAL_FILAMENT_PROFILE[options.material] || null;
    const job = JSON.stringify({
        input: containerInput,
        machine: options.machine,
        material: options.material,
        layer: options.layer,
        infill: options.infill,
        filament,
        timeoutMs: Number(options.timeoutMs)
    });

    return {
        containerInput,
        ownership,
        args: [
            'run', '--rm', '--pull', 'never', '--network', 'none',
            '--name', ownership.containerName,
            '--label', `${CALIBRATION_RUN_LABEL}=${ownership.runId}`,
            '--label', `${CALIBRATION_PURPOSE_LABEL}=${CALIBRATION_PURPOSE}`,
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--pids-limit', '256',
            '--memory', String(options.memory), '--memory-swap', String(options.memory),
            '--cpus', String(options.cpus),
            '--user', `${uid}:${gid}`,
            '--read-only',
            '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=1g,uid=${uid},gid=${gid},mode=0700`,
            '--mount', `type=bind,source=${stagedPath},target=${containerInput},readonly`,
            '--env', `SZ_B2_JOB=${job}`,
            '--env', 'HOME=/tmp/home',
            '--env', 'TMPDIR=/tmp',
            '--env', 'XDG_CACHE_HOME=/tmp/cache',
            '--env', 'XDG_CONFIG_HOME=/tmp/config',
            '--env', 'XDG_RUNTIME_DIR=/tmp/runtime',
            '--entrypoint', '/usr/bin/node',
            imageId, '-e', CONTAINER_SCRIPT
        ]
    };
}

function normalizeContainerRecord(value, _redact) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    if (value.ok === false) {
        if (!/^[a-z][a-z0-9_-]{0,31}$/.test(String(value.phase || '')) ||
            !/^[A-Z][A-Z0-9_]{0,63}$/.test(String(value.code || ''))) return null;
        const failure = { ok: false, phase: value.phase, code: value.code };
        if (Object.hasOwn(value, 'status')) {
            if (!(value.status === null ||
                (Number.isSafeInteger(value.status) && value.status >= 0 && value.status <= 255))) {
                return null;
            }
            failure.status = value.status;
        }
        if (Object.hasOwn(value, 'signal')) {
            if (!(value.signal === null ||
                (typeof value.signal === 'string' && /^SIG[A-Z0-9]{1,20}$/.test(value.signal)))) {
                return null;
            }
            failure.signal = value.signal;
        }
        if (Object.hasOwn(value, 'wall_ms')) {
            if (!Number.isSafeInteger(value.wall_ms) || value.wall_ms < 0 || value.wall_ms > 3_660_000) {
                return null;
            }
            failure.wall_ms = value.wall_ms;
        }
        if (Object.hasOwn(value, 'count')) {
            if (!Number.isSafeInteger(value.count) || value.count < 0 || value.count > 100_000) {
                return null;
            }
            failure.count = value.count;
        }
        return failure;
    }
    if (value.ok !== true) return null;

    const required = [
        'wall_ms', 'gcode_bytes', 'engine_version', 'effective_profile_sha256',
        'filament_profile', 'filament_diameter_mm', 'filament_density_g_cm3',
        'print_time_seconds', 'print_time_source', 'filament_used_g',
        'filament_used_g_source', 'filament_used_mm'
    ];
    if (!required.every((key) => Object.hasOwn(value, key)) ||
        typeof value.engine_version !== 'string' ||
        !/^[0-9]+(?:\.[0-9]+){2,3}(?:[-+][A-Za-z0-9._-]+)?$/.test(value.engine_version) ||
        typeof value.effective_profile_sha256 !== 'string' ||
        !LOWERCASE_SHA256_PATTERN.test(value.effective_profile_sha256) ||
        !(value.filament_profile === null || CALIBRATION_FILAMENT_PROFILES.has(value.filament_profile))) {
        return null;
    }
    const hasFilament = value.filament_profile !== null;
    if (hasFilament !== (
        Number.isFinite(value.filament_diameter_mm) && value.filament_diameter_mm > 0 &&
        value.filament_diameter_mm <= 10 &&
        Number.isFinite(value.filament_density_g_cm3) && value.filament_density_g_cm3 > 0 &&
        value.filament_density_g_cm3 <= 100
    )) return null;
    if (!hasFilament && (value.filament_diameter_mm !== null ||
        value.filament_density_g_cm3 !== null)) return null;
    if (!Number.isSafeInteger(value.wall_ms) || value.wall_ms < 0 || value.wall_ms > 3_660_000 ||
        !Number.isSafeInteger(value.gcode_bytes) || value.gcode_bytes <= 0 ||
        value.gcode_bytes > MAX_CALIBRATION_INPUT_BYTES ||
        !Number.isSafeInteger(value.print_time_seconds) || value.print_time_seconds <= 0 ||
        value.print_time_seconds > 365 * 24 * 60 * 60 ||
        !Number.isFinite(value.filament_used_g) || value.filament_used_g <= 0 ||
        value.filament_used_g > 1_000_000 ||
        !(value.filament_used_mm === null ||
            (Number.isFinite(value.filament_used_mm) && value.filament_used_mm > 0 &&
                value.filament_used_mm <= 100_000_000)) ||
        !CALIBRATION_TIME_SOURCES.has(value.print_time_source) ||
        !CALIBRATION_GRAM_SOURCES.has(value.filament_used_g_source)) return null;

    return Object.fromEntries([
        ['ok', true],
        ...required.map((key) => [key, value[key]])
    ]);
}

function executeDockerMeasurement(entry, options, runtimeIdentity, inspected, invocation, redact) {
    const startedAt = Date.now();
    let result;
    try {
        result = spawnSync('docker', invocation.args, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            shell: false,
            timeout: Number(options.timeoutMs) + 60_000,
            windowsHide: true
        });
    } catch {
        return {
            id: entry.id,
            sha256: inspected.sha256,
            bytes: inspected.bytes,
            image_id: runtimeIdentity.imageId,
            ok: false,
            phase: 'docker',
            code: 'DOCKER_EXECUTION_FAILED'
        };
    }
    const base = {
        id: entry.id,
        sha256: inspected.sha256,
        bytes: inspected.bytes,
        image_id: runtimeIdentity.imageId,
        host_wall_ms: Date.now() - startedAt,
        docker_status: Number.isInteger(result.status) ? result.status : null
    };

    if (result.error || result.signal || result.status !== 0) {
        return {
            ...base,
            ok: false,
            phase: 'docker',
            code: result.error ? 'DOCKER_EXECUTION_FAILED' : 'DOCKER_EXIT_NONZERO'
        };
    }

    let parsed;
    try {
        const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
        parsed = JSON.parse(lines.at(-1));
    } catch {
        return { ...base, ok: false, phase: 'parse', code: 'CONTAINER_RESULT_JSON_INVALID' };
    }

    const normalized = normalizeContainerRecord(parsed, redact);
    if (!normalized) {
        return { ...base, ok: false, phase: 'parse', code: 'CONTAINER_RESULT_SHAPE_INVALID' };
    }
    return { ...base, ...normalized };
}

/**
 * Slice one manifest entry through an anonymous run-owned staging copy. The
 * private source path is never passed to Docker and every durable record is
 * restricted to anonymous IDs, exact hashes, exact runtime identity and codes.
 * @param {{id: string, sha256: string, privatePath: string}} entry Manifest entry.
 * @param {Record<string, string | number>} options Resolved CLI options.
 * @param {{imageId: string, uid: number, gid: number}} runtimeIdentity Positive image identity.
 * @returns {Record<string, unknown>} Privacy-safe measurement record.
 */
function measureModel(entry, options, runtimeIdentity) {
    const absolutePath = path.resolve(entry.privatePath);
    const inspected = inspectPrivateFile(absolutePath);
    if (!inspected.ok) {
        return { id: entry.id, ok: false, phase: 'input', code: inspected.code };
    }
    if (inspected.sha256 !== entry.sha256) {
        return { id: entry.id, ok: false, phase: 'hash', code: 'MODEL_SHA256_MISMATCH' };
    }

    let stage = null;
    let invocation = null;
    let record;
    try {
        stage = stagePrivateModel(entry, inspected);
        invocation = buildDockerInvocation(stage.canonicalPath, options, runtimeIdentity);
        const redact = createPathRedactor(absolutePath, [
            inspected.canonicalPath,
            stage.root,
            stage.filePath,
            stage.canonicalPath,
            invocation.containerInput,
            path.dirname(invocation.containerInput),
            path.basename(invocation.containerInput)
        ]);
        record = executeDockerMeasurement(
            entry,
            options,
            runtimeIdentity,
            inspected,
            invocation,
            redact
        );
    } catch (error) {
        record = {
            id: entry.id,
            sha256: inspected.sha256,
            bytes: inspected.bytes,
            image_id: runtimeIdentity.imageId,
            ok: false,
            phase: 'staging',
            code: error instanceof CalibrationInputError
                ? error.code
                : 'CALIBRATION_STAGE_FAILED'
        };
    } finally {
        const containerClean = invocation === null || cleanupCalibrationContainer(
            invocation.ownership,
            runtimeIdentity.imageId
        );
        const stageClean = stage === null || cleanupStagedModel(stage);
        if (!containerClean) {
            record = {
                id: entry.id,
                sha256: inspected.sha256,
                bytes: inspected.bytes,
                image_id: runtimeIdentity.imageId,
                ok: false,
                phase: 'cleanup',
                code: 'CALIBRATION_CONTAINER_CLEANUP_FAILED'
            };
        } else if (!stageClean) {
            record = {
                id: entry.id,
                sha256: inspected.sha256,
                bytes: inspected.bytes,
                image_id: runtimeIdentity.imageId,
                ok: false,
                phase: 'cleanup',
                code: 'CALIBRATION_STAGE_CLEANUP_FAILED'
            };
        }
    }

    const verifiedAfterRun = inspectPrivateFile(absolutePath);
    if (!verifiedAfterRun.ok || verifiedAfterRun.sha256 !== entry.sha256 ||
        verifiedAfterRun.bytes !== inspected.bytes ||
        verifiedAfterRun.canonicalPath !== inspected.canonicalPath) {
        return {
            id: entry.id,
            image_id: runtimeIdentity.imageId,
            ok: false,
            phase: 'hash',
            code: 'MODEL_CHANGED_DURING_MEASUREMENT'
        };
    }
    return record;
}

/**
 * Render anonymous calibration records as a Markdown table.
 * @param {Array<Record<string, unknown>>} records Measurement records.
 * @returns {string} Markdown table.
 */
function renderTable(records) {
    const lines = [
        '| Azonosító | Méret | Ellenőrzött SHA-256 | Image ID | Orca verzió | Profil SHA-256 | Filamentprofil | Orca idő | Orca gramm | Bambu Studio idő | Bambu Studio gramm | Eltérés idő % | Eltérés gramm % |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
    ];

    for (const record of records) {
        const seconds = Number(record.print_time_seconds) || 0;
        const phase = /^[a-z0-9_-]+$/i.test(String(record.phase || ''))
            ? String(record.phase)
            : 'ismeretlen';
        const readable = record.ok
            ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m (${seconds} mp)`
            : `HIBA (${phase})`;
        const grams = record.ok ? `${record.filament_used_g} g` : '—';
        const bytes = Number(record.bytes);
        const size = Number.isFinite(bytes) ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : '—';
        const sha256 = LOWERCASE_SHA256_PATTERN.test(String(record.sha256 || ''))
            ? String(record.sha256)
            : '—';
        const imageId = EXACT_IMAGE_ID_PATTERN.test(String(record.image_id || ''))
            ? String(record.image_id)
            : '—';
        const engineVersion = /^[0-9]+(?:\.[0-9]+){2,3}(?:[-+][A-Za-z0-9._-]+)?$/.test(
            String(record.engine_version || '')
        ) ? String(record.engine_version) : '—';
        const profileSha256 = LOWERCASE_SHA256_PATTERN.test(
            String(record.effective_profile_sha256 || '')
        ) ? String(record.effective_profile_sha256) : '—';
        const filamentProfile = record.filament_profile === null
            ? 'kézi ár (null)'
            : MACHINE_PROFILE_PATTERN.test(String(record.filament_profile || ''))
                ? String(record.filament_profile)
                : '—';
        lines.push(
            `| ${record.id} | ${size} | \`${sha256}\` | \`${imageId}\` | ${engineVersion} | ` +
            `\`${profileSha256}\` | ${filamentProfile} | ${readable} | ${grams} | ` +
            '____ | ____ | ____ | ____ |'
        );
    }

    return lines.join('\n');
}

function safeErrorCode(error) {
    return error instanceof CalibrationInputError ? error.code : 'CALIBRATION_FAILED';
}

function main() {
    try {
        const { options } = parseArgs(process.argv.slice(2));
        const entries = loadManifest(String(options.manifest));
        const runtimeIdentity = resolveImageRuntimeIdentity(options.image);
        const records = [];

        for (const entry of entries) {
            const record = measureModel(entry, options, runtimeIdentity);
            records.push(record);
            const verifiedIdentity = record.sha256 ? ` ${record.sha256}` : '';
            process.stderr.write(`[SZ-B2] ${record.id}${verifiedIdentity}\n`);
            process.stdout.write(`${JSON.stringify(record)}\n`);
        }

        process.stdout.write(`\n${renderTable(records)}\n`);
        if (records.some((record) => !record.ok)) process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`SZ-B2 calibration failed: ${safeErrorCode(error)}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    ANONYMOUS_ID_PATTERN,
    CONTAINER_SCRIPT,
    DEFAULTS,
    EXACT_IMAGE_ID_PATTERN,
    LOWERCASE_SHA256_PATTERN,
    MATERIAL_FILAMENT_PROFILE,
    MAX_CALIBRATION_INPUT_BYTES,
    MAX_MANIFEST_BYTES,
    buildDockerInvocation,
    cleanupCalibrationContainer,
    cleanupStagedModel,
    createContainerOwnership,
    createPathRedactor,
    inspectPrivateFile,
    measureModel,
    normalizeContainerRecord,
    parsePositiveRuntimeId,
    parseArgs,
    renderTable,
    resolveImageRuntimeIdentity,
    sanitizePrivateValue,
    stagePrivateModel,
    validateManifest
};
