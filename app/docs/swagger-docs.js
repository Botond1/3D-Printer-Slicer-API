'use strict';

const { createPricingPaths } = require('./pricing-openapi');
const { createSlicePaths } = require('./slice-openapi');
const { createAdminPaths } = require('./admin-openapi');

/**
 * Build OpenAPI document for pricing and slicing endpoints.
 * @param {{FDM?: Record<string, number>, SLA?: Record<string, number>}} pricing Current pricing map.
 * @returns {object} OpenAPI document object.
 */
function createSwaggerDocument(pricing) {
    void pricing;
    return {
        openapi: '3.0.0',
        info: {
            title: '3D Printer Slicer API for FDM and SLA',
            version: '3.1.4',
            description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
        },
        tags: [
            { name: 'Pricing', description: 'Runtime pricing configuration endpoints' },
            { name: 'Slicing', description: 'Explicit FDM/SLA slicing and print estimation endpoints' },
            { name: 'Admin', description: 'Protected operational endpoints requiring x-api-key' }
        ],
        paths: {
            ...createPricingPaths(),
            ...createSlicePaths(),
            ...createAdminPaths()
        },
        components: {
            securitySchemes: {
                SliceServiceApiKey: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-slicer-api-key',
                    description: 'Scoped service credential required only for slicing operations.'
                }
            }
        }
    };
}

module.exports = createSwaggerDocument;
