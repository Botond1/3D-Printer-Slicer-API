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
const {
    readBambuFilamentProfileMetadata,
    readOrcaFilamentProfileMetadata,
    resolveMaterialFilamentMetadata
} = require('./filament-profile');
const { readIniKeyValues } = require('./profile-readers');
const { parseNumberLike } = require('./value-parsers');
const {
    getBambuAllowedLayerKeys,
    getBambuMaterials,
    getBambuPrinter,
    getBambuPrinterRegistry,
    resolveBambuProcessName
} = require('./bambu-printer-registry');

const PROFILE_CATALOGUE_SCHEMA = 'r3d-profile-catalogue-v2';
/**
 * Public string contracts. `basename` covers repository file basenames AND
 * Bambu vendor profile names such as `0.20mm Standard @BBL X1C`, so it admits
 * spaces, `@`, and `+` while still refusing path separators and a leading dot.
 */
const CATALOGUE_STRING_CONTRACTS = Object.freeze({
    basename: Object.freeze({ min: 1, max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9 @._+-]{0,127}$/ }),
    engine: Object.freeze({ min: 1, max: 32, pattern: /^[a-z][a-z0-9-]{0,31}$/ }),
    engineVersion: Object.freeze({ min: 1, max: 128, pattern: /^[\x20-\x7e]{1,128}$/ }),
    entryId: Object.freeze({ min: 1, max: 256, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/ }),
    printerId: Object.freeze({ min: 1, max: 64, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ }),
    printerName: Object.freeze({ min: 1, max: 128, pattern: /^[\x20-\x7e]{1,128}$/ }),
    profileRole: Object.freeze({ min: 1, max: 32, pattern: /^[a-z][a-z0-9-]{0,31}$/ }),
    selectorParameter: Object.freeze({ min: 1, max: 64, pattern: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/ })
});
const SERVER_OWNED_PRUSA_MACHINES = Object.freeze([
    Object.freeze({ id: 'P1S', name: 'Bambu Lab P1S', profilePrefix: 'FDM_' }),
    Object.freeze({
        id: 'H2D-QUOTE',
        name: 'H2D-sized quote (P1S physics)',
        profilePrefix: 'FDM_P1S_H2D_SIZE_QUOTING_'
    })
]);
const SERVER_OWNED_ORCA_MACHINES = Object.freeze([
    Object.freeze({ id: 'P1S', name: 'Bambu Lab P1S', profile: 'Bambu_P1S_0.4_nozzle.json' }),
    Object.freeze({
        id: 'H2D-QUOTE',
        name: 'H2D-sized quote (P1S physics)',
        profile: 'Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json'
    })
]);
const CATALOGUE_SEMANTICS = Object.freeze({
    authority: 'informational',
    enforcement: 'Slice endpoints remain authoritative and enforce build-volume limits.',
    availability: 'Slicing does not depend on this catalogue endpoint.',
    freshness: 'ETag and catalogue_sha256 identify the process startup generation.',
    build_volume_dimensions: 'declared_build_volume_dimensions_mm is physical/profile-declared metadata, not an admission limit. largest_passing_dimensions_inclusive_mm is the authoritative validation ceiling and accepts an exact boundary value. Bambu Studio ceilings are provisional until the native envelope sweep replaces them.',
    fleet_derivation: 'Machine and fleet resolutions are engine-scoped because native slicers can have different inclusive admission ceilings for the same declared profile dimensions. Every per-profile ceiling remains visible. Presets within one technology, printer, and engine must agree exactly. Each technology and engine fleet names every machine whose largest-passing envelope contains every other resolved machine envelope in that engine. Ceilings are never synthesized component by component.',
    scope: 'Catalogue v2 lists machine-bound server-owned FDM presets on every engine, including explicitly named H2D-sized quoting profiles that retain P1S physics and are not production H2D G-code profiles, and Bambu Studio rows that use the official vendor machine/process/filament chain by name for the P1S and H2D. Server-owned filament profiles now cover PLA, PETG, ABS and TPU. Fallback-only SLA presets are never machine entries. Custom profile overrides and materials without a server-owned filament profile remain outside the catalogue.'
});

/** Bambu vendor names are not file paths; only file-backed selections take a basename. */
function profileName(filePath) {
    return filePath ? path.basename(filePath) : null;
}

/**
 * Public identifier token derived from a vendor name: spaces and other
 * characters outside the entry-id contract collapse to `-`.
 * @param {string} name Vendor profile name.
 * @returns {string} Entry-id safe token.
 */
function vendorNameToken(name) {
    return String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
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

/**
 * Build the endpoint selector. Parameters are derived from the ordered
 * component chain; engines whose request contract selects by registry id and
 * layer/material (Bambu) prepend those leading parameters, and every name is
 * unique and bounded.
 * @param {{engine: string}} definition Preset definition.
 * @param {Array<{basename: string, selector_parameter: string|null}>} profileComponents Ordered components.
 * @param {Array<{name: string, value: string}>} [leadingParameters=[]] Request parameters not backed by a component.
 * @returns {{endpoint: string, parameters: Array<{name: string, value: string}>}} Selector.
 */
function buildSliceSelector(definition, profileComponents, leadingParameters = []) {
    requireCatalogueString(definition?.engine, CATALOGUE_STRING_CONTRACTS.engine, 'engine');
    if (!Array.isArray(profileComponents)
        || profileComponents.length < 1
        || profileComponents.length > 16) {
        throw new Error('Catalogue profile component count is outside the public contract.');
    }
    const parameters = [];
    const parameterNames = new Set();
    const pushParameter = (name, value) => {
        requireCatalogueString(name, CATALOGUE_STRING_CONTRACTS.selectorParameter, 'selector parameter name');
        requireCatalogueString(value, CATALOGUE_STRING_CONTRACTS.basename, 'selector parameter value');
        if (parameterNames.has(name)) {
            throw new Error('Catalogue profile components contain a duplicate selector parameter.');
        }
        parameterNames.add(name);
        parameters.push({ name, value });
    };
    for (const parameter of leadingParameters) pushParameter(parameter.name, parameter.value);
    for (const component of profileComponents) {
        if (component.selector_parameter === null) continue;
        pushParameter(component.selector_parameter, component.basename);
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
    requireExactObjectKeys(entry.build_volume_limits_mm, [
        'declared_build_volume_dimensions_mm',
        'declared_source_kind',
        'largest_passing_dimensions_inclusive_mm',
        'minimum_dimensions_inclusive_mm',
        'source_profile'
    ], 'build-volume limits');
    if (entry.build_volume_limits_mm.declared_source_kind !== 'profile-explicit') {
        throw new Error('Catalogue declared build-volume source kind is invalid.');
    }
    copyEnvelope(entry);
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
    if (definition.engine === 'bambu') {
        // Vendor NAMES, verbatim. The machine is selected through the registry
        // printer id (a leading selector parameter), the process may be named
        // explicitly, and the filament follows the material.
        return [
            { role: 'machine', basename: selection.orcaMachineConfigFile, selector_parameter: null },
            { role: 'process', basename: selection.baseConfigFile, selector_parameter: 'processProfile' },
            { role: 'filament', basename: selection.orcaFilamentConfigFile, selector_parameter: null }
        ];
    }
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

function buildLeadingSelectorParameters(definition) {
    if (definition.engine !== 'bambu') return [];
    return [
        { name: 'printerProfile', value: definition.printer.id },
        { name: 'layerHeight', value: definition.layerKey },
        { name: 'material', value: definition.material }
    ];
}

function createBambuPresetDefinitions(registry) {
    const definitions = [];
    for (const printerId of Object.keys(registry.printers).sort()) {
        const printer = getBambuPrinter(printerId, registry);
        for (const layerKey of getBambuAllowedLayerKeys(printerId, registry)) {
            for (const material of getBambuMaterials(printerId, registry)) {
                definitions.push(Object.freeze({
                    engine: 'bambu', technology: 'FDM',
                    layerHeight: Number.parseFloat(layerKey), layerKey, material,
                    bedType: printer.bedType,
                    printer: Object.freeze({ id: printer.id, name: printer.name }),
                    profileOverrides: Object.freeze({
                        bambuPrinter: printer.id,
                        bambuProcessProfile: resolveBambuProcessName(printerId, layerKey, null, registry)
                    })
                }));
            }
        }
    }
    return definitions;
}

function createPresetDefinitions(options = {}) {
    const definitions = [];
    for (const machine of SERVER_OWNED_PRUSA_MACHINES) {
        for (const layerHeight of LAYER_HEIGHTS.BY_TECHNOLOGY.FDM) {
            definitions.push(Object.freeze({
                engine: 'prusa', technology: 'FDM', layerHeight, material: null,
                printer: Object.freeze({ id: machine.id, name: machine.name }),
                profileOverrides: Object.freeze({
                    prusaProfile: `${machine.profilePrefix}${layerHeight}mm.ini`
                })
            }));
        }
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
    definitions.push(...createBambuPresetDefinitions(options.bambuRegistry || getBambuPrinterRegistry()));
    return Object.freeze(definitions);
}

/**
 * The repository Prusa profiles are material-agnostic, so diameter comes from
 * the profile while density comes from the shared material catalogue -- the
 * same source the runtime profile is built from. Reporting null here once the
 * runtime injects a real density would make the catalogue describe a service
 * that no longer exists.
 */
function readPrusaFilamentMetadata(profilePath, technology, material = null) {
    if (technology !== 'FDM') return null;
    const diameterMm = parseNumberLike(readIniKeyValues(profilePath).filament_diameter);
    if (!Number.isFinite(diameterMm) || diameterMm <= 0) {
        throw new Error('Prusa FDM profile filament diameter is unavailable.');
    }
    const densityGcm3 = resolveMaterialFilamentMetadata(material)?.densityGcm3 ?? null;
    return Object.freeze({ diameterMm, densityGcm3 });
}

function buildEntryId(definition, selection) {
    const parts = [
        definition.engine, definition.technology, definition.printer.id,
        `${definition.layerHeight}`
    ];
    if (definition.material) parts.push(definition.material);
    if (definition.engine === 'bambu') {
        parts.push(vendorNameToken(selection.orcaMachineConfigFile));
    } else {
        parts.push(profileName(
            definition.engine === 'orca' ? selection.orcaMachineConfigFile : selection.baseConfigFile
        ));
    }
    return parts.join(':');
}

function readCatalogueFilamentMetadata(definition, snapshots, dependencies) {
    if (definition.engine === 'bambu') {
        return dependencies.readBambuFilamentProfileMetadata(
            snapshots.orcaFilamentConfigFile, definition.material
        );
    }
    if (definition.engine === 'orca') {
        return dependencies.readOrcaFilamentProfileMetadata(
            snapshots.orcaFilamentConfigFile, definition.material
        );
    }
    return readPrusaFilamentMetadata(
        snapshots.baseConfigFile, definition.technology, definition.material
    );
}

function resolveCatalogueBambuContext(definition) {
    if (definition.engine !== 'bambu') return { printerId: null, bedType: null };
    if (typeof definition.bedType !== 'string' || !definition.bedType) {
        throw new Error('Bambu catalogue definition requires the registry bed type.');
    }
    return { printerId: definition.printer.id, bedType: definition.bedType };
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
    const metadata = readCatalogueFilamentMetadata(definition, snapshots, dependencies);
    // The density must be injected here exactly as the slice path injects it,
    // or the catalogue would digest a runtime profile that no real request ever
    // produces and every effective_profile_sha256 comparison would diverge.
    const runtimeConfigFile = await dependencies.createRuntimeSlicerProfile(
        definition.engine,
        snapshots.baseConfigFile,
        definition.technology,
        definition.layerHeight,
        `${DEFAULTS.DEFAULT_INFIL_PERCENT}%`,
        workspace,
        { filamentDensityGcm3: metadata?.densityGcm3 }
    );
    const limits = dependencies.resolveBuildVolumeLimits(
        definition.engine,
        definition.technology,
        snapshots.baseConfigFile,
        snapshots.orcaMachineConfigFile,
        definition.engine === 'prusa'
            ? selection.baseConfigFile
            : selection.orcaMachineConfigFile
    );
    if (!limits?.explicitMaxAxes
        || !['x', 'y', 'z'].every((axis) => limits.explicitMaxAxes[axis] === true)) {
        throw new Error('Catalogue profile requires explicit machine-profile build-volume metadata.');
    }
    const bambu = resolveCatalogueBambuContext(definition);
    const digest = dependencies.calculateEffectiveProfileSha256({
        engine: definition.engine,
        technology: definition.technology,
        material: definition.material,
        runtimeConfigFile,
        orcaMachineConfigFile: snapshots.orcaMachineConfigFile,
        orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile,
        bambuPrinterId: bambu.printerId,
        bambuBedType: bambu.bedType
    });
    const profileComponents = buildProfileComponents(definition, selection);
    return validateCatalogueEntryIdentity({
        id: buildEntryId(definition, selection),
        engine: definition.engine,
        technology: definition.technology,
        layer_height_mm: definition.layerHeight,
        material: definition.material,
        material_scope: definition.engine === 'prusa' ? 'request-independent' : 'exact',
        printer: { ...definition.printer },
        slice_selector: buildSliceSelector(
            definition, profileComponents, buildLeadingSelectorParameters(definition)
        ),
        profile_components: profileComponents,
        effective_profile_sha256: digest,
        effective_profile_identity_schema: DIGEST_SCHEMA,
        engine_version: engineVersions[definition.engine],
        build_volume_limits_mm: {
            minimum_dimensions_inclusive_mm: { ...limits.min },
            declared_build_volume_dimensions_mm: { ...limits.declaredMax },
            largest_passing_dimensions_inclusive_mm: {
                ...limits.largestPassingDimensionsInclusive
            },
            source_profile: limits.sourceProfile,
            declared_source_kind: 'profile-explicit'
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

function requireExactObjectKeys(value, expectedKeys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedKeys].sort())) {
        throw new Error(`Catalogue ${label} violates its exact object contract.`);
    }
    return value;
}

function copyDimensionTriple(value, label) {
    requireExactObjectKeys(value, ['x', 'y', 'z'], label);
    const result = { x: value.x, y: value.y, z: value.z };
    if (!Object.values(result).every(Number.isFinite)) {
        throw new Error(`Catalogue ${label} must contain finite X/Y/Z dimensions.`);
    }
    return result;
}

function copyEnvelope(entry) {
    const limits = entry?.build_volume_limits_mm;
    const envelope = {
        minimum: copyDimensionTriple(
            limits?.minimum_dimensions_inclusive_mm,
            'minimum dimensions'
        ),
        declared: copyDimensionTriple(
            limits?.declared_build_volume_dimensions_mm,
            'declared build-volume dimensions'
        ),
        largestPassing: copyDimensionTriple(
            limits?.largest_passing_dimensions_inclusive_mm,
            'largest-passing dimensions'
        )
    };
    for (const axis of ['x', 'y', 'z']) {
        if (!Number.isFinite(envelope.minimum[axis])
            || envelope.minimum[axis] < 0
            || !Number.isFinite(envelope.declared[axis])
            || envelope.declared[axis] <= envelope.minimum[axis]
            || !Number.isFinite(envelope.largestPassing[axis])
            || envelope.largestPassing[axis] <= envelope.minimum[axis]
            || envelope.largestPassing[axis] > envelope.declared[axis]) {
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
        candidate.minimum[axis] <= other.minimum[axis]
        && candidate.largestPassing[axis] >= other.largestPassing[axis]
    ));
}

/**
 * Resolve per-machine and fleet envelopes within one native engine.
 * Presets inside one (technology, printer, engine) group must agree; disagreement is an
 * internal catalogue invariant failure. Native engines remain separate because their
 * authoritative largest-passing boundaries can differ for the same declared dimensions.
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
        const machineKey = `${technology}:${engine}:${printerId}`;
        const existing = machines.get(machineKey);
        if (existing && existing.printer.name !== printerName) {
            throw new Error(
                `Catalogue ${technology} printer ${printerId} has inconsistent names.`
            );
        }
        const machine = existing || {
            technology,
            engine,
            printer: { id: printerId, name: printerName },
            envelope: null
        };
        if (!existing) machines.set(machineKey, machine);

        const envelope = copyEnvelope(profile);
        if (machine.envelope
            && envelopeIdentity(machine.envelope) !== envelopeIdentity(envelope)) {
            throw new Error(
                `Catalogue ${technology} printer ${printerId} engine ${engine} has inconsistent preset envelopes.`
            );
        }
        machine.envelope ||= envelope;
    }

    const machineResolutions = [...machines.values()]
        .sort((left, right) => (
            left.technology < right.technology ? -1
                : left.technology > right.technology ? 1
                    : left.engine < right.engine ? -1
                        : left.engine > right.engine ? 1
                            : left.printer.id < right.printer.id ? -1
                                : left.printer.id > right.printer.id ? 1 : 0
        ))
        .map((machine) => ({
            technology: machine.technology,
            printer: { ...machine.printer },
            engine: machine.engine,
            status: 'resolved',
            reason: null,
            minimum_dimensions_inclusive_mm: { ...machine.envelope.minimum },
            largest_passing_dimensions_inclusive_mm: {
                ...machine.envelope.largestPassing
            }
        }));

    const fleets = new Map();
    for (const machine of machineResolutions) {
        const fleetKey = `${machine.technology}:${machine.engine}`;
        const fleet = fleets.get(fleetKey) || {
            technology: machine.technology,
            engine: machine.engine,
            machines: []
        };
        fleet.machines.push(machine);
        if (!fleets.has(fleetKey)) fleets.set(fleetKey, fleet);
    }
    const fleetResolutions = [...fleets.values()]
        .sort((left, right) => (
            left.technology < right.technology ? -1
                : left.technology > right.technology ? 1
                    : left.engine < right.engine ? -1
                        : left.engine > right.engine ? 1 : 0
        ))
        .map((fleet) => {
            const resolvedMachines = fleet.machines.filter((machine) => (
                machine.status === 'resolved'
            ));
            const excludedPrinters = fleet.machines
                .filter((machine) => machine.status === 'excluded')
                .map((machine) => ({
                    printer: { ...machine.printer },
                    reason: machine.reason
                }));

            if (resolvedMachines.length === 0) {
                return {
                    technology: fleet.technology,
                    engine: fleet.engine,
                    status: 'unresolved',
                    reason: 'no_resolved_machine',
                    printers: [],
                    minimum_dimensions_inclusive_mm: null,
                    largest_passing_dimensions_inclusive_mm: null,
                    excluded_printers: excludedPrinters
                };
            }
            const dominantMachines = resolvedMachines.filter((candidate) => (
                resolvedMachines.every((other) => envelopeContains(
                    {
                        minimum: candidate.minimum_dimensions_inclusive_mm,
                        largestPassing: candidate.largest_passing_dimensions_inclusive_mm
                    },
                    {
                        minimum: other.minimum_dimensions_inclusive_mm,
                        largestPassing: other.largest_passing_dimensions_inclusive_mm
                    }
                ))
            ));
            if (dominantMachines.length === 0) {
                return {
                    technology: fleet.technology,
                    engine: fleet.engine,
                    status: 'unresolved',
                    reason: 'no_dominant_machine',
                    printers: [],
                    minimum_dimensions_inclusive_mm: null,
                    largest_passing_dimensions_inclusive_mm: null,
                    excluded_printers: excludedPrinters
                };
            }
            const maximumEnvelope = {
                minimum: dominantMachines[0].minimum_dimensions_inclusive_mm,
                largestPassing: dominantMachines[0].largest_passing_dimensions_inclusive_mm
            };
            if (!dominantMachines.every((machine) => (
                envelopeIdentity({
                    minimum: machine.minimum_dimensions_inclusive_mm,
                    largestPassing: machine.largest_passing_dimensions_inclusive_mm
                })
                === envelopeIdentity(maximumEnvelope)
            ))) {
                throw new Error('Catalogue fleet dominance produced inconsistent maxima.');
            }
            return {
                technology: fleet.technology,
                engine: fleet.engine,
                status: 'resolved',
                reason: null,
                printers: dominantMachines.map((machine) => ({ ...machine.printer })),
                minimum_dimensions_inclusive_mm: { ...maximumEnvelope.minimum },
                largest_passing_dimensions_inclusive_mm: {
                    ...maximumEnvelope.largestPassing
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
        || !validVersion(engineVersions.orca) || !validVersion(engineVersions.bambu)) {
        throw new Error('Startup-verified slicer engine versions are required.');
    }
    const dependencies = {
        resolveProfileSelection,
        snapshotProfileSelection,
        createRuntimeSlicerProfile,
        resolveBuildVolumeLimits,
        calculateEffectiveProfileSha256,
        readBambuFilamentProfileMetadata,
        readOrcaFilamentProfileMetadata,
        ...(options.dependencies || {})
    };
    const workspace = await (options.createWorkspace || createJobWorkspace)();
    let entries;
    let failure = null;
    try {
        const results = await Promise.allSettled(
            createPresetDefinitions({ bambuRegistry: options.bambuRegistry }).map((definition) => (
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
    SERVER_OWNED_PRUSA_MACHINES,
    SERVER_OWNED_ORCA_MACHINES,
    buildSliceSelector,
    buildProfileCatalogue,
    createBambuPresetDefinitions,
    createPresetDefinitions,
    createProfileCatalogueService,
    deepFreeze,
    deriveMachineAndFleetResolutions,
    hashCatalogueContent,
    validateCatalogueEntryIdentity
};
