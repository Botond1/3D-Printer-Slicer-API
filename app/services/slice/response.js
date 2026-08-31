/**
 * Slice response payload composition and pricing strategies.
 */

const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { getRate } = require('../pricing.service');
const { roundDimensions, roundToThree } = require('./common');
const RESOURCE_POLICY = resolveResourcePolicy(process.env);

/**
 * Price calculator strategy: minimum quarter-hour billing with upward rounding to nearest 10 HUF.
 * @param {number} hourlyRate Hourly material rate.
 * @param {{print_time_seconds: number}} stats Parsed print stats.
 * @returns {number} Calculated total price in HUF.
 */
function calculateQuarterHourMinimumPrice(hourlyRate, stats) {
    const printHours = stats.print_time_seconds / 3600;
    const calcHours = Math.max(printHours, 0.25);
    return Math.ceil((calcHours * hourlyRate) / 10) * 10;
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

const PROFILE_RESPONSE_MAPPERS = Object.freeze({
    orca: mapOrcaProfileResponse,
    prusa: (context) => ({
        prusa_profile: path.basename(context.baseConfigFile),
        effective_profile_sha256: requireEffectiveProfileSha256(context.effectiveProfileSha256)
    })
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

/**
 * Resolve profile payload mapper based on selected slicing engine.
 * @param {'prusa'|'orca'} engine Engine key.
 * @returns {(context: {baseConfigFile: string, orcaMachineConfigFile: string | null}) => Record<string, string>} Mapper function.
 */
function resolveProfileMapper(engine) {
    return PROFILE_RESPONSE_MAPPERS[engine] || PROFILE_RESPONSE_MAPPERS.prusa;
}

/**
 * Build successful slice response payload.
 * @param {{
 * engine: 'prusa'|'orca',
 * technology: 'FDM'|'SLA',
 * material: string,
 * infillPercentage: string,
 * orcaMachineConfigFile: string | null,
 * orcaFilamentConfigFile: string | null,
 * filamentProfileMetadata: {diameterMm: number, densityGcm3: number} | null,
 * baseConfigFile: string,
 * effectiveProfileSha256: string,
 * engineVersion: string,
 * modelTransform: {transform_schema: 1, final_dimensions_mm: {x: number, y: number, z: number}},
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

    if (!modelTransform || modelTransform.transform_schema !== 1) {
        throw new Error('Versioned model transform metadata is unavailable.');
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
    const requiresManualPricing = (technology === 'FDM' &&
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
        profiles,
        model_transform: modelTransform,
        build_volume_limits_mm: {
            min: roundDimensions(buildVolumeLimits.min),
            max: roundDimensions(buildVolumeLimits.max),
            source_profile: buildVolumeLimits.sourceProfile
        },
        hourly_rate: hourlyRate,
        stats: {
            ...stats,
            object_height_mm: finalHeight,
            estimated_price_huf: totalPrice
        }
    };
}

module.exports = {
    buildSliceSuccessResponse,
    calculateSlicePricing,
    mapOrcaProfileResponse,
    requireEngineVersion,
    resolveProfileMapper,
    resolvePricingStrategy
};
