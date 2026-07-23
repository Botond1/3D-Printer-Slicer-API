/** Contained slicer output staging, validation, parsing, and exclusive promotion. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { runCommand, throwIfAborted } = require('./command');
const { resolveSingleOutputFile } = require('./common');
const { parseOutputDetailed } = require('./model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./engine');
const { createRuntimeSlicerProfile, logEngineProfileSelection } = require('./profiles');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidOutput } = require('./resource-errors');
const { cleanupManagedArtifacts } = require('../artifact-store');

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
        orcaMachineConfigFile, slicerOutputPath, outputCandidate,
        engineOutputDir, processableFile, effectiveModelInfo, workspace
    } = context;
    const { signal } = context;
    throwIfAborted(signal);
    const runtimeConfigFile = await createRuntimeSlicerProfile(
        engine, baseConfigFile, technology, layerHeight, infillPercentage, workspace
    );
    throwIfAborted(signal);
    logEngineProfileSelection(engine);
    const slicerArgs = buildSlicerCommandArgs(
        technology,
        runtimeConfigFile,
        slicerOutputPath,
        infillPercentage,
        engine,
        orcaMachineConfigFile
    );
    await runCommand(resolveSlicerExecutable(engine), [...slicerArgs, processableFile], { signal });
    throwIfAborted(signal);

    const generatedPath = engine === 'orca'
        ? await resolveSingleOutputFile(engineOutputDir, '.gcode', workspace)
        : slicerOutputPath;
    throwIfAborted(signal);
    if (!generatedPath) throw new Error('Slicer did not produce an output artifact.');
    const effectiveOutputPath = await assertValidContainedArtifact(generatedPath, workspace, technology);
    throwIfAborted(signal);
    const stats = await parseOutputDetailed(
        effectiveOutputPath,
        technology,
        layerHeight,
        effectiveModelInfo.height_mm,
        engine
    );
    throwIfAborted(signal);
    await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);
    throwIfAborted(signal);
    const cleanup = await cleanupManagedArtifacts();
    if (!cleanup.quotaSatisfied) {
        throw invalidOutput('Managed artifact retention quota could not be enforced safely.');
    }
    return { stats };
}

module.exports = {
    resolveSliceOutputTargets,
    assertValidContainedArtifact,
    runSlicerAndParseStats
};
