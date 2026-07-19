/** Queue-aware public slicing handlers with contained pipeline delegation. */

const { getClientIp } = require('../utils/client-ip');
const { enqueueSliceJob, toQueueErrorResponse } = require('./slice/queue');
const { processSlice, appendOriginalExtensionToUpload } = require('./slice/pipeline');
const {
    resolveSliceOutputTargets,
    assertValidContainedArtifact
} = require('./slice/output-lifecycle');
const {
    writeJsonAndWaitForFinish,
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

function createSliceHandlers(options = {}) {
    const enqueue = options.enqueueSliceJobImpl || enqueueSliceJob;
    const process = options.processSliceImpl || processSlice;
    const resolveClientIp = options.getClientIpImpl || getClientIp;

    async function handle(req, res, forcedTechnology, engine) {
        let result;
        try {
            const clientQueueKey = resolveClientIp(req);
            result = await enqueue(
                () => process(req, res, { forcedTechnology, engine }),
                { queueKey: clientQueueKey }
            );
        } catch (err) {
            return createQueueErrorResponse(err, res);
        }
        await awaitResponseSettlement(req);
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
    setResponseSettlement,
    awaitResponseSettlement
};
