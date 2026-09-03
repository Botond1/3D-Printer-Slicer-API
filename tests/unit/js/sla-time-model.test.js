'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TIME_MODEL_SCHEMA, computeSlaPrintTime } = require('../../../app/services/slice/sla-time-model');

test('the 40 mm cube reference (800 layers at 0.05 mm) matches the documented formula', () => {
    // 5 bottom x (30 + 6.0) + 8 transition x ((30 + 2.5) / 2 + 2.5) + 787 remaining x (2.5 + 2.5)
    // = 180 + 150 + 3935 = 4265 s, using the shipped Saturn 4 Ultra registry defaults.
    const seconds = computeSlaPrintTime({ layerCount: 800, layerHeight: 0.05 });
    assert.equal(seconds, 4265);
});

test('the finer 0.025 mm exposure time changes only the non-bottom/transition contribution', () => {
    const seconds = computeSlaPrintTime({ layerCount: 800, layerHeight: 0.025 });
    // 5 x 36 + 8 x ((30 + 2.0) / 2 + 2.5) + 787 x (2.0 + 2.5) = 180 + 148 + 3541.5 = 3869.5 -> 3870 (rounded)
    assert.equal(seconds, 3870);
});

test('bottom and transition layer counts are each clipped to a short print', () => {
    // layerCount=3 clips bottom(5) and transition(8) both to 3 independently,
    // so remaining is max(0, 3-3-3) = 0:
    // 3 x 36 (bottom) + 3 x 18.75 (transition) + 0 (remaining) = 164.25 -> 164
    const seconds = computeSlaPrintTime({ layerCount: 3, layerHeight: 0.05 });
    assert.equal(seconds, 164);
});

test('a single layer still returns a positive deterministic duration', () => {
    // bottom(1) x 36 + transition(1) x 18.75 + remaining(0) = 54.75 -> 55
    const seconds = computeSlaPrintTime({ layerCount: 1, layerHeight: 0.05 });
    assert.equal(seconds, 55);
});

test('an unsupported layer height fails closed instead of guessing an exposure time', () => {
    assert.throws(
        () => computeSlaPrintTime({ layerCount: 100, layerHeight: 0.1 }),
        /no exposure time for layer height/
    );
});

test('a non-positive-integer layer count fails closed', () => {
    for (const invalid of [0, -1, 1.5, NaN, Infinity, undefined, null]) {
        assert.throws(
            () => computeSlaPrintTime({ layerCount: invalid, layerHeight: 0.05 }),
            /positive integer layer count/
        );
    }
});

test('the result is a deterministic whole-second integer', () => {
    for (let i = 0; i < 3; i++) {
        assert.equal(computeSlaPrintTime({ layerCount: 800, layerHeight: 0.05 }), 4265);
    }
    assert.equal(Number.isInteger(computeSlaPrintTime({ layerCount: 12, layerHeight: 0.025 })), true);
});

test('an unknown printer id fails closed', () => {
    assert.throws(
        () => computeSlaPrintTime({ layerCount: 10, layerHeight: 0.05, printerId: 'UNKNOWN' }),
        /Unknown SLA printer id/
    );
});

test('the schema constant matches the registry-declared time model version', () => {
    assert.equal(TIME_MODEL_SCHEMA, 'sla-layer-time-v1');
});
