/** Contained slicer output staging, validation, parsing, and exclusive promotion. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { runCommand, throwIfAborted } = require('./command');
const { resolveSingleOutputFile } = require('./common');
const { parseOutputDetailed } = require('./model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./engine');
const { getSlicerEngineVersion } = require('./engine-version');
const { createRuntimeSlicerProfile, logEngineProfileSelection } = require('./profiles');
const { calculateEffectiveProfileSha256 } = require('./profile-digest');
const {
    readOrcaFilamentProfileMetadata,
    resolveMaterialFilamentMetadata
} = require('./filament-profile');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidOutput } = require('./resource-errors');
const { cleanupManagedArtifacts } = require('../artifact-store');
const { wrapNativePlacementRejection } = require('./native-bounds');

async function resolveSliceOutputTargets(engine, originalName, technology, workspace) {
    const outputCandidate = await workspace.registerOutputCandidate(originalName, technology);
    const extension = technology === 'SLA' ? '.sl1' : '.gcode';
    let engineOutputDir = null;
    let slicerOutputPath;

    if (engine === 'orca') {
        engineOutputDir = await workspace.createUniquePath();
        workspace.assertContainedPath(engineOutputDir);
        await fs.mkdir(engineOutputDir, { mode: 0o700 });
        slicerOutputPath = workspace.assertContainedPath(path.join(engineOutputDir, `result${extension}`));
    } else {
        slicerOutputPath = await workspace.createUniquePath(extension);
    }

    return { outputCandidate, engineOutputDir, slicerOutputPath };
}

async function assertValidContainedArtifact(filePath, workspace, technology, policy = resolveResourcePolicy()) {
    const safePath = workspace.assertContainedPath(filePath);
    const stats = await fs.lstat(safePath);
    const expectedExtension = technology === 'SLA' ? '.sl1' : '.gcode';
    if (path.extname(safePath).toLowerCase() !== expectedExtension) {
        throw invalidOutput('Slicer output has an invalid extension.');
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > policy.MAX_OUTPUT_BYTES) {
        throw invalidOutput('Slicer did not produce a bounded regular output artifact.');
    }
    const realPath = await fs.realpath(safePath);
    if (workspace.assertContainedPath(realPath) !== safePath) {
        throw invalidOutput('Slicer output failed canonical containment validation.');
    }
    return safePath;
}

async function runSlicerAndParseStats(context) {
    const {
        engine, technology, layerHeight, infillPercentage, baseConfigFile,
        orcaMachineConfigFile, orcaFilamentConfigFile, material,
        slicerOutputPath, outputCandidate,
        engineOutputDir, processableFile, effectiveModelInfo, modelTransform,
        buildVolumeLimits, workspace
    } = context;
    const { signal } = context;
    throwIfAborted(signal);
    const engineVersion = getSlicerEngineVersion(engine);
    // Resolved before the runtime profile, because the Prusa profile needs the
    // density written into it: Orca is handed a filament profile directly,
    // Prusa has no per-material profile and would otherwise report no mass.
    const filamentProfileMetadata = engine === 'orca'
        ? readOrcaFilamentProfileMetadata(orcaFilamentConfigFile, material)
        : resolveMaterialFilamentMetadata(material);
    const runtimeConfigFile = await createRuntimeSlicerProfile(
        engine, baseConfigFile, technology, layerHeight, infillPercentage, workspace,
        { filamentDensityGcm3: filamentProfileMetadata?.densityGcm3 }
    );
    throwIfAborted(signal);
    const effectiveProfileSha256 = calculateEffectiveProfileSha256({
        engine,
        technology,
        material,
        runtimeConfigFile,
        orcaMachineConfigFile,
        orcaFilamentConfigFile
    });
    throwIfAborted(signal);
    logEngineProfileSelection(engine);
    const slicerArgs = buildSlicerCommandArgs(
        technology,
        runtimeConfigFile,
        slicerOutputPath,
        infillPercentage,
        engine,
        orcaMachineConfigFile,
        orcaFilamentConfigFile
    );
    let nativeResult;
    try {
        nativeResult = await runCommand(
            resolveSlicerExecutable(engine),
            [...slicerArgs, processableFile],
            { signal }
        );
    } catch (err) {
        throwIfAborted(signal);
        throw wrapNativePlacementRejection(err, { modelTransform, buildVolumeLimits });
    }
    throwIfAborted(signal);

    const generatedPath = engine === 'orca'
        ? await resolveSingleOutputFile(engineOutputDir, '.gcode', workspace)
        : slicerOutputPath;
    throwIfAborted(signal);
    let effectiveOutputPath;
    try {
        if (!generatedPath) {
            const error = new Error('Slicer did not produce an output artifact.');
            error.code = 'ENOENT';
            throw error;
        }
        effectiveOutputPath = await assertValidContainedArtifact(
            generatedPath,
            workspace,
            technology
        );
    } catch (artifactError) {
        if (artifactError?.code !== 'ENOENT') throw artifactError;
        const missingOutputError = new Error('Slicer did not produce an output artifact.', {
            cause: artifactError
        });
        missingOutputError.stdout = nativeResult?.stdout || '';
        missingOutputError.stderr = nativeResult?.stderr || '';
        const classified = wrapNativePlacementRejection(
            missingOutputError,
            { modelTransform, buildVolumeLimits }
        );
        if (classified !== missingOutputError) throw classified;
        // Preserve the engine's prior missing-artifact failure class when no
        // explicit native placement diagnostic is present.
        throw artifactError;
    }
    throwIfAborted(signal);
    const stats = await parseOutputDetailed(
        effectiveOutputPath,
        technology,
        layerHeight,
        effectiveModelInfo.height_mm,
        engine,
        {
            // Loud whenever we actually supplied the density. If the engine had
            // what it needed to report mass and still did not, that is a defect
            // and must not degrade quietly into manual pricing -- the same
            // discipline J1C applied to the G-code metrics parser.
            requireFilamentGrams: filamentProfileMetadata !== null
        }
    );
    throwIfAborted(signal);
    await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);
    throwIfAborted(signal);
    const cleanup = await cleanupManagedArtifacts();
    if (!cleanup.quotaSatisfied) {
        throw invalidOutput('Managed artifact retention quota could not be enforced safely.');
    }
    return { stats, effectiveProfileSha256, engineVersion, filamentProfileMetadata };
}

module.exports = {
    resolveSliceOutputTargets,
    assertValidContainedArtifact,
    runSlicerAndParseStats
};
