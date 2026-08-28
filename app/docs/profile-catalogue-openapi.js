'use strict';

function basenameSchema() {
    return {
        type: 'string', minLength: 1, maxLength: 128,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    };
}

function selectorParameterNameSchema(nullable = false) {
    return {
        type: 'string',
        nullable,
        minLength: 1,
        maxLength: 64,
        pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
    };
}

function printerIdentitySchema() {
    return {
        type: 'object',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: {
            id: {
                type: 'string', minLength: 1, maxLength: 64,
                pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            },
            name: {
                type: 'string', minLength: 1, maxLength: 128,
                pattern: '^[\\x20-\\x7e]{1,128}$'
            }
        }
    };
}

function technologySchema() {
    return { type: 'string', enum: ['FDM', 'SLA'] };
}

function dimensionSchema({ strictlyPositive = false } = {}) {
    const axisSchema = strictlyPositive
        ? { type: 'number', minimum: 0, exclusiveMinimum: true }
        : { type: 'number', minimum: 0 };
    return {
        type: 'object',
        required: ['x', 'y', 'z'],
        additionalProperties: false,
        properties: {
            x: { ...axisSchema },
            y: { ...axisSchema },
            z: { ...axisSchema }
        }
    };
}

function resolvedBuildVolumeSchema(nullable = false) {
    return {
        type: 'object',
        nullable,
        required: ['min', 'max'],
        additionalProperties: false,
        properties: {
            min: dimensionSchema(),
            max: dimensionSchema({ strictlyPositive: true })
        }
    };
}

function machineResolutionSchema() {
    return {
        type: 'object',
        required: [
            'technology', 'printer', 'engines', 'status', 'reason',
            'resolved_build_volume_limits_mm'
        ],
        additionalProperties: false,
        description: 'Technology-scoped machine envelope derived from every published per-engine row for that technology. A cross-engine conflict is explicit and excludes only this printer-technology pair from its fleet derivation; values are never silently minimized.',
        properties: {
            technology: technologySchema(),
            printer: printerIdentitySchema(),
            engines: {
                type: 'array',
                minItems: 1,
                maxItems: 16,
                uniqueItems: true,
                description: 'Sorted unique engine identifiers represented by this printer.',
                items: {
                    type: 'string', minLength: 1, maxLength: 32,
                    pattern: '^[a-z][a-z0-9-]{0,31}$'
                }
            },
            status: { type: 'string', enum: ['resolved', 'excluded'] },
            reason: {
                type: 'string',
                nullable: true,
                enum: [null, 'cross_engine_conflict'],
                description: 'Null only when status is resolved; cross_engine_conflict only when status is excluded.'
            },
            resolved_build_volume_limits_mm: {
                ...resolvedBuildVolumeSchema(true),
                description: 'Resolved envelope when every engine agrees, otherwise null. A smaller conflicting value is never selected.'
            }
        },
        oneOf: [
            {
                title: 'Resolved machine envelope',
                properties: {
                    status: { type: 'string', enum: ['resolved'] },
                    reason: { type: 'string', nullable: true, enum: [null] },
                    resolved_build_volume_limits_mm: resolvedBuildVolumeSchema()
                }
            },
            {
                title: 'Excluded cross-engine conflict',
                properties: {
                    status: { type: 'string', enum: ['excluded'] },
                    reason: { type: 'string', enum: ['cross_engine_conflict'] },
                    resolved_build_volume_limits_mm: {
                        type: 'object', nullable: true, enum: [null]
                    }
                }
            }
        ]
    };
}

function fleetResolutionSchema() {
    return {
        type: 'object',
        required: ['technology', 'status', 'reason', 'maximum', 'excluded_printers'],
        additionalProperties: false,
        description: 'One technology-scoped fleet maximum derived only from resolved machine envelopes in that technology; this is not a separately maintained max field.',
        properties: {
            technology: technologySchema(),
            status: { type: 'string', enum: ['resolved', 'unresolved'] },
            reason: {
                type: 'string',
                nullable: true,
                enum: [null, 'no_resolved_machine', 'no_dominant_machine'],
                description: 'Null only when status is resolved.'
            },
            maximum: {
                type: 'object',
                nullable: true,
                required: ['printers', 'build_volume_limits_mm'],
                additionalProperties: false,
                description: 'A machine-attributed fleet maximum, or null when no resolved machine dominates all other resolved machines.',
                properties: {
                    printers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 256,
                        uniqueItems: true,
                        description: 'All machines sharing the same dominant envelope, in deterministic order.',
                        items: printerIdentitySchema()
                    },
                    build_volume_limits_mm: resolvedBuildVolumeSchema()
                }
            },
            excluded_printers: {
                type: 'array',
                maxItems: 256,
                uniqueItems: true,
                description: 'Machines excluded from fleet derivation because their per-engine envelopes conflict.',
                items: {
                    type: 'object',
                    required: ['printer', 'reason'],
                    additionalProperties: false,
                    properties: {
                        printer: printerIdentitySchema(),
                        reason: { type: 'string', enum: ['cross_engine_conflict'] }
                    }
                }
            }
        },
        oneOf: [
            {
                title: 'Resolved technology fleet',
                properties: {
                    status: { type: 'string', enum: ['resolved'] },
                    reason: { type: 'string', nullable: true, enum: [null] },
                    maximum: {
                        type: 'object',
                        required: ['printers', 'build_volume_limits_mm'],
                        additionalProperties: false,
                        properties: {
                            printers: {
                                type: 'array', minItems: 1, maxItems: 256,
                                uniqueItems: true,
                                items: printerIdentitySchema()
                            },
                            build_volume_limits_mm: resolvedBuildVolumeSchema()
                        }
                    }
                }
            },
            {
                title: 'Unresolved technology fleet',
                properties: {
                    status: { type: 'string', enum: ['unresolved'] },
                    reason: {
                        type: 'string',
                        enum: ['no_resolved_machine', 'no_dominant_machine']
                    },
                    maximum: { type: 'object', nullable: true, enum: [null] }
                }
            }
        ]
    };
}

function catalogueEntrySchema() {
    return {
        type: 'object',
        required: [
            'id', 'engine', 'technology', 'layer_height_mm', 'material',
            'material_scope', 'printer', 'slice_selector', 'profile_components', 'effective_profile_sha256',
            'effective_profile_identity_schema', 'engine_version', 'build_volume_limits_mm',
            'filament_diameter_mm', 'filament_density_g_cm3'
        ],
        additionalProperties: false,
        properties: {
            id: {
                type: 'string', minLength: 1, maxLength: 256,
                pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
            },
            engine: {
                type: 'string',
                minLength: 1,
                maxLength: 32,
                pattern: '^[a-z][a-z0-9-]{0,31}$'
            },
            technology: {
                ...technologySchema(),
                description: 'Current catalogue rows are FDM-only. SLA is reserved for a future real machine-bound profile; fallback-only SLA limits are never published as a printer.'
            },
            layer_height_mm: { type: 'number', minimum: 0, exclusiveMinimum: true },
            material: {
                type: 'string',
                nullable: true,
                minLength: 1,
                maxLength: 64,
                pattern: '^[\\x20-\\x7e]{1,64}$',
                description: 'Exact digest-bound material for Orca, or null when material is request-independent.'
            },
            material_scope: { type: 'string', enum: ['exact', 'request-independent'] },
            printer: {
                ...printerIdentitySchema(),
                description: 'Stable printer identity used with the resolved per-engine envelope. Fleet maxima are derived from these printer entries, never from a separate manual max field.'
            },
            slice_selector: {
                type: 'object',
                description: 'Profile-selection fields for the matching slice endpoint; this is not a complete multipart slice request.',
                required: ['endpoint', 'parameters'],
                additionalProperties: false,
                properties: {
                    endpoint: {
                        type: 'string',
                        minLength: 8,
                        maxLength: 39,
                        pattern: '^/[a-z][a-z0-9-]{0,31}/slice$'
                    },
                    parameters: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 16,
                        uniqueItems: true,
                        description: 'Deterministically ordered, uniquely named multipart selector parameters derived from profile_components.',
                        items: {
                            type: 'object',
                            required: ['name', 'value'],
                            additionalProperties: false,
                            properties: {
                                name: selectorParameterNameSchema(),
                                value: basenameSchema()
                            }
                        }
                    }
                }
            },
            profile_components: {
                type: 'array',
                minItems: 1,
                maxItems: 16,
                uniqueItems: true,
                description: 'Deterministically ordered, path-free profile components used to derive the effective digest.',
                items: {
                    type: 'object',
                    required: ['role', 'basename', 'selector_parameter'],
                    additionalProperties: false,
                    properties: {
                        role: {
                            type: 'string', minLength: 1, maxLength: 32,
                            pattern: '^[a-z][a-z0-9-]{0,31}$'
                        },
                        basename: basenameSchema(),
                        selector_parameter: selectorParameterNameSchema(true)
                    }
                }
            },
            effective_profile_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            effective_profile_identity_schema: {
                type: 'string',
                enum: ['r3d-effective-slice-profile-v2']
            },
            engine_version: {
                type: 'string', minLength: 1, maxLength: 128,
                pattern: '^[\\x20-\\x7e]{1,128}$'
            },
            build_volume_limits_mm: {
                type: 'object',
                required: ['min', 'max', 'source_profile', 'max_source_kind'],
                additionalProperties: false,
                properties: {
                    min: dimensionSchema(),
                    max: dimensionSchema({ strictlyPositive: true }),
                    source_profile: basenameSchema(),
                    max_source_kind: {
                        type: 'string',
                        enum: ['profile-explicit'],
                        description: 'All max X/Y/Z axes were parsed from the selected machine-bound profile metadata. This does not describe the generic minimum floor.'
                    }
                }
            },
            filament_diameter_mm: {
                type: 'number', nullable: true, minimum: 0, exclusiveMinimum: true
            },
            filament_density_g_cm3: {
                type: 'number', nullable: true, minimum: 0, exclusiveMinimum: true
            }
        }
    };
}

function createProfileCataloguePaths() {
    return {
        '/profiles': {
            get: {
                tags: ['Profiles'],
                summary: 'Get the startup profile catalogue.',
                description: 'Public informational catalogue whose current v1 rows are machine-bound server-owned FDM presets. Every per-printer, per-engine preset row remains visible. Machine envelopes are resolved independently per technology only when all represented engines agree; a cross-engine conflict is explicit and excludes only that printer-technology pair from its technology fleet maximum. Slice endpoints remain authoritative and keep enforcing build-volume limits. Fallback-only SLA presets are never published as machine entries; a later real machine-bound SLA profile fits the same v1 entry schema and adds its separate SLA fleet resolution within the same v1 response. Custom overrides and dynamic materials are outside this catalogue, and catalogue availability never gates slicing.',
                parameters: [{
                    name: 'If-None-Match',
                    in: 'header',
                    required: false,
                    schema: { type: 'string' },
                    description: 'Previously observed catalogue ETag for conditional revalidation.'
                }],
                responses: {
                    200: {
                        description: 'Immutable profile catalogue for this process generation.',
                        headers: {
                            ETag: { schema: { type: 'string' } },
                            'Cache-Control': { schema: { type: 'string' } }
                        },
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: [
                                        'schema', 'catalogue_sha256', 'semantics', 'profiles',
                                        'machine_resolutions', 'fleet_resolutions'
                                    ],
                                    additionalProperties: false,
                                    properties: {
                                        schema: {
                                            type: 'string',
                                            enum: ['r3d-profile-catalogue-v1']
                                        },
                                        catalogue_sha256: {
                                            type: 'string', pattern: '^[a-f0-9]{64}$'
                                        },
                                        semantics: {
                                            type: 'object',
                                            required: [
                                                'authority', 'enforcement', 'availability',
                                                'freshness', 'fleet_derivation', 'scope'
                                            ],
                                            additionalProperties: false,
                                            properties: {
                                                authority: {
                                                    type: 'string', enum: ['informational']
                                                },
                                                enforcement: {
                                                    type: 'string', minLength: 1, maxLength: 512
                                                },
                                                availability: {
                                                    type: 'string', minLength: 1, maxLength: 512
                                                },
                                                freshness: {
                                                    type: 'string', minLength: 1, maxLength: 512
                                                },
                                                fleet_derivation: {
                                                    type: 'string', minLength: 1, maxLength: 1024
                                                },
                                                scope: {
                                                    type: 'string', minLength: 1, maxLength: 1024
                                                }
                                            }
                                        },
                                        profiles: {
                                            type: 'array', minItems: 1, maxItems: 4096,
                                            description: 'Complete per-printer, per-engine preset rows; machine resolution never hides or coalesces them.',
                                            items: catalogueEntrySchema()
                                        },
                                        machine_resolutions: {
                                            type: 'array', minItems: 1, maxItems: 512,
                                            uniqueItems: true,
                                            items: machineResolutionSchema()
                                        },
                                        fleet_resolutions: {
                                            type: 'array', minItems: 1, maxItems: 2,
                                            uniqueItems: true,
                                            description: 'Exactly one deterministic fleet resolution for each technology present in profiles.',
                                            items: fleetResolutionSchema()
                                        }
                                    }
                                }
                            }
                        }
                    },
                    304: { description: 'Catalogue generation is unchanged; no response body.' },
                    503: {
                        description: 'Catalogue initialization failed; slicing remains available.',
                        headers: {
                            'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } }
                        },
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['success', 'error', 'errorCode'],
                                    additionalProperties: false,
                                    properties: {
                                        success: { type: 'boolean', enum: [false] },
                                        error: { type: 'string', minLength: 1, maxLength: 512 },
                                        errorCode: {
                                            type: 'string', enum: ['PROFILE_CATALOGUE_UNAVAILABLE']
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };
}

module.exports = { catalogueEntrySchema, createProfileCataloguePaths };
