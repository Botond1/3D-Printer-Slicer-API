/**
 * Input conversion and orientation pipeline helpers.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { EXTENSIONS } = require('../../config/constants');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand } = require('./command');

/**
 * Convert supported non-STL inputs to STL for downstream slicing.
 * @param {string} processableFile Source file path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<string>} Final STL-compatible file path.
 */
async function convertInputToStl(processableFile, workspace) {
    const currentExt = path.extname(processableFile).toLowerCase();
    let finalStlPath = processableFile;

    if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
        console.log('[INFO] Converting Mesh to STL...');
        finalStlPath = resolveConvertedPath(processableFile, workspace);
        await runCommand(PYTHON_EXECUTABLE, ['mesh2stl.py', processableFile, finalStlPath]);
        if (!await isRegularNonSymlink(finalStlPath)) throw new Error('Converter did not produce a safe STL file.');
        return finalStlPath;
    }

    if (EXTENSIONS.cad.includes(currentExt)) {
        console.log('[INFO] Converting CAD to STL...');
        finalStlPath = resolveConvertedPath(processableFile, workspace);
        await runCommand(PYTHON_EXECUTABLE, ['cad2stl.py', processableFile, finalStlPath]);
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
async function tryOptimizeOrientation(processableFile, technology, workspace) {
    console.log(`[INFO] Optimizing orientation for ${technology}...`);
    const orientedStlPath = resolveOrientedPath(processableFile, workspace);

    try {
        await runCommand(PYTHON_EXECUTABLE, ['orient.py', processableFile, orientedStlPath, technology]);
        if (await isRegularNonSymlink(orientedStlPath)) {
            return orientedStlPath;
        }
    } catch (error_) {
        console.warn('[WARN] Orientation optimization failed; continuing with the contained source model.');
    }

    return processableFile;
}

module.exports = {
    convertInputToStl,
    tryOptimizeOrientation,
    resolveConvertedPath,
    resolveOrientedPath
};
