/** Idempotent request/response disconnect to AbortSignal binding. */

const REQUEST_ABORT_BINDING = Symbol('sliceRequestAbortBinding');
const SOCKET_ABORT_CODES = new Set([
    'ABORT_ERR',
    'ECONNABORTED',
    'ECONNRESET',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE'
]);

function createRequestAbortError(cause) {
    const error = new Error('Client connection closed before slice completion.');
    error.name = 'AbortError';
    error.code = 'REQUEST_ABORTED';
    if (cause instanceof Error) error.cause = cause;
    return error;
}

function isRelevantSocketError(error) {
    return !error?.code || SOCKET_ABORT_CODES.has(error.code);
}

function isResponseWritable(res) {
    return Boolean(res)
        && !res.destroyed
        && !res.closed
        && !res.writableEnded
        && !res.headersSent;
}

function addListener(registrations, emitter, event, listener) {
    if (typeof emitter?.once !== 'function') return;
    emitter.once(event, listener);
    registrations.push(() => emitter.removeListener(event, listener));
}

function isPreDisconnected(req, res) {
    return Boolean(
        req?.aborted
        || (req?.destroyed && req?.complete !== true)
        || req?.socket?.destroyed
        || res?.destroyed
        || res?.closed
    );
}

/**
 * Bind one disconnect signal to an uploaded slice request.
 * @param {object} req Node request.
 * @param {object} res Node response.
 * @returns {{signal: AbortSignal, dispose: () => void}} Shared binding.
 */
function bindRequestAbort(req, res) {
    if (req?.[REQUEST_ABORT_BINDING]) return req[REQUEST_ABORT_BINDING];
    const controller = new AbortController();
    const registrations = [];
    let disposed = false;
    let responseFinished = Boolean(res?.writableFinished);
    let binding;

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const remove of registrations.splice(0)) remove();
        if (req?.[REQUEST_ABORT_BINDING] === binding) delete req[REQUEST_ABORT_BINDING];
    };
    const abort = (cause) => {
        if (controller.signal.aborted || responseFinished) return;
        controller.abort(createRequestAbortError(cause));
        dispose();
    };
    const onFinish = () => {
        responseFinished = true;
        dispose();
    };
    const onClose = () => {
        if (responseFinished || res?.writableFinished) return onFinish();
        abort();
    };
    const onError = (error) => {
        if (isRelevantSocketError(error)) abort(error);
    };

    binding = Object.freeze({ signal: controller.signal, dispose });
    if (req) req[REQUEST_ABORT_BINDING] = binding;
    if (responseFinished) {
        dispose();
        return binding;
    }
    if (isPreDisconnected(req, res)) {
        abort();
        return binding;
    }
    addListener(registrations, req, 'aborted', abort);
    addListener(registrations, req, 'error', onError);
    addListener(registrations, req?.socket, 'error', onError);
    addListener(registrations, res, 'finish', onFinish);
    addListener(registrations, res, 'close', onClose);
    addListener(registrations, res, 'error', onError);
    return binding;
}

module.exports = {
    bindRequestAbort,
    isResponseWritable
};
