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
const {
    createOrientationState,
    identityRotationMatrix,
    parseOrientationMetadata
} = require('./orientation-contract');

const MAX_ORIENTATION_METADATA_BYTES = 4096;

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

function resolveOrientationMetadataPath(orientedStlPath, workspace) {
    workspace.assertContainedPath(orientedStlPath);
    return workspace.assertContainedPath(`${orientedStlPath}.orientation.json`);
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

async function readOrientationMetadata(metadataPath, expectedMode, workspace) {
    const safePath = workspace.assertContainedPath(metadataPath);
    const pathStat = await fs.lstat(safePath);
    if (
        !pathStat.isFile()
        || pathStat.isSymbolicLink()
        || pathStat.size <= 0
        || pathStat.size > MAX_ORIENTATION_METADATA_BYTES
    ) throw new Error('Orientation metadata file is unsafe or oversized.');
    if (workspace.assertContainedPath(await fs.realpath(safePath)) !== safePath) {
        throw new Error('Orientation metadata failed canonical containment.');
    }

    const handle = await fs.open(safePath, 'r');
    try {
        const openedStat = await handle.stat();
        if (
            !openedStat.isFile()
            || openedStat.dev !== pathStat.dev
            || openedStat.ino !== pathStat.ino
            || openedStat.size !== pathStat.size
        ) {
            throw new Error('Orientation metadata changed before reading.');
        }
        const content = await handle.readFile({ encoding: 'utf8' });
        if (Buffer.byteLength(content, 'utf8') > MAX_ORIENTATION_METADATA_BYTES) {
            throw new Error('Orientation metadata exceeds the allowed size.');
        }
        const finalStat = await handle.stat();
        if (
            finalStat.dev !== openedStat.dev
            || finalStat.ino !== openedStat.ino
            || finalStat.size !== openedStat.size
        ) throw new Error('Orientation metadata changed while reading.');
        return parseOrientationMetadata(JSON.parse(content), expectedMode);
    } finally {
        await handle.close();
    }
}

/**
 * Attempt orientation optimization and fall back to original file on failure.
 * @param {string} processableFile STL input path.
 * @param {'FDM'|'SLA'} technology Active technology mode.
 * @param {'auto'|'preserve'} orientationMode Requested orientation policy.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @returns {Promise<{processableFile: string, orientation: Readonly<Record<string, unknown>>}>} Oriented candidate and trusted metadata.
 */
async function tryOptimizeOrientation(processableFile, technology, orientationMode, workspace, signal) {
    throwIfAborted(signal);
    const orientedStlPath = resolveOrientedPath(processableFile, workspace);
    const metadataPath = resolveOrientationMetadataPath(orientedStlPath, workspace);

    try {
        await runCommand(
            PYTHON_EXECUTABLE,
            [
                resolvePythonHelper('orient.py'),
                processableFile,
                orientedStlPath,
                technology,
                orientationMode,
                metadataPath
            ],
            { signal }
        );
        throwIfAborted(signal);
        if (await isRegularNonSymlink(orientedStlPath)) {
            const orientation = await readOrientationMetadata(metadataPath, orientationMode, workspace);
            return {
                processableFile: orientation.outcome === 'fallback_unmodified'
                    ? processableFile
                    : orientedStlPath,
                orientation
            };
        }
    } catch (error_) {
        if (isAbortError(error_, signal)) {
            throwIfAborted(signal);
            throw error_;
        }
    }

    const fallbackOutcome = orientationMode === 'preserve'
        ? 'preserved'
        : 'fallback_unmodified';
    return {
        processableFile,
        orientation: createOrientationState(
            orientationMode,
            fallbackOutcome,
            identityRotationMatrix()
        )
    };
}

module.exports = {
    convertInputToStl,
    tryOptimizeOrientation,
    resolveConvertedPath,
    resolveOrientedPath,
    resolveOrientationMetadataPath,
    readOrientationMetadata
};
