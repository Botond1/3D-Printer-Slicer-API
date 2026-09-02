'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.BAMBU_PROFILES_ROOT = path.resolve(__dirname, '../fixtures/bambu-profiles');
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const { parseSliceOptions } = require('../../../app/services/slice/options');
const { resolveProfileSelection } = require('../../../app/services/slice/profiles');
const {
    SUPPORTED_ENGINES,
    buildSlicerCommandArgs,
    isSupportedEngine,
    resolveSlicerExecutable,
    resolveSlicerInvocationPolicy
} = require('../../../app/services/slice/engine');
const { ROUTE_AUDIENCES, classifyRoute } = require('../../../app/config/route-policy');
const { createSliceRouter } = require('../../../app/routes/slice.routes');
const {
    createSliceHandlers,
    preValidateSliceRequest,
    resolveQueueKey
} = require('../../../app/services/slice.service');
const {
    createJobWorkspace,
    attachWorkspaceToRequest
} = require('../../../app/services/slice/workspace');

const BAMBU_DEFAULT_OVERRIDES = Object.freeze({
    prusaProfile: null,
    orcaMachineProfile: null,
    orcaProcessProfile: null,
    bambuPrinter: 'P1S',
    bambuProcessProfile: null
});

test('bambu options default to the P1S registry printer and vendor 0.2 mm process', () => {
    const result = parseSliceOptions({}, 'FDM', 'bambu');
    assert.equal(result.isValid, true);
    assert.deepEqual(result.options.profileOverrides, BAMBU_DEFAULT_OVERRIDES);
    assert.equal(result.options.layerHeight, 0.2);
    assert.equal(result.options.layerKey, '0.2');
    assert.equal(result.options.material, 'PLA');
    assert.equal(result.options.infillPercentage, '20%');
    assert.equal(result.options.supports, true);
    assert.equal(result.options.technology, 'FDM');
    // Prusa and Orca options never grow Bambu selection keys.
    assert.deepEqual(Object.keys(parseSliceOptions({}, null, 'prusa').options.profileOverrides).sort(), [
        'orcaMachineProfile', 'orcaProcessProfile', 'prusaProfile'
    ]);
    assert.equal(Object.hasOwn(parseSliceOptions({}, null, 'prusa').options, 'layerKey'), false);
});

test('bambu printer, process, layer, and material selection is strict and registry-bound', () => {
    const h2d = parseSliceOptions({ printer: 'h2d', layerHeight: '0.1', material: 'petg' }, 'FDM', 'bambu');
    assert.equal(h2d.isValid, true);
    assert.equal(h2d.options.profileOverrides.bambuPrinter, 'H2D');
    assert.equal(h2d.options.layerKey, '0.1');
    assert.equal(h2d.options.layerHeight, 0.1);

    const explicitProcess = parseSliceOptions({
        printerProfile: 'P1S', layerHeight: '0.2', material: 'PLA', processProfile: '0.16mm Optimal @BBL X1C'
    }, 'FDM', 'bambu');
    assert.equal(explicitProcess.isValid, true);
    assert.equal(explicitProcess.options.profileOverrides.bambuProcessProfile, '0.16mm Optimal @BBL X1C');

    const cases = [
        [{ printerProfile: 'X1C' }, 'INVALID_PRINTER_PROFILE', /P1S, H2D/],
        [{ printerProfile: 'H2D', layerHeight: '0.28' }, 'INVALID_LAYER_HEIGHT', /0\.08, 0\.1, 0\.12, 0\.16, 0\.2, 0\.24$/],
        [{ layerHeight: '0.3' }, 'INVALID_LAYER_HEIGHT', /0\.28/],
        [{ layerHeight: '0.15' }, 'INVALID_LAYER_HEIGHT', /Allowed values/],
        [{ layerHeight: 'thick' }, 'INVALID_LAYER_HEIGHT', /Invalid layerHeight/],
        [{ processProfile: '0.20mm Standard @BBL H2D' }, 'INVALID_PROCESS_PROFILE', /0\.20mm Standard @BBL X1C/],
        [{ processProfile: '../escape' }, 'INVALID_PROCESS_PROFILE', /Allowed values/],
        [{ material: 'Standard' }, 'MATERIAL_TECHNOLOGY_MISMATCH', /SLA/],
        [{ material: 'Unknown-Material' }, 'INVALID_MATERIAL_FOR_TECHNOLOGY', /Allowed values/],
        [{ supports: 'sometimes' }, 'INVALID_SUPPORTS', /true\/false/],
        [{ infill: '101' }, 'INVALID_INFILL', /0 to 100/],
        [{ orientationMode: 'AUTO' }, 'INVALID_ORIENTATION_MODE', /auto, preserve/]
    ];
    for (const [body, code, message] of cases) {
        const result = parseSliceOptions(body, 'FDM', 'bambu');
        assert.equal(result.isValid, false, JSON.stringify(body));
        assert.equal(result.response.errorCode, code, JSON.stringify(body));
        assert.match(result.response.error, message, JSON.stringify(body));
    }
});

test('bambu profile selection resolves vendor names for every registry combination', () => {
    const selection = resolveProfileSelection('bambu', 'FDM', 0.1, { bambuPrinter: 'H2D', bambuProcessProfile: null }, 'ABS');
    assert.deepEqual(selection, {
        isValid: true,
        baseConfigFile: '0.12mm Fine @BBL H2D',
        orcaMachineConfigFile: 'Bambu Lab H2D 0.4 nozzle',
        orcaFilamentConfigFile: 'Generic ABS @BBL H2D'
    });
    const explicit = resolveProfileSelection('bambu', 'FDM', 0.2, {
        bambuPrinter: 'P1S', bambuProcessProfile: '0.24mm Draft @BBL X1C'
    }, 'TPU');
    assert.equal(explicit.baseConfigFile, '0.24mm Draft @BBL X1C');
    assert.equal(explicit.orcaFilamentConfigFile, 'Generic TPU');
    for (const [args, code] of [
        [['bambu', 'FDM', 0.2, { bambuPrinter: 'X1C' }, 'PLA'], 'INVALID_PRINTER_PROFILE'],
        [['bambu', 'FDM', 0.3, { bambuPrinter: 'P1S' }, 'PLA'], 'INVALID_LAYER_HEIGHT'],
        [['bambu', 'FDM', 0.2, { bambuPrinter: 'P1S', bambuProcessProfile: 'nope' }, 'PLA'], 'INVALID_PROCESS_PROFILE'],
        [['bambu', 'FDM', 0.2, { bambuPrinter: 'P1S' }, 'NYLON'], 'MATERIAL_PROFILE_UNAVAILABLE'],
        [['bambu', 'SLA', 0.05, { bambuPrinter: 'P1S' }, 'Standard'], 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY']
    ]) {
        const result = resolveProfileSelection(...args);
        assert.equal(result.isValid, false, code);
        assert.equal(result.status, 400, code);
        assert.equal(result.response.errorCode, code, code);
    }
});

test('bambu argv disables native arrangement (API-owned placement) and never passes --allow-rotations', () => {
    assert.deepEqual(SUPPORTED_ENGINES, ['prusa', 'orca', 'bambu']);
    assert.equal(isSupportedEngine('bambu'), true);
    assert.equal(isSupportedEngine('cura'), false);
    assert.equal(resolveSlicerExecutable('bambu'), 'bambu-studio');
    assert.deepEqual(resolveSlicerInvocationPolicy('bambu', 'FDM'), {
        arrange: '0', orient: '0', slice: '0',
        debug: '2', bedType: 'Textured PEI Plate', export3mf: true,
        settingsPrecedence: ['machine', 'process'], filamentOption: '--load-filaments'
    });
    const outputPath = path.join('stage', 'job', 'result.gcode.3mf');
    const args = buildSlicerCommandArgs(
        'FDM', 'process.json', outputPath, '20%', 'bambu', 'machine.json', 'filament.json',
        { bedType: 'Textured PEI Plate', supports: false }
    );
    assert.deepEqual(args, [
        '--load-settings', 'machine.json;process.json',
        '--load-filaments', 'filament.json',
        '--curr-bed-type', 'Textured PEI Plate',
        '--arrange', '0', '--orient', '0', '--slice', '0',
        '--debug', '2',
        '--export-3mf', 'result.gcode.3mf',
        '--outputdir', path.join('stage', 'job')
    ]);
    assert.equal(args.some((value) => value.startsWith('--allow-rotations')), false);
    assert.equal(args.includes('--fill-density'), false);
    // Bed type falls back to the policy default and the export target must be a project.
    assert.equal(
        buildSlicerCommandArgs('FDM', 'p.json', outputPath, '20%', 'bambu', 'm.json', 'f.json')
            .indexOf('Textured PEI Plate') > 0,
        true
    );
    assert.throws(() => buildSlicerCommandArgs('FDM', 'p.json', outputPath, '20%', 'bambu', 'm.json', null), /filament profile is required/);
    assert.throws(() => buildSlicerCommandArgs('FDM', 'p.json', outputPath, '20%', 'bambu', null, 'f.json'), /machine profile is required/);
    assert.throws(() => buildSlicerCommandArgs('FDM', 'p.json', 'stage/result.gcode', '20%', 'bambu', 'm.json', 'f.json'), /\.gcode\.3mf/);
});

test('supports=false drops the Prusa support flags while the default argv stays byte-identical', () => {
    const base = buildSlicerCommandArgs('FDM', 'profile.ini', 'out.gcode', '20%', 'prusa');
    assert.deepEqual(buildSlicerCommandArgs('FDM', 'profile.ini', 'out.gcode', '20%', 'prusa', null, null, { supports: true }), base);
    assert.deepEqual(buildSlicerCommandArgs('FDM', 'profile.ini', 'out.gcode', '20%', 'prusa', null, null, {}), base);
    const noSupports = buildSlicerCommandArgs('FDM', 'profile.ini', 'out.gcode', '20%', 'prusa', null, null, { supports: false });
    assert.deepEqual(noSupports, ['--load', 'profile.ini', '--center', '100,100', '--gcode-flavor', 'marlin',
        '--export-gcode', '--output', 'out.gcode', '--fill-density', '20%']);
    // Orca receives supports through its runtime profile, not through argv.
    const orca = buildSlicerCommandArgs('FDM', 'process.json', path.join('stage', 'result.gcode'), '20%', 'orca', 'machine.json', 'filament.json');
    assert.deepEqual(
        buildSlicerCommandArgs('FDM', 'process.json', path.join('stage', 'result.gcode'), '20%', 'orca', 'machine.json', 'filament.json', { supports: false }),
        orca
    );
    // SLA never carries support flags, and centers on the Saturn 4 Ultra bed.
    assert.deepEqual(
        buildSlicerCommandArgs('SLA', 'profile.ini', 'out.sl1', '20%', 'prusa', null, null, { supports: false }),
        ['--load', 'profile.ini', '--center', '109.44,61.44', '--export-sla', '--output', 'out.sl1']
    );
});

test('POST /bambu/slice is a slice-audience route with the same protection chain', () => {
    assert.equal(classifyRoute('POST', '/bambu/slice'), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('POST', '/bambu//slice/?x=1'), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('GET', '/bambu/slice'), ROUTE_AUDIENCES.PUBLIC);
    assert.equal(classifyRoute('POST', '/bambu/slice/extra'), ROUTE_AUDIENCES.PUBLIC);
    const router = createSliceRouter({
        rateLimiter(req, res, next) { next(); },
        authenticate(req, res, next) { next(); },
        upload: { single: () => (req, res, next) => next() },
        handleBambu: async () => {}
    });
    const routes = router.stack.filter((layer) => layer.route).map((layer) => layer.route);
    assert.deepEqual(routes.map((route) => route.path), ['/prusa/slice', '/orca/slice', '/bambu/slice']);
    for (const route of routes) {
        assert.deepEqual(Object.keys(route.methods), ['post'], route.path);
        assert.equal(route.stack.length, 3, route.path);
    }
});

test('queue fairness keys prefer the authenticated principal slot and fall back to the client IP', () => {
    const ip = () => '198.51.100.7';
    assert.equal(resolveQueueKey({}, ip), '198.51.100.7');
    assert.equal(resolveQueueKey({ slicePrincipal: null }, ip), '198.51.100.7');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 'woocommerce' } }, ip), 'principal:woocommerce');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 'leadpilot.active' } }, ip), 'principal:leadpilot.active');
    // The shared compatibility slot is anonymous: it keys on the client IP so
    // MAX_SLICE_QUEUE_PER_IP never becomes one global cap for legacy callers.
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 'shared' } }, ip), '198.51.100.7');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 'shared' } }, () => '203.0.113.10'), '203.0.113.10');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: '' } }, ip), '198.51.100.7');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 'bad slot' } }, ip), '198.51.100.7');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 42 } }, ip), '198.51.100.7');
    assert.equal(resolveQueueKey({ slicePrincipal: { slot: 'x'.repeat(65) } }, ip), '198.51.100.7');
});

async function requestFixture(t, body, engine, fileName = 'model.stl') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'b1-prevalidate-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const workspace = await createJobWorkspace({
        jobsRoot: path.join(root, 'jobs'),
        scratchRoot: path.join(root, 'scratch'),
        outputRoot: path.join(root, 'output')
    });
    t.after(() => workspace.cleanup());
    const req = { body };
    if (fileName) {
        req.file = { fieldname: 'choosenFile', originalname: fileName, path: workspace.resolvePath('upload') };
    }
    attachWorkspaceToRequest(req, workspace);
    const observed = { status: null, payload: null };
    const res = {
        status(value) { observed.status = value; return this; },
        json(value) { observed.payload = value; return this; }
    };
    return { req, res, observed, engine };
}

test('invalid requests answer 400 before enqueue and never consume a queue slot', async (t) => {
    const cases = [
        [{ layerHeight: '0.2', material: 'PLA' }, 'bambu', null, 'NO_FILE_UPLOADED'],
        [{ layerHeight: '0.2', material: 'PLA', infill: '140' }, 'bambu', 'model.stl', 'INVALID_INFILL'],
        [{ layerHeight: '0.2', material: 'PLA', printerProfile: 'X1C' }, 'bambu', 'model.stl', 'INVALID_PRINTER_PROFILE'],
        [{ layerHeight: '0.3', material: 'PLA' }, 'bambu', 'model.stl', 'INVALID_LAYER_HEIGHT'],
        [{ layerHeight: '0.2', material: 'PLA', supports: 'maybe' }, 'orca', 'model.stl', 'INVALID_SUPPORTS'],
        [{ layerHeight: '0.2', material: 'PLA', printerProfile: 'missing.ini' }, 'prusa', 'model.stl', 'PROFILE_NOT_FOUND'],
        [{ layerHeight: '0.2', material: 'PLA' }, 'prusa', 'model.exe', 'UNSUPPORTED_FILE_FORMAT']
    ];
    for (const [body, engine, fileName, code] of cases) {
        const { req, res, observed } = await requestFixture(t, body, engine, fileName);
        let enqueued = 0;
        const handlers = createSliceHandlers({
            enqueueSliceJobImpl: async () => { enqueued += 1; return res; },
            getClientIpImpl: () => 'client',
            validateSliceRequestImpl: preValidateSliceRequest,
            processSliceImpl: async () => { throw new Error('must not run'); }
        });
        const handler = { bambu: handlers.handleSliceBambu, orca: handlers.handleSliceOrca, prusa: handlers.handleSlicePrusa }[engine];
        const result = await handler(req, res);
        assert.equal(result, res, code);
        assert.equal(observed.status, 400, code);
        assert.equal(observed.payload.errorCode, code, code);
        assert.equal(observed.payload.success, false, code);
        assert.equal(enqueued, 0, code);
    }
});

test('valid requests pass pre-validation and are enqueued exactly once', async (t) => {
    for (const [body, engine] of [
        [{ layerHeight: '0.1', material: 'PETG', printerProfile: 'h2d', supports: 'false', infill: '35' }, 'bambu'],
        [{ layerHeight: '0.2', material: 'PLA' }, 'orca'],
        [{ layerHeight: '0.2', material: 'ABS', supports: '0' }, 'prusa']
    ]) {
        const { req, res, observed } = await requestFixture(t, body, engine);
        let enqueued = 0;
        const handlers = createSliceHandlers({
            enqueueSliceJobImpl: async (task) => { enqueued += 1; return task(); },
            getClientIpImpl: () => 'client',
            validateSliceRequestImpl: preValidateSliceRequest,
            processSliceImpl: async () => res
        });
        const handler = { bambu: handlers.handleSliceBambu, orca: handlers.handleSliceOrca, prusa: handlers.handleSlicePrusa }[engine];
        assert.equal(await handler(req, res), res, engine);
        assert.equal(observed.status, null, engine);
        assert.equal(enqueued, 1, engine);
    }
    // Without a workspace the pre-validation steps aside and the pipeline owns the failure.
    assert.equal(preValidateSliceRequest({}, {}, { forcedTechnology: 'FDM', engine: 'bambu' }), null);
});
