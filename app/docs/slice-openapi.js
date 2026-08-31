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
    orientationMode: {
        type: 'string',
        enum: ['auto', 'preserve'],
        default: 'auto',
        description: 'Controls server preprocessing orientation. `auto` preserves the historical automatic stable-pose optimization; `preserve` skips that automatic rotation. Explicit rotationX/Y/Z values still apply in both modes.'
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

const DIMENSIONS_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'z'],
    properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' }
    }
});

const NULLABLE_DIMENSIONS_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'z'],
    properties: {
        x: { type: 'number', nullable: true },
        y: { type: 'number', nullable: true },
        z: { type: 'number', nullable: true }
    }
});

const ROTATION_DEGREES_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'z'],
    properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' }
    }
});

const ROTATION_MATRIX_ROW_SCHEMA = Object.freeze({
    type: 'array',
    minItems: 3,
    maxItems: 3,
    items: { type: 'number' }
});

const ROTATION_MATRIX_SCHEMA = Object.freeze({
    type: 'array',
    minItems: 3,
    maxItems: 3,
    items: ROTATION_MATRIX_ROW_SCHEMA,
    description: 'Authoritative 3x3 proper-rotation matrix. Every cell is a finite JSON number.'
});

const BUILD_VOLUME_LIMITS_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max', 'source_profile'],
    properties: {
        min: DIMENSIONS_SCHEMA,
        max: DIMENSIONS_SCHEMA,
        source_profile: { type: 'string' }
    }
});

const MODEL_TRANSFORM_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    description: 'Versioned transform provenance. The operation order is automatic orientation, sizing in the oriented axes, requested X/Y/Z rotation, then translation to the build plate.',
    required: [
        'transform_schema',
        'size_unit',
        'keep_proportions',
        'requested_size',
        'scale_percent',
        'scale_factors',
        'orientation_mode',
        'orientation_outcome',
        'automatic_orientation_applied',
        'automatic_rotation_deg',
        'requested_rotation_deg',
        'rotation_deg',
        'automatic_rotation_matrix',
        'rotation_matrix',
        'original_dimensions_mm',
        'oriented_dimensions_mm',
        'final_dimensions_mm'
    ],
    properties: {
        transform_schema: {
            type: 'integer',
            enum: [1],
            description: 'Version of the model-transform response contract.'
        },
        size_unit: { type: 'string', enum: ['mm', 'inch'] },
        keep_proportions: { type: 'boolean' },
        requested_size: NULLABLE_DIMENSIONS_SCHEMA,
        scale_percent: { type: 'number', nullable: true },
        scale_factors: DIMENSIONS_SCHEMA,
        orientation_mode: { type: 'string', enum: ['auto', 'preserve'] },
        orientation_outcome: {
            type: 'string',
            enum: ['applied', 'unchanged', 'preserved', 'fallback_unmodified'],
            description: '`applied` means auto used a non-identity rotation; `unchanged` means auto completed with identity; `preserved` means the submitted pose was requested; `fallback_unmodified` means automatic orientation was unavailable and the original converted STL continued.'
        },
        automatic_orientation_applied: {
            type: 'boolean',
            description: 'True only when automatic preprocessing applied a non-identity rotation.'
        },
        automatic_rotation_deg: {
            ...ROTATION_DEGREES_SCHEMA,
            description: 'Canonical Euler representation of automatic orientation only.'
        },
        requested_rotation_deg: {
            ...ROTATION_DEGREES_SCHEMA,
            description: 'Requested X, then Y, then Z rotations in degrees.'
        },
        rotation_deg: {
            ...ROTATION_DEGREES_SCHEMA,
            description: 'Canonical Rz*Ry*Rx Euler representation of the total effective rotation.'
        },
        automatic_rotation_matrix: {
            ...ROTATION_MATRIX_SCHEMA,
            description: 'Rotation applied by automatic orientation preprocessing only.'
        },
        rotation_matrix: {
            ...ROTATION_MATRIX_SCHEMA,
            description: 'Authoritative total rotation for column vectors: R_total = R_requested * R_automatic, where R_requested = Rz * Ry * Rx. Native slicer rotation is disabled.'
        },
        original_dimensions_mm: {
            ...DIMENSIONS_SCHEMA,
            description: 'Submitted model dimensions after format conversion and before orientation or requested transforms.'
        },
        oriented_dimensions_mm: {
            ...DIMENSIONS_SCHEMA,
            description: 'Dimensions after automatic-or-preserved orientation and before requested size/rotation transforms.'
        },
        final_dimensions_mm: {
            ...DIMENSIONS_SCHEMA,
            description: 'Final dimensions passed to the native slicer after all server-side transforms.'
        }
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
        'model_transform',
        'build_volume_limits_mm',
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
        model_transform: MODEL_TRANSFORM_SCHEMA,
        build_volume_limits_mm: BUILD_VOLUME_LIMITS_SCHEMA,
        stats: {
            type: 'object',
            required: ['material_used_m', 'material_used_g', 'object_height_mm', 'estimated_price_huf'],
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
                object_height_mm: {
                    type: 'number',
                    minimum: 0,
                    description: 'Final pre-native-slicer model height. It equals model_transform.final_dimensions_mm.z.'
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
                            required: ['model_dimensions_mm', 'build_volume_limits_mm', 'model_transform'],
                            properties: {
                                errorCode: { type: 'string', enum: ['MODEL_OUT_OF_PRINTER_BOUNDS'] },
                                model_dimensions_mm: DIMENSIONS_SCHEMA,
                                build_volume_limits_mm: BUILD_VOLUME_LIMITS_SCHEMA,
                                model_transform: MODEL_TRANSFORM_SCHEMA
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
            [
                'INVALID_SOURCE_ARCHIVE',
                'INVALID_SOURCE_GEOMETRY',
                'UNSUPPORTED_FILE_FORMAT',
                'INVALID_ORIENTATION_MODE'
            ]
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
