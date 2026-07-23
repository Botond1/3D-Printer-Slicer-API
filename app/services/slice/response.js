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

const PROFILE_RESPONSE_MAPPERS = Object.freeze({
    orca: (context) => ({
        machine_profile: path.basename(context.orcaMachineConfigFile),
        process_profile: path.basename(context.baseConfigFile)
    }),
    prusa: (context) => ({
        prusa_profile: path.basename(context.baseConfigFile)
    })
});

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
 * baseConfigFile: string,
 * transformOptions: {unit: 'mm'|'inch', scalePercent: number | null},
 * transformPlan: {keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}},
 * originalModelInfo: {x: number, y: number, z: number},
 * modelBoundsValidation: {dimensions: {x: number, y: number, z: number}},
 * buildVolumeLimits: {min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string},
 * stats: {print_time_seconds: number, print_time_readable: string, material_used_m: number, object_height_mm: number, estimated_price_huf: number}
 * }} context Response context.
 * @returns {Record<string, unknown>} API response payload.
 */
function buildSliceSuccessResponse(context) {
    const {
        engine,
        technology,
        material,
        infillPercentage,
        transformOptions,
        transformPlan,
        originalModelInfo,
        modelBoundsValidation,
        buildVolumeLimits,
        stats
    } = context;

    const { hourlyRate, totalPrice } = calculateSlicePricing(technology, material, stats);
    const profiles = resolveProfileMapper(engine)(context);

    return {
        success: true,
        job_id: context.jobId,
        artifact_id: context.artifactId,
        slicer_engine: engine,
        technology,
        material,
        infill: infillPercentage,
        profiles,
        model_transform: {
            size_unit: transformOptions.unit,
            keep_proportions: transformPlan.keepProportions,
            requested_size: {
                x: transformPlan.requestedTargetSize.x === null ? null : roundToThree(transformPlan.requestedTargetSize.x),
                y: transformPlan.requestedTargetSize.y === null ? null : roundToThree(transformPlan.requestedTargetSize.y),
                z: transformPlan.requestedTargetSize.z === null ? null : roundToThree(transformPlan.requestedTargetSize.z)
            },
            scale_percent: transformOptions.scalePercent,
            scale_factors: roundDimensions(transformPlan.scale),
            rotation_deg: roundDimensions(transformPlan.rotationDeg),
            original_dimensions_mm: roundDimensions({
                x: originalModelInfo.x,
                y: originalModelInfo.y,
                z: originalModelInfo.z
            }),
            final_dimensions_mm: roundDimensions(modelBoundsValidation.dimensions)
        },
        build_volume_limits_mm: {
            min: roundDimensions(buildVolumeLimits.min),
            max: roundDimensions(buildVolumeLimits.max),
            source_profile: buildVolumeLimits.sourceProfile
        },
        hourly_rate: hourlyRate,
        stats: {
            ...stats,
            estimated_price_huf: totalPrice
        }
    };
}

module.exports = {
    buildSliceSuccessResponse,
    calculateSlicePricing,
    resolveProfileMapper,
    resolvePricingStrategy
};
