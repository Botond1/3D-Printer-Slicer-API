'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');

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

const ENGINE_VERSIONS = Object.freeze({ prusa: '2.8.1-test', orca: '2.3.1-test' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2-profile-catalogue-'));
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

test.before(async () => {
    snapshot = await buildProfileCatalogue({ engineVersions: ENGINE_VERSIONS, createWorkspace });
});

test.after(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
});

test('server-owned preset manifest is closed and excludes custom or dynamic materials', () => {
    const definitions = createPresetDefinitions();
    assert.equal(definitions.length, 15);
    assert.equal(definitions.filter((item) => item.engine === 'prusa').length, 3);
    assert.equal(definitions.filter((item) => item.engine === 'orca').length, 12);
    assert.ok(definitions.every((item) => item.technology === 'FDM'));
    assert.deepEqual(
        [...new Set(definitions.filter((item) => item.engine === 'orca')
            .map((item) => item.material))].sort(),
        ['PETG', 'PLA']
    );
    assert.ok(definitions.every((item) => item.profileOverrides.prusaProfile
        || item.profileOverrides.orcaMachineProfile));
});

test('startup catalogue publishes deterministic digest, engine, bounds, and filament facts', async () => {
    assert.match(snapshot.body.catalogue_sha256, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.etag, `"${snapshot.body.catalogue_sha256}"`);
    assert.equal(snapshot.body.profiles.length, 15);
    assert.equal(new Set(snapshot.body.profiles.map((entry) => entry.id)).size, 15);
    assert.ok(snapshot.body.profiles.every((entry) => entry.technology === 'FDM'));
    assert.ok(snapshot.body.profiles.every((entry) => (
        entry.effective_profile_identity_schema === DIGEST_SCHEMA
        && entry.build_volume_limits_mm.max_source_kind === 'profile-explicit'
    )));
    assert.ok(!snapshot.body.profiles.some((entry) => {
        const maximum = entry.build_volume_limits_mm.max;
        return maximum.x === 120 && maximum.y === 120 && maximum.z === 150;
    }));
    assert.match(snapshot.body.semantics.scope, /Fallback-only SLA presets are never machine entries/);
    assert.match(snapshot.body.semantics.scope, /same v1 entry schema/);
    assert.match(snapshot.body.semantics.scope, /ABS and TPU/);
    assert.equal(Object.isFrozen(snapshot.body), true);
    assert.equal(Object.isFrozen(snapshot.body.profiles[0].printer), true);
    assert.equal(Object.isFrozen(snapshot.body.machine_resolutions[0]), true);
    assert.equal(Object.isFrozen(snapshot.body.fleet_resolutions[0].maximum), true);

    const p1sPla = snapshot.body.profiles.find((entry) => (
        entry.engine === 'orca'
        && entry.layer_height_mm === 0.2
        && entry.material === 'PLA'
        && entry.profile_components.some((component) => (
            component.role === 'machine'
            && component.basename === 'Bambu_P1S_0.4_nozzle.json'
        ))
    ));
    assert.ok(p1sPla);
    assert.equal(p1sPla.engine_version, ENGINE_VERSIONS.orca);
    assert.deepEqual(p1sPla.printer, { id: 'P1S', name: 'Bambu Lab P1S' });
    assert.match(p1sPla.effective_profile_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(p1sPla.build_volume_limits_mm.max, { x: 256, y: 256, z: 250 });
    assert.equal(p1sPla.build_volume_limits_mm.max_source_kind, 'profile-explicit');
    assert.equal(p1sPla.effective_profile_identity_schema, DIGEST_SCHEMA);
    assert.deepEqual(p1sPla.slice_selector, {
        endpoint: '/orca/slice',
        parameters: [
            { name: 'printerProfile', value: 'Bambu_P1S_0.4_nozzle.json' },
            { name: 'processProfile', value: 'FDM_0.2mm.json' }
        ]
    });
    assert.deepEqual(p1sPla.profile_components, [
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
    assert.equal(p1sPla.filament_diameter_mm, 1.75);
    assert.equal(p1sPla.filament_density_g_cm3, 1.24);

    const h2dPetg = snapshot.body.profiles.find((entry) => (
        entry.engine === 'orca'
        && entry.material === 'PETG'
        && entry.profile_components.some((component) => (
            component.role === 'machine'
            && component.basename === 'Bambu_H2D_0.4_nozzle.json'
        ))
    ));
    assert.deepEqual(h2dPetg.build_volume_limits_mm.max, { x: 350, y: 320, z: 325 });
    assert.deepEqual(h2dPetg.printer, { id: 'H2D', name: 'Bambu Lab H2D' });

    const prusaFdm = snapshot.body.profiles.find((entry) => (
        entry.engine === 'prusa' && entry.technology === 'FDM'
    ));
    assert.equal(prusaFdm.material, null);
    assert.equal(prusaFdm.material_scope, 'request-independent');
    assert.equal(prusaFdm.filament_diameter_mm, 1.75);
    assert.equal(prusaFdm.filament_density_g_cm3, null);
    assert.deepEqual(prusaFdm.slice_selector, {
        endpoint: '/prusa/slice',
        parameters: [{
            name: 'printerProfile', value: `FDM_${prusaFdm.layer_height_mm}mm.ini`
        }]
    });
    assert.deepEqual(prusaFdm.profile_components, [{
        role: 'combined',
        basename: `FDM_${prusaFdm.layer_height_mm}mm.ini`,
        selector_parameter: 'printerProfile'
    }]);

    for (const directory of ['jobs', 'scratch']) {
        assert.deepEqual(await fsPromises.readdir(path.join(root, directory)), []);
    }
});

test('selector parameters are uniquely derived from the ordered profile component chain', () => {
    for (const entry of snapshot.body.profiles) {
        const expectedParameters = entry.profile_components
            .filter((component) => component.selector_parameter !== null)
            .map((component) => ({
                name: component.selector_parameter,
                value: component.basename
            }));
        assert.deepEqual(entry.slice_selector.parameters, expectedParameters, entry.id);
        assert.equal(
            new Set(entry.slice_selector.parameters.map((parameter) => parameter.name)).size,
            entry.slice_selector.parameters.length,
            entry.id
        );
    }

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
});

test('runtime publication rejects path-bearing and non-printable public identities', () => {
    const entry = snapshot.body.profiles[0];
    assert.throws(
        () => validateCatalogueEntryIdentity({
            ...entry,
            build_volume_limits_mm: {
                ...entry.build_volume_limits_mm,
                source_profile: '../private.ini'
            }
        }),
        /build-volume source profile violates/
    );
    assert.throws(
        () => validateCatalogueEntryIdentity({
            ...entry,
            engine_version: 'version\nprivate'
        }),
        /engine version violates/
    );
});

test('catalogue refuses fallback-equal and partial machine envelopes before publication', async () => {
    for (const controlledLimits of [
        {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 120, y: 120, z: 150 },
            sourceProfile: 'fallback-only.ini',
            explicitMaxAxes: { x: false, y: false, z: false }
        },
        {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 256, y: 256, z: 325 },
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

test('machine envelopes resolve only after every engine agrees and fleet maximum names a machine', () => {
    const fdmProfiles = snapshot.body.profiles.filter((entry) => entry.technology === 'FDM');
    const p1sProfiles = fdmProfiles.filter((entry) => entry.printer.id === 'P1S');
    assert.ok(p1sProfiles.length > 0);
    assert.ok(p1sProfiles.every((entry) => (
        entry.build_volume_limits_mm.max.x === 256
        && entry.build_volume_limits_mm.max.y === 256
        && entry.build_volume_limits_mm.max.z === 250
    )));

    assert.deepEqual(snapshot.body.machine_resolutions, [
        {
            technology: 'FDM',
            printer: { id: 'H2D', name: 'Bambu Lab H2D' },
            engines: ['orca'],
            status: 'resolved',
            reason: null,
            resolved_build_volume_limits_mm: {
                min: { x: 1, y: 1, z: 1 },
                max: { x: 350, y: 320, z: 325 }
            }
        },
        {
            technology: 'FDM',
            printer: { id: 'P1S', name: 'Bambu Lab P1S' },
            engines: ['orca', 'prusa'],
            status: 'resolved',
            reason: null,
            resolved_build_volume_limits_mm: {
                min: { x: 1, y: 1, z: 1 },
                max: { x: 256, y: 256, z: 250 }
            }
        }
    ]);
    assert.deepEqual(snapshot.body.fleet_resolutions, [{
        technology: 'FDM',
        status: 'resolved',
        reason: null,
        maximum: {
            printers: [{ id: 'H2D', name: 'Bambu Lab H2D' }],
            build_volume_limits_mm: {
                min: { x: 1, y: 1, z: 1 },
                max: { x: 350, y: 320, z: 325 }
            }
        },
        excluded_printers: []
    }]);
    assert.equal(Object.hasOwn(snapshot.body, 'fleet_max'), false);
    assert.match(snapshot.body.semantics.fleet_derivation, /never resolved by selecting/);
});

test('cross-engine conflict keeps every profile row, excludes only that machine, and stays loud', () => {
    const profiles = structuredClone(snapshot.body.profiles);
    for (const profile of profiles) {
        if (profile.printer.id === 'P1S' && profile.engine === 'orca') {
            profile.build_volume_limits_mm.max.x = 250;
        }
    }
    const originalProfileIds = snapshot.body.profiles.map((profile) => profile.id);
    const { machineResolutions, fleetResolutions } = deriveMachineAndFleetResolutions(profiles);

    assert.deepEqual(profiles.map((profile) => profile.id), originalProfileIds);
    assert.equal(profiles.filter((profile) => profile.printer.id === 'P1S').length, 9);
    assert.deepEqual(
        [...new Set(profiles.filter((profile) => profile.printer.id === 'P1S')
            .map((profile) => profile.build_volume_limits_mm.max.x))].sort((a, b) => a - b),
        [250, 256]
    );
    assert.deepEqual(
        machineResolutions.find((machine) => machine.printer.id === 'P1S'),
        {
            technology: 'FDM',
            printer: { id: 'P1S', name: 'Bambu Lab P1S' },
            engines: ['orca', 'prusa'],
            status: 'excluded',
            reason: 'cross_engine_conflict',
            resolved_build_volume_limits_mm: null
        }
    );
    assert.deepEqual(fleetResolutions, [{
        technology: 'FDM',
        status: 'resolved',
        reason: null,
        maximum: {
            printers: [{ id: 'H2D', name: 'Bambu Lab H2D' }],
            build_volume_limits_mm: {
                min: { x: 1, y: 1, z: 1 },
                max: { x: 350, y: 320, z: 325 }
            }
        },
        excluded_printers: [{
            printer: { id: 'P1S', name: 'Bambu Lab P1S' },
            reason: 'cross_engine_conflict'
        }]
    }]);
    assert.equal(
        machineResolutions.some((machine) => (
            machine.printer.id === 'P1S'
            && machine.resolved_build_volume_limits_mm?.max.x === 250
        )),
        false,
        'a smaller cross-engine component must never become the resolved envelope'
    );
});

test('same-engine preset envelope drift fails catalogue derivation instead of hiding the row', () => {
    const profiles = structuredClone(snapshot.body.profiles);
    const changed = profiles.find((profile) => (
        profile.printer.id === 'P1S' && profile.engine === 'orca'
    ));
    changed.build_volume_limits_mm.max.y -= 1;
    assert.throws(
        () => deriveMachineAndFleetResolutions(profiles),
        /FDM printer P1S engine orca has inconsistent preset envelopes/
    );
    assert.equal(profiles.length, snapshot.body.profiles.length);
});

test('duplicate public profile ids fail catalogue derivation before publication', () => {
    const profiles = structuredClone(snapshot.body.profiles.slice(0, 2));
    profiles[1].id = profiles[0].id;
    assert.throws(
        () => deriveMachineAndFleetResolutions(profiles),
        /profile id .* is duplicated/
    );
});

test('v1 resolves mixed synthetic FDM and SLA fleets independently by technology', () => {
    const syntheticFdm = structuredClone(snapshot.body.profiles[0]);
    syntheticFdm.id = 'future-fdm:FDM:SCHEMA-MACHINE:0.2';
    syntheticFdm.engine = 'future-fdm';
    syntheticFdm.technology = 'FDM';
    syntheticFdm.printer = { id: 'SCHEMA-MACHINE', name: 'Synthetic schema machine' };
    syntheticFdm.build_volume_limits_mm.max = { x: 10, y: 10, z: 10 };

    const syntheticSla = structuredClone(syntheticFdm);
    syntheticSla.id = 'future-sla:SLA:SCHEMA-MACHINE:0.05';
    syntheticSla.engine = 'future-sla';
    syntheticSla.technology = 'SLA';
    syntheticSla.build_volume_limits_mm.max = { x: 20, y: 20, z: 20 };

    const mixed = deriveMachineAndFleetResolutions([
        ...structuredClone(snapshot.body.profiles), syntheticFdm, syntheticSla
    ]);
    const syntheticMachines = mixed.machineResolutions.filter((machine) => (
        machine.printer.id === 'SCHEMA-MACHINE'
    ));
    assert.deepEqual(syntheticMachines.map((machine) => ({
        technology: machine.technology,
        maximum: machine.resolved_build_volume_limits_mm.max
    })), [
        { technology: 'FDM', maximum: { x: 10, y: 10, z: 10 } },
        { technology: 'SLA', maximum: { x: 20, y: 20, z: 20 } }
    ]);
    assert.deepEqual(mixed.fleetResolutions.map((fleet) => ({
        technology: fleet.technology,
        printers: fleet.maximum.printers,
        maximum: fleet.maximum.build_volume_limits_mm.max
    })), [
        {
            technology: 'FDM',
            printers: [{ id: 'H2D', name: 'Bambu Lab H2D' }],
            maximum: { x: 350, y: 320, z: 325 }
        },
        {
            technology: 'SLA',
            printers: [{ id: 'SCHEMA-MACHINE', name: 'Synthetic schema machine' }],
            maximum: { x: 20, y: 20, z: 20 }
        }
    ]);

    const conflictingSla = structuredClone(syntheticSla);
    conflictingSla.id = 'future-sla-alt:SLA:SCHEMA-MACHINE:0.05';
    conflictingSla.engine = 'future-sla-alt';
    conflictingSla.build_volume_limits_mm.max.x = 19;
    const isolated = deriveMachineAndFleetResolutions([
        ...structuredClone(snapshot.body.profiles), syntheticFdm, syntheticSla, conflictingSla
    ]);
    assert.deepEqual(isolated.fleetResolutions[0], mixed.fleetResolutions[0]);
    assert.deepEqual(isolated.fleetResolutions[1], {
        technology: 'SLA',
        status: 'unresolved',
        reason: 'no_resolved_machine',
        maximum: null,
        excluded_printers: [{
            printer: { id: 'SCHEMA-MACHINE', name: 'Synthetic schema machine' },
            reason: 'cross_engine_conflict'
        }]
    });
});

test('conflict on the largest machine narrows the fleet ceiling to a remaining real machine', () => {
    const h2dOrca = structuredClone(snapshot.body.profiles.find((profile) => (
        profile.printer.id === 'H2D'
    )));
    const h2dSecondEngine = structuredClone(h2dOrca);
    h2dSecondEngine.id = `${h2dOrca.id}:future-engine`;
    h2dSecondEngine.engine = 'future-engine';
    h2dSecondEngine.build_volume_limits_mm.max.x -= 1;
    const p1s = structuredClone(snapshot.body.profiles.find((profile) => (
        profile.printer.id === 'P1S'
    )));
    const derived = deriveMachineAndFleetResolutions([h2dOrca, h2dSecondEngine, p1s]);

    assert.deepEqual(derived.machineResolutions.find((machine) => (
        machine.printer.id === 'H2D'
    )).resolved_build_volume_limits_mm, null);
    assert.deepEqual(derived.fleetResolutions[0].maximum, {
        printers: [{ id: 'P1S', name: 'Bambu Lab P1S' }],
        build_volume_limits_mm: {
            min: { x: 1, y: 1, z: 1 },
            max: { x: 256, y: 256, z: 250 }
        }
    });
    assert.deepEqual(derived.fleetResolutions[0].excluded_printers, [{
        printer: { id: 'H2D', name: 'Bambu Lab H2D' },
        reason: 'cross_engine_conflict'
    }]);
});

test('incomparable resolved machines expose an unresolved fleet instead of synthesizing maxima', () => {
    const h2d = structuredClone(snapshot.body.profiles.find((profile) => (
        profile.printer.id === 'H2D'
    )));
    const p1s = structuredClone(snapshot.body.profiles.find((profile) => (
        profile.printer.id === 'P1S'
    )));
    h2d.build_volume_limits_mm.max.y = 200;
    p1s.build_volume_limits_mm.max.y = 300;
    const derived = deriveMachineAndFleetResolutions([h2d, p1s]);
    assert.deepEqual(derived.fleetResolutions, [{
        technology: 'FDM',
        status: 'unresolved',
        reason: 'no_dominant_machine',
        maximum: null,
        excluded_printers: []
    }]);
});

test('same startup inputs produce the same catalogue generation', async () => {
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
        machine_resolutions: content.machine_resolutions.map((machine) => (
            machine.printer.id === 'P1S'
                ? { ...machine, status: 'excluded' }
                : machine
        ))
    }), snapshot.body.catalogue_sha256);
    assert.notEqual(hashCatalogueContent({
        ...content,
        fleet_resolutions: content.fleet_resolutions.map((fleet) => ({
            ...fleet,
            excluded_printers: [{
                printer: { id: 'MUTATED', name: 'Digest mutation' },
                reason: 'cross_engine_conflict'
            }]
        }))
    }), snapshot.body.catalogue_sha256);
});

test('one failed preset waits for all in-flight work before exact workspace cleanup', async () => {
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
                orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile
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

test('catalogue service failure is non-critical and leaves slicing state independent', async () => {
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
        { x: 256, y: 256, z: 250 }
    );

    const available = createProfileCatalogueService({ build: async () => snapshot });
    assert.deepEqual(await available.initialize({ engineVersions: ENGINE_VERSIONS }), {
        ready: true,
        status: 'ready'
    });
    assert.equal(available.getSnapshot(), snapshot);
});

test('public GET /profiles supports strong and weak conditional ETags', async () => {
    const service = { getSnapshot: () => snapshot };
    const response = await requestApp(createApp(service));
    assert.equal(response.status, 200);
    assert.equal(response.headers.etag, snapshot.etag);
    assert.equal(response.headers['access-control-expose-headers'], 'ETag');
    assert.equal(response.headers['cache-control'], 'public, max-age=0, must-revalidate');
    assert.equal(response.body.catalogue_sha256, snapshot.body.catalogue_sha256);
    assert.deepEqual(response.body.profiles, snapshot.body.profiles);
    assert.deepEqual(response.body.machine_resolutions, snapshot.body.machine_resolutions);
    assert.deepEqual(response.body.fleet_resolutions, snapshot.body.fleet_resolutions);

    const unchanged = await requestApp(createApp(service), { 'If-None-Match': snapshot.etag });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.text, '');
    assert.equal(
        (await requestApp(createApp(service), {
            'If-None-Match': `"stale", W/${snapshot.etag}`
        })).status,
        304
    );
    assert.equal(
        (await requestApp(createApp(service), { 'If-None-Match': '"stale"' })).status,
        200
    );
    assert.equal(matchesIfNoneMatch('*', snapshot.etag), true);
});

test('unavailable catalogue returns typed 503 without authentication', async () => {
    const response = await requestApp(createApp({ getSnapshot: () => null }));
    assert.equal(response.status, 503);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, {
        success: false,
        error: 'Profile catalogue is unavailable.',
        errorCode: 'PROFILE_CATALOGUE_UNAVAILABLE'
    });
});
