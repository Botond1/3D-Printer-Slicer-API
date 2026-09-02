/**
 * Slicer profile resolution, build-volume parsing, and runtime profile generation.
 */

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const {
    DEFAULTS,
    ORCA_PROCESS_PROFILE_BY_LAYER,
    MAX_BUILD_VOLUMES,
    P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    SLA_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    FDM_VALIDATION_ONLY_DERATE_MM_BY_ENGINE,
    MIN_BUILD_VOLUMES
} = require('../../config/constants');
const { PRUSA_CONFIGS_DIR, ORCA_CONFIGS_DIR } = require('../../config/paths');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { readProfileText, readProfileJson, readIniKeyValues } = require('./profile-readers');
const { parseNumberLike } = require('./value-parsers');
const { roundToThree } = require('./common');
const { resolveOrcaFilamentConfigPath } = require('./filament-profile');
const { parseBambuBedGeometry } = require('./bambu-bed-geometry');
const { validateBambuPlacementLimits } = require('./bambu-placement');
const {
    getBambuPrinter,
    resolveBambuFilamentName,
    resolveBambuLayerKey,
    resolveBambuProcessName
} = require('./bambu-printer-registry');

const SUPPORT_OFF = '0';
const SUPPORT_ON = '1';

/**
 * Resolve Orca process profile filename from explicit override, env, or defaults.
 * @param {number|string} layerKey Requested layer key.
 * @param {string | null} [explicitProfile=null] Optional explicit process profile.
 * @returns {string} Resolved Orca process profile filename.
 */
function resolveOrcaProcessProfileName(layerKey, explicitProfile = null) {
    if (explicitProfile) return explicitProfile;

    const normalizedLayerKey = Number.parseFloat(layerKey).toFixed(1).replace('.', '_');
    const envKey = `ORCA_PROCESS_PROFILE_${normalizedLayerKey}`;
    const fromEnv = String(process.env[envKey] || '').trim();
    if (fromEnv) return fromEnv;

    const fallback = ORCA_PROCESS_PROFILE_BY_LAYER[Number.parseFloat(layerKey).toFixed(1)];
    if (fallback) return fallback;

    return `FDM_${Number.parseFloat(layerKey).toFixed(1)}mm.json`;
}

/**
 * Resolve base profile config file path for selected engine/technology.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Active layer height.
 * @param {{prusaProfile?: string | null, orcaMachineProfile?: string | null, orcaProcessProfile?: string | null}} [profileOverrides={}] Optional profile overrides.
 * @returns {string} Absolute config file path.
 */
function resolveConfigPath(engine, technology, layerHeight, profileOverrides = {}) {
    const normalizedLayer = Number.parseFloat(layerHeight).toFixed(1);
    const profileName = engine === 'orca'
        ? resolveOrcaProcessProfileName(normalizedLayer, profileOverrides.orcaProcessProfile)
        : (profileOverrides.prusaProfile || `${technology}_${layerHeight}mm.ini`);

    const baseDir = engine === 'orca' ? ORCA_CONFIGS_DIR : PRUSA_CONFIGS_DIR;
    return path.join(baseDir, profileName);
}

/**
 * Resolve Orca machine profile path from override/env/default.
 * @param {{orcaMachineProfile?: string | null}} [profileOverrides={}] Optional profile overrides.
 * @returns {string} Absolute Orca machine profile path.
 */
function resolveOrcaMachineConfigPath(profileOverrides = {}) {
    const requested = String(profileOverrides.orcaMachineProfile || '').trim();
    const configured = String(process.env.ORCA_MACHINE_PROFILE || '').trim();
    const profileName = requested || configured || DEFAULTS.ORCA_DEFAULT_MACHINE_PROFILE;
    return path.join(ORCA_CONFIGS_DIR, profileName);
}

/**
 * Parse planar coordinate list into rectangular X/Y dimensions.
 * @param {unknown[]} rawPoints Planar point list.
 * @returns {{x: number, y: number} | null} Parsed planar dimensions or null.
 */
function parsePlanarCoordinates(rawPoints) {
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) return null;

    const coords = [];
    for (const point of rawPoints) {
        if (typeof point !== 'string' && typeof point !== 'number' && typeof point !== 'bigint') continue;
        const match = /(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)/i.exec(String(point).trim());
        if (!match) continue;

        const x = Number.parseFloat(match[1]);
        const y = Number.parseFloat(match[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        coords.push({ x, y });
    }

    if (coords.length < 2) return null;

    const xValues = coords.map((item) => item.x);
    const yValues = coords.map((item) => item.y);

    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    const width = maxX - minX;
    const depth = maxY - minY;
    if (width <= 0 || depth <= 0) return null;

    return { x: width, y: depth };
}

/**
 * Build default min/max build-volume limits for technology.
 * @param {string} profilePath Source profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string, explicitMaxAxes: {x: boolean, y: boolean, z: boolean}}} Default limit object.
 */
function createDefaultBuildVolumeLimits(profilePath, technology) {
    const defaultMax = MAX_BUILD_VOLUMES[technology] || MAX_BUILD_VOLUMES.FDM;
    const defaultMin = MIN_BUILD_VOLUMES[technology] || MIN_BUILD_VOLUMES.FDM;
    return {
        min: { ...defaultMin },
        max: { ...defaultMax },
        sourceProfile: path.basename(profilePath),
        explicitMaxAxes: { x: false, y: false, z: false }
    };
}

/**
 * Assign axis value only when finite and positive.
 * @param {{x?: number, y?: number, z?: number}} target Mutable target object.
 * @param {'x'|'y'|'z'} axis Axis key.
 * @param {number | null} value Candidate value.
 * @returns {boolean} Whether the candidate was accepted and assigned.
 */
function assignPositiveAxisValue(target, axis, value) {
    if (Number.isFinite(value) && value > 0 && value <= resolveResourcePolicy().MAX_MODEL_DIMENSION_MM) {
        target[axis] = value;
        return true;
    }
    return false;
}

/**
 * Apply axis values from generic object onto target bounds.
 * @param {{x?: number, y?: number, z?: number}} target Mutable target object.
 * @param {Record<string, unknown> | null | undefined} sourceObject Source object.
 * @param {{x?: boolean, y?: boolean, z?: boolean} | null} [explicitAxes=null] Optional explicit-axis tracker.
 * @returns {void}
 */
function applyAxisValuesFromObject(target, sourceObject, explicitAxes = null) {
    if (!sourceObject || typeof sourceObject !== 'object') return;

    for (const axis of ['x', 'y', 'z']) {
        if (assignPositiveAxisValue(target, axis, parseNumberLike(sourceObject[axis]))
            && explicitAxes) {
            explicitAxes[axis] = true;
        }
    }
}

/**
 * Apply axis values from INI map using configured key mapping.
 * @param {{x?: number, y?: number, z?: number}} target Mutable target object.
 * @param {Record<string, string>} iniMap INI key/value map.
 * @param {{x: string, y: string, z: string}} keyMap Axis-to-INI-key mapping.
 * @param {{x?: boolean, y?: boolean, z?: boolean} | null} [explicitAxes=null] Optional explicit-axis tracker.
 * @returns {void}
 */
function applyAxisValuesFromIniMap(target, iniMap, keyMap, explicitAxes = null) {
    for (const axis of ['x', 'y', 'z']) {
        if (assignPositiveAxisValue(target, axis, parseNumberLike(iniMap[keyMap[axis]]))
            && explicitAxes) {
            explicitAxes[axis] = true;
        }
    }
}

/**
 * Parse build-volume limits from Orca machine profile JSON.
 * @param {string} machineConfigPath Orca machine profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string, explicitMaxAxes: {x: boolean, y: boolean, z: boolean}}} Parsed limits.
 */
function parseDimensionLimitsFromOrcaMachineProfile(machineConfigPath, technology) {
    const limits = createDefaultBuildVolumeLimits(machineConfigPath, technology);

    if (!machineConfigPath || !fs.existsSync(machineConfigPath)) return limits;

    const profileData = readProfileJson(machineConfigPath);
    const printableArea = parsePlanarCoordinates(profileData.printable_area);
    if (printableArea) {
        limits.max.x = printableArea.x;
        limits.max.y = printableArea.y;
        limits.explicitMaxAxes.x = true;
        limits.explicitMaxAxes.y = true;
    }

    if (assignPositiveAxisValue(limits.max, 'z', parseNumberLike(profileData.printable_height))) {
        limits.explicitMaxAxes.z = true;
    }
    applyAxisValuesFromObject(limits.min, profileData.min_printable_size);
    applyAxisValuesFromObject(limits.max, profileData.max_printable_size, limits.explicitMaxAxes);

    return limits;
}

/**
 * Parse build-volume limits from Prusa INI profile.
 * @param {string} configPath Prusa profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string, explicitMaxAxes: {x: boolean, y: boolean, z: boolean}}} Parsed limits.
 */
function parseDimensionLimitsFromPrusaProfile(configPath, technology) {
    const limits = createDefaultBuildVolumeLimits(configPath, technology);

    if (!configPath || !fs.existsSync(configPath)) return limits;

    const iniMap = readIniKeyValues(configPath);
    const bedShapeRaw = iniMap.bed_shape;
    if (bedShapeRaw) {
        const bedShape = parsePlanarCoordinates(String(bedShapeRaw).split(','));
        if (bedShape) {
            limits.max.x = bedShape.x;
            limits.max.y = bedShape.y;
            limits.explicitMaxAxes.x = true;
            limits.explicitMaxAxes.y = true;
        }
    }

    if (assignPositiveAxisValue(
        limits.max,
        'z',
        parseNumberLike(iniMap.max_print_height || iniMap.printable_height || iniMap.print_height)
    )) {
        limits.explicitMaxAxes.z = true;
    }

    applyAxisValuesFromIniMap(limits.min, iniMap, {
        x: 'min_print_size_x',
        y: 'min_print_size_y',
        z: 'min_print_size_z'
    });
    applyAxisValuesFromIniMap(limits.max, iniMap, {
        x: 'max_print_size_x',
        y: 'max_print_size_y',
        z: 'max_print_size_z'
    }, limits.explicitMaxAxes);

    return limits;
}

/**
 * Parse build-volume limits from a flattened Bambu machine snapshot.
 * The snapshot carries the vendor machine NAME, which is the public
 * `source_profile` and the key of the measured admission table; the
 * caller-supplied public source path is ignored on purpose because the
 * pipeline passes the process selection for non-Orca engines. The declared
 * dimensions stay the plate `printable_area`/`printable_height` metadata,
 * while `bedGeometry` carries the real placement shape (first-extruder area
 * and excluded rectangles) that Bambu admission is decided on.
 * @param {string} machineSnapshotPath Flattened machine JSON snapshot.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: object, max: object, sourceProfile: string, explicitMaxAxes: object, bedGeometry: object}} Parsed limits.
 */
function parseDimensionLimitsFromBambuMachineSnapshot(machineSnapshotPath, technology) {
    if (!machineSnapshotPath || !fs.existsSync(machineSnapshotPath)) {
        throw new Error('Bambu machine snapshot is required for build-volume limits.');
    }
    const limits = parseDimensionLimitsFromOrcaMachineProfile(machineSnapshotPath, technology);
    const profileData = readProfileJson(machineSnapshotPath);
    const machineName = profileData.name;
    if (typeof machineName !== 'string' || !machineName) {
        throw new Error('Bambu machine snapshot has no vendor name.');
    }
    limits.sourceProfile = machineName;
    limits.bedGeometry = parseBambuBedGeometry(profileData);
    return limits;
}

/**
 * Resolve effective build-volume limits for selected engine/profile pair.
 * @param {'prusa'|'orca'|'bambu'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} configFile Process/profile config file.
 * @param {string | null} orcaMachineConfigFile Orca/Bambu machine config path.
 * @param {string | null} [publicSourceProfileFile=null] Original selected path used only for stable public metadata.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string, explicitMaxAxes: {x: boolean, y: boolean, z: boolean}}} Resolved limits.
 */
function resolveBuildVolumeLimits(
    engine,
    technology,
    configFile,
    orcaMachineConfigFile,
    publicSourceProfileFile = null
) {
    let limits;
    if (engine === 'bambu') {
        limits = parseDimensionLimitsFromBambuMachineSnapshot(orcaMachineConfigFile, technology);
    } else if (engine === 'orca') {
        limits = parseDimensionLimitsFromOrcaMachineProfile(orcaMachineConfigFile, technology);
    } else {
        limits = parseDimensionLimitsFromPrusaProfile(configFile, technology);
    }
    if (publicSourceProfileFile && engine !== 'bambu') {
        limits.sourceProfile = path.basename(publicSourceProfileFile);
    }
    const declaredMax = { ...limits.max };
    const knownProfileLimits = P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM[engine]
        || Object.freeze({});
    const h2dQuoteProfileLimits =
        H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM[engine]
        || Object.freeze({});
    const slaProfileLimits = technology === 'SLA'
        ? (SLA_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM[engine] || Object.freeze({}))
        : Object.freeze({});
    const bambuProfileLimits = engine === 'bambu'
        ? BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM
        : Object.freeze({});
    const configuredLargestPassing = knownProfileLimits[limits.sourceProfile]
        || h2dQuoteProfileLimits[limits.sourceProfile]
        || slaProfileLimits[limits.sourceProfile]
        || bambuProfileLimits[limits.sourceProfile]
        || null;
    let largestPassing = configuredLargestPassing
        ? { ...configuredLargestPassing }
        : { ...declaredMax };
    if (!configuredLargestPassing && technology === 'FDM') {
        const derate = FDM_VALIDATION_ONLY_DERATE_MM_BY_ENGINE[engine];
        if (derate) {
            largestPassing = Object.fromEntries(['x', 'y', 'z'].map((axis) => [
                axis,
                roundToThree(declaredMax[axis] - derate[axis])
            ]));
        }
    }
    for (const axis of ['x', 'y', 'z']) {
        if (!Number.isFinite(largestPassing[axis])
            || largestPassing[axis] <= limits.min[axis]
            || largestPassing[axis] > declaredMax[axis]) {
            throw new Error(`Largest-passing ${axis.toUpperCase()} dimension is invalid.`);
        }
    }
    limits.declaredMax = declaredMax;
    limits.largestPassingDimensionsInclusive = { ...largestPassing };
    // Runtime validation intentionally consumes only the largest passing value.
    limits.max = { ...largestPassing };
    return limits;
}

/**
 * Validate model dimensions against configured printer limits.
 *
 * Limits that carry a `bedGeometry` (Bambu) decide X/Y admission by placement
 * feasibility on the real bed shape and return the chosen placement, so an
 * L-shaped footprint such as the P1S `238 x 256` is admitted although the
 * published triple is `256 x 228`. Limits without bed geometry (Prusa, Orca,
 * preview) keep the per-axis comparison unchanged.
 * @param {{x: number|string, y: number|string, z: number|string}} modelInfo Model dimension payload.
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string, bedGeometry?: object}} buildVolumeLimits Printer limits.
 * @returns {{isValid: true, dimensions: {x: number, y: number, z: number}, placement?: {xMin: number, yMin: number, strategy: string}} | {isValid: false, dimensions: {x: number, y: number, z: number}, tooSmall: string[], tooLarge: string[]}} Validation result.
 */
function validateModelDimensionsAgainstLimits(modelInfo, buildVolumeLimits) {
    const dimensions = {
        x: Number(modelInfo.x),
        y: Number(modelInfo.y),
        z: Number(modelInfo.z)
    };
    const dimensionLimit = resolveResourcePolicy().MAX_MODEL_DIMENSION_MM;
    if (!Object.values(dimensions).every((value) => Number.isFinite(value) && value > 0 && value <= dimensionLimit)) {
        return {
            isValid: false,
            dimensions,
            tooSmall: ['Model dimensions must be finite and positive.'],
            tooLarge: []
        };
    }
    if (buildVolumeLimits.bedGeometry) {
        return validateBambuPlacementLimits(dimensions, buildVolumeLimits);
    }

    const axes = ['x', 'y', 'z'];
    const tooSmall = [];
    const tooLarge = [];

    for (const axis of axes) {
        if (dimensions[axis] > 0 && dimensions[axis] < buildVolumeLimits.min[axis]) {
            tooSmall.push(`${axis.toUpperCase()}: ${roundToThree(dimensions[axis])}mm < ${roundToThree(buildVolumeLimits.min[axis])}mm`);
        }

        if (dimensions[axis] > buildVolumeLimits.max[axis]) {
            tooLarge.push(`${axis.toUpperCase()}: ${roundToThree(dimensions[axis])}mm > ${roundToThree(buildVolumeLimits.max[axis])}mm`);
        }
    }

    if (tooSmall.length === 0 && tooLarge.length === 0) {
        return {
            isValid: true,
            dimensions
        };
    }

    return {
        isValid: false,
        dimensions,
        tooSmall,
        tooLarge
    };
}

/**
 * Whether the request asked for support generation. Only an explicit boolean
 * false turns it off; omission keeps the historical always-on behaviour.
 * @param {{supports?: unknown}} options Runtime options.
 * @returns {boolean} Effective support flag.
 */
function resolveSupports(options) {
    return options?.supports !== false;
}

/**
 * Create temporary Orca process profile with runtime overrides.
 * @param {string} baseProcessProfilePath Source process profile path.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {{resolvePath(...segments: string[]): string, assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {{pathFactory?: (defaultPath: string) => string, supports?: boolean}} [options] Test-only path seam and request options.
 * @returns {Promise<string>} Runtime profile path.
 */
async function createOrcaRuntimeProcessProfile(baseProcessProfilePath, layerHeight, infillPercentage, workspace, options = {}) {
    const profileData = readProfileJson(baseProcessProfilePath);
    profileData.layer_height = `${layerHeight}`;
    profileData.sparse_infill_density = infillPercentage;
    profileData.layer_gcode = '';
    profileData.use_relative_e_distances = '1';
    // The repository process profiles enable support; the runtime writes the
    // explicit zero only when the request turns it off so the default runtime
    // profile (and therefore its digest) stays exactly what it was.
    if (!resolveSupports(options)) profileData.enable_support = SUPPORT_OFF;

    const runtimeProfilePath = resolveRuntimeProfilePath(workspace, 'orca-runtime', '.json', options.pathFactory);
    await fsPromises.writeFile(runtimeProfilePath, JSON.stringify(profileData, null, 4), {
        flag: 'wx',
        mode: 0o600
    });

    return runtimeProfilePath;
}

/**
 * Create the Bambu Studio runtime process profile from the flattened vendor
 * snapshot: layer height, sparse infill density, and support generation are
 * the only request-controlled keys, exactly as a GUI user would change them.
 * @param {string} baseProcessProfilePath Flattened vendor process snapshot.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {object} workspace Owning workspace.
 * @param {{pathFactory?: (defaultPath: string) => string, supports?: boolean}} [options] Request options.
 * @returns {Promise<string>} Runtime profile path.
 */
async function createBambuRuntimeProcessProfile(baseProcessProfilePath, layerHeight, infillPercentage, workspace, options = {}) {
    const profileData = readProfileJson(baseProcessProfilePath);
    if (!profileData || typeof profileData !== 'object' || Array.isArray(profileData) || profileData.type !== 'process') {
        throw new Error('Bambu runtime profile requires a flattened process snapshot.');
    }
    if (Object.hasOwn(profileData, 'inherits') || Object.hasOwn(profileData, 'include')) {
        throw new Error('Bambu runtime profile requires a flattened process snapshot.');
    }
    profileData.layer_height = `${layerHeight}`;
    profileData.sparse_infill_density = infillPercentage;
    profileData.enable_support = resolveSupports(options) ? SUPPORT_ON : SUPPORT_OFF;

    const runtimeProfilePath = resolveRuntimeProfilePath(workspace, 'bambu-runtime', '.json', options.pathFactory);
    await fsPromises.writeFile(runtimeProfilePath, JSON.stringify(profileData, null, 4), {
        flag: 'wx',
        mode: 0o600
    });

    return runtimeProfilePath;
}

/**
 * Insert or replace INI key value pair in textual INI content.
 * @param {string} content Original INI content.
 * @param {string} key INI key to update.
 * @param {string} value INI value to set.
 * @returns {string} Updated INI content.
 */
function upsertIniKey(content, key, value) {
    const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const keyPattern = new RegExp(String.raw`^\s*${escapedKey}\s*=`);
    const lines = String(content || '').split(/\r\n|\n|\r/);

    while (lines.length > 0 && lines.at(-1) === '') {
        lines.pop();
    }

    let firstSectionIndex = lines.length;
    let topLevelMatch = -1;
    for (let index = 0; index < lines.length; index += 1) {
        if (/^\s*\[[^\]]+]\s*$/.test(lines[index])) {
            firstSectionIndex = Math.min(firstSectionIndex, index);
        }
        if (index >= firstSectionIndex || !keyPattern.test(lines[index])) continue;
        if (topLevelMatch >= 0) {
            throw new Error('Duplicate slicer profile key is not supported.');
        }
        topLevelMatch = index;
    }

    const updatedLines = [...lines];
    if (topLevelMatch >= 0) {
        updatedLines[topLevelMatch] = `${key} = ${value}`;
    } else {
        updatedLines.splice(firstSectionIndex, 0, `${key} = ${value}`);
    }

    return `${updatedLines.join('\n')}\n`;
}

/**
 * Create temporary Prusa runtime profile with request-time overrides.
 * @param {string} baseConfigPath Source profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {{resolvePath(...segments: string[]): string, assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {{pathFactory?: (defaultPath: string) => string}} [options] Test-only path seam.
 * @returns {Promise<string>} Runtime profile path.
 */
async function createPrusaRuntimeProfile(baseConfigPath, technology, layerHeight, infillPercentage, workspace, options = {}) {
    let iniContent = readProfileText(baseConfigPath);
    iniContent = upsertIniKey(iniContent, 'layer_height', `${layerHeight}`);

    if (technology === 'FDM') {
        iniContent = upsertIniKey(iniContent, 'fill_density', infillPercentage);
    }

    // PrusaSlicer emits "total filament used [g]" only when it knows the
    // density, and the repository Prusa profiles carry none because they are
    // material-agnostic — one profile serves every material. Without this the
    // engine reports length but no mass, every FDM quote falls through to
    // manual pricing, and the consumer that actually calls this route gets no
    // price at all. The value comes from the shared material catalogue rather
    // than being written into the profiles, because it is material-dependent
    // and a fixed number would silently misprice everything but PLA.
    if (Number.isFinite(options.filamentDensityGcm3) && options.filamentDensityGcm3 > 0) {
        iniContent = upsertIniKey(iniContent, 'filament_density', `${options.filamentDensityGcm3}`);
    }

    // With supports on, the CLI `--support-material` flags force generation and
    // the INI is left untouched (so the default digest is unchanged). With
    // supports off those flags are omitted and the INI must carry explicit
    // zeros, because the shipped profile enables automatic supports itself.
    if (technology === 'FDM' && !resolveSupports(options)) {
        iniContent = upsertIniKey(iniContent, 'support_material', SUPPORT_OFF);
        iniContent = upsertIniKey(iniContent, 'support_material_auto', SUPPORT_OFF);
    }

    const runtimeProfilePath = resolveRuntimeProfilePath(workspace, 'prusa-runtime', '.ini', options.pathFactory);
    await fsPromises.writeFile(runtimeProfilePath, iniContent, {
        flag: 'wx',
        mode: 0o600
    });

    return runtimeProfilePath;
}

/**
 * Resolve a server-generated runtime profile path inside a job workspace.
 * @param {{resolvePath(...segments: string[]): string, assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {string} prefix Stable server prefix.
 * @param {'.ini'|'.json'} extension Profile extension.
 * @param {(defaultPath: string) => string} [pathFactory] Test-only candidate override.
 * @returns {string} Contained runtime profile path.
 */
function resolveRuntimeProfilePath(workspace, prefix, extension, pathFactory) {
    const suffix = randomBytes(8).toString('hex');
    const resolvePath = workspace.resolveScratchPath || workspace.resolvePath;
    const assertPath = workspace.assertScratchContainedPath || workspace.assertContainedPath;
    const defaultPath = resolvePath(`${prefix}-${suffix}${extension}`);
    const candidatePath = pathFactory ? pathFactory(defaultPath) : defaultPath;
    return assertPath(candidatePath);
}

/**
 * Create runtime slicer profile for selected engine.
 * @param {'prusa'|'orca'|'bambu'} engine Slicer engine key.
 * @param {string} baseConfigFile Source config path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {{resolvePath(...segments: string[]): string, assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {{pathFactory?: (defaultPath: string) => string, supports?: boolean, filamentDensityGcm3?: number}} [options] Request options and test-only path seam.
 * @returns {Promise<string>} Runtime profile path.
 */
async function createRuntimeSlicerProfile(engine, baseConfigFile, technology, layerHeight, infillPercentage, workspace, options = {}) {
    if (engine === 'bambu') {
        return createBambuRuntimeProcessProfile(baseConfigFile, layerHeight, infillPercentage, workspace, options);
    }
    if (engine === 'orca') {
        return createOrcaRuntimeProcessProfile(baseConfigFile, layerHeight, infillPercentage, workspace, options);
    }

    return createPrusaRuntimeProfile(baseConfigFile, technology, layerHeight, infillPercentage, workspace, options);
}

/**
 * Resolve the Bambu Studio vendor NAMES for one request from the registry.
 * The selection fields reuse the generic pipeline shape, but for Bambu they
 * carry vendor profile names rather than repository file paths; the snapshot
 * step flattens those names into job-owned JSON before any native use.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {{bambuPrinter?: string|null, bambuProcessProfile?: string|null}} profileOverrides Parsed request selection.
 * @param {string|null} material Requested material key.
 * @returns {{isValid: true, baseConfigFile: string, orcaMachineConfigFile: string, orcaFilamentConfigFile: string} | {isValid: false, status: number, response: object}} Selection result.
 */
function resolveBambuProfileSelection(technology, layerHeight, profileOverrides, material) {
    const failure = (error, errorCode) => ({
        isValid: false,
        status: 400,
        response: { success: false, error, errorCode }
    });
    if (technology !== 'FDM') {
        return failure('Bambu Studio supports FDM only.', 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY');
    }
    const printerId = profileOverrides?.bambuPrinter;
    let printer;
    try {
        printer = getBambuPrinter(printerId);
    } catch {
        return failure('Invalid printerProfile for Bambu Studio. Allowed values: P1S, H2D.', 'INVALID_PRINTER_PROFILE');
    }
    const layerKey = resolveBambuLayerKey(Number(layerHeight), printerId);
    if (!layerKey) {
        return failure(`Invalid layerHeight for Bambu Studio printer ${printerId}.`, 'INVALID_LAYER_HEIGHT');
    }
    const processName = resolveBambuProcessName(printerId, layerKey, profileOverrides?.bambuProcessProfile || null);
    if (!processName) {
        return failure(`Invalid processProfile for Bambu Studio printer ${printerId}.`, 'INVALID_PROCESS_PROFILE');
    }
    const filamentName = resolveBambuFilamentName(printerId, material);
    if (!filamentName) {
        return failure(
            `Material ${material} has no Bambu Studio filament profile for printer ${printerId}.`,
            'MATERIAL_PROFILE_UNAVAILABLE'
        );
    }
    return {
        isValid: true,
        baseConfigFile: processName,
        orcaMachineConfigFile: printer.machine,
        orcaFilamentConfigFile: filamentName
    };
}

/**
 * Validate and resolve profile file selection for request.
 * @param {'prusa'|'orca'|'bambu'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {{prusaProfile?: string | null, orcaMachineProfile?: string | null, orcaProcessProfile?: string | null, orcaFilamentProfile?: string | null, bambuPrinter?: string|null, bambuProcessProfile?: string|null}} profileOverrides Profile overrides.
 * @param {string|null} [material=null] Requested material key.
 * @returns {{isValid: true, baseConfigFile: string, orcaMachineConfigFile: string | null, orcaFilamentConfigFile: string | null} | {isValid: false, status: number, response: {success: false, error: string, errorCode: string}}} Selection result.
 */
function resolveProfileSelection(engine, technology, layerHeight, profileOverrides, material = null) {
    if (engine === 'bambu') {
        return resolveBambuProfileSelection(technology, layerHeight, profileOverrides || {}, material);
    }
    const baseConfigFile = resolveConfigPath(engine, technology, layerHeight, profileOverrides);
    const orcaMachineConfigFile = engine === 'orca'
        ? resolveOrcaMachineConfigPath(profileOverrides)
        : null;
    const orcaFilamentConfigFile = engine === 'orca'
        ? resolveOrcaFilamentConfigPath(material, profileOverrides)
        : null;

    if (!fs.existsSync(baseConfigFile)) {
        return {
            isValid: false,
            status: 400,
            response: {
                success: false,
                error: `Selected profile file not found: ${path.basename(baseConfigFile)}`,
                errorCode: 'PROFILE_NOT_FOUND'
            }
        };
    }

    if (engine === 'orca' && (!orcaMachineConfigFile || !fs.existsSync(orcaMachineConfigFile))) {
        return {
            isValid: false,
            status: 400,
            response: {
                success: false,
                error: `Selected Orca machine profile not found: ${path.basename(orcaMachineConfigFile || '')}`,
                errorCode: 'PROFILE_NOT_FOUND'
            }
        };
    }

    return {
        isValid: true,
        baseConfigFile,
        orcaMachineConfigFile,
        orcaFilamentConfigFile
    };
}

/**
 * Emit selected profile info to logs.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {string | null} orcaMachineConfigFile Orca machine profile path.
 * @param {string} baseConfigFile Process/base profile path.
 * @param {string} infillPercentage Infill override.
 * @param {number} layerHeight Layer height override.
 * @returns {void}
 */
function logEngineProfileSelection(engine) {
    void engine;
}

module.exports = {
    resolveConfigPath,
    resolveOrcaFilamentConfigPath,
    resolveOrcaMachineConfigPath,
    resolveBambuProfileSelection,
    resolveBuildVolumeLimits,
    validateModelDimensionsAgainstLimits,
    createRuntimeSlicerProfile,
    resolveRuntimeProfilePath,
    resolveProfileSelection,
    logEngineProfileSelection
};
