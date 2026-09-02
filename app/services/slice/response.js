/**
 * Slice response payload composition and pricing strategies.
 */

const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { getRate } = require('../pricing.service');
const { roundDimensions, roundToThree } = require('./common');
const { getBambuPrinter } = require('./bambu-printer-registry');
const { getDefaultSlaPrinterId, resolveSlaResinDensity } = require('./sla-printer-registry');
const { TIME_MODEL_SCHEMA } = require('./sla-time-model');
const RESOURCE_POLICY = resolveResourcePolicy(process.env);

const MINIMUM_BILLABLE_SECONDS = 900;

/**
 * Price calculator strategy: minimum quarter-hour billing with upward rounding to nearest 10 HUF.
 *
 * The arithmetic stays in integers: `seconds * rate / 3600` is computed before
 * any division so an exact multiple of 10 (1980 s at 800 HUF/h is exactly 440)
 * is not pushed to the next step by floating-point noise. The former
 * hours-first formula produced 440.00000000000006 and billed 450.
 * @param {number} hourlyRate Hourly material rate.
 * @param {{print_time_seconds: number}} stats Parsed print stats.
 * @returns {number} Calculated total price in HUF.
 */
function calculateQuarterHourMinimumPrice(hourlyRate, stats) {
    const billableSeconds = Math.max(Number(stats.print_time_seconds), MINIMUM_BILLABLE_SECONDS);
    const exactPrice = Math.ceil((billableSeconds * hourlyRate) / 3600);
    return Math.ceil(exactPrice / 10) * 10;
}

const PRICING_STRATEGIES = Object.freeze({
    FDM: calculateQuarterHourMinimumPrice,
    SLA: calculateQuarterHourMinimumPrice
});

/**
 * Resolve pricing calculation strategy for technology.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @returns {(hourlyRate: number, stats: {print_time_seconds: number}) => number} Pricing strategy.
 */
function resolvePricingStrategy(technology) {
    return PRICING_STRATEGIES[technology] || calculateQuarterHourMinimumPrice;
}

/**
 * Calculate request pricing for parsed print stats.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} material Material key.
 * @param {{print_time_seconds: number}} stats Parsed print stats.
 * @returns {{hourlyRate: number, totalPrice: number}} Pricing result.
 */
function calculateSlicePricing(technology, material, stats) {
    const hourlyRate = getRate(technology, material);
    if (
        !Number.isFinite(hourlyRate)
        || hourlyRate <= 0
        || hourlyRate > RESOURCE_POLICY.MAX_HOURLY_PRICE_HUF
    ) {
        const error = new Error('Pricing rate is outside the allowed range.');
        error.code = 'INVALID_SLICE_STATS';
        throw error;
    }
    const totalPrice = resolvePricingStrategy(technology)(hourlyRate, stats);
    const maximumTotal = Math.ceil(
        ((RESOURCE_POLICY.MAX_PRINT_TIME_SECONDS / 3600) * RESOURCE_POLICY.MAX_HOURLY_PRICE_HUF) / 10
    ) * 10;
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0 || totalPrice > maximumTotal) {
        const error = new Error('Calculated price is outside the allowed range.');
        error.code = 'INVALID_SLICE_STATS';
        throw error;
    }

    return {
        hourlyRate,
        totalPrice
    };
}

function mapOrcaProfileResponse(context) {
    const filamentProfile = context.orcaFilamentConfigFile
        ? path.basename(context.orcaFilamentConfigFile)
        : null;
    const metadata = context.filamentProfileMetadata;
    if (filamentProfile === null) {
        if (metadata !== null && metadata !== undefined) {
            throw new Error('Filament metadata exists without a selected Orca filament profile.');
        }
    } else if (
        !metadata
        || !Number.isFinite(metadata.diameterMm)
        || metadata.diameterMm <= 0
        || !Number.isFinite(metadata.densityGcm3)
        || metadata.densityGcm3 <= 0
    ) {
        throw new Error('Selected Orca filament profile metadata is unavailable.');
    }

    return {
        machine_profile: path.basename(context.orcaMachineConfigFile),
        process_profile: path.basename(context.baseConfigFile),
        filament_profile: filamentProfile,
        filament_diameter_mm: metadata?.diameterMm ?? null,
        filament_density_g_cm3: metadata?.densityGcm3 ?? null,
        effective_profile_sha256: requireEffectiveProfileSha256(context.effectiveProfileSha256)
    };
}

function requirePositiveFilamentMetadata(metadata, label) {
    if (
        !metadata
        || !Number.isFinite(metadata.diameterMm)
        || metadata.diameterMm <= 0
        || !Number.isFinite(metadata.densityGcm3)
        || metadata.densityGcm3 <= 0
    ) {
        throw new Error(`Selected ${label} filament profile metadata is unavailable.`);
    }
    return metadata;
}

/**
 * Bambu selections are vendor profile NAMES rather than repository file paths,
 * so the public payload echoes them verbatim together with the registry printer
 * id and bed type that selected them.
 */
function mapBambuProfileResponse(context) {
    const printer = context.profileOverrides?.bambuPrinter;
    if (typeof printer !== 'string' || !printer) {
        throw new Error('Bambu printer selection is unavailable.');
    }
    const bedType = getBambuPrinter(printer).bedType;
    for (const [field, label] of [
        ['orcaMachineConfigFile', 'machine'],
        ['baseConfigFile', 'process'],
        ['orcaFilamentConfigFile', 'filament']
    ]) {
        if (typeof context[field] !== 'string' || !context[field]) {
            throw new Error(`Bambu ${label} profile selection is unavailable.`);
        }
    }
    const metadata = requirePositiveFilamentMetadata(context.filamentProfileMetadata, 'Bambu');
    return {
        printer,
        machine_profile: context.orcaMachineConfigFile,
        process_profile: context.baseConfigFile,
        filament_profile: context.orcaFilamentConfigFile,
        filament_diameter_mm: metadata.diameterMm,
        filament_density_g_cm3: metadata.densityGcm3,
        bed_type: bedType,
        effective_profile_sha256: requireEffectiveProfileSha256(context.effectiveProfileSha256)
    };
}

/**
 * Prusa SLA quoting rows add the printer id, the resin density used to derive
 * `stats.material_used_g`, and the layer-time model schema; the request's
 * material has already passed `INVALID_MATERIAL_FOR_TECHNOLOGY` validation
 * upstream, so a missing density here is an internal defect.
 */
function mapPrusaProfileResponse(context) {
    const base = {
        prusa_profile: path.basename(context.baseConfigFile),
        effective_profile_sha256: requireEffectiveProfileSha256(context.effectiveProfileSha256)
    };
    if (context.technology !== 'SLA') return base;
    const slaPrinter = getDefaultSlaPrinterId();
    const resinDensityGcm3 = resolveSlaResinDensity(context.material, slaPrinter);
    if (!Number.isFinite(resinDensityGcm3) || resinDensityGcm3 <= 0) {
        throw new Error('SLA resin density is unavailable for a validated material.');
    }
    return {
        ...base,
        sla_printer: slaPrinter,
        resin_density_g_cm3: resinDensityGcm3,
        sla_time_model: TIME_MODEL_SCHEMA
    };
}

const PROFILE_RESPONSE_MAPPERS = Object.freeze({
    orca: mapOrcaProfileResponse,
    bambu: mapBambuProfileResponse,
    prusa: mapPrusaProfileResponse
});

/**
 * Require the profile identity on every successful slice response.
 * @param {unknown} value Candidate SHA-256 digest.
 * @returns {string} Valid lowercase SHA-256 digest.
 */
function requireEffectiveProfileSha256(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
        throw new Error('Effective profile SHA-256 is unavailable.');
    }
    return value;
}

function requireEngineVersion(value) {
    if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]+){2,3}(?:[-+][A-Za-z0-9._-]+)?$/.test(value)) {
        throw new Error('Slicer engine version is unavailable.');
    }
    return value;
}

function isExactMeasuredDimensions(value) {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
    ) return false;
    const keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys.some((key, index) => key !== ['x', 'y', 'z'][index])) return false;
    return keys.every((key) => Number.isFinite(value[key]) && value[key] >= 0);
}

/**
 * Resolve profile payload mapper based on selected slicing engine.
 * @param {'prusa'|'orca'|'bambu'} engine Engine key.
 * @returns {(context: {baseConfigFile: string, orcaMachineConfigFile: string | null}) => Record<string, string>} Mapper function.
 */
function resolveProfileMapper(engine) {
    return PROFILE_RESPONSE_MAPPERS[engine] || PROFILE_RESPONSE_MAPPERS.prusa;
}

/**
 * Whether the request-controlled support flag is on. Omission keeps the
 * historical always-on behaviour; only an explicit boolean false disables it.
 * @param {unknown} value Parsed request value.
 * @returns {boolean} Effective support flag.
 */
function resolveSupportsFlag(value) {
    return value !== false;
}

/**
 * Bambu Studio responses publish the API-owned bed placement because
 * `--arrange 0` keeps the STL coordinates exactly; other engines place
 * natively and expose nothing. A Bambu response without a placement is a
 * pipeline defect and fails closed instead of implying native arrangement.
 * @param {'prusa'|'orca'|'bambu'} engine Engine key.
 * @param {{x_min?: unknown, y_min?: unknown}|null|undefined} placement Chosen placement.
 * @returns {{placement_mm: {x_min: number, y_min: number}}|{}} Optional response fragment.
 */
function resolvePlacementResponse(engine, placement) {
    if (engine !== 'bambu') return {};
    const xMin = Number(placement?.x_min);
    const yMin = Number(placement?.y_min);
    if (!placement || !Number.isFinite(xMin) || !Number.isFinite(yMin)) {
        throw new Error('Bambu placement is unavailable.');
    }
    return { placement_mm: { x_min: roundToThree(xMin), y_min: roundToThree(yMin) } };
}

/**
 * Build successful slice response payload.
 * @param {{
 * engine: 'prusa'|'orca'|'bambu',
 * technology: 'FDM'|'SLA',
 * material: string,
 * infillPercentage: string,
 * supports?: boolean,
 * orcaMachineConfigFile: string | null,
 * orcaFilamentConfigFile: string | null,
 * filamentProfileMetadata: {diameterMm: number, densityGcm3: number} | null,
 * baseConfigFile: string,
 * effectiveProfileSha256: string,
 * engineVersion: string,
 * modelTransform: {transform_schema: 2, original_dimensions_available: boolean, original_dimensions_mm: {x: number, y: number, z: number}|null, final_dimensions_mm: {x: number, y: number, z: number}},
 * buildVolumeLimits: {min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string},
 * stats: {print_time_seconds: number, print_time_readable: string, material_used_m: number, material_used_g: number|null, object_height_mm: number, estimated_price_huf: number|null}
 * }} context Response context.
 * @returns {Record<string, unknown>} API response payload.
 */
function buildSliceSuccessResponse(context) {
    const {
        engine,
        technology,
        material,
        infillPercentage,
        modelTransform,
        buildVolumeLimits,
        stats
    } = context;

    if (!modelTransform || modelTransform.transform_schema !== 2) {
        throw new Error('Versioned model transform metadata is unavailable.');
    }
    const originalDimensionsAvailable = modelTransform.original_dimensions_available;
    const originalDimensions = modelTransform.original_dimensions_mm;
    const originalDimensionsContractValid = originalDimensionsAvailable === true
        ? isExactMeasuredDimensions(originalDimensions)
        : originalDimensionsAvailable === false && originalDimensions === null;
    if (!originalDimensionsContractValid) {
        throw new Error('Original model dimension availability is inconsistent.');
    }
    const finalHeight = modelTransform.final_dimensions_mm?.z;
    if (
        !Number.isFinite(finalHeight)
        || !Number.isFinite(stats.object_height_mm)
        || roundToThree(stats.object_height_mm) !== finalHeight
    ) {
        const error = new Error('Object height does not match final model dimensions.');
        error.code = 'INVALID_SLICE_STATS';
        throw error;
    }

    const profiles = resolveProfileMapper(engine)(context);
    // FDM stays manual without a positive measured mass, and Orca stays
    // manual without a selected filament profile. SLA always has a positive
    // resin mass (derived from the parsed volume and registry resin density)
    // and prices automatically like FDM.
    const requiresManualPricing =
        (technology === 'FDM' &&
        (!Number.isFinite(stats.material_used_g) || stats.material_used_g <= 0)) ||
        (engine === 'orca' && profiles.filament_profile === null);
    const { hourlyRate, totalPrice } = requiresManualPricing
        ? { hourlyRate: null, totalPrice: null }
        : calculateSlicePricing(technology, material, stats);

    return {
        success: true,
        job_id: context.jobId,
        artifact_id: context.artifactId,
        slicer_engine: engine,
        engine_version: requireEngineVersion(context.engineVersion),
        technology,
        material,
        infill: infillPercentage,
        supports: resolveSupportsFlag(context.supports),
        profiles,
        model_transform: modelTransform,
        build_volume_limits_mm: {
            min: roundDimensions(buildVolumeLimits.min),
            max: roundDimensions(buildVolumeLimits.max),
            source_profile: buildVolumeLimits.sourceProfile
        },
        ...resolvePlacementResponse(engine, context.placement),
        hourly_rate: hourlyRate,
        stats: {
            ...stats,
            object_height_mm: finalHeight,
            estimated_price_huf: totalPrice
        }
    };
}

module.exports = {
    MINIMUM_BILLABLE_SECONDS,
    buildSliceSuccessResponse,
    calculateQuarterHourMinimumPrice,
    calculateSlicePricing,
    mapBambuProfileResponse,
    mapOrcaProfileResponse,
    mapPrusaProfileResponse,
    requireEngineVersion,
    resolvePlacementResponse,
    resolveProfileMapper,
    resolvePricingStrategy,
    resolveSupportsFlag
};
