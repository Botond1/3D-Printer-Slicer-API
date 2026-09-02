'use strict';

const { createSliceResponses } = require('./slice-openapi');

const SLICE_SERVICE_HEADER = Object.freeze({
    name: 'x-slicer-api-key',
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description: 'Scoped slice-service API credential.'
});

function errorCodeResponse(description, errorCodes) {
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

function createRenderProperties() {
    return {
        choosenFile: {
            type: 'string',
            format: 'binary',
            description: 'Supported model/CAD file to preview. Accepts the same formats as the slice endpoints: stl, obj, 3mf, ply, step, stp, igs, iges, zip.'
        },
        orientationMode: {
            type: 'string',
            enum: ['auto', 'preserve'],
            default: 'auto',
            description: 'Same semantics as the slice endpoints: `auto` applies the automatic stable-pose optimization, `preserve` keeps the submitted pose. Explicit rotationX/Y/Z still apply in both modes.'
        },
        sizeUnit: {
            type: 'string',
            enum: ['mm', 'inch'],
            default: 'mm',
            description: 'Unit for targetSizeX/Y/Z values.'
        },
        keepProportions: {
            type: 'boolean',
            default: true,
            description: 'If true, target dimensions are interpreted with locked aspect ratio.'
        },
        targetSizeX: { type: 'number', description: 'Optional target X size in the selected sizeUnit.' },
        targetSizeY: { type: 'number', description: 'Optional target Y size in the selected sizeUnit.' },
        targetSizeZ: { type: 'number', description: 'Optional target Z size in the selected sizeUnit.' },
        scalePercent: {
            type: 'number',
            description: 'Optional uniform scale in percent. Cannot be combined with targetSizeX/Y/Z.'
        },
        rotationX: { type: 'number', default: 0, description: 'Optional rotation around X axis in degrees.' },
        rotationY: { type: 'number', default: 0, description: 'Optional rotation around Y axis in degrees.' },
        rotationZ: { type: 'number', default: 0, description: 'Optional rotation around Z axis in degrees.' },
        layerHeight: {
            type: 'string',
            enum: ['0.025', '0.05', '0.1', '0.2', '0.3'],
            default: '0.2',
            description: 'Optional. Selects the FDM/SLA orientation heuristic exactly like `/prusa/slice` so the preview pose matches the slice the consumer will request. No slicing is performed.'
        },
        material: {
            type: 'string',
            default: 'PLA',
            description: 'Optional. Validated like `/prusa/slice` for parity; it does not affect the rendered image.'
        }
    };
}

function createRenderResponses() {
    const sliceResponses = createSliceResponses();
    return {
        200: {
            description: 'Deterministic PNG preview of the final pose (1024x768, isometric view, light background, build-plate grid, `X x Y x Z mm` caption bottom-left). Identical input bytes and options always produce byte-identical PNG output.',
            headers: {
                'Content-Type': { schema: { type: 'string', enum: ['image/png'] } },
                'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } }
            },
            content: {
                'image/png': { schema: { type: 'string', format: 'binary' } }
            }
        },
        400: errorCodeResponse(
            'Invalid request, option, geometry, or source archive.',
            [
                'NO_FILE_UPLOADED',
                'UNSUPPORTED_FILE_FORMAT',
                'INVALID_SOURCE_ARCHIVE',
                'INVALID_SOURCE_GEOMETRY',
                'INVALID_ORIENTATION_MODE',
                'INVALID_SIZE_UNIT',
                'INVALID_KEEP_PROPORTIONS',
                'INVALID_SIZE_OPTIONS',
                'CONFLICTING_SIZE_OPTIONS',
                'INVALID_ROTATION_OPTIONS',
                'INVALID_LAYER_HEIGHT',
                'INVALID_LAYER_HEIGHT_FOR_ENGINE',
                'INVALID_MATERIAL_FOR_TECHNOLOGY',
                'MATERIAL_TECHNOLOGY_MISMATCH',
                'INVALID_PROFILE_NAME',
                'INVALID_MULTIPART_REQUEST',
                'UPLOAD_REQUEST_ABORTED'
            ]
        ),
        401: sliceResponses[401],
        408: sliceResponses[408],
        413: sliceResponses[413],
        422: {
            description: 'Model dimensions could not be measured, the model exceeds the largest supported envelope, or rendering exceeded its 60 second budget.',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['success', 'error', 'errorCode'],
                        properties: {
                            success: { type: 'boolean', enum: [false] },
                            error: { type: 'string' },
                            errorCode: {
                                type: 'string',
                                enum: [
                                    'MODEL_DIMENSIONS_UNAVAILABLE',
                                    'MODEL_OUT_OF_PRINTER_BOUNDS',
                                    'FILE_PROCESSING_TIMEOUT'
                                ]
                            }
                        }
                    }
                }
            }
        },
        429: errorCodeResponse(
            'Slice rate limit or per-client queue fairness cap reached. `Retry-After` is set for the rate limit.',
            ['RATE_LIMIT_EXCEEDED', 'SLICE_QUEUE_CLIENT_LIMIT']
        ),
        500: sliceResponses[500],
        503: errorCodeResponse(
            'The shared slice/render queue is full, timed out, or shutting down.',
            ['SLICE_QUEUE_FULL', 'SLICE_QUEUE_TIMEOUT', 'SLICE_QUEUE_SHUTDOWN']
        )
    };
}

function createRenderPaths() {
    return {
        '/render': {
            post: {
                tags: ['Preview'],
                summary: 'Deterministic PNG preview of the final slice pose.',
                description: 'Requires x-slicer-api-key service authentication and shares the slice rate limiter and FIFO queue, so a preview never runs beside a native slice. The upload passes the same conversion, orientation, sizing/rotation, and bounds steps as `/prusa/slice`; the resulting STL is rendered instead of sliced. The response body is a PNG (`Content-Type: image/png`), 1024x768, isometric camera from +X/-Y/+Z, Lambert-shaded faces with mild edge darkening on a light `#f5f5f5` background above a subtle build-plate grid, with the final `X x Y x Z mm` dimensions (one decimal) drawn bottom-left. Output is byte-identical for identical input bytes and options.',
                security: [{ SliceServiceApiKey: [] }],
                parameters: [{ ...SLICE_SERVICE_HEADER }],
                consumes: ['multipart/form-data'],
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: createRenderProperties(),
                                required: ['choosenFile']
                            }
                        }
                    }
                },
                responses: createRenderResponses()
            }
        }
    };
}

module.exports = {
    createRenderPaths,
    createRenderResponses
};
