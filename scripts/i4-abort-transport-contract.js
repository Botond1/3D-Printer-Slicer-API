'use strict';

const ABORT_TRANSPORT_REPRESENTATIONS = Object.freeze([
    'abort_exception',
    'terminal_response',
    'transport_close'
]);

const ABORT_TRANSPORT_FAILURES = Object.freeze([
    'abort_signal_not_set',
    'abort_request_timeout',
    'abort_success_response',
    'abort_terminal_response_unbounded',
    'abort_transport_unexpected'
]);

function evaluateAbortTransport(signalAborted, outcome) {
    if (signalAborted !== true) {
        return { ok: false, reason: 'abort_signal_not_set' };
    }
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
        return { ok: false, reason: 'abort_transport_unexpected' };
    }
    if (outcome.timedOut === true) {
        return { ok: false, reason: 'abort_request_timeout' };
    }

    const hasError = Object.hasOwn(outcome, 'error');
    const hasResponse = Object.hasOwn(outcome, 'response');
    if (hasError === hasResponse) {
        return { ok: false, reason: 'abort_transport_unexpected' };
    }
    if (hasError) {
        const name = outcome.error?.name;
        if (name === 'AbortError') {
            return { ok: true, representation: 'abort_exception' };
        }
        if (name === 'TypeError') {
            return { ok: true, representation: 'transport_close' };
        }
        return { ok: false, reason: 'abort_transport_unexpected' };
    }

    const status = outcome.response?.status;
    if (!Number.isSafeInteger(status) || typeof outcome.text !== 'string') {
        return { ok: false, reason: 'abort_transport_unexpected' };
    }
    if (Buffer.byteLength(outcome.text, 'utf8') > 65_536) {
        return { ok: false, reason: 'abort_terminal_response_unbounded' };
    }
    if (status >= 200 && status <= 299) {
        return { ok: false, reason: 'abort_success_response' };
    }
    if (status >= 400 && status <= 599) {
        return { ok: true, representation: 'terminal_response' };
    }
    return { ok: false, reason: 'abort_transport_unexpected' };
}

module.exports = {
    ABORT_TRANSPORT_FAILURES,
    ABORT_TRANSPORT_REPRESENTATIONS,
    evaluateAbortTransport
};
