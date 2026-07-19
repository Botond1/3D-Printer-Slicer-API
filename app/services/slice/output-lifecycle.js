/** Contained slicer output staging, validation, parsing, and exclusive promotion. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { runCommand } = require('./command');
const { resolveSingleOutputFile } = require('./common');
const { parseOutputDetailed } = require('./model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./engine');
const { createRuntimeSlicerProfile, logEngineProfileSelection } = require('./profiles');

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

async function assertValidContainedArtifact(filePath, workspace) {
    const safePath = workspace.assertContainedPath(filePath);
    const stats = await fs.lstat(safePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0) {
        throw new Error('Slicer did not produce a valid output artifact.');
    }
    return safePath;
}

async function runSlicerAndParseStats(context) {
    const {
        engine, technology, layerHeight, infillPercentage, baseConfigFile,
        orcaMachineConfigFile, slicerOutputPath, outputCandidate,
        engineOutputDir, processableFile, effectiveModelInfo, workspace
    } = context;
    const runtimeConfigFile = await createRuntimeSlicerProfile(
        engine, baseConfigFile, technology, layerHeight, infillPercentage, workspace
    );
    logEngineProfileSelection(engine);
    const slicerArgs = buildSlicerCommandArgs(
        technology,
        runtimeConfigFile,
        slicerOutputPath,
        infillPercentage,
        engine,
        orcaMachineConfigFile
    );
    await runCommand(resolveSlicerExecutable(engine), [...slicerArgs, processableFile]);

    const generatedPath = engine === 'orca'
        ? await resolveSingleOutputFile(engineOutputDir, '.gcode', workspace)
        : slicerOutputPath;
    if (!generatedPath) throw new Error('Slicer did not produce an output artifact.');
    const effectiveOutputPath = await assertValidContainedArtifact(generatedPath, workspace);
    const stats = await parseOutputDetailed(
        effectiveOutputPath,
        technology,
        layerHeight,
        effectiveModelInfo.height_mm,
        engine
    );
    await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);
    return { stats };
}

module.exports = {
    resolveSliceOutputTargets,
    assertValidContainedArtifact,
    runSlicerAndParseStats
};
