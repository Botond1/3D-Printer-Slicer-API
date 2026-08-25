/**
 * Slicer engine command composition helpers.
 */

const path = require('node:path');

const ORCA_INVOCATION_POLICY = Object.freeze({
    arrange: '1',
    orient: '0',
    slice: '0'
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
 * Return the request-independent native invocation policy used for profile identity.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @returns {Readonly<Record<string, string|boolean>>} Stable server-owned CLI policy.
 */
function resolveSlicerInvocationPolicy(engine, technology) {
    if (engine === 'orca') return ORCA_INVOCATION_POLICY;
    return technology === 'SLA' ? PRUSA_SLA_INVOCATION_POLICY : PRUSA_FDM_INVOCATION_POLICY;
}

/**
 * Resolve slicer executable name from engine identifier.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {'prusa-slicer'|'orca-slicer'} CLI executable name.
 */
function resolveSlicerExecutable(engine) {
    return engine === 'orca' ? 'orca-slicer' : 'prusa-slicer';
}

/**
 * Build command-line arguments array for selected slicer engine and technology.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} configFile Runtime profile/config path.
 * @param {string} outputPath Desired output artifact path.
 * @param {string} infillPercentage Infill override (e.g. `20%`).
 * @param {'prusa'|'orca'} [engine='prusa'] Selected slicer engine.
 * @param {string | null} [orcaMachineConfigPath=null] Orca machine profile path.
 * @returns {string[]} CLI argument array.
 */
function buildSlicerCommandArgs(technology, configFile, outputPath, infillPercentage, engine = 'prusa', orcaMachineConfigPath = null) {
    const policy = resolveSlicerInvocationPolicy(engine, technology);
    if (engine === 'orca') {
        const outputDir = path.dirname(outputPath);
        const settingsFiles = [orcaMachineConfigPath, configFile].filter(Boolean).join(';');
        return [
            '--load-settings', settingsFiles,
            '--arrange', policy.arrange,
            '--orient', policy.orient,
            '--slice', policy.slice,
            '--outputdir', outputDir
        ];
    }

    const args = ['--load', configFile, '--center', policy.center];

    if (technology === 'SLA') {
        args.push('--export-sla', '--output', outputPath);
    } else {
        if (policy.supportMaterial) args.push('--support-material');
        if (policy.supportMaterialAuto) args.push('--support-material-auto');
        args.push(
            '--gcode-flavor', policy.gcodeFlavor,
            '--export-gcode', '--output', outputPath,
            '--fill-density', infillPercentage
        );
    }

    return args;
}

module.exports = {
    resolveSlicerExecutable,
    resolveSlicerInvocationPolicy,
    buildSlicerCommandArgs
};
