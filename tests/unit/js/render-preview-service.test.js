'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const renderService = require('../../../app/services/render.service');
const { attachWorkspaceToRequest } = require('../../../app/services/slice/workspace');
const { awaitResponseSettlement } = require('../../../app/services/slice/response-lifecycle');
const { APPLICATION_ROOT } = require('../../../app/services/slice/helper-paths');
const { MAX_BUILD_VOLUMES, MIN_BUILD_VOLUMES } = require('../../../app/config/constants');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake-png-body')]);

function createResponse() {
    const res = new EventEmitter();
    res.headers = {};
    res.statusCode = null;
    res.body = undefined;
    res.jsonBody = undefined;
    res.headersSent = false;
    res.destroyed = false;
    res.closed = false;
    res.writableEnded = false;
    res.writableFinished = false;
    res.status = (code) => { res.statusCode = code; return res; };
    res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
    res.json = (payload) => { res.jsonBody = payload; res.headersSent = true; return res; };
    res.end = (body) => {
        res.body = body;
        res.headersSent = true;
        res.writableEnded = true;
        res.writableFinished = true;
        res.emit('finish');
    };
    return res;
}

function createWorkspace(directory) {
    return {
        id: 'job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        directory,
        assertContainedPath: (candidate) => candidate,
        createUniquePath: async (extension) => path.join(directory, `preview-fixture${extension}`)
    };
}

function createRequest(workspace, body = {}, file = { originalname: 'model.stl', path: '/ws/upload', fieldname: 'choosenFile' }) {
    const req = { body, file, method: 'POST' };
    attachWorkspaceToRequest(req, workspace);
    return req;
}

function measured(x, y, z) {
    return { status: 'measured', modelInfo: { x, y, z, height_mm: z } };
}

function createDependencies(overrides = {}) {
    const calls = { commands: [], transform: [] };
    const dependencies = {
        appendOriginalExtensionToUploadImpl: async (inputFile, ext) => `${inputFile}${ext}`,
        prepareProcessableModelImpl: async (inputFile) => ({
            processableFile: `${inputFile}.oriented.stl`,
            originalModelMeasurement: measured(10, 20, 30),
            orientedModelMeasurement: measured(10, 20, 30),
            orientation: { mode: 'auto', outcome: 'unchanged' }
        }),
        applyTransformAndValidateModelImpl: async (processableFile, oriented, transformOptions, limits) => {
            calls.transform.push({ processableFile, transformOptions, limits });
            return {
                isValid: true,
                processableFile: `${processableFile}.final.stl`,
                effectiveModelInfo: { x: 40.04, y: 60.06, z: 25.95, height_mm: 25.95 }
            };
        },
        assertBoundedModelFileImpl: async (filePath) => filePath,
        readPreviewImageImpl: async () => Buffer.from(FAKE_PNG),
        runCommandImpl: async (executable, args, options) => {
            calls.commands.push({ executable, args, signal: options?.signal });
            return { stdout: '', stderr: '' };
        },
        pythonExecutable: '/opt/venv/bin/python3',
        ...overrides
    };
    return { dependencies, calls };
}

test('caption uses one decimal per axis with the exact "X x Y x Z mm" layout', () => {
    assert.equal(renderService.formatDimensionCaption({ x: 40.04, y: 60.06, z: 25.95 }), '40.0 x 60.1 x 26.0 mm');
    assert.equal(renderService.formatDimensionCaption({ x: 1, y: 2, z: 3 }), '1.0 x 2.0 x 3.0 mm');
    assert.throws(() => renderService.formatDimensionCaption({ x: Number.NaN, y: 1, z: 1 }), /invalid/);
    assert.throws(() => renderService.formatDimensionCaption({ x: -1, y: 1, z: 1 }), /invalid/);
});

test('renderer argv is module-anchored, shell-free, and carries the fixed 1024x768 geometry', () => {
    const helper = renderService.resolveRenderHelperPath();
    assert.equal(helper, path.join(APPLICATION_ROOT, 'render_preview.py'));
    assert.equal(path.isAbsolute(helper), true);
    const args = renderService.buildRenderArguments(helper, '/ws/model.stl', '/ws/preview.png', '40.0 x 60.0 x 25.0 mm');
    assert.deepEqual(args, [
        helper, '/ws/model.stl', '/ws/preview.png',
        '--width', '1024', '--height', '768',
        '--caption', '40.0 x 60.0 x 25.0 mm'
    ]);
    assert.equal(renderService.PREVIEW_WIDTH, 1024);
    assert.equal(renderService.PREVIEW_HEIGHT, 768);
    assert.equal(renderService.RENDER_COMMAND_TIMEOUT_MS, 60_000);
});

test('preview envelope is the permissive largest-supported FDM volume, not a per-profile ceiling', () => {
    const limits = renderService.createPreviewBuildVolumeLimits();
    assert.deepEqual(limits.max, MAX_BUILD_VOLUMES.FDM);
    assert.deepEqual(limits.min, MIN_BUILD_VOLUMES.FDM);
    assert.equal(limits.sourceProfile, 'preview-envelope');
    limits.max.x = 1;
    assert.equal(renderService.createPreviewBuildVolumeLimits().max.x, MAX_BUILD_VOLUMES.FDM.x);
});

test('successful render answers image/png bytes from the transformed STL with the final-dimension caption', async () => {
    const { dependencies, calls } = createDependencies();
    const processRender = renderService.createRenderProcessor(dependencies);
    const workspace = createWorkspace('/ws');
    const req = createRequest(workspace, { rotationX: '90', orientationMode: 'preserve', scalePercent: '50' });
    const res = createResponse();
    const controller = new AbortController();

    const result = await processRender(req, res, { signal: controller.signal });
    await awaitResponseSettlement(req);

    assert.equal(result, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['content-length'], String(FAKE_PNG.length));
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(res.body.equals(FAKE_PNG), true);
    assert.equal(res.jsonBody, undefined);

    assert.equal(calls.commands.length, 1);
    const [command] = calls.commands;
    assert.equal(command.executable, '/opt/venv/bin/python3');
    assert.equal(command.args[0], renderService.resolveRenderHelperPath());
    assert.equal(command.args[1], '/ws/upload.stl.oriented.stl.final.stl');
    assert.equal(command.args[2], path.join('/ws', 'preview-fixture.png'));
    assert.deepEqual(command.args.slice(3), ['--width', '1024', '--height', '768', '--caption', '40.0 x 60.1 x 26.0 mm']);
    assert.equal(command.signal, controller.signal);

    assert.equal(calls.transform.length, 1);
    assert.equal(calls.transform[0].transformOptions.rotationDeg.x, 90);
    assert.equal(calls.transform[0].transformOptions.scalePercent, 50);
    assert.deepEqual(calls.transform[0].limits.max, MAX_BUILD_VOLUMES.FDM);
});

test('option validation failures answer the slice JSON envelope before any native work', async () => {
    const cases = [
        [{ orientationMode: 'sideways' }, 400, 'INVALID_ORIENTATION_MODE'],
        [{ rotationX: 'abc' }, 400, 'INVALID_ROTATION_OPTIONS'],
        [{ scalePercent: '50', targetSizeX: '10' }, 400, 'CONFLICTING_SIZE_OPTIONS'],
        [{ sizeUnit: 'furlong' }, 400, 'INVALID_SIZE_UNIT']
    ];
    for (const [body, status, errorCode] of cases) {
        const { dependencies, calls } = createDependencies();
        const processRender = renderService.createRenderProcessor(dependencies);
        const res = createResponse();
        await processRender(createRequest(createWorkspace('/ws'), body), res, {});
        assert.equal(res.statusCode, status, errorCode);
        assert.equal(res.jsonBody.success, false, errorCode);
        assert.equal(res.jsonBody.errorCode, errorCode);
        assert.equal(calls.commands.length, 0, errorCode);
    }
});

test('unsupported extension and missing upload fail closed with the slice error codes', async () => {
    const { dependencies } = createDependencies();
    const processRender = renderService.createRenderProcessor(dependencies);

    const unsupported = createResponse();
    await processRender(createRequest(createWorkspace('/ws'), {}, {
        originalname: 'model.exe', path: '/ws/upload', fieldname: 'choosenFile'
    }), unsupported, {});
    assert.equal(unsupported.statusCode, 400);
    assert.equal(unsupported.jsonBody.errorCode, 'UNSUPPORTED_FILE_FORMAT');

    const missing = createResponse();
    await processRender(createRequest(createWorkspace('/ws'), {}, null), missing, {});
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.jsonBody.errorCode, 'NO_FILE_UPLOADED');
});

test('transform/bounds rejections propagate their typed 4xx envelopes unchanged', async () => {
    const boundsResponse = {
        success: false,
        error: 'Model dimensions are outside selected printer limits. X: 400mm > 350mm',
        errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS'
    };
    for (const [status, response] of [
        [422, { success: false, error: 'Model dimensions could not be resolved after preprocessing.', errorCode: 'MODEL_DIMENSIONS_UNAVAILABLE' }],
        [422, boundsResponse],
        [400, { success: false, error: 'bad size', errorCode: 'INVALID_SIZE_OPTIONS' }]
    ]) {
        const { dependencies, calls } = createDependencies({
            applyTransformAndValidateModelImpl: async () => ({ isValid: false, status, response })
        });
        const processRender = renderService.createRenderProcessor(dependencies);
        const res = createResponse();
        await processRender(createRequest(createWorkspace('/ws')), res, {});
        assert.equal(res.statusCode, status);
        assert.deepEqual(res.jsonBody, response);
        assert.equal(calls.commands.length, 0);
    }
});

test('geometry converter failures map to INVALID_SOURCE_GEOMETRY without repair', async () => {
    const { dependencies } = createDependencies({
        prepareProcessableModelImpl: async () => {
            const error = new Error('Command failed: cad2stl.py');
            error.stderr = '[PYTHON] ERROR: mesh generation failed';
            throw error;
        }
    });
    const processRender = renderService.createRenderProcessor(dependencies);
    const res = createResponse();
    await processRender(createRequest(createWorkspace('/ws')), res, {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.errorCode, 'INVALID_SOURCE_GEOMETRY');
});

test('renderer timeout answers a controlled 422 FILE_PROCESSING_TIMEOUT naming the 60 second budget', async () => {
    const { dependencies } = createDependencies({
        runCommandImpl: async () => {
            const error = new Error('The slicing process timed out after 1 minutes.');
            error.code = 'ETIMEDOUT';
            error.killed = true;
            throw error;
        }
    });
    const processRender = renderService.createRenderProcessor(dependencies);
    const res = createResponse();
    await processRender(createRequest(createWorkspace('/ws')), res, {});
    assert.equal(res.statusCode, 422);
    assert.equal(res.jsonBody.errorCode, 'FILE_PROCESSING_TIMEOUT');
    assert.match(res.jsonBody.error, /60 seconds/);
});

test('renderer failure and invalid output stay internal 500 without leaking paths', async () => {
    const failing = createDependencies({
        runCommandImpl: async () => {
            const error = new Error('Command failed: /opt/venv/bin/python3 /app/render_preview.py');
            error.stderr = '[PYTHON RENDER] ERROR: ValueError: no drawable faces';
            throw error;
        }
    });
    const res = createResponse();
    await renderService.createRenderProcessor(failing.dependencies)(createRequest(createWorkspace('/ws')), res, {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.jsonBody.errorCode, 'INTERNAL_PROCESSING_ERROR');
    assert.doesNotMatch(JSON.stringify(res.jsonBody), /render_preview|\/ws|python/);

    const notPng = createDependencies({
        readPreviewImageImpl: async () => { throw new Error('Preview renderer output is not a PNG image.'); }
    });
    const res2 = createResponse();
    await renderService.createRenderProcessor(notPng.dependencies)(createRequest(createWorkspace('/ws')), res2, {});
    assert.equal(res2.statusCode, 500);
    assert.equal(res2.jsonBody.errorCode, 'INTERNAL_PROCESSING_ERROR');
});

test('an aborted request never writes a response and rethrows the abort', async () => {
    const controller = new AbortController();
    const { dependencies } = createDependencies({
        runCommandImpl: async (executable, args, options) => {
            controller.abort();
            const error = new Error('aborted');
            error.name = 'AbortError';
            error.code = 'ABORT_ERR';
            void options;
            throw error;
        }
    });
    const processRender = renderService.createRenderProcessor(dependencies);
    const res = createResponse();
    await assert.rejects(
        processRender(createRequest(createWorkspace('/ws')), res, { signal: controller.signal }),
        (error) => error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 'REQUEST_ABORTED'
    );
    assert.equal(res.statusCode, null);
    assert.equal(res.body, undefined);
});

test('readPreviewImage enforces regular-file, size, containment, and PNG signature checks', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'render-preview-'));
    try {
        const workspace = {
            assertContainedPath(candidate) {
                const resolved = path.resolve(candidate);
                if (!resolved.startsWith(path.resolve(directory))) throw new Error('Path is outside the managed workspace');
                return resolved;
            }
        };
        const good = path.join(directory, 'good.png');
        await fs.writeFile(good, FAKE_PNG);
        const bytes = await renderService.readPreviewImage(good, workspace);
        assert.equal(bytes.equals(FAKE_PNG), true);

        const notPng = path.join(directory, 'bad.png');
        await fs.writeFile(notPng, Buffer.from('GIF89a not png'));
        await assert.rejects(renderService.readPreviewImage(notPng, workspace), /not a PNG/);

        const empty = path.join(directory, 'empty.png');
        await fs.writeFile(empty, Buffer.alloc(0));
        await assert.rejects(renderService.readPreviewImage(empty, workspace), /safe image/);

        await assert.rejects(renderService.readPreviewImage(path.join(os.tmpdir(), 'outside.png'), workspace), /outside/);
        await assert.rejects(renderService.readPreviewImage(path.join(directory, 'missing.png'), workspace), /ENOENT/);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('writeBinaryAndWaitForFinish rejects on an already-aborted signal and on a closed response', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
        renderService.writeBinaryAndWaitForFinish(createResponse(), FAKE_PNG, { contentType: 'image/png', signal: aborted.signal }),
        (error) => error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 'REQUEST_ABORTED'
    );
    const closed = createResponse();
    closed.destroyed = true;
    await assert.rejects(
        renderService.writeBinaryAndWaitForFinish(closed, FAKE_PNG, { contentType: 'image/png' }),
        /closed before completion/
    );
});

test('createRenderHandlers routes the processor through the shared queue-aware slice handler', async () => {
    let enqueued = 0;
    let processed = 0;
    const res = createResponse();
    const { handleRender } = renderService.createRenderHandlers({
        processRenderImpl: async (req, response, options) => {
            processed += 1;
            assert.equal(response, res);
            assert.ok(options.signal instanceof AbortSignal);
            response.status(200);
            response.end(FAKE_PNG);
            return response;
        },
        enqueueSliceJobImpl: async (task, options) => {
            enqueued += 1;
            assert.equal(typeof options.queueKey, 'string');
            return task(options.signal);
        },
        getClientIpImpl: () => '203.0.113.10'
    });
    const req = new EventEmitter();
    req.socket = new EventEmitter();
    const result = await handleRender(req, res);
    assert.equal(result, res);
    assert.equal(enqueued, 1);
    assert.equal(processed, 1);
});

test('queue rejections answer the stable queue envelopes for renders too', async () => {
    const { SliceQueueFullError } = require('../../../app/services/slice/queue');
    const res = createResponse();
    const { handleRender } = renderService.createRenderHandlers({
        processRenderImpl: async () => { throw new Error('must not run'); },
        enqueueSliceJobImpl: async () => { throw new SliceQueueFullError(); },
        getClientIpImpl: () => '203.0.113.10'
    });
    const req = new EventEmitter();
    req.socket = new EventEmitter();
    await handleRender(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.jsonBody.errorCode, 'SLICE_QUEUE_FULL');
});

test('render requests are validated before enqueue: a missing upload never reaches the queue', async () => {
    let enqueued = 0;
    const { handleRender } = renderService.createRenderHandlers({
        processRenderImpl: async () => { throw new Error('must not run'); },
        enqueueSliceJobImpl: async (task, options) => { enqueued += 1; return task(options.signal); },
        getClientIpImpl: () => '203.0.113.10'
    });
    const cases = [
        [null, 'NO_FILE_UPLOADED'],
        [{ originalname: 'model.exe', path: '/ws/upload', fieldname: 'choosenFile' }, 'UNSUPPORTED_FILE_FORMAT']
    ];
    for (const [file, errorCode] of cases) {
        const res = createResponse();
        const req = createRequest(createWorkspace('/ws'), {}, file);
        req.socket = new EventEmitter();
        const result = await handleRender(req, res);
        assert.equal(result, res, errorCode);
        assert.equal(res.statusCode, 400, errorCode);
        assert.equal(res.jsonBody.errorCode, errorCode, errorCode);
        assert.equal(res.jsonBody.success, false, errorCode);
        assert.equal(enqueued, 0, `${errorCode} must be answered before enqueue`);
    }
    const invalidOption = createResponse();
    const optionReq = createRequest(createWorkspace('/ws'), { infill: '140' });
    optionReq.socket = new EventEmitter();
    await handleRender(optionReq, invalidOption);
    assert.equal(invalidOption.statusCode, 400);
    assert.equal(invalidOption.jsonBody.errorCode, 'INVALID_INFILL');
    assert.equal(enqueued, 0);

    // A valid request passes the pre-validator and is enqueued exactly once.
    let processed = 0;
    const valid = renderService.createRenderHandlers({
        processRenderImpl: async (req, response) => { processed += 1; response.status(200); response.end(FAKE_PNG); return response; },
        enqueueSliceJobImpl: async (task, options) => { enqueued += 1; return task(options.signal); },
        getClientIpImpl: () => '203.0.113.10'
    });
    const okRes = createResponse();
    const okReq = createRequest(createWorkspace('/ws'), { layerHeight: '0.2', material: 'PLA' });
    okReq.socket = new EventEmitter();
    await valid.handleRender(okReq, okRes);
    assert.equal(enqueued, 1);
    assert.equal(processed, 1);

    // The pre-validator itself is exported and inert without a workspace.
    const preValidate = renderService.createRenderPreValidator();
    assert.equal(preValidate({ body: {} }, createResponse()), null);
    const missingRes = createResponse();
    assert.equal(preValidate(createRequest(createWorkspace('/ws'), {}, null), missingRes), missingRes);
    assert.equal(missingRes.jsonBody.errorCode, 'NO_FILE_UPLOADED');
});
