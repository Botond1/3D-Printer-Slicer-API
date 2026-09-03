/** Contained slicer output staging, validation, parsing, and exclusive promotion. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { runCommand, throwIfAborted } = require('./command');
const { resolveSingleOutputFile, resolveOutputArtifactExtension } = require('./common');
const { parseOutputDetailed } = require('./model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./engine');
const { getSlicerEngineVersion } = require('./engine-version');
const { createRuntimeSlicerProfile, logEngineProfileSelection } = require('./profiles');
const { calculateEffectiveProfileSha256 } = require('./profile-digest');
const {
    readBambuFilamentProfileMetadata,
    readOrcaFilamentProfileMetadata,
    resolveMaterialFilamentMetadata
} = require('./filament-profile');
const { getBambuPrinter } = require('./bambu-printer-registry');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidOutput } = require('./resource-errors');
const { cleanupManagedArtifacts: sweepManagedArtifacts } = require('../artifact-store');
const { wrapNativePlacementRejection } = require('./native-bounds');
const { emitEvent } = require('../observability/events');
const { recordArtifactCleanup } = require('../observability/metrics');

/** Bambu Studio writes the sliced plate beside the exported project. */
const BAMBU_PLATE_GCODE_NAME = 'plate_1.gcode';
const RETENTION_MISS_ERROR_CODE = 'ARTIFACT_RETENTION_QUOTA_UNSATISFIED';

let retentionObserver = null;

/**
 * Register the readiness observer that learns about a post-slice retention miss.
 * The sweep result is informational for the request that triggered it; only
 * readiness changes, so a missed quota is visible on `/ready` instead of
 * failing an already successful slice.
 * @param {{recordRetentionResult(summary: unknown): void}|null} observer Readiness service or null to detach.
 * @returns {void}
 */
function configureRetentionObserver(observer) {
    retentionObserver = observer && typeof observer.recordRetentionResult === 'function'
        ? observer
        : null;
}

async function resolveSliceOutputTargets(engine, originalName, technology, workspace) {
    const outputCandidate = await workspace.registerOutputCandidate(originalName, technology, engine);
    const extension = resolveOutputArtifactExtension(technology, engine);
    let engineOutputDir = null;
    let slicerOutputPath;

    if (engine === 'orca' || engine === 'bambu') {
        engineOutputDir = await workspace.createUniquePath();
        workspace.assertContainedPath(engineOutputDir);
        await fs.mkdir(engineOutputDir, { mode: 0o700 });
        slicerOutputPath = workspace.assertContainedPath(path.join(engineOutputDir, `result${extension}`));
    } else {
        slicerOutputPath = await workspace.createUniquePath(extension);
    }

    return { outputCandidate, engineOutputDir, slicerOutputPath };
}

async function assertValidContainedArtifact(filePath, workspace, technology, policy = resolveResourcePolicy(), engine = 'prusa') {
    const safePath = workspace.assertContainedPath(filePath);
    const stats = await fs.lstat(safePath);
    const expectedExtension = resolveOutputArtifactExtension(technology, engine);
    if (!safePath.toLowerCase().endsWith(expectedExtension)) {
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

function resolveFilamentProfileMetadata(engine, orcaFilamentConfigFile, material) {
    if (engine === 'bambu') return readBambuFilamentProfileMetadata(orcaFilamentConfigFile, material);
    if (engine === 'orca') return readOrcaFilamentProfileMetadata(orcaFilamentConfigFile, material);
    // Resolved before the runtime profile, because the Prusa profile needs the
    // density written into it: Orca is handed a filament profile directly,
    // Prusa has no per-material profile and would otherwise report no mass.
    return resolveMaterialFilamentMetadata(material);
}

function resolveBambuContext(engine, profileOverrides) {
    if (engine !== 'bambu') return { printerId: null, bedType: null };
    const printer = getBambuPrinter(profileOverrides?.bambuPrinter);
    return { printerId: printer.id, bedType: printer.bedType };
}

/**
 * Locate the generated artifact(s) for an engine after a native run.
 * Prusa writes exactly the requested path. Orca writes one `.gcode` into its
 * isolated directory. Bambu writes `plate_1.gcode` (parsed for statistics) and
 * the exported `.gcode.3mf` project (retained as the printer-ready artifact).
 */
async function resolveGeneratedOutputs(engine, engineOutputDir, slicerOutputPath, workspace) {
    if (engine === 'orca') {
        const generated = await resolveSingleOutputFile(engineOutputDir, '.gcode', workspace);
        return { artifactPath: generated, statsPath: generated };
    }
    if (engine === 'bambu') {
        const artifactPath = await resolveSingleOutputFile(engineOutputDir, '.gcode.3mf', workspace);
        const plateCandidate = workspace.assertContainedPath(path.join(engineOutputDir, BAMBU_PLATE_GCODE_NAME));
        let plateStats = null;
        try {
            plateStats = await fs.lstat(plateCandidate);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        const statsPath = plateStats && plateStats.isFile() && !plateStats.isSymbolicLink()
            ? plateCandidate
            : null;
        return { artifactPath, statsPath };
    }
    return { artifactPath: slicerOutputPath, statsPath: slicerOutputPath };
}

/**
 * Run the serialized managed-artifact sweep after promotion. A throwing sweep
 * is reported as an unsatisfied quota rather than propagated: the slice has
 * already succeeded and its artifact is promoted.
 * @returns {Promise<{quotaSatisfied: boolean, removedArtifacts?: number, removedBytes?: number}>} Sweep summary.
 */
async function cleanupManagedArtifacts() {
    try {
        const summary = await sweepManagedArtifacts();
        return summary && typeof summary === 'object' ? summary : { quotaSatisfied: false };
    } catch {
        return { quotaSatisfied: false, removedArtifacts: 0, removedBytes: 0 };
    }
}

/**
 * Surface a post-slice retention miss as an operational signal: a structured
 * event, the cleanup metric, and the readiness observer. The request that
 * triggered the sweep is never failed for it.
 * @param {string|undefined} jobId Owning job id.
 * @param {{removedArtifacts?: number, removedBytes?: number}} cleanup Sweep summary.
 * @returns {void}
 */
function recordRetentionMiss(jobId, cleanup) {
    emitEvent('artifact.cleanup', {
        job_id: jobId,
        audience: 'artifact',
        outcome: 'failure',
        error_code: RETENTION_MISS_ERROR_CODE
    });
    recordArtifactCleanup('failure', cleanup?.removedArtifacts || 0, cleanup?.removedBytes || 0);
    if (retentionObserver) {
        try {
            retentionObserver.recordRetentionResult(false);
        } catch {
            // Readiness reporting cannot alter the already successful slice.
        }
    }
}

const BAMBU_RESULT_FILE_NAME = 'result.json';
const MAX_BAMBU_RESULT_BYTES = 65_536;
const MAX_BAMBU_RESULT_MESSAGE_CHARS = 512;

/**
 * Surface Bambu Studio's structured failure summary alongside the native
 * streams. The CLI writes `<outputdir>/result.json` with `return_code` and
 * `error_string` even when it prints nothing useful on stderr, so the existing
 * text classifiers (placement rejection, unsliceable geometry) can see it.
 * Never throws: a missing or malformed file leaves the error untouched.
 * @param {Error & {stderr?: string}} err Native command error.
 * @param {string|null} engineOutputDir Isolated engine output directory.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<void>} Resolves after the diagnostic is attached or skipped.
 */
async function attachBambuResultDiagnostics(err, engineOutputDir, workspace) {
    try {
        if (!err || typeof engineOutputDir !== 'string' || !engineOutputDir) return;
        const resultPath = workspace.assertContainedPath(path.join(engineOutputDir, BAMBU_RESULT_FILE_NAME));
        const stats = await fs.lstat(resultPath);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_BAMBU_RESULT_BYTES) return;
        const parsed = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        const returnCode = Number.isInteger(parsed.return_code) ? parsed.return_code : null;
        const message = typeof parsed.error_string === 'string'
            ? parsed.error_string.replaceAll(/[^ -~]/g, ' ').slice(0, MAX_BAMBU_RESULT_MESSAGE_CHARS)
            : '';
        if (returnCode === null && !message) return;
        err.bambuResult = Object.freeze({ returnCode, errorString: message });
        err.stderr = `${err.stderr || ''}
[bambu result.json] return_code=${returnCode} error_string=${message}`;
    } catch {
        // Diagnostics are best effort; the original native failure stands.
    }
}

async function runSlicerAndParseStats(context) {
    const {
        engine, technology, layerHeight, infillPercentage, baseConfigFile,
        orcaMachineConfigFile, orcaFilamentConfigFile, material, supports,
        slicerOutputPath, outputCandidate,
        engineOutputDir, processableFile, effectiveModelInfo, modelTransform,
        buildVolumeLimits, workspace
    } = context;
    const { signal } = context;
    throwIfAborted(signal);
    const engineVersion = getSlicerEngineVersion(engine);
    const bambu = resolveBambuContext(engine, context.profileOverrides);
    const filamentProfileMetadata = resolveFilamentProfileMetadata(engine, orcaFilamentConfigFile, material);
    const runtimeConfigFile = await createRuntimeSlicerProfile(
        engine, baseConfigFile, technology, layerHeight, infillPercentage, workspace,
        { filamentDensityGcm3: filamentProfileMetadata?.densityGcm3, supports }
    );
    throwIfAborted(signal);
    const effectiveProfileSha256 = calculateEffectiveProfileSha256({
        engine,
        technology,
        material,
        runtimeConfigFile,
        orcaMachineConfigFile,
        orcaFilamentConfigFile,
        bambuPrinterId: bambu.printerId,
        bambuBedType: bambu.bedType
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
        orcaFilamentConfigFile,
        { supports, bedType: bambu.bedType }
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
        if (engine === 'bambu') await attachBambuResultDiagnostics(err, engineOutputDir, workspace);
        throw wrapNativePlacementRejection(err, { modelTransform, buildVolumeLimits });
    }
    throwIfAborted(signal);

    const generated = await resolveGeneratedOutputs(engine, engineOutputDir, slicerOutputPath, workspace);
    throwIfAborted(signal);
    let effectiveOutputPath;
    try {
        if (!generated.artifactPath || !generated.statsPath) {
            const error = new Error('Slicer did not produce an output artifact.');
            error.code = 'ENOENT';
            throw error;
        }
        effectiveOutputPath = await assertValidContainedArtifact(
            generated.artifactPath,
            workspace,
            technology,
            resolveResourcePolicy(),
            engine
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
    const statsPath = generated.statsPath === generated.artifactPath
        ? effectiveOutputPath
        : workspace.assertContainedPath(generated.statsPath);
    const stats = await parseOutputDetailed(
        statsPath,
        technology,
        layerHeight,
        effectiveModelInfo.height_mm,
        engine,
        {
            // Loud whenever we actually supplied the density. If the engine had
            // what it needed to report mass and still did not, that is a defect
            // and must not degrade quietly into manual pricing -- the same
            // discipline J1C applied to the G-code metrics parser. Bambu always
            // slices with a vendor filament profile, so grams are always required.
            requireFilamentGrams: engine === 'bambu' || filamentProfileMetadata !== null,
            // SLA-only: resin density comes from the material, and model volume
            // (when the transform pipeline measured it) drives support_volume_ml.
            material,
            modelVolumeMm3: Number.isFinite(effectiveModelInfo.volume_mm3) ? effectiveModelInfo.volume_mm3 : null
        }
    );
    throwIfAborted(signal);
    await workspace.promoteOutputCandidate(outputCandidate, effectiveOutputPath);
    throwIfAborted(signal);
    const cleanup = await cleanupManagedArtifacts();
    if (!cleanup.quotaSatisfied) {
        // Non-fatal by design: the slice succeeded and the artifact is
        // promoted, so a retention miss changes readiness, not this response.
        recordRetentionMiss(workspace.id, cleanup);
    }
    return { stats, effectiveProfileSha256, engineVersion, filamentProfileMetadata };
}

module.exports = {
    BAMBU_PLATE_GCODE_NAME,
    RETENTION_MISS_ERROR_CODE,
    configureRetentionObserver,
    resolveGeneratedOutputs,
    resolveSliceOutputTargets,
    assertValidContainedArtifact,
    runSlicerAndParseStats
};
