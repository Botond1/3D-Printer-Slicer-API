/**
 * Queue-aware preview rendering for `POST /render`.
 *
 * The preview reuses the slice preprocessing chain (extension restore, ZIP/
 * CAD/mesh conversion, orientation, sizing/rotation transform, bounds
 * validation) so the rendered pose is exactly the STL the slice pipeline would
 * hand to the native slicer. Only the last step differs: instead of slicing,
 * the transformed STL is rendered by `app/render_preview.py` into one PNG.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { MAX_BUILD_VOLUMES, MIN_BUILD_VOLUMES } = require('../config/constants');
const { PYTHON_EXECUTABLE } = require('../config/python');
const { createSliceHandlers } = require('./slice.service');
const {
    resolveRequestOrResponse,
    appendOriginalExtensionToUpload,
    prepareProcessableModel,
    assertBoundedModelFile
} = require('./slice/pipeline');
const { applyTransformAndValidateModel } = require('./slice/transform');
const { createCommandRunner, throwIfAborted, isAbortError } = require('./slice/command');
const { resolvePythonHelper } = require('./slice/helper-paths');
const { handleProcessingError } = require('./slice/errors');
const { getSupportedInputExtensionsText } = require('./slice/common');
const { getRequestWorkspace } = require('./slice/workspace');
const { setResponseSettlement } = require('./slice/response-lifecycle');

const RENDER_HELPER_NAME = 'render_preview.py';
const RENDER_COMMAND_TIMEOUT_MS = 60_000;
const PREVIEW_WIDTH = 1024;
const PREVIEW_HEIGHT = 768;
const PREVIEW_CONTENT_TYPE = 'image/png';
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PREVIEW_ENVELOPE_SOURCE = 'preview-envelope';

/**
 * Resolve the module-anchored absolute renderer helper path through the
 * shared allowlisted helper resolver.
 * @returns {string} Absolute path of `app/render_preview.py`.
 */
function resolveRenderHelperPath() {
    return resolvePythonHelper(RENDER_HELPER_NAME);
}

/**
 * Format final dimensions as the caption drawn on the preview, one decimal each.
 * @param {{x: number, y: number, z: number}} dimensions Final model dimensions in mm.
 * @returns {string} Caption such as `40.0 x 60.0 x 25.0 mm`.
 */
function formatDimensionCaption(dimensions) {
    const format = (axis) => {
        const value = Number(dimensions?.[axis]);
        if (!Number.isFinite(value) || value < 0) throw new Error('Preview dimensions are invalid.');
        return (Math.round(value * 10) / 10).toFixed(1);
    };
    return `${format('x')} x ${format('y')} x ${format('z')} mm`;
}

/**
 * Build the permissive preview envelope: the largest supported FDM volume.
 * A preview never selects a printer profile, so the tightest per-profile
 * admission ceilings do not apply; only models no machine could ever accept
 * are rejected, with the same `MODEL_OUT_OF_PRINTER_BOUNDS` contract.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} Envelope.
 */
function createPreviewBuildVolumeLimits() {
    return {
        min: { ...MIN_BUILD_VOLUMES.FDM },
        max: { ...MAX_BUILD_VOLUMES.FDM },
        sourceProfile: PREVIEW_ENVELOPE_SOURCE
    };
}

/**
 * Build the renderer argv. Every element is a fixed token or a server-derived value.
 * @param {string} helperPath Absolute renderer path.
 * @param {string} stlPath Contained transformed STL path.
 * @param {string} pngPath Contained PNG output path.
 * @param {string} caption Dimension caption.
 * @returns {string[]} Argument vector for `execFile`.
 */
function buildRenderArguments(helperPath, stlPath, pngPath, caption) {
    return [
        helperPath,
        stlPath,
        pngPath,
        '--width', String(PREVIEW_WIDTH),
        '--height', String(PREVIEW_HEIGHT),
        '--caption', caption
    ];
}

function renderTimeoutResponse(res) {
    return res.status(422).json({
        success: false,
        error: `Preview rendering exceeded ${Math.round(RENDER_COMMAND_TIMEOUT_MS / 1000)} seconds. The uploaded model may be too complex for a preview. Please simplify the model and try again.`,
        errorCode: 'FILE_PROCESSING_TIMEOUT'
    });
}

/**
 * Read the rendered PNG with lstat/realpath containment, size bound, and signature check.
 * @param {string} previewPath Contained PNG path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<Buffer>} PNG bytes.
 */
async function readPreviewImage(previewPath, workspace) {
    const safePath = workspace.assertContainedPath(previewPath);
    const stat = await fs.lstat(safePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_PREVIEW_BYTES) {
        throw new Error('Preview renderer did not produce a safe image file.');
    }
    if (workspace.assertContainedPath(await fs.realpath(safePath)) !== safePath) {
        throw new Error('Preview image failed canonical containment.');
    }
    const handle = await fs.open(safePath, 'r');
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size !== stat.size) {
            throw new Error('Preview image changed before reading.');
        }
        const content = Buffer.alloc(opened.size);
        let offset = 0;
        while (offset < content.length) {
            const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
            if (bytesRead <= 0) throw new Error('Preview image could not be read completely.');
            offset += bytesRead;
        }
        if (content.length < PNG_SIGNATURE.length || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
            throw new Error('Preview renderer output is not a PNG image.');
        }
        return content;
    } finally {
        await handle.close();
    }
}

/**
 * Write a binary body and resolve only after the response has fully flushed.
 * @param {object} res Express response.
 * @param {Buffer} body Response bytes.
 * @param {{contentType: string, signal?: AbortSignal}} options Content type and cancellation.
 * @returns {Promise<void>} Settlement promise.
 */
function writeBinaryAndWaitForFinish(res, body, { contentType, signal }) {
    const abortReason = () => {
        if (signal?.reason instanceof Error) return signal.reason;
        const error = new Error('Preview response was aborted.');
        error.name = 'AbortError';
        error.code = 'ABORT_ERR';
        return error;
    };
    const writeFailure = (message) => {
        const error = new Error(message);
        error.code = 'RESPONSE_WRITE_FAILED';
        return error;
    };
    const send = () => {
        res.status(200);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(body.length));
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
    };

    if (signal?.aborted) return Promise.reject(abortReason());
    if (res.destroyed || res.closed || res.writableEnded) {
        return Promise.reject(writeFailure('Response closed before completion.'));
    }
    if (typeof res.once !== 'function') {
        send();
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            res.removeListener('finish', onFinish);
            res.removeListener('close', onClose);
            res.removeListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
            callback(value);
        };
        const onFinish = () => finish(resolve);
        const onClose = () => {
            if (res.writableFinished) return finish(resolve);
            return finish(reject, writeFailure('Response closed before completion.'));
        };
        const onError = () => finish(reject, writeFailure('Response could not be written.'));
        const onAbort = () => finish(reject, abortReason());

        res.once('finish', onFinish);
        res.once('close', onClose);
        res.once('error', onError);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) return onAbort();
        if (res.destroyed || res.closed || res.writableEnded) return onClose();
        try {
            send();
        } catch (error) {
            finish(reject, error);
        }
    });
}

/**
 * Create the queue-slot preview processor with injectable pipeline seams.
 * @param {object} [dependencies] Test seams; production uses the real slice pipeline.
 * @returns {(req: object, res: object, options?: {signal?: AbortSignal}) => Promise<unknown>} Processor.
 */
function createRenderProcessor(dependencies = {}) {
    const resolveRequest = dependencies.resolveRequestOrResponseImpl || resolveRequestOrResponse;
    const appendExtension = dependencies.appendOriginalExtensionToUploadImpl || appendOriginalExtensionToUpload;
    const prepareModel = dependencies.prepareProcessableModelImpl || prepareProcessableModel;
    const applyTransform = dependencies.applyTransformAndValidateModelImpl || applyTransformAndValidateModel;
    const assertBounded = dependencies.assertBoundedModelFileImpl || assertBoundedModelFile;
    const readPreview = dependencies.readPreviewImageImpl || readPreviewImage;
    const runCommand = dependencies.runCommandImpl
        || createCommandRunner({ timeoutMs: RENDER_COMMAND_TIMEOUT_MS });
    const pythonExecutable = dependencies.pythonExecutable || PYTHON_EXECUTABLE;
    const helperPath = dependencies.helperPath || resolveRenderHelperPath();
    const buildVolumeLimits = dependencies.buildVolumeLimits || createPreviewBuildVolumeLimits();

    async function runRenderer(stlPath, pngPath, caption, signal) {
        try {
            await runCommand(
                pythonExecutable,
                buildRenderArguments(helperPath, stlPath, pngPath, caption),
                { signal }
            );
        } catch (error) {
            if (!isAbortError(error, signal) && (error?.code === 'ETIMEDOUT' || error?.killed === true)) {
                error.renderTimeout = true;
            }
            throw error;
        }
    }

    return async function processRender(req, res, options = {}) {
        const workspace = getRequestWorkspace(req);
        if (!workspace) throw new Error('Render workspace is unavailable.');
        const signal = options.signal;
        try {
            throwIfAborted(signal);
            // Mirror `/prusa/slice`: technology follows layerHeight so the
            // orientation heuristics match what the consumer would slice with.
            const resolved = resolveRequest(req, res, { engine: 'prusa', forcedTechnology: null }, workspace);
            if (resolved.response) return resolved.response;
            const request = resolved.request;
            throwIfAborted(signal);
            const inputFile = await appendExtension(request.inputFile, request.originalExt, workspace);
            throwIfAborted(signal);
            const source = await prepareModel(
                inputFile,
                request.technology,
                request.orientationMode,
                workspace,
                signal
            );
            throwIfAborted(signal);
            const model = await applyTransform(
                source.processableFile,
                source.orientedModelMeasurement,
                request.transformOptions,
                buildVolumeLimits,
                workspace,
                signal,
                {
                    orientation: source.orientation,
                    originalModelMeasurement: source.originalModelMeasurement
                }
            );
            throwIfAborted(signal);
            if (!model.isValid) return res.status(model.status).json(model.response);
            const stlPath = await assertBounded(model.processableFile, workspace);
            throwIfAborted(signal);
            const caption = formatDimensionCaption(model.effectiveModelInfo);
            const previewPath = await workspace.createUniquePath('.png');
            await runRenderer(stlPath, previewPath, caption, signal);
            throwIfAborted(signal);
            const png = await readPreview(previewPath, workspace);
            throwIfAborted(signal);
            setResponseSettlement(
                req,
                writeBinaryAndWaitForFinish(res, png, { contentType: PREVIEW_CONTENT_TYPE, signal })
            );
            return res;
        } catch (err) {
            if (isAbortError(err, signal)) {
                throwIfAborted(signal);
                throw err;
            }
            if (res.headersSent || res.destroyed) throw err;
            if (err?.renderTimeout === true) return renderTimeoutResponse(res);
            return handleProcessingError(err, res, null, null, getSupportedInputExtensionsText);
        }
    };
}

/**
 * Build the pre-queue validator for render requests. A missing upload, an
 * unsupported extension, or an invalid option answers HTTP 400 BEFORE the
 * request is admitted to the shared slice queue, so it never wins the single
 * native slot. No profile selection is needed: the preview slices nothing.
 * @param {object} [dependencies] `resolveRequestOrResponseImpl` seam shared with the processor.
 * @returns {(req: object, res: object) => object|null} Validator returning a settled 400 response or null.
 */
function createRenderPreValidator(dependencies = {}) {
    const resolveRequest = dependencies.resolveRequestOrResponseImpl || resolveRequestOrResponse;
    return function preValidateRenderRequest(req, res) {
        const workspace = getRequestWorkspace(req);
        if (!workspace) return null;
        const resolved = resolveRequest(req, res, { engine: 'prusa', forcedTechnology: null }, workspace);
        return resolved.response || null;
    };
}

/**
 * Build the queue-aware render handler on top of the shared slice handler lifecycle.
 * @param {object} [options] `processRenderImpl`, `processorDependencies`, `validateSliceRequestImpl`, plus `createSliceHandlers` seams.
 * @returns {{handleRender: (req: object, res: object) => Promise<unknown>, processRender: Function}} Handler bundle.
 */
function createRenderHandlers(options = {}) {
    const processRender = options.processRenderImpl || createRenderProcessor(options.processorDependencies);
    const validateSliceRequestImpl = options.validateSliceRequestImpl
        || createRenderPreValidator(options.processorDependencies);
    const { handleSlicePrusa } = createSliceHandlers({
        ...options,
        processSliceImpl: processRender,
        validateSliceRequestImpl
    });
    return { handleRender: handleSlicePrusa, processRender };
}

const { handleRender, processRender } = createRenderHandlers();

module.exports = {
    RENDER_HELPER_NAME,
    RENDER_COMMAND_TIMEOUT_MS,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    PREVIEW_CONTENT_TYPE,
    MAX_PREVIEW_BYTES,
    handleRender,
    processRender,
    createRenderHandlers,
    createRenderPreValidator,
    createRenderProcessor,
    createPreviewBuildVolumeLimits,
    resolveRenderHelperPath,
    formatDimensionCaption,
    buildRenderArguments,
    readPreviewImage,
    writeBinaryAndWaitForFinish
};
