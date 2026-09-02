'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ZipArchive } = require('archiver');
const { inspectZipFile, isIgnorableZipEntry } = require('../../../app/services/slice/zip');
const { inspectThreeMfArchive, isAllowedThreeMfPart } = require('../../../app/services/slice/three-mf');

async function makeArchive(target, entries) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' });
        const archive = new ZipArchive({ zlib: { level: 9 } });
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
        archive.pipe(output);
        for (const entry of entries) {
            if (entry.directory) archive.append(null, { name: entry.name });
            else archive.append(entry.data, { name: entry.name, store: entry.store === true });
        }
        archive.finalize();
    });
}

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'archive-junk-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

const minimalThreeMf = () => [
    { name: '[Content_Types].xml', data: '<Types />', store: true },
    { name: '_rels/.rels', data: '<Relationships />', store: true },
    { name: '3D/3dmodel.model', data: '<model />', store: true }
];

test('junk classification covers macOS, Windows, and directory entries only', () => {
    for (const junk of ['__MACOSX/._model.stl', '__macosx/x', '.DS_Store', 'Thumbs.db', 'desktop.ini', 'THUMBS.DB', 'folder/', '._model.stl']) {
        assert.equal(isIgnorableZipEntry(junk), true, junk);
    }
    for (const real of ['model.stl', 'part.3MF', 'MODEL.obj', 'readme.txt', 'x.DS_Store']) {
        assert.equal(isIgnorableZipEntry(real), false, real);
    }
});

test('outer ZIPs tolerate __MACOSX, .DS_Store, Thumbs.db, desktop.ini, and directories around exactly one model', async (t) => {
    const root = await fixture(t);
    const tolerated = path.join(root, 'finder.zip');
    await makeArchive(tolerated, [
        { name: 'models/', directory: true },
        { name: '__MACOSX/', directory: true },
        { name: '__MACOSX/._model.stl', data: Buffer.from([0, 5, 22, 7]), store: true },
        { name: '.DS_Store', data: Buffer.alloc(16, 0), store: true },
        { name: 'Thumbs.db', data: Buffer.alloc(8, 1), store: true },
        { name: 'desktop.ini', data: '[.ShellClassInfo]\n', store: true },
        { name: 'model.stl', data: 'solid tolerated', store: true }
    ]);
    const candidates = await inspectZipFile(tolerated, new Set(['.stl']));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].fileName, 'model.stl');
});

test('junk never satisfies or hides the exactly-one-supported-model rule', async (t) => {
    const root = await fixture(t);
    const onlyJunk = path.join(root, 'only-junk.zip');
    await makeArchive(onlyJunk, [
        { name: '__MACOSX/._model.stl', data: 'x', store: true },
        { name: '.DS_Store', data: 'x', store: true }
    ]);
    await assert.rejects(inspectZipFile(onlyJunk, new Set(['.stl'])), /exactly one supported source file/);

    const twoModels = path.join(root, 'two.zip');
    await makeArchive(twoModels, [
        { name: '.DS_Store', data: 'x', store: true },
        { name: 'one.stl', data: 'one', store: true },
        { name: 'two.stl', data: 'two', store: true }
    ]);
    await assert.rejects(inspectZipFile(twoModels, new Set(['.stl'])), /exactly one supported source file/);

    const unsupportedBeside = path.join(root, 'unsupported.zip');
    await makeArchive(unsupportedBeside, [
        { name: 'Thumbs.db', data: 'x', store: true },
        { name: 'model.stl', data: 'solid', store: true },
        { name: 'notes.exe', data: 'x', store: true }
    ]);
    await assert.rejects(inspectZipFile(unsupportedBeside, new Set(['.stl'])), /unsupported file type/);
});

test('3MF roots match case-insensitively and Bambu/Orca project parts are admitted', () => {
    for (const part of [
        '3d/3dmodel.model', '3D/3DMODEL.MODEL', 'metadata/plate_1.gcode', 'Metadata/plate_1.gcode.md5',
        'Metadata/plate_1.png', 'Metadata/project_settings.config', 'Metadata/model_settings.config',
        'Metadata/slice_info.config', 'Metadata/cut_information.xml', 'Metadata/plate_1.json',
        'Metadata/note.txt', 'Auxiliaries/readme.txt', 'AUXILIARIES/thumb.png', 'Textures/wood.jpg'
    ]) {
        assert.equal(isAllowedThreeMfPart(part), true, part);
    }
    for (const part of [
        '3D/plate_1.gcode', '3D/payload.exe', 'Metadata/payload.exe', 'Metadata/run.sh',
        'Textures/notes.txt', 'Other/model.model', 'plate_1.gcode'
    ]) {
        assert.equal(isAllowedThreeMfPart(part), false, part);
    }
});

test('a Bambu Studio style 3MF with lowercase roots and project metadata inspects cleanly', async (t) => {
    const root = await fixture(t);
    const project = path.join(root, 'bambu-project.3mf');
    await makeArchive(project, [
        ...minimalThreeMf().map((entry, index) => index === 2 ? { ...entry, name: '3d/3dmodel.model' } : entry),
        { name: 'Metadata/plate_1.gcode', data: ';plate gcode\n', store: true },
        { name: 'Metadata/plate_1.gcode.md5', data: 'd41d8cd98f00b204e9800998ecf8427e', store: true },
        { name: 'Metadata/plate_1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), store: true },
        { name: 'Metadata/project_settings.config', data: '{}', store: true },
        { name: 'Metadata/slice_info.config', data: '<config />', store: true },
        { name: 'Metadata/cut_information.xml', data: '<cut />', store: true },
        { name: 'Auxiliaries/_Legacy/notes.txt', data: 'notes', store: true }
    ]);
    const summary = await inspectThreeMfArchive(project);
    assert.equal(summary.entries, 10);

    const duplicateAcrossCase = path.join(root, 'duplicate.3mf');
    await makeArchive(duplicateAcrossCase, [
        ...minimalThreeMf(),
        { name: '3d/3dmodel.model', data: '<again />', store: true }
    ]);
    await assert.rejects(inspectThreeMfArchive(duplicateAcrossCase), { code: 'INVALID_SOURCE_ARCHIVE' });
});
