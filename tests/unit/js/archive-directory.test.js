'use strict';

// 3.9.0 §2.5 / §4.4: the end record and the central directory must agree,
// so yauzl (the Node inspection) and Python's `zipfile` (the converter, the
// scope inspector) cannot read different parts from one archive.

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectThreeMfPackage } = require('../../../app/services/slice/three-mf');
const { inspectZipFile, extractFirstSupportedFromZip } = require('../../../app/services/slice/zip');
const { assertCentralDirectoryConsistent } = require('../../../app/services/slice/zip-directory');
const { createArchivePreflight } = require('../../../app/services/slice/archive-preflight');
const { handleProcessingError } = require('../../../app/services/slice/errors');
const { buildZip, directoryCases } = require('../../fixtures/archives/directory-cases');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'archives');
const UNREADABLE = { code: 'INVALID_SOURCE_ARCHIVE', status: 400, archiveRule: 'ARCHIVE_UNREADABLE' };

async function tempDir(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-directory-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

for (const archiveCase of directoryCases()) {
    test(`3MF directory case ${archiveCase.name}: ${archiveCase.refused === true ? 'ARCHIVE_UNREADABLE' : archiveCase.refused || 'admitted'}`, async (t) => {
        const file = path.join(await tempDir(t), `${archiveCase.name}.3mf`);
        await fsp.writeFile(file, archiveCase.bytes);
        const inspection = inspectThreeMfPackage(file, { ignoreVerdict: true });
        if (archiveCase.refused === true) {
            await assert.rejects(inspection, UNREADABLE);
        } else if (archiveCase.refused === 'yauzl') {
            // yauzl's own open error, unlabelled: answered from the job as in 3.8.3.
            await assert.rejects(inspection, (error) => error.archiveRule === undefined && /comment length/i.test(error.message));
        } else {
            const result = await inspection;
            assert.equal(result.summary.entries, 3);
            assert.equal(result.expansion.triangles, 4);
        }
    });
}

test('the hidden record names a part the root model references: refused before the expansion scan', async (t) => {
    const hidden = directoryCases().find((c) => c.name === 'hidden-record-past-count');
    const file = path.join(await tempDir(t), 'hidden.3mf');
    await fsp.writeFile(file, hidden.bytes);
    const error = await inspectThreeMfPackage(file, { ignoreVerdict: true }).then(() => null, (failure) => failure);
    assert.ok(error, 'refused');
    const res = {
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
    handleProcessingError(error, res, null, null, () => '.stl, .3mf');
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.errorCode, 'INVALID_SOURCE_ARCHIVE');
    assert.equal(res.body.archive_rule, 'ARCHIVE_UNREADABLE');
});

test('the pre-queue preflight answers a hidden record synchronously as ARCHIVE_UNREADABLE', async (t) => {
    const root = await tempDir(t);
    const instance = createArchivePreflight({ maxWaiting: 4 });
    t.after(() => instance.close());
    const cases = directoryCases();
    const hidden = path.join(root, 'upload-hidden');
    await fsp.writeFile(hidden, cases.find((c) => c.name === 'hidden-record-past-count').bytes);
    await assert.rejects(instance.run(hidden), UNREADABLE);
    const twoDirectories = path.join(root, 'upload-two');
    await fsp.writeFile(twoDirectories, cases.find((c) => c.name === 'two-directories-offset-vs-size').bytes);
    await assert.rejects(instance.run(twoDirectories), UNREADABLE);
    const clean = path.join(root, 'upload-clean');
    await fsp.writeFile(clean, cases.find((c) => c.name === 'clean-zip64-with-comment').bytes);
    assert.equal((await instance.run(clean)).admitted, true);
});

test('ZIP upload: a record hidden past the count is refused, the same ZIP without it is extracted', async (t) => {
    const root = await tempDir(t);
    const workspace = {
        resolvePath: (...segments) => path.join(root, ...segments),
        assertContainedPath: (candidate) => path.resolve(candidate)
    };
    const visible = { name: 'part.stl', data: 'solid a\nendsolid a\n' };
    const hidden = { name: 'other.stl', data: 'solid b\nendsolid b\n', hidden: true };
    const bad = path.join(root, 'hidden.zip');
    await fsp.writeFile(bad, buildZip([visible, hidden]));
    await assert.rejects(inspectZipFile(bad, new Set(['.stl'])), UNREADABLE);
    await assert.rejects(extractFirstSupportedFromZip(bad, workspace), UNREADABLE);
    for (const [name, options] of [['plain.zip', {}], ['comment.zip', { comment: 'archiver comment' }], ['zip64.zip', { format: 'zip64' }]]) {
        const good = path.join(root, name);
        await fsp.writeFile(good, buildZip([visible], options));
        const extracted = await extractFirstSupportedFromZip(good, workspace);
        assert.equal(await fsp.readFile(extracted, 'utf8'), visible.data, name);
    }
});

test("Bambu's own output (.gcode.3mf, read back by bambu-artifact.js) passes the directory check", async () => {
    await assertCentralDirectoryConsistent(path.join(FIXTURES, 'control-cube.gcode.3mf'));
});
