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
    '/bambu/slice': ['post'],
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
    'POST /prusa/slice': ['200', '400', '401', '408', '413', '422', '429', '500', '503'],
    'POST /orca/slice': ['200', '400', '401', '408', '413', '422', '429', '500', '503'],
    'POST /bambu/slice': ['200', '400', '401', '408', '413', '422', '429', '500', '503'],
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

const SLICE_OPERATIONS = ['POST /prusa/slice', 'POST /orca/slice', 'POST /bambu/slice'];

test('slice success and bounds responses share the schema-v2 original-dimension invariant', () => {
    for (const operationKey of SLICE_OPERATIONS) {
        const operation = getOperation(operationKey);
        const successTransform = operation.responses[200]
            .content['application/json'].schema.properties.model_transform;
        const boundsTransform = operation.responses[422]
            .content['application/json'].schema.oneOf[0].properties.model_transform;

        for (const transform of [successTransform, boundsTransform]) {
            assert.deepEqual(transform.properties.transform_schema.enum, [2], operationKey);
            assert.ok(transform.required.includes('original_dimensions_available'), operationKey);
            assert.ok(transform.required.includes('original_dimensions_mm'), operationKey);
            assert.equal(transform.properties.original_dimensions_available.type, 'boolean', operationKey);
            assert.equal(transform.properties.original_dimensions_mm.nullable, true, operationKey);
            assert.deepEqual(
                Object.fromEntries(['x', 'y', 'z'].map((axis) => [
                    axis,
                    transform.properties.original_dimensions_mm.properties[axis].minimum
                ])),
                { x: 0, y: 0, z: 0 },
                operationKey
            );
            assert.deepEqual(
                transform.oneOf.map((branch) => ({
                    available: branch.properties.original_dimensions_available.enum,
                    nullable: branch.properties.original_dimensions_mm.nullable === true,
                    nullOnly: branch.properties.original_dimensions_mm.enum || null
                })),
                [
                    { available: [true], nullable: false, nullOnly: null },
                    { available: [false], nullable: true, nullOnly: [null] }
                ],
                operationKey
            );
        }
        assert.strictEqual(boundsTransform, successTransform, operationKey);
    }
});

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

test('profile catalogue v2 stays generic for a future real SLA machine and names inclusive ceilings', () => {
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
    const buildVolume = entrySchema.properties.build_volume_limits_mm;
    assert.deepEqual(buildVolume.required, [
        'minimum_dimensions_inclusive_mm',
        'declared_build_volume_dimensions_mm',
        'largest_passing_dimensions_inclusive_mm',
        'source_profile', 'declared_source_kind'
    ]);
    assert.equal(Object.hasOwn(buildVolume.properties, 'max'), false);
    assert.deepEqual(buildVolume.properties.declared_source_kind.enum, ['profile-explicit']);
    assert.match(
        buildVolume.properties.declared_build_volume_dimensions_mm.description,
        /not an admission limit/i
    );
    assert.match(
        buildVolume.properties.largest_passing_dimensions_inclusive_mm.description,
        /exact boundary value is accepted/i
    );
    assert.deepEqual(
        entrySchema.properties.effective_profile_identity_schema.enum,
        ['r3d-effective-slice-profile-v2']
    );
    assert.equal(entrySchema.properties.filament_diameter_mm.nullable, true);
    assert.equal(entrySchema.properties.filament_density_g_cm3.nullable, true);
    assert.deepEqual(responseSchema.properties.schema.enum, ['r3d-profile-catalogue-v2']);
    assert.match(operation.description, /current v2 rows are .*FDM presets/);
    assert.match(operation.description, /H2D-sized quoting chain with P1S physics/);
    assert.match(operation.description, /Fallback-only SLA presets are never published/);
    assert.match(operation.description, /same v2 entry schema/);
});

test('profile catalogue schema exposes engine-scoped machine and non-synthetic fleet ceilings', () => {
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
    assert.equal(fleetArraySchema.maxItems, 32);
    assert.equal(
        operation.responses[503].content['application/json'].schema.additionalProperties,
        false
    );

    const profileEnvelope = entrySchema.properties.build_volume_limits_mm;
    assert.equal(profileEnvelope.additionalProperties, false);
    const minimum = profileEnvelope.properties.minimum_dimensions_inclusive_mm;
    const declared = profileEnvelope.properties.declared_build_volume_dimensions_mm;
    const largest = profileEnvelope.properties.largest_passing_dimensions_inclusive_mm;
    assert.equal(minimum.additionalProperties, false);
    assert.equal(declared.additionalProperties, false);
    assert.equal(largest.additionalProperties, false);
    for (const axis of ['x', 'y', 'z']) {
        assert.deepEqual(minimum.properties[axis], {
            type: 'number', minimum: 0
        });
        assert.deepEqual(declared.properties[axis], {
            type: 'number', minimum: 0, exclusiveMinimum: true
        });
        assert.deepEqual(largest.properties[axis], {
            type: 'number', minimum: 0, exclusiveMinimum: true
        });
    }

    assert.deepEqual(machineSchema.required, [
        'technology', 'printer', 'engine', 'status', 'reason',
        'minimum_dimensions_inclusive_mm',
        'largest_passing_dimensions_inclusive_mm'
    ]);
    assert.deepEqual(machineSchema.properties.technology.enum, ['FDM', 'SLA']);
    assert.equal(machineSchema.properties.engine.pattern, '^[a-z][a-z0-9-]{0,31}$');
    assert.deepEqual(machineSchema.properties.status.enum, ['resolved']);
    assert.equal(machineSchema.properties.reason.nullable, true);
    assert.deepEqual(machineSchema.properties.reason.enum, [null]);
    assert.match(machineSchema.description, /different native engines are never merged/i);

    assert.deepEqual(fleetSchema.required, [
        'technology', 'engine', 'status', 'reason', 'printers',
        'minimum_dimensions_inclusive_mm',
        'largest_passing_dimensions_inclusive_mm', 'excluded_printers'
    ]);
    assert.deepEqual(fleetSchema.properties.technology.enum, ['FDM', 'SLA']);
    assert.equal(fleetSchema.properties.engine.pattern, '^[a-z][a-z0-9-]{0,31}$');
    assert.deepEqual(fleetSchema.properties.status.enum, ['resolved', 'unresolved']);
    assert.equal(fleetSchema.properties.reason.nullable, true);
    assert.deepEqual(
        fleetSchema.properties.reason.enum,
        [null, 'no_resolved_machine', 'no_dominant_machine']
    );
    assert.equal(fleetSchema.properties.minimum_dimensions_inclusive_mm.nullable, true);
    assert.equal(
        fleetSchema.properties.largest_passing_dimensions_inclusive_mm.nullable,
        true
    );
    assert.equal(fleetSchema.properties.excluded_printers.maxItems, 0);
    assert.equal(fleetSchema.oneOf.length, 2);
    assert.deepEqual(fleetSchema.oneOf[0].properties.status.enum, ['resolved']);
    assert.deepEqual(fleetSchema.oneOf[0].properties.reason.enum, [null]);
    assert.equal(fleetSchema.oneOf[0].properties.printers.minItems, 1);
    assert.deepEqual(fleetSchema.oneOf[1].properties.status.enum, ['unresolved']);
    assert.deepEqual(
        fleetSchema.oneOf[1].properties.reason.enum,
        ['no_resolved_machine', 'no_dominant_machine']
    );
    assert.equal(fleetSchema.oneOf[1].properties.printers.maxItems, 0);
    assert.deepEqual(
        fleetSchema.oneOf[1].properties.largest_passing_dimensions_inclusive_mm.enum,
        [null]
    );
    assert.match(operation.description, /Every per-printer, per-engine preset row remains visible/);
    assert.match(operation.description, /cross-engine values are never merged/);
    assert.match(operation.description, /separate per-engine SLA fleet resolutions/);
});

test('profile catalogue v2 generic identity fields admit a future SLA engine shape', () => {
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
            pattern: '^[A-Za-z0-9][A-Za-z0-9 @._+-]{0,127}$'
        }
    );
    // The relaxed basename contract admits Bambu vendor names but never paths.
    const basename = new RegExp(entry.build_volume_limits_mm.properties.source_profile.pattern);
    assert.match('0.20mm Standard @BBL X1C', basename);
    assert.match('Bambu Lab P1S 0.4 nozzle', basename);
    assert.match('FDM_0.2mm.ini', basename);
    assert.doesNotMatch('../private.ini', basename);
    assert.doesNotMatch('nested/profile.json', basename);
    assert.doesNotMatch(' leading-space', basename);
});

test('OpenAPI documents the Bambu Studio slice operation, supports, strict infill, and queue statuses', () => {
    const bambu = getOperation('POST /bambu/slice');
    const properties = bambu.requestBody.content['multipart/form-data'].schema.properties;
    assert.deepEqual(properties.printerProfile.enum, ['P1S', 'H2D']);
    assert.deepEqual(properties.layerHeight.enum, ['0.08', '0.1', '0.12', '0.16', '0.2', '0.24', '0.28']);
    assert.equal(properties.supports.type, 'boolean');
    assert.equal(properties.supports.default, true);
    assert.equal(properties.infill.minimum, 0);
    assert.equal(properties.infill.maximum, 100);
    assert.match(properties.infill.description, /never clamped/i);
    assert.match(bambu.description, /\.gcode\.3mf/);
    for (const operationKey of SLICE_OPERATIONS) {
        const operation = getOperation(operationKey);
        const request = operation.requestBody.content['multipart/form-data'].schema.properties;
        assert.equal(request.supports.type, 'boolean', operationKey);
        const success = operation.responses[200].content['application/json'].schema;
        assert.ok(success.required.includes('supports'), operationKey);
        assert.deepEqual(success.properties.slicer_engine.enum, ['prusa', 'orca', 'bambu'], operationKey);
        const codes = (status) => operation.responses[status].content['application/json'].schema
            .properties.errorCode.enum;
        assert.deepEqual(codes(429), ['RATE_LIMIT_EXCEEDED', 'SLICE_QUEUE_CLIENT_LIMIT'], operationKey);
        assert.deepEqual(codes(503), ['SLICE_QUEUE_FULL', 'SLICE_QUEUE_TIMEOUT', 'SLICE_QUEUE_SHUTDOWN'], operationKey);
        assert.deepEqual(codes(408), ['UPLOAD_TOTAL_TIMEOUT'], operationKey);
        assert.ok(codes(413).includes('UPLOAD_RESOURCE_LIMIT_EXCEEDED'), operationKey);
        for (const code of [
            'INVALID_SUPPORTS', 'INVALID_INFILL', 'INVALID_PRINTER_PROFILE', 'INVALID_PROCESS_PROFILE',
            'MATERIAL_PROFILE_UNAVAILABLE', 'INVALID_LAYER_HEIGHT'
        ]) {
            assert.ok(codes(400).includes(code), `${operationKey} ${code}`);
        }
        assert.ok(codes(422).includes('UNSLICEABLE_SOURCE_GEOMETRY'), operationKey);
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

    for (const operationKey of SLICE_OPERATIONS) {
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
    for (const routePath of ['/prusa/slice', '/orca/slice', '/bambu/slice']) {
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
