/**
 * Slicer engine command composition helpers.
 */

const path = require('node:path');

const SUPPORTED_ENGINES = Object.freeze(['prusa', 'orca', 'bambu']);
const SLICER_EXECUTABLES = Object.freeze({
    prusa: 'prusa-slicer',
    orca: 'orca-slicer',
    bambu: 'bambu-studio'
});

const ORCA_INVOCATION_POLICY = Object.freeze({
    arrange: '1',
    orient: '0',
    allowRotations: '0',
    slice: '0',
    settingsPrecedence: Object.freeze(['machine', 'process']),
    filamentOption: '--load-filaments'
});
/**
 * Bambu Studio 2.8 headless policy. `--export-3mf` receives a path RELATIVE to
 * `--outputdir`, the plate G-code appears beside it as `plate_1.gcode`, and
 * Bambu's `--allow-rotations` takes no value (it defaults off) so it is never
 * passed. The bed type is a per-printer registry value; the policy carries the
 * default so the digest binds a stable server-owned invocation shape.
 */
const BAMBU_INVOCATION_POLICY = Object.freeze({
    arrange: '1',
    orient: '0',
    slice: '0',
    bedType: 'Textured PEI Plate',
    export3mf: true,
    settingsPrecedence: Object.freeze(['machine', 'process']),
    filamentOption: '--load-filaments'
});
const PRUSA_FDM_INVOCATION_POLICY = Object.freeze({
    center: '100,100',
    supportMaterial: true,
    supportMaterialAuto: true,
    gcodeFlavor: 'marlin',
    export: 'gcode'
});
const PRUSA_SLA_INVOCATION_POLICY = Object.freeze({
    center: '100,100',
    export: 'sla'
});

/**
 * Whether a value names one of the supported native engines.
 * @param {unknown} engine Candidate engine key.
 * @returns {boolean} True for `prusa`, `orca`, or `bambu`.
 */
function isSupportedEngine(engine) {
    return SUPPORTED_ENGINES.includes(engine);
}

/**
 * Return the request-independent native invocation policy used for profile identity.
 * @param {'prusa'|'orca'|'bambu'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @returns {Readonly<Record<string, string|boolean|readonly string[]>>} Stable server-owned CLI policy.
 */
function resolveSlicerInvocationPolicy(engine, technology) {
    if (engine === 'orca') return ORCA_INVOCATION_POLICY;
    if (engine === 'bambu') return BAMBU_INVOCATION_POLICY;
    return technology === 'SLA' ? PRUSA_SLA_INVOCATION_POLICY : PRUSA_FDM_INVOCATION_POLICY;
}

/**
 * Resolve slicer executable name from engine identifier.
 * @param {'prusa'|'orca'|'bambu'} engine Slicer engine key.
 * @returns {'prusa-slicer'|'orca-slicer'|'bambu-studio'} CLI executable name.
 */
function resolveSlicerExecutable(engine) {
    return SLICER_EXECUTABLES[engine] || SLICER_EXECUTABLES.prusa;
}

function resolvePrusaExportFlag(exportMode) {
    if (exportMode !== 'gcode' && exportMode !== 'sla') {
        throw new Error('Unsupported Prusa export policy.');
    }
    return `--export-${exportMode}`;
}

function composeOrcaSettingsFiles(policy, orcaMachineConfigPath, configFile) {
    const settingsByRole = {
        machine: orcaMachineConfigPath,
        process: configFile
    };
    return policy.settingsPrecedence
        .map((role) => settingsByRole[role])
        .filter(Boolean)
        .join(';');
}

function buildOrcaArgs(policy, configFile, outputPath, orcaMachineConfigPath, orcaFilamentConfigPath) {
    const outputDir = path.dirname(outputPath);
    const settingsFiles = composeOrcaSettingsFiles(policy, orcaMachineConfigPath, configFile);
    const args = ['--load-settings', settingsFiles];
    if (orcaFilamentConfigPath) {
        args.push(policy.filamentOption, orcaFilamentConfigPath);
    }
    args.push(
        '--arrange', policy.arrange,
        '--orient', policy.orient,
        `--allow-rotations=${policy.allowRotations}`,
        '--slice', policy.slice,
        '--outputdir', outputDir
    );
    return args;
}

function buildBambuArgs(policy, configFile, outputPath, machineConfigPath, filamentConfigPath, engineOptions) {
    if (typeof machineConfigPath !== 'string' || !machineConfigPath) {
        throw new Error('Bambu machine profile is required.');
    }
    if (typeof filamentConfigPath !== 'string' || !filamentConfigPath) {
        throw new Error('Bambu filament profile is required.');
    }
    const exportName = path.basename(outputPath);
    if (!exportName.toLowerCase().endsWith('.gcode.3mf')) {
        throw new Error('Bambu export target must be a .gcode.3mf path.');
    }
    const bedType = typeof engineOptions.bedType === 'string' && engineOptions.bedType
        ? engineOptions.bedType
        : policy.bedType;
    return [
        '--load-settings', composeOrcaSettingsFiles(policy, machineConfigPath, configFile),
        policy.filamentOption, filamentConfigPath,
        '--curr-bed-type', bedType,
        '--arrange', policy.arrange,
        '--orient', policy.orient,
        '--slice', policy.slice,
        '--export-3mf', exportName,
        '--outputdir', path.dirname(outputPath)
    ];
}

function buildPrusaArgs(policy, technology, configFile, outputPath, infillPercentage, engineOptions) {
    const args = ['--load', configFile, '--center', policy.center];
    if (technology === 'SLA') {
        args.push(resolvePrusaExportFlag(policy.export), '--output', outputPath);
        return args;
    }
    // Support flags stay exactly as today for the default; `supports=false`
    // omits them and the runtime INI carries the explicit zero values instead.
    const supports = engineOptions.supports !== false;
    if (policy.supportMaterial && supports) args.push('--support-material');
    if (policy.supportMaterialAuto && supports) args.push('--support-material-auto');
    args.push(
        '--gcode-flavor', policy.gcodeFlavor,
        resolvePrusaExportFlag(policy.export), '--output', outputPath,
        '--fill-density', infillPercentage
    );
    return args;
}

/**
 * Build command-line arguments array for selected slicer engine and technology.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} configFile Runtime profile/config path.
 * @param {string} outputPath Desired output artifact path.
 * @param {string} infillPercentage Infill override (e.g. `20%`).
 * @param {'prusa'|'orca'|'bambu'} [engine='prusa'] Selected slicer engine.
 * @param {string | null} [machineConfigPath=null] Orca/Bambu machine profile path.
 * @param {string | null} [filamentConfigPath=null] Orca/Bambu filament profile path.
 * @param {{supports?: boolean, bedType?: string}} [engineOptions={}] Request-controlled engine options.
 * @returns {string[]} CLI argument array.
 */
function buildSlicerCommandArgs(
    technology,
    configFile,
    outputPath,
    infillPercentage,
    engine = 'prusa',
    machineConfigPath = null,
    filamentConfigPath = null,
    engineOptions = {}
) {
    const policy = resolveSlicerInvocationPolicy(engine, technology);
    const options = engineOptions && typeof engineOptions === 'object' ? engineOptions : {};
    if (engine === 'orca') {
        return buildOrcaArgs(policy, configFile, outputPath, machineConfigPath, filamentConfigPath);
    }
    if (engine === 'bambu') {
        return buildBambuArgs(policy, configFile, outputPath, machineConfigPath, filamentConfigPath, options);
    }
    return buildPrusaArgs(policy, technology, configFile, outputPath, infillPercentage, options);
}

module.exports = {
    SUPPORTED_ENGINES,
    composeOrcaSettingsFiles,
    isSupportedEngine,
    resolveSlicerExecutable,
    resolveSlicerInvocationPolicy,
    buildSlicerCommandArgs
};
