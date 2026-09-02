'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');

// Bambu rows flatten the official vendor chain by name; the unit fixture
// mirrors the registry-referenced names so the catalogue builds offline.
process.env.BAMBU_PROFILES_ROOT = path.resolve(__dirname, '../fixtures/bambu-profiles');

const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const {
    createRuntimeSlicerProfile,
    resolveBuildVolumeLimits,
    resolveProfileSelection
} = require('../../../app/services/slice/profiles');
const { snapshotProfileSelection } = require('../../../app/services/slice/profile-snapshot');
const {
    calculateEffectiveProfileSha256,
    DIGEST_SCHEMA
} = require('../../../app/services/slice/profile-digest');
const {
    buildProfileCatalogue,
    buildSliceSelector,
    createPresetDefinitions,
    createProfileCatalogueService,
    deriveMachineAndFleetResolutions,
    hashCatalogueContent,
    validateCatalogueEntryIdentity
} = require('../../../app/services/slice/profile-catalogue');
const {
    createProfileCatalogueRouter,
    matchesIfNoneMatch
} = require('../../../app/routes/profile-catalogue.routes');

const ENGINE_VERSIONS = Object.freeze({
    prusa: '2.8.1-test', orca: '2.3.1-test', bambu: '02.08.02.61-test'
});
const BAMBU_P1S = Object.freeze({ id: 'P1S', name: 'Bambu Lab P1S' });
const BAMBU_H2D = Object.freeze({ id: 'H2D', name: 'Bambu Lab H2D' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2-profile-catalogue-'));
const minimum = Object.freeze({ x: 1, y: 1, z: 1 });
let snapshot;

function createWorkspace() {
    return createJobWorkspace({
        jobsRoot: path.join(root, 'jobs'),
        scratchRoot: path.join(root, 'scratch'),
        outputRoot: path.join(root, 'output')
    });
}

function createApp(service) {
    const app = express();
    app.use(createProfileCatalogueRouter({ service }));
    return app;
}

async function requestApp(app, headers = {}) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/profiles`, { headers });
        const text = await response.text();
        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            text,
            body: text ? JSON.parse(text) : null
        };
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (
            error ? reject(error) : resolve()
        )));
    }
}

function assertNoPublicMaxProperty(value, location = 'catalogue') {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.hasOwn(value, 'max'), false, `${location} exposes an ambiguous .max`);
    for (const [key, child] of Object.entries(value)) {
        assertNoPublicMaxProperty(child, `${location}.${key}`);
    }
}

function findProfile(engine, printerId, layerHeight = 0.2, material = null) {
    return snapshot.body.profiles.find((profile) => (
        profile.engine === engine
        && profile.printer.id === printerId
        && profile.layer_height_mm === layerHeight
        && profile.material === material
    ));
}

test.before(async () => {
    snapshot = await buildProfileCatalogue({ engineVersions: ENGINE_VERSIONS, createWorkspace });
});

test.after(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
});

test('server-owned manifest covers P1S, the P1S-physics quote chains, and the Bambu vendor chains', () => {
    const definitions = createPresetDefinitions();
    assert.equal(definitions.length, 82);
    assert.equal(definitions.filter((item) => item.engine === 'prusa').length, 6);
    assert.equal(definitions.filter((item) => item.engine === 'orca').length, 24);
    assert.equal(definitions.filter((item) => item.engine === 'bambu').length, 52);
    assert.deepEqual(
        [...new Set(definitions.map((item) => item.printer.id))].sort(),
        ['H2D', 'H2D-QUOTE', 'P1S']
    );
    assert.equal(definitions.some((item) => (
        item.profileOverrides.orcaMachineProfile === 'Bambu_H2D_0.4_nozzle.json'
    )), false);
    assert.ok(definitions.every((item) => item.technology === 'FDM'));
    for (const engine of ['orca', 'bambu']) {
        assert.deepEqual(
            [...new Set(definitions.filter((item) => item.engine === engine)
                .map((item) => item.material))].sort(),
            ['ABS', 'PETG', 'PLA', 'TPU'],
            engine
        );
    }
    const bambu = definitions.filter((item) => item.engine === 'bambu');
    assert.deepEqual(
        [...new Set(bambu.filter((item) => item.printer.id === 'P1S').map((item) => item.layerKey))],
        ['0.08', '0.1', '0.12', '0.16', '0.2', '0.24', '0.28']
    );
    assert.deepEqual(
        [...new Set(bambu.filter((item) => item.printer.id === 'H2D').map((item) => item.layerKey))],
        ['0.08', '0.1', '0.12', '0.16', '0.2', '0.24']
    );
    assert.ok(bambu.every((item) => item.bedType === 'Textured PEI Plate'));
    assert.ok(bambu.every((item) => Number.parseFloat(item.layerKey) === item.layerHeight));
});

test('v2 publishes explicit declared metadata and authoritative inclusive ceilings', () => {
    assert.equal(snapshot.body.schema, 'r3d-profile-catalogue-v2');
    assert.match(snapshot.body.catalogue_sha256, /^[a-f0-9]{64}$/);
    assert.match(snapshot.etag, /^"[a-f0-9]{64}"$/);
    assert.equal(snapshot.body.profiles.length, 82);
    assert.equal(new Set(snapshot.body.profiles.map((entry) => entry.id)).size, 82);
    assert.ok(snapshot.body.profiles.every((entry) => entry.technology === 'FDM'));
    assertNoPublicMaxProperty(snapshot.body);

    const expectedLimitKeys = [
        'declared_build_volume_dimensions_mm',
        'declared_source_kind',
        'largest_passing_dimensions_inclusive_mm',
        'minimum_dimensions_inclusive_mm',
        'source_profile'
    ];
    for (const profile of snapshot.body.profiles) {
        assert.deepEqual(Object.keys(profile.build_volume_limits_mm).sort(), expectedLimitKeys);
        assert.deepEqual(profile.build_volume_limits_mm.minimum_dimensions_inclusive_mm, minimum);
        assert.equal(profile.build_volume_limits_mm.declared_source_kind, 'profile-explicit');
        assert.equal(profile.effective_profile_identity_schema, DIGEST_SCHEMA);
        assert.match(profile.effective_profile_sha256, /^[a-f0-9]{64}$/);
    }
    assert.match(snapshot.body.semantics.build_volume_dimensions, /not an admission limit/i);
    assert.match(snapshot.body.semantics.build_volume_dimensions, /exact boundary value/i);
    assert.match(snapshot.body.semantics.fleet_derivation, /engine-scoped/i);
    assert.match(snapshot.body.semantics.scope, /Fallback-only SLA presets are never machine entries/);
    assert.match(snapshot.body.semantics.scope, /ABS and TPU/);
    assert.equal(Object.isFrozen(snapshot.body), true);
    assert.equal(Object.isFrozen(snapshot.body.profiles[0].printer), true);
    assert.equal(Object.isFrozen(snapshot.body.machine_resolutions[0]), true);
    assert.equal(Object.isFrozen(snapshot.body.fleet_resolutions[0]), true);
});

test('P1S declared dimensions remain physical while admission ceilings are engine-specific', () => {
    const prusa = findProfile('prusa', 'P1S');
    const orca = findProfile('orca', 'P1S', 0.2, 'PLA');
    for (const profile of [prusa, orca]) {
        assert.deepEqual(
            profile.build_volume_limits_mm.declared_build_volume_dimensions_mm,
            { x: 256, y: 256, z: 250 }
        );
    }
    assert.deepEqual(
        prusa.build_volume_limits_mm.largest_passing_dimensions_inclusive_mm,
        { x: 256, y: 256, z: 249.9 }
    );
    assert.deepEqual(
        orca.build_volume_limits_mm.largest_passing_dimensions_inclusive_mm,
        { x: 253.9, y: 253.9, z: 249.9 }
    );
    assert.equal(orca.engine_version, ENGINE_VERSIONS.orca);
    assert.equal(orca.material_scope, 'exact');
    assert.deepEqual(orca.profile_components, [
        {
            role: 'machine',
            basename: 'Bambu_P1S_0.4_nozzle.json',
            selector_parameter: 'printerProfile'
        },
        {
            role: 'process',
            basename: 'FDM_0.2mm.json',
            selector_parameter: 'processProfile'
        },
        { role: 'filament', basename: 'PLA_generic.json', selector_parameter: null }
    ]);
    assert.equal(orca.filament_diameter_mm, 1.75);
    assert.equal(orca.filament_density_g_cm3, 1.24);
    assert.equal(prusa.material_scope, 'request-independent');
    assert.equal(prusa.filament_diameter_mm, 1.75);
    assert.equal(prusa.filament_density_g_cm3, null);
});

test('quote rows expose exact selectors and measured enlarged native ceilings', () => {
    const prusa = findProfile('prusa', 'H2D-QUOTE');
    const orca = findProfile('orca', 'H2D-QUOTE', 0.2, 'PLA');
    assert.deepEqual(prusa.slice_selector, {
        endpoint: '/prusa/slice',
        parameters: [{
            name: 'printerProfile',
            value: 'FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini'
        }]
    });
    assert.deepEqual(orca.slice_selector, {
        endpoint: '/orca/slice',
        parameters: [
            {
                name: 'printerProfile',
                value: 'Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json'
            },
            { name: 'processProfile', value: 'FDM_0.2mm.json' }
        ]
    });
    for (const profile of [prusa, orca]) {
        assert.equal(profile.printer.name, 'H2D-sized quote (P1S physics)');
        assert.deepEqual(
            profile.build_volume_limits_mm.declared_build_volume_dimensions_mm,
            { x: 350, y: 320, z: 325 }
        );
    }
    assert.deepEqual(
        prusa.build_volume_limits_mm.largest_passing_dimensions_inclusive_mm,
        { x: 350, y: 320, z: 324.9 }
    );
    assert.deepEqual(
        orca.build_volume_limits_mm.largest_passing_dimensions_inclusive_mm,
        { x: 347.9, y: 317.9, z: 324.9 }
    );
});

test('selector parameters remain uniquely derived from the ordered component chain', () => {
    for (const entry of snapshot.body.profiles) {
        const expectedParameters = entry.profile_components
            .filter((component) => component.selector_parameter !== null)
            .map((component) => ({
                name: component.selector_parameter,
                value: component.basename
            }));
        const componentNames = new Set(expectedParameters.map((parameter) => parameter.name));
        // Prusa/Orca selectors are exactly the component-derived list; Bambu
        // prepends the registry printer id, layer key, and material before the
        // same component-derived tail.
        const derived = entry.slice_selector.parameters
            .filter((parameter) => componentNames.has(parameter.name));
        assert.deepEqual(derived, expectedParameters, entry.id);
        if (entry.engine !== 'bambu') {
            assert.deepEqual(entry.slice_selector.parameters, expectedParameters, entry.id);
        } else {
            assert.deepEqual(
                entry.slice_selector.parameters.map((parameter) => parameter.name),
                ['printerProfile', 'layerHeight', 'material', 'processProfile'],
                entry.id
            );
        }
        assert.equal(
            new Set(entry.slice_selector.parameters.map((parameter) => parameter.name)).size,
            entry.slice_selector.parameters.length,
            entry.id
        );
    }
});

test('bambu rows name the official vendor chain, registry selectors, and measured ceilings', () => {
    const p1s = findProfile('bambu', 'P1S', 0.1, 'PLA');
    assert.equal(p1s.id, 'bambu:FDM:P1S:0.1:PLA:Bambu-Lab-P1S-0.4-nozzle');
    assert.equal(p1s.engine_version, ENGINE_VERSIONS.bambu);
    assert.equal(p1s.material_scope, 'exact');
    assert.deepEqual(p1s.printer, BAMBU_P1S);
    assert.deepEqual(p1s.slice_selector, {
        endpoint: '/bambu/slice',
        parameters: [
            { name: 'printerProfile', value: 'P1S' },
            { name: 'layerHeight', value: '0.1' },
            { name: 'material', value: 'PLA' },
            { name: 'processProfile', value: '0.12mm Fine @BBL X1C' }
        ]
    });
    assert.deepEqual(p1s.profile_components, [
        { role: 'machine', basename: 'Bambu Lab P1S 0.4 nozzle', selector_parameter: null },
        { role: 'process', basename: '0.12mm Fine @BBL X1C', selector_parameter: 'processProfile' },
        { role: 'filament', basename: 'Generic PLA', selector_parameter: null }
    ]);
    assert.deepEqual(p1s.build_volume_limits_mm, {
        declared_build_volume_dimensions_mm: { x: 256, y: 256, z: 250 },
        declared_source_kind: 'profile-explicit',
        largest_passing_dimensions_inclusive_mm: { x: 256, y: 228, z: 250 },
        minimum_dimensions_inclusive_mm: minimum,
        source_profile: 'Bambu Lab P1S 0.4 nozzle'
    });
    assert.equal(p1s.filament_diameter_mm, 1.75);
    assert.equal(p1s.filament_density_g_cm3, 1.24);

    const h2d = findProfile('bambu', 'H2D', 0.2, 'ABS');
    assert.deepEqual(h2d.printer, BAMBU_H2D);
    assert.equal(h2d.slice_selector.parameters.at(-1).value, '0.20mm Standard @BBL H2D');
    assert.equal(h2d.profile_components[2].basename, 'Generic ABS @BBL H2D');
    assert.deepEqual(
        h2d.build_volume_limits_mm.declared_build_volume_dimensions_mm,
        { x: 350, y: 320, z: 325 }
    );
    assert.deepEqual(
        h2d.build_volume_limits_mm.largest_passing_dimensions_inclusive_mm,
        { x: 325, y: 320, z: 325 }
    );
    assert.equal(h2d.filament_density_g_cm3, 1.04);
    assert.equal(findProfile('bambu', 'H2D', 0.28, 'PLA'), undefined);

    // Same printer, different vendor process (0.1 uses the 0.12 process with an
    // overridden layer height) must never share a digest with the 0.12 row.
    const p1sFine = findProfile('bambu', 'P1S', 0.12, 'PLA');
    assert.equal(p1sFine.slice_selector.parameters.at(-1).value, '0.12mm Fine @BBL X1C');
    assert.equal(p1s.effective_profile_sha256, p1sFine.effective_profile_sha256);
    assert.notEqual(p1s.effective_profile_sha256, findProfile('bambu', 'P1S', 0.2, 'PLA').effective_profile_sha256);
    assert.notEqual(p1s.effective_profile_sha256, findProfile('bambu', 'P1S', 0.1, 'PETG').effective_profile_sha256);
    assert.notEqual(p1s.effective_profile_sha256, findProfile('bambu', 'H2D', 0.1, 'PLA').effective_profile_sha256);
    assert.match(snapshot.body.semantics.scope, /Bambu Studio rows/);
    // Measured on the production CLI with API-owned placement; the P1S L-shape is disclosed.
    assert.doesNotMatch(snapshot.body.semantics.build_volume_dimensions, /provisional/i);
    assert.match(snapshot.body.semantics.build_volume_dimensions, /measured on the production CLI/i);
    assert.match(snapshot.body.semantics.build_volume_dimensions, /--arrange 0/);
    assert.match(snapshot.body.semantics.build_volume_dimensions, /256 x 228 mm/);
    assert.match(snapshot.body.semantics.build_volume_dimensions, /238 x 256 mm/);
    assert.match(snapshot.body.semantics.build_volume_dimensions, /first extruder area/);
});

test('machine and fleet resolutions preserve per-engine admission authority', () => {
    assert.deepEqual(snapshot.body.machine_resolutions, [
        {
            technology: 'FDM',
            printer: BAMBU_H2D,
            engine: 'bambu',
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 325, y: 320, z: 325 }
        },
        {
            technology: 'FDM',
            printer: BAMBU_P1S,
            engine: 'bambu',
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 256, y: 228, z: 250 }
        },
        {
            technology: 'FDM',
            printer: { id: 'H2D-QUOTE', name: 'H2D-sized quote (P1S physics)' },
            engine: 'orca',
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 347.9, y: 317.9, z: 324.9 }
        },
        {
            technology: 'FDM',
            printer: { id: 'P1S', name: 'Bambu Lab P1S' },
            engine: 'orca',
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 253.9, y: 253.9, z: 249.9 }
        },
        {
            technology: 'FDM',
            printer: { id: 'H2D-QUOTE', name: 'H2D-sized quote (P1S physics)' },
            engine: 'prusa',
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 350, y: 320, z: 324.9 }
        },
        {
            technology: 'FDM',
            printer: { id: 'P1S', name: 'Bambu Lab P1S' },
            engine: 'prusa',
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 256, y: 256, z: 249.9 }
        }
    ]);
    assert.deepEqual(snapshot.body.fleet_resolutions, [
        {
            technology: 'FDM',
            engine: 'bambu',
            status: 'resolved',
            reason: null,
            printers: [BAMBU_H2D],
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 325, y: 320, z: 325 },
            excluded_printers: []
        },
        {
            technology: 'FDM',
            engine: 'orca',
            status: 'resolved',
            reason: null,
            printers: [{ id: 'H2D-QUOTE', name: 'H2D-sized quote (P1S physics)' }],
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 347.9, y: 317.9, z: 324.9 },
            excluded_printers: []
        },
        {
            technology: 'FDM',
            engine: 'prusa',
            status: 'resolved',
            reason: null,
            printers: [{ id: 'H2D-QUOTE', name: 'H2D-sized quote (P1S physics)' }],
            minimum_dimensions_inclusive_mm: minimum,
            largest_passing_dimensions_inclusive_mm: { x: 350, y: 320, z: 324.9 },
            excluded_printers: []
        }
    ]);
});

test('same-engine preset drift fails for both declared and largest-passing dimensions', () => {
    for (const [field, delta] of [
        ['declared_build_volume_dimensions_mm', 0.1],
        ['largest_passing_dimensions_inclusive_mm', -0.1]
    ]) {
        const profiles = structuredClone(snapshot.body.profiles);
        const changed = profiles.find((profile) => (
            profile.printer.id === 'H2D-QUOTE' && profile.engine === 'prusa'
        ));
        changed.build_volume_limits_mm[field].x += delta;
        assert.throws(
            () => deriveMachineAndFleetResolutions(profiles),
            /FDM printer H2D-QUOTE engine prusa has inconsistent preset envelopes/
        );
    }
});

test('v2 dimensional publication is fail-closed for missing and oversized values', async () => {
    const controlled = [
        {
            min: { ...minimum },
            max: { x: 10, y: 10, z: 10 },
            declaredMax: { x: 10, y: 10 },
            largestPassingDimensionsInclusive: { x: 10, y: 10, z: 10 },
            sourceProfile: 'controlled.ini',
            explicitMaxAxes: { x: true, y: true, z: true }
        },
        {
            min: { ...minimum },
            max: { x: 11, y: 10, z: 10 },
            declaredMax: { x: 10, y: 10, z: 10 },
            largestPassingDimensionsInclusive: { x: 11, y: 10, z: 10 },
            sourceProfile: 'controlled.ini',
            explicitMaxAxes: { x: true, y: true, z: true }
        }
    ];
    for (const limits of controlled) {
        await assert.rejects(
            buildProfileCatalogue({
                engineVersions: ENGINE_VERSIONS,
                createWorkspace,
                dependencies: { resolveBuildVolumeLimits() { return limits; } }
            }),
            /exact object contract|invalid machine envelope/
        );
    }
});

test('catalogue still refuses fallback-only and partial explicit machine metadata', async () => {
    for (const controlledLimits of [
        {
            min: { ...minimum },
            max: { x: 120, y: 120, z: 150 },
            declaredMax: { x: 120, y: 120, z: 150 },
            largestPassingDimensionsInclusive: { x: 120, y: 120, z: 150 },
            sourceProfile: 'fallback-only.ini',
            explicitMaxAxes: { x: false, y: false, z: false }
        },
        {
            min: { ...minimum },
            max: { x: 256, y: 256, z: 324.9 },
            declaredMax: { x: 256, y: 256, z: 325 },
            largestPassingDimensionsInclusive: { x: 256, y: 256, z: 324.9 },
            sourceProfile: 'partial.ini',
            explicitMaxAxes: { x: true, y: true, z: false }
        }
    ]) {
        await assert.rejects(
            buildProfileCatalogue({
                engineVersions: ENGINE_VERSIONS,
                createWorkspace,
                dependencies: {
                    resolveBuildVolumeLimits() { return controlledLimits; }
                }
            }),
            /explicit machine-profile build-volume metadata/
        );
    }
    for (const directory of ['jobs', 'scratch']) {
        assert.deepEqual(await fsPromises.readdir(path.join(root, directory)), []);
    }
});

test('entry validation rejects ambiguous fields and non-explicit declared provenance', () => {
    const entry = structuredClone(snapshot.body.profiles[0]);
    entry.build_volume_limits_mm.max = { x: 1, y: 1, z: 1 };
    assert.throws(
        () => validateCatalogueEntryIdentity(entry),
        /build-volume limits violates its exact object contract/
    );

    const wrongProvenance = structuredClone(snapshot.body.profiles[0]);
    wrongProvenance.build_volume_limits_mm.declared_source_kind = 'fallback';
    assert.throws(
        () => validateCatalogueEntryIdentity(wrongProvenance),
        /declared build-volume source kind is invalid/
    );

    const nonPrintableVersion = structuredClone(snapshot.body.profiles[0]);
    nonPrintableVersion.engine_version = 'version\nprivate';
    assert.throws(
        () => validateCatalogueEntryIdentity(nonPrintableVersion),
        /engine version violates/
    );
});

test('duplicate public profile ids fail catalogue derivation before publication', () => {
    const profiles = structuredClone(snapshot.body.profiles.slice(0, 2));
    profiles[1].id = profiles[0].id;
    assert.throws(
        () => deriveMachineAndFleetResolutions(profiles),
        /profile id .* is duplicated/
    );
});

test('incomparable same-engine machines publish unresolved fleet without synthetic ceiling', () => {
    const quote = structuredClone(findProfile('orca', 'H2D-QUOTE', 0.2, 'PLA'));
    const p1s = structuredClone(findProfile('orca', 'P1S', 0.2, 'PLA'));
    quote.build_volume_limits_mm.largest_passing_dimensions_inclusive_mm.y = 200;
    const derived = deriveMachineAndFleetResolutions([quote, p1s]);
    assert.deepEqual(derived.fleetResolutions, [{
        technology: 'FDM',
        engine: 'orca',
        status: 'unresolved',
        reason: 'no_dominant_machine',
        printers: [],
        minimum_dimensions_inclusive_mm: null,
        largest_passing_dimensions_inclusive_mm: null,
        excluded_printers: []
    }]);
});

test('selector and public identity contracts reject ambiguity and paths', () => {
    assert.throws(
        () => buildSliceSelector(
            { engine: 'future-sla' },
            [
                { role: 'machine', basename: 'machine.json', selector_parameter: 'profile' },
                { role: 'process', basename: 'process.json', selector_parameter: 'profile' }
            ]
        ),
        /duplicate selector parameter/
    );
    const pathEntry = structuredClone(snapshot.body.profiles[0]);
    pathEntry.build_volume_limits_mm.source_profile = '../private.ini';
    assert.throws(
        () => validateCatalogueEntryIdentity(pathEntry),
        /build-volume source profile violates/
    );
});

test('same startup inputs produce the same generation and resolution mutations change digest', async () => {
    const second = await buildProfileCatalogue({ engineVersions: ENGINE_VERSIONS, createWorkspace });
    assert.equal(second.body.catalogue_sha256, snapshot.body.catalogue_sha256);
    assert.equal(second.serializedBody, snapshot.serializedBody);
    const content = {
        schema: snapshot.body.schema,
        semantics: snapshot.body.semantics,
        profiles: snapshot.body.profiles,
        machine_resolutions: snapshot.body.machine_resolutions,
        fleet_resolutions: snapshot.body.fleet_resolutions
    };
    assert.equal(hashCatalogueContent(content), snapshot.body.catalogue_sha256);
    assert.notEqual(hashCatalogueContent({
        ...content,
        fleet_resolutions: content.fleet_resolutions.map((fleet) => ({
            ...fleet,
            largest_passing_dimensions_inclusive_mm: {
                ...fleet.largest_passing_dimensions_inclusive_mm,
                x: fleet.largest_passing_dimensions_inclusive_mm.x - 0.1
            }
        }))
    }), snapshot.body.catalogue_sha256);
});

test('one failed preset waits for in-flight work before exact workspace cleanup', async () => {
    let selectionCalls = 0;
    let delayedWorkSettled = false;
    let cleanupObservedSettledWork = false;
    const delayedWorkspace = async () => {
        const workspace = await createWorkspace();
        const originalCleanup = workspace.cleanup;
        workspace.cleanup = async (reason) => {
            cleanupObservedSettledWork = delayedWorkSettled;
            return originalCleanup(reason);
        };
        return workspace;
    };
    await assert.rejects(
        buildProfileCatalogue({
            engineVersions: ENGINE_VERSIONS,
            createWorkspace: delayedWorkspace,
            dependencies: {
                resolveProfileSelection(...args) {
                    selectionCalls += 1;
                    if (selectionCalls === 2) {
                        return {
                            isValid: false,
                            response: { errorCode: 'CONTROLLED_PRESET_FAILURE' }
                        };
                    }
                    return resolveProfileSelection(...args);
                },
                async snapshotProfileSelection(...args) {
                    if (!delayedWorkSettled) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                        delayedWorkSettled = true;
                    }
                    return snapshotProfileSelection(...args);
                }
            }
        }),
        /CONTROLLED_PRESET_FAILURE/
    );
    assert.equal(cleanupObservedSettledWork, true);
    for (const directory of ['jobs', 'scratch']) {
        assert.deepEqual(await fsPromises.readdir(path.join(root, directory)), []);
    }
});

test('every managed preset digest matches the production slice preparation chain', async () => {
    for (const definition of createPresetDefinitions()) {
        const workspace = await createWorkspace();
        try {
            const selection = resolveProfileSelection(
                definition.engine,
                definition.technology,
                definition.layerHeight,
                definition.profileOverrides,
                definition.material
            );
            assert.equal(selection.isValid, true);
            const snapshots = await snapshotProfileSelection(
                definition.engine, selection, workspace
            );
            const runtimeConfigFile = await createRuntimeSlicerProfile(
                definition.engine,
                snapshots.baseConfigFile,
                definition.technology,
                definition.layerHeight,
                '20%',
                workspace
            );
            const liveDigest = calculateEffectiveProfileSha256({
                engine: definition.engine,
                technology: definition.technology,
                material: definition.material,
                runtimeConfigFile,
                orcaMachineConfigFile: snapshots.orcaMachineConfigFile,
                orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile,
                bambuPrinterId: definition.engine === 'bambu' ? definition.printer.id : null,
                bambuBedType: definition.engine === 'bambu' ? definition.bedType : null
            });
            const entry = snapshot.body.profiles.find((candidate) => (
                candidate.engine === definition.engine
                && candidate.technology === definition.technology
                && candidate.printer.id === definition.printer.id
                && candidate.layer_height_mm === definition.layerHeight
                && candidate.material === definition.material
            ));
            assert.ok(entry, JSON.stringify(definition));
            assert.equal(entry.effective_profile_sha256, liveDigest, entry.id);
        } finally {
            await workspace.cleanup('catalogue_parity');
        }
    }
});

test('catalogue service failure stays non-critical and runtime ceilings remain independent', async () => {
    const statusEvents = [];
    const unavailable = createProfileCatalogueService({
        build: async () => { throw new Error('controlled catalogue failure'); },
        onStatusChange: (event) => statusEvents.push(event)
    });
    assert.deepEqual(await unavailable.initialize({ engineVersions: ENGINE_VERSIONS }), {
        ready: false,
        status: 'unavailable'
    });
    assert.equal(unavailable.getSnapshot(), null);
    assert.equal(unavailable.getStatus(), 'unavailable');
    assert.deepEqual(statusEvents, [{ ready: false, status: 'unavailable' }]);

    const selection = resolveProfileSelection(
        'prusa', 'FDM', 0.2, { prusaProfile: 'FDM_0.2mm.ini' }, null
    );
    assert.equal(selection.isValid, true);
    assert.deepEqual(
        resolveBuildVolumeLimits(
            'prusa', 'FDM', selection.baseConfigFile, null, selection.baseConfigFile
        ).max,
        { x: 256, y: 256, z: 249.9 }
    );

    const available = createProfileCatalogueService({ build: async () => snapshot });
    assert.deepEqual(await available.initialize({ engineVersions: ENGINE_VERSIONS }), {
        ready: true,
        status: 'ready'
    });
    assert.equal(available.getSnapshot(), snapshot);
    assert.equal(available.getStatus(), 'ready');
});

test('GET /profiles retains ETag and typed unavailable behavior for v2', async () => {
    const response = await requestApp(createApp({ getSnapshot: () => snapshot }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.etag, snapshot.etag);
    assert.equal(response.headers['access-control-expose-headers'], 'ETag');
    assert.equal(response.headers['cache-control'], 'public, max-age=0, must-revalidate');
    assert.equal(response.body.schema, 'r3d-profile-catalogue-v2');
    assert.equal(response.body.catalogue_sha256, snapshot.body.catalogue_sha256);
    assert.deepEqual(response.body.profiles, snapshot.body.profiles);
    assert.deepEqual(response.body.machine_resolutions, snapshot.body.machine_resolutions);
    assert.deepEqual(response.body.fleet_resolutions, snapshot.body.fleet_resolutions);

    const unchanged = await requestApp(
        createApp({ getSnapshot: () => snapshot }),
        { 'If-None-Match': snapshot.etag }
    );
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.text, '');
    assert.equal(matchesIfNoneMatch(`"stale", W/${snapshot.etag}`, snapshot.etag), true);
    assert.equal(matchesIfNoneMatch('*', snapshot.etag), true);
    assert.equal(
        (await requestApp(
            createApp({ getSnapshot: () => snapshot }),
            { 'If-None-Match': '"stale"' }
        )).status,
        200
    );

    const unavailable = await requestApp(createApp({ getSnapshot: () => null }));
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers['cache-control'], 'no-store');
    assert.deepEqual(unavailable.body, {
        success: false,
        error: 'Profile catalogue is unavailable.',
        errorCode: 'PROFILE_CATALOGUE_UNAVAILABLE'
    });
});
