'use strict';

/**
 * Production-model export (`POST /bambu/export`, 3.9.0 §2.2–2.3, §4.7).
 *
 * At ORDER time the export re-runs the UNCHANGED hashed preparation pipeline
 * of the priced Bambu slice (`pipeline.resolveRequestOrResponse` and
 * `pipeline.prepareSliceJob`, called as they are, with the captured-response
 * pattern of `async-slice.js`) up to the exact placed STL the native slicer
 * would receive, hashes it and compares the hash with the receipt's
 * `source.sliced_geometry_sha256`. No native slice runs, no artifact is
 * promoted, nothing is kept after a synchronous answer.
 *
 * Every check before a queue place is answered synchronously, also with
 * `Prefer: respond-async`, in the order of §2.2: options (400) → the running
 * `measurement_generation` (409) → the streamed source hash (409) → the
 * archive preflight → the export capacity (429). The job then runs in the
 * lowest queue class (`enqueueExportJob`), which shares the two slice slots.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline: streamPipeline } = require('node:stream/promises');
const { export: exportPolicy } = require('../../config/release-policy');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { resolveRequestOrResponse, prepareSliceJob } = require('../slice/pipeline');
const { preValidateSliceRequest } = require('../slice.service');
const { createJobWorkspace, getRequestWorkspace } = require('../slice/workspace');
const { createCapturedResponse, prefersRespondAsync, resolveJobPrincipal } = require('../slice/async-slice');
const { handleProcessingError } = require('../slice/errors');
const { getSupportedInputExtensionsText } = require('../slice/common');
const { hashFile, inspectBambuMesh } = require('../slice/bambu-source');
const { getBambuGeneration } = require('../slice/bambu-generation');
const { runCommand, isAbortError, PYTHON_HELPER_TIMEOUT_MS } = require('../slice/command');
const { APPLICATION_ROOT } = require('../slice/helper-paths');
const { enqueueExportJob, toQueueErrorResponse, ExportQueueFullError } = require('../slice/queue');
const { preflightArchive, sendPreflightRefusal } = require('../slice/archive-preflight');
const { consumeExpansionVerdict, registerExpansionVerdict } = require('../slice/three-mf-expansion');
const { bindRequestAbort, isResponseWritable } = require('../slice/request-abort');
const { emitEvent } = require('../observability/events');
const { incrementExportJob } = require('../observability/metrics');
const {
    EXPORT_CONTRACT,
    POLL_AFTER_MS,
    STATUS_URL_PREFIX,
    ExportDeadlineError,
    getDefaultExportJobStore
} = require('./export-jobs');
const { RESULT_FILE_NAMES, defaultExportFiles } = require('./export-files');

const EXPORT_HELPER_NAME = 'export_3mf.py';
const EXPORT_FORMATS = Object.freeze(['stl', '3mf']);
const MEDIA_TYPES = Object.freeze({ stl: 'model/stl', '3mf': 'model/3mf' });
const HEX64 = /^[a-f0-9]{64}$/;
const QUOTE_REF = /^Q-[0-9]{7}$/;
const BAMBU_OPTIONS = Object.freeze({ engine: 'bambu', forcedTechnology: 'FDM' });

/** Stable error texts. New codes avoid the live classifier's substrings (§2.2). */
const ERRORS = Object.freeze({
    EXPORT_FORMAT_INVALID: [400, 'Unsupported exportFormat. Allowed values: stl, 3mf.'],
    EXPORT_REQUEST_INVALID: [400, 'An export field is absent or malformed.'],
    SLICE_IDENTITY_MISMATCH: [409, 'Selected profile or measurement generation is stale.'],
    EXPORT_SOURCE_MISMATCH: [409, 'The uploaded file is not the priced source file.'],
    EXPORT_GEOMETRY_MISMATCH: [409, 'The re-prepared model differs from the priced slice geometry.'],
    EXPORT_WRITE_FAILED: [500, 'The production model file could not be written.'],
    EXPORT_DEADLINE_EXCEEDED: [504, 'The export did not finish within its deadline.'],
    EXPORT_JOB_NOT_FOUND: [404, 'Export job not found.'],
    EXPORT_NOT_READY: [409, 'The export job has no file to download.'],
    SLICER_ENGINE_UNAVAILABLE: [503, 'The selected slicer engine is unavailable.'],
    INTERNAL_SERVER_ERROR: [500, 'Internal server error.']
});

function errorBody(code, extra = {}) {
    const [, error] = ERRORS[code];
    return { success: false, error, errorCode: code, ...extra };
}

function errorResult(code, extra = {}) {
    return { status: ERRORS[code][0], body: errorBody(code, extra) };
}

/** JSON without Express's ETag, so a status read can never become a 304. */
function sendNoStoreJson(res, status, body, headers = {}) {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).end(JSON.stringify(body));
}

function sendResult(res, result) {
    for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(result.status).json(result.body);
}

function fieldString(body, name) {
    const value = body?.[name];
    return value === undefined ? undefined : value;
}

/**
 * Parse the export's own multipart fields (§2.2). The slice's own option
 * fields are validated by the slice's pre-queue validator.
 * @param {Record<string, unknown>} body Multipart fields.
 * @returns {{fields: object}|{result: {status: number, body: object}}} Fields or a refusal.
 */
function parseExportFields(body) {
    const rawFormat = fieldString(body, 'exportFormat');
    const format = rawFormat === undefined ? 'stl' : rawFormat;
    if (typeof format !== 'string' || !EXPORT_FORMATS.includes(format)) {
        return { result: errorResult('EXPORT_FORMAT_INVALID') };
    }
    const source = fieldString(body, 'expectedSourceSha256');
    const label = fieldString(body, 'exportLabel');
    const geometry = fieldString(body, 'expectedSlicedGeometrySha256');
    const generation = fieldString(body, 'expectedMeasurementGeneration');
    const profile = fieldString(body, 'expectedProfileSha256');
    if (typeof source !== 'string' || !HEX64.test(source)
        || (label !== undefined && (typeof label !== 'string' || !QUOTE_REF.test(label)))
        || (geometry !== undefined && (typeof geometry !== 'string' || !HEX64.test(geometry)))
        || generation === undefined) {
        return { result: errorResult('EXPORT_REQUEST_INVALID') };
    }
    return {
        fields: {
            format,
            expectedSourceSha256: source,
            exportLabel: label,
            expectedSlicedGeometrySha256: geometry,
            expectedMeasurementGeneration: generation,
            expectedProfileSha256: profile
        }
    };
}

/**
 * Compare the required generation with the running one. The profile hash is
 * format-checked only: the export runs no slice profile (§2.2).
 * @returns {{generation: string}|{result: object}} Running generation or a refusal.
 */
function checkGeneration(fields, readGeneration) {
    let current;
    try {
        current = readGeneration();
    } catch {
        current = null;
    }
    if (!current || !HEX64.test(current.measurement_generation || '')) {
        return { result: errorResult('SLICER_ENGINE_UNAVAILABLE') };
    }
    const generation = fields.expectedMeasurementGeneration;
    const profile = fields.expectedProfileSha256;
    if (typeof generation !== 'string' || !HEX64.test(generation) || generation !== current.measurement_generation
        || (profile !== undefined && (typeof profile !== 'string' || !HEX64.test(profile)))) {
        return { result: errorResult('SLICE_IDENTITY_MISMATCH') };
    }
    return { generation: current.measurement_generation };
}

function fixed3(value) {
    return Number(value).toFixed(3);
}

function triple(dimensions) {
    return { x: dimensions.x, y: dimensions.y, z: dimensions.z };
}

function assertFiniteTriple(value) {
    if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
        throw new Error('Export facts are incomplete.');
    }
    return triple(value);
}

/**
 * The facts of the re-prepared placed mesh, all taken from the hashed
 * pipeline's own `model_transform`, placement and the receipt's mesh
 * inspection of the same file.
 */
function buildFacts(model, slicedGeometrySha256, generation, inspection) {
    const transform = model.modelTransform || {};
    const matrix = transform.rotation_matrix;
    if (!Array.isArray(matrix) || matrix.length !== 3
        || !matrix.every((row) => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))) {
        throw new Error('Export rotation matrix is unavailable.');
    }
    if (!model.placement || !Number.isFinite(model.placement.x_min) || !Number.isFinite(model.placement.y_min)) {
        throw new Error('Export bed placement is unavailable.');
    }
    if (!Number.isFinite(inspection?.volume_mm3)) throw new Error('Export mesh volume is unavailable.');
    return {
        sliced_geometry_sha256: slicedGeometrySha256,
        measurement_generation: generation,
        final_dimensions_mm: assertFiniteTriple(transform.final_dimensions_mm),
        oriented_dimensions_mm: assertFiniteTriple(transform.oriented_dimensions_mm),
        rotation_matrix: matrix.map((row) => [...row]),
        rotation_deg: transform.rotation_deg ? assertFiniteTriple(transform.rotation_deg) : null,
        volume_mm3: inspection.volume_mm3,
        placement_mm: { x: model.placement.x_min, y: model.placement.y_min },
        orientation_outcome: transform.orientation_outcome,
        orientation_mode: transform.orientation_mode,
        scale_percent: transform.scale_percent
    };
}

/** The §2.2 sync headers of a stored result (also sent by the async file route). */
function exportHeaders(result) {
    const { facts, file, format, fidelity } = result;
    const dims = (value) => `${fixed3(value.x)},${fixed3(value.y)},${fixed3(value.z)}`;
    return {
        'Content-Type': MEDIA_TYPES[format],
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename="${RESULT_FILE_NAMES[format]}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-R3D-Export-Contract': String(EXPORT_CONTRACT),
        'X-R3D-Export-Fidelity': fidelity,
        'X-R3D-Export-Sha256': file.sha256,
        'X-R3D-Sliced-Geometry-Sha256': facts.sliced_geometry_sha256,
        'X-R3D-Measurement-Generation': facts.measurement_generation,
        'X-R3D-Final-Dimensions-Mm': dims(facts.final_dimensions_mm),
        'X-R3D-Placement-Mm': `${fixed3(facts.placement_mm.x)},${fixed3(facts.placement_mm.y)}`,
        'X-R3D-Orientation-Outcome': String(facts.orientation_outcome),
        'X-R3D-Rotation-Matrix': facts.rotation_matrix.flat().map((value) => Number(value).toFixed(9)).join(','),
        'X-R3D-Oriented-Dimensions-Mm': dims(facts.oriented_dimensions_mm),
        'X-R3D-Volume-Mm3': String(facts.volume_mm3)
    };
}

/** The job result of a 200 export (§2.3). */
function successView(result, job) {
    const { facts, file, format, fidelity } = result;
    return {
        success: true,
        fidelity,
        format,
        media_type: MEDIA_TYPES[format],
        size_bytes: file.size,
        sha256: file.sha256,
        sliced_geometry_sha256: facts.sliced_geometry_sha256,
        measurement_generation: facts.measurement_generation,
        final_dimensions_mm: triple(facts.final_dimensions_mm),
        oriented_dimensions_mm: triple(facts.oriented_dimensions_mm),
        rotation_matrix: facts.rotation_matrix.map((row) => [...row]),
        volume_mm3: facts.volume_mm3,
        placement_mm: { ...facts.placement_mm },
        orientation_outcome: facts.orientation_outcome,
        file_url: `${STATUS_URL_PREFIX}${job.id}/file`,
        file_expires_at: new Date(job.fileExpiresAt).toISOString()
    };
}

/** Metadata names of the 3MF (§2.2), validated again by the helper. */
function threeMfMetadata(input, facts, request, fidelity) {
    const dims = (value) => `${fixed3(value.x)},${fixed3(value.y)},${fixed3(value.z)}`;
    const rotation = facts.rotation_deg || { x: 0, y: 0, z: 0 };
    const metadata = {
        export_contract: String(EXPORT_CONTRACT),
        fidelity,
        source_sha256: input.fields.expectedSourceSha256,
        sliced_geometry_sha256: facts.sliced_geometry_sha256,
        measurement_generation: facts.measurement_generation,
        printer_profile: String(request?.profileOverrides?.bambuPrinter || 'unknown'),
        orientation_mode: String(facts.orientation_mode || request?.orientationMode || 'unknown'),
        rotation_deg: `${rotation.x},${rotation.y},${rotation.z}`,
        placement_mm: `${fixed3(facts.placement_mm.x)},${fixed3(facts.placement_mm.y)}`,
        final_dimensions_mm: dims(facts.final_dimensions_mm)
    };
    if (Number.isFinite(facts.scale_percent)) metadata.scale_percent = String(facts.scale_percent);
    if (input.fields.exportLabel) metadata.quote_ref = input.fields.exportLabel;
    return metadata;
}

function capturedResult(capture) {
    const retryAfter = capture.getHeader('retry-after');
    return {
        status: capture.statusCode,
        body: capture.body,
        headers: typeof retryAfter === 'string' ? { 'Retry-After': retryAfter } : {}
    };
}

function rethrowAbort(error, signal) {
    if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
    throw error;
}

/**
 * Move the preflight's verdict from the upload to the run's private copy
 * (same bytes, new inode), so the job consumes it and does not tokenize the
 * archive a second time on the main thread. Best effort: without it the job
 * simply runs the scan itself, as it does for any file without a verdict.
 * @param {string} uploadPath The upload the preflight inspected.
 * @param {string} copyPath The run's copy of it.
 * @returns {Promise<boolean>} Whether a verdict was carried.
 */
async function carryExpansionVerdict(uploadPath, copyPath) {
    try {
        const [uploadReal, uploadStats] = await Promise.all([
            fsp.realpath(uploadPath), fsp.lstat(uploadPath, { bigint: true })
        ]);
        const counts = consumeExpansionVerdict(uploadReal, uploadStats);
        if (!counts) return false;
        const [copyReal, copyStats] = await Promise.all([fsp.realpath(copyPath), fsp.lstat(copyPath, { bigint: true })]);
        if (copyStats.size !== uploadStats.size) return false;
        registerExpansionVerdict({
            realpath: copyReal,
            dev: copyStats.dev,
            ino: copyStats.ino,
            size: copyStats.size,
            mtimeNs: copyStats.mtimeNs,
            counts
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Build the export runner. One run = a fresh job workspace holding a copy of
 * the upload, the unchanged hashed preparation, the hash comparison and the
 * format writer. A run may be repeated (pre-emption); the upload itself is
 * never modified. The run workspace is cleaned in every outcome, which also
 * releases the unpromoted output candidate `resolveSliceOutputTargets` made.
 * @param {object} [deps] Test seams.
 * @returns {(input: object, signal: AbortSignal, persist: Function) => Promise<object>} Runner.
 */
function createExportRunner(deps = {}) {
    const createWorkspace = deps.createWorkspace || createJobWorkspace;
    const resolveRequest = deps.resolveRequestOrResponse || resolveRequestOrResponse;
    const prepare = deps.prepareSliceJob || prepareSliceJob;
    const hash = deps.hashFile || hashFile;
    const inspect = deps.inspectMesh || inspectBambuMesh;
    const run = deps.runCommand || runCommand;
    const pythonExecutable = deps.pythonExecutable || PYTHON_EXECUTABLE;
    const helperPath = deps.helperPath || path.join(APPLICATION_ROOT, EXPORT_HELPER_NAME);
    const handleError = deps.handleProcessingError || handleProcessingError;
    const helperTimeoutMs = deps.helperTimeoutMs || PYTHON_HELPER_TIMEOUT_MS;

    async function writeThreeMf(workspace, placedPath, metadata, signal) {
        const outputPath = await workspace.createUniquePath('.3mf');
        const metadataPath = await workspace.createUniquePath('.json');
        await fsp.writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, { flag: 'wx', mode: 0o600 });
        await run(pythonExecutable, [helperPath, placedPath, outputPath, metadataPath], {
            signal, timeoutMs: helperTimeoutMs
        });
        const stats = await fsp.lstat(outputPath);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0) throw new Error('3MF output is missing.');
        return outputPath;
    }

    async function prepareModel(input, workspace, signal) {
        const copy = workspace.resolvePath(`${Date.now()}-${crypto.randomUUID()}`);
        await fsp.copyFile(input.upload.path, copy, fs.constants.COPYFILE_EXCL);
        await carryExpansionVerdict(input.upload.path, copy);
        if (signal?.aborted) rethrowAbort(new Error('aborted'), signal);
        const runRequest = {
            file: {
                fieldname: 'choosenFile',
                originalname: input.upload.originalname,
                path: copy,
                size: input.upload.size
            },
            body: input.body,
            requestId: input.requestId
        };
        const capture = createCapturedResponse();
        try {
            const resolved = resolveRequest(runRequest, capture, BAMBU_OPTIONS, workspace);
            if (resolved.response) return { result: capturedResult(capture) };
            const job = await prepare(capture, resolved.request, workspace, signal);
            if (job.response) return { result: capturedResult(capture) };
            return { job };
        } catch (error) {
            if (isAbortError(error, signal)) rethrowAbort(error, signal);
            // The pipeline's own refusals keep their slice codes and statuses.
            if (!capture.headersSent) handleError(error, capture, null, null, getSupportedInputExtensionsText);
            return { result: capturedResult(capture) };
        }
    }

    return async function runExport(input, signal, persist) {
        if (signal?.aborted) rethrowAbort(new Error('aborted'), signal);
        const workspace = await createWorkspace();
        try {
            const prepared = await prepareModel(input, workspace, signal);
            if (prepared.result) return prepared.result;
            const { job } = prepared;
            const model = job.preparedModel.model;
            const placedPath = model.processableFile;
            const slicedGeometrySha256 = await hash(placedPath);
            if (signal?.aborted) rethrowAbort(new Error('aborted'), signal);
            const expected = input.fields.expectedSlicedGeometrySha256;
            if (expected !== undefined && slicedGeometrySha256 !== expected) {
                return errorResult('EXPORT_GEOMETRY_MISMATCH', {
                    actual_sliced_geometry_sha256: slicedGeometrySha256,
                    orientation_outcome: model.modelTransform?.orientation_outcome
                });
            }
            const fidelity = expected !== undefined ? 'exact' : 'unverified';
            let facts;
            let bodyPath = placedPath;
            try {
                const inspection = await inspect(placedPath, signal);
                facts = buildFacts(model, slicedGeometrySha256, input.generation, inspection);
                if (input.fields.format === '3mf') {
                    const metadata = threeMfMetadata(input, facts, job.request, fidelity);
                    bodyPath = await writeThreeMf(workspace, placedPath, metadata, signal);
                }
            } catch (error) {
                if (isAbortError(error, signal)) rethrowAbort(error, signal);
                return errorResult('EXPORT_WRITE_FAILED');
            }
            const stats = await fsp.lstat(bodyPath);
            const sha256 = await hash(bodyPath);
            if (signal?.aborted) rethrowAbort(new Error('aborted'), signal);
            const storedPath = await persist(input.fields.format, bodyPath);
            return {
                status: 200,
                format: input.fields.format,
                fidelity,
                facts,
                file: { path: storedPath, size: stats.size, sha256 }
            };
        } finally {
            try {
                await workspace.cleanup('settled');
            } catch {
                emitEvent('artifact.cleanup', {
                    job_id: workspace.id, audience: 'artifact', outcome: 'failure',
                    error_code: 'WORKSPACE_CLEANUP_FAILED'
                });
            }
        }
    };
}

/** Map a settled rejection of an export task to its result (§2.2). */
function rejectionResult(error, { sync }) {
    if (error?.code === 'EXPORT_DEADLINE_EXCEEDED') {
        return errorResult('EXPORT_DEADLINE_EXCEEDED', sync ? { retry_async: true } : {});
    }
    const mapping = toQueueErrorResponse(error);
    if (mapping) return { status: mapping.status, body: mapping.body, headers: mapping.headers };
    return errorResult('INTERNAL_SERVER_ERROR');
}

function outcomeLabel(result) {
    if (result.status === 200) return result.fidelity;
    if (result.body?.errorCode === 'EXPORT_GEOMETRY_MISMATCH') return 'mismatch';
    if (result.body?.errorCode === 'EXPORT_DEADLINE_EXCEEDED') return 'deadline';
    return 'failed';
}

function queueFullResult() {
    const mapping = toQueueErrorResponse(new ExportQueueFullError());
    return { status: mapping.status, body: mapping.body, headers: mapping.headers };
}

/**
 * Stream a stored export file with the §2.2 headers. Resolves once the
 * response finished or the client left.
 */
async function sendExportFile(res, result) {
    const stream = fs.createReadStream(result.file.path);
    await new Promise((resolve, reject) => {
        stream.once('open', resolve);
        stream.once('error', reject);
    });
    for (const [name, value] of Object.entries(exportHeaders(result))) res.setHeader(name, value);
    res.status(200);
    const closed = new Promise((resolve) => {
        if (stream.closed) resolve();
        else stream.once('close', resolve);
    });
    try {
        await streamPipeline(stream, res);
    } catch {
        // A client that left mid-body owns that outcome; nothing else is written.
        stream.destroy();
    }
    // The file's descriptor is closed before the caller cleans its directory.
    await closed;
}

/**
 * Build the export handlers.
 * @param {object} [options] Seams: `store`, `enqueue`, `runner`, `preValidate`,
 *   `preflight`, `readGeneration`, `hashFile`, `files`, `bindAbort`, timers,
 *   `syncDeadlineMs`, and the lifecycle's `transferWorkspace` / `markHandoff`.
 * @returns {{handleExport: Function, handleJobStatus: Function, handleJobFile: Function, handleJobDelete: Function}}
 */
function createExportHandlers(options = {}) {
    const resolveStore = () => options.store || getDefaultExportJobStore();
    const enqueue = options.enqueue || enqueueExportJob;
    const runner = options.runner || createExportRunner(options.runnerDependencies);
    const preValidate = options.preValidate || preValidateSliceRequest;
    const preflight = options.preflight !== undefined ? options.preflight : preflightArchive;
    const readGeneration = options.readGeneration || (() => getBambuGeneration());
    const hash = options.hashFile || hashFile;
    const files = options.files || defaultExportFiles;
    const bindAbort = options.bindAbort || bindRequestAbort;
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const syncDeadlineMs = options.syncDeadlineMs || exportPolicy.EXPORT_SYNC_DEADLINE_MS;
    const transferWorkspace = options.transferWorkspace || (() => null);
    const markHandoff = options.markHandoff || (() => {});
    const emit = options.emitEvent || emitEvent;
    const countOutcome = options.incrementExportJob || incrementExportJob;

    function recordOutcome(result, format, jobId, requestId) {
        const label = outcomeLabel(result);
        try {
            countOutcome(label);
        } catch {
            // Metrics never own an answer.
        }
        try {
            emit('export.completed', {
                job_id: jobId,
                request_id: requestId,
                audience: 'slice',
                outcome: result.status === 200 ? 'success' : 'failure',
                error_code: result.status === 200 ? undefined : result.body?.errorCode,
                extra: {
                    format,
                    fidelity: result.status === 200 ? result.fidelity : undefined,
                    verdict: label,
                    bytes: result.file?.size
                }
            });
        } catch {
            // Telemetry never owns an answer.
        }
    }

    /** Every pre-queue check of §2.2; a refusal is answered and returns null. */
    async function admitRequest(req, res, signal) {
        const early = preValidate(req, res, BAMBU_OPTIONS);
        if (early) return null;
        const parsed = parseExportFields(req.body);
        if (parsed.result) {
            sendResult(res, parsed.result);
            return null;
        }
        const identity = checkGeneration(parsed.fields, readGeneration);
        if (identity.result) {
            sendResult(res, identity.result);
            return null;
        }
        const sourceSha256 = await hash(req.file.path);
        if (sourceSha256 !== parsed.fields.expectedSourceSha256) {
            sendResult(res, errorResult('EXPORT_SOURCE_MISMATCH'));
            return null;
        }
        if (preflight) {
            try {
                await preflight(req, { signal });
            } catch (error) {
                if (signal?.aborted || error?.name === 'AbortError' || !isResponseWritable(res)) return null;
                sendPreflightRefusal(error, res);
                return null;
            }
        }
        return {
            upload: { path: req.file.path, originalname: req.file.originalname, size: req.file.size },
            body: { ...(req.body || {}) },
            requestId: req.requestId,
            fields: parsed.fields,
            generation: identity.generation
        };
    }

    async function persistIntoWorkspace(workspace, format, sourcePath) {
        const target = workspace.resolvePath(`export-${crypto.randomBytes(16).toString('hex')}.${format}`);
        try {
            await fsp.rename(sourcePath, target);
        } catch (error) {
            if (error?.code !== 'EXDEV') throw error;
            await fsp.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
        }
        return target;
    }

    async function handleSync(req, res, input, store, binding) {
        const release = store.reserveSync();
        if (!release) return sendResult(res, queueFullResult());
        const workspace = getRequestWorkspace(req);
        const controller = new AbortController();
        const onClientGone = () => controller.abort(binding.signal.reason);
        binding.signal.addEventListener('abort', onClientGone, { once: true });
        const timer = setTimer(() => controller.abort(new ExportDeadlineError()), syncDeadlineMs);
        timer?.unref?.();
        let result;
        try {
            result = await enqueue(
                (signal) => runner(input, signal, (format, file) => persistIntoWorkspace(workspace, format, file)),
                { signal: controller.signal }
            );
        } catch (error) {
            result = rejectionResult(error, { sync: true });
        } finally {
            clearTimer(timer);
            binding.signal.removeEventListener('abort', onClientGone);
            release();
        }
        if (binding.signal.aborted || !isResponseWritable(res)) return undefined;
        recordOutcome(result, input.fields.format, undefined, input.requestId);
        if (result.status === 200 && result.file) return sendExportFile(res, result);
        return sendResult(res, result);
    }

    async function finalizeAsync(store, job, settled, workspace) {
        let result;
        try {
            result = await settled;
        } catch (error) {
            result = rejectionResult(error, { sync: false });
        }
        if (!(result.status === 200 && result.file)) {
            // A failed or aborted run keeps no result file.
            await Promise.resolve().then(() => files.removeResult(job.id)).catch(() => {});
        }
        if (store.isLive(job)) {
            recordOutcome(result, job.format, job.id, job.requestId);
            store.complete(job, {
                ...result,
                view: result.status === 200 && result.file
                    ? (completed) => successView(result, completed)
                    : result.body
            });
        } else if (result.file) {
            await Promise.resolve().then(() => files.removeResult(job.id)).catch(() => {});
        }
        if (workspace) {
            try {
                await workspace.cleanup('settled');
            } catch {
                emitEvent('artifact.cleanup', {
                    audience: 'artifact', outcome: 'failure', error_code: 'WORKSPACE_CLEANUP_FAILED'
                });
            }
        }
    }

    async function handleAsync(req, res, input, store, binding) {
        const job = store.admit({
            principal: resolveJobPrincipal(req),
            requestId: input.requestId,
            format: input.fields.format,
            fidelity: input.fields.expectedSlicedGeometrySha256 ? 'exact' : 'unverified'
        });
        if (!job) return sendResult(res, queueFullResult());
        let admitted = false;
        const settled = enqueue((signal) => {
            store.markRunning(job);
            return runner(input, signal, (format, file) => files.storeResultFile(job.id, format, file));
        }, {
            signal: job.controller.signal,
            onAdmitted: (admission) => {
                admitted = true;
                store.attachAdmission(job, admission);
            }
        });
        settled.catch(() => {});
        if (!admitted) {
            store.discard(job);
            try {
                await settled;
            } catch (error) {
                if (isResponseWritable(res) && !binding.signal.aborted) {
                    return sendResult(res, rejectionResult(error, { sync: false }));
                }
            }
            return undefined;
        }
        if (!isResponseWritable(res) || binding.signal.aborted) {
            // The client left before the 202: the job never becomes visible.
            store.cancel(job.id, job.principal);
            await settled.catch(() => {});
            return undefined;
        }
        const workspace = transferWorkspace(req, getRequestWorkspace(req));
        const body = store.acceptedView(job);
        res.setHeader('Location', body.status_url);
        res.setHeader('Preference-Applied', 'respond-async');
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(POLL_AFTER_MS / 1000))));
        res.setHeader('Cache-Control', 'no-store');
        res.status(202).json(body);
        markHandoff(req);
        try {
            emit('export.accepted', {
                job_id: job.id,
                request_id: job.requestId,
                audience: 'slice',
                outcome: 'accepted',
                extra: { format: job.format, fidelity: job.fidelity, queue_state: 'queued' }
            });
        } catch {
            // Telemetry never owns an answer.
        }
        void finalizeAsync(store, job, settled, workspace);
        return undefined;
    }

    /** `POST /bambu/export` handler (inside the shared upload lifecycle). */
    async function handleExport(req, res) {
        const binding = bindAbort(req, res);
        try {
            const input = await admitRequest(req, res, binding.signal);
            if (!input) return undefined;
            if (binding.signal.aborted || !isResponseWritable(res)) return undefined;
            const store = resolveStore();
            if (prefersRespondAsync(req)) return await handleAsync(req, res, input, store, binding);
            return await handleSync(req, res, input, store, binding);
        } finally {
            binding.dispose();
        }
    }

    function handleJobStatus(req, res) {
        const store = resolveStore();
        const job = store.lookup(req.params?.job_id, resolveJobPrincipal(req));
        if (!job) return sendNoStoreJson(res, 404, errorBody('EXPORT_JOB_NOT_FOUND'));
        const body = store.view(job);
        const headers = body.status === 'completed' ? {} : { 'Retry-After': String(Math.ceil(POLL_AFTER_MS / 1000)) };
        return sendNoStoreJson(res, 200, body, headers);
    }

    async function handleJobFile(req, res) {
        const store = resolveStore();
        const job = store.lookup(req.params?.job_id, resolveJobPrincipal(req));
        if (!job) return sendNoStoreJson(res, 404, errorBody('EXPORT_JOB_NOT_FOUND'));
        if (job.state !== 'completed' || job.result?.status !== 200 || !job.file) {
            return sendNoStoreJson(res, 409, errorBody('EXPORT_NOT_READY'));
        }
        try {
            return await sendExportFile(res, job.result);
        } catch {
            // The file expired or was deleted between the lookup and the read.
            if (!res.headersSent) return sendNoStoreJson(res, 404, errorBody('EXPORT_JOB_NOT_FOUND'));
            return undefined;
        }
    }

    function handleJobDelete(req, res) {
        const store = resolveStore();
        if (!store.cancel(req.params?.job_id, resolveJobPrincipal(req))) {
            return sendNoStoreJson(res, 404, errorBody('EXPORT_JOB_NOT_FOUND'));
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.status(204).end();
    }

    return { handleExport, handleJobStatus, handleJobFile, handleJobDelete };
}

module.exports = {
    BAMBU_OPTIONS,
    ERRORS,
    EXPORT_FORMATS,
    EXPORT_HELPER_NAME,
    MEDIA_TYPES,
    buildFacts,
    checkGeneration,
    createExportHandlers,
    createExportRunner,
    errorBody,
    exportHeaders,
    parseExportFields,
    rejectionResult,
    sendExportFile,
    successView,
    threeMfMetadata
};
