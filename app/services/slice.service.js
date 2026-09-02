/** Queue-aware public slicing handlers with contained pipeline delegation. */

const { getClientIp } = require('../utils/client-ip');
const { enqueueSliceJob, toQueueErrorResponse } = require('./slice/queue');
const {
    processSlice,
    appendOriginalExtensionToUpload,
    resolveRequestOrResponse
} = require('./slice/pipeline');
const { resolveProfileSelection } = require('./slice/profiles');
const { getRequestWorkspace } = require('./slice/workspace');
const { bindRequestAbort, isResponseWritable } = require('./slice/request-abort');
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
        return res.status(queueErrorResponse.status).json(queueErrorResponse.body);
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
 * from; anonymous or shared-key traffic keeps the historical client-IP key.
 * @param {import('express').Request} req Express request.
 * @param {(req: object) => string} resolveClientIp Client IP resolver.
 * @returns {string} Queue fairness key.
 */
function resolveQueueKey(req, resolveClientIp) {
    const slot = req?.slicePrincipal?.slot;
    if (typeof slot === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(slot)) {
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

function createSliceHandlers(options = {}) {
    const enqueue = options.enqueueSliceJobImpl || enqueueSliceJob;
    const process = options.processSliceImpl || processSlice;
    const resolveClientIp = options.getClientIpImpl || getClientIp;
    const bindAbort = options.bindRequestAbortImpl || bindRequestAbort;
    const setAbortSignal = options.setResponseAbortSignalImpl || setResponseAbortSignal;
    // A caller that replaces the pipeline owns its own validation contract.
    const preValidate = options.validateSliceRequestImpl
        || (options.processSliceImpl ? () => null : preValidateSliceRequest);

    async function handle(req, res, forcedTechnology, engine) {
        const binding = bindAbort(req, res);
        let result;
        let queueError;
        let settlementError;
        setAbortSignal(res, binding.signal);
        try {
            const earlyResponse = preValidate(req, res, { forcedTechnology, engine });
            if (earlyResponse) {
                result = earlyResponse;
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
