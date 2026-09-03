'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/bambu-profiles');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.BAMBU_PROFILES_ROOT = FIXTURE_ROOT;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const COMMAND_PATH = path.join(ROOT, 'app/services/slice/command.js');
const MODEL_PATH = path.join(ROOT, 'app/services/slice/model-stats.js');
const OUTPUT_PATH = path.join(ROOT, 'app/services/slice/output-lifecycle.js');
const ENGINE_VERSION_PATH = path.join(ROOT, 'app/services/slice/engine-version.js');
const ARTIFACT_STORE_PATH = path.join(ROOT, 'app/services/artifact-store.js');

const { flattenBambuProfile } = require('../../../app/services/slice/bambu-profile-chain');
const { snapshotProfileSelection } = require('../../../app/services/slice/profile-snapshot');
const { createRuntimeSlicerProfile, resolveBuildVolumeLimits } = require('../../../app/services/slice/profiles');
const {
    BAMBU_REQUEST_OVERRIDE_KEYS,
    calculateEffectiveProfileSha256,
    createEffectiveProfileIdentity
} = require('../../../app/services/slice/profile-digest');
const {
    MINIMUM_BILLABLE_SECONDS,
    buildSliceSuccessResponse,
    calculateQuarterHourMinimumPrice,
    mapBambuProfileResponse,
    resolveProfileMapper
} = require('../../../app/services/slice/response');
const {
    OUTPUT_ARTIFACT_EXTENSIONS,
    buildOutputFilename,
    hasOutputArtifactExtension,
    resolveOutputArtifactExtension
} = require('../../../app/services/slice/common');
const {
    ALLOWED_OUTPUT_EXTENSIONS,
    MANAGED_FILE_PATTERN,
    isAllowedOutputFileName,
    resolveValidatedOutputFile
} = require('../../../app/services/admin-output.service');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const {
    classifyUnsliceableSourceGeometry,
    handleProcessingError,
    isSourceGeometryError
} = require('../../../app/services/slice/errors');
const { wrapNativePlacementRejection } = require('../../../app/services/slice/native-bounds');
const {
    buildModelTransformContract,
    createOrientationState,
    identityRotationMatrix
} = require('../../../app/services/slice/orientation-contract');
const { createMeasuredModelMeasurement } = require('../../../app/services/slice/model-stats');

const SHA256 = 'b'.repeat(64);
const ARTIFACT_ID = 'artifact-0123456789abcdef0123456789abcdef';

function scratchWorkspace(root) {
    const scratch = path.join(root, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    return {
        resolveScratchPath(...segments) { return path.resolve(scratch, ...segments); },
        assertScratchContainedPath(candidate) { return path.resolve(candidate); }
    };
}

async function bambuSnapshots(root, printerId = 'P1S', processName = '0.20mm Standard @BBL X1C', filamentName = 'Generic PLA') {
    return snapshotProfileSelection('bambu', {
        baseConfigFile: processName,
        orcaMachineConfigFile: printerId === 'H2D' ? 'Bambu Lab H2D 0.4 nozzle' : 'Bambu Lab P1S 0.4 nozzle',
        orcaFilamentConfigFile: filamentName
    }, scratchWorkspace(root));
}

function modelTransform(final = { x: 10, y: 20, z: 30 }) {
    const measurement = createMeasuredModelMeasurement(final);
    return buildModelTransformContract({
        transformOptions: {
            unit: 'mm', keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            targetSizeMm: { x: null, y: null, z: null },
            scalePercent: null, rotationDeg: { x: 0, y: 0, z: 0 }
        },
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

test('bambu snapshots are flattened vendor JSON written into job scratch', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-bambu-snapshot-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const snapshots = await bambuSnapshots(root, 'H2D', '0.20mm Standard @BBL H2D', 'Generic PLA @BBL H2D');
    assert.match(path.basename(snapshots.baseConfigFile), /^bambu-base-profile-[a-f0-9]{16}\.json$/);
    assert.match(path.basename(snapshots.orcaMachineConfigFile), /^bambu-machine-profile-[a-f0-9]{16}\.json$/);
    assert.match(path.basename(snapshots.orcaFilamentConfigFile), /^bambu-filament-profile-[a-f0-9]{16}\.json$/);
    const machine = JSON.parse(await fsp.readFile(snapshots.orcaMachineConfigFile, 'utf8'));
    assert.deepEqual(machine, flattenBambuProfile('machine', 'Bambu Lab H2D 0.4 nozzle'));
    assert.equal(Object.hasOwn(machine, 'include'), false);
    await assert.rejects(
        snapshotProfileSelection('bambu', { baseConfigFile: 'x', orcaMachineConfigFile: 'y', orcaFilamentConfigFile: null }, scratchWorkspace(root)),
        /filament profile selection is required/
    );

    const limits = resolveBuildVolumeLimits('bambu', 'FDM', snapshots.baseConfigFile, snapshots.orcaMachineConfigFile, 'ignored process name');
    assert.equal(limits.sourceProfile, 'Bambu Lab H2D 0.4 nozzle');
    assert.deepEqual(limits.declaredMax, { x: 350, y: 320, z: 325 });
    // Measured single-filament ceiling: the FIRST extruder area of the flattened machine.
    assert.deepEqual(limits.max, { x: 325, y: 320, z: 325 });
    assert.deepEqual(limits.explicitMaxAxes, { x: true, y: true, z: true });
    assert.deepEqual(limits.bedGeometry, {
        printable: { minX: 25, minY: 0, maxX: 350, maxY: 320 },
        printableSource: 'extruder_printable_area',
        excludes: [],
        printableHeight: 325
    });
    const p1s = await bambuSnapshots(root);
    const p1sLimits = resolveBuildVolumeLimits('bambu', 'FDM', p1s.baseConfigFile, p1s.orcaMachineConfigFile, null);
    assert.equal(p1sLimits.sourceProfile, 'Bambu Lab P1S 0.4 nozzle');
    assert.deepEqual(p1sLimits.declaredMax, { x: 256, y: 256, z: 250 });
    // Measured wide footprint; the excluded 18 x 28 mm corner is carried as bed geometry.
    assert.deepEqual(p1sLimits.max, { x: 256, y: 228, z: 250 });
    assert.deepEqual(p1sLimits.bedGeometry, {
        printable: { minX: 0, minY: 0, maxX: 256, maxY: 256 },
        printableSource: 'printable_area',
        excludes: [{ minX: 0, minY: 0, maxX: 18, maxY: 28 }],
        printableHeight: 250
    });
    assert.throws(() => resolveBuildVolumeLimits('bambu', 'FDM', p1s.baseConfigFile, null), /machine snapshot is required/);
});

test('bambu runtime process carries only the request keys and refuses unflattened input', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-bambu-runtime-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const workspace = scratchWorkspace(root);
    const snapshots = await bambuSnapshots(root);
    const runtime = await createRuntimeSlicerProfile('bambu', snapshots.baseConfigFile, 'FDM', 0.1, '35%', workspace, { supports: false });
    const written = JSON.parse(await fsp.readFile(runtime, 'utf8'));
    assert.match(path.basename(runtime), /^bambu-runtime-[a-f0-9]{16}\.json$/);
    assert.equal(written.layer_height, '0.1');
    assert.equal(written.sparse_infill_density, '35%');
    assert.equal(written.enable_support, '0');
    assert.equal(written.name, '0.20mm Standard @BBL X1C');
    assert.equal(written.wall_loops, '2');
    assert.equal(Object.hasOwn(written, 'layer_gcode'), false);
    const defaults = JSON.parse(await fsp.readFile(
        await createRuntimeSlicerProfile('bambu', snapshots.baseConfigFile, 'FDM', 0.2, '20%', workspace), 'utf8'
    ));
    assert.equal(defaults.enable_support, '1');

    const unflattened = path.join(root, 'unflattened.json');
    await fsp.writeFile(unflattened, JSON.stringify({ type: 'process', name: 'x', inherits: 'fdm_process_common' }));
    await assert.rejects(createRuntimeSlicerProfile('bambu', unflattened, 'FDM', 0.2, '20%', workspace), /flattened process snapshot/);
    await assert.rejects(createRuntimeSlicerProfile('bambu', snapshots.orcaMachineConfigFile, 'FDM', 0.2, '20%', workspace), /flattened process snapshot/);
});

test('bambu digest is deterministic, excludes the request keys, and binds printer, bed, and chain', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-bambu-digest-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const workspace = scratchWorkspace(root);
    assert.deepEqual([...BAMBU_REQUEST_OVERRIDE_KEYS].sort(), ['enable_support', 'layer_height', 'sparse_infill_density']);
    const p1s = await bambuSnapshots(root);
    const digest = async (snapshots, layer, infill, supports, extra = {}) => calculateEffectiveProfileSha256({
        engine: 'bambu', technology: 'FDM', material: 'PLA',
        runtimeConfigFile: await createRuntimeSlicerProfile('bambu', snapshots.baseConfigFile, 'FDM', layer, infill, workspace, { supports }),
        orcaMachineConfigFile: snapshots.orcaMachineConfigFile,
        orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile,
        bambuPrinterId: 'P1S', bambuBedType: 'Textured PEI Plate',
        ...extra
    });
    const baseline = await digest(p1s, 0.2, '20%', true);
    assert.match(baseline, /^[a-f0-9]{64}$/);
    assert.equal(await digest(p1s, 0.2, '20%', true), baseline);
    assert.equal(await digest(p1s, 0.08, '95%', false), baseline);
    assert.notEqual(await digest(p1s, 0.2, '20%', true, { material: 'PETG' }), baseline);
    assert.notEqual(await digest(p1s, 0.2, '20%', true, { bambuPrinterId: 'H2D' }), baseline);
    assert.notEqual(await digest(p1s, 0.2, '20%', true, { bambuBedType: 'Cool Plate' }), baseline);
    const otherProcess = await bambuSnapshots(root, 'P1S', '0.12mm Fine @BBL X1C');
    assert.notEqual(await digest(otherProcess, 0.2, '20%', true), baseline);
    const otherFilament = await bambuSnapshots(root, 'P1S', '0.20mm Standard @BBL X1C', 'Generic PETG');
    assert.notEqual(await digest(otherFilament, 0.2, '20%', true), baseline);
    const h2d = await bambuSnapshots(root, 'H2D', '0.20mm Standard @BBL H2D', 'Generic PLA @BBL H2D');
    assert.notEqual(await digest(h2d, 0.2, '20%', true, { bambuPrinterId: 'H2D' }), baseline);

    const identity = createEffectiveProfileIdentity({
        engine: 'bambu', technology: 'FDM', material: 'pla',
        runtimeConfigFile: await createRuntimeSlicerProfile('bambu', p1s.baseConfigFile, 'FDM', 0.2, '20%', workspace),
        orcaMachineConfigFile: p1s.orcaMachineConfigFile, orcaFilamentConfigFile: p1s.orcaFilamentConfigFile,
        bambuPrinterId: 'P1S', bambuBedType: 'Textured PEI Plate'
    });
    assert.equal(identity.engine, 'bambu');
    assert.equal(identity.material, 'PLA');
    assert.equal(identity.printer, 'P1S');
    assert.equal(identity.bed_type, 'Textured PEI Plate');
    assert.equal(identity.machine.name, 'Bambu Lab P1S 0.4 nozzle');
    assert.equal(identity.filament.name, 'Generic PLA');
    for (const key of BAMBU_REQUEST_OVERRIDE_KEYS) assert.equal(Object.hasOwn(identity.process, key), false, key);

    for (const [context, pattern] of [
        [{ bambuPrinterId: null }, /printer id is required/],
        [{ bambuBedType: '' }, /bed type is required/],
        [{ orcaFilamentConfigFile: null }, /filament profile is required/],
        [{ orcaMachineConfigFile: null }, /machine profile is required/],
        [{ technology: 'SLA' }, /FDM only/]
    ]) {
        assert.throws(() => calculateEffectiveProfileSha256({
            engine: 'bambu', technology: 'FDM', material: 'PLA',
            runtimeConfigFile: p1s.baseConfigFile, orcaMachineConfigFile: p1s.orcaMachineConfigFile,
            orcaFilamentConfigFile: p1s.orcaFilamentConfigFile,
            bambuPrinterId: 'P1S', bambuBedType: 'Textured PEI Plate', ...context
        }), pattern);
    }
    const unflattened = path.join(root, 'unflattened-machine.json');
    await fsp.writeFile(unflattened, JSON.stringify({ type: 'machine', name: 'x', include: ['y'] }));
    assert.throws(() => calculateEffectiveProfileSha256({
        engine: 'bambu', technology: 'FDM', material: 'PLA', runtimeConfigFile: p1s.baseConfigFile,
        orcaMachineConfigFile: unflattened, orcaFilamentConfigFile: p1s.orcaFilamentConfigFile,
        bambuPrinterId: 'P1S', bambuBedType: 'Textured PEI Plate'
    }), /Unflattened Bambu profile/);
});

test('supports=true leaves Prusa and Orca runtime profiles and digests byte-identical to before', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-supports-digest-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const workspace = scratchWorkspace(root);
    const orcaBase = path.join(root, 'orca-process.json');
    const orcaMachine = path.join(root, 'orca-machine.json');
    await fsp.writeFile(orcaBase, JSON.stringify({ type: 'process', layer_height: '0.2', sparse_infill_density: '20%', enable_support: '1', wall_loops: '2' }));
    await fsp.writeFile(orcaMachine, JSON.stringify({ type: 'machine', name: 'machine' }));
    const orcaDigest = async (options) => calculateEffectiveProfileSha256({
        engine: 'orca', technology: 'FDM', material: 'PLA',
        runtimeConfigFile: await createRuntimeSlicerProfile('orca', orcaBase, 'FDM', 0.2, '20%', workspace, options),
        orcaMachineConfigFile: orcaMachine, orcaFilamentConfigFile: null
    });
    const orcaLegacy = await orcaDigest({});
    assert.equal(await orcaDigest({ supports: true }), orcaLegacy);
    assert.equal(await orcaDigest({ supports: undefined }), orcaLegacy);
    assert.notEqual(await orcaDigest({ supports: false }), orcaLegacy);
    const orcaOff = JSON.parse(await fsp.readFile(
        await createRuntimeSlicerProfile('orca', orcaBase, 'FDM', 0.2, '20%', workspace, { supports: false }), 'utf8'
    ));
    assert.equal(orcaOff.enable_support, '0');
    const orcaOn = JSON.parse(await fsp.readFile(
        await createRuntimeSlicerProfile('orca', orcaBase, 'FDM', 0.2, '20%', workspace, { supports: true }), 'utf8'
    ));
    assert.equal(orcaOn.enable_support, '1');

    const prusaBase = path.join(root, 'prusa.ini');
    await fsp.writeFile(prusaBase, 'layer_height = 0.2\nfill_density = 20%\nsupport_material = 0\nsupport_material_auto = 1\nperimeters = 2\n');
    const prusaDigest = async (options) => calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'FDM',
        runtimeConfigFile: await createRuntimeSlicerProfile('prusa', prusaBase, 'FDM', 0.2, '20%', workspace, options)
    });
    const prusaLegacy = await prusaDigest({});
    assert.equal(await prusaDigest({ supports: true }), prusaLegacy);
    assert.notEqual(await prusaDigest({ supports: false }), prusaLegacy);
    const prusaOff = await fsp.readFile(
        await createRuntimeSlicerProfile('prusa', prusaBase, 'FDM', 0.2, '20%', workspace, { supports: false }), 'utf8'
    );
    assert.match(prusaOff, /^support_material = 0$/m);
    assert.match(prusaOff, /^support_material_auto = 0$/m);
    assert.equal(prusaOff.match(/^support_material_auto\s*=/gm).length, 1);
    const prusaOn = await fsp.readFile(
        await createRuntimeSlicerProfile('prusa', prusaBase, 'FDM', 0.2, '20%', workspace, { supports: true }), 'utf8'
    );
    assert.match(prusaOn, /^support_material_auto = 1$/m);
});

test('supports=false switches the SLA profile off and changes its digest, supports=true does not', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-sla-supports-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const workspace = scratchWorkspace(root);
    const slaBase = path.join(root, 'sla.ini');
    await fsp.writeFile(slaBase, 'layer_height = 0.05\nsupports_enable = 1\npad_enable = 1\npad_around_object = 1\nexposure_time = 2.5\n');
    const slaDigest = async (options) => calculateEffectiveProfileSha256({
        engine: 'prusa', technology: 'SLA',
        runtimeConfigFile: await createRuntimeSlicerProfile('prusa', slaBase, 'SLA', 0.05, '20%', workspace, options)
    });
    const slaLegacy = await slaDigest({});
    assert.equal(await slaDigest({ supports: true }), slaLegacy);
    assert.equal(await slaDigest({ supports: undefined }), slaLegacy);
    assert.notEqual(await slaDigest({ supports: false }), slaLegacy);
    const slaOff = await fsp.readFile(
        await createRuntimeSlicerProfile('prusa', slaBase, 'SLA', 0.05, '20%', workspace, { supports: false }), 'utf8'
    );
    assert.match(slaOff, /^supports_enable = 0$/m);
    assert.equal(slaOff.match(/^supports_enable\s*=/gm).length, 1);
    // The pad is the raft the object prints on, never a support structure.
    assert.match(slaOff, /^pad_enable = 1$/m);
    assert.match(slaOff, /^pad_around_object = 1$/m);
    // SLA never receives an infill override, on or off.
    assert.equal(/fill_density/.test(slaOff), false);
    const slaOn = await fsp.readFile(
        await createRuntimeSlicerProfile('prusa', slaBase, 'SLA', 0.05, '20%', workspace, { supports: true }), 'utf8'
    );
    assert.match(slaOn, /^supports_enable = 1$/m);
});

test('bambu response mapper echoes vendor names, registry printer, bed type, and metadata', () => {
    const context = {
        profileOverrides: { bambuPrinter: 'H2D', bambuProcessProfile: null },
        baseConfigFile: '0.20mm Standard @BBL H2D',
        orcaMachineConfigFile: 'Bambu Lab H2D 0.4 nozzle',
        orcaFilamentConfigFile: 'Generic PLA @BBL H2D',
        filamentProfileMetadata: { diameterMm: 1.75, densityGcm3: 1.24 },
        effectiveProfileSha256: SHA256
    };
    assert.equal(resolveProfileMapper('bambu'), mapBambuProfileResponse);
    assert.deepEqual(mapBambuProfileResponse(context), {
        printer: 'H2D',
        machine_profile: 'Bambu Lab H2D 0.4 nozzle',
        process_profile: '0.20mm Standard @BBL H2D',
        filament_profile: 'Generic PLA @BBL H2D',
        filament_diameter_mm: 1.75,
        filament_density_g_cm3: 1.24,
        bed_type: 'Textured PEI Plate',
        effective_profile_sha256: SHA256
    });
    assert.throws(() => mapBambuProfileResponse({ ...context, profileOverrides: {} }), /printer selection is unavailable/);
    assert.throws(() => mapBambuProfileResponse({ ...context, profileOverrides: { bambuPrinter: 'X1C' } }), /Unknown Bambu printer/);
    assert.throws(() => mapBambuProfileResponse({ ...context, filamentProfileMetadata: null }), /metadata is unavailable/);
    assert.throws(() => mapBambuProfileResponse({ ...context, orcaFilamentConfigFile: null }), /filament profile selection/);
    assert.throws(() => mapBambuProfileResponse({ ...context, effectiveProfileSha256: 'nope' }), /SHA-256 is unavailable/);

    const bambuContext = {
        engine: 'bambu', technology: 'FDM', material: 'PLA', infillPercentage: '20%', supports: false,
        ...context, engineVersion: '02.08.02.61',
        modelTransform: modelTransform(),
        buildVolumeLimits: { min: { x: 1, y: 1, z: 1 }, max: { x: 325, y: 320, z: 325 }, sourceProfile: 'Bambu Lab H2D 0.4 nozzle' },
        stats: { print_time_seconds: 1980, print_time_readable: '0h 33m', material_used_m: 0.24, material_used_g: 24.7, object_height_mm: 30 },
        jobId: 'job-id', artifactId: 'artifact-id'
    };
    const response = buildSliceSuccessResponse({ ...bambuContext, placement: { x_min: 157.5, y_min: 150 } });
    assert.equal(response.slicer_engine, 'bambu');
    // Bambu publishes the API-owned placement; a missing placement is a pipeline defect.
    assert.deepEqual(response.placement_mm, { x_min: 157.5, y_min: 150 });
    assert.throws(() => buildSliceSuccessResponse(bambuContext), /placement is unavailable/);
    assert.throws(() => buildSliceSuccessResponse({ ...bambuContext, placement: { x_min: 'x', y_min: 0 } }), /placement is unavailable/);
    assert.equal(response.supports, false);
    assert.equal(response.profiles.printer, 'H2D');
    assert.equal(response.build_volume_limits_mm.source_profile, 'Bambu Lab H2D 0.4 nozzle');
    assert.equal(response.hourly_rate, 800);
    assert.equal(response.stats.estimated_price_huf, 440);
    assert.equal(buildSliceSuccessResponse({
        engine: 'prusa', technology: 'FDM', material: 'PLA', infillPercentage: '20%',
        baseConfigFile: 'FDM_0.2mm.ini', effectiveProfileSha256: SHA256, engineVersion: '2.8.1',
        modelTransform: modelTransform(),
        buildVolumeLimits: { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 256, z: 249.9 }, sourceProfile: 'FDM_0.2mm.ini' },
        stats: { print_time_seconds: 60, material_used_m: 1, material_used_g: null, object_height_mm: 30 },
        jobId: 'job-id', artifactId: 'artifact-id'
    }).supports, true);
});

test('quarter-hour minimum pricing rounds in integers so exact tens are not inflated', () => {
    assert.equal(MINIMUM_BILLABLE_SECONDS, 900);
    const table = [
        [1980, 800, 440],
        [1980, 900, 500],
        [60, 800, 200],
        [900, 800, 200],
        [901, 800, 210],
        [2760, 800, 620],
        [3599, 1000, 1000],
        [3600, 900, 900],
        [60, 1800, 450],
        [5400, 800, 1200],
        [1, 2400, 600],
        [7200, 855, 1710]
    ];
    for (const [seconds, rate, expected] of table) {
        assert.equal(calculateQuarterHourMinimumPrice(rate, { print_time_seconds: seconds }), expected, `${seconds}s @ ${rate}`);
    }
    // The historic hours-first arithmetic billed 450 for the 40 mm cube.
    const legacy = Math.ceil((Math.max(1980 / 3600, 0.25) * 800) / 10) * 10;
    assert.equal(legacy, 450);
});

test('the .gcode.3mf artifact extension is allowlisted end to end without weakening containment', async (t) => {
    assert.deepEqual([...OUTPUT_ARTIFACT_EXTENSIONS], ['.gcode', '.sl1', '.gcode.3mf']);
    assert.deepEqual([...ALLOWED_OUTPUT_EXTENSIONS].sort(), ['.gcode', '.gcode.3mf', '.sl1']);
    assert.equal(resolveOutputArtifactExtension('FDM', 'bambu'), '.gcode.3mf');
    assert.equal(resolveOutputArtifactExtension('FDM', 'orca'), '.gcode');
    assert.equal(resolveOutputArtifactExtension('FDM'), '.gcode');
    assert.equal(resolveOutputArtifactExtension('SLA', 'prusa'), '.sl1');
    assert.equal(buildOutputFilename('cube.stl', 'FDM', ARTIFACT_ID, 'bambu'), `cube-output-${ARTIFACT_ID}.gcode.3mf`);
    assert.equal(buildOutputFilename('cube.stl', 'FDM', ARTIFACT_ID), `cube-output-${ARTIFACT_ID}.gcode`);
    for (const [name, expected] of [
        ['x.gcode', true], ['x.GCODE.3MF', true], ['x.gcode.3mf', true], ['x.sl1', true],
        ['x.3mf', false], ['x.gcode.3mf.bak', false], ['x.txt', false], ['gcode.3mf', false],
        ['.gcode', false], ['.gcode.3mf', false], ['', false]
    ]) {
        assert.equal(hasOutputArtifactExtension(name), expected, name);
        assert.equal(isAllowedOutputFileName(name), expected, name);
    }
    assert.equal(isAllowedOutputFileName('dir/x.gcode.3mf'), false);
    assert.equal(isAllowedOutputFileName('dir\\x.gcode.3mf'), false);
    assert.match(`cube-output-${ARTIFACT_ID}.gcode.3mf`, MANAGED_FILE_PATTERN);
    assert.doesNotMatch(`cube-output-${ARTIFACT_ID}.3mf`, MANAGED_FILE_PATTERN);

    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-artifact-ext-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const outputDir = path.join(root, 'output');
    await fsp.mkdir(outputDir);
    await fsp.writeFile(path.join(outputDir, 'plate.gcode.3mf'), 'PK-project');
    await fsp.writeFile(path.join(outputDir, 'plain.3mf'), 'PK-not-an-artifact');
    const resolvedOutputDir = path.resolve(outputDir);
    const realOutputDir = await fsp.realpath(outputDir);
    const accepted = resolveValidatedOutputFile('plate.gcode.3mf', resolvedOutputDir, realOutputDir);
    assert.equal(accepted.success, true);
    assert.equal(accepted.fileName, 'plate.gcode.3mf');
    assert.equal(resolveValidatedOutputFile('plain.3mf', resolvedOutputDir, realOutputDir).errorCode, 'INVALID_OUTPUT_FILE');
    assert.equal(resolveValidatedOutputFile('../plate.gcode.3mf', resolvedOutputDir, realOutputDir).errorCode, 'INVALID_OUTPUT_FILE');

    const workspace = await createJobWorkspace({
        jobsRoot: path.join(root, 'jobs'), scratchRoot: path.join(root, 'scratch'),
        outputRoot: outputDir, artifactIdFactory: () => ARTIFACT_ID
    });
    const candidate = await workspace.registerOutputCandidate('cube.stl', 'FDM', 'bambu');
    assert.equal(path.basename(candidate), `cube-output-${ARTIFACT_ID}.gcode.3mf`);
    assert.equal(path.dirname(candidate), path.resolve(outputDir));
    await workspace.cleanup();
});

test('native geometry diagnostics map to UNSLICEABLE_SOURCE_GEOMETRY with a bounded path-free detail', () => {
    const invoke = (error) => {
        const observed = { status: null, payload: null };
        const res = {
            status(value) { observed.status = value; return this; },
            json(value) { observed.payload = value; return this; }
        };
        handleProcessingError(error, res, null, null, () => '.stl');
        return observed;
    };
    const faulty = Object.assign(new Error('Native command failed.'), {
        stdout: '',
        stderr: "Object can't be printed for empty layer between 1.20 and 1.40, /private/customer-secret.stl: faulty mesh"
    });
    const faultyResult = invoke(faulty);
    assert.equal(faultyResult.status, 422);
    assert.equal(faultyResult.payload.errorCode, 'UNSLICEABLE_SOURCE_GEOMETRY');
    assert.equal(faultyResult.payload.success, false);
    assert.match(faultyResult.payload.detail, /empty layer/);
    assert.ok(faultyResult.payload.detail.length <= 256);
    assert.doesNotMatch(JSON.stringify(faultyResult.payload), /customer-secret|\/private/);

    const stdoutOnly = Object.assign(new Error('Native command failed.'), {
        stdout: 'Loading of a model file failed: /private/customer-secret.stl',
        stderr: 'warning: unrelated preset note'
    });
    const loadResult = invoke(stdoutOnly);
    assert.equal(loadResult.status, 422);
    assert.equal(loadResult.payload.errorCode, 'UNSLICEABLE_SOURCE_GEOMETRY');
    assert.match(loadResult.payload.detail, /could not load/);
    assert.doesNotMatch(JSON.stringify(loadResult.payload), /customer-secret/);
    assert.deepEqual(classifyUnsliceableSourceGeometry(new Error('faulty mesh detected')).kind, 'empty_layer');
    assert.equal(classifyUnsliceableSourceGeometry(new Error('slicer exited 1')), null);

    // Converter diagnostics on stdout are now recognised too.
    assert.equal(isSourceGeometryError({ stdout: 'mesh2stl.py: scene is empty', stderr: '' }), true);
    assert.equal(isSourceGeometryError({ stdout: 'scene is empty', stderr: '' }), false);
    assert.equal(invoke({ stdout: 'cad2stl.py critical error', message: 'x' }).payload.errorCode, 'INVALID_SOURCE_GEOMETRY');

    // Explicit placement refusal keeps precedence over the geometry classifier.
    const bounds = wrapNativePlacementRejection(Object.assign(new Error('failed'), {
        stdout: 'plate 1: Nothing to be sliced, Either the print is empty or no object is fully inside the print volume; faulty mesh',
        stderr: ''
    }), {
        modelTransform: modelTransform({ x: 260, y: 20, z: 30 }),
        buildVolumeLimits: { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 228, z: 250 }, sourceProfile: 'Bambu Lab P1S 0.4 nozzle' }
    });
    const boundsResult = invoke(bounds);
    assert.equal(boundsResult.payload.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.equal(boundsResult.payload.build_volume_limits_mm.source_profile, 'Bambu Lab P1S 0.4 nozzle');
});

function installOutputLifecycleMocks({ runCommand, parseOutputDetailed, cleanupManagedArtifacts }) {
    const paths = [COMMAND_PATH, MODEL_PATH, OUTPUT_PATH, ENGINE_VERSION_PATH, ARTIFACT_STORE_PATH];
    const originals = new Map(paths.map((modulePath) => [modulePath, require.cache[modulePath]]));
    const replace = (modulePath, exportsValue) => {
        require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: exportsValue };
    };
    const command = originals.get(COMMAND_PATH)?.exports || require(COMMAND_PATH);
    replace(COMMAND_PATH, { ...command, runCommand });
    const modelStats = originals.get(MODEL_PATH)?.exports || require(MODEL_PATH);
    replace(MODEL_PATH, { ...modelStats, parseOutputDetailed });
    replace(ENGINE_VERSION_PATH, { getSlicerEngineVersion: (engine) => ({ bambu: '02.08.02.61', orca: '2.3.1', prusa: '2.8.1' })[engine] });
    const artifactStore = originals.get(ARTIFACT_STORE_PATH)?.exports || require(ARTIFACT_STORE_PATH);
    replace(ARTIFACT_STORE_PATH, { ...artifactStore, cleanupManagedArtifacts });
    delete require.cache[OUTPUT_PATH];
    const lifecycle = require(OUTPUT_PATH);
    return {
        lifecycle,
        restore() {
            for (const [modulePath, original] of originals) {
                if (original) require.cache[modulePath] = original;
                else delete require.cache[modulePath];
            }
        }
    };
}

test('bambu slice run parses plate_1.gcode, retains the .gcode.3mf, and treats a retention miss as non-fatal', async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-bambu-lifecycle-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const snapshots = await bambuSnapshots(root);
    const calls = [];
    const parseCalls = [];
    const events = [];
    const retention = [];
    const cleanupResults = [{ quotaSatisfied: false, removedArtifacts: 1, removedBytes: 10 }, 'throw', { quotaSatisfied: true }];
    const { lifecycle, restore } = installOutputLifecycleMocks({
        async runCommand(executable, args) {
            calls.push({ executable, args: [...args] });
            const outputDir = args[args.indexOf('--outputdir') + 1];
            await fsp.mkdir(outputDir, { recursive: true });
            await fsp.writeFile(path.join(outputDir, 'plate_1.gcode'), '; total estimated time: 11m 54s\n; total filament weight [g] : 0.72\n');
            await fsp.writeFile(path.join(outputDir, args[args.indexOf('--export-3mf') + 1]), 'PK-project');
            await fsp.writeFile(path.join(outputDir, 'result.json'), '{}');
            return { stdout: '', stderr: '' };
        },
        async parseOutputDetailed(...args) {
            parseCalls.push(args);
            return { print_time_seconds: 714, material_used_g: 0.72, material_used_m: 0.2412, object_height_mm: 30 };
        },
        async cleanupManagedArtifacts() {
            const next = cleanupResults.shift();
            if (next === 'throw') throw new Error('sweep failed');
            return next;
        }
    });
    t.after(restore);
    const { emitEvent, setEventWriter } = require('../../../app/services/observability/events');
    void emitEvent;
    setEventWriter((entry) => events.push(entry));
    t.after(() => setEventWriter(null));
    lifecycle.configureRetentionObserver({ recordRetentionResult: (summary) => retention.push(summary) });
    t.after(() => lifecycle.configureRetentionObserver(null));

    const promoted = [];
    const workspace = {
        id: 'job-0123456789abcdef0123456789abcdef',
        ...scratchWorkspace(root),
        assertContainedPath(candidate) { return candidate; },
        async promoteOutputCandidate(candidate, source) { promoted.push({ candidate, source }); }
    };
    const engineOutputDir = path.join(root, 'engine-output');
    const context = {
        engine: 'bambu', technology: 'FDM', layerHeight: 0.2, infillPercentage: '20%', material: 'PLA', supports: true,
        profileOverrides: { bambuPrinter: 'P1S', bambuProcessProfile: null },
        baseConfigFile: snapshots.baseConfigFile,
        orcaMachineConfigFile: snapshots.orcaMachineConfigFile,
        orcaFilamentConfigFile: snapshots.orcaFilamentConfigFile,
        slicerOutputPath: path.join(engineOutputDir, 'result.gcode.3mf'),
        engineOutputDir,
        outputCandidate: 'candidate',
        processableFile: 'model.stl',
        effectiveModelInfo: { height_mm: 30 },
        modelTransform: modelTransform(),
        buildVolumeLimits: { min: { x: 1, y: 1, z: 1 }, max: { x: 256, y: 228, z: 250 }, sourceProfile: 'Bambu Lab P1S 0.4 nozzle' },
        workspace,
        signal: new AbortController().signal
    };

    const first = await lifecycle.runSlicerAndParseStats(context);
    assert.equal(first.engineVersion, '02.08.02.61');
    assert.match(first.effectiveProfileSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(first.filamentProfileMetadata, { diameterMm: 1.75, densityGcm3: 1.24 });
    assert.equal(first.stats.print_time_seconds, 714);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].executable, 'bambu-studio');
    const args = calls[0].args;
    assert.equal(args.at(-1), 'model.stl');
    assert.equal(args[0], '--load-settings');
    assert.equal(args[1], `${snapshots.orcaMachineConfigFile};${args[1].split(';')[1]}`);
    assert.match(args[1].split(';')[1], /bambu-runtime-[a-f0-9]{16}\.json$/);
    assert.deepEqual(args.slice(2, 4), ['--load-filaments', snapshots.orcaFilamentConfigFile]);
    assert.deepEqual(args.slice(4, 6), ['--curr-bed-type', 'Textured PEI Plate']);
    // `--arrange 0`: the STL arrives already placed by the API (see bambu-placement.js).
    assert.deepEqual(args.slice(6, 18), ['--arrange', '0', '--orient', '0', '--slice', '0', '--debug', '2', '--export-3mf', 'result.gcode.3mf', '--outputdir', engineOutputDir]);
    assert.equal(args.some((value) => value.startsWith('--allow-rotations')), false);
    assert.equal(parseCalls.length, 1);
    assert.equal(parseCalls[0][0], path.join(engineOutputDir, 'plate_1.gcode'));
    assert.equal(parseCalls[0][4], 'bambu');
    assert.deepEqual(parseCalls[0][5], { requireFilamentGrams: true, material: 'PLA', modelVolumeMm3: null });
    assert.deepEqual(promoted, [{ candidate: 'candidate', source: path.join(engineOutputDir, 'result.gcode.3mf') }]);
    // Retention miss: response still succeeds, readiness observer and event learn about it.
    assert.deepEqual(retention, [false]);
    const misses = events.filter((entry) => entry.event === 'artifact.cleanup' && entry.error_code === 'ARTIFACT_RETENTION_QUOTA_UNSATISFIED');
    assert.equal(misses.length, 1);
    assert.equal(misses[0].job_id, workspace.id);
    assert.equal(misses[0].outcome, 'failure');

    // A throwing sweep is equally non-fatal; a satisfied sweep records nothing.
    await fsp.rm(engineOutputDir, { recursive: true, force: true });
    await lifecycle.runSlicerAndParseStats(context);
    assert.deepEqual(retention, [false, false]);
    await fsp.rm(engineOutputDir, { recursive: true, force: true });
    await lifecycle.runSlicerAndParseStats(context);
    assert.deepEqual(retention, [false, false]);
    assert.equal(cleanupResults.length, 0);

    // Missing plate G-code without a placement diagnostic stays the missing-artifact failure.
    await fsp.rm(engineOutputDir, { recursive: true, force: true });
    const { restore: restoreSecond, lifecycle: second } = installOutputLifecycleMocks({
        async runCommand(executable, args) {
            const outputDir = args[args.indexOf('--outputdir') + 1];
            await fsp.mkdir(outputDir, { recursive: true });
            await fsp.writeFile(path.join(outputDir, 'result.gcode.3mf'), 'PK-project');
            return { stdout: '', stderr: '' };
        },
        async parseOutputDetailed() { throw new Error('must not parse'); },
        async cleanupManagedArtifacts() { return { quotaSatisfied: true }; }
    });
    t.after(restoreSecond);
    await assert.rejects(second.runSlicerAndParseStats(context), /did not produce an output artifact/);
    const generated = await second.resolveGeneratedOutputs('bambu', engineOutputDir, context.slicerOutputPath, workspace);
    assert.equal(generated.artifactPath, path.join(engineOutputDir, 'result.gcode.3mf'));
    assert.equal(generated.statsPath, null);
});

test('bambu output targets stage an isolated directory and a .gcode.3mf export name', async () => {
    const registered = [];
    const workspace = {
        async registerOutputCandidate(name, technology, engine) { registered.push([name, technology, engine]); return 'candidate'; },
        async createUniquePath(extension = '') { return path.join('job', `unique${extension}`); },
        assertContainedPath(candidate) { return candidate; }
    };
    const { resolveSliceOutputTargets, assertValidContainedArtifact } = require(OUTPUT_PATH);
    const originalMkdir = fsp.mkdir;
    fsp.mkdir = async () => {};
    try {
        const targets = await resolveSliceOutputTargets('bambu', 'cube.stl', 'FDM', workspace);
        assert.deepEqual(registered, [['cube.stl', 'FDM', 'bambu']]);
        assert.equal(targets.engineOutputDir, path.join('job', 'unique'));
        assert.equal(targets.slicerOutputPath, path.join('job', 'unique', 'result.gcode.3mf'));
        const orca = await resolveSliceOutputTargets('orca', 'cube.stl', 'FDM', workspace);
        assert.equal(orca.slicerOutputPath, path.join('job', 'unique', 'result.gcode'));
    } finally {
        fsp.mkdir = originalMkdir;
    }
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b1-bambu-artifact-'));
    try {
        const project = path.join(root, 'result.gcode.3mf');
        await fsp.writeFile(project, 'PK-project');
        const contained = { assertContainedPath(candidate) { return candidate; } };
        assert.equal(await assertValidContainedArtifact(project, contained, 'FDM', undefined, 'bambu'), project);
        await assert.rejects(assertValidContainedArtifact(project, contained, 'FDM', undefined, 'orca'), /invalid extension/);
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});
