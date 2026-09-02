'use strict';

function adminKeyParameter() {
    return {
        name: 'x-api-key',
        in: 'header',
        required: true,
        schema: { type: 'string' }
    };
}

function materialPathParameter() {
    return {
        name: 'material',
        in: 'path',
        required: true,
        schema: { type: 'string' }
    };
}

function createMaterialOperation(technology, example, price) {
    return {
        tags: ['Pricing'],
        summary: `Create a new ${technology} material.`,
        description: 'Protected endpoint. Requires x-api-key header.',
        parameters: [adminKeyParameter()],
        security: [{ PricingApiKey: [] }],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            material: {
                                type: 'string',
                                example,
                                description: `New ${technology} material name.`
                            },
                            price: {
                                type: 'number',
                                example: price,
                                description: 'Hourly price in HUF.'
                            }
                        },
                        required: ['material', 'price']
                    }
                }
            }
        },
        responses: {
            201: { description: 'Material created successfully' },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            409: { description: 'Material already exists' },
            500: { description: 'Persistence error' }
        }
    };
}

function updateMaterialOperation(technology, price) {
    return {
        tags: ['Pricing'],
        summary: `Update existing ${technology} material price.`,
        description: 'Protected endpoint. Requires x-api-key header.',
        parameters: [materialPathParameter(), adminKeyParameter()],
        security: [{ PricingApiKey: [] }],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            price: {
                                type: 'number',
                                example: price,
                                description: 'Hourly price in HUF for the specified material and technology.'
                            }
                        },
                        required: ['price']
                    }
                }
            }
        },
        responses: {
            200: { description: 'Price updated successfully' },
            400: { description: 'Validation error (including non-existing material)' },
            401: { description: 'Unauthorized' },
            500: { description: 'Persistence error' }
        }
    };
}

function deleteMaterialOperation(technology) {
    return {
        tags: ['Pricing'],
        summary: `Delete an ${technology} material price.`,
        description: 'Protected endpoint. Requires x-api-key header. The last material of a technology cannot be deleted (`LAST_MATERIAL_PROTECTED`), because readiness requires a non-empty FDM and SLA pricing map.',
        parameters: [materialPathParameter(), adminKeyParameter()],
        security: [{ PricingApiKey: [] }],
        responses: {
            200: { description: 'Material deleted successfully' },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            404: { description: 'Material not found' },
            409: { description: 'The material is the last one of its technology (`LAST_MATERIAL_PROTECTED`).' },
            500: { description: 'Persistence error' }
        }
    };
}

function createPricingPaths() {
    return {
        '/pricing': {
            get: {
                tags: ['Pricing'],
                summary: 'Get current pricing configuration.',
                description: 'Returns the full pricing object for FDM and SLA technologies.',
                responses: {
                    200: {
                        description: 'Pricing object retrieved successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        FDM: { type: 'object', additionalProperties: { type: 'number' } },
                                        SLA: { type: 'object', additionalProperties: { type: 'number' } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/pricing/FDM': {
            post: createMaterialOperation('FDM', 'ASA', 1200)
        },
        '/pricing/SLA': {
            post: createMaterialOperation('SLA', 'High-Temp', 2400)
        },
        '/pricing/FDM/{material}': {
            patch: updateMaterialOperation('FDM', 1000),
            delete: deleteMaterialOperation('FDM')
        },
        '/pricing/SLA/{material}': {
            patch: updateMaterialOperation('SLA', 1800),
            delete: deleteMaterialOperation('SLA')
        }
    };
}

module.exports = { createPricingPaths };
