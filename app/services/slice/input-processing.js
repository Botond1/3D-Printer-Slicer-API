/**
 * Input conversion and orientation pipeline helpers.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { EXTENSIONS } = require('../../config/constants');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const {
    runCommand,
    throwIfAborted,
    isAbortError,
    PYTHON_HELPER_TIMEOUT_MS
} = require('./command');
const { resolvePythonHelper } = require('./helper-paths');
const { inspectThreeMfArchive } = require('./three-mf');
const { emitEvent } = require('../observability/events');
const {
    createOrientationState,
    identityRotationMatrix,
    parseOrientationMetadata
} = require('./orientation-contract');

const MAX_ORIENTATION_METADATA_BYTES = 4096;

/** Per-call budget for Python helpers; the runner clamps it to the native budget. */
const HELPER_COMMAND_OPTIONS = Object.freeze({ timeoutMs: PYTHON_HELPER_TIMEOUT_MS });

/**
 * Classify why the orientation helper could not produce a trusted result.
 * Only a bounded class is returned; messages, paths, and output are never
 * forwarded to telemetry.
 * @param {unknown} error Failure raised while running or reading the helper.
 * @returns {string} Bounded failure class.
 */
function classifyOrientationFailure(error) {
    if (error === null || error === undefined) return 'ORIENTATION_OUTPUT_MISSING';
    if (error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError') return 'ORIENTATION_HELPER_TIMEOUT';
    if (error?.code === 'NATIVE_OUTPUT_OVERFLOW') return 'ORIENTATION_HELPER_OUTPUT_OVERFLOW';
    if (error?.code === 'ENOENT') return 'ORIENTATION_OUTPUT_MISSING';
    if (error?.code === 'ORIENTATION_METADATA_INVALID' || /orientation metadata/i.test(String(error?.message || ''))) {
        return 'ORIENTATION_METADATA_INVALID';
    }
    return 'ORIENTATION_HELPER_FAILED';
}

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
            { signal, ...HELPER_COMMAND_OPTIONS }
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
            { signal, ...HELPER_COMMAND_OPTIONS }
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
 *
 * The fallback keeps the submitted geometry untouched and reports an honest
 * outcome (`preserved` for preserve mode, `fallback_unmodified` for auto).
 * Every fallback also emits one bounded `orientation.fallback` event carrying
 * only the failure class, never helper output or paths.
 * @param {string} processableFile STL input path.
 * @param {'FDM'|'SLA'} technology Active technology mode.
 * @param {'auto'|'preserve'} orientationMode Requested orientation policy.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @param {{emitEvent?: Function}} [dependencies] Injectable telemetry seam.
 * @returns {Promise<{processableFile: string, orientation: Readonly<Record<string, unknown>>}>} Oriented candidate and trusted metadata.
 */
async function tryOptimizeOrientation(processableFile, technology, orientationMode, workspace, signal, dependencies = {}) {
    throwIfAborted(signal);
    const orientedStlPath = resolveOrientedPath(processableFile, workspace);
    const metadataPath = resolveOrientationMetadataPath(orientedStlPath, workspace);
    const emit = dependencies.emitEvent || emitEvent;
    let failure = null;

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
            { signal, ...HELPER_COMMAND_OPTIONS }
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
        failure = error_;
    }

    const fallbackOutcome = orientationMode === 'preserve'
        ? 'preserved'
        : 'fallback_unmodified';
    try {
        emit('orientation.fallback', {
            audience: 'slice',
            outcome: fallbackOutcome,
            error_code: classifyOrientationFailure(failure),
            extra: { reason: orientationMode, technology }
        });
    } catch {
        // Telemetry can never alter the fallback contract.
    }
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
    classifyOrientationFailure,
    convertInputToStl,
    tryOptimizeOrientation,
    resolveConvertedPath,
    resolveOrientedPath,
    resolveOrientationMetadataPath,
    readOrientationMetadata
};
