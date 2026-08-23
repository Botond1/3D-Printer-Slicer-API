/** Response settlement ownership kept outside the native slicing queue slot. */

const SLICE_RESPONSE_SETTLEMENT = Symbol('sliceResponseSettlement');
const SLICE_RESPONSE_ABORT_SIGNAL = Symbol('sliceResponseAbortSignal');

function abortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error('Slice response was aborted.');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

function setResponseAbortSignal(res, signal) {
    if (!res) return;
    if (signal) res[SLICE_RESPONSE_ABORT_SIGNAL] = signal;
    else delete res[SLICE_RESPONSE_ABORT_SIGNAL];
}

function writeJsonAndWaitForFinish(res, payload) {
    const signal = res?.[SLICE_RESPONSE_ABORT_SIGNAL];
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (res.destroyed || res.closed || res.writableEnded) {
        const error = new Error('Response closed before completion.');
        error.code = 'RESPONSE_WRITE_FAILED';
        return Promise.reject(error);
    }
    if (typeof res.once !== 'function') {
        if (signal?.aborted) return Promise.reject(abortReason(signal));
        res.json(payload);
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
            const error = new Error('Response closed before completion.');
            error.code = 'RESPONSE_WRITE_FAILED';
            return finish(reject, error);
        };
        const onError = () => {
            const error = new Error('Response could not be written.');
            error.code = 'RESPONSE_WRITE_FAILED';
            finish(reject, error);
        };
        const onAbort = () => finish(reject, abortReason(signal));

        res.once('finish', onFinish);
        res.once('close', onClose);
        res.once('error', onError);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) return onAbort();
        if (res.destroyed || res.closed || res.writableEnded) return onClose();
        try {
            res.json(payload);
        } catch (error) {
            finish(reject, error);
        }
    });
}

function setResponseSettlement(req, settlement) {
    req[SLICE_RESPONSE_SETTLEMENT] = Promise.resolve(settlement);
}

async function awaitResponseSettlement(req) {
    const settlement = req?.[SLICE_RESPONSE_SETTLEMENT];
    if (req) delete req[SLICE_RESPONSE_SETTLEMENT];
    if (settlement) await settlement;
}

module.exports = {
    writeJsonAndWaitForFinish,
    setResponseAbortSignal,
    setResponseSettlement,
    awaitResponseSettlement
};
