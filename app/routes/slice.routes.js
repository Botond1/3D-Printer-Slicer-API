/** Slice route definition and request-owned upload lifecycle. */

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { randomUUID } = require('node:crypto');
const { DEFAULTS, EXTENSIONS } = require('../config/constants');
const { resolveResourcePolicy } = require('../config/resource-policy');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const requireSliceService = require('../middleware/requireSliceService');
const { handleSlicePrusa, handleSliceOrca } = require('../services/slice.service');
const {
    createJobWorkspace,
    attachWorkspaceToRequest,
    getRequestWorkspace,
    detachWorkspaceFromRequest
} = require('../services/slice/workspace');

const ALLOWED_UPLOAD_EXTENSIONS = new Set([...EXTENSIONS.direct, ...EXTENSIONS.cad, ...EXTENSIONS.archive]);
const ABORT_ACTIVE_UPLOAD = Symbol('abortActiveUpload');

const MULTIPART_DEFAULTS = Object.freeze({
    fields: 40,
    parts: 42,
    fieldNameSize: 64,
    fieldSize: 65_536
});

/** Resolve the finite multipart envelope. Explicit invalid overrides fail closed. */
function resolveMultipartLimits(env = process.env) {
    const policy = resolveResourcePolicy(env);
    const fields = policy.MULTIPART_MAX_FIELDS;
    const parts = policy.MULTIPART_MAX_PARTS;
    if (parts < fields + 2) {
        throw new Error('MULTIPART_MAX_PARTS must allow one file and all configured fields.');
    }
    return Object.freeze({
        fileSize: policy.MAX_UPLOAD_BYTES,
        files: 1,
        fields,
        parts,
        fieldNameSize: policy.MULTIPART_MAX_FIELD_NAME_CHARS,
        fieldSize: policy.MULTIPART_MAX_FIELD_BYTES,
        fieldNestingDepth: 0
    });
}

function createUpload(limits) {
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
                if (error) callback(error);
                else callback(null, { destination: workspace.directory, filename, path: target, size });
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

async function assertPersistedUpload(file, maximumBytes) {
    if (!file?.path || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maximumBytes) {
        const error = new Error('Uploaded file exceeds the allowed resource envelope.');
        error.code = 'UPLOAD_RESOURCE_LIMIT_EXCEEDED';
        error.status = 413;
        throw error;
    }
    const stats = await fs.lstat(file.path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== file.size || stats.size > maximumBytes) {
        const error = new Error('Persisted upload did not match received bytes.');
        error.code = 'UPLOAD_RESOURCE_LIMIT_EXCEEDED';
        error.status = 413;
        throw error;
    }
}

function safeUploadError(error) {
    if (
        error?.name === 'MulterError'
        || error?.code === 'UNSUPPORTED_FILE_FORMAT'
        || error?.code === 'UPLOAD_STORAGE_ERROR'
        || error?.code === 'UPLOAD_TOTAL_TIMEOUT'
        || error?.code === 'UPLOAD_RESOURCE_LIMIT_EXCEEDED'
    ) return error;
    const normalized = new Error('Invalid multipart upload.');
    if (error?.code === 'ECONNRESET' || error?.code === 'EPIPE' || error?.code === 'ABORT_ERR') {
        normalized.code = 'UPLOAD_REQUEST_ABORTED';
        normalized.status = 400;
    } else if (error?.code && /^(?:EACCES|EPERM|ENOENT|ENOSPC|EROFS|EIO|EMFILE|ENFILE)$/.test(error.code)) {
        normalized.code = 'UPLOAD_STORAGE_ERROR';
        normalized.status = 500;
    } else {
        normalized.code = 'MALFORMED_MULTIPART_REQUEST';
        normalized.status = 400;
    }
    return normalized;
}

function workspaceAllocationError() {
    const error = new Error('Upload workspace could not be allocated.');
    error.code = 'WORKSPACE_ALLOCATION_FAILED';
    error.status = 500;
    return error;
}

async function finalizeLifecycle(context) {
    const { workspace, req, cleanupWorkspace, detach, reportCleanupFailure, observer, engine, originalError } = context;
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
        await Promise.resolve(observer({ engine, workspace, error: originalError, cleanupError }));
    } catch (error) {
        // A test/telemetry observer is not an owner and cannot alter request settlement.
    }
    return cleanupError;
}

/**
 * Build the default router with injectable lifecycle seams for deterministic tests.
 */
function createSliceRouter(options = {}) {
    const router = express.Router();
    const rateLimiter = options.rateLimiter || sliceRateLimiter;
    const authenticate = options.authenticate || requireSliceService;
    const allocate = options.createWorkspace || createJobWorkspace;
    const attach = options.attachWorkspace || attachWorkspaceToRequest;
    const detach = options.detachWorkspace || detachWorkspaceFromRequest;
    const cleanupWorkspace = options.cleanupWorkspace || ((workspace) => workspace.cleanup());
    const observer = options.onLifecycleSettled || (() => {});
    const reportCleanupFailure = options.reportCleanupFailure || ((event) => {
        console.error('[CLEANUP] Slice workspace cleanup was incomplete.', event);
    });
    const handlers = {
        prusa: options.handlePrusa || handleSlicePrusa,
        orca: options.handleOrca || handleSliceOrca
    };
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const multipartLimits = options.multipartLimits || resolveMultipartLimits(options.env || process.env);
    const upload = options.upload || createUpload(multipartLimits);

    function lifecycle(engine) {
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
                try {
                    await runUploadWithinDeadline(
                        upload.single('choosenFile'),
                        req,
                        res,
                        policy.UPLOAD_TOTAL_TIMEOUT_MS,
                        options.timers
                    );
                    if (req.file) await assertPersistedUpload(req.file, multipartLimits.fileSize);
                } catch (error) {
                    throw safeUploadError(error);
                }
                await handlers[engine](req, res);
            } catch (error) {
                originalError = error;
            } finally {
                cleanupError = await finalizeLifecycle({
                    workspace, req, cleanupWorkspace, detach, reportCleanupFailure,
                    observer, engine, originalError
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
    }

    // Rate limiting and authentication must reject before request-owned allocation.
    router.post('/prusa/slice', rateLimiter, authenticate, lifecycle('prusa'));
    router.post('/orca/slice', rateLimiter, authenticate, lifecycle('orca'));
    return router;
}

const router = createSliceRouter();

module.exports = router;
module.exports.createSliceRouter = createSliceRouter;
module.exports.resolveMultipartLimits = resolveMultipartLimits;
module.exports.safeUploadError = safeUploadError;
module.exports.assertPersistedUpload = assertPersistedUpload;
module.exports.runUploadWithinDeadline = runUploadWithinDeadline;
