'use strict';

/**
 * T-ORI (§2.7, §7): the plugin-side split of the slicer's automatic pose A
 * (`model_transform.automatic_rotation_matrix`) into a tilt T that puts the
 * same face on the plate and a pure plate turn θ, with Rz(θ)·T = A within
 * 1e-9 over 10 000 random rotations and the degenerate flips, plus the
 * specification's test vector. This is the V3 helper's reference: the
 * slicer is not changed for it (R23).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const DEG = Math.PI / 180;

const multiply = (a, b) => a.map((row, i) => b[0].map((_, j) => row.reduce((sum, _value, k) => sum + a[i][k] * b[k][j], 0)));
const transpose = (m) => m[0].map((_, j) => m.map((row) => row[j]));
const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const ry = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Rodrigues: rotation by `angle` about the unit `axis`. */
function axisAngle(axis, angle) {
    const [x, y, z] = axis;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}

/**
 * §2.7: d = Aᵀ·(0,0,−1); T = the minimal rotation taking d to (0,0,−1)
 * (I when d = −z, Rx(180°) when d = +z); P = A·Tᵀ; θ = atan2(P[1][0], P[0][0]).
 */
function splitPose(a) {
    const down = [0, 0, -1];
    const d = apply(transpose(a), down);
    const cross = [d[1] * down[2] - d[2] * down[1], d[2] * down[0] - d[0] * down[2], d[0] * down[1] - d[1] * down[0]];
    const sine = Math.hypot(...cross);
    const cosine = d[0] * down[0] + d[1] * down[1] + d[2] * down[2];
    let tilt;
    if (sine < 1e-12) tilt = cosine > 0 ? IDENTITY : rx(Math.PI);
    else tilt = axisAngle(cross.map((value) => value / sine), Math.atan2(sine, cosine));
    const plate = multiply(a, transpose(tilt));
    return { d, tilt, theta: Math.atan2(plate[1][0], plate[0][0]) };
}

/** X→Y→Z extrinsic Euler angles of R = Rz·Ry·Rx, in degrees. */
function eulerXYZ(r) {
    const y = Math.asin(Math.max(-1, Math.min(1, -r[2][0])));
    if (Math.abs(Math.cos(y)) < 1e-9) return { x: Math.atan2(-r[1][2], r[1][1]) / DEG, y: y / DEG, z: 0 };
    return { x: Math.atan2(r[2][1], r[2][2]) / DEG, y: y / DEG, z: Math.atan2(r[1][0], r[0][0]) / DEG };
}

function maxDifference(a, b) {
    return Math.max(...a.flatMap((row, i) => row.map((value, j) => Math.abs(value - b[i][j]))));
}

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
function prng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A uniform random rotation (Shoemake's quaternion method). */
function randomRotation(next) {
    const [u1, u2, u3] = [next(), next(), next()];
    const q = [Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
        Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)];
    const [x, y, z, w] = q;
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}

function assertSplit(a, label) {
    const { tilt, theta } = splitPose(a);
    assert.ok(maxDifference(multiply(rz(theta), tilt), a) <= 1e-9, `${label}: Rz(θ)·T ≠ A`);
    assert.ok(theta > -Math.PI - 1e-12 && theta <= Math.PI + 1e-12, `${label}: θ out of (−180°, 180°]`);
    const down = apply(tilt, apply(transpose(a), [0, 0, -1]));
    assert.ok(Math.abs(down[2] + 1) <= 1e-9, `${label}: T does not put d on the plate`);
    const euler = eulerXYZ(tilt);
    assert.ok(maxDifference(multiply(rz(euler.z * DEG), multiply(ry(euler.y * DEG), rx(euler.x * DEG))), tilt) <= 1e-9, `${label}: Euler angles do not rebuild T`);
}

test('the specification\'s test vector: A = Rz(22°)·Rx(90°) → d = (0,−1,0), T = Rx(90°), θ = 22°', () => {
    const a = multiply(rz(22 * DEG), rx(90 * DEG));
    const { d, tilt, theta } = splitPose(a);
    assert.ok(maxDifference([d], [[0, -1, 0]]) <= 1e-12);
    assert.ok(maxDifference(tilt, [[1, 0, 0], [0, 0, -1], [0, 1, 0]]) <= 1e-12);
    assert.ok(Math.abs(theta / DEG - 22) <= 1e-9);
    const euler = eulerXYZ(tilt);
    assert.ok(Math.abs(euler.x - 90) <= 1e-9 && Math.abs(euler.y) <= 1e-9 && Math.abs(euler.z) <= 1e-9);
});

test('preserve / unchanged: A = I gives T = I and θ = 0', () => {
    const { tilt, theta } = splitPose(IDENTITY);
    assert.deepEqual(tilt, IDENTITY);
    assert.equal(theta, 0);
});

test('the degenerate flips (d = ±z) and pure plate turns split exactly', () => {
    for (const degrees of [0, 22, 90, -90, 179.999, 180, -179.999]) {
        assertSplit(rz(degrees * DEG), `plate turn ${degrees}`);
        assertSplit(multiply(rz(degrees * DEG), rx(Math.PI)), `upside down + ${degrees}`);
        assertSplit(multiply(rz(degrees * DEG), ry(Math.PI)), `upside down about Y + ${degrees}`);
    }
});

test('10 000 random rotations: Rz(θ)·T = A within 1e-9', () => {
    const next = prng(0x3900);
    for (let index = 0; index < 10_000; index += 1) assertSplit(randomRotation(next), `random #${index}`);
});
