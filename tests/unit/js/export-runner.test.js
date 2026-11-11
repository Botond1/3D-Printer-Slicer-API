'use strict';

/**
 * 3.9.0 §2.2 / §4.7 (T-EXP-U): the export runner. It re-runs the hashed
 * preparation pipeline (mocked here exactly where a native/Python command
 * would run), hashes the placed STL, compares it with
 * `expectedSlicedGeometrySha256`, and writes `stl` or `3mf`. The 3MF case
 * runs the real `app/export_3mf.py` when a Python is available.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const { resolveRequestOrResponse } = require('../../../app/services/slice/pipeline');
const { SliceResourceError } = require('../../../app/services/slice/resource-errors');
const {
    createExportRunner,
    EXPORT_HELPER_NAME,
    threeMfMetadata,
    exportHeaders
} = require('../../../app/services/export/export.service');

const GENERATION = 'f'.repeat(64);
const SERVICE_SOURCE = path.resolve(__dirname, '../../../app/services/export/export.service.js');

function binaryStl(triangles) {
    const buffer = Buffer.alloc(84 + triangles.length * 50);
    buffer.write('r3d placed', 0, 'ascii');
    buffer.writeUInt32LE(triangles.length, 80);
    triangles.forEach((triangle, index) => {
        const offset = 84 + index * 50;
        buffer.writeFloatLE(0, offset); buffer.writeFloatLE(0, offset + 4); buffer.writeFloatLE(1, offset + 8);
        triangle.flat().forEach((value, axis) => buffer.writeFloatLE(value, offset + 12 + axis * 4));
    });
    return buffer;
}

const PLACED = binaryStl([
    [[18, 0, 0], [58.1, 0, 0], [18, 40, 0]],
    [[18, 0, 0], [18, 40, 0], [18, 0, 40.3333]],
    [[58.1, 0, 0], [18, 40, 0], [18, 0, 40.3333]],
    [[18, 0, 0], [58.1, 0, 0], [18, 0, 40.3333]]
]);
const PLACED_SHA = crypto.createHash('sha256').update(PLACED).digest('hex');

const MODEL_TRANSFORM = Object.freeze({
    orientation_mode: 'preserve',
    orientation_outcome: 'preserved',
    scale_percent: 100,
    rotation_deg: { x: 90, y: 0, z: 0 },
    rotation_matrix: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    oriented_dimensions_mm: { x: 40.1, y: 40, z: 40.333 },
    final_dimensions_mm: { x: 40.1, y: 40, z: 40.333 }
});

function findPython() {
    const candidates = [process.env.R3D_TEST_PYTHON, process.platform === 'win32' ? 'python' : 'python3', 'python']
        .filter(Boolean);
    for (const candidate of candidates) {
        try {
            const out = execFileSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', timeout: 20_000 });
            if (out.trim() === '3') return candidate;
        } catch {
            // Try the next candidate.
        }
    }
    return null;
}

async function createContext(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'export-runner-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const dirs = { jobsRoot: path.join(root, 'jobs'), scratchRoot: path.join(root, 'scratch'), outputRoot: path.join(root, 'output') };
    await fs.mkdir(dirs.outputRoot);
    const uploadPath = path.join(root, 'upload-original');
    await fs.writeFile(uploadPath, 'source model bytes');
    const destination = path.join(root, 'destination');
    await fs.mkdir(destination);
    const stored = [];
    const persist = async (format, file) => {
        const target = path.join(destination, `stored.${format}`);
        await fs.rename(file, target);
        stored.push(target);
        return target;
    };
    const workspaces = [];
    const createWorkspace = async () => {
        const workspace = await createJobWorkspace(dirs);
        workspaces.push(workspace);
        return workspace;
    };
    return { root, dirs, uploadPath, persist, stored, workspaces, createWorkspace };
}

function input(context, fields = {}) {
    return {
        upload: { path: context.uploadPath, originalname: 'r3d-private.stl', size: 18 },
        body: { material: 'PLA', layerHeight: '0.2', printerProfile: 'P1S' },
        requestId: 'req-runner',
        fields: {
            format: 'stl',
            expectedSourceSha256: 'e'.repeat(64),
            expectedSlicedGeometrySha256: PLACED_SHA,
            expectedMeasurementGeneration: GENERATION,
            ...fields
        },
        generation: GENERATION
    };
}

/** The hashed pipeline stand-in: it writes the placed STL exactly where the real one would. */
function fakePrepare(calls, overrides = {}) {
    return async (res, request, workspace, signal) => {
        calls.push({ request, workspace, signal });
        if (overrides.before) await overrides.before(res, request, workspace, signal);
        if (res.headersSent) return { response: res };
        const placed = await workspace.createUniquePath('.stl');
        await fs.writeFile(placed, overrides.placed || PLACED);
        return {
            response: null,
            request: { ...request, profileOverrides: { bambuPrinter: 'P1S' } },
            preparedModel: {
                model: {
                    processableFile: placed,
                    modelTransform: overrides.modelTransform || MODEL_TRANSFORM,
                    placement: { x_min: 18, y_min: 0 }
                }
            }
        };
    };
}

const passResolve = (req, res, options, workspace) => ({
    response: null,
    request: { engine: options.engine, inputFile: workspace.assertContainedPath(req.file.path), originalExt: '.stl' }
});

async function remainingWorkspaces(context) {
    try {
        return (await fs.readdir(context.dirs.jobsRoot)).filter((name) => name.startsWith('job-'));
    } catch {
        return [];
    }
}

test('the service calls the exported hashed pipeline functions unchanged', async () => {
    const source = await fs.readFile(SERVICE_SOURCE, 'utf8');
    assert.match(source, /require\('\.\.\/slice\/pipeline'\)/);
    assert.match(source, /resolveRequestOrResponse, prepareSliceJob/);
    assert.equal(EXPORT_HELPER_NAME, 'export_3mf.py');
});

test('stl, exact: the placed STL is the body; the upload is untouched; the run workspace is gone', async (t) => {
    const context = await createContext(t);
    const calls = [];
    const inspected = [];
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare(calls),
        inspectMesh: async (file) => { inspected.push(await fs.readFile(file)); return { volume_mm3: 1234.5 }; }
    });
    const result = await runner(input(context), new AbortController().signal, context.persist);
    assert.equal(result.status, 200);
    assert.equal(result.fidelity, 'exact');
    assert.equal(result.format, 'stl');
    assert.deepEqual(await fs.readFile(result.file.path), PLACED);
    assert.equal(result.file.sha256, PLACED_SHA);
    assert.equal(result.file.size, PLACED.length);
    assert.equal(result.facts.sliced_geometry_sha256, PLACED_SHA);
    assert.equal(result.facts.volume_mm3, 1234.5);
    assert.deepEqual(inspected, [PLACED], 'the volume is the receipt inspection of the very placed file');
    assert.deepEqual(result.facts.placement_mm, { x: 18, y: 0 });
    // The pipeline ran on a copy inside its own workspace; the upload is unchanged.
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0].request.inputFile, context.uploadPath);
    assert.equal(await fs.readFile(context.uploadPath, 'utf8'), 'source model bytes');
    assert.deepEqual(await remainingWorkspaces(context), []);
    const headers = exportHeaders(result);
    assert.equal(headers['X-R3D-Final-Dimensions-Mm'], '40.100,40.000,40.333');
    assert.equal(headers['X-R3D-Placement-Mm'], '18.000,0.000');
    assert.equal(headers['X-R3D-Rotation-Matrix'].split(',').length, 9);
    assert.equal(headers['X-R3D-Volume-Mm3'], '1234.5');
});

test('the real request parser runs on the run workspace copy', async (t) => {
    const context = await createContext(t);
    const calls = [];
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse,
        prepareSliceJob: fakePrepare(calls),
        inspectMesh: async () => ({ volume_mm3: 1 })
    });
    const result = await runner(input(context), new AbortController().signal, context.persist);
    assert.equal(result.status, 200);
    assert.equal(calls[0].request.engine, 'bambu');
    assert.equal(calls[0].request.originalExt, '.stl');
    assert.equal(path.dirname(calls[0].request.inputFile), calls[0].workspace.directory);
});

test('a different placed mesh is 409 EXPORT_GEOMETRY_MISMATCH with the actual hash and outcome', async (t) => {
    const context = await createContext(t);
    const other = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([], { placed: other, modelTransform: { ...MODEL_TRANSFORM, orientation_outcome: 'fallback_unmodified' } }),
        inspectMesh: async () => assert.fail('no inspection after a mismatch')
    });
    const result = await runner(input(context), new AbortController().signal, context.persist);
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, {
        success: false,
        error: 'The re-prepared model differs from the priced slice geometry.',
        errorCode: 'EXPORT_GEOMETRY_MISMATCH',
        actual_sliced_geometry_sha256: crypto.createHash('sha256').update(other).digest('hex'),
        orientation_outcome: 'fallback_unmodified'
    });
    assert.deepEqual(context.stored, []);
    assert.deepEqual(await remainingWorkspaces(context), []);
});

test('without expectedSlicedGeometrySha256 the export is labelled unverified', async (t) => {
    const context = await createContext(t);
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([]),
        inspectMesh: async () => ({ volume_mm3: 2 })
    });
    const result = await runner(input(context, { expectedSlicedGeometrySha256: undefined }), new AbortController().signal, context.persist);
    assert.equal(result.status, 200);
    assert.equal(result.fidelity, 'unverified');
});

test("the pipeline's own refusals keep their slice codes and statuses", async (t) => {
    const context = await createContext(t);
    const answered = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([], {
            before: (res) => res.status(422).json({ success: false, error: 'out', errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS', model_dimensions_mm: { x: 1, y: 2, z: 3 } })
        })
    });
    const bounds = await answered(input(context), new AbortController().signal, context.persist);
    assert.equal(bounds.status, 422);
    assert.equal(bounds.body.errorCode, 'MODEL_OUT_OF_PRINTER_BOUNDS');
    assert.deepEqual(bounds.body.model_dimensions_mm, { x: 1, y: 2, z: 3 });
    const thrown = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: async () => {
            // A converter's own refusal, as the Python walk reports it.
            throw Object.assign(new Error('Command failed'), { code: 2, stderr: 'INVALID_SOURCE_GEOMETRY|too_many_parts' });
        }
    });
    const geometry = await thrown(input(context), new AbortController().signal, context.persist);
    assert.equal(geometry.status, 400);
    assert.equal(geometry.body.errorCode, 'INVALID_SOURCE_GEOMETRY');
    assert.equal(geometry.body.success, false);
    const limited = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: async () => { throw new SliceResourceError('SLICE_RESOURCE_LIMIT_EXCEEDED', 'too big', 413); }
    });
    const resource = await limited(input(context), new AbortController().signal, context.persist);
    assert.equal(resource.status, 413);
    assert.equal(resource.body.errorCode, 'SLICE_RESOURCE_LIMIT_EXCEEDED');
    assert.deepEqual(await remainingWorkspaces(context), []);
});

test('an abort mid-run rejects with the signal reason and still cleans the run workspace', async (t) => {
    const context = await createContext(t);
    const controller = new AbortController();
    const reason = Object.assign(new Error('preempted'), { name: 'AbortError', code: 'EXPORT_PREEMPTED' });
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([], {
            before: async (res, request, workspace, signal) => {
                controller.abort(reason);
                if (signal.aborted) throw signal.reason;
            }
        })
    });
    await assert.rejects(runner(input(context), controller.signal, context.persist), (error) => error === reason);
    assert.deepEqual(await remainingWorkspaces(context), []);
    // The upload survives for the re-run after a pre-emption.
    assert.equal(await fs.readFile(context.uploadPath, 'utf8'), 'source model bytes');
});

test('a failing 3MF writer is 500 EXPORT_WRITE_FAILED', async (t) => {
    const context = await createContext(t);
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([]),
        inspectMesh: async () => ({ volume_mm3: 3 }),
        runCommand: async () => { throw Object.assign(new Error('Command failed'), { code: 1 }); }
    });
    const result = await runner(input(context, { format: '3mf' }), new AbortController().signal, context.persist);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, {
        success: false, error: 'The production model file could not be written.', errorCode: 'EXPORT_WRITE_FAILED'
    });
    assert.deepEqual(context.stored, []);
});

test('3mf metadata carries the §2.2 names; quote_ref only with exportLabel', () => {
    const facts = {
        sliced_geometry_sha256: PLACED_SHA, measurement_generation: GENERATION,
        final_dimensions_mm: { x: 1, y: 2, z: 3.25 }, placement_mm: { x: 18, y: 0 },
        rotation_deg: { x: 90, y: 0, z: -37.5 }, orientation_mode: 'auto', scale_percent: 333.4
    };
    const base = input({ uploadPath: 'x' });
    const without = threeMfMetadata(base, facts, { profileOverrides: { bambuPrinter: 'H2D' } }, 'exact');
    assert.deepEqual(Object.keys(without), [
        'export_contract', 'fidelity', 'source_sha256', 'sliced_geometry_sha256', 'measurement_generation',
        'printer_profile', 'orientation_mode', 'rotation_deg', 'placement_mm', 'final_dimensions_mm', 'scale_percent'
    ]);
    assert.equal(without.rotation_deg, '90,0,-37.5');
    assert.equal(without.printer_profile, 'H2D');
    assert.equal(without.scale_percent, '333.4');
    const labelled = threeMfMetadata({ ...base, fields: { ...base.fields, exportLabel: 'Q-7654321' } }, facts, {}, 'exact');
    assert.equal(labelled.quote_ref, 'Q-7654321');
});

test('3mf through the real export_3mf.py round-trips the placed STL bitwise', async (t) => {
    const python = findPython();
    if (!python) {
        t.skip('no Python 3 on this host');
        return;
    }
    const context = await createContext(t);
    const commands = [];
    const runCommand = (file, args, options) => {
        commands.push({ file, args, options });
        return new Promise((resolve, reject) => {
            execFile(python, ['-I', ...args], { timeout: 60_000 }, (error, stdout, stderr) => (
                error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })
            ));
        });
    };
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([]),
        inspectMesh: async () => ({ volume_mm3: 9 }),
        runCommand,
        pythonExecutable: 'python-under-test'
    });
    const result = await runner(input(context, { format: '3mf', exportLabel: 'Q-1234567' }), new AbortController().signal, context.persist);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.format, '3mf');
    assert.equal(commands.length, 1);
    assert.equal(commands[0].file, 'python-under-test');
    assert.equal(path.basename(commands[0].args[0]), 'export_3mf.py');
    assert.ok(commands[0].options.signal);
    assert.ok(Number.isSafeInteger(commands[0].options.timeoutMs));
    const bytes = await fs.readFile(result.file.path);
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
    assert.equal(result.file.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.facts.sliced_geometry_sha256, PLACED_SHA, 'the 3MF still names the STL it was made from');
    // Independent re-read of the written package: the same triangles, bitwise.
    const check = [
        'import sys, zipfile, struct',
        'from xml.etree import ElementTree as E',
        'ns="{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"',
        'stl=open(sys.argv[2],"rb").read(); n=struct.unpack_from("<I",stl,80)[0]',
        'root=E.fromstring(zipfile.ZipFile(sys.argv[1]).read("3D/3dmodel.model"))',
        'v=[b"".join(struct.pack("<f",float(x.get(a))) for a in "xyz") for x in root.iter(ns+"vertex")]',
        't=[b"".join(v[int(x.get(k))] for k in ("v1","v2","v3")) for x in root.iter(ns+"triangle")]',
        's=[stl[84+i*50+12:84+i*50+48] for i in range(n)]',
        'meta={m.get("name"):m.text for m in root.iter(ns+"metadata")}',
        'print("OK" if t==s and meta["r3d:quote_ref"]=="Q-1234567" and meta["r3d:sliced_geometry_sha256"]==sys.argv[3] else "DIFF")'
    ].join('\n');
    const placedCopy = path.join(context.root, 'placed-copy.stl');
    await fs.writeFile(placedCopy, PLACED);
    const verdict = execFileSync(python, ['-I', '-c', check, result.file.path, placedCopy, PLACED_SHA], { encoding: 'utf8' });
    assert.equal(verdict.trim(), 'OK');
    assert.deepEqual(await remainingWorkspaces(context), []);
});

test('the preflight verdict moves to the run copy, so the job does not tokenize the archive again (SEC-2)', async (t) => {
    const {
        clearExpansionVerdictsForTests, consumeExpansionVerdict, registerExpansionVerdict
    } = require('../../../app/services/slice/three-mf-expansion');
    clearExpansionVerdictsForTests();
    t.after(clearExpansionVerdictsForTests);
    const context = await createContext(t);
    const uploadStats = await fs.lstat(context.uploadPath, { bigint: true });
    const counts = { triangles: 4, instances: 1, objects: 1 };
    registerExpansionVerdict({
        realpath: await fs.realpath(context.uploadPath),
        dev: uploadStats.dev, ino: uploadStats.ino, size: uploadStats.size, mtimeNs: uploadStats.mtimeNs, counts
    });
    const consumed = [];
    const runner = createExportRunner({
        createWorkspace: context.createWorkspace,
        resolveRequestOrResponse: passResolve,
        prepareSliceJob: fakePrepare([], {
            before: async (res, request) => {
                // What the job's own inspection does with the file it reads.
                const stats = await fs.lstat(request.inputFile, { bigint: true });
                consumed.push(consumeExpansionVerdict(await fs.realpath(request.inputFile), stats));
            }
        }),
        inspectMesh: async () => ({ volume_mm3: 1 })
    });
    const result = await runner(input(context), new AbortController().signal, context.persist);
    assert.equal(result.status, 200);
    assert.deepEqual(consumed, [counts], 'the run copy carries the verdict');
    const after = await fs.lstat(context.uploadPath, { bigint: true });
    assert.equal(consumeExpansionVerdict(await fs.realpath(context.uploadPath), after), null,
        'the upload\'s verdict was consumed, not left to its TTL');
});
