/** Contained request preprocessing and slicing pipeline orchestration. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { extractFirstSupportedFromZip } = require('./zip');
const { parseSliceOptions } = require('./options');
const { convertInputToStl, tryOptimizeOrientation } = require('./input-processing');
const {
    MODEL_INFO_MEASUREMENT_STATUSES,
    getModelInfo
} = require('./model-stats');
const { applyTransformAndValidateModel } = require('./transform');
const { handleProcessingError } = require('./errors');
const { buildSliceSuccessResponse } = require('./response');
const { getRequestWorkspace } = require('./workspace');
const { isSupportedInputExtension, getSupportedInputExtensionsText } = require('./common');
const {
    resolveBuildVolumeLimits,
    resolveProfileSelection
} = require('./profiles');
const { snapshotProfileSelection } = require('./profile-snapshot');
const { resolveSliceOutputTargets, runSlicerAndParseStats } = require('./output-lifecycle');
const { writeJsonAndWaitForFinish, setResponseSettlement } = require('./response-lifecycle');
const { throwIfAborted, isAbortError } = require('./command');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { resourceLimit } = require('./resource-errors');

function findUploadedModelFile(req) {
    return req.file?.fieldname === 'choosenFile' ? req.file : null;
}

function createUnsupportedFormatResponse(res) {
    return res.status(400).json({
        success: false,
        error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
        errorCode: 'UNSUPPORTED_FILE_FORMAT'
    });
}

async function appendOriginalExtensionToUpload(inputFile, originalExt, workspace) {
    const source = workspace.assertContainedPath(inputFile);
    if (!/^\.[a-z0-9]+$/i.test(originalExt)) throw new Error('Invalid upload extension.');
    const destination = workspace.assertContainedPath(`${source}${originalExt}`);
    await fs.rename(source, destination);
    return destination;
}

async function prepareProcessableModel(inputFile, technology, orientationMode, workspace, signal) {
    throwIfAborted(signal);
    let processableFile = workspace.assertContainedPath(inputFile);
    if (path.extname(processableFile).toLowerCase() === '.zip') {
        processableFile = await extractFirstSupportedFromZip(processableFile, workspace);
        throwIfAborted(signal);
    }
    processableFile = await convertInputToStl(processableFile, workspace, signal);
    await assertBoundedModelFile(processableFile, workspace);
    throwIfAborted(signal);
    const originalModelMeasurement = await getModelInfo(processableFile, signal);
    throwIfAborted(signal);
    const preOrientationFile = processableFile;
    const orientationResult = await tryOptimizeOrientation(
        processableFile,
        technology,
        orientationMode,
        workspace,
        signal
    );
    processableFile = orientationResult.processableFile;
    await assertBoundedModelFile(processableFile, workspace);
    throwIfAborted(signal);
    workspace.assertContainedPath(processableFile);
    const canReuseOriginalMeasurement = (
        processableFile === preOrientationFile
        && originalModelMeasurement.status === MODEL_INFO_MEASUREMENT_STATUSES.MEASURED
    );
    const orientedModelMeasurement = canReuseOriginalMeasurement
        ? originalModelMeasurement
        : await getModelInfo(processableFile, signal);
    throwIfAborted(signal);
    return {
        processableFile,
        originalModelMeasurement,
        orientedModelMeasurement,
        orientation: orientationResult.orientation
    };
}

async function assertBoundedModelFile(filePath, workspace, policy = resolveResourcePolicy()) {
    const safePath = workspace.assertContainedPath(filePath);
    const stat = await fs.lstat(safePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > policy.MAX_MODEL_FILE_BYTES) {
        throw resourceLimit('Model or intermediate file exceeds the configured byte limit.');
    }
    if (workspace.assertContainedPath(await fs.realpath(safePath)) !== safePath) {
        throw resourceLimit('Model or intermediate file failed canonical containment.');
    }
    return safePath;
}

function resolveProfilesOrResponse(res, engine, technology, layerHeight, profileOverrides, material) {
    const selection = resolveProfileSelection(engine, technology, layerHeight, profileOverrides, material);
    if (!selection.isValid) {
        return { response: res.status(selection.status).json(selection.response) };
    }
    return {
        response: null,
        baseConfigFile: selection.baseConfigFile,
        orcaMachineConfigFile: selection.orcaMachineConfigFile,
        orcaFilamentConfigFile: selection.orcaFilamentConfigFile
    };
}

async function prepareModelOrResponse(
    res,
    request,
    processableFile,
    originalModelMeasurement,
    orientedModelMeasurement,
    orientation,
    profileSnapshots,
    selectedProfiles,
    workspace,
    signal
) {
    throwIfAborted(signal);
    const buildVolumeLimits = resolveBuildVolumeLimits(
        request.engine,
        request.technology,
        profileSnapshots.baseConfigFile,
        profileSnapshots.orcaMachineConfigFile,
        request.engine === 'orca'
            ? selectedProfiles.orcaMachineConfigFile
            : selectedProfiles.baseConfigFile
    );
    const model = await applyTransformAndValidateModel(
        processableFile,
        orientedModelMeasurement,
        request.transformOptions,
        buildVolumeLimits,
        workspace,
        signal,
        {
            orientation,
            originalModelMeasurement
        }
    );
    throwIfAborted(signal);
    if (!model.isValid) return { response: res.status(model.status).json(model.response) };
    await assertBoundedModelFile(model.processableFile, workspace);
    throwIfAborted(signal);
    return { response: null, buildVolumeLimits, model };
}

function resolveRequestOrResponse(req, res, options, workspace) {
    const file = findUploadedModelFile(req);
    if (!file) {
        return { response: res.status(400).json({
            success: false,
            error: 'No file uploaded (use key "choosenFile")',
            errorCode: 'NO_FILE_UPLOADED'
        }) };
    }
    const originalName = file.originalname;
    const originalExt = path.extname(originalName).toLowerCase();
    if (!isSupportedInputExtension(originalExt)) {
        return { response: createUnsupportedFormatResponse(res) };
    }
    const engine = options.engine || 'prusa';
    const parsed = parseSliceOptions(req.body, options.forcedTechnology || null, engine);
    if (!parsed.isValid) return { response: res.status(400).json(parsed.response) };
    return {
        response: null,
        request: {
            ...parsed.options,
            engine,
            originalName,
            originalExt,
            inputFile: workspace.assertContainedPath(file.path)
        }
    };
}

async function prepareSliceJob(res, request, workspace, signal) {
    throwIfAborted(signal);
    const inputFile = await appendOriginalExtensionToUpload(request.inputFile, request.originalExt, workspace);
    throwIfAborted(signal);
    const source = await prepareProcessableModel(
        inputFile,
        request.technology,
        request.orientationMode,
        workspace,
        signal
    );
    throwIfAborted(signal);
    const profiles = resolveProfilesOrResponse(
        res,
        request.engine,
        request.technology,
        request.layerHeight,
        request.profileOverrides,
        request.material
    );
    if (profiles.response) return profiles;
    const profileSnapshots = await snapshotProfileSelection(request.engine, profiles, workspace);
    throwIfAborted(signal);
    const preparedModel = await prepareModelOrResponse(
        res,
        request,
        source.processableFile,
        source.originalModelMeasurement,
        source.orientedModelMeasurement,
        source.orientation,
        profileSnapshots,
        profiles,
        workspace,
        signal
    );
    if (preparedModel.response) return preparedModel;
    throwIfAborted(signal);
    const targets = await resolveSliceOutputTargets(
        request.engine,
        request.originalName,
        request.technology,
        workspace
    );
    throwIfAborted(signal);
    return { response: null, request, source, profiles, profileSnapshots, preparedModel, targets };
}

async function executePreparedSlice(req, res, job, workspace, signal) {
    throwIfAborted(signal);
    const { request, source, profiles, profileSnapshots, preparedModel, targets } = job;
    const { model, buildVolumeLimits } = preparedModel;
    const { stats, effectiveProfileSha256, engineVersion, filamentProfileMetadata } = await runSlicerAndParseStats({
        ...request,
        ...profileSnapshots,
        ...targets,
        processableFile: model.processableFile,
        effectiveModelInfo: model.effectiveModelInfo,
        modelTransform: model.modelTransform,
        buildVolumeLimits,
        workspace,
        signal
    });
    throwIfAborted(signal);
    const responsePayload = buildSliceSuccessResponse({
        ...request,
        ...profiles,
        modelTransform: model.modelTransform,
        buildVolumeLimits,
        stats,
        engineVersion,
        effectiveProfileSha256,
        filamentProfileMetadata,
        ...workspace.getOutputCandidateInfo(targets.outputCandidate)
    });
    throwIfAborted(signal);
    setResponseSettlement(
        req,
        writeJsonAndWaitForFinish(res, responsePayload)
            .then(() => workspace.releaseOutputCandidate(targets.outputCandidate))
    );
    return res;
}

async function processSlice(req, res, options = {}) {
    const workspace = getRequestWorkspace(req);
    if (!workspace) throw new Error('Slice workspace is unavailable.');
    try {
        throwIfAborted(options.signal);
        const resolved = resolveRequestOrResponse(req, res, options, workspace);
        if (resolved.response) return resolved.response;
        throwIfAborted(options.signal);
        const job = await prepareSliceJob(res, resolved.request, workspace, options.signal);
        if (job.response) return job.response;
        throwIfAborted(options.signal);
        return await executePreparedSlice(req, res, job, workspace, options.signal);
    } catch (err) {
        if (isAbortError(err, options.signal)) {
            throwIfAborted(options.signal);
            throw err;
        }
        if (res.headersSent || res.destroyed) throw err;
        return handleProcessingError(err, res, null, null, getSupportedInputExtensionsText);
    }
}

module.exports = {
    processSlice,
    appendOriginalExtensionToUpload,
    prepareProcessableModel,
    resolveRequestOrResponse,
    prepareSliceJob,
    executePreparedSlice
    ,
    assertBoundedModelFile
};
