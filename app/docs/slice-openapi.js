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
    required: [
        'success',
        'job_id',
        'artifact_id',
        'slicer_engine',
        'engine_version',
        'profiles',
        'hourly_rate',
        'stats'
    ],
    properties: {
        success: { type: 'boolean', enum: [true] },
        job_id: { type: 'string', pattern: '^job-[a-f0-9]{32}$' },
        artifact_id: { type: 'string', pattern: '^artifact-[a-f0-9]{32}$' },
        slicer_engine: { type: 'string', enum: ['prusa', 'orca'] },
        engine_version: {
            type: 'string',
            pattern: '^[0-9]+(?:\\.[0-9]+){2,3}(?:[-+][A-Za-z0-9._-]+)?$',
            description: 'Version reported by the native slicer binary that produced the result.'
        },
        profiles: {
            type: 'object',
            required: ['effective_profile_sha256'],
            properties: {
                filament_profile: {
                    type: 'string',
                    nullable: true,
                    description: 'Exact Orca filament profile used, or null when the material has no mapped profile and pricing must remain manual.'
                },
                filament_diameter_mm: {
                    type: 'number',
                    nullable: true,
                    description: 'Filament diameter read from the exact Orca profile snapshot passed to the slicer.'
                },
                filament_density_g_cm3: {
                    type: 'number',
                    nullable: true,
                    description: 'Filament density read from the exact Orca profile snapshot passed to the slicer.'
                },
                effective_profile_sha256: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                    description: 'Deterministic SHA-256 of effective machine/process/filament profile layers, normalized material, and server-owned native policy, excluding per-request layer-height and infill overrides.'
                }
            }
        },
        hourly_rate: {
            type: 'number',
            nullable: true,
            description: 'Configured hourly rate, or null when an Orca material has no selected filament profile or the native output has no direct mass marker and pricing requires manual review.'
        },
        stats: {
            type: 'object',
            required: ['material_used_m', 'material_used_g', 'estimated_price_huf'],
            properties: {
                material_used_m: {
                    type: 'number',
                    minimum: 0,
                    description: 'Filament length parsed directly from slicer output.'
                },
                material_used_g: {
                    type: 'number',
                    nullable: true,
                    minimum: 0,
                    description: 'Filament mass parsed directly from the slicer marker; null when the selected native profile emits no mass marker. It is never derived from length.'
                },
                estimated_price_huf: {
                    type: 'number',
                    nullable: true,
                    description: 'Calculated estimate, or null when an Orca material has no selected filament profile or the native output has no direct mass marker and pricing requires manual review.'
                }
            }
        }
    }
});

const DIMENSIONS_SCHEMA = Object.freeze({
    type: 'object',
    required: ['x', 'y', 'z'],
    properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' }
    }
});

const BUILD_VOLUME_LIMITS_SCHEMA = Object.freeze({
    type: 'object',
    required: ['min', 'max', 'source_profile'],
    properties: {
        min: DIMENSIONS_SCHEMA,
        max: DIMENSIONS_SCHEMA,
        source_profile: { type: 'string' }
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

function validationErrorResponse() {
    const otherValidationCodes = [
        'INVALID_SLICE_OUTPUT',
        'INVALID_SLICE_STATS',
        'FILE_PROCESSING_TIMEOUT',
        'ORCA_PROFILE_INCOMPATIBLE',
        'MODEL_DIMENSIONS_UNAVAILABLE'
    ];
    return {
        description: 'Model/profile validation or generated output/statistics validation failed.',
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
                            enum: [...otherValidationCodes, 'MODEL_OUT_OF_PRINTER_BOUNDS']
                        }
                    },
                    oneOf: [
                        {
                            required: ['model_dimensions_mm', 'build_volume_limits_mm'],
                            properties: {
                                errorCode: { type: 'string', enum: ['MODEL_OUT_OF_PRINTER_BOUNDS'] },
                                model_dimensions_mm: DIMENSIONS_SCHEMA,
                                build_volume_limits_mm: BUILD_VOLUME_LIMITS_SCHEMA
                            }
                        },
                        {
                            properties: {
                                errorCode: { type: 'string', enum: otherValidationCodes }
                            }
                        }
                    ]
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
        422: validationErrorResponse(),
        500: errorCodeResponse('Server Error', [
            'SLICE_OUTPUT_UNPARSED',
            'INTERNAL_PROCESSING_ERROR',
            'QUEUE_INTERNAL_ERROR',
            'UPLOAD_STORAGE_ERROR',
            'INTERNAL_SERVER_ERROR'
        ])
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
