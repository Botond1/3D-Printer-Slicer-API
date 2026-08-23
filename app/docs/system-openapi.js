'use strict';

function operationsHeader() {
    return {
        name: 'x-api-key',
        in: 'header',
        required: true,
        schema: { type: 'string' }
    };
}

function operationsOperation(summary, responses) {
    return {
        tags: ['Operations'],
        summary,
        security: [{ OperationsApiKey: [] }],
        parameters: [operationsHeader()],
        responses
    };
}

function createSystemPaths() {
    return {
        '/health': {
            get: {
                tags: ['System'],
                summary: 'Liveness probe.',
                responses: { 200: { description: 'Process is alive' } }
            }
        },
        '/ready': {
            get: {
                tags: ['System'],
                summary: 'Minimal public readiness probe.',
                responses: {
                    200: { description: 'Admission and required cached probes are healthy' },
                    503: { description: 'Admission is closed or a required probe is unhealthy' }
                }
            }
        },
        '/health/detailed': {
            get: operationsOperation('Detailed operational health.', {
                200: { description: 'All required subsystems are healthy' },
                401: { description: 'Operations authentication required' },
                503: { description: 'One or more required subsystems are unhealthy' }
            })
        },
        '/operations/readiness': {
            get: operationsOperation('Actionable readiness diagnostics.', {
                200: { description: 'Readiness details' },
                401: { description: 'Operations authentication required' },
                503: { description: 'Readiness details for unavailable admission' }
            })
        },
        '/operations/metrics': {
            get: operationsOperation('Fixed-cardinality runtime metrics.', {
                200: {
                    description: 'Prometheus text exposition',
                    content: {
                        'text/plain': { schema: { type: 'string' } }
                    }
                },
                401: { description: 'Operations authentication required' }
            })
        }
    };
}

module.exports = { createSystemPaths };
