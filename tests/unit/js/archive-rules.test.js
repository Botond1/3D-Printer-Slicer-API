'use strict';

// 3.9.0 WP3: archive rules and labels (T-ARC-1), synchronous refusals with
// `Prefer: respond-async` (T-ARC-3), the ZIP extraction name and the
// artifact-read fixture.

// The slice service resolves a Python path at require time; nothing here runs it.
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = originalPythonExecutable || process.execPath;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { inspectThreeMfArchive } = require('../../../app/services/slice/three-mf');
const { handleProcessingError } = require('../../../app/services/slice/errors');
const {
    ARCHIVE_RULES, SliceResourceError, archiveBodyKeys, invalidArchive, labelArchiveError, resourceLimit
} = require('../../../app/services/slice/resource-errors');
const { isUnsafeZipPath } = require('../../../app/services/slice/zip-policy');
const {
    extractFirstSupportedFromZip, extractedFileName, inspectZipFile
} = require('../../../app/services/slice/zip');
const { createSliceHandlers } = require('../../../app/services/slice.service');
const { createArchivePreflight, preflightArchive } = require('../../../app/services/slice/archive-preflight');
const { attachWorkspaceToRequest } = require('../../../app/services/slice/workspace');
const { setEventWriter } = require('../../../app/services/observability/events');
const { renderMetrics, resetMetricsForTests } = require('../../../app/services/observability/metrics');
const { ARCHIVE_RULES: METRIC_ARCHIVE_RULES } = require('../../../app/services/observability/metrics');
const {
    archiveCases, fanOutModel, makeArchive, renameZipEntry, tetrahedronThreeMf, withModel, writeArchiveCase
} = require('../../fixtures/archives/archive-cases');
const { readArtifactStats } = require('../../fixtures/archives/artifact-read');
const BASELINE = require('../../fixtures/archives/baseline-3.8.3.json');
const ARTIFACT_BASELINE = require('../../fixtures/archives/artifact-read-3.8.3.json');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'archives');

test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

async function tempDir(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wp3-rules-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

function mockResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        headersSent: false,
        writableEnded: false,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        getHeader(name) { return this.headers[name.toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; this.headersSent = true; this.writableEnded = true; return this; }
    };
}

function answer(error) {
    const res = mockResponse();
    handleProcessingError(error, res, null, null, () => '.stl, .3mf');
    return res;
}

test('the rule vocabulary is the closed §2.1/§2.5 list and the metric family knows every rule', () => {
    assert.deepEqual([...ARCHIVE_RULES], [
        'ARCHIVE_UNREADABLE', 'ARCHIVE_ENCRYPTED', 'ARCHIVE_UNSAFE_PATH', 'ARCHIVE_NESTED',
        'ARCHIVE_DISALLOWED_PART', 'ARCHIVE_TOO_MANY_ENTRIES', 'ARCHIVE_TOO_LARGE',
        'ARCHIVE_RATIO_EXCEEDED', 'ARCHIVE_EXPANSION_EXCEEDED'
    ]);
    assert.deepEqual([...METRIC_ARCHIVE_RULES].sort(), [...ARCHIVE_RULES].sort());
});

test('T-ARC-1: every crafted archive answers its 3.8.3 status and code plus the rule label', async (t) => {
    setEventWriter(() => {});
    t.after(() => setEventWriter(undefined));
    const root = await tempDir(t);
    const cases = archiveCases();
    assert.deepEqual(Object.keys(BASELINE.cases).sort(), cases.map((entry) => entry.name).sort());
    for (const entry of cases) {
        const file = await writeArchiveCase(root, entry);
        const policy = { ...resolveResourcePolicy({}), ...(entry.policy || {}) };
        const before = BASELINE.cases[entry.name];
        let error = null;
        try {
            await inspectThreeMfArchive(file, { resourcePolicy: policy });
        } catch (caught) {
            error = caught;
        }
        if (entry.rule === null) {
            assert.equal(error, null, `${entry.name} stays admitted`);
            assert.equal(before, 'admitted');
            continue;
        }
        assert.ok(error, `${entry.name} is refused`);
        const res = answer(error);
        if (entry.name === 'unreadable-not-a-zip') {
            // 3.8.3 answers an archive yauzl cannot open with the generic
            // 500 from the job; that answer is kept byte for byte.
            assert.deepEqual({ status: res.statusCode, errorCode: res.body.errorCode, error: res.body.error }, before);
            assert.equal(res.body.archive_rule, undefined);
            continue;
        }
        assert.equal(res.body.archive_rule, entry.rule, `${entry.name} rule`);
        assert.ok(res.body.archive_limit === null || Number.isFinite(res.body.archive_limit));
        assert.deepEqual(Object.keys(res.body), ['success', 'error', 'errorCode', 'archive_rule', 'archive_limit']);
        if (before === 'admitted') {
            // New refusals of 3.9.0: the NUL name and the expansion bomb.
            const expected = entry.rule === 'ARCHIVE_EXPANSION_EXCEEDED'
                ? { status: 400, errorCode: 'INVALID_SOURCE_GEOMETRY' }
                : { status: 400, errorCode: 'INVALID_SOURCE_ARCHIVE' };
            assert.deepEqual({ status: res.statusCode, errorCode: res.body.errorCode }, expected, entry.name);
        } else {
            assert.deepEqual({ status: res.statusCode, errorCode: res.body.errorCode, error: res.body.error }, before,
                `${entry.name} keeps its 3.8.3 answer`);
        }
    }
});

test('the rule limits name the number that was passed', async (t) => {
    const root = await tempDir(t);
    const byName = Object.fromEntries(archiveCases().map((entry) => [entry.name, entry]));
    const expectations = {
        'too-many-entries': 2,
        'too-large-entry': 2048,
        'too-large-total': 3000,
        'ratio-exceeded': 100,
        'unsafe-depth': 4,
        'expansion-fanout-1e16': 100_000,
        'encrypted-entry': null
    };
    for (const [name, limit] of Object.entries(expectations)) {
        const file = await writeArchiveCase(root, byName[name]);
        await assert.rejects(inspectThreeMfArchive(file, {
            resourcePolicy: { ...resolveResourcePolicy({}), ...(byName[name].policy || {}) }
        }), (error) => error.archiveLimit === limit, name);
    }
});

test('labels never change the body of an unlabelled error and the first label wins', () => {
    const plain = answer(resourceLimit('x'));
    assert.deepEqual(plain.body, {
        success: false, error: 'Slice processing exceeded a configured resource limit.', errorCode: 'SLICE_RESOURCE_LIMIT_EXCEEDED'
    });
    const archive = answer(invalidArchive('x'));
    assert.deepEqual(archive.body, {
        success: false, error: 'Uploaded ZIP file is invalid or does not contain a supported model file.', errorCode: 'INVALID_SOURCE_ARCHIVE'
    });
    const labelled = labelArchiveError(labelArchiveError(invalidArchive('x'), 'ARCHIVE_NESTED'), 'ARCHIVE_UNREADABLE', 5);
    assert.deepEqual(archiveBodyKeys(labelled), { archive_rule: 'ARCHIVE_NESTED', archive_limit: null });
    assert.equal(labelArchiveError(invalidArchive('x'), 'NOT_A_RULE').archiveRule, undefined);
    // A geometry error from the converter keeps its 3.8.3 body (no keys).
    const converter = answer(Object.assign(new Error('x'), { stdout: 'INVALID_SOURCE_GEOMETRY|empty' }));
    assert.deepEqual(Object.keys(converter.body), ['success', 'error', 'errorCode']);
    assert.equal(converter.body.errorCode, 'INVALID_SOURCE_GEOMETRY');
});

test('the expansion refusal reads as the converter refusal, is counted and logs its counts', async (t) => {
    const lines = [];
    setEventWriter((entry) => lines.push(entry));
    resetMetricsForTests();
    t.after(() => {
        setEventWriter(undefined);
        resetMetricsForTests();
    });
    const root = await tempDir(t);
    const file = path.join(root, 'bomb.3mf');
    await makeArchive(file, withModel(fanOutModel()));
    const error = await inspectThreeMfArchive(file).catch((caught) => caught);
    const res = answer(error);
    const converter = answer(Object.assign(new Error('x'), { stdout: 'INVALID_SOURCE_GEOMETRY|empty' }));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
        success: false,
        error: converter.body.error,
        errorCode: 'INVALID_SOURCE_GEOMETRY',
        archive_rule: 'ARCHIVE_EXPANSION_EXCEEDED',
        archive_limit: 100_000
    });
    const event = lines.find((line) => line.event === 'resource.rejected');
    assert.ok(event, 'resource.rejected emitted');
    assert.equal(event.error_code, 'INVALID_SOURCE_GEOMETRY');
    assert.deepEqual(Object.keys(event.extra).sort(), ['instances', 'limit', 'objects', 'reason', 'rule', 'triangles']);
    assert.equal(event.extra.reason, '3mf_expansion');
    assert.equal(event.extra.objects, 17);
    assert.match(renderMetrics(), /slicer_archive_rejections_total\{rule="ARCHIVE_EXPANSION_EXCEEDED"\} 1/);
    answer(labelArchiveError(invalidArchive('x'), 'ARCHIVE_NESTED'));
    assert.match(renderMetrics(), /slicer_archive_rejections_total\{rule="ARCHIVE_NESTED"\} 1/);
    assert.ok(!JSON.stringify(lines).includes('bomb'), 'no file name in any log line');
});

test('a NUL in an entry name is unsafe; Bambu and ordinary names are not', () => {
    assert.equal(isUnsafeZipPath('3D/x\u0000.model'), true);
    assert.equal(isUnsafeZipPath('\u0000'), true);
    for (const name of ['Metadata/plate_1.gcode', '3D/3dmodel.model', '[Content_Types].xml', 'model.stl']) {
        assert.equal(isUnsafeZipPath(name), false, name);
    }
});

test('artifact read: the control .gcode.3mf gives the 3.8.3 stats object through hashed bambu-artifact.js', async () => {
    const file = path.join(FIXTURES, 'control-cube.gcode.3mf');
    const bytes = await fsp.readFile(file);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
        '61f3ac82403b55590773ca800a9c0a32f0d029850cc371fd8818689517fc3c38');
    assert.deepEqual(await readArtifactStats(file), ARTIFACT_BASELINE);
});

test('ZIP: a mixed-case CAD entry is extracted under a random name with a lower-case extension', async (t) => {
    const root = await tempDir(t);
    const workspaceDir = path.join(root, 'ws');
    await fsp.mkdir(workspaceDir);
    const workspace = {
        resolvePath: (...segments) => path.join(workspaceDir, ...segments),
        assertContainedPath: (candidate) => {
            const resolved = path.resolve(candidate);
            assert.ok(resolved.startsWith(workspaceDir), 'contained');
            return resolved;
        }
    };
    for (const [entryName, extension] of [['model.Step', '.step'], ['x.sTP', '.stp'], ['y.Igs', '.igs'], ['plain.STL', '.stl']]) {
        const zip = path.join(workspaceDir, `${extension.slice(1)}-${entryName}.zip`);
        const payload = Buffer.from(`ISO-10303-21; ${entryName}`);
        await makeArchive(zip, [{ name: entryName, data: payload, store: true }]);
        const zipBefore = crypto.createHash('sha256').update(await fsp.readFile(zip)).digest('hex');
        const extracted = await extractFirstSupportedFromZip(zip, workspace);
        assert.match(path.basename(extracted), new RegExp(`^[0-9a-f]{32}\\${extension}$`), entryName);
        assert.ok(!path.basename(extracted).includes(path.parse(entryName).name), 'the entry name never reaches the disk');
        assert.deepEqual(await fsp.readFile(extracted), payload);
        // The source evidence reads the ZIP itself: its bytes and its format are unchanged.
        assert.equal(crypto.createHash('sha256').update(await fsp.readFile(zip)).digest('hex'), zipBefore);
        assert.equal(path.extname(zip).slice(1).toLowerCase(), 'zip');
    }
    assert.equal(extractedFileName('a/B.StEp', () => Buffer.alloc(16, 0xab)), `${'ab'.repeat(16)}.step`);
});

test('ZIP: NUL names are refused and the rules are labelled; status and code are 3.8.3', async (t) => {
    const root = await tempDir(t);
    const nul = path.join(root, 'nul.zip');
    await makeArchive(nul, [{ name: 'abcd.stl', data: 'solid x', store: true }]);
    await renameZipEntry(nul, 'abcd.stl', 'ab\u0000d.stl');
    await assert.rejects(inspectZipFile(nul, new Set(['.stl'])),
        { code: 'INVALID_SOURCE_ARCHIVE', status: 400, archiveRule: 'ARCHIVE_UNSAFE_PATH' });
    const nested = path.join(root, 'nested.zip');
    await makeArchive(nested, [{ name: 'inner.zip', data: 'PK', store: true }]);
    await assert.rejects(inspectZipFile(nested, new Set(['.stl'])), { code: 'INVALID_SOURCE_ARCHIVE', archiveRule: 'ARCHIVE_NESTED' });
    const many = path.join(root, 'many.zip');
    await makeArchive(many, [{ name: 'a.stl', data: 'a' }, { name: '.DS_Store', data: 'b' }]);
    await assert.rejects(inspectZipFile(many, new Set(['.stl']), {
        resourcePolicy: { ...resolveResourcePolicy({}), MAX_ZIP_ENTRIES: 1 }
    }), { code: 'SLICE_RESOURCE_LIMIT_EXCEEDED', status: 413, archiveRule: 'ARCHIVE_TOO_MANY_ENTRIES', archiveLimit: 1 });
});

function sliceRequest(workspaceDir, file, prefer) {
    const req = {
        headers: prefer ? { prefer: 'respond-async' } : {},
        get(name) { return this.headers[name.toLowerCase()]; },
        body: {},
        file: { fieldname: 'choosenFile', originalname: 'customer.3mf', path: file }
    };
    attachWorkspaceToRequest(req, { assertContainedPath: (candidate) => path.resolve(candidate) });
    return req;
}

test('T-ARC-3: archive refusals are answered synchronously with and without Prefer, before any queue place', async (t) => {
    setEventWriter(() => {});
    const root = await tempDir(t);
    const instance = createArchivePreflight({ maxWaiting: 24 });
    t.after(async () => {
        setEventWriter(undefined);
        await instance.close();
    });
    const bomb = path.join(root, 'upload-bomb');
    await makeArchive(bomb, withModel(fanOutModel()));
    const nested = path.join(root, 'upload-nested');
    await makeArchive(nested, tetrahedronThreeMf([{ name: '3D/inner.3mf', data: 'PK' }]));
    const valid = path.join(root, 'upload-valid');
    await makeArchive(valid, tetrahedronThreeMf());
    const enqueued = [];
    const storeCalls = [];
    const handlers = createSliceHandlers({
        validateSliceRequestImpl: () => null,
        preflightArchiveImpl: (req, options) => preflightArchive(req, { ...options, preflight: instance }),
        enqueueSliceJobImpl: async (task) => {
            enqueued.push(task);
            return undefined;
        },
        bindRequestAbortImpl: () => ({ signal: new AbortController().signal, dispose() {} }),
        setResponseAbortSignalImpl: () => {},
        asyncJobStore: {
            hasCapacity() {
                storeCalls.push('hasCapacity');
                return false;
            }
        }
    });
    for (const prefer of [true, false]) {
        for (const [file, status, code, rule] of [
            [bomb, 400, 'INVALID_SOURCE_GEOMETRY', 'ARCHIVE_EXPANSION_EXCEEDED'],
            [nested, 400, 'INVALID_SOURCE_ARCHIVE', 'ARCHIVE_NESTED']
        ]) {
            const res = mockResponse();
            await handlers.handleSliceBambu(sliceRequest(root, file, prefer), res);
            assert.equal(res.statusCode, status, `${rule} prefer=${prefer}`);
            assert.equal(res.body.errorCode, code);
            assert.equal(res.body.archive_rule, rule);
        }
    }
    assert.equal(enqueued.length, 0, 'no refused archive took a queue place');
    assert.equal(storeCalls.length, 0, 'no refused archive reached the async store');

    const asyncRes = mockResponse();
    await handlers.handleSliceBambu(sliceRequest(root, valid, true), asyncRes);
    assert.deepEqual(storeCalls, ['hasCapacity'], 'an admitted 3MF continues to the async submission');
    const syncRes = mockResponse();
    await handlers.handleSliceBambu(sliceRequest(root, valid, false), syncRes);
    assert.equal(enqueued.length, 1, 'an admitted 3MF is queued');

    // Not a direct 3MF: no preflight at all.
    const stlReq = sliceRequest(root, valid, false);
    stlReq.file.originalname = 'model.stl';
    assert.equal(await preflightArchive(stlReq, { preflight: instance }), null);
});

test('a caller that replaces the pipeline owns validation: no preflight runs; no workspace, no preflight', async (t) => {
    const root = await tempDir(t);
    const bomb = path.join(root, 'upload-bomb');
    await makeArchive(bomb, withModel(fanOutModel()));
    const handlers = createSliceHandlers({
        processSliceImpl: async () => 'processed',
        enqueueSliceJobImpl: async (task) => task(null),
        bindRequestAbortImpl: () => ({ signal: new AbortController().signal, dispose() {} }),
        setResponseAbortSignalImpl: () => {},
        asyncJobStore: null
    });
    assert.equal(await handlers.handleSliceBambu(sliceRequest(root, bomb, false), mockResponse()), 'processed');
    const bare = { file: { fieldname: 'choosenFile', originalname: 'a.3mf', path: bomb } };
    assert.equal(await preflightArchive(bare), null);
    assert.ok(new SliceResourceError('X', 'y', 400) instanceof Error);
});
