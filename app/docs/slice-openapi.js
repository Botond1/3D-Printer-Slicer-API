'use strict';

const SLICE_SERVICE_HEADER = Object.freeze({
    name: 'x-slicer-api-key',
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description: 'Scoped slice-service API credential.'
});

const COMMON_MULTIPART_PROPERTIES = Object.freeze({
    choosenFile: {
        type: 'string',
        format: 'binary',
        description: 'Supported model/CAD file to slice and estimate price.'
    },
    material: {
        type: 'string',
        default: 'PLA'
    },
    infill: {
        type: 'integer',
        default: 20,
        minimum: 0,
        maximum: 100
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
    targetSizeX: {
        type: 'number',
        description: 'Optional target X size in the selected sizeUnit.'
    },
    targetSizeY: {
        type: 'number',
        description: 'Optional target Y size in the selected sizeUnit.'
    },
    targetSizeZ: {
        type: 'number',
        description: 'Optional target Z size in the selected sizeUnit.'
    },
    scalePercent: {
        type: 'number',
        description: 'Optional uniform scale in percent. Cannot be combined with targetSizeX/Y/Z.'
    },
    rotationX: {
        type: 'number',
        default: 0,
        description: 'Optional rotation around X axis in degrees.'
    },
    rotationY: {
        type: 'number',
        default: 0,
        description: 'Optional rotation around Y axis in degrees.'
    },
    rotationZ: {
        type: 'number',
        default: 0,
        description: 'Optional rotation around Z axis in degrees.'
    }
});

const SUCCESS_SCHEMA = Object.freeze({
    type: 'object',
    required: ['success', 'job_id', 'artifact_id'],
    properties: {
        success: { type: 'boolean', enum: [true] },
        job_id: { type: 'string', pattern: '^job-[a-f0-9]{32}$' },
        artifact_id: { type: 'string', pattern: '^artifact-[a-f0-9]{32}$' }
    }
});

function errorCodeResponse(description, errorCodes) {
    return {
        description,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        errorCode: { type: 'string', enum: errorCodes }
                    }
                }
            }
        }
    };
}

function createSliceResponses() {
    return {
        200: {
            description: 'Slicing successful',
            content: { 'application/json': { schema: SUCCESS_SCHEMA } }
        },
        400: errorCodeResponse(
            'Invalid request, geometry, or source archive.',
            ['INVALID_SOURCE_ARCHIVE', 'INVALID_SOURCE_GEOMETRY', 'UNSUPPORTED_FILE_FORMAT']
        ),
        401: {
            description: 'Slice service authentication is required.',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['success', 'error', 'errorCode'],
                        properties: {
                            success: { type: 'boolean', enum: [false] },
                            error: {
                                type: 'string',
                                enum: ['Slice service authentication is required.']
                            },
                            errorCode: { type: 'string', enum: ['SLICE_SERVICE_AUTH_REQUIRED'] }
                        }
                    },
                    example: {
                        success: false,
                        error: 'Slice service authentication is required.',
                        errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
                    }
                }
            }
        },
        408: errorCodeResponse(
            'The total multipart upload lifetime expired.',
            ['UPLOAD_TOTAL_TIMEOUT']
        ),
        413: errorCodeResponse(
            'Upload, archive expansion, model, intermediate, or output exceeded a resource limit.',
            ['UPLOAD_RESOURCE_LIMIT_EXCEEDED', 'SLICE_RESOURCE_LIMIT_EXCEEDED']
        ),
        422: errorCodeResponse(
            'Model/profile validation or generated output/statistics validation failed.',
            ['INVALID_SLICE_OUTPUT', 'INVALID_SLICE_STATS']
        ),
        500: { description: 'Server Error' }
    };
}

function createPrusaProperties() {
    return {
        ...COMMON_MULTIPART_PROPERTIES,
        layerHeight: {
            type: 'string',
            enum: ['0.025', '0.05', '0.1', '0.2', '0.3'],
            default: '0.2',
            description: 'Allowed layer heights. Determines FDM or SLA technology for PrusaSlicer.'
        },
        material: {
            ...COMMON_MULTIPART_PROPERTIES.material,
            description: 'Material key for selected technology (FDM or SLA). Invalid cross-technology pairing returns 4xx.'
        },
        infill: {
            ...COMMON_MULTIPART_PROPERTIES.infill,
            description: 'Infill percentage from `0` to `100` (used for FDM).'
        },
        printerProfile: {
            type: 'string',
            description: 'Optional override profile filename from `configs/prusa` (for example `FDM_0.2mm.ini`).'
        }
    };
}

function createOrcaProperties() {
    return {
        ...COMMON_MULTIPART_PROPERTIES,
        layerHeight: {
            type: 'string',
            enum: ['0.1', '0.2', '0.3'],
            default: '0.2',
            description: 'Requested FDM layer height profile for OrcaSlicer.'
        },
        material: {
            ...COMMON_MULTIPART_PROPERTIES.material,
            description: 'FDM material key.'
        },
        infill: {
            ...COMMON_MULTIPART_PROPERTIES.infill,
            description: 'Infill percentage from `0` to `100`.'
        },
        printerProfile: {
            type: 'string',
            description: 'Optional Orca machine profile filename from `configs/orca` (for example `Bambu_P1S_0.4_nozzle.json`).'
        },
        processProfile: {
            type: 'string',
            description: 'Optional Orca process profile filename from `configs/orca` (for example `FDM_0.2mm.json`).'
        }
    };
}

function createSliceOperation({ summary, description, properties }) {
    return {
        post: {
            tags: ['Slicing'],
            summary,
            description,
            security: [{ SliceServiceApiKey: [] }],
            parameters: [{ ...SLICE_SERVICE_HEADER }],
            consumes: ['multipart/form-data'],
            requestBody: {
                required: true,
                content: {
                    'multipart/form-data': {
                        schema: {
                            type: 'object',
                            properties,
                            required: ['choosenFile', 'layerHeight', 'material']
                        }
                    }
                }
            },
            responses: createSliceResponses()
        }
    };
}

function createSlicePaths() {
    return {
        '/prusa/slice': createSliceOperation({
            summary: 'PrusaSlicer endpoint (FDM/SLA auto mode by layer height).',
            description: 'Requires x-slicer-api-key service authentication. Uses PrusaSlicer. Automatically chooses technology by layer height: SLA for 0.025/0.05, FDM for 0.1/0.2/0.3. Supports optional size/scale/rotation preprocessing and printer profile based build-volume validation.',
            properties: createPrusaProperties()
        }),
        '/orca/slice': createSliceOperation({
            summary: 'OrcaSlicer endpoint (FDM-only).',
            description: 'Requires x-slicer-api-key service authentication. Uses OrcaSlicer and always processes as FDM, including pricing. Supports optional size/scale/rotation preprocessing, machine/process profile overrides, and profile-based build-volume validation.',
            properties: createOrcaProperties()
        })
    };
}

module.exports = {
    createSlicePaths,
    createSliceResponses
};
