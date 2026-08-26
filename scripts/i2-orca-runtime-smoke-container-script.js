'use strict';

const { SYNTHETIC_STL, hasPositiveExtrusionMove } =
    require('./i2-orca-runtime-smoke-fixture');

const ORCA_CONTAINER_SCRIPT_TEMPLATE = String.raw`
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
    if (profile.layer_change_gcode !== 'G92 E0') {
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

function buildOrcaContainerScript() {
    return ORCA_CONTAINER_SCRIPT_TEMPLATE;
}

const ORCA_CONTAINER_SCRIPT = buildOrcaContainerScript();

module.exports = Object.freeze({ buildOrcaContainerScript, ORCA_CONTAINER_SCRIPT });
