'use strict';

/** Startup-built, immutable catalogue for server-owned slicing presets. */

const crypto = require('node:crypto');
const path = require('node:path');
const {
    DEFAULTS,
    LAYER_HEIGHTS,
    ORCA_FILAMENT_PROFILE_BY_MATERIAL
} = require('../../config/constants');
const { createJobWorkspace } = require('./workspace');
const {
    createRuntimeSlicerProfile,
    resolveBuildVolumeLimits,
    resolveProfileSelection
} = require('./profiles');
const { snapshotProfileSelection } = require('./profile-snapshot');
const {
    calculateEffectiveProfileSha256,
    canonicalizeJsonValue,
    DIGEST_SCHEMA
} = require('./profile-digest');
const { readOrcaFilamentProfileMetadata } = require('./filament-profile');
const { readIniKeyValues } = require('./profile-readers');
const { parseNumberLike } = require('./value-parsers');

const PROFILE_CATALOGUE_SCHEMA = 'r3d-profile-catalogue-v1';
const CATALOGUE_STRING_CONTRACTS = Object.freeze({
    basename: Object.freeze({ min: 1, max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ }),
    engine: Object.freeze({ min: 1, max: 32, pattern: /^[a-z][a-z0-9-]{0,31}$/ }),
    engineVersion: Object.freeze({ min: 1, max: 128, pattern: /^[\x20-\x7e]{1,128}$/ }),
    entryId: Object.freeze({ min: 1, max: 256, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/ }),
    printerId: Object.freeze({ min: 1, max: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ }),
    printerName: Object.freeze({ min: 1, max: 128, pattern: /^[\x20-\x7e]{1,128}$/ }),
    profileRole: Object.freeze({ min: 1, max: 32, pattern: /^[a-z][a-z0-9-]{0,31}$/ }),
    selectorParameter: Object.freeze({ min: 1, max: 64, pattern: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/ })
});
const SERVER_OWNED_ORCA_MACHINES = Object.freeze([
    Object.freeze({ id: 'P1S', name: 'Bambu Lab P1S', profile: 'Bambu_P1S_0.4_nozzle.json' }),
    Object.freeze({ id: 'H2D', name: 'Bambu Lab H2D', profile: 'Bambu_H2D_0.4_nozzle.json' })
]);
const CATALOGUE_SEMANTICS = Object.freeze({
    authority: 'informational',
    enforcement: 'Slice endpoints remain authoritative and enforce build-volume limits.',
    availability: 'Slicing does not depend on this catalogue endpoint.',
    freshness: 'ETag and catalogue_sha256 identify the process startup generation.',
    fleet_derivation: 'Every per-profile envelope remains visible. Within each technology, a machine envelope resolves only when all of its engine envelopes agree exactly; a cross-engine conflict excludes only that machine-technology pair and is reported explicitly. Each technology has its own fleet resolution derived only from its resolved machines, naming every real machine whose envelope contains every other resolved machine envelope in that technology. Conflicts are never resolved by selecting component-wise smaller values.',
    scope: 'Catalogue v1 currently lists only machine-bound server-owned FDM presets. Fallback-only SLA presets are never machine entries; a later real machine-bound SLA preset can use this same v1 entry schema. Custom profile overrides and materials without a server-owned filament profile (including ABS and TPU) remain outside the catalogue.'
});

function profileName(filePath) {
    return filePath ? path.basename(filePath) : null;
}

function requireCatalogueString(value, contract, label) {
    if (typeof value !== 'string'
        || value.length < contract.min
        || value.length > contract.max
        || !contract.pattern.test(value)) {
        throw new Error(`Catalogue ${label} violates its public string contract.`);
    }
    return value;
}

function buildSliceSelector(definition, profileComponents) {
    requireCatalogueString(definition?.engine, CATALOGUE_STRING_CONTRACTS.engine, 'engine');
    if (!Array.isArray(profileComponents)
        || profileComponents.length < 1
        || profileComponents.length > 16) {
        throw new Error('Catalogue profile component count is outside the public contract.');
    }
    const parameters = [];
    const parameterNames = new Set();
    for (const component of profileComponents) {
        if (component.selector_parameter === null) continue;
        requireCatalogueString(
            component.selector_parameter,
            CATALOGUE_STRING_CONTRACTS.selectorParameter,
            'selector parameter name'
        );
        requireCatalogueString(
            component.basename,
            CATALOGUE_STRING_CONTRACTS.basename,
            'selector parameter value'
        );
        if (parameterNames.has(component.selector_parameter)) {
            throw new Error('Catalogue profile components contain a duplicate selector parameter.');
        }
        parameterNames.add(component.selector_parameter);
        parameters.push({
            name: component.selector_parameter,
            value: component.basename
        });
    }
    if (parameters.length === 0) {
        throw new Error('Catalogue profile requires at least one selector parameter.');
    }
    return {
        endpoint: `/${definition.engine}/slice`,
        parameters
    };
}

function validateCatalogueEntryIdentity(entry) {
    requireCatalogueString(entry.id, CATALOGUE_STRING_CONTRACTS.entryId, 'entry id');
    requireCatalogueString(entry.engine, CATALOGUE_STRING_CONTRACTS.engine, 'engine');
    if (!['FDM', 'SLA'].includes(entry.technology)) {
        throw new Error('Catalogue technology violates its public contract.');
    }
    requireCatalogueString(entry.printer?.id, CATALOGUE_STRING_CONTRACTS.printerId, 'printer id');
    requireCatalogueString(
        entry.printer?.name, CATALOGUE_STRING_CONTRACTS.printerName, 'printer name'
    );
    requireCatalogueString(
        entry.engine_version, CATALOGUE_STRING_CONTRACTS.engineVersion, 'engine version'
    );
    requireCatalogueString(
        entry.build_volume_limits_mm?.source_profile,
        CATALOGUE_STRING_CONTRACTS.basename,
        'build-volume source profile'
    );
    for (const component of entry.profile_components) {
        requireCatalogueString(component.role, CATALOGUE_STRING_CONTRACTS.profileRole, 'profile role');
        requireCatalogueString(
            component.basename, CATALOGUE_STRING_CONTRACTS.basename, 'profile basename'
        );
        if (component.selector_parameter !== null) {
            requireCatalogueString(
                component.selector_parameter,
                CATALOGUE_STRING_CONTRACTS.selectorParameter,
                'profile selector parameter'
            );
        }
    }
    return entry;
}

function buildProfileComponents(definition, selection) {
    if (definition.engine === 'orca') {
        return [
            {
                role: 'machine',
                basename: profileName(selection.orcaMachineConfigFile),
                selector_parameter: 'printerProfile'
            },
            {
                role: 'process',
                basename: profileName(selection.baseConfigFile),
                selector_parameter: 'processProfile'
            },
            {
                role: 'filament',
                basename: profileName(selection.orcaFilamentConfigFile),
                selector_parameter: null
            }
        ];
    }
    return [{
        role: 'combined',
        basename: profileName(selection.baseConfigFile),
        selector_parameter: 'printerProfile'
    }];
}

function createPresetDefinitions() {
    const definitions = [];
    for (const layerHeight of LAYER_HEIGHTS.BY_TECHNOLOGY.FDM) {
        definitions.push(Object.freeze({
            engine: 'prusa', technology: 'FDM', layerHeight, material: null,
            printer: Object.freeze({ id: 'P1S', name: 'Bambu Lab P1S' }),
            profileOverrides: Object.freeze({
                prusaProfile: `FDM_${layerHeight}mm.ini`
            })
        }));
    }
    for (const machine of SERVER_OWNED_ORCA_MACHINES) {
        for (const layerHeight of LAYER_HEIGHTS.ORCA) {
            for (const material of Object.keys(ORCA_FILAMENT_PROFILE_BY_MATERIAL).sort()) {
                definitions.push(Object.freeze({
                    engine: 'orca', technology: 'FDM', layerHeight, material,
                    printer: Object.freeze({ id: machine.id, name: machine.name }),
                    profileOverrides: Object.freeze({
                        orcaMachineProfile: machine.profile,
                        orcaProcessProfile: `FDM_${layerHeight.toFixed(1)}mm.json`
                    })
                }));
            }
        }
    }
    return Object.freeze(definitions);
}

function readPrusaFilamentMetadata(profilePath, technology) {
    if (technology !== 'FDM') return null;
    const diameterMm = parseNumberLike(readIniKeyValues(profilePath).filament_diameter);
    if (!Number.isFinite(diameterMm) || diameterMm <= 0) {
        throw new Error('Prusa FDM profile filament diameter is unavailable.');
    }
    return Object.freeze({ diameterMm, densityGcm3: null });
}

function buildEntryId(definition, selection) {
    const parts = [
        definition.engine, definition.technology, definition.printer.id,
        `${definition.layerHeight}`
    ];
    if (definition.material) parts.push(definition.material);
    parts.push(profileName(
        definition.engine === 'orca' ? selection.orcaMachineConfigFile : selection.baseConfigFile
    ));
    return parts.join(':');
}

async function buildCatalogueEntry(definition, engineVersions, workspace, dependencies) {
    const selection = dependencies.resolveProfileSelection(
        definition.engine,
        definition.technology,
        definition.layerHeight,
        definition.profileOverrides,
        definition.material
    );
    if (!selection.isValid) {
        throw new Error(`Server-owned catalogue profile is invalid: ${selection.response.errorCode}`);
    }
    const snapshots = await dependencies.snapshotProfileSelection(
        definition.engine, selection, workspace
    );
    const runtimeConfigFile = await dependencies.createRuntimeSlicerProfile(
        definition.engine,
        snapshots.baseConfigFile,
        definition.technology,
        definition.layerHeight,
        `${DEFAULTS.DEFAULT_INFIL_PERCENT}%`,
        workspace
    );
    const metadata = definition.engine === 'orca'
        ? dependencies.readOrcaFilamentProfileMetadata(
            snapshots.orcaFilamentConfigFile, definition.material
        )
        : readPrusaFilamentMetadata(snapshots.baseConfigFile, definition.technology);
    const limits = dependencies.resolveBuildVolumeLimits(
        definition.engine,
        definition.technology,
        snapshots.baseConfigFile,
        snapshots.orcaMachineConfigFile,
        definition.engine === 'orca'
            ? selection.orcaMachineConfigFile
            : selection.baseConfigFile
    );
    if (!limits?.explicitMaxAxes
        || !['x', 'y', 'z'].every((axis) => limits.explicitMaxAxes[axis] === true)) {
        throw new Error('Catalogue profile requires explicit machine-profile build-volume metadata.');
    }
    const digest = dependencies.calculateEffectiveProfileSha256({
        engine: definition.engine,
        technology: definition.technology,
        material: definition.material,
        runtimeConfigFile,
        orcaMachineConfigFile: snapshots.orcaMachineConfigFile,
        orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile
    });
    const profileComponents = buildProfileComponents(definition, selection);
    return validateCatalogueEntryIdentity({
        id: buildEntryId(definition, selection),
        engine: definition.engine,
        technology: definition.technology,
        layer_height_mm: definition.layerHeight,
        material: definition.material,
        material_scope: definition.engine === 'orca' ? 'exact' : 'request-independent',
        printer: { ...definition.printer },
        slice_selector: buildSliceSelector(definition, profileComponents),
        profile_components: profileComponents,
        effective_profile_sha256: digest,
        effective_profile_identity_schema: DIGEST_SCHEMA,
        engine_version: engineVersions[definition.engine],
        build_volume_limits_mm: {
            min: { ...limits.min },
            max: { ...limits.max },
            source_profile: limits.sourceProfile,
            max_source_kind: 'profile-explicit'
        },
        filament_diameter_mm: metadata?.diameterMm ?? null,
        filament_density_g_cm3: metadata?.densityGcm3 ?? null
    });
}

function hashCatalogueContent(content) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(canonicalizeJsonValue(content)), 'utf8')
        .digest('hex');
}

function copyEnvelope(entry) {
    const limits = entry?.build_volume_limits_mm;
    const envelope = {
        min: {
            x: limits?.min?.x,
            y: limits?.min?.y,
            z: limits?.min?.z
        },
        max: {
            x: limits?.max?.x,
            y: limits?.max?.y,
            z: limits?.max?.z
        }
    };
    for (const axis of ['x', 'y', 'z']) {
        if (!Number.isFinite(envelope.min[axis])
            || envelope.min[axis] < 0
            || !Number.isFinite(envelope.max[axis])
            || envelope.max[axis] <= envelope.min[axis]) {
            throw new Error('Catalogue profile has an invalid machine envelope.');
        }
    }
    return envelope;
}

function envelopeIdentity(envelope) {
    return JSON.stringify(canonicalizeJsonValue(envelope));
}

function envelopeContains(candidate, other) {
    return ['x', 'y', 'z'].every((axis) => (
        candidate.min[axis] <= other.min[axis]
        && candidate.max[axis] >= other.max[axis]
    ));
}

/**
 * Resolve per-machine envelopes without hiding profile or cross-engine disagreement.
 * Presets inside one (technology, printer, engine) group must agree; this is an internal
 * catalogue invariant and fails catalogue construction. A disagreement between engines
 * is a published exclusion for only that technology and machine, never a component-wise
 * minimum. Fleet ceilings are independently derived per technology.
 *
 * @param {object[]} profiles Canonical per-preset catalogue entries.
 * @returns {{machineResolutions: object[], fleetResolutions: object[]}}
 */
function deriveMachineAndFleetResolutions(profiles) {
    if (!Array.isArray(profiles)) {
        throw new Error('Catalogue profiles must be an array.');
    }

    const profileIds = new Set();
    const machines = new Map();
    for (const profile of profiles) {
        const profileId = requireCatalogueString(
            profile?.id, CATALOGUE_STRING_CONTRACTS.entryId, 'entry id'
        );
        if (profileIds.has(profileId)) {
            throw new Error(`Catalogue profile id ${profileId} is duplicated.`);
        }
        profileIds.add(profileId);
        const technology = profile?.technology;
        if (!['FDM', 'SLA'].includes(technology)) {
            throw new Error('Catalogue technology violates its public contract.');
        }
        const printerId = requireCatalogueString(
            profile?.printer?.id, CATALOGUE_STRING_CONTRACTS.printerId, 'printer id'
        );
        const printerName = requireCatalogueString(
            profile?.printer?.name, CATALOGUE_STRING_CONTRACTS.printerName, 'printer name'
        );
        const engine = requireCatalogueString(
            profile?.engine, CATALOGUE_STRING_CONTRACTS.engine, 'engine'
        );
        const machineKey = `${technology}:${printerId}`;
        const existing = machines.get(machineKey);
        if (existing && existing.printer.name !== printerName) {
            throw new Error(
                `Catalogue ${technology} printer ${printerId} has inconsistent names.`
            );
        }
        const machine = existing || {
            technology,
            printer: { id: printerId, name: printerName },
            engines: new Map()
        };
        if (!existing) machines.set(machineKey, machine);

        const envelope = copyEnvelope(profile);
        const engineEnvelope = machine.engines.get(engine);
        if (engineEnvelope && envelopeIdentity(engineEnvelope) !== envelopeIdentity(envelope)) {
            throw new Error(
                `Catalogue ${technology} printer ${printerId} engine ${engine} has inconsistent preset envelopes.`
            );
        }
        if (!engineEnvelope) machine.engines.set(engine, envelope);
    }

    const machineResolutions = [...machines.values()]
        .sort((left, right) => (
            left.technology < right.technology ? -1
                : left.technology > right.technology ? 1
                    : left.printer.id < right.printer.id ? -1
                        : left.printer.id > right.printer.id ? 1 : 0
        ))
        .map((machine) => {
            const engines = [...machine.engines.keys()].sort();
            const envelopes = engines.map((engine) => machine.engines.get(engine));
            const firstIdentity = envelopeIdentity(envelopes[0]);
            const agrees = envelopes.every((envelope) => (
                envelopeIdentity(envelope) === firstIdentity
            ));
            return agrees
                ? {
                    technology: machine.technology,
                    printer: { ...machine.printer },
                    engines,
                    status: 'resolved',
                    reason: null,
                    resolved_build_volume_limits_mm: envelopes[0]
                }
                : {
                    technology: machine.technology,
                    printer: { ...machine.printer },
                    engines,
                    status: 'excluded',
                    reason: 'cross_engine_conflict',
                    resolved_build_volume_limits_mm: null
                };
        });

    const technologies = [...new Set(machineResolutions.map((machine) => machine.technology))]
        .sort();
    const fleetResolutions = technologies.map((technology) => {
        const technologyMachines = machineResolutions.filter((machine) => (
            machine.technology === technology
        ));
        const resolvedMachines = technologyMachines.filter((machine) => (
            machine.status === 'resolved'
        ));
        const excludedPrinters = technologyMachines
            .filter((machine) => machine.status === 'excluded')
            .map((machine) => ({
                printer: { ...machine.printer },
                reason: machine.reason
            }));

        if (resolvedMachines.length === 0) {
            return {
                technology,
                status: 'unresolved',
                reason: 'no_resolved_machine',
                maximum: null,
                excluded_printers: excludedPrinters
            };
        }
        const dominantMachines = resolvedMachines.filter((candidate) => (
            resolvedMachines.every((other) => envelopeContains(
                candidate.resolved_build_volume_limits_mm,
                other.resolved_build_volume_limits_mm
            ))
        ));
        if (dominantMachines.length === 0) {
            return {
                technology,
                status: 'unresolved',
                reason: 'no_dominant_machine',
                maximum: null,
                excluded_printers: excludedPrinters
            };
        }
        const maximumEnvelope = dominantMachines[0].resolved_build_volume_limits_mm;
        if (!dominantMachines.every((machine) => (
            envelopeIdentity(machine.resolved_build_volume_limits_mm)
            === envelopeIdentity(maximumEnvelope)
        ))) {
            throw new Error('Catalogue fleet dominance produced inconsistent maxima.');
        }
        return {
            technology,
            status: 'resolved',
            reason: null,
            maximum: {
                printers: dominantMachines.map((machine) => ({ ...machine.printer })),
                build_volume_limits_mm: maximumEnvelope
            },
            excluded_printers: excludedPrinters
        };
    });

    return { machineResolutions, fleetResolutions };
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

async function buildProfileCatalogue(options = {}) {
    const engineVersions = options.engineVersions;
    const validVersion = (value) => typeof value === 'string'
        && value.length >= 1 && value.length <= 128 && /^[\x20-\x7e]+$/.test(value);
    if (!engineVersions || !validVersion(engineVersions.prusa)
        || !validVersion(engineVersions.orca)) {
        throw new Error('Startup-verified slicer engine versions are required.');
    }
    const dependencies = {
        resolveProfileSelection,
        snapshotProfileSelection,
        createRuntimeSlicerProfile,
        resolveBuildVolumeLimits,
        calculateEffectiveProfileSha256,
        readOrcaFilamentProfileMetadata,
        ...(options.dependencies || {})
    };
    const workspace = await (options.createWorkspace || createJobWorkspace)();
    let entries;
    let failure = null;
    try {
        const results = await Promise.allSettled(
            createPresetDefinitions().map((definition) => (
                buildCatalogueEntry(definition, engineVersions, workspace, dependencies)
            ))
        );
        failure = results.find((result) => result.status === 'rejected')?.reason || null;
        entries = results
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value);
    } catch (error) {
        failure = error;
    }
    try {
        await workspace.cleanup('profile_catalogue');
    } catch (error) {
        failure ||= error;
    }
    if (failure) throw failure;

    entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const { machineResolutions, fleetResolutions } = deriveMachineAndFleetResolutions(entries);
    const content = {
        schema: PROFILE_CATALOGUE_SCHEMA,
        semantics: CATALOGUE_SEMANTICS,
        profiles: entries,
        machine_resolutions: machineResolutions,
        fleet_resolutions: fleetResolutions
    };
    const catalogueSha256 = hashCatalogueContent(content);
    const body = deepFreeze(canonicalizeJsonValue({
        schema: content.schema,
        catalogue_sha256: catalogueSha256,
        semantics: content.semantics,
        profiles: content.profiles,
        machine_resolutions: content.machine_resolutions,
        fleet_resolutions: content.fleet_resolutions
    }));
    return Object.freeze({
        body,
        etag: `"${catalogueSha256}"`,
        serializedBody: JSON.stringify(body)
    });
}

function createProfileCatalogueService(options = {}) {
    const build = options.build || buildProfileCatalogue;
    const onStatusChange = typeof options.onStatusChange === 'function'
        ? options.onStatusChange
        : () => {};
    let snapshot = null;
    let status = 'uninitialized';
    return Object.freeze({
        async initialize(context) {
            try {
                snapshot = await build(context);
                status = 'ready';
            } catch {
                snapshot = null;
                status = 'unavailable';
            }
            try { onStatusChange(Object.freeze({ ready: status === 'ready', status })); } catch {}
            return Object.freeze({ ready: status === 'ready', status });
        },
        getSnapshot() { return snapshot; },
        getStatus() { return status; }
    });
}

module.exports = {
    CATALOGUE_SEMANTICS,
    CATALOGUE_STRING_CONTRACTS,
    PROFILE_CATALOGUE_SCHEMA,
    SERVER_OWNED_ORCA_MACHINES,
    buildSliceSelector,
    buildProfileCatalogue,
    createPresetDefinitions,
    createProfileCatalogueService,
    deepFreeze,
    deriveMachineAndFleetResolutions,
    hashCatalogueContent,
    validateCatalogueEntryIdentity
};
