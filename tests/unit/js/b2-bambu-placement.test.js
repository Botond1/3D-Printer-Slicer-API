'use strict';

/**
 * Bambu Studio placement contract: measured envelope constants, bed geometry
 * parsed from the flattened vendor machine, deterministic API-owned placement
 * (centre, shift +Y, shift +X, reject), L-shaped admission through the generic
 * bounds validator, the `scale_model.py --place-min-x/--place-min-y` argv, and
 * the `placement_mm` response/OpenAPI contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/bambu-profiles');
const COMMAND_PATH = path.join(ROOT, 'app/services/slice/command.js');
const PYTHON_PATH = path.join(ROOT, 'app/config/python.js');
const MODEL_STATS_PATH = path.join(ROOT, 'app/services/slice/model-stats.js');
const TRANSFORM_PATH = path.join(ROOT, 'app/services/slice/transform.js');
const PRUSA_DIR = path.join(ROOT, 'configs', 'prusa');
const ORCA_DIR = path.join(ROOT, 'configs', 'orca');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.BAMBU_PROFILES_ROOT = FIXTURE_ROOT;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const {
    BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    BAMBU_P1S_ALTERNATIVE_FOOTPRINT_INCLUSIVE_MM
} = require('../../../app/config/constants');
const {
    MAX_EXCLUDE_RECTANGLES,
    MAX_POLYGON_POINTS,
    boundingRectangle,
    parseBambuBedGeometry,
    parsePolygon
} = require('../../../app/services/slice/bambu-bed-geometry');
const {
    PLACEMENT_REJECTIONS,
    PLACEMENT_STRATEGIES,
    describePlacementRejection,
    rectanglesOverlap,
    rectangleWithin,
    resolveBambuPlacement,
    validateBambuPlacementLimits
} = require('../../../app/services/slice/bambu-placement');
const {
    resolveBuildVolumeLimits,
    validateModelDimensionsAgainstLimits
} = require('../../../app/services/slice/profiles');
const { snapshotProfileSelection } = require('../../../app/services/slice/profile-snapshot');
const { flattenBambuProfile } = require('../../../app/services/slice/bambu-profile-chain');
const { buildSliceSuccessResponse } = require('../../../app/services/slice/response');
const {
    PLACEMENT_SCHEMA,
    PRINT_TIME_SOURCES,
    createSliceResponses
} = require('../../../app/docs/slice-openapi');
const { PRINT_TIME_PATTERNS } = require('../../../app/services/slice/gcode-metrics');
const {
    SLA_PRINT_TIME_SOURCES,
    createMeasuredModelMeasurement
} = require('../../../app/services/slice/model-stats');
const {
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix
} = require('../../../app/services/slice/orientation-contract');

const P1S_MACHINE = 'Bambu Lab P1S 0.4 nozzle';
const H2D_MACHINE = 'Bambu Lab H2D 0.4 nozzle';
const P1S_BED = Object.freeze({
    printable: { minX: 0, minY: 0, maxX: 256, maxY: 256 },
    printableSource: 'printable_area',
    excludes: [{ minX: 0, minY: 0, maxX: 18, maxY: 28 }],
    printableHeight: 250
});
const H2D_BED = Object.freeze({
    printable: { minX: 0, minY: 0, maxX: 325, maxY: 320 },
    printableSource: 'extruder_printable_area',
    excludes: [],
    printableHeight: 325
});
const P1S_LIMITS = Object.freeze({
    min: { x: 1, y: 1, z: 1 },
    max: { x: 256, y: 228, z: 250 },
    sourceProfile: P1S_MACHINE,
    bedGeometry: P1S_BED
});
const H2D_LIMITS = Object.freeze({
    min: { x: 1, y: 1, z: 1 },
    max: { x: 325, y: 320, z: 325 },
    sourceProfile: H2D_MACHINE,
    bedGeometry: H2D_BED
});
const NO_TRANSFORM = Object.freeze({
    unit: 'mm',
    keepProportions: true,
    requestedTargetSize: Object.freeze({ x: null, y: null, z: null }),
    targetSizeMm: Object.freeze({ x: null, y: null, z: null }),
    scalePercent: null,
    rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 })
});
const INERT_WORKSPACE = Object.freeze({ assertContainedPath(candidate) { return candidate; } });

function scratchWorkspace(root) {
    const scratch = path.join(root, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    return {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) { return path.resolve(candidate); }
    };
}

async function bambuLimits(root, printerId) {
    const snapshots = await snapshotProfileSelection('bambu', {
        baseConfigFile: printerId === 'H2D' ? '0.20mm Standard @BBL H2D' : '0.20mm Standard @BBL X1C',
        orcaMachineConfigFile: printerId === 'H2D' ? H2D_MACHINE : P1S_MACHINE,
        orcaFilamentConfigFile: printerId === 'H2D' ? 'Generic PLA @BBL H2D' : 'Generic PLA'
    }, scratchWorkspace(root));
    return resolveBuildVolumeLimits('bambu', 'FDM', snapshots.baseConfigFile, snapshots.orcaMachineConfigFile, null);
}

function modelTransform(final) {
    const measurement = createMeasuredModelMeasurement(final);
    return buildModelTransformContract({
        transformOptions: NO_TRANSFORM,
        transformPlan: {
            requiresTransform: false, scale: { x: 1, y: 1, z: 1 }, rotationDeg: { x: 0, y: 0, z: 0 },
            requestedUnit: 'mm', keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null }, predictedSizeMm: { ...final }
        },
        orientation: createOrientationState('preserve', 'preserved', identityRotationMatrix()),
        originalModelMeasurement: measurement,
        orientedModelMeasurement: measurement,
        finalModelMeasurement: measurement
    });
}

test('measured Bambu envelope constants replace every provisional value and keep the L-shape representable', () => {
    assert.deepEqual(BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM, {
        [P1S_MACHINE]: { x: 256, y: 228, z: 250 },
        [H2D_MACHINE]: { x: 325, y: 320, z: 325 }
    });
    assert.deepEqual(BAMBU_P1S_ALTERNATIVE_FOOTPRINT_INCLUSIVE_MM, { x: 238, y: 256 });
    assert.ok(Object.isFrozen(BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM));
    assert.ok(Object.isFrozen(BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM[P1S_MACHINE]));
    assert.ok(Object.isFrozen(BAMBU_P1S_ALTERNATIVE_FOOTPRINT_INCLUSIVE_MM));
    // Both footprints are exactly the printable rectangle minus the excluded corner on one axis.
    const bed = P1S_BED;
    assert.equal(BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM[P1S_MACHINE].y, bed.printable.maxY - bed.excludes[0].maxY);
    assert.equal(BAMBU_P1S_ALTERNATIVE_FOOTPRINT_INCLUSIVE_MM.x, bed.printable.maxX - bed.excludes[0].maxX);
});

test('bed geometry parsing: P1S excluded corner, H2D first extruder area, and fail-closed malformed input', () => {
    assert.deepEqual(parseBambuBedGeometry(flattenBambuProfile('machine', P1S_MACHINE)), P1S_BED);
    assert.deepEqual(parseBambuBedGeometry(flattenBambuProfile('machine', H2D_MACHINE)), H2D_BED);
    assert.ok(Object.isFrozen(parseBambuBedGeometry(flattenBambuProfile('machine', P1S_MACHINE))));

    // The second extruder area (25..350) must never widen a single-filament job.
    const h2d = flattenBambuProfile('machine', H2D_MACHINE);
    assert.deepEqual(h2d.extruder_printable_area, ['0x0,325x0,325x320,0x320', '25x0,350x0,350x320,25x320']);
    assert.equal(parseBambuBedGeometry(h2d).printable.maxX, 325);

    // Empty or malformed extruder areas fall back to the plate polygon.
    const plateOnly = parseBambuBedGeometry({ ...h2d, extruder_printable_area: [] });
    assert.deepEqual(plateOnly.printable, { minX: 0, minY: 0, maxX: 350, maxY: 320 });
    assert.equal(plateOnly.printableSource, 'printable_area');
    assert.equal(parseBambuBedGeometry({ ...h2d, extruder_printable_area: ['0x0,garbage'] }).printableSource, 'printable_area');

    // Missing plate, height, or a non-object snapshot fails closed.
    assert.throws(() => parseBambuBedGeometry({ printable_height: '250' }), /no printable area/);
    assert.throws(() => parseBambuBedGeometry({ printable_area: ['0x0', '10x0', '10x10', '0x10'] }), /no printable height/);
    assert.throws(() => parseBambuBedGeometry({ printable_area: ['0x0', '10x0', '10x10', '0x10'], printable_height: '0' }), /no printable height/);
    assert.throws(() => parseBambuBedGeometry(null), /JSON object/);
    assert.throws(() => parseBambuBedGeometry([]), /JSON object/);
    assert.throws(() => parseBambuBedGeometry({
        printable_area: ['0x0', '10x0', '10x10', '0x10'], printable_height: '10',
        bed_exclude_area: Array.from({ length: MAX_EXCLUDE_RECTANGLES + 1 }, () => ['0x0', '1x0', '1x1', '0x1'])
    }), /too many excluded/);

    // Nested exclude polygons are tolerated and degenerate ones are dropped.
    const nested = parseBambuBedGeometry({
        printable_area: ['0x0', '100x0', '100x100', '0x100'], printable_height: '50',
        bed_exclude_area: [['0x0', '5x0', '5x5', '0x5'], ['0x0', '10x0'], ['90x90', '100x90', '100x100', '90x100']]
    });
    assert.deepEqual(nested.excludes, [
        { minX: 0, minY: 0, maxX: 5, maxY: 5 },
        { minX: 90, minY: 90, maxX: 100, maxY: 100 }
    ]);
    assert.deepEqual(parseBambuBedGeometry({
        printable_area: ['0x0', '100x0', '100x100', '0x100'], printable_height: '50', bed_exclude_area: []
    }).excludes, []);

    // Polygon parsing is exact: array tokens, one comma-separated string, nothing else.
    assert.deepEqual(parsePolygon(['0x0', '1.5x2']), [{ x: 0, y: 0 }, { x: 1.5, y: 2 }]);
    assert.deepEqual(parsePolygon('0x0,3x0,3x4'), [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
    assert.deepEqual(parsePolygon(['0x0', 'nope']), []);
    assert.deepEqual(parsePolygon(['0x0', '1x']), []);
    assert.deepEqual(parsePolygon({ x: 0 }), []);
    assert.deepEqual(parsePolygon(Array.from({ length: MAX_POLYGON_POINTS + 1 }, () => '0x0')), []);
    assert.equal(boundingRectangle([{ x: 0, y: 0 }, { x: 1, y: 1 }]), null);
    assert.equal(boundingRectangle([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), null);
    assert.deepEqual(boundingRectangle([{ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 5, y: 1 }]), { minX: 0, minY: 0, maxX: 5, maxY: 3 });
});

test('placement resolves centre, shift +Y, shift +X, or rejection exactly as measured on the P1S and H2D', () => {
    const p1s = (x, y) => resolveBambuPlacement({ x, y }, P1S_BED);
    const h2d = (x, y) => resolveBambuPlacement({ x, y }, H2D_BED);

    assert.deepEqual(p1s(100, 100), { fits: true, strategy: PLACEMENT_STRATEGIES.CENTRED, xMin: 78, yMin: 78 });
    // The wide footprint sits flush on top of the excluded corner: 256 x 228 at (0, 28).
    assert.deepEqual(p1s(256, 228), { fits: true, strategy: PLACEMENT_STRATEGIES.SHIFTED_Y, xMin: 0, yMin: 28 });
    // The deep footprint sits flush beside it: 238 x 256 at (18, 0).
    assert.deepEqual(p1s(238, 256), { fits: true, strategy: PLACEMENT_STRATEGIES.SHIFTED_X, xMin: 18, yMin: 0 });
    assert.deepEqual(p1s(238, 228), { fits: true, strategy: PLACEMENT_STRATEGIES.SHIFTED_Y, xMin: 9, yMin: 28 });
    // A narrow deep part clears the corner when centred, so nothing shifts.
    assert.deepEqual(p1s(20, 240), { fits: true, strategy: PLACEMENT_STRATEGIES.CENTRED, xMin: 118, yMin: 8 });
    assert.deepEqual(p1s(20, 256), { fits: true, strategy: PLACEMENT_STRATEGIES.CENTRED, xMin: 118, yMin: 0 });

    for (const [x, y] of [[256, 228.1], [238.1, 256], [250, 250], [256, 256], [240, 230]]) {
        const rejected = p1s(x, y);
        assert.equal(rejected.fits, false, `${x} x ${y}`);
        assert.equal(rejected.reason, PLACEMENT_REJECTIONS.EXCLUDE_CONFLICT, `${x} x ${y}`);
        assert.deepEqual(rejected.conflict, P1S_BED.excludes[0]);
    }
    for (const [x, y] of [[256.1, 100], [100, 256.1], [300, 300]]) {
        assert.deepEqual(p1s(x, y), { fits: false, reason: PLACEMENT_REJECTIONS.EXCEEDS_PRINTABLE_AREA }, `${x} x ${y}`);
    }
    for (const footprint of [{ x: 0, y: 10 }, { x: 10, y: -1 }, { x: Number.NaN, y: 10 }, { x: '10', y: Number.POSITIVE_INFINITY }, null]) {
        assert.deepEqual(resolveBambuPlacement(footprint, P1S_BED), { fits: false, reason: PLACEMENT_REJECTIONS.INVALID_FOOTPRINT });
    }

    assert.deepEqual(h2d(325, 320), { fits: true, strategy: PLACEMENT_STRATEGIES.CENTRED, xMin: 0, yMin: 0 });
    assert.deepEqual(h2d(100, 100), { fits: true, strategy: PLACEMENT_STRATEGIES.CENTRED, xMin: 112.5, yMin: 110 });
    assert.deepEqual(h2d(326, 10), { fits: false, reason: PLACEMENT_REJECTIONS.EXCEEDS_PRINTABLE_AREA });
    assert.deepEqual(h2d(349, 10), { fits: false, reason: PLACEMENT_REJECTIONS.EXCEEDS_PRINTABLE_AREA });
    assert.deepEqual(h2d(10, 320.1), { fits: false, reason: PLACEMENT_REJECTIONS.EXCEEDS_PRINTABLE_AREA });

    // Shared edges are not overlaps; float noise inside a micron is tolerated.
    const exclude = P1S_BED.excludes[0];
    assert.equal(rectanglesOverlap({ minX: 0, minY: 28, maxX: 256, maxY: 256 }, exclude), false);
    assert.equal(rectanglesOverlap({ minX: 18, minY: 0, maxX: 256, maxY: 256 }, exclude), false);
    assert.equal(rectanglesOverlap({ minX: 0, minY: 27.9, maxX: 256, maxY: 255.9 }, exclude), true);
    assert.equal(rectanglesOverlap({ minX: 17.9, minY: 0, maxX: 255.9, maxY: 256 }, exclude), true);
    assert.equal(rectangleWithin({ minX: 0, minY: 0, maxX: 256, maxY: 256 }, P1S_BED.printable), true);
    assert.equal(rectangleWithin({ minX: -0.1, minY: 0, maxX: 255.9, maxY: 256 }, P1S_BED.printable), false);
    assert.ok(Object.isFrozen(p1s(100, 100)));
    assert.ok(Object.isFrozen(p1s(300, 300)));
});

test('placement-aware validation admits the L-shaped P1S footprint and keeps the published triple for Z', () => {
    const accept = (limits, dimensions, placement) => {
        const result = validateBambuPlacementLimits(dimensions, limits);
        assert.deepEqual(result, { isValid: true, dimensions, placement }, JSON.stringify(dimensions));
        assert.deepEqual(validateModelDimensionsAgainstLimits(dimensions, limits), result);
    };
    const reject = (limits, dimensions, tooSmall, tooLargeMatchers) => {
        const result = validateBambuPlacementLimits(dimensions, limits);
        assert.equal(result.isValid, false, JSON.stringify(dimensions));
        assert.deepEqual(result.tooSmall, tooSmall);
        assert.equal(result.tooLarge.length, tooLargeMatchers.length, JSON.stringify(result.tooLarge));
        tooLargeMatchers.forEach((matcher, index) => assert.match(result.tooLarge[index], matcher));
        assert.equal(Object.hasOwn(result, 'placement'), false);
        assert.deepEqual(validateModelDimensionsAgainstLimits(dimensions, limits), result);
    };

    accept(P1S_LIMITS, { x: 256, y: 228, z: 250 }, { xMin: 0, yMin: 28, strategy: 'shifted_y' });
    accept(P1S_LIMITS, { x: 238, y: 256, z: 250 }, { xMin: 18, yMin: 0, strategy: 'shifted_x' });
    accept(P1S_LIMITS, { x: 100, y: 100, z: 1 }, { xMin: 78, yMin: 78, strategy: 'centred' });
    accept(P1S_LIMITS, { x: 20, y: 240, z: 245 }, { xMin: 118, yMin: 8, strategy: 'centred' });
    reject(P1S_LIMITS, { x: 256, y: 228.1, z: 20 }, [], [/^Footprint 256mm x 228\.1mm cannot be placed on the 256mm x 256mm printable area without overlapping the excluded 18mm x 28mm bed corner$/]);
    reject(P1S_LIMITS, { x: 238.1, y: 256, z: 20 }, [], [/excluded 18mm x 28mm bed corner/]);
    reject(P1S_LIMITS, { x: 20, y: 20, z: 250.1 }, [], [/^Z: 250\.1mm > 250mm$/]);
    reject(P1S_LIMITS, { x: 257, y: 20, z: 20 }, [], [/^X: 257mm > 256mm$/]);
    reject(P1S_LIMITS, { x: 20, y: 257, z: 20 }, [], [/^Y: 257mm > 256mm$/]);
    reject(P1S_LIMITS, { x: 257, y: 258, z: 251 }, [], [/^Z: 251mm > 250mm$/, /^X: 257mm > 256mm$/, /^Y: 258mm > 256mm$/]);
    reject(P1S_LIMITS, { x: 0.5, y: 20, z: 20 }, ['X: 0.5mm < 1mm'], []);

    accept(H2D_LIMITS, { x: 325, y: 320, z: 325 }, { xMin: 0, yMin: 0, strategy: 'centred' });
    reject(H2D_LIMITS, { x: 325, y: 320, z: 325.1 }, [], [/^Z: 325\.1mm > 325mm$/]);
    reject(H2D_LIMITS, { x: 326, y: 320, z: 10 }, [], [/^X: 326mm > 325mm$/]);
    reject(H2D_LIMITS, { x: 350, y: 320, z: 10 }, [], [/^X: 350mm > 325mm$/]);

    // Limits without bed geometry keep the historical per-axis comparison and never carry a placement.
    const generic = { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 228, z: 250 }, sourceProfile: 'generic' };
    assert.deepEqual(validateModelDimensionsAgainstLimits({ x: 238, y: 256, z: 20 }, generic), {
        isValid: false, dimensions: { x: 238, y: 256, z: 20 }, tooSmall: [], tooLarge: ['Y: 256mm > 228mm']
    });
    assert.deepEqual(validateModelDimensionsAgainstLimits({ x: 100, y: 100, z: 20 }, generic), {
        isValid: true, dimensions: { x: 100, y: 100, z: 20 }
    });
    assert.deepEqual(describePlacementRejection({ reason: 'unknown' }, { x: 1, y: 1 }, P1S_BED), ['Model footprint must be finite and positive.']);
});

test('resolved build-volume limits carry bed geometry for Bambu only', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b2-bambu-limits-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const p1s = await bambuLimits(root, 'P1S');
    assert.deepEqual(p1s.bedGeometry, P1S_BED);
    assert.deepEqual(p1s.max, { x: 256, y: 228, z: 250 });
    assert.deepEqual(p1s.largestPassingDimensionsInclusive, { x: 256, y: 228, z: 250 });
    assert.deepEqual(p1s.declaredMax, { x: 256, y: 256, z: 250 });
    const h2d = await bambuLimits(root, 'H2D');
    assert.deepEqual(h2d.bedGeometry, H2D_BED);
    assert.deepEqual(h2d.max, { x: 325, y: 320, z: 325 });
    assert.deepEqual(h2d.declaredMax, { x: 350, y: 320, z: 325 });
    // The real fixtures reproduce the measured admission through placement.
    assert.equal(validateModelDimensionsAgainstLimits({ x: 238, y: 256, z: 250 }, p1s).isValid, true);
    assert.equal(validateModelDimensionsAgainstLimits({ x: 256, y: 228, z: 250 }, p1s).isValid, true);
    assert.equal(validateModelDimensionsAgainstLimits({ x: 256, y: 228.1, z: 250 }, p1s).isValid, false);
    assert.equal(validateModelDimensionsAgainstLimits({ x: 325, y: 320, z: 325 }, h2d).isValid, true);
    assert.equal(validateModelDimensionsAgainstLimits({ x: 349, y: 320, z: 10 }, h2d).isValid, false);

    const prusa = resolveBuildVolumeLimits('prusa', 'FDM', path.join(PRUSA_DIR, 'FDM_0.2mm.ini'), null);
    assert.equal(Object.hasOwn(prusa, 'bedGeometry'), false);
    assert.deepEqual(prusa.max, { x: 256, y: 256, z: 249.9 });
    const orca = resolveBuildVolumeLimits('orca', 'FDM', path.join(ORCA_DIR, 'FDM_0.2mm.json'), path.join(ORCA_DIR, 'Bambu_P1S_0.4_nozzle.json'));
    assert.equal(Object.hasOwn(orca, 'bedGeometry'), false);
    assert.deepEqual(orca.max, { x: 253.9, y: 253.9, z: 249.9 });
    assert.equal(validateModelDimensionsAgainstLimits({ x: 238, y: 256, z: 20 }, orca).isValid, false);
});

function installCommandMock(runCommand) {
    const paths = [COMMAND_PATH, PYTHON_PATH, MODEL_STATS_PATH, TRANSFORM_PATH];
    const originals = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
    const command = originals.get(COMMAND_PATH)?.exports || require(COMMAND_PATH);
    require.cache[COMMAND_PATH] = {
        id: COMMAND_PATH, filename: COMMAND_PATH, loaded: true,
        exports: { ...command, runCommand }
    };
    delete require.cache[PYTHON_PATH];
    delete require.cache[MODEL_STATS_PATH];
    delete require.cache[TRANSFORM_PATH];
    return () => {
        for (const [modulePath, original] of originals) {
            if (original) require.cache[modulePath] = original;
            else delete require.cache[modulePath];
        }
    };
}

test('bambu transform places the final STL through scale_model.py --place-min-x/--place-min-y and reports placement', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b2-bambu-transform-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const calls = [];
    let infoSize = { x: 200, y: 100, z: 30 };
    const restore = installCommandMock(async (executable, args, options) => {
        calls.push({ executable, args: [...args], timeoutMs: options?.timeoutMs });
        if (path.basename(args[0] || '') === 'scale_model.py') {
            await fsp.writeFile(args[2], 'solid placed\nendsolid placed\n');
            return { stdout: '', stderr: '' };
        }
        return { stdout: `size_x = ${infoSize.x}\nsize_y = ${infoSize.y}\nsize_z = ${infoSize.z}\n`, stderr: '' };
    });
    t.after(restore);
    const { applyTransformAndValidateModel } = require(TRANSFORM_PATH);
    const { resolvePythonHelper } = require('../../../app/services/slice/helper-paths');
    const { PYTHON_HELPER_TIMEOUT_MS } = require(COMMAND_PATH);
    const helper = resolvePythonHelper('scale_model.py');
    const stl = path.join(root, 'model.stl');
    await fsp.writeFile(stl, 'solid model\nendsolid model\n');

    // No sizing/rotation requested: exactly one helper pass, identity scale/rotation plus the placement pair.
    const centred = await applyTransformAndValidateModel(
        stl, createMeasuredModelMeasurement({ x: 200, y: 100, z: 30 }), NO_TRANSFORM, P1S_LIMITS, INERT_WORKSPACE
    );
    assert.equal(centred.isValid, true);
    assert.deepEqual(centred.placement, { x_min: 28, y_min: 78 });
    assert.deepEqual(centred.modelBoundsValidation.placement, { xMin: 28, yMin: 78, strategy: 'centred' });
    assert.match(path.basename(centred.processableFile), /^model_placed_[a-f0-9]{16}\.stl$/);
    assert.deepEqual(centred.modelTransform.final_dimensions_mm, { x: 200, y: 100, z: 30 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
        executable: process.execPath,
        args: [helper, stl, centred.processableFile, '1', '1', '1', '0', '0', '0', '--place-min-x', '28', '--place-min-y', '78'],
        timeoutMs: PYTHON_HELPER_TIMEOUT_MS
    });
    assert.ok(fs.existsSync(centred.processableFile));

    // The wide footprint shifts +Y onto the excluded corner's top edge.
    calls.length = 0;
    const shifted = await applyTransformAndValidateModel(
        stl, createMeasuredModelMeasurement({ x: 256, y: 228, z: 250 }), NO_TRANSFORM, P1S_LIMITS, INERT_WORKSPACE
    );
    assert.deepEqual(shifted.placement, { x_min: 0, y_min: 28 });
    assert.deepEqual(calls[0].args.slice(-4), ['--place-min-x', '0', '--place-min-y', '28']);

    // Sizing first, native measurement, then placement of the already scaled STL.
    calls.length = 0;
    infoSize = { x: 238, y: 256, z: 60 };
    const scaled = await applyTransformAndValidateModel(
        stl, createMeasuredModelMeasurement({ x: 119, y: 128, z: 30 }),
        { ...NO_TRANSFORM, scalePercent: 200 }, P1S_LIMITS, INERT_WORKSPACE
    );
    assert.equal(scaled.isValid, true);
    assert.deepEqual(scaled.placement, { x_min: 18, y_min: 0 });
    assert.deepEqual(scaled.modelTransform.final_dimensions_mm, { x: 238, y: 256, z: 60 });
    assert.equal(calls.length, 3);
    assert.match(path.basename(calls[0].args[2]), /^model_scaled_[a-f0-9]{16}\.stl$/);
    assert.deepEqual(calls[0].args.slice(3), ['2', '2', '2', '0', '0', '0']);
    assert.deepEqual(calls[1], { executable: 'prusa-slicer', args: ['--info', calls[0].args[2]], timeoutMs: undefined });
    assert.equal(calls[2].args[1], calls[0].args[2]);
    assert.match(path.basename(calls[2].args[2]), /^model_scaled_[a-f0-9]{16}_placed_[a-f0-9]{16}\.stl$/);
    assert.deepEqual(calls[2].args.slice(3), ['1', '1', '1', '0', '0', '0', '--place-min-x', '18', '--place-min-y', '0']);
    assert.equal(scaled.processableFile, calls[2].args[2]);

    // Rejections keep the complete K2 payload with the published triple and never run the helper.
    calls.length = 0;
    for (const [dimensions, pattern] of [
        [{ x: 256, y: 228.1, z: 20 }, /excluded 18mm x 28mm bed corner/],
        [{ x: 20, y: 20, z: 250.1 }, /Z: 250\.1mm > 250mm/],
        [{ x: 250, y: 250, z: 20 }, /cannot be placed/]
    ]) {
        const rejected = await applyTransformAndValidateModel(
            stl, createMeasuredModelMeasurement(dimensions), NO_TRANSFORM, P1S_LIMITS, INERT_WORKSPACE
        );
        assert.equal(rejected.isValid, false);
        assert.equal(rejected.status, 422);
        assert.equal(rejected.response.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
        assert.match(rejected.response.error, pattern);
        assert.deepEqual(rejected.response.model_dimensions_mm, dimensions);
        assert.equal(rejected.response.model_transform.transform_schema, 2);
        assert.deepEqual(rejected.response.build_volume_limits_mm, {
            min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 228, z: 250 }, source_profile: P1S_MACHINE
        });
        assert.equal(Object.hasOwn(rejected.response, 'placement_mm'), false);
    }
    assert.equal(calls.length, 0);

    // Prusa/Orca limits (no bed geometry) never run the placement pass and report no placement.
    const generic = await applyTransformAndValidateModel(
        stl, createMeasuredModelMeasurement({ x: 200, y: 100, z: 30 }), NO_TRANSFORM,
        { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 256, z: 249.9 }, sourceProfile: 'FDM_0.2mm.ini' }, INERT_WORKSPACE
    );
    assert.equal(generic.isValid, true);
    assert.equal(generic.placement, null);
    assert.equal(generic.processableFile, stl);
    assert.equal(calls.length, 0);
});

test('placement_mm is a Bambu-only response field documented with the SLA/FDM print-time sources', () => {
    const schema = createSliceResponses()[200].content['application/json'].schema;
    assert.deepEqual(schema.properties.placement_mm, PLACEMENT_SCHEMA);
    assert.equal(schema.required.includes('placement_mm'), false);
    assert.deepEqual(PLACEMENT_SCHEMA.required, ['x_min', 'y_min']);
    assert.equal(PLACEMENT_SCHEMA.additionalProperties, false);
    assert.match(PLACEMENT_SCHEMA.description, /Bambu Studio only/);
    assert.match(PLACEMENT_SCHEMA.description, /Absent on Prusa and Orca/);
    assert.deepEqual(schema.properties.stats.properties.print_time_source.enum, [...PRINT_TIME_SOURCES]);
    assert.deepEqual([...PRINT_TIME_SOURCES], [
        ...PRINT_TIME_PATTERNS.map((pattern) => pattern.id),
        ...Object.values(SLA_PRINT_TIME_SOURCES)
    ]);
    assert.ok(PRINT_TIME_SOURCES.includes('sla_synthetic_estimate'));
    assert.ok(PRINT_TIME_SOURCES.includes('sla_sl1_metadata_estimate'));
    assert.match(createSliceResponses()[500].description, /NATIVE_OUTPUT_OVERFLOW/);

    const prusa = buildSliceSuccessResponse({
        engine: 'prusa', technology: 'FDM', material: 'PLA', infillPercentage: '20%',
        baseConfigFile: 'FDM_0.2mm.ini', effectiveProfileSha256: 'b'.repeat(64), engineVersion: '2.8.1',
        modelTransform: modelTransform({ x: 10, y: 20, z: 30 }),
        buildVolumeLimits: { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 256, z: 249.9 }, sourceProfile: 'FDM_0.2mm.ini' },
        stats: { print_time_seconds: 60, material_used_m: 1, material_used_g: 5, object_height_mm: 30 },
        jobId: 'job-id', artifactId: 'artifact-id',
        // A stray placement on a non-Bambu engine is ignored rather than published.
        placement: { x_min: 1, y_min: 2 }
    });
    assert.equal(Object.hasOwn(prusa, 'placement_mm'), false);
});
