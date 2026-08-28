const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const createSwaggerDocument = require(path.join(REPO_ROOT, 'app/docs/swagger-docs'));
const document = createSwaggerDocument({ FDM: {}, SLA: {} });

const EXPECTED_METHODS = {
    '/pricing': ['get'],
    '/profiles': ['get'],
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
    'GET /profiles': ['200', '304', '503'],
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

    for (const operationKey of ['GET /pricing', 'GET /profiles', 'GET /health', 'GET /ready']) {
        assert.equal(getOperation(operationKey).security, undefined, operationKey);
    }
});

test('profile catalogue v1 stays FDM-only now without a schema change for real SLA machines', () => {
    const operation = getOperation('GET /profiles');
    const responseSchema = operation.responses[200].content['application/json'].schema;
    const entrySchema = responseSchema.properties.profiles.items;

    assert.deepEqual(entrySchema.properties.technology.enum, ['FDM', 'SLA']);
    assert.equal(entrySchema.properties.engine.enum, undefined);
    assert.equal(entrySchema.properties.engine.pattern, '^[a-z][a-z0-9-]{0,31}$');
    assert.equal(entrySchema.properties.printer.properties.id.enum, undefined);
    assert.equal(
        entrySchema.properties.slice_selector.properties.endpoint.pattern,
        '^/[a-z][a-z0-9-]{0,31}/slice$'
    );
    const selectorParameters = entrySchema.properties.slice_selector.properties.parameters;
    assert.equal(selectorParameters.type, 'array');
    assert.equal(selectorParameters.minItems, 1);
    assert.equal(selectorParameters.maxItems, 16);
    assert.deepEqual(selectorParameters.items.required, ['name', 'value']);
    assert.equal(
        selectorParameters.items.properties.name.pattern,
        '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
    );
    assert.equal(entrySchema.properties.profile_components.minItems, 1);
    assert.deepEqual(
        entrySchema.properties.profile_components.items.required,
        ['role', 'basename', 'selector_parameter']
    );
    assert.equal(
        entrySchema.properties.profile_components.items.properties.selector_parameter.nullable,
        true
    );
    assert.deepEqual(
        entrySchema.properties.build_volume_limits_mm.properties.max_source_kind.enum,
        ['profile-explicit']
    );
    assert.deepEqual(
        entrySchema.properties.effective_profile_identity_schema.enum,
        ['r3d-effective-slice-profile-v2']
    );
    assert.equal(entrySchema.properties.filament_diameter_mm.nullable, true);
    assert.equal(entrySchema.properties.filament_density_g_cm3.nullable, true);
    assert.match(operation.description, /current v1 rows are .*FDM presets/);
    assert.match(operation.description, /Fallback-only SLA presets are never published/);
    assert.match(operation.description, /same v1 entry schema/);
});

test('profile catalogue schema exposes technology-scoped loud conflicts and fleet maxima', () => {
    const operation = getOperation('GET /profiles');
    const responseSchema = operation.responses[200].content['application/json'].schema;
    const entrySchema = responseSchema.properties.profiles.items;
    const machineSchema = responseSchema.properties.machine_resolutions.items;
    const fleetArraySchema = responseSchema.properties.fleet_resolutions;
    const fleetSchema = fleetArraySchema.items;

    assert.deepEqual(responseSchema.required, [
        'schema', 'catalogue_sha256', 'semantics', 'profiles',
        'machine_resolutions', 'fleet_resolutions'
    ]);
    assert.equal(responseSchema.additionalProperties, false);
    assert.equal(entrySchema.additionalProperties, false);
    assert.equal(responseSchema.properties.semantics.additionalProperties, false);
    assert.equal(machineSchema.additionalProperties, false);
    assert.equal(fleetSchema.additionalProperties, false);
    assert.equal(fleetArraySchema.minItems, 1);
    assert.equal(fleetArraySchema.maxItems, 2);
    assert.equal(
        operation.responses[503].content['application/json'].schema.additionalProperties,
        false
    );

    const profileEnvelope = entrySchema.properties.build_volume_limits_mm;
    assert.equal(profileEnvelope.additionalProperties, false);
    assert.equal(profileEnvelope.properties.min.additionalProperties, false);
    assert.equal(profileEnvelope.properties.max.additionalProperties, false);
    for (const axis of ['x', 'y', 'z']) {
        assert.deepEqual(profileEnvelope.properties.min.properties[axis], {
            type: 'number', minimum: 0
        });
        assert.deepEqual(profileEnvelope.properties.max.properties[axis], {
            type: 'number', minimum: 0, exclusiveMinimum: true
        });
    }

    assert.deepEqual(machineSchema.required, [
        'technology', 'printer', 'engines', 'status', 'reason',
        'resolved_build_volume_limits_mm'
    ]);
    assert.deepEqual(machineSchema.properties.technology.enum, ['FDM', 'SLA']);
    assert.deepEqual(machineSchema.properties.status.enum, ['resolved', 'excluded']);
    assert.equal(machineSchema.properties.reason.nullable, true);
    assert.deepEqual(
        machineSchema.properties.reason.enum,
        [null, 'cross_engine_conflict']
    );
    assert.equal(
        machineSchema.properties.resolved_build_volume_limits_mm.nullable,
        true
    );
    assert.match(
        machineSchema.properties.resolved_build_volume_limits_mm.description,
        /never selected/
    );
    assert.equal(machineSchema.oneOf.length, 2);
    assert.deepEqual(machineSchema.oneOf[0].properties.status.enum, ['resolved']);
    assert.deepEqual(machineSchema.oneOf[0].properties.reason.enum, [null]);
    assert.equal(
        machineSchema.oneOf[0].properties.resolved_build_volume_limits_mm.nullable,
        false
    );
    assert.deepEqual(machineSchema.oneOf[1].properties.status.enum, ['excluded']);
    assert.deepEqual(
        machineSchema.oneOf[1].properties.reason.enum,
        ['cross_engine_conflict']
    );
    assert.deepEqual(
        machineSchema.oneOf[1].properties.resolved_build_volume_limits_mm.enum,
        [null]
    );

    assert.deepEqual(fleetSchema.required, [
        'technology', 'status', 'reason', 'maximum', 'excluded_printers'
    ]);
    assert.deepEqual(fleetSchema.properties.technology.enum, ['FDM', 'SLA']);
    assert.deepEqual(fleetSchema.properties.status.enum, ['resolved', 'unresolved']);
    assert.equal(fleetSchema.properties.reason.nullable, true);
    assert.deepEqual(
        fleetSchema.properties.reason.enum,
        [null, 'no_resolved_machine', 'no_dominant_machine']
    );
    assert.equal(fleetSchema.properties.maximum.nullable, true);
    assert.equal(fleetSchema.properties.maximum.additionalProperties, false);
    assert.equal(
        fleetSchema.properties.maximum.properties.build_volume_limits_mm
            .additionalProperties,
        false
    );
    assert.equal(
        fleetSchema.properties.excluded_printers.items.additionalProperties,
        false
    );
    assert.deepEqual(
        fleetSchema.properties.excluded_printers.items.properties.reason.enum,
        ['cross_engine_conflict']
    );
    assert.equal(fleetSchema.oneOf.length, 2);
    assert.deepEqual(fleetSchema.oneOf[0].properties.status.enum, ['resolved']);
    assert.deepEqual(fleetSchema.oneOf[0].properties.reason.enum, [null]);
    assert.equal(fleetSchema.oneOf[0].properties.maximum.nullable, undefined);
    assert.deepEqual(fleetSchema.oneOf[1].properties.status.enum, ['unresolved']);
    assert.deepEqual(
        fleetSchema.oneOf[1].properties.reason.enum,
        ['no_resolved_machine', 'no_dominant_machine']
    );
    assert.deepEqual(fleetSchema.oneOf[1].properties.maximum.enum, [null]);
    assert.match(operation.description, /Every per-printer, per-engine preset row remains visible/);
    assert.match(operation.description, /cross-engine conflict is explicit/);
    assert.match(operation.description, /separate SLA fleet resolution/);
});

test('profile catalogue v1 generic identity fields admit a future SLA engine shape', () => {
    const entrySchema = getOperation('GET /profiles')
        .responses[200].content['application/json'].schema.properties.profiles.items;
    const futureIdentityOnly = {
        engine: 'future-sla',
        endpoint: '/future-sla/slice',
        parameters: [{ name: 'printerProfile', value: 'owner-exported-profile.json' }],
        components: [{
            role: 'machine',
            basename: 'owner-exported-profile.json',
            selector_parameter: 'printerProfile'
        }],
        filament_diameter_mm: null,
        filament_density_g_cm3: null
    };

    assert.match(futureIdentityOnly.engine, new RegExp(entrySchema.properties.engine.pattern));
    assert.match(
        futureIdentityOnly.endpoint,
        new RegExp(entrySchema.properties.slice_selector.properties.endpoint.pattern)
    );
    for (const parameter of futureIdentityOnly.parameters) {
        assert.match(
            parameter.name,
            new RegExp(entrySchema.properties.slice_selector.properties.parameters.items
                .properties.name.pattern)
        );
        assert.match(
            parameter.value,
            new RegExp(entrySchema.properties.slice_selector.properties.parameters.items
                .properties.value.pattern)
        );
    }
    for (const component of futureIdentityOnly.components) {
        assert.match(
            component.role,
            new RegExp(entrySchema.properties.profile_components.items.properties.role.pattern)
        );
        assert.match(
            component.basename,
            new RegExp(entrySchema.properties.profile_components.items.properties.basename.pattern)
        );
        assert.match(
            component.selector_parameter,
            new RegExp(entrySchema.properties.profile_components.items.properties
                .selector_parameter.pattern)
        );
    }
    assert.equal(futureIdentityOnly.filament_diameter_mm, null);
    assert.equal(futureIdentityOnly.filament_density_g_cm3, null);
    assert.equal(Object.hasOwn(futureIdentityOnly, 'build_volume_limits_mm'), false);
});

test('profile catalogue public strings match runtime bounds and path-free identity contracts', () => {
    const entry = getOperation('GET /profiles')
        .responses[200].content['application/json'].schema.properties.profiles.items.properties;

    assert.deepEqual(
        { minLength: entry.id.minLength, maxLength: entry.id.maxLength, pattern: entry.id.pattern },
        {
            minLength: 1,
            maxLength: 256,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
        }
    );
    assert.deepEqual(
        entry.printer.properties.id,
        {
            type: 'string', minLength: 1, maxLength: 64,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        }
    );
    assert.deepEqual(
        entry.printer.properties.name,
        {
            type: 'string', minLength: 1, maxLength: 128,
            pattern: '^[\\x20-\\x7e]{1,128}$'
        }
    );
    assert.deepEqual(
        entry.engine_version,
        {
            type: 'string', minLength: 1, maxLength: 128,
            pattern: '^[\\x20-\\x7e]{1,128}$'
        }
    );
    assert.deepEqual(
        entry.build_volume_limits_mm.properties.source_profile,
        {
            type: 'string', minLength: 1, maxLength: 128,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
        }
    );
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
