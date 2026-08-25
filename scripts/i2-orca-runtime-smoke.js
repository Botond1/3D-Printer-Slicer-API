'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { validateImageId, validateName } = require('./i2-image-runtime-diagnostics');

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const DOCKER_TIMEOUT_MS = 300_000;
const SUCCESS_MARKER = '{"orca_cli_help":"pass","synthetic_slice":"pass"}\n';
const VALIDATION_LABEL = 'io.s3a.validation-only';
const IMAGE_LABEL = 'io.s3a.expected-image-id';
const INSPECT_FORMAT = `{{json .Id}}|{{json .Image}}|{{json (index .Config.Labels "${VALIDATION_LABEL}")}}|` +
    `{{json (index .Config.Labels "${IMAGE_LABEL}")}}`;

const BASE_SYNTHETIC_TRIANGLES = Object.freeze([
    { normal: [0, 0, -1], vertices: [[0, 0, 0], [10, 20, 0], [10, 0, 0]] },
    { normal: [0, 0, -1], vertices: [[0, 0, 0], [0, 20, 0], [10, 20, 0]] },
    { normal: [0, 0, 1], vertices: [[0, 0, 30], [10, 0, 30], [10, 20, 30]] },
    { normal: [0, 0, 1], vertices: [[0, 0, 30], [10, 20, 30], [0, 20, 30]] },
    { normal: [0, -1, 0], vertices: [[0, 0, 0], [10, 0, 0], [10, 0, 30]] },
    { normal: [0, -1, 0], vertices: [[0, 0, 0], [10, 0, 30], [0, 0, 30]] },
    { normal: [1, 0, 0], vertices: [[10, 0, 0], [10, 20, 0], [10, 20, 30]] },
    { normal: [1, 0, 0], vertices: [[10, 0, 0], [10, 20, 30], [10, 0, 30]] },
    { normal: [0, 1, 0], vertices: [[10, 20, 0], [0, 20, 0], [0, 20, 30]] },
    { normal: [0, 1, 0], vertices: [[10, 20, 0], [0, 20, 30], [10, 20, 30]] },
    { normal: [-1, 0, 0], vertices: [[0, 20, 0], [0, 0, 0], [0, 0, 30]] },
    { normal: [-1, 0, 0], vertices: [[0, 20, 0], [0, 0, 30], [0, 20, 30]] }
]);

function rotateTrianglesX90(triangles) {
    const maximumZ = Math.max(...triangles.flatMap(({ vertices }) =>
        vertices.map((vertex) => vertex[2])));
    return triangles.map(({ normal, vertices }) => ({
        normal: [normal[0], -normal[2], normal[1]],
        vertices: vertices.map(([x, y, z]) => [x, maximumZ - z, y])
    }));
}

// Simulates the request-owned rotation already baked into the STL before Orca.
const SYNTHETIC_TRIANGLES = Object.freeze(rotateTrianglesX90(BASE_SYNTHETIC_TRIANGLES));

function buildSyntheticStl(triangles = SYNTHETIC_TRIANGLES) {
    if (!Array.isArray(triangles) || triangles.length !== 12) throw new Error('stl_triangle_count');
    const lines = ['solid synthetic-pre-rotated-asymmetric-prism'];
    for (const triangle of triangles) {
        if (!triangle || !Array.isArray(triangle.normal) || triangle.normal.length !== 3 ||
            !Array.isArray(triangle.vertices) || triangle.vertices.length !== 3) {
            throw new Error('stl_triangle_shape');
        }
        const values = [...triangle.normal, ...triangle.vertices.flat()];
        if (values.length !== 12 || values.some((value) => !Number.isFinite(value))) {
            throw new Error('stl_coordinate_shape');
        }
        lines.push(`  facet normal ${triangle.normal.join(' ')}`, '    outer loop');
        for (const vertex of triangle.vertices) {
            if (!Array.isArray(vertex) || vertex.length !== 3) throw new Error('stl_vertex_shape');
            lines.push(`      vertex ${vertex.join(' ')}`);
        }
        lines.push('    endloop', '  endfacet');
    }
    lines.push('endsolid synthetic-pre-rotated-asymmetric-prism', '');
    return lines.join('\n');
}

function hasPositiveExtrusionMove(gcodePrefix) {
    if (typeof gcodePrefix !== 'string') return false;
    const layerMarker = /(?:^|\r?\n);BEFORE_LAYER_CHANGE(?:\r?\n|$)/.exec(gcodePrefix);
    if (!layerMarker) return false;
    const modelLayer = gcodePrefix.slice(layerMarker.index + layerMarker[0].length);
    return modelLayer.split(/\r?\n/).some((line) => {
        if (!/^G1(?:\s|$)/.test(line)) return false;
        const extrusion = /(?:^|\s)E(-?(?:\d+(?:\.\d*)?|\.\d+))(?=\s|;|$)/.exec(line);
        return extrusion !== null && Number(extrusion[1]) > 0;
    });
}

const SYNTHETIC_STL = buildSyntheticStl();

const ORCA_CONTAINER_SCRIPT = String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRuntimeSlicerProfile } = require('/app/services/slice/profiles');
const { buildSlicerCommandArgs } = require('/app/services/slice/engine');
const { snapshotProfileSelection } = require('/app/services/slice/profile-snapshot');

const MAX_ORCA_OUTPUT_BYTES = 1024 * 10000;
const MAX_GCODE_PREFIX_BYTES = 256 * 1024;
const root = '/tmp/orca-smoke';
const input = path.join(root, 'input');
const output = path.join(root, 'output');
const model = path.join(input, 'synthetic-pre-rotated-asymmetric-prism.stl');
const machineProfile = '/app/configs/orca/Bambu_P1S_0.4_nozzle.json';
const baseProcessProfile = '/app/configs/orca/FDM_0.2mm.json';
const syntheticStl = ${JSON.stringify(SYNTHETIC_STL)};
const hasPositiveExtrusionMove = ${hasPositiveExtrusionMove.toString()};
const childEnvironment = Object.freeze({
    HOME: '/tmp/home',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    QT_QPA_PLATFORM: 'offscreen',
    TMPDIR: '/tmp',
    XDG_CACHE_HOME: '/tmp/cache',
    XDG_CONFIG_HOME: '/tmp/config',
    XDG_RUNTIME_DIR: '/tmp/runtime'
});

function exit(code) {
    process.exit(code);
}

function runOrca(args, timeout) {
    return spawnSync('/usr/local/bin/orca-slicer', args, {
        encoding: 'utf8',
        env: childEnvironment,
        maxBuffer: MAX_ORCA_OUTPUT_BYTES,
        shell: false,
        timeout,
        windowsHide: true
    });
}

function boundedText(value) {
    const text = typeof value === 'string' ? value : '';
    return text.slice(-2048).replace(/[^\x09\x0a\x20-\x7e]/g, '?');
}

function emitFailure(phase, result) {
    const errorCode = typeof result?.error?.code === 'string' &&
        /^[A-Z0-9_]{1,40}$/.test(result.error.code) ? result.error.code : null;
    const payload = {
        phase,
        status: Number.isInteger(result?.status) ? result.status : null,
        signal: typeof result?.signal === 'string' && /^[A-Z0-9]{1,20}$/.test(result.signal)
            ? result.signal : null,
        error_code: errorCode,
        stdout_bytes: Buffer.byteLength(typeof result?.stdout === 'string' ? result.stdout : ''),
        stderr_bytes: Buffer.byteLength(typeof result?.stderr === 'string' ? result.stderr : ''),
        stdout_tail: boundedText(result?.stdout),
        stderr_tail: boundedText(result?.stderr)
    };
    process.stderr.write(JSON.stringify(payload) + '\n');
}

function readPrefix(filePath, size) {
    const length = Math.min(size, MAX_GCODE_PREFIX_BYTES);
    const buffer = Buffer.alloc(length);
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const bytesRead = fs.readSync(descriptor, buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
        fs.closeSync(descriptor);
    }
}

function assertRuntimeProfile(profilePath) {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (profile.layer_height !== '0.2' || profile.sparse_infill_density !== '20%' ||
        profile.layer_gcode !== '' || profile.use_relative_e_distances !== '1') {
        throw new Error('runtime_profile_contract');
    }
}

function assertMachineProfile(profilePath) {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (typeof profile.before_layer_change_gcode !== 'string' ||
        !/(?:^|\n)G92 E0(?:\s|$)/.test(profile.before_layer_change_gcode)) {
        throw new Error('machine_profile_extrusion_contract');
    }
}

function prepareSmokeDirectories() {
    for (const directory of [root, input, output, childEnvironment.HOME,
        childEnvironment.XDG_CACHE_HOME, childEnvironment.XDG_CONFIG_HOME,
        childEnvironment.XDG_RUNTIME_DIR]) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
}

function assertHelpContract() {
    const help = runOrca(['--help'], 60_000);
    if (help.error || help.signal || help.status !== 0) {
        emitFailure('help', help);
        exit(20);
    }
    const helpOutput = (help.stdout || '') + (help.stderr || '');
    if (!/OrcaSlicer-2\.3\.1(?:\b|[-+])/.test(helpOutput) ||
        !/(?:Usage:|OPTIONS:|--help)/.test(helpOutput)) exit(21);
}

function createSmokeWorkspace() {
    const assertContained = (candidatePath) => {
        const resolved = path.resolve(candidatePath);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            throw new Error('runtime_profile_escape');
        }
        return resolved;
    };
    return {
        resolveScratchPath: (...segments) => path.resolve(root, ...segments),
        resolvePath: (...segments) => path.resolve(root, ...segments),
        assertScratchContainedPath: assertContained,
        assertContainedPath: assertContained
    };
}

async function prepareSliceInvocation() {
    fs.writeFileSync(model, syntheticStl, { encoding: 'ascii', flag: 'wx', mode: 0o600 });
    const workspace = createSmokeWorkspace();
    const snapshots = await snapshotProfileSelection('orca', {
        baseConfigFile: baseProcessProfile,
        orcaMachineConfigFile: machineProfile
    }, workspace);
    assertMachineProfile(snapshots.orcaMachineConfigFile);
    const runtimeProcessProfile = await createRuntimeSlicerProfile(
        'orca', snapshots.baseConfigFile, 'FDM', 0.2, '20%', workspace);
    assertRuntimeProfile(runtimeProcessProfile);
    const desiredOutput = path.join(output, 'result.gcode');
    const slicerArgs = buildSlicerCommandArgs(
        'FDM', runtimeProcessProfile, desiredOutput, '20%', 'orca', snapshots.orcaMachineConfigFile);
    const arrangeIndex = slicerArgs.indexOf('--arrange');
    const orientIndex = slicerArgs.indexOf('--orient');
    if (arrangeIndex < 0 || slicerArgs[arrangeIndex + 1] !== '1' ||
        orientIndex < 0 || slicerArgs[orientIndex + 1] !== '0') exit(29);
    return slicerArgs;
}

function runSliceProbe(slicerArgs) {
    const sliced = runOrca([...slicerArgs, model], 180_000);
    if (sliced.error || sliced.signal || sliced.status !== 0) {
        emitFailure('slice', sliced);
        exit(30);
    }
}

function assertGeneratedGcode() {
    const generated = fs.readdirSync(output)
        .filter((name) => name.toLowerCase().endsWith('.gcode'));
    if (generated.length !== 1) exit(31);
    const generatedPath = path.join(output, generated[0]);
    const stat = fs.lstatSync(generatedPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 ||
        stat.size > 32 * 1024 * 1024) exit(32);
    const prefix = readPrefix(generatedPath, stat.size);
    if (!/^;\s*generated by OrcaSlicer 2\.3\.1(?:\b|[-+])/mi.test(prefix) ||
        !hasPositiveExtrusionMove(prefix)) exit(33);
    if (!/^M83(?:\s|;|$)/m.test(prefix) || /^M82(?:\s|;|$)/m.test(prefix) ||
        !/^G92\s+E0(?:\.0*)?(?:\s|;|$)/m.test(prefix)) exit(34);
}

async function executeSmoke() {
    prepareSmokeDirectories();
    assertHelpContract();
    const slicerArgs = await prepareSliceInvocation();
    runSliceProbe(slicerArgs);
    assertGeneratedGcode();
    process.stdout.write('{"orca_cli_help":"pass","synthetic_slice":"pass"}\n');
}

void executeSmoke().catch(() => exit(39));
`;

function parsePositiveEnvironmentId(value, label) {
    if (!['uid', 'gid'].includes(label) || typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
        throw new Error(`${label}_shape`);
    }
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 2147483647) {
        throw new Error(`${label}_invalid`);
    }
    return numeric;
}

function buildCreateArgs(name, imageId, uidValue, gidValue) {
    const uid = parsePositiveEnvironmentId(uidValue, 'uid');
    const gid = parsePositiveEnvironmentId(gidValue, 'gid');
    const exactImageId = validateImageId(imageId);
    return [
        'container', 'create', '--pull', 'never', '--network', 'none',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '256', '--memory', '4g', '--cpus', '2',
        '--read-only', '--name', validateName(name),
        '--label', `${VALIDATION_LABEL}=true`,
        '--label', `${IMAGE_LABEL}=${exactImageId}`,
        '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=256m,uid=${uid},gid=${gid},mode=0700`,
        '--entrypoint', '/usr/bin/node',
        exactImageId, '-e', ORCA_CONTAINER_SCRIPT
    ];
}

function buildInspectArgs(reference) {
    const value = /^[0-9a-f]{64}$/.test(reference) ? reference : validateName(reference);
    return ['container', 'inspect', '--format', INSPECT_FORMAT, value];
}

function buildStartArgs(containerId) {
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('container_id_invalid');
    return ['container', 'start', '--attach', containerId];
}

function buildRemoveArgs(containerId) {
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('container_id_invalid');
    return ['container', 'rm', '--force', containerId];
}

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

function parseInspectResult(result, reference) {
    if (!result || !Number.isInteger(result.status) || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string') throw new Error('container_lookup_shape');
    if (result.status === 0) {
        const pattern = /^("[0-9a-f]{64}")\|("sha256:[0-9a-f]{64}")\|("[A-Za-z0-9_.:-]{1,100}")\|("sha256:[0-9a-f]{64}")\r?\n?$/;
        const match = pattern.exec(result.stdout);
        if (!match || result.stderr !== '') throw new Error('container_lookup_shape');
        return {
            id: JSON.parse(match[1]),
            imageId: JSON.parse(match[2]),
            validationLabel: JSON.parse(match[3]),
            expectedImageId: JSON.parse(match[4])
        };
    }
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const absent = new RegExp(`^(?:Error: No such (?:object|container): |` +
        `Error response from daemon: No such container: )${escaped}\\r?\\n?$`);
    if (result.status !== 1 || !/^(?:\r?\n|\[\]\r?\n?)?$/.test(result.stdout) ||
        !absent.test(result.stderr)) throw new Error('container_lookup_failure');
    return null;
}

function inspectContainer(reference, docker = runDocker) {
    return parseInspectResult(docker(buildInspectArgs(reference), 10_000), reference);
}

function assertOwned(record, containerId, imageId) {
    if (!record || record.id !== containerId || record.imageId !== imageId ||
        record.validationLabel !== 'true' || record.expectedImageId !== imageId) {
        throw new Error('container_ownership_failure');
    }
}

function parseCreateResult(result) {
    if (!result || result.status !== 0 || result.stderr !== '' ||
        !/^[0-9a-f]{64}\r?\n$/.test(result.stdout)) {
        throw new Error('orca_container_create_failure');
    }
    return result.stdout.replace(/\r?\n$/, '');
}

function parseSmokeResult(result) {
    if (!result || !Number.isInteger(result.status) || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string') {
        throw new Error('orca_smoke_result_shape');
    }
    const failures = new Map([
        [20, 'orca_help_execution_failure'],
        [21, 'orca_help_contract_failure'],
        [29, 'orca_invocation_policy_failure'],
        [30, 'orca_slice_execution_failure'],
        [31, 'orca_slice_output_count_failure'],
        [32, 'orca_slice_output_contract_failure'],
        [33, 'orca_slice_content_failure'],
        [34, 'orca_extrusion_mode_failure'],
        [39, 'orca_smoke_internal_failure']
    ]);
    if (result.status !== 0) throw new Error(failures.get(result.status) || 'orca_smoke_failure');
    if (result.stderr !== '' || result.stdout !== SUCCESS_MARKER) {
        throw new Error('orca_smoke_output_failure');
    }
}

function parseFailureDiagnostic(stderr) {
    if (typeof stderr !== 'string' || Buffer.byteLength(stderr) > MAX_DIAGNOSTIC_BYTES) return null;
    let payload;
    try {
        payload = JSON.parse(stderr.replace(/\r?\n$/, ''));
    } catch {
        return null;
    }
    const keys = Object.keys(payload).sort();
    const expectedKeys = ['error_code', 'phase', 'signal', 'status', 'stderr_bytes',
        'stderr_tail', 'stdout_bytes', 'stdout_tail'];
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys.sort()) ||
        !['help', 'slice'].includes(payload.phase) ||
        !(payload.status === null || (Number.isInteger(payload.status) &&
            payload.status >= 0 && payload.status <= 255)) ||
        !(payload.signal === null || /^[A-Z0-9]{1,20}$/.test(payload.signal)) ||
        !(payload.error_code === null || /^[A-Z0-9_]{1,40}$/.test(payload.error_code)) ||
        !Number.isSafeInteger(payload.stdout_bytes) || payload.stdout_bytes < 0 ||
        payload.stdout_bytes > 20 * 1024 * 1024 ||
        !Number.isSafeInteger(payload.stderr_bytes) || payload.stderr_bytes < 0 ||
        payload.stderr_bytes > 20 * 1024 * 1024 ||
        typeof payload.stdout_tail !== 'string' || typeof payload.stderr_tail !== 'string' ||
        Buffer.byteLength(payload.stdout_tail) > 4096 ||
        Buffer.byteLength(payload.stderr_tail) > 4096) return null;
    return payload;
}

function reportFailureDiagnostic(result) {
    const payload = parseFailureDiagnostic(result?.stderr);
    if (payload) process.stderr.write(`I2_ORCA_DIAGNOSTIC ${JSON.stringify(payload)}\n`);
}

function cleanupOwnedContainer(containerId, imageId, docker = runDocker) {
    const record = inspectContainer(containerId, docker);
    assertOwned(record, containerId, imageId);
    const removed = docker(buildRemoveArgs(containerId), 10_000);
    if (removed.status !== 0) throw new Error('container_cleanup_failure');
    if (inspectContainer(containerId, docker) !== null) throw new Error('container_cleanup_incomplete');
}

function appendSuccess(outputPath) {
    if (!outputPath) throw new Error('github_output_missing');
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('github_output_invalid');
    fs.appendFileSync(outputPath,
        'help=success\nsynthetic_slice=success\nclassification=success\n',
        { encoding: 'utf8' });
}

function runSmoke(env = process.env, docker = runDocker) {
    const name = validateName(env.I2_ORCA_PROBE_NAME);
    const imageId = validateImageId(env.EXPECTED_IMAGE_ID);
    if (inspectContainer(name, docker) !== null) throw new Error('probe_name_collision');
    let containerId;
    let failure;
    try {
        containerId = parseCreateResult(docker(
            buildCreateArgs(name, imageId, env.SERVICE_UID, env.SERVICE_GID)));
        assertOwned(inspectContainer(containerId, docker), containerId, imageId);
        const started = docker(buildStartArgs(containerId));
        if (started.status !== 0) reportFailureDiagnostic(started);
        parseSmokeResult(started);
        appendSuccess(env.GITHUB_OUTPUT);
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
    DOCKER_TIMEOUT_MS, IMAGE_LABEL, INSPECT_FORMAT,
    MAX_DIAGNOSTIC_BYTES, MAX_OUTPUT_BYTES, ORCA_CONTAINER_SCRIPT, SUCCESS_MARKER,
    BASE_SYNTHETIC_TRIANGLES, SYNTHETIC_STL, SYNTHETIC_TRIANGLES, VALIDATION_LABEL,
    assertOwned, buildCreateArgs, buildInspectArgs, buildRemoveArgs, buildStartArgs,
    buildSyntheticStl, cleanupOwnedContainer, hasPositiveExtrusionMove,
    parseCreateResult, parseFailureDiagnostic, parseInspectResult,
    parsePositiveEnvironmentId, parseSmokeResult, rotateTrianglesX90, runDocker, runSmoke
});

if (require.main === module) main();
