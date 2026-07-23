const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const createSwaggerDocument = require(path.join(REPO_ROOT, 'app/docs/swagger-docs'));
const document = createSwaggerDocument({ FDM: {}, SLA: {} });

const EXPECTED_METHODS = {
    '/pricing': ['get'],
    '/pricing/FDM': ['post'],
    '/pricing/SLA': ['post'],
    '/pricing/FDM/{material}': ['delete', 'patch'],
    '/pricing/SLA/{material}': ['delete', 'patch'],
    '/prusa/slice': ['post'],
    '/orca/slice': ['post'],
    '/admin/output-files': ['get'],
    '/admin/download/{fileName}': ['get'],
    '/health': ['get'],
    '/ready': ['get'],
    '/health/detailed': ['get'],
    '/operations/readiness': ['get'],
    '/operations/metrics': ['get']
};

const EXPECTED_RESPONSE_KEYS = {
    'GET /pricing': ['200'],
    'POST /pricing/FDM': ['201', '400', '401', '409', '500'],
    'POST /pricing/SLA': ['201', '400', '401', '409', '500'],
    'PATCH /pricing/FDM/{material}': ['200', '400', '401', '500'],
    'DELETE /pricing/FDM/{material}': ['200', '400', '401', '404', '500'],
    'PATCH /pricing/SLA/{material}': ['200', '400', '401', '500'],
    'DELETE /pricing/SLA/{material}': ['200', '400', '401', '404', '500'],
    'POST /prusa/slice': ['200', '400', '401', '408', '413', '422', '500'],
    'POST /orca/slice': ['200', '400', '401', '408', '413', '422', '500'],
    'GET /admin/output-files': ['200', '401', '500', '503'],
    'GET /admin/download/{fileName}': ['200', '400', '401', '404', '413', '500', '503'],
    'GET /health': ['200'],
    'GET /ready': ['200', '503'],
    'GET /health/detailed': ['200', '401', '503'],
    'GET /operations/readiness': ['200', '401', '503'],
    'GET /operations/metrics': ['200', '401']
};

function getOperation(operationKey) {
    const separator = operationKey.indexOf(' ');
    const method = operationKey.slice(0, separator).toLowerCase();
    const routePath = operationKey.slice(separator + 1);
    return document.paths[routePath][method];
}

test('OpenAPI document exposes the current structured paths and methods', () => {
    assert.equal(document.openapi, '3.0.0');
    assert.deepEqual(Object.keys(document.paths).sort(), Object.keys(EXPECTED_METHODS).sort());

    for (const [routePath, methods] of Object.entries(EXPECTED_METHODS)) {
        assert.deepEqual(Object.keys(document.paths[routePath]).sort(), methods, routePath);
    }
});

test('OpenAPI protected operations declare exact audience-scoped x-api-key security', () => {
    const protectedOperations = {
        'POST /pricing/FDM': 'PricingApiKey',
        'POST /pricing/SLA': 'PricingApiKey',
        'PATCH /pricing/FDM/{material}': 'PricingApiKey',
        'DELETE /pricing/FDM/{material}': 'PricingApiKey',
        'PATCH /pricing/SLA/{material}': 'PricingApiKey',
        'DELETE /pricing/SLA/{material}': 'PricingApiKey',
        'GET /admin/output-files': 'ArtifactApiKey',
        'GET /admin/download/{fileName}': 'ArtifactApiKey',
        'GET /health/detailed': 'OperationsApiKey',
        'GET /operations/readiness': 'OperationsApiKey',
        'GET /operations/metrics': 'OperationsApiKey'
    };

    for (const [operationKey, scheme] of Object.entries(protectedOperations)) {
        const operation = getOperation(operationKey);
        assert.deepEqual(operation.security, [{ [scheme]: [] }], operationKey);
        const header = operation.parameters.find((parameter) => (
            parameter.name === 'x-api-key' && parameter.in === 'header'
        ));
        assert.ok(header, operationKey);
        assert.equal(header.required, true, operationKey);
        assert.equal(header.schema.type, 'string', operationKey);
    }

    for (const operationKey of ['GET /pricing', 'GET /health', 'GET /ready']) {
        assert.equal(getOperation(operationKey).security, undefined, operationKey);
    }
});

test('OpenAPI slice operations expose the exact scoped authentication contract', () => {
    assert.deepEqual(document.components.securitySchemes.SliceServiceApiKey, {
        type: 'apiKey',
        in: 'header',
        name: 'x-slicer-api-key',
        description: 'Scoped service credential required only for slicing operations.'
    });

    const expectedUnauthorizedResponse = {
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
                        errorCode: {
                            type: 'string',
                            enum: ['SLICE_SERVICE_AUTH_REQUIRED']
                        }
                    }
                },
                example: {
                    success: false,
                    error: 'Slice service authentication is required.',
                    errorCode: 'SLICE_SERVICE_AUTH_REQUIRED'
                }
            }
        }
    };

    for (const operationKey of ['POST /prusa/slice', 'POST /orca/slice']) {
        const operation = getOperation(operationKey);
        assert.deepEqual(operation.security, [{ SliceServiceApiKey: [] }], operationKey);
        const authHeaders = operation.parameters.filter((parameter) => (
            parameter.name === 'x-slicer-api-key' && parameter.in === 'header'
        ));
        assert.deepEqual(authHeaders, [{
            name: 'x-slicer-api-key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Scoped slice-service API credential.'
        }], operationKey);
        assert.deepEqual(operation.responses['401'], expectedUnauthorizedResponse, operationKey);
    }
});

test('OpenAPI slice operations retain multipart choosenFile contracts', () => {
    for (const routePath of ['/prusa/slice', '/orca/slice']) {
        const content = document.paths[routePath].post.requestBody.content;
        assert.deepEqual(Object.keys(content), ['multipart/form-data']);
        const schema = content['multipart/form-data'].schema;
        assert.deepEqual(schema.properties.choosenFile, {
            type: 'string',
            format: 'binary',
            description: 'Supported model/CAD file to slice and estimate price.'
        });
        assert.ok(schema.required.includes('choosenFile'));
    }
});

test('OpenAPI operations retain their documented response-status keys', () => {
    for (const [operationKey, expectedKeys] of Object.entries(EXPECTED_RESPONSE_KEYS)) {
        const actualKeys = Object.keys(getOperation(operationKey).responses).sort();
        assert.deepEqual(actualKeys, [...expectedKeys].sort(), operationKey);
    }
});
