/** Queue-aware public slicing handlers with contained pipeline delegation. */

const { getClientIp } = require('../utils/client-ip');
const { SHARED_SLOT } = require('../middleware/requireAudience');
const { enqueueSliceJob, sendQueueErrorResponse, toQueueErrorResponse } = require('./slice/queue');
const {
    processSlice,
    appendOriginalExtensionToUpload,
    resolveRequestOrResponse
} = require('./slice/pipeline');
const { resolveProfileSelection } = require('./slice/profiles');
const { getRequestWorkspace } = require('./slice/workspace');
const { bindRequestAbort, isResponseWritable } = require('./slice/request-abort');
const { getDefaultAsyncSliceJobStore } = require('./slice/async-jobs');
const { prefersRespondAsync, submitAsyncSlice } = require('./slice/async-slice');
const { preflightArchive, sendPreflightRefusal } = require('./slice/archive-preflight');
const {
    resolveSliceOutputTargets,
    assertValidContainedArtifact
} = require('./slice/output-lifecycle');
const {
    writeJsonAndWaitForFinish,
    setResponseAbortSignal,
    setResponseSettlement,
    awaitResponseSettlement
} = require('./slice/response-lifecycle');

function createQueueErrorResponse(err, res) {
    const queueErrorResponse = toQueueErrorResponse(err);
    if (queueErrorResponse) {
        // Applies the mapping's headers too, so SLICE_QUEUE_CLIENT_LIMIT carries
        // Retry-After alongside retryAfterSeconds exactly like the rate limiter.
        return sendQueueErrorResponse(res, queueErrorResponse);
    }
    return res.status(500).json({
        success: false,
        error: 'Queue processing failed.',
        errorCode: 'QUEUE_INTERNAL_ERROR'
    });
}

function isResponseDisconnected(res) {
    return Boolean(res?.destroyed || res?.closed || res?.writableEnded);
}

async function safelyAwaitResponseSettlement(req, res, binding, queueError) {
    try {
        await awaitResponseSettlement(req);
        return null;
    } catch (error) {
        if (binding.signal.aborted || isResponseDisconnected(res) || error === queueError) return null;
        return error;
    }
}

/**
 * Resolve the per-client fairness key. An authenticated slice principal (a
 * WooCommerce or LeadPilot key slot attached as `req.slicePrincipal.slot` by
 * the authentication middleware) shares one key across every address it calls
 * from. The shared compatibility slot (`SHARED_SLOT`, used by the default
 * `legacy` mode and by shared-key callers during `migration`) is anonymous:
 * every shared-key caller keeps the historical client-IP key, so
 * `MAX_SLICE_QUEUE_PER_IP` never collapses into one global cap.
 * @param {import('express').Request} req Express request.
 * @param {(req: object) => string} resolveClientIp Client IP resolver.
 * @returns {string} Queue fairness key.
 */
function resolveQueueKey(req, resolveClientIp) {
    const slot = req?.slicePrincipal?.slot;
    if (typeof slot === 'string' && slot !== SHARED_SLOT && /^[A-Za-z0-9_.:-]{1,64}$/.test(slot)) {
        return `principal:${slot}`;
    }
    return resolveClientIp(req);
}

/**
 * Validate the upload, request options, and profile selection BEFORE the
 * request is admitted to the slice queue, so an invalid request answers 400
 * without ever consuming a queue slot. The full pipeline re-runs the same
 * parsers afterwards; they are pure and cheap.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {{forcedTechnology: 'FDM'|'SLA'|null, engine: 'prusa'|'orca'|'bambu'}} options Endpoint options.
 * @returns {import('express').Response|null} A settled error response, or null when the request may be queued.
 */
function preValidateSliceRequest(req, res, options) {
    const workspace = getRequestWorkspace(req);
    if (!workspace) return null;
    const resolved = resolveRequestOrResponse(req, res, options, workspace);
    if (resolved.response) return resolved.response;
    const { request } = resolved;
    const selection = resolveProfileSelection(
        request.engine,
        request.technology,
        request.layerHeight,
        request.profileOverrides,
        request.material
    );
    if (!selection.isValid) {
        return res.status(selection.status).json(selection.response);
    }
    return null;
}

/**
 * Run the pre-queue archive preflight of a direct `.3mf` upload (3.9.0
 * §4.4) after the option validation and before any queue place. A refusal
 * is answered here, synchronously, also for `Prefer: respond-async`.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {(req: object, options?: object) => Promise<unknown>} preflight Preflight implementation.
 * @param {AbortSignal} [signal] Request abort signal.
 * @returns {Promise<import('express').Response|undefined|null>} A settled response (or `undefined` when the client left), or null when the request may be queued.
 */
async function runArchivePreflight(req, res, preflight, signal) {
    try {
        await preflight(req, { signal });
        return null;
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError' || !isResponseWritable(res)) return undefined;
        return sendPreflightRefusal(error, res);
    }
}

function createSliceHandlers(options = {}) {
    const enqueue = options.enqueueSliceJobImpl || enqueueSliceJob;
    const process = options.processSliceImpl || processSlice;
    const resolveClientIp = options.getClientIpImpl || getClientIp;
    const bindAbort = options.bindRequestAbortImpl || bindRequestAbort;
    const setAbortSignal = options.setResponseAbortSignalImpl || setResponseAbortSignal;
    // A caller that replaces the pipeline owns its own validation contract.
    const preValidate = options.validateSliceRequestImpl
        || (options.processSliceImpl ? () => null : preValidateSliceRequest);
    // The archive preflight follows the same rule; `null` turns it off.
    const preflight = options.preflightArchiveImpl !== undefined
        ? options.preflightArchiveImpl
        : (options.processSliceImpl ? null : preflightArchive);

    /**
     * Option validation, then the archive preflight, ahead of the
     * asynchronous submission (whose own validation then runs again on the
     * same pure parsers). A throwing validator is left to the submission,
     * which answers it exactly as before.
     */
    async function preflightBeforeAsync(req, res, forcedTechnology, engine) {
        if (!preflight) return null;
        let early;
        try {
            early = preValidate(req, res, { forcedTechnology, engine });
        } catch {
            return null;
        }
        if (early) return early;
        return runArchivePreflight(req, res, preflight);
    }
    // `null` disables the asynchronous mode; the default store is created on
    // the first asynchronous submission from the validated resource policy.
    const resolveAsyncStore = () => (options.asyncJobStore === undefined
        ? getDefaultAsyncSliceJobStore()
        : options.asyncJobStore);

    function submitAsync(req, res, forcedTechnology, engine, store) {
        return submitAsyncSlice(req, res, {
            store, forcedTechnology, engine, preValidate, enqueue, process, bindAbort,
            setAbortSignal,
            queueKey: resolveQueueKey(req, resolveClientIp),
            createQueueErrorResponse,
            awaitResponseSettlement
        });
    }

    async function handle(req, res, forcedTechnology, engine) {
        // Async contract v1 is offered on /bambu/slice only; without the
        // header (or on another engine) the synchronous path below is unchanged.
        if (engine === 'bambu' && prefersRespondAsync(req)) {
            const store = resolveAsyncStore();
            if (store) {
                const refused = await preflightBeforeAsync(req, res, forcedTechnology, engine);
                if (refused !== null) return refused;
                return submitAsync(req, res, forcedTechnology, engine, store);
            }
        }
        const binding = bindAbort(req, res);
        let result;
        let queueError;
        let settlementError;
        setAbortSignal(res, binding.signal);
        try {
            const earlyResponse = preValidate(req, res, { forcedTechnology, engine });
            const refused = earlyResponse || !preflight
                ? null
                : await runArchivePreflight(req, res, preflight, binding.signal);
            if (earlyResponse) {
                result = earlyResponse;
            } else if (refused !== null) {
                result = refused;
            } else {
                const clientQueueKey = resolveQueueKey(req, resolveClientIp);
                result = await enqueue(
                    (effectiveSignal) => {
                        const taskSignal = effectiveSignal || binding.signal;
                        setAbortSignal(res, taskSignal);
                        return process(req, res, { forcedTechnology, engine, signal: taskSignal });
                    },
                    { queueKey: clientQueueKey, signal: binding.signal }
                );
            }
        } catch (err) {
            queueError = err;
            if (isResponseWritable(res) && !binding.signal.aborted) {
                result = createQueueErrorResponse(err, res);
            }
        } finally {
            settlementError = await safelyAwaitResponseSettlement(req, res, binding, queueError);
            setAbortSignal(res, null);
            binding.dispose();
        }
        if (settlementError) throw settlementError;
        if (queueError && result === undefined && !binding.signal.aborted && !isResponseDisconnected(res)) {
            throw queueError;
        }
        return result;
    }

    return {
        handleSlicePrusa: (req, res) => handle(req, res, null, 'prusa'),
        handleSliceOrca: (req, res) => handle(req, res, 'FDM', 'orca'),
        handleSliceBambu: (req, res) => handle(req, res, 'FDM', 'bambu')
    };
}

const { handleSlicePrusa, handleSliceOrca, handleSliceBambu } = createSliceHandlers();

module.exports = {
    handleSlicePrusa,
    handleSliceOrca,
    handleSliceBambu,
    createSliceHandlers,
    preValidateSliceRequest,
    processSlice,
    resolveQueueKey,
    appendOriginalExtensionToUpload,
    resolveSliceOutputTargets,
    assertValidContainedArtifact,
    writeJsonAndWaitForFinish,
    setResponseAbortSignal,
    setResponseSettlement,
    awaitResponseSettlement
};
