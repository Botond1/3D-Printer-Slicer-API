/**
 * Model transformation planning (scale/rotate) and post-transform bounds validation.
 */

const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand, throwIfAborted } = require('./command');
const { resolvePythonHelper } = require('./helper-paths');
const {
    MODEL_INFO_MEASUREMENT_STATUSES,
    createMeasuredModelMeasurement,
    createUnavailableModelMeasurement,
    getModelInfo,
    isModelMeasurement,
    isPositiveModelMeasurement
} = require('./model-stats');
const { validateModelDimensionsAgainstLimits } = require('./profiles');
const { roundDimensions } = require('./common');
const {
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix
} = require('./orientation-contract');

/**
 * Check whether all base model dimensions are positive.
 * @param {{x: number, y: number, z: number}} dimensions Parsed dimensions.
 * @returns {boolean} True when all axes are strictly positive.
 */
function hasPositiveDimensions(dimensions) {
    return Object.values(dimensions).every((value) => Number.isFinite(value) && value > 0);
}

function normalizeDirectModelMeasurement(candidate) {
    if (candidate?.status === MODEL_INFO_MEASUREMENT_STATUSES.MEASURED) {
        return isModelMeasurement(candidate)
            ? candidate
            : createUnavailableModelMeasurement();
    }
    if (candidate?.status === MODEL_INFO_MEASUREMENT_STATUSES.UNAVAILABLE) {
        return candidate.modelInfo === null
            ? candidate
            : createUnavailableModelMeasurement();
    }
    if (
        candidate
        && typeof candidate === 'object'
        && ['x', 'y', 'z'].every((axis) => (
            Object.hasOwn(candidate, axis)
            && Number.isFinite(Number(candidate[axis]))
            && Number(candidate[axis]) >= 0
        ))
    ) {
        try {
            return createMeasuredModelMeasurement(candidate);
        } catch {
            return createUnavailableModelMeasurement();
        }
    }
    return createUnavailableModelMeasurement();
}

function modelDimensionsUnavailableResult() {
    return {
        isValid: false,
        status: 422,
        response: {
            success: false,
            error: 'Model dimensions could not be resolved after preprocessing.',
            errorCode: 'MODEL_DIMENSIONS_UNAVAILABLE'
        }
    };
}

/**
 * Check if any target sizing axis was requested.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size.
 * @returns {boolean} True when at least one axis is provided.
 */
function hasTargetSizing(targetSizeMm) {
    return targetSizeMm.x !== null || targetSizeMm.y !== null || targetSizeMm.z !== null;
}

/**
 * Build uniform scale factors from proportional target sizing.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size in millimeters.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale result.
 */
function buildProportionalScale(baseDimensions, targetSizeMm) {
    const ratios = [];

    if (targetSizeMm.x !== null) ratios.push(targetSizeMm.x / baseDimensions.x);
    if (targetSizeMm.y !== null) ratios.push(targetSizeMm.y / baseDimensions.y);
    if (targetSizeMm.z !== null) ratios.push(targetSizeMm.z / baseDimensions.z);

    const factor = ratios.find((value) => Number.isFinite(value) && value > 0);
    if (!factor) {
        return {
            isValid: false,
            error: 'Invalid proportional scaling ratio derived from target size values.'
        };
    }

    return {
        isValid: true,
        scale: { x: factor, y: factor, z: factor }
    };
}

/**
 * Build independent per-axis scale factors.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size in millimeters.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale result.
 */
function buildIndependentScale(baseDimensions, targetSizeMm) {
    const scaleX = targetSizeMm.x === null ? 1 : (targetSizeMm.x / baseDimensions.x);
    const scaleY = targetSizeMm.y === null ? 1 : (targetSizeMm.y / baseDimensions.y);
    const scaleZ = targetSizeMm.z === null ? 1 : (targetSizeMm.z / baseDimensions.z);

    if (![scaleX, scaleY, scaleZ].every((value) => Number.isFinite(value) && value > 0)) {
        return {
            isValid: false,
            error: 'Invalid non-proportional scaling ratio derived from target size values.'
        };
    }

    return {
        isValid: true,
        scale: { x: scaleX, y: scaleY, z: scaleZ }
    };
}

/**
 * Resolve final scale vector from transform options.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{scalePercent: number | null, targetSizeMm: {x: number | null, y: number | null, z: number | null}, keepProportions: boolean}} transformOptions Parsed transform options.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale resolution result.
 */
function resolveScaleFromOptions(baseDimensions, transformOptions) {
    if (transformOptions.scalePercent !== null) {
        const factor = transformOptions.scalePercent / 100;
        return {
            isValid: true,
            scale: { x: factor, y: factor, z: factor }
        };
    }

    if (!hasTargetSizing(transformOptions.targetSizeMm)) {
        return {
            isValid: true,
            scale: { x: 1, y: 1, z: 1 }
        };
    }

    if (transformOptions.keepProportions) {
        return buildProportionalScale(baseDimensions, transformOptions.targetSizeMm);
    }

    return buildIndependentScale(baseDimensions, transformOptions.targetSizeMm);
}

/**
 * Build full transform plan (scale + rotation) for model preprocessing.
 * @param {{x: number|string, y: number|string, z: number|string}} modelInfo Model dimensions.
 * @param {{unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} transformOptions Parsed transform options.
 * @returns {{isValid: true, plan: {requiresTransform: boolean, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}, requestedUnit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, predictedSizeMm: {x: number, y: number, z: number}}} | {isValid: false, error: string}} Transform plan result.
 */
function buildModelTransformPlan(modelInfo, transformOptions) {
    const baseDimensions = {
        x: Number(modelInfo.x),
        y: Number(modelInfo.y),
        z: Number(modelInfo.z)
    };

    const isSizingRequested = hasTargetSizing(transformOptions.targetSizeMm) || transformOptions.scalePercent !== null;
    if (isSizingRequested && !hasPositiveDimensions(baseDimensions)) {
        return {
            isValid: false,
            error: 'Model dimensions could not be resolved for scaling. Please provide a valid 3D model.'
        };
    }

    const scaleResult = resolveScaleFromOptions(baseDimensions, transformOptions);
    if (!scaleResult.isValid) {
        return scaleResult;
    }

    const scale = scaleResult.scale;
    const hasScale = Math.abs(scale.x - 1) > 1e-9 || Math.abs(scale.y - 1) > 1e-9 || Math.abs(scale.z - 1) > 1e-9;
    const hasRotation = Math.abs(transformOptions.rotationDeg.x) > 1e-9 || Math.abs(transformOptions.rotationDeg.y) > 1e-9 || Math.abs(transformOptions.rotationDeg.z) > 1e-9;

    return {
        isValid: true,
        plan: {
            requiresTransform: hasScale || hasRotation,
            scale,
            rotationDeg: { ...transformOptions.rotationDeg },
            requestedUnit: transformOptions.unit,
            keepProportions: transformOptions.keepProportions,
            requestedTargetSize: { ...transformOptions.requestedTargetSize },
            predictedSizeMm: {
                x: baseDimensions.x * scale.x,
                y: baseDimensions.y * scale.y,
                z: baseDimensions.z * scale.z
            }
        }
    };
}

/**
 * Execute Python-based scale/rotation transform for STL model.
 * @param {string} inputPath Input STL path.
 * @param {{scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}}} transformPlan Transform plan.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {() => string} [suffixFactory] Server-generated suffix factory.
 * @returns {Promise<string>} Transformed STL path.
 */
async function applyModelTransform(inputPath, transformPlan, workspace, suffixFactory, signal) {
    throwIfAborted(signal);
    const transformedPath = resolveTransformedPath(inputPath, workspace, suffixFactory);

    const args = [transformPlan.scale.x, transformPlan.scale.y, transformPlan.scale.z,
        transformPlan.rotationDeg.x, transformPlan.rotationDeg.y, transformPlan.rotationDeg.z]
        .map((value) => Number.parseFloat(value).toString());

    await runCommand(PYTHON_EXECUTABLE, [
        resolvePythonHelper('scale_model.py'), inputPath, transformedPath, ...args
    ], { signal });
    throwIfAborted(signal);
    const transformedStat = await fs.lstat(transformedPath);
    if (!transformedStat.isFile() || transformedStat.isSymbolicLink()) {
        throw new Error('Model transform did not produce a safe STL file.');
    }
    return transformedPath;
}

/**
 * Resolve a collision-resistant contained transform output path.
 * @param {string} inputPath Contained STL input path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {() => string} [suffixFactory] Server-generated suffix factory.
 * @returns {string} Contained transform output path.
 */
function resolveTransformedPath(inputPath, workspace, suffixFactory = () => randomBytes(8).toString('hex')) {
    workspace.assertContainedPath(inputPath);
    const suffix = String(suffixFactory());
    if (!/^[a-f0-9]{16}$/i.test(suffix)) {
        throw new Error('Invalid server-generated transform suffix.');
    }
    return workspace.assertContainedPath(inputPath.replace(/\.stl$/i, `_scaled_${suffix}.stl`));
}

/**
 * Apply optional transform and validate final model bounds against build-volume limits.
 * @param {string} processableFile STL candidate path.
 * @param {{status: 'measured'|'unavailable', modelInfo: {x: number, y: number, z: number, height_mm: number}|null}|{x: number|string, y: number|string, z: number|string, height_mm?: number}} orientedModelMeasurement Post-orientation measurement. A raw object is accepted only for direct/unit compatibility.
 * @param {{unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} transformOptions Parsed transform options.
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} buildVolumeLimits Printer limits.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @param {{orientation?: Readonly<Record<string, unknown>>, originalModelMeasurement?: Record<string, unknown>, originalModelInfo?: Record<string, number>}} [transformContext] Orientation and original-measurement provenance used by the versioned response contract. `originalModelInfo` is a direct/unit compatibility seam.
 * @returns {Promise<
 *   {isValid: true, processableFile: string, transformPlan: Record<string, unknown>, modelTransform: Record<string, unknown>, effectiveModelInfo: {x: number, y: number, z: number, height_mm: number}, modelBoundsValidation: {isValid: true, dimensions: {x: number, y: number, z: number}}}
 *   | {isValid: false, status: number, response: {success: false, error: string, errorCode: string, model_dimensions_mm?: {x: number, y: number, z: number}, model_transform?: Record<string, unknown>, build_volume_limits_mm?: {min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, source_profile: string}}}
 * >} Validation result.
 */
async function applyTransformAndValidateModel(
    processableFile,
    orientedModelMeasurementCandidate,
    transformOptions,
    buildVolumeLimits,
    workspace,
    signal,
    transformContext = {}
) {
    throwIfAborted(signal);
    const orientedModelMeasurement = normalizeDirectModelMeasurement(orientedModelMeasurementCandidate);
    if (!isPositiveModelMeasurement(orientedModelMeasurement)) {
        return modelDimensionsUnavailableResult();
    }
    const orientedModelInfo = orientedModelMeasurement.modelInfo;
    const transformPlanResult = buildModelTransformPlan(orientedModelInfo, transformOptions);
    if (!transformPlanResult.isValid) {
        return {
            isValid: false,
            status: 400,
            response: {
                success: false,
                error: transformPlanResult.error,
                errorCode: 'INVALID_SIZE_OPTIONS'
            }
        };
    }
    const transformPlan = transformPlanResult.plan;

    let transformedFilePath = processableFile;
    if (transformPlan.requiresTransform) {
        transformedFilePath = await applyModelTransform(processableFile, transformPlan, workspace, undefined, signal);
    }

    throwIfAborted(signal);
    const finalModelMeasurement = transformPlan.requiresTransform
        ? await getModelInfo(transformedFilePath, signal) : orientedModelMeasurement;
    throwIfAborted(signal);
    if (!isPositiveModelMeasurement(finalModelMeasurement)) return modelDimensionsUnavailableResult();
    const effectiveModelInfo = finalModelMeasurement.modelInfo;

    const modelBoundsValidation = validateModelDimensionsAgainstLimits(effectiveModelInfo, buildVolumeLimits);
    const orientation = transformContext.orientation || createOrientationState(
        'auto',
        'unchanged',
        identityRotationMatrix()
    );
    const originalModelMeasurement = Object.hasOwn(transformContext, 'originalModelMeasurement')
        ? normalizeDirectModelMeasurement(transformContext.originalModelMeasurement)
        : Object.hasOwn(transformContext, 'originalModelInfo')
            ? normalizeDirectModelMeasurement(transformContext.originalModelInfo)
            // Direct/unit callers predating the explicit measurement state treat
            // their positive oriented input as the same measured original input.
            : orientedModelMeasurement;
    const modelTransform = buildModelTransformContract({
        transformOptions,
        transformPlan,
        orientation,
        originalModelMeasurement,
        orientedModelMeasurement,
        finalModelMeasurement
    });
    if (!modelBoundsValidation.isValid) {
        const issues = [
            ...modelBoundsValidation.tooSmall,
            ...modelBoundsValidation.tooLarge
        ].join('; ');

        return {
            isValid: false,
            status: 422,
            response: {
                success: false,
                error: `Model dimensions are outside selected printer limits. ${issues}`,
                errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS',
                model_dimensions_mm: roundDimensions(modelBoundsValidation.dimensions),
                model_transform: modelTransform,
                build_volume_limits_mm: {
                    min: roundDimensions(buildVolumeLimits.min),
                    max: roundDimensions(buildVolumeLimits.max),
                    source_profile: buildVolumeLimits.sourceProfile
                }
            }
        };
    }

    return {
        isValid: true,
        processableFile: transformedFilePath,
        transformPlan,
        modelTransform,
        effectiveModelInfo,
        modelBoundsValidation
    };
}

module.exports = {
    applyTransformAndValidateModel,
    normalizeDirectModelMeasurement,
    resolveTransformedPath
};
