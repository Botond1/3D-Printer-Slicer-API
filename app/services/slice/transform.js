/**
 * Model transformation planning (scale/rotate) and post-transform bounds validation.
 */

const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand, throwIfAborted, PYTHON_HELPER_TIMEOUT_MS } = require('./command');
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
const { roundDimensions, roundToThree } = require('./common');
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
 *
 * Fit-within-box semantics: every requested axis contributes one ratio
 * `target / base`, and the single uniform factor is the minimum of those
 * ratios. The scaled model therefore never exceeds any requested axis; when
 * several axes are given, at most one of them is met exactly and the others
 * come out smaller. A requested axis whose ratio is non-finite or not
 * strictly positive (NaN, zero, negative, or a zero base dimension) is
 * rejected instead of being silently skipped.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size in millimeters.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale result.
 */
function buildProportionalScale(baseDimensions, targetSizeMm) {
    const ratios = [];

    if (targetSizeMm.x !== null) ratios.push(targetSizeMm.x / baseDimensions.x);
    if (targetSizeMm.y !== null) ratios.push(targetSizeMm.y / baseDimensions.y);
    if (targetSizeMm.z !== null) ratios.push(targetSizeMm.z / baseDimensions.z);

    if (ratios.length === 0 || !ratios.every((value) => Number.isFinite(value) && value > 0)) {
        return {
            isValid: false,
            error: 'Invalid proportional scaling ratio derived from target size values.'
        };
    }

    const factor = Math.min(...ratios);
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

/** Identity scale/rotation used by the placement-only helper pass. */
const IDENTITY_TRANSFORM_PLAN = Object.freeze({
    scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 })
});

/**
 * Run `scale_model.py` once. The optional placement appends the explicit
 * `--place-min-x`/`--place-min-y` pair, which translates the already scaled,
 * rotated, and grounded mesh so its bounding-box minimum corner lands on the
 * given coordinates (Z stays grounded).
 * @param {string} inputPath Contained input STL path.
 * @param {string} outputPath Contained output STL path.
 * @param {{scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}}} transformPlan Transform plan.
 * @param {{xMin: number, yMin: number}|null} placement Optional placement.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @returns {Promise<string>} Output STL path.
 */
async function runScaleModelHelper(inputPath, outputPath, transformPlan, placement, signal) {
    const args = [transformPlan.scale.x, transformPlan.scale.y, transformPlan.scale.z,
        transformPlan.rotationDeg.x, transformPlan.rotationDeg.y, transformPlan.rotationDeg.z]
        .map((value) => Number.parseFloat(value).toString());
    if (placement) {
        for (const [flag, value] of [['--place-min-x', placement.xMin], ['--place-min-y', placement.yMin]]) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) throw new Error('Model placement coordinates must be finite.');
            args.push(flag, numeric.toString());
        }
    }

    await runCommand(PYTHON_EXECUTABLE, [
        resolvePythonHelper('scale_model.py'), inputPath, outputPath, ...args
    ], { signal, timeoutMs: PYTHON_HELPER_TIMEOUT_MS });
    throwIfAborted(signal);
    const outputStat = await fs.lstat(outputPath);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) {
        throw new Error('Model transform did not produce a safe STL file.');
    }
    return outputPath;
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
    return runScaleModelHelper(inputPath, transformedPath, transformPlan, null, signal);
}

/**
 * Translate the final model onto its API-owned bed placement (Bambu only).
 * Runs after the bounds check, on the already sized/rotated STL, so the
 * dimensions the placement was decided on are exactly the ones translated.
 * @param {string} inputPath Final contained STL path.
 * @param {{xMin: number, yMin: number}} placement Chosen placement.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {() => string} [suffixFactory] Server-generated suffix factory.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @returns {Promise<string>} Placed STL path.
 */
async function applyModelPlacement(inputPath, placement, workspace, suffixFactory, signal) {
    throwIfAborted(signal);
    const placedPath = resolveTransformedPath(inputPath, workspace, suffixFactory, 'placed');
    return runScaleModelHelper(inputPath, placedPath, IDENTITY_TRANSFORM_PLAN, placement, signal);
}

/**
 * Resolve a collision-resistant contained transform output path.
 * @param {string} inputPath Contained STL input path.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {() => string} [suffixFactory] Server-generated suffix factory.
 * @param {'scaled'|'placed'} [label='scaled'] Stable server-owned stage label.
 * @returns {string} Contained transform output path.
 */
function resolveTransformedPath(inputPath, workspace, suffixFactory = () => randomBytes(8).toString('hex'), label = 'scaled') {
    workspace.assertContainedPath(inputPath);
    const suffix = String(suffixFactory());
    if (!/^[a-f0-9]{16}$/i.test(suffix)) {
        throw new Error('Invalid server-generated transform suffix.');
    }
    if (label !== 'scaled' && label !== 'placed') {
        throw new Error('Invalid server-generated transform label.');
    }
    return workspace.assertContainedPath(inputPath.replace(/\.stl$/i, `_${label}_${suffix}.stl`));
}

/**
 * Apply optional transform and validate final model bounds against build-volume limits.
 * @param {string} processableFile STL candidate path.
 * @param {{status: 'measured'|'unavailable', modelInfo: {x: number, y: number, z: number, height_mm: number}|null}|{x: number|string, y: number|string, z: number|string, height_mm?: number}} orientedModelMeasurement Post-orientation measurement. A raw object is accepted only for direct/unit compatibility.
 * @param {{unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} transformOptions Parsed transform options.
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string, bedGeometry?: object}} buildVolumeLimits Printer limits. Limits carrying `bedGeometry` (Bambu) are validated by placement and the accepted model is translated onto that placement.
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @param {{orientation?: Readonly<Record<string, unknown>>, originalModelMeasurement?: Record<string, unknown>, originalModelInfo?: Record<string, number>}} [transformContext] Orientation and original-measurement provenance used by the versioned response contract. `originalModelInfo` is a direct/unit compatibility seam.
 * @returns {Promise<
 *   {isValid: true, processableFile: string, transformPlan: Record<string, unknown>, modelTransform: Record<string, unknown>, effectiveModelInfo: {x: number, y: number, z: number, height_mm: number}, modelBoundsValidation: {isValid: true, dimensions: {x: number, y: number, z: number}}, placement: {x_min: number, y_min: number}|null}
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

    let placement = null;
    if (modelBoundsValidation.placement) {
        // Bambu only: the bounds check chose a placement on the real bed shape;
        // translate the final STL onto it because `--arrange 0` keeps the
        // coordinates exactly. Translation does not change any dimension, so
        // the measured final dimensions and the transform contract stay valid.
        transformedFilePath = await applyModelPlacement(
            transformedFilePath,
            modelBoundsValidation.placement,
            workspace,
            undefined,
            signal
        );
        throwIfAborted(signal);
        placement = {
            x_min: roundToThree(modelBoundsValidation.placement.xMin),
            y_min: roundToThree(modelBoundsValidation.placement.yMin)
        };
    }

    return {
        isValid: true,
        processableFile: transformedFilePath,
        transformPlan,
        modelTransform,
        effectiveModelInfo,
        modelBoundsValidation,
        placement
    };
}

module.exports = {
    applyModelPlacement,
    applyTransformAndValidateModel,
    buildModelTransformPlan,
    buildProportionalScale,
    normalizeDirectModelMeasurement,
    resolveTransformedPath
};
