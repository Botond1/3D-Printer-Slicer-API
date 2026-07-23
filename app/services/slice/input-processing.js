/**
 * Input conversion and orientation pipeline helpers.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { EXTENSIONS } = require('../../config/constants');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand, throwIfAborted, isAbortError } = require('./command');
const { resolvePythonHelper } = require('./helper-paths');
const { inspectThreeMfArchive } = require('./three-mf');

/**
 * Convert supported non-STL inputs to STL for downstream slicing.
 * @param {string} processableFile Source file path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<string>} Final STL-compatible file path.
 */
async function convertInputToStl(processableFile, workspace, signal) {
    throwIfAborted(signal);
    const currentExt = path.extname(processableFile).toLowerCase();
    let finalStlPath = processableFile;

    if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
        if (currentExt === '.3mf') {
            await inspectThreeMfArchive(workspace.assertContainedPath(processableFile));
            throwIfAborted(signal);
        }
        finalStlPath = resolveConvertedPath(processableFile, workspace);
        await runCommand(
            PYTHON_EXECUTABLE,
            [resolvePythonHelper('mesh2stl.py'), processableFile, finalStlPath],
            { signal }
        );
        throwIfAborted(signal);
        if (!await isRegularNonSymlink(finalStlPath)) throw new Error('Converter did not produce a safe STL file.');
        return finalStlPath;
    }

    if (EXTENSIONS.cad.includes(currentExt)) {
        finalStlPath = resolveConvertedPath(processableFile, workspace);
        await runCommand(
            PYTHON_EXECUTABLE,
            [resolvePythonHelper('cad2stl.py'), processableFile, finalStlPath],
            { signal }
        );
        throwIfAborted(signal);
        if (!await isRegularNonSymlink(finalStlPath)) throw new Error('Converter did not produce a safe STL file.');
        return finalStlPath;
    }

    return finalStlPath;
}

/**
 * Resolve the converter output beside a contained request-owned source.
 * @param {string} processableFile Source file path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {string} Contained STL output path.
 */
function resolveConvertedPath(processableFile, workspace) {
    workspace.assertContainedPath(processableFile);
    return workspace.assertContainedPath(`${processableFile}.stl`);
}

/**
 * Resolve the orientation output beside a contained STL source.
 * @param {string} processableFile Source STL path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {string} Contained orientation output path.
 */
function resolveOrientedPath(processableFile, workspace) {
    workspace.assertContainedPath(processableFile);
    return workspace.assertContainedPath(processableFile.replace(/\.stl$/i, '_oriented.stl'));
}

async function isRegularNonSymlink(filePath) {
    try {
        const stats = await fs.lstat(filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch (error_) {
        if (error_?.code === 'ENOENT') return false;
        throw error_;
    }
}

/**
 * Attempt orientation optimization and fall back to original file on failure.
 * @param {string} processableFile STL input path.
 * @param {'FDM'|'SLA'} technology Active technology mode.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<string>} Optimized or original STL path.
 */
async function tryOptimizeOrientation(processableFile, technology, workspace, signal) {
    throwIfAborted(signal);
    const orientedStlPath = resolveOrientedPath(processableFile, workspace);

    try {
        await runCommand(
            PYTHON_EXECUTABLE,
            [resolvePythonHelper('orient.py'), processableFile, orientedStlPath, technology],
            { signal }
        );
        throwIfAborted(signal);
        if (await isRegularNonSymlink(orientedStlPath)) {
            return orientedStlPath;
        }
    } catch (error_) {
        if (isAbortError(error_, signal)) {
            throwIfAborted(signal);
            throw error_;
        }
    }

    return processableFile;
}

module.exports = {
    convertInputToStl,
    tryOptimizeOrientation,
    resolveConvertedPath,
    resolveOrientedPath
};
