/**
 * Request option parsing and validation for slicing endpoints.
 */

const { DEFAULTS, LAYER_HEIGHTS } = require('../../config/constants');
const {
    resolveMaterialTechnology,
    isMaterialValidForTechnology,
    getAllowedMaterialsForTechnology
} = require('../pricing.service');
const {
    pickFirstNonEmptyValue,
    parseOptionalPositiveField,
    parseOptionalFiniteField,
    parseBooleanLike,
    normalizeSizeUnit,
    normalizeAxisDimensions,
    sanitizeProfileFileName
} = require('./value-parsers');
const { ORIENTATION_MODES } = require('./orientation-contract');
const {
    getBambuAllowedLayerKeys,
    getBambuMaterials,
    getBambuProcessNames,
    resolveBambuFilamentName,
    resolveBambuLayerKey,
    resolveBambuPrinterId,
    resolveBambuProcessName
} = require('./bambu-printer-registry');

/**
 * Strict infill text: 1-3 digits, an optional integral decimal tail such as
 * `.0`/`.00` (so `20.0` and `20.00%` mean exactly 20), and an optional `%`.
 * Non-integral values (`20.5`), exponents (`1e2`), signs, and words fail.
 */
const INFILL_PATTERN = /^\s*(\d{1,3})(?:\.0+)?\s*%?\s*$/;

function invalid(error, errorCode) {
    return { isValid: false, response: { success: false, error, errorCode } };
}

/**
 * Parse the explicit automatic-or-preserve orientation policy.
 * @param {Record<string, unknown>} body Request payload.
 * @returns {{isValid: true, value: 'auto'|'preserve'} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parse result.
 */
function parseOrientationMode(body) {
    const input = body || {};
    if (!Object.hasOwn(input, 'orientationMode')) {
        return { isValid: true, value: 'auto' };
    }

    const raw = input.orientationMode;
    const value = typeof raw === 'string' ? raw : null;
    if (!value || !ORIENTATION_MODES.includes(value)) {
        return invalid('Invalid orientationMode. Allowed values: auto, preserve.', 'INVALID_ORIENTATION_MODE');
    }
    return { isValid: true, value };
}

/**
 * Parse the request-controlled support-generation flag.
 * Omission (or an empty string) keeps the historical always-on default; any
 * other present value must be an unambiguous boolean.
 * @param {Record<string, unknown>} body Request payload.
 * @returns {{isValid: true, value: boolean} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parse result.
 */
function parseSupports(body) {
    const input = body || {};
    if (!Object.hasOwn(input, 'supports')) return { isValid: true, value: true };
    const raw = input.supports;
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
        return { isValid: true, value: true };
    }
    const parsed = parseBooleanLike(raw);
    if (parsed === null) {
        return invalid('Invalid supports value. Allowed values: true/false.', 'INVALID_SUPPORTS');
    }
    return { isValid: true, value: parsed };
}

/**
 * Parse the strict infill percentage: an integer from 0 to 100 (an optional
 * trailing `%` and an integral decimal spelling such as `20.0` are
 * tolerated), never clamped, never guessed.
 * @param {Record<string, unknown>} body Request payload.
 * @returns {{isValid: true, value: number} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parse result.
 */
function parseInfill(body) {
    const input = body || {};
    const raw = input.infill;
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
        return { isValid: true, value: DEFAULTS.DEFAULT_INFIL_PERCENT };
    }
    let value = null;
    if (typeof raw === 'number') {
        value = Number.isInteger(raw) ? raw : null;
    } else if (typeof raw === 'string') {
        const match = INFILL_PATTERN.exec(raw);
        value = match ? Number.parseInt(match[1], 10) : null;
    }
    if (value === null || !Number.isInteger(value) || value < 0 || value > 100) {
        return invalid('Invalid infill value. Allowed values: an integer from 0 to 100.', 'INVALID_INFILL');
    }
    return { isValid: true, value };
}

/**
 * Parse and validate layer-height numeric value.
 * @param {unknown} layerHeightRaw Raw layer height input.
 * @returns {number | null} Valid positive layer height or null.
 */
function normalizeLayerHeight(layerHeightRaw) {
    const parsed = Number.parseFloat(layerHeightRaw || `${DEFAULTS.DEFAULT_LAYER_HEIGHT}`);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

/**
 * Validate layer height against selected technology capabilities.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {number} layerHeight Requested layer height.
 * @returns {boolean} True when layer height is allowed.
 */
function validateLayerHeightForTechnology(technology, layerHeight) {
    const allowed = technology === 'SLA'
        ? LAYER_HEIGHTS.BY_TECHNOLOGY.SLA
        : LAYER_HEIGHTS.BY_TECHNOLOGY.FDM;

    return allowed.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Validate layer height against Prusa-supported values.
 * @param {number} layerHeight Requested layer height.
 * @returns {boolean} True when supported by Prusa endpoint.
 */
function validateLayerHeightForPrusa(layerHeight) {
    return LAYER_HEIGHTS.PRUSA.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Validate layer height against Orca-supported values.
 * @param {number} layerHeight Requested layer height.
 * @returns {boolean} True when supported by Orca endpoint.
 */
function validateLayerHeightForOrca(layerHeight) {
    return LAYER_HEIGHTS.ORCA.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Validate material selection for the selected technology.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {string} material Requested material.
 * @returns {{isValid: true} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Validation result.
 */
function validateMaterialForTechnology(technology, material) {
    const materialScope = resolveMaterialTechnology(material);
    const allowedMaterials = getAllowedMaterialsForTechnology(technology);
    const allowedList = allowedMaterials.join(', ');

    if (!isMaterialValidForTechnology(technology, material)) {
        if (materialScope === null) {
            return invalid(
                `Invalid material for ${technology}. Allowed values: ${allowedList}`,
                'INVALID_MATERIAL_FOR_TECHNOLOGY'
            );
        }

        if (materialScope === 'BOTH') {
            return invalid(
                `Material is not enabled for ${technology}. Allowed values: ${allowedList}`,
                'INVALID_MATERIAL_FOR_TECHNOLOGY'
            );
        }

        return invalid(
            `Material belongs to ${materialScope}, but request is ${technology}. Allowed ${technology} materials: ${allowedList}`,
            'MATERIAL_TECHNOLOGY_MISMATCH'
        );
    }

    return { isValid: true };
}

/**
 * Validate layer-height constraints per endpoint/forced technology mode.
 * @param {number} layerHeight Requested layer height.
 * @param {'FDM'|'SLA'|null} forcedTechnology Forced technology from endpoint mode.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {{success: false, error: string, errorCode: string} | null} Error response payload or null when valid.
 */
function validateLayerHeightSelection(layerHeight, forcedTechnology, engine) {
    if (engine === 'prusa' && !forcedTechnology && !validateLayerHeightForPrusa(layerHeight)) {
        return {
            success: false,
            error: 'Invalid layerHeight for PrusaSlicer. Allowed values: 0.025, 0.05, 0.1, 0.2, 0.3',
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_ENGINE'
        };
    }

    if (engine === 'orca' && !validateLayerHeightForOrca(layerHeight)) {
        return {
            success: false,
            error: 'Invalid layerHeight for OrcaSlicer. Allowed values: 0.1, 0.2, 0.3',
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_ENGINE'
        };
    }

    if (engine !== 'orca' && forcedTechnology && !validateLayerHeightForTechnology(forcedTechnology, layerHeight)) {
        const allowedMessage = forcedTechnology === 'SLA' ? '0.025, 0.05' : '0.1, 0.2, 0.3';
        return {
            success: false,
            error: `Invalid layerHeight for ${forcedTechnology}. Allowed values: ${allowedMessage}`,
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY'
        };
    }

    return null;
}

/**
 * Parse and sanitize profile override fields from request body.
 * @param {Record<string, unknown>} body Request payload.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {{isValid: true, profileOverrides: {prusaProfile: string | null, orcaMachineProfile: string | null, orcaProcessProfile: string | null}} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parsed profile overrides.
 */
function parseProfileOverrides(body, engine) {
    if (engine === 'orca') {
        const machineProfileRaw = pickFirstNonEmptyValue(body, ['printerProfile', 'orcaMachineProfile']);
        const processProfileRaw = pickFirstNonEmptyValue(body, ['processProfile', 'orcaProcessProfile']);

        const machineProfile = sanitizeProfileFileName(machineProfileRaw, '.json');
        if (machineProfile.error) {
            return invalid(`Invalid Orca machine profile: ${machineProfile.error}`, 'INVALID_PROFILE_NAME');
        }

        const processProfile = sanitizeProfileFileName(processProfileRaw, '.json');
        if (processProfile.error) {
            return invalid(`Invalid Orca process profile: ${processProfile.error}`, 'INVALID_PROFILE_NAME');
        }

        return {
            isValid: true,
            profileOverrides: {
                orcaMachineProfile: machineProfile.value,
                orcaProcessProfile: processProfile.value,
                prusaProfile: null
            }
        };
    }

    const prusaProfileRaw = pickFirstNonEmptyValue(body, ['printerProfile', 'prusaProfile', 'profile']);
    const prusaProfile = sanitizeProfileFileName(prusaProfileRaw, '.ini');
    if (prusaProfile.error) {
        return invalid(`Invalid Prusa profile: ${prusaProfile.error}`, 'INVALID_PROFILE_NAME');
    }

    return {
        isValid: true,
        profileOverrides: {
            prusaProfile: prusaProfile.value,
            orcaMachineProfile: null,
            orcaProcessProfile: null
        }
    };
}

/**
 * Parse the Bambu Studio printer/process/layer selection against the registry.
 * The printer id is case-insensitive and defaults to the registry default; an
 * explicit process must be one of that printer's vendor process names and the
 * layer height must be one of its registry keys.
 * @param {Record<string, unknown>} body Request payload.
 * @param {number} layerHeight Parsed layer height.
 * @param {string} material Requested material key.
 * @returns {{isValid: true, profileOverrides: object, layerKey: string} | {isValid: false, response: object}} Parse result.
 */
function parseBambuSelection(body, layerHeight, material) {
    const printerRaw = pickFirstNonEmptyValue(body, ['printerProfile', 'printer']);
    const printerId = resolveBambuPrinterId(printerRaw);
    if (!printerId) {
        return invalid('Invalid printerProfile for Bambu Studio. Allowed values: P1S, H2D.', 'INVALID_PRINTER_PROFILE');
    }

    const layerKey = resolveBambuLayerKey(layerHeight, printerId);
    if (!layerKey) {
        return invalid(
            `Invalid layerHeight for Bambu Studio printer ${printerId}. Allowed values: ${getBambuAllowedLayerKeys(printerId).join(', ')}`,
            'INVALID_LAYER_HEIGHT'
        );
    }

    const processRaw = pickFirstNonEmptyValue(body, ['processProfile']);
    let processName = null;
    if (processRaw !== undefined) {
        const candidate = typeof processRaw === 'string' ? processRaw.trim() : null;
        processName = candidate ? resolveBambuProcessName(printerId, layerKey, candidate) : null;
        if (!processName) {
            return invalid(
                `Invalid processProfile for Bambu Studio printer ${printerId}. Allowed values: ${getBambuProcessNames(printerId).join(', ')}`,
                'INVALID_PROCESS_PROFILE'
            );
        }
    }

    if (!resolveBambuFilamentName(printerId, material)) {
        return invalid(
            `Material ${material} has no Bambu Studio filament profile for printer ${printerId}. Allowed values: ${getBambuMaterials(printerId).join(', ')}`,
            'MATERIAL_PROFILE_UNAVAILABLE'
        );
    }

    return {
        isValid: true,
        layerKey,
        profileOverrides: {
            prusaProfile: null,
            orcaMachineProfile: null,
            orcaProcessProfile: null,
            bambuPrinter: printerId,
            bambuProcessProfile: processName
        }
    };
}

/**
 * Parse size/scale/rotation transform options from request payload.
 * @param {Record<string, unknown>} body Request payload.
 * @returns {{isValid: true, options: {unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parsed transform options.
 */
function parseTransformOptions(body) {
    const unitRaw = pickFirstNonEmptyValue(body, ['sizeUnit', 'unit', 'dimensionUnit']);
    const normalizedUnit = normalizeSizeUnit(unitRaw);
    if (!normalizedUnit.isValid) {
        return invalid(normalizedUnit.error, 'INVALID_SIZE_UNIT');
    }

    let keepProportions = true;
    const keepRaw = pickFirstNonEmptyValue(body, ['keepProportions', 'lockProportions']);
    if (keepRaw === undefined) {
        const unlockRaw = pickFirstNonEmptyValue(body, ['unlockProportions', 'allowNonProportional']);
        if (unlockRaw !== undefined) {
            const parsed = parseBooleanLike(unlockRaw);
            if (parsed === null) {
                return invalid('Invalid unlockProportions value. Allowed values: true/false.', 'INVALID_KEEP_PROPORTIONS');
            }
            keepProportions = !parsed;
        }
    } else {
        const parsed = parseBooleanLike(keepRaw);
        if (parsed === null) {
            return invalid('Invalid keepProportions value. Allowed values: true/false.', 'INVALID_KEEP_PROPORTIONS');
        }
        keepProportions = parsed;
    }

    const targetX = parseOptionalPositiveField(body, ['targetSizeX', 'sizeX', 'dimensionX', 'targetX'], 'targetSizeX');
    const targetY = parseOptionalPositiveField(body, ['targetSizeY', 'sizeY', 'dimensionY', 'targetY'], 'targetSizeY');
    const targetZ = parseOptionalPositiveField(body, ['targetSizeZ', 'sizeZ', 'dimensionZ', 'targetZ'], 'targetSizeZ');
    const scalePercent = parseOptionalPositiveField(body, ['scalePercent'], 'scalePercent');

    if (targetX.error || targetY.error || targetZ.error || scalePercent.error) {
        return invalid(
            targetX.error || targetY.error || targetZ.error || scalePercent.error,
            'INVALID_SIZE_OPTIONS'
        );
    }

    const requestedTargetSize = {
        x: targetX.value,
        y: targetY.value,
        z: targetZ.value
    };
    const hasTargetSize = requestedTargetSize.x !== null || requestedTargetSize.y !== null || requestedTargetSize.z !== null;

    if (hasTargetSize && scalePercent.value !== null) {
        return invalid('Use either scalePercent or targetSizeX/Y/Z in one request, not both.', 'CONFLICTING_SIZE_OPTIONS');
    }

    const rotateX = parseOptionalFiniteField(body, ['rotationX', 'rotateX'], 'rotationX');
    const rotateY = parseOptionalFiniteField(body, ['rotationY', 'rotateY'], 'rotationY');
    const rotateZ = parseOptionalFiniteField(body, ['rotationZ', 'rotateZ'], 'rotationZ');

    if (rotateX.error || rotateY.error || rotateZ.error) {
        return invalid(rotateX.error || rotateY.error || rotateZ.error, 'INVALID_ROTATION_OPTIONS');
    }

    return {
        isValid: true,
        options: {
            unit: normalizedUnit.value,
            keepProportions,
            requestedTargetSize,
            targetSizeMm: normalizeAxisDimensions(requestedTargetSize, normalizedUnit.value),
            scalePercent: scalePercent.value,
            rotationDeg: {
                x: rotateX.value ?? 0,
                y: rotateY.value ?? 0,
                z: rotateZ.value ?? 0
            }
        }
    };
}

/**
 * Parse and validate full slicing option set from request body.
 * @param {Record<string, unknown>} body Request payload.
 * @param {'FDM'|'SLA'|null} forcedTechnology Endpoint-forced technology.
 * @param {'prusa'|'orca'|'bambu'} [engine='prusa'] Slicer engine key.
 * @returns {{isValid: true, options: {layerHeight: number, material: string, infillPercentage: string, supports: boolean, technology: 'FDM'|'SLA', orientationMode: 'auto'|'preserve', transformOptions: object, profileOverrides: object, layerKey?: string}} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parse result.
 */
function parseSliceOptions(body, forcedTechnology, engine = 'prusa') {
    const input = body || {};

    const orientationModeResult = parseOrientationMode(input);
    if (!orientationModeResult.isValid) return orientationModeResult;

    const layerHeight = normalizeLayerHeight(input.layerHeight || `${DEFAULTS.DEFAULT_LAYER_HEIGHT}`);
    if (!layerHeight) {
        return invalid('Invalid layerHeight value.', 'INVALID_LAYER_HEIGHT');
    }

    const infillResult = parseInfill(input);
    if (!infillResult.isValid) return infillResult;
    const infillPercentage = `${infillResult.value}%`;

    const supportsResult = parseSupports(input);
    if (!supportsResult.isValid) return supportsResult;

    const transformOptionsResult = parseTransformOptions(input);
    if (!transformOptionsResult.isValid) return transformOptionsResult;

    const technology = forcedTechnology || (layerHeight <= 0.05 ? 'SLA' : 'FDM');
    const material = input.material || (
        technology === 'SLA'
            ? DEFAULTS.DEFAULT_SLA_MATERIAL
            : DEFAULTS.DEFAULT_FDM_MATERIAL
    );

    if (engine === 'bambu') {
        const materialValidation = validateMaterialForTechnology(technology, material);
        if (!materialValidation.isValid) return materialValidation;
        const bambu = parseBambuSelection(input, layerHeight, material);
        if (!bambu.isValid) return bambu;
        return {
            isValid: true,
            options: {
                layerHeight,
                layerKey: bambu.layerKey,
                material,
                infillPercentage,
                supports: supportsResult.value,
                technology,
                orientationMode: orientationModeResult.value,
                transformOptions: transformOptionsResult.options,
                profileOverrides: bambu.profileOverrides
            }
        };
    }

    const profileOverridesResult = parseProfileOverrides(input, engine);
    if (!profileOverridesResult.isValid) return profileOverridesResult;

    const layerHeightValidationError = validateLayerHeightSelection(layerHeight, forcedTechnology, engine);
    if (layerHeightValidationError) {
        return { isValid: false, response: layerHeightValidationError };
    }

    const materialValidation = validateMaterialForTechnology(technology, material);
    if (!materialValidation.isValid) return materialValidation;

    return {
        isValid: true,
        options: {
            layerHeight,
            material,
            infillPercentage,
            supports: supportsResult.value,
            technology,
            orientationMode: orientationModeResult.value,
            transformOptions: transformOptionsResult.options,
            profileOverrides: profileOverridesResult.profileOverrides
        }
    };
}

module.exports = {
    parseBambuSelection,
    parseInfill,
    parseSliceOptions,
    parseOrientationMode,
    parseSupports,
    validateMaterialForTechnology
};
