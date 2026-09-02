'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const {
    buildModelTransformPlan,
    buildProportionalScale
} = require('../../../app/services/slice/transform');

const BASE = { x: 100, y: 50, z: 20 };

function options(targetSizeMm, keepProportions = true) {
    return {
        unit: 'mm',
        keepProportions,
        requestedTargetSize: { ...targetSizeMm },
        targetSizeMm,
        scalePercent: null,
        rotationDeg: { x: 0, y: 0, z: 0 }
    };
}

test('keepProportions with several target axes fits within the box using the minimum ratio', () => {
    const result = buildProportionalScale(BASE, { x: 200, y: 200, z: null });
    assert.equal(result.isValid, true);
    // x ratio 2, y ratio 4: the smaller ratio wins so no axis exceeds its target.
    assert.deepEqual(result.scale, { x: 2, y: 2, z: 2 });

    const plan = buildModelTransformPlan(BASE, options({ x: 200, y: 200, z: 10 }));
    assert.equal(plan.isValid, true);
    // z ratio 0.5 is the binding constraint.
    assert.deepEqual(plan.plan.scale, { x: 0.5, y: 0.5, z: 0.5 });
    assert.deepEqual(plan.plan.predictedSizeMm, { x: 50, y: 25, z: 10 });
    for (const axis of ['x', 'y', 'z']) {
        assert.ok(plan.plan.predictedSizeMm[axis] <= { x: 200, y: 200, z: 10 }[axis]);
    }
});

test('keepProportions with a single axis keeps the historical exact-fit behaviour', () => {
    const result = buildProportionalScale(BASE, { x: null, y: 100, z: null });
    assert.deepEqual(result, { isValid: true, scale: { x: 2, y: 2, z: 2 } });
});

test('keepProportions rejects NaN, zero, negative, and zero-base ratios instead of skipping them', () => {
    for (const target of [
        { x: Number.NaN, y: 100, z: null },
        { x: 0, y: 100, z: null },
        { x: -5, y: 100, z: null },
        { x: 100, y: Number.POSITIVE_INFINITY, z: null },
        { x: null, y: null, z: null }
    ]) {
        const result = buildProportionalScale(BASE, target);
        assert.equal(result.isValid, false, JSON.stringify(target));
        assert.match(result.error, /Invalid proportional scaling ratio/);
    }
    const zeroBase = buildProportionalScale({ x: 0, y: 50, z: 20 }, { x: 10, y: 100, z: null });
    assert.equal(zeroBase.isValid, false);
});
