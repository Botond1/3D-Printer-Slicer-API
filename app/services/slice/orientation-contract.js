'use strict';

const { roundDimensions } = require('./common');
const {
    MODEL_INFO_MEASUREMENT_STATUSES,
    isModelMeasurement,
    isPositiveModelMeasurement
} = require('./model-stats');

const TRANSFORM_SCHEMA = 2;
const ORIENTATION_METADATA_SCHEMA = 1;
const ORIENTATION_MODES = Object.freeze(['auto', 'preserve']);
const ORIENTATION_OUTCOMES = Object.freeze([
    'applied',
    'unchanged',
    'preserved',
    'fallback_unmodified'
]);
const MATRIX_TOLERANCE = 1e-5;
const IDENTITY_TOLERANCE = 1e-7;

function identityRotationMatrix() {
    return [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
    ];
}

function determinant3(matrix) {
    return (
        (matrix[0][0] * ((matrix[1][1] * matrix[2][2]) - (matrix[1][2] * matrix[2][1])))
        - (matrix[0][1] * ((matrix[1][0] * matrix[2][2]) - (matrix[1][2] * matrix[2][0])))
        + (matrix[0][2] * ((matrix[1][0] * matrix[2][1]) - (matrix[1][1] * matrix[2][0])))
    );
}

function dot(left, right) {
    return left.reduce((sum, value, index) => sum + (value * right[index]), 0);
}

function transpose(matrix) {
    return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function validateRotationMatrix(candidate) {
    if (
        !Array.isArray(candidate)
        || candidate.length !== 3
        || candidate.some((row) => !Array.isArray(row) || row.length !== 3)
    ) {
        throw new Error('Orientation rotation matrix must be a 3x3 array.');
    }

    if (candidate.flat().some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('Orientation rotation matrix values must be finite numbers.');
    }
    const matrix = candidate.map((row) => [...row]);
    if (matrix.flat().some((value) => Math.abs(value) > 1.000001)) {
        throw new Error('Orientation rotation matrix contains an invalid value.');
    }

    const columns = transpose(matrix);
    for (const vectors of [matrix, columns]) {
        for (let index = 0; index < 3; index += 1) {
            if (Math.abs(dot(vectors[index], vectors[index]) - 1) > MATRIX_TOLERANCE) {
                throw new Error('Orientation rotation matrix is not normalized.');
            }
            for (let other = index + 1; other < 3; other += 1) {
                if (Math.abs(dot(vectors[index], vectors[other])) > MATRIX_TOLERANCE) {
                    throw new Error('Orientation rotation matrix is not orthogonal.');
                }
            }
        }
    }

    if (Math.abs(determinant3(matrix) - 1) > MATRIX_TOLERANCE) {
        throw new Error('Orientation rotation matrix is not a proper rotation.');
    }
    return matrix;
}

function isIdentityRotation(matrix, tolerance = IDENTITY_TOLERANCE) {
    const identity = identityRotationMatrix();
    return matrix.every((row, rowIndex) => row.every(
        (value, columnIndex) => Math.abs(value - identity[rowIndex][columnIndex]) <= tolerance
    ));
}

function multiplyRotationMatrices(leftCandidate, rightCandidate) {
    const left = validateRotationMatrix(leftCandidate);
    const right = validateRotationMatrix(rightCandidate);
    const result = identityRotationMatrix().map((row, rowIndex) => row.map((_, columnIndex) => (
        left[rowIndex].reduce(
            (sum, value, innerIndex) => sum + (value * right[innerIndex][columnIndex]),
            0
        )
    )));
    return validateRotationMatrix(result);
}

function normalizeDegrees(value) {
    let normalized = Number(value) % 360;
    if (normalized >= 180) normalized -= 360;
    if (normalized < -180) normalized += 360;
    return Math.abs(normalized) < 1e-10 ? 0 : normalized;
}

function rotationMatrixFromEulerDegrees(rotationDeg) {
    const x = normalizeDegrees(rotationDeg.x) * (Math.PI / 180);
    const y = normalizeDegrees(rotationDeg.y) * (Math.PI / 180);
    const z = normalizeDegrees(rotationDeg.z) * (Math.PI / 180);
    const [sx, cx] = [Math.sin(x), Math.cos(x)];
    const [sy, cy] = [Math.sin(y), Math.cos(y)];
    const [sz, cz] = [Math.sin(z), Math.cos(z)];

    return validateRotationMatrix([
        [(cz * cy), ((cz * sy * sx) - (sz * cx)), ((cz * sy * cx) + (sz * sx))],
        [(sz * cy), ((sz * sy * sx) + (cz * cx)), ((sz * sy * cx) - (cz * sx))],
        [-sy, (cy * sx), (cy * cx)]
    ]);
}

function rotationMatrixToEulerDegrees(matrixCandidate) {
    const matrix = validateRotationMatrix(matrixCandidate);
    const sinY = Math.max(-1, Math.min(1, -matrix[2][0]));
    let x;
    let y;
    let z;

    if (Math.abs(Math.abs(sinY) - 1) > 1e-8) {
        y = Math.asin(sinY);
        x = Math.atan2(matrix[2][1], matrix[2][2]);
        z = Math.atan2(matrix[1][0], matrix[0][0]);
    } else if (sinY > 0) {
        y = Math.PI / 2;
        x = Math.atan2(matrix[0][1], matrix[0][2]);
        z = 0;
    } else {
        y = -Math.PI / 2;
        x = Math.atan2(-matrix[0][1], -matrix[0][2]);
        z = 0;
    }

    return {
        x: normalizeDegrees(x * (180 / Math.PI)),
        y: normalizeDegrees(y * (180 / Math.PI)),
        z: normalizeDegrees(z * (180 / Math.PI))
    };
}

function roundFinite(value, digits = 6) {
    if (!Number.isFinite(value)) throw new Error('Transform contract contains a non-finite number.');
    const factor = 10 ** digits;
    const rounded = Math.round(value * factor) / factor;
    if (!Number.isFinite(rounded)) return value;
    return Object.is(rounded, -0) || Math.abs(rounded) < (1 / factor) ? 0 : rounded;
}

function roundRotation(rotation) {
    return {
        x: roundFinite(rotation.x),
        y: roundFinite(rotation.y),
        z: roundFinite(rotation.z)
    };
}

function roundRotationMatrix(matrix) {
    return validateRotationMatrix(matrix).map((row) => row.map((value) => roundFinite(value, 9)));
}

function createOrientationState(mode, outcome, rotationMatrix = identityRotationMatrix()) {
    if (!ORIENTATION_MODES.includes(mode)) throw new Error('Unsupported orientation mode.');
    if (!ORIENTATION_OUTCOMES.includes(outcome)) throw new Error('Unsupported orientation outcome.');

    const matrix = validateRotationMatrix(rotationMatrix);
    const applied = !isIdentityRotation(matrix);
    const validCombination = (
        (mode === 'preserve' && outcome === 'preserved' && !applied)
        || (mode === 'auto' && outcome === 'applied' && applied)
        || (mode === 'auto' && ['unchanged', 'fallback_unmodified'].includes(outcome) && !applied)
    );
    if (!validCombination) throw new Error('Orientation mode, outcome, and matrix are inconsistent.');

    return Object.freeze({
        mode,
        outcome,
        automaticOrientationApplied: applied,
        automaticRotationMatrix: Object.freeze(matrix.map((row) => Object.freeze([...row])))
    });
}

function roundModelDimensions(modelInfo) {
    const dimensions = {
        x: Number(modelInfo?.x),
        y: Number(modelInfo?.y),
        z: Number(modelInfo?.z)
    };
    if (Object.values(dimensions).some((value) => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Transform contract model dimensions are unavailable.');
    }
    return roundDimensions(dimensions);
}

function assertModelMeasurement(measurement) {
    if (
        measurement?.status === MODEL_INFO_MEASUREMENT_STATUSES.UNAVAILABLE
        && measurement.modelInfo === null
    ) return measurement;
    if (
        measurement?.status === MODEL_INFO_MEASUREMENT_STATUSES.MEASURED
        && isModelMeasurement(measurement)
    ) return measurement;
    throw new Error('Transform contract model measurement has an unexpected shape.');
}

function buildOriginalDimensionsContract(measurementCandidate) {
    const measurement = assertModelMeasurement(measurementCandidate);
    if (measurement.status === MODEL_INFO_MEASUREMENT_STATUSES.UNAVAILABLE) {
        return {
            originalDimensionsAvailable: false,
            originalDimensionsMm: null
        };
    }
    return {
        originalDimensionsAvailable: true,
        originalDimensionsMm: roundDimensions({
            x: measurement.modelInfo.x,
            y: measurement.modelInfo.y,
            z: measurement.modelInfo.z
        })
    };
}

function roundRequiredModelMeasurement(measurementCandidate) {
    const measurement = assertModelMeasurement(measurementCandidate);
    if (!isPositiveModelMeasurement(measurement)) {
        throw new Error('Transform contract load-bearing model dimensions are unavailable.');
    }
    return roundModelDimensions(measurement.modelInfo);
}

function parseOrientationMetadata(candidate, expectedMode) {
    if (
        !candidate
        || typeof candidate !== 'object'
        || Array.isArray(candidate)
        || Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
        throw new Error('Orientation metadata must be an object.');
    }
    const expectedKeys = [
        'orientation_metadata_schema',
        'orientation_mode',
        'orientation_outcome',
        'rotation_matrix'
    ];
    const actualKeys = Object.keys(candidate).sort();
    if (
        actualKeys.length !== expectedKeys.length
        || actualKeys.some((key, index) => key !== [...expectedKeys].sort()[index])
    ) throw new Error('Orientation metadata has an unexpected shape.');
    if (candidate.orientation_metadata_schema !== ORIENTATION_METADATA_SCHEMA) {
        throw new Error('Unsupported orientation metadata schema.');
    }
    if (candidate.orientation_mode !== expectedMode) {
        throw new Error('Orientation metadata mode does not match the request.');
    }
    return createOrientationState(
        candidate.orientation_mode,
        candidate.orientation_outcome,
        candidate.rotation_matrix
    );
}

function buildModelTransformContract(context) {
    const {
        transformOptions,
        transformPlan,
        orientation,
        originalModelMeasurement,
        orientedModelMeasurement,
        finalModelMeasurement
    } = context;
    const normalizedOrientation = createOrientationState(
        orientation.mode,
        orientation.outcome,
        orientation.automaticRotationMatrix
    );
    const automaticMatrix = normalizedOrientation.automaticRotationMatrix;
    const requestedMatrix = rotationMatrixFromEulerDegrees(transformPlan.rotationDeg);
    const totalMatrix = multiplyRotationMatrices(requestedMatrix, automaticMatrix);
    const originalDimensions = buildOriginalDimensionsContract(originalModelMeasurement);

    return {
        transform_schema: TRANSFORM_SCHEMA,
        size_unit: transformOptions.unit,
        keep_proportions: transformPlan.keepProportions,
        requested_size: {
            x: transformPlan.requestedTargetSize.x === null
                ? null : roundFinite(transformPlan.requestedTargetSize.x, 3),
            y: transformPlan.requestedTargetSize.y === null
                ? null : roundFinite(transformPlan.requestedTargetSize.y, 3),
            z: transformPlan.requestedTargetSize.z === null
                ? null : roundFinite(transformPlan.requestedTargetSize.z, 3)
        },
        scale_percent: transformOptions.scalePercent,
        scale_factors: roundDimensions(transformPlan.scale),
        orientation_mode: normalizedOrientation.mode,
        orientation_outcome: normalizedOrientation.outcome,
        automatic_orientation_applied: normalizedOrientation.automaticOrientationApplied,
        automatic_rotation_deg: roundRotation(rotationMatrixToEulerDegrees(automaticMatrix)),
        requested_rotation_deg: roundRotation(transformPlan.rotationDeg),
        rotation_deg: roundRotation(rotationMatrixToEulerDegrees(totalMatrix)),
        automatic_rotation_matrix: roundRotationMatrix(automaticMatrix),
        rotation_matrix: roundRotationMatrix(totalMatrix),
        original_dimensions_available: originalDimensions.originalDimensionsAvailable,
        original_dimensions_mm: originalDimensions.originalDimensionsMm,
        oriented_dimensions_mm: roundRequiredModelMeasurement(orientedModelMeasurement),
        final_dimensions_mm: roundRequiredModelMeasurement(finalModelMeasurement)
    };
}

module.exports = {
    ORIENTATION_METADATA_SCHEMA,
    ORIENTATION_MODES,
    ORIENTATION_OUTCOMES,
    TRANSFORM_SCHEMA,
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix,
    isIdentityRotation,
    multiplyRotationMatrices,
    parseOrientationMetadata,
    rotationMatrixFromEulerDegrees,
    rotationMatrixToEulerDegrees,
    validateRotationMatrix
};
