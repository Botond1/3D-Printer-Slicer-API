'use strict';

/**
 * Repository file basenames and Bambu vendor profile names share one contract:
 * a leading alphanumeric, then letters, digits, spaces, `@`, `.`, `_`, `+`, `-`;
 * never a path separator.
 */
function basenameSchema() {
    return {
        type: 'string', minLength: 1, maxLength: 128,
        pattern: '^[A-Za-z0-9][A-Za-z0-9 @._+-]{0,127}$'
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

function nullableDimensionSchema() {
    return {
        ...dimensionSchema(),
        nullable: true
    };
}

function machineResolutionSchema() {
    return {
        type: 'object',
        required: [
            'technology', 'printer', 'engine', 'status', 'reason',
            'minimum_dimensions_inclusive_mm',
            'largest_passing_dimensions_inclusive_mm'
        ],
        additionalProperties: false,
        description: 'One engine-scoped machine admission envelope. Presets for the same technology, printer, and engine must agree exactly or catalogue initialization fails; envelopes from different native engines are never merged.',
        properties: {
            technology: technologySchema(),
            printer: printerIdentitySchema(),
            engine: {
                type: 'string', minLength: 1, maxLength: 32,
                pattern: '^[a-z][a-z0-9-]{0,31}$'
            },
            status: { type: 'string', enum: ['resolved'] },
            reason: {
                type: 'string',
                nullable: true,
                enum: [null]
            },
            minimum_dimensions_inclusive_mm: {
                ...dimensionSchema(),
                description: 'Inclusive lower bound enforced by the slice endpoint.'
            },
            largest_passing_dimensions_inclusive_mm: {
                ...dimensionSchema({ strictlyPositive: true }),
                description: 'Authoritative configured inclusive upper admission boundary for this native engine. An exact boundary value is accepted; candidate-image measurement evidence is recorded separately.'
            }
        }
    };
}

function fleetResolutionSchema() {
    return {
        type: 'object',
        required: [
            'technology', 'engine', 'status', 'reason', 'printers',
            'minimum_dimensions_inclusive_mm',
            'largest_passing_dimensions_inclusive_mm', 'excluded_printers'
        ],
        additionalProperties: false,
        description: 'One technology-and-engine-scoped fleet envelope derived from authoritative configured machine ceilings. A result is resolved only when one complete machine envelope contains every other envelope; axes are never combined into a synthetic maximum.',
        properties: {
            technology: technologySchema(),
            engine: {
                type: 'string', minLength: 1, maxLength: 32,
                pattern: '^[a-z][a-z0-9-]{0,31}$'
            },
            status: { type: 'string', enum: ['resolved', 'unresolved'] },
            reason: {
                type: 'string',
                nullable: true,
                enum: [null, 'no_resolved_machine', 'no_dominant_machine'],
                description: 'Null only when status is resolved.'
            },
            printers: {
                type: 'array',
                maxItems: 256,
                uniqueItems: true,
                description: 'Machines sharing the dominant complete envelope, or an empty array when unresolved.',
                items: printerIdentitySchema()
            },
            minimum_dimensions_inclusive_mm: {
                ...nullableDimensionSchema(),
                description: 'Inclusive lower boundary of the dominant envelope, or null when unresolved.'
            },
            largest_passing_dimensions_inclusive_mm: {
                ...dimensionSchema({ strictlyPositive: true }),
                nullable: true,
                description: 'Authoritative inclusive upper boundary of the dominant envelope, or null when unresolved.'
            },
            excluded_printers: {
                type: 'array',
                maxItems: 0,
                uniqueItems: true,
                description: 'Reserved compatibility field. Same-engine preset disagreement fails catalogue initialization, so v2 never excludes a machine silently.',
                items: { type: 'object', additionalProperties: false }
            }
        },
        oneOf: [
            {
                title: 'Resolved technology fleet',
                properties: {
                    status: { type: 'string', enum: ['resolved'] },
                    reason: { type: 'string', nullable: true, enum: [null] },
                    printers: {
                        type: 'array', minItems: 1, maxItems: 256,
                        uniqueItems: true, items: printerIdentitySchema()
                    },
                    minimum_dimensions_inclusive_mm: dimensionSchema(),
                    largest_passing_dimensions_inclusive_mm: dimensionSchema({
                        strictlyPositive: true
                    })
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
                    printers: { type: 'array', maxItems: 0 },
                    minimum_dimensions_inclusive_mm: {
                        type: 'object', nullable: true, enum: [null]
                    },
                    largest_passing_dimensions_inclusive_mm: {
                        type: 'object', nullable: true, enum: [null]
                    }
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
                description: 'FDM rows cover every native engine. SLA rows are PrusaSlicer-only Elegoo Saturn 4 Ultra quoting presets (SL1 raster output is quote-only; a real print needs an external UVtools conversion to the vendor .goo/.ctb format); fallback-only limits backed by no explicit machine-profile metadata are never published as a printer.'
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
                        description: 'Deterministically ordered, uniquely named multipart selector parameters. Prusa and Orca derive them from profile_components; Bambu rows lead with printerProfile (registry id), layerHeight (registry key), and material, followed by the component-derived processProfile vendor name.',
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
                description: 'Deterministically ordered, path-free profile components used to derive the effective digest. Prusa/Orca basenames are repository file names; Bambu basenames are the official vendor profile names flattened from the bundled BBL resources.',
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
                required: [
                    'minimum_dimensions_inclusive_mm',
                    'declared_build_volume_dimensions_mm',
                    'largest_passing_dimensions_inclusive_mm',
                    'source_profile', 'declared_source_kind'
                ],
                additionalProperties: false,
                properties: {
                    minimum_dimensions_inclusive_mm: {
                        ...dimensionSchema(),
                        description: 'Inclusive minimum dimensions enforced by the slice endpoint.'
                    },
                    declared_build_volume_dimensions_mm: {
                        ...dimensionSchema({ strictlyPositive: true }),
                        description: 'Physical/profile-declared build-volume metadata. This is not an admission limit.'
                    },
                    largest_passing_dimensions_inclusive_mm: {
                        ...dimensionSchema({ strictlyPositive: true }),
                        description: 'Authoritative configured validation ceiling for this native engine. An exact boundary value is accepted; candidate-image measurement evidence is recorded separately.'
                    },
                    source_profile: basenameSchema(),
                    declared_source_kind: {
                        type: 'string',
                        enum: ['profile-explicit'],
                        description: 'All declared X/Y/Z axes were parsed from the selected machine-bound profile metadata. This does not certify the native largest-passing boundary.'
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
                description: 'Public informational catalogue whose current v2 rows are machine-bound server-owned FDM and SLA presets. Every per-printer, per-engine preset row remains visible, with physical/profile-declared dimensions separated from the authoritative configured inclusive admission ceiling. Machine and fleet envelopes are resolved independently for each technology and native engine; cross-engine values are never merged or silently minimized. H2D-QUOTE is explicitly a H2D-sized quoting chain with P1S physics, not a production H2D G-code profile. Bambu Studio rows (engine `bambu`, endpoint `/bambu/slice`) name the official vendor machine/process/filament profiles for the P1S and H2D; their largest-passing ceilings are provisional until the native envelope sweep replaces them. The Elegoo Saturn 4 Ultra SLA rows (engine `prusa`, endpoint `/prusa/slice`) add separate per-engine SLA fleet resolutions; their SL1 raster output is quote-only and their largest-passing ceiling is likewise provisional until a native envelope sweep replaces it. Slice endpoints remain authoritative and keep enforcing the published largest-passing ceiling. Fallback-only presets backed by no explicit machine-profile metadata are never published as machine entries. Custom overrides and dynamic materials are outside this catalogue, and catalogue availability never gates slicing.',
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
                                            enum: ['r3d-profile-catalogue-v2']
                                        },
                                        catalogue_sha256: {
                                            type: 'string', pattern: '^[a-f0-9]{64}$'
                                        },
                                        semantics: {
                                            type: 'object',
                                            required: [
                                                'authority', 'enforcement', 'availability',
                                                'freshness', 'build_volume_dimensions',
                                                'fleet_derivation', 'scope'
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
                                                build_volume_dimensions: {
                                                    type: 'string', minLength: 1, maxLength: 1024
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
                                            type: 'array', minItems: 1, maxItems: 32,
                                            uniqueItems: true,
                                            description: 'Exactly one deterministic fleet resolution for each technology-and-engine pair present in profiles.',
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
