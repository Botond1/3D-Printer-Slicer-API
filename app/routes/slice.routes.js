/** Slice route definition and request-owned upload lifecycle. */

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULTS, EXTENSIONS } = require('../config/constants');
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

const MULTIPART_DEFAULTS = Object.freeze({
    fields: 40,
    parts: 42,
    fieldNameSize: 64,
    fieldSize: 65_536
});

function strictBoundedInteger(value, fallback, minimum, maximum) {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value);
    if (!/^[1-9]\d*$/.test(text)) return fallback;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

/** Resolve the finite multipart envelope. Invalid overrides fail back to safe defaults. */
function resolveMultipartLimits(env = process.env) {
    const fields = strictBoundedInteger(env.MULTIPART_MAX_FIELDS, MULTIPART_DEFAULTS.fields, 35, 64);
    const defaultParts = Math.max(MULTIPART_DEFAULTS.parts, fields + 2);
    const parts = strictBoundedInteger(env.MULTIPART_MAX_PARTS, defaultParts, fields + 2, 66);
    return Object.freeze({
        fileSize: strictBoundedInteger(env.MAX_UPLOAD_BYTES, DEFAULTS.MAX_UPLOAD_BYTES, 1, DEFAULTS.MAX_UPLOAD_BYTES),
        files: 1,
        fields,
        parts,
        fieldNameSize: strictBoundedInteger(
            env.MULTIPART_MAX_FIELD_NAME_CHARS,
            MULTIPART_DEFAULTS.fieldNameSize,
            20,
            256
        ),
        fieldSize: strictBoundedInteger(
            env.MULTIPART_MAX_FIELD_BYTES,
            MULTIPART_DEFAULTS.fieldSize,
            1_024,
            1_048_576
        ),
        fieldNestingDepth: 0
    });
}

function createUpload(limits) {
    const storage = multer.diskStorage({
        destination(req, file, callback) {
            const workspace = getRequestWorkspace(req);
            if (!workspace?.directory) {
                const error = new Error('Upload workspace is unavailable.');
                error.code = 'UPLOAD_STORAGE_ERROR';
                return callback(error);
            }
            return callback(null, workspace.directory);
        },
        filename(req, file, callback) {
            // Multer's random filename is server-generated and does not disclose user input.
            return callback(null, `${Date.now()}-${randomUUID()}`);
        }
    });
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

function safeUploadError(error) {
    if (
        error?.name === 'MulterError'
        || error?.code === 'UNSUPPORTED_FILE_FORMAT'
        || error?.code === 'UPLOAD_STORAGE_ERROR'
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
    const upload = options.upload || createUpload(options.multipartLimits || resolveMultipartLimits(options.env));

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
                    await runMiddleware(upload.single('choosenFile'), req, res);
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
