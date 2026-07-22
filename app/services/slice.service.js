/** Queue-aware public slicing handlers with contained pipeline delegation. */

const { getClientIp } = require('../utils/client-ip');
const { enqueueSliceJob, toQueueErrorResponse } = require('./slice/queue');
const { processSlice, appendOriginalExtensionToUpload } = require('./slice/pipeline');
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

function createSliceHandlers(options = {}) {
    const enqueue = options.enqueueSliceJobImpl || enqueueSliceJob;
    const process = options.processSliceImpl || processSlice;
    const resolveClientIp = options.getClientIpImpl || getClientIp;
    const bindAbort = options.bindRequestAbortImpl || bindRequestAbort;
    const setAbortSignal = options.setResponseAbortSignalImpl || setResponseAbortSignal;

    async function handle(req, res, forcedTechnology, engine) {
        const binding = bindAbort(req, res);
        let result;
        let queueError;
        let settlementError;
        setAbortSignal(res, binding.signal);
        try {
            const clientQueueKey = resolveClientIp(req);
            result = await enqueue(
                (effectiveSignal) => {
                    const taskSignal = effectiveSignal || binding.signal;
                    setAbortSignal(res, taskSignal);
                    return process(req, res, { forcedTechnology, engine, signal: taskSignal });
                },
                { queueKey: clientQueueKey, signal: binding.signal }
            );
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
        handleSliceOrca: (req, res) => handle(req, res, 'FDM', 'orca')
    };
}

const { handleSlicePrusa, handleSliceOrca } = createSliceHandlers();

module.exports = {
    handleSlicePrusa,
    handleSliceOrca,
    createSliceHandlers,
    processSlice,
    appendOriginalExtensionToUpload,
    resolveSliceOutputTargets,
    assertValidContainedArtifact,
    writeJsonAndWaitForFinish,
    setResponseAbortSignal,
    setResponseSettlement,
    awaitResponseSettlement
};
