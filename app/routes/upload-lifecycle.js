/**
 * Request-owned workspace and multipart upload lifecycle shared by upload routes.
 *
 * This module carries the same allocation -> upload -> handler -> cleanup
 * ownership that `slice.routes.js` applies to the two slice endpoints so that
 * sibling upload routes (for example `POST /render`) reuse it instead of
 * re-implementing the multer storage, the total upload deadline, and the
 * once-only cleanup accounting. It intentionally reuses the exported
 * `safeUploadError` and `assertPersistedUpload` helpers from the slice route.
 */

const path = require('node:path');
const fsSync = require('node:fs');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { EXTENSIONS } = require('../config/constants');
const { resolveResourcePolicy } = require('../config/resource-policy');
const {
    resolveMultipartLimits,
    safeUploadError,
    assertPersistedUpload
} = require('./slice.routes');
const {
    createJobWorkspace,
    attachWorkspaceToRequest,
    getRequestWorkspace,
    detachWorkspaceFromRequest
} = require('../services/slice/workspace');
const { setCorrelationIds } = require('../services/observability/context');
const { emitEvent } = require('../services/observability/events');

const ALLOWED_UPLOAD_EXTENSIONS = new Set([...EXTENSIONS.direct, ...EXTENSIONS.cad, ...EXTENSIONS.archive]);
const ABORT_ACTIVE_UPLOAD = Symbol('abortActiveUploadLifecycle');
const UPLOAD_FIELD_NAME = 'choosenFile';

/**
 * Build a multer instance whose storage writes exclusively into the request workspace.
 * @param {{fileSize: number, files: number, fields: number, parts: number, fieldNameSize: number, fieldSize: number, fieldNestingDepth: number}} limits Multipart envelope.
 * @returns {import('multer').Multer} Workspace-bound multer instance.
 */
function createWorkspaceUpload(limits) {
    const storage = {
        _handleFile(req, file, callback) {
            const workspace = getRequestWorkspace(req);
            if (!workspace?.directory) {
                const error = new Error('Upload workspace is unavailable.');
                error.code = 'UPLOAD_STORAGE_ERROR';
                return callback(error);
            }
            const filename = `${Date.now()}-${randomUUID()}`;
            const target = workspace.resolvePath(filename);
            const output = fsSync.createWriteStream(target, { flags: 'wx', mode: 0o600 });
            let settled = false;
            let size = 0;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                delete req[ABORT_ACTIVE_UPLOAD];
                const complete = () => {
                    if (error) callback(error);
                    else callback(null, {
                        destination: workspace.directory, filename, path: target, size
                    });
                };
                if (!error || output.closed) {
                    complete();
                    return;
                }
                file.stream.unpipe(output);
                file.stream.resume();
                output.once('close', complete);
                output.destroy(error);
            };
            file.stream.on('data', (chunk) => { size += chunk.length; });
            file.stream.once('error', finish);
            output.once('error', finish);
            output.once('finish', () => finish());
            req[ABORT_ACTIVE_UPLOAD] = (error) => {
                return new Promise((resolve) => {
                    output.once('close', resolve);
                    file.stream.unpipe(output);
                    file.stream.resume();
                    output.destroy(error);
                });
            };
            file.stream.pipe(output);
        },
        _removeFile(req, file, callback) {
            delete req[ABORT_ACTIVE_UPLOAD];
            fsSync.unlink(file.path, (error) => callback(error?.code === 'ENOENT' ? null : error));
        }
    };
    return multer({
        storage,
        limits,
        fileFilter(req, file, callback) {
            const ext = path.extname(file.originalname).toLowerCase();
            if (ALLOWED_UPLOAD_EXTENSIONS.has(ext)) return callback(null, true);
            const error = new Error('Unsupported file format.');
            error.status = 400;
            error.code = 'UNSUPPORTED_FILE_FORMAT';
            return callback(error);
        }
    });
}

function runMiddleware(middleware, req, res) {
    return new Promise((resolve, reject) => middleware(req, res, (error) => error ? reject(error) : resolve()));
}

function uploadDeadlineError() {
    const error = new Error('Multipart upload exceeded its total lifetime.');
    error.code = 'UPLOAD_TOTAL_TIMEOUT';
    error.status = 408;
    return error;
}

/**
 * Run the multer middleware under one total upload deadline.
 * @param {(req: object, res: object, next: (error?: Error) => void) => void} middleware Multer single-file middleware.
 * @param {object} req Express request.
 * @param {object} res Express response.
 * @param {number} timeoutMs Total upload lifetime.
 * @param {{setTimeout?: Function, clearTimeout?: Function}} [timers] Injectable timers.
 * @returns {Promise<void>} Resolves when the upload settled inside the deadline.
 */
async function runUploadWithinDeadline(middleware, req, res, timeoutMs, timers = {}) {
    const setTimer = timers.setTimeout || setTimeout;
    const clearTimer = timers.clearTimeout || clearTimeout;
    let timedOut = false;
    const timer = setTimer(async () => {
        const error = uploadDeadlineError();
        timedOut = true;
        const liveRequest = typeof req?.on === 'function'
            && typeof req?.unpipe === 'function'
            && 'readable' in req;
        if (liveRequest) {
            req.unpipe?.();
            req.pause?.();
            req.destroyed = true;
        }
        try {
            if (req[ABORT_ACTIVE_UPLOAD]) await req[ABORT_ACTIVE_UPLOAD](error);
        } finally {
            if (liveRequest) req.emit?.('aborted');
            else if (typeof req.destroy === 'function') req.destroy(error);
        }
    }, timeoutMs);
    timer?.unref?.();
    try {
        await runMiddleware(middleware, req, res);
        if (timedOut) throw uploadDeadlineError();
    } catch (error) {
        if (timedOut) throw uploadDeadlineError();
        throw error;
    } finally {
        clearTimer(timer);
    }
}

function workspaceAllocationError() {
    const error = new Error('Upload workspace could not be allocated.');
    error.code = 'WORKSPACE_ALLOCATION_FAILED';
    error.status = 500;
    return error;
}

async function finalizeLifecycle(context) {
    const { workspace, req, cleanupWorkspace, detach, reportCleanupFailure, observer, label, originalError } = context;
    let cleanupError;
    if (workspace) {
        try {
            await cleanupWorkspace(workspace, req);
        } catch (error) {
            cleanupError = error;
        }
    }
    try {
        detach(req);
    } catch (error) {
        cleanupError ||= error;
    }
    if (cleanupError) {
        try {
            reportCleanupFailure({
                jobId: /^job-[a-f0-9]{32}$/.test(workspace?.id || '') ? workspace.id : 'unknown',
                reason: 'cleanup_failed'
            });
        } catch (error) {
            // Reporting cannot replace the request or cleanup outcome.
        }
    }
    try {
        await Promise.resolve(observer({ engine: label, workspace, error: originalError, cleanupError }));
    } catch (error) {
        // A test/telemetry observer is not an owner and cannot alter request settlement.
    }
    return cleanupError;
}

/**
 * Build a lifecycle wrapper: allocate workspace -> bounded upload -> handler -> once-only cleanup.
 * @param {object} [options] Injectable seams mirroring `createSliceRouter` options.
 * @returns {(handler: (req: object, res: object) => Promise<unknown>, label: string) => (req: object, res: object, next: Function) => Promise<void>} Lifecycle factory.
 */
function createUploadLifecycle(options = {}) {
    const allocate = options.createWorkspace || createJobWorkspace;
    const attach = options.attachWorkspace || attachWorkspaceToRequest;
    const detach = options.detachWorkspace || detachWorkspaceFromRequest;
    const cleanupWorkspace = options.cleanupWorkspace || ((workspace) => workspace.cleanup());
    const observer = options.onLifecycleSettled || (() => {});
    const reportCleanupFailure = options.reportCleanupFailure || ((event) => {
        emitEvent('artifact.cleanup', {
            job_id: event?.jobId,
            audience: 'artifact',
            outcome: 'failure',
            error_code: 'WORKSPACE_CLEANUP_FAILED'
        });
    });
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const multipartLimits = options.multipartLimits || resolveMultipartLimits(options.env || process.env);
    const upload = options.upload || createWorkspaceUpload(multipartLimits);

    return function lifecycle(handler, label) {
        if (typeof handler !== 'function') throw new Error('Upload lifecycle requires a handler.');
        return async (req, res, next) => {
            let workspace;
            let originalError;
            let cleanupError;
            try {
                try {
                    workspace = await allocate();
                } catch (error) {
                    throw workspaceAllocationError();
                }
                attach(req, workspace);
                req.sliceJobId = workspace.id;
                setCorrelationIds({ jobId: workspace.id });
                try {
                    await runUploadWithinDeadline(
                        upload.single(UPLOAD_FIELD_NAME),
                        req,
                        res,
                        policy.UPLOAD_TOTAL_TIMEOUT_MS,
                        options.timers
                    );
                    if (req.file) await assertPersistedUpload(req.file, multipartLimits.fileSize);
                } catch (error) {
                    throw safeUploadError(error);
                }
                await handler(req, res);
            } catch (error) {
                originalError = error;
            } finally {
                cleanupError = await finalizeLifecycle({
                    workspace, req, cleanupWorkspace, detach, reportCleanupFailure,
                    observer, label, originalError
                });
            }

            if (originalError) return next(originalError);
            if (cleanupError) {
                const error = new Error('Upload workspace cleanup failed.');
                error.code = 'WORKSPACE_CLEANUP_FAILED';
                error.status = 500;
                return next(error);
            }
            return undefined;
        };
    };
}

module.exports = {
    UPLOAD_FIELD_NAME,
    createWorkspaceUpload,
    createUploadLifecycle,
    runUploadWithinDeadline
};
