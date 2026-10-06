'use strict';

/** OpenAPI for asynchronous Bambu slice jobs (`Prefer: respond-async`, async contract v1). */

const SLICE_SERVICE_HEADER = Object.freeze({
    name: 'x-slicer-api-key',
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description: 'Scoped slice-service API credential.'
});

const PREFER_HEADER = Object.freeze({
    name: 'Prefer',
    in: 'header',
    required: false,
    schema: { type: 'string', example: 'respond-async' },
    description: 'RFC 7240. `respond-async` asks for an asynchronous job: once every pre-pipeline check passed and the slice queue admitted the job, the answer is 202 with a status URL instead of the slice result. Without it the endpoint is synchronous and unchanged. Clients must handle both a 202 and a synchronous answer to the same request.'
});

const JOB_ID_SCHEMA = Object.freeze({
    type: 'string',
    pattern: '^sj_[a-f0-9]{32}$',
    description: '`sj_` followed by 128 random bits as 32 lowercase hex characters.'
});

const ASYNC_CONTRACT_SCHEMA = Object.freeze({ type: 'integer', enum: [1] });

const ACCEPTED_SCHEMA = Object.freeze({
    type: 'object',
    required: ['success', 'async_contract', 'job_id', 'status', 'status_url', 'poll_after_ms', 'deadline_at', 'deadline_ms'],
    properties: {
        success: { type: 'boolean', enum: [true] },
        async_contract: ASYNC_CONTRACT_SCHEMA,
        job_id: JOB_ID_SCHEMA,
        status: { type: 'string', enum: ['queued'] },
        status_url: { type: 'string', description: 'Relative URL of the job status, equal to the Location header.' },
        poll_after_ms: { type: 'integer', minimum: 1 },
        deadline_at: { type: 'string', format: 'date-time', description: 'Admission time plus ASYNC_SLICE_DEADLINE_MS (UTC).' },
        deadline_ms: { type: 'integer', minimum: 60000, maximum: 1800000 }
    }
});

const PENDING_SCHEMA = Object.freeze({
    type: 'object',
    required: ['success', 'async_contract', 'job_id', 'status', 'queue_position', 'elapsed_ms', 'deadline_at', 'poll_after_ms'],
    properties: {
        success: { type: 'boolean', enum: [true] },
        async_contract: ASYNC_CONTRACT_SCHEMA,
        job_id: JOB_ID_SCHEMA,
        status: { type: 'string', enum: ['queued', 'running'] },
        queue_position: { type: 'integer', minimum: 1, nullable: true, description: '1 = next to start; null while running.' },
        elapsed_ms: { type: 'integer', minimum: 0 },
        deadline_at: { type: 'string', format: 'date-time' },
        poll_after_ms: { type: 'integer', minimum: 1 }
    }
});

const COMPLETED_SCHEMA = Object.freeze({
    type: 'object',
    required: ['success', 'async_contract', 'job_id', 'status', 'elapsed_ms', 'result_status', 'result'],
    properties: {
        success: { type: 'boolean', enum: [true] },
        async_contract: ASYNC_CONTRACT_SCHEMA,
        job_id: JOB_ID_SCHEMA,
        status: { type: 'string', enum: ['completed'] },
        elapsed_ms: { type: 'integer', minimum: 0 },
        result_status: {
            type: 'integer',
            description: 'The HTTP status the synchronous request would have answered (200, 400, 422, 500, 503, 504 with `SLICE_DEADLINE_EXCEEDED`, ...).'
        },
        result_retry_after_seconds: {
            type: 'integer',
            minimum: 1,
            description: 'Present only when the synchronous answer would have carried Retry-After.'
        },
        result: {
            type: 'object',
            additionalProperties: true,
            description: 'The exact JSON body the synchronous `POST /bambu/slice` would have answered: the success body with `technical_receipt`, or the error body with `errorCode`. A job past ASYNC_SLICE_DEADLINE_MS completes with result_status 504 and `{"success": false, "error": "...", "errorCode": "SLICE_DEADLINE_EXCEEDED"}`; its native process tree is terminated.'
        }
    }
});

function jsonError(description, errorCodes) {
    return {
        description,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['success', 'error', 'errorCode'],
                    properties: {
                        success: { type: 'boolean', enum: [false] },
                        error: { type: 'string' },
                        errorCode: { type: 'string', enum: errorCodes }
                    }
                }
            }
        }
    };
}

const NO_STORE_HEADER = Object.freeze({ schema: { type: 'string', enum: ['no-store'] } });
const RETRY_AFTER_HEADER = Object.freeze({ schema: { type: 'integer', minimum: 1 } });

function createAcceptedResponse() {
    return {
        description: 'Asynchronous job admitted (`Prefer: respond-async`). Poll the Location until `status` is `completed`. A disconnect after this answer never aborts the job.',
        headers: {
            Location: { schema: { type: 'string', pattern: '^/bambu/slice/jobs/sj_[a-f0-9]{32}$' } },
            'Preference-Applied': { schema: { type: 'string', enum: ['respond-async'] } },
            'Retry-After': RETRY_AFTER_HEADER,
            'Cache-Control': NO_STORE_HEADER
        },
        content: { 'application/json': { schema: ACCEPTED_SCHEMA } }
    };
}

const NOT_FOUND = jsonError(
    'Unknown, expired (past ASYNC_SLICE_RESULT_TTL_MS), cancelled, evicted, lost to a restart, submitted by another principal, or malformed job id. The cases are indistinguishable.',
    ['SLICE_JOB_NOT_FOUND']
);

const UNAUTHORIZED = jsonError('Slice service authentication is required.', ['SLICE_SERVICE_AUTH_REQUIRED']);

const RATE_LIMITED = jsonError(
    'Per-client-IP job status rate limit reached (its own bucket, separate from slice submissions). Carries Retry-After and retryAfterSeconds.',
    ['RATE_LIMIT_EXCEEDED']
);

function jobOperation(summary, description, responses) {
    return {
        tags: ['Slicing'],
        summary,
        description,
        security: [{ SliceServiceApiKey: [] }],
        parameters: [
            { ...SLICE_SERVICE_HEADER },
            { name: 'job_id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { ...responses, 401: UNAUTHORIZED, 404: NOT_FOUND, 429: RATE_LIMITED }
    };
}

function createSliceJobPaths() {
    return {
        '/bambu/slice/jobs/{job_id}': {
            get: jobOperation(
                'Asynchronous Bambu slice job status.',
                'Same x-slicer-api-key authentication as the submission; a job is visible only to the principal (rotation family) that submitted it. Always `Cache-Control: no-store`. Jobs live in process memory: a restart loses them and this answers 404, after which a client may resubmit.',
                {
                    200: {
                        description: 'Pending (`queued` / `running`, with Retry-After) or `completed` with the synchronous result.',
                        headers: { 'Cache-Control': NO_STORE_HEADER, 'Retry-After': RETRY_AFTER_HEADER },
                        content: { 'application/json': { schema: { oneOf: [PENDING_SCHEMA, COMPLETED_SCHEMA] } } }
                    }
                }
            ),
            delete: jobOperation(
                'Cancel an asynchronous Bambu slice job.',
                'Removes a queued job, terminates the native process tree of a running one, or discards a finished result. A later GET answers 404.',
                { 204: { description: 'Cancelled, or the finished result was discarded.' } }
            )
        }
    };
}

module.exports = {
    PREFER_HEADER,
    createAcceptedResponse,
    createSliceJobPaths
};
