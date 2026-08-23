'use strict';

const { emitEvent } = require('../services/observability/events');

function logError(errorData) {
    return emitEvent('request.rejected', {
        request_id: errorData?.requestId,
        job_id: errorData?.jobId,
        outcome: 'rejected',
        error_code: errorData?.errorCode || 'INTERNAL_PROCESSING_ERROR'
    });
}

module.exports = {
    emitEvent,
    logError
};
