'use strict';

/**
 * OpenAPI for the 3.9.0 production-model export (§2.2–2.3) and feature
 * detection (§2.1). Every route here exists only on 3.9.0+; the export routes
 * answer 404 `ROUTE_NOT_FOUND` while `EXPORT_ROUTE_ENABLED` is off.
 */

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
    description: 'RFC 7240. `respond-async` returns 202 with an `ex_` job once every pre-queue check passed; every pre-queue refusal is still answered synchronously.'
});

const REQUEST_ID_HEADER = Object.freeze({
    name: 'X-Request-Id',
    in: 'header',
    required: false,
    schema: { type: 'string' },
    description: 'Optional; echoed on the answer.'
});

const HEX64 = Object.freeze({ type: 'string', pattern: '^[a-f0-9]{64}$' });
const EXPORT_JOB_ID = Object.freeze({
    type: 'string',
    pattern: '^ex_[a-f0-9]{32}$',
    description: '`ex_` followed by 32 lowercase hex characters; never matches the slice job pattern `sj_`.'
});
const AXES3 = Object.freeze({
    type: 'object',
    required: ['x', 'y', 'z'],
    properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }
});
const NO_STORE_HEADER = Object.freeze({ schema: { type: 'string', enum: ['no-store'] } });
const RETRY_AFTER_HEADER = Object.freeze({ schema: { type: 'integer', minimum: 1 } });

function jsonError(description, errorCodes, extraProperties = {}) {
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
                        errorCode: { type: 'string', enum: errorCodes },
                        ...extraProperties
                    }
                }
            }
        }
    };
}

const UNAUTHORIZED = jsonError(
    'Slice service authentication failed. A request that carries `x-slicer-api-key` (even empty) always gets this 401, however many failures came before; once the source IP\'s failure bucket is spent it also carries Retry-After.',
    ['SLICE_SERVICE_AUTH_REQUIRED']
);

const RATE_LIMITED = jsonError(
    'The export bucket of the authenticated principal (6/min, burst 3; never the slice bucket), or, for a request with no key header at all, the per-IP authentication-failure bucket. Carries Retry-After.',
    ['RATE_LIMIT_EXCEEDED', 'EXPORT_QUEUE_FULL']
);

const JOB_RATE_LIMITED = jsonError(
    'Job-route bucket of the principal (shared with the slice job polls), or the keyless failure bucket. Carries Retry-After.',
    ['RATE_LIMIT_EXCEEDED']
);

const EXPORT_NOT_FOUND = jsonError(
    'Unknown, deleted, expired (15 min after completion), another principal\'s, or lost in a restart (resubmit). The cases are indistinguishable.',
    ['EXPORT_JOB_NOT_FOUND']
);

const EXPORT_HEADERS = Object.freeze({
    'Content-Disposition': { schema: { type: 'string', enum: ['attachment; filename="r3d-export.stl"', 'attachment; filename="r3d-export.3mf"'] } },
    'Cache-Control': NO_STORE_HEADER,
    'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
    'X-R3D-Export-Contract': { schema: { type: 'integer', enum: [1] } },
    'X-R3D-Export-Fidelity': { schema: { type: 'string', enum: ['exact', 'unverified'] } },
    'X-R3D-Export-Sha256': { schema: HEX64, description: 'sha256 of the body.' },
    'X-R3D-Sliced-Geometry-Sha256': { schema: HEX64, description: 'sha256 of the placed STL the export re-prepared.' },
    'X-R3D-Measurement-Generation': { schema: HEX64 },
    'X-R3D-Final-Dimensions-Mm': { schema: { type: 'string' }, description: '`x,y,z`, 3 dp.' },
    'X-R3D-Oriented-Dimensions-Mm': { schema: { type: 'string' }, description: '`x,y,z`, 3 dp.' },
    'X-R3D-Placement-Mm': { schema: { type: 'string' }, description: '`x_min,y_min`, 3 dp.' },
    'X-R3D-Orientation-Outcome': { schema: { type: 'string', enum: ['applied', 'unchanged', 'preserved', 'fallback_unmodified'] } },
    'X-R3D-Rotation-Matrix': { schema: { type: 'string' }, description: 'Nine values, 9 dp, row-major: the total rotation.' },
    'X-R3D-Volume-Mm3': { schema: { type: 'number' } },
    'X-Request-Id': { schema: { type: 'string' } }
});

const EXPORT_FILE_RESPONSE = Object.freeze({
    description: 'The production model. `stl`: the exact binary STL Bambu sliced (after placement), mm, Z up, min Z = 0. `3mf`: 3MF core, one object, one build item, the same float32 triangles, `r3d:` metadata. With fidelity `exact`, sha256 of an STL body equals the receipt\'s `source.sliced_geometry_sha256`.',
    headers: EXPORT_HEADERS,
    content: {
        'model/stl': { schema: { type: 'string', format: 'binary' } },
        'model/3mf': { schema: { type: 'string', format: 'binary' } }
    }
});

const ACCEPTED_SCHEMA = Object.freeze({
    type: 'object',
    required: ['success', 'export_contract', 'job_id', 'status', 'status_url', 'poll_after_ms', 'deadline_at', 'deadline_ms'],
    properties: {
        success: { type: 'boolean', enum: [true] },
        export_contract: { type: 'integer', enum: [1] },
        job_id: EXPORT_JOB_ID,
        status: { type: 'string', enum: ['queued'] },
        status_url: { type: 'string' },
        poll_after_ms: { type: 'integer', minimum: 1 },
        deadline_at: { type: 'string', format: 'date-time' },
        deadline_ms: { type: 'integer', minimum: 60000 }
    }
});

const RESULT_SCHEMA = Object.freeze({
    type: 'object',
    description: 'With result_status 200 the export facts below; otherwise the §2.2 error body.',
    properties: {
        success: { type: 'boolean' },
        fidelity: { type: 'string', enum: ['exact', 'unverified'] },
        format: { type: 'string', enum: ['stl', '3mf'] },
        media_type: { type: 'string', enum: ['model/stl', 'model/3mf'] },
        size_bytes: { type: 'integer', minimum: 1 },
        sha256: HEX64,
        sliced_geometry_sha256: HEX64,
        measurement_generation: HEX64,
        final_dimensions_mm: AXES3,
        oriented_dimensions_mm: AXES3,
        rotation_matrix: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, minItems: 3, maxItems: 3 },
        volume_mm3: { type: 'number' },
        placement_mm: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        orientation_outcome: { type: 'string', enum: ['applied', 'unchanged', 'preserved', 'fallback_unmodified'] },
        file_url: { type: 'string' },
        file_expires_at: { type: 'string', format: 'date-time' },
        error: { type: 'string' },
        errorCode: { type: 'string' }
    },
    additionalProperties: true
});

const STATUS_SCHEMA = Object.freeze({
    type: 'object',
    required: ['success', 'export_contract', 'job_id', 'status'],
    properties: {
        success: { type: 'boolean', enum: [true] },
        export_contract: { type: 'integer', enum: [1] },
        job_id: EXPORT_JOB_ID,
        status: { type: 'string', enum: ['queued', 'running', 'completed'] },
        queue_position: { type: 'integer', minimum: 1, nullable: true, description: '≥ 1 while queued (also again after a retry-alone pre-emption); null while running.' },
        elapsed_ms: { type: 'integer', minimum: 0 },
        deadline_at: { type: 'string', format: 'date-time' },
        poll_after_ms: { type: 'integer', minimum: 1 },
        result_status: { type: 'integer' },
        result: RESULT_SCHEMA
    }
});

const MULTIPART_SCHEMA = Object.freeze({
    type: 'object',
    required: ['choosenFile', 'expectedSourceSha256', 'expectedMeasurementGeneration'],
    description: 'Every field of the priced `POST /bambu/slice` request with the same names, values and formats (`material`, `layerHeight`, `infill`, `supports`, `orientationMode`, `printerProfile`, `sizeUnit`, `rotationX/Y/Z`, `processProfile`, `scalePercent`, `expectedProfileSha256` — format-checked, not compared), plus the export fields.',
    properties: {
        choosenFile: { type: 'string', format: 'binary', description: 'The same bytes as the priced slice.' },
        exportFormat: { type: 'string', enum: ['stl', '3mf'], default: 'stl' },
        expectedSourceSha256: { ...HEX64, description: 'Receipt `source.sha256`.' },
        expectedMeasurementGeneration: { ...HEX64, description: 'Receipt `measurement_generation`; required here.' },
        expectedSlicedGeometrySha256: { ...HEX64, description: 'Receipt `source.sliced_geometry_sha256`; absent → fidelity `unverified`.' },
        exportLabel: { type: 'string', pattern: '^Q-[0-9]{7}$', description: 'Written into 3MF metadata only.' },
        expectedProfileSha256: HEX64
    },
    additionalProperties: true
});

function exportJobOperation(summary, description, responses) {
    return {
        tags: ['Export'],
        summary,
        description,
        security: [{ SliceServiceApiKey: [] }],
        parameters: [
            { ...SLICE_SERVICE_HEADER },
            { name: 'job_id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { ...responses, 401: UNAUTHORIZED, 404: EXPORT_NOT_FOUND, 429: JOB_RATE_LIMITED }
    };
}

function createExportPaths() {
    return {
        '/bambu/export': {
            post: {
                tags: ['Export'],
                summary: 'Production model with the priced pose and scale baked in (no slice).',
                description: 'Re-prepares the priced model exactly as the priced slice did (unit handling, CAD tessellation, repair, orientation, scale, bed placement) and returns that mesh. Check order, all synchronous even with `Prefer`: route enabled (404) → auth (401) → export bucket (429) → multipart and options (400) → generation (409) → streamed source sha256 (409) → archive preflight (§2.5) → queue (429 `EXPORT_QUEUE_FULL`, Retry-After 10). Inside the job the pipeline\'s own refusals keep their slice codes and statuses. The slicer keeps nothing after a sync answer.',
                security: [{ SliceServiceApiKey: [] }],
                parameters: [{ ...SLICE_SERVICE_HEADER }, { ...PREFER_HEADER }, { ...REQUEST_ID_HEADER }],
                requestBody: { required: true, content: { 'multipart/form-data': { schema: MULTIPART_SCHEMA } } },
                responses: {
                    200: EXPORT_FILE_RESPONSE,
                    202: {
                        description: 'Async export admitted (`Prefer: respond-async`).',
                        headers: {
                            Location: { schema: { type: 'string', pattern: '^/bambu/export/jobs/ex_[a-f0-9]{32}$' } },
                            'Preference-Applied': { schema: { type: 'string', enum: ['respond-async'] } },
                            'Retry-After': RETRY_AFTER_HEADER,
                            'Cache-Control': NO_STORE_HEADER
                        },
                        content: { 'application/json': { schema: ACCEPTED_SCHEMA } }
                    },
                    400: jsonError('An export or slice option is invalid, the archive was refused (with `archive_rule`/`archive_limit`), or the source geometry is invalid.', [
                        'EXPORT_FORMAT_INVALID', 'EXPORT_REQUEST_INVALID', 'INVALID_SOURCE_GEOMETRY', 'INVALID_SOURCE_ARCHIVE'
                    ], { archive_rule: { type: 'string' }, archive_limit: { type: 'number', nullable: true } }),
                    401: UNAUTHORIZED,
                    404: jsonError('The export route is off (`EXPORT_ROUTE_ENABLED=false`).', ['ROUTE_NOT_FOUND']),
                    409: jsonError('Identity check failed: generation (`SLICE_IDENTITY_MISMATCH`), source (`EXPORT_SOURCE_MISMATCH`) or re-prepared geometry (`EXPORT_GEOMETRY_MISMATCH`, with `actual_sliced_geometry_sha256` and `orientation_outcome`).', [
                        'SLICE_IDENTITY_MISMATCH', 'EXPORT_SOURCE_MISMATCH', 'EXPORT_GEOMETRY_MISMATCH'
                    ], { actual_sliced_geometry_sha256: HEX64, orientation_outcome: { type: 'string' } }),
                    413: jsonError('Upload or archive over a resource limit.', ['SLICE_RESOURCE_LIMIT_EXCEEDED']),
                    422: jsonError('The pipeline refused the model with its slice code.', [
                        'MODEL_OUT_OF_PRINTER_BOUNDS', 'AMBIGUOUS_MANUFACTURING_SCOPE', 'UNSLICEABLE_SOURCE_GEOMETRY'
                    ]),
                    429: RATE_LIMITED,
                    500: jsonError('The 3MF writer or the pipeline failed.', ['EXPORT_WRITE_FAILED', 'INTERNAL_PROCESSING_ERROR']),
                    503: jsonError('Engine unavailable or the preflight queue is full (Retry-After).', ['SLICER_ENGINE_UNAVAILABLE', 'SLICE_QUEUE_FULL']),
                    504: jsonError('Sync export over `EXPORT_SYNC_DEADLINE_MS` (90 s): `retry_async: true`.', ['EXPORT_DEADLINE_EXCEEDED'], {
                        retry_async: { type: 'boolean', enum: [true] }
                    })
                }
            }
        },
        '/bambu/export/jobs/{job_id}': {
            get: exportJobOperation(
                'Async export job status.',
                'Visible only to the principal that created the job. Always `Cache-Control: no-store`, never 304.',
                {
                    200: {
                        description: 'Queued, running, or completed with `result_status` and `result`.',
                        headers: { 'Cache-Control': NO_STORE_HEADER },
                        content: { 'application/json': { schema: STATUS_SCHEMA } }
                    }
                }
            ),
            delete: exportJobOperation(
                'Delete an export job.',
                'Aborts a running job, deletes the stored file and the record. Call it as soon as the file is stored.',
                { 204: { description: 'Deleted.' } }
            )
        },
        '/bambu/export/jobs/{job_id}/file': {
            get: exportJobOperation(
                'Download an async export result.',
                'The §2.2 sync headers and body. No range requests.',
                {
                    200: EXPORT_FILE_RESPONSE,
                    409: jsonError('The job is queued, running or failed.', ['EXPORT_NOT_READY'])
                }
            )
        }
    };
}

const CAPABILITIES_SCHEMA = Object.freeze({
    type: 'object',
    required: ['schema', 'service_version', 'async_contract', 'measurement_generation', 'authenticated_as', 'export', 'deletion', 'archive_limits'],
    properties: {
        schema: { type: 'string', enum: ['r3d-slicer-capabilities-v1'] },
        service_version: { type: 'string' },
        async_contract: { type: 'integer', enum: [1] },
        measurement_generation: { type: 'object', properties: { bambu: { ...HEX64, nullable: true } } },
        authenticated_as: {
            type: 'object',
            properties: {
                principal: { type: 'string', enum: ['woocommerce', 'leadpilot', 'staging', 'shared'] },
                rotation: { type: 'string', enum: ['active', 'previous'] }
            }
        },
        export: { type: 'object', additionalProperties: true, description: '`enabled` false when the operator has the export off.' },
        deletion: { type: 'object', additionalProperties: true },
        archive_limits: { type: 'object', additionalProperties: true }
    }
});

function createCapabilitiesPaths() {
    return {
        '/capabilities': {
            get: {
                tags: ['System'],
                summary: 'Feature detection for slice-key holders (3.9.0+).',
                description: '3.8.x answers 404 `ROUTE_NOT_FOUND`: read that as "none of the 3.9.0 features". A feature absent from the document is absent. Always `Cache-Control: no-store`.',
                security: [{ SliceServiceApiKey: [] }],
                parameters: [{ ...SLICE_SERVICE_HEADER }],
                responses: {
                    200: {
                        description: 'The capabilities document.',
                        headers: { 'Cache-Control': NO_STORE_HEADER },
                        content: { 'application/json': { schema: CAPABILITIES_SCHEMA } }
                    },
                    401: UNAUTHORIZED,
                    429: jsonError('Only a request with no key header, once the source IP\'s failure bucket is spent.', ['RATE_LIMIT_EXCEEDED'])
                }
            }
        }
    };
}

module.exports = {
    createCapabilitiesPaths,
    createExportPaths
};
