'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const archiver = require('archiver');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { inspectZipFile, extractZipEntry } = require('../../../app/services/slice/zip');
const { inspectThreeMfArchive } = require('../../../app/services/slice/three-mf');
const { parseSl1Stats } = require('../../../app/services/slice/sl1-stats');
const { writeFully } = require('../../../app/services/slice/zip-stream');

async function makeArchive(target, entries) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' });
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
        archive.pipe(output);
        for (const entry of entries) {
            if (entry.symlinkTarget) {
                archive.symlink(entry.name, entry.symlinkTarget);
            } else {
                archive.append(entry.data, {
                    name: entry.name,
                    store: entry.store === true,
                    ...(entry.mode ? { mode: entry.mode } : {})
                });
            }
        }
        archive.finalize();
    });
}

async function patchZipEntry(target, entryName, patcher) {
    const payload = await fsp.readFile(target);
    let patched = 0;
    for (let offset = 0; offset <= payload.length - 46; offset += 1) {
        const signature = payload.readUInt32LE(offset);
        const local = signature === 0x04034b50;
        const central = signature === 0x02014b50;
        if (!local && !central) continue;
        const nameLength = payload.readUInt16LE(offset + (local ? 26 : 28));
        const nameOffset = offset + (local ? 30 : 46);
        const name = payload.subarray(nameOffset, nameOffset + nameLength).toString('utf8');
        if (name !== entryName) continue;
        patcher(payload, { offset, local, nameOffset, nameLength });
        patched += 1;
    }
    assert.equal(patched, 2, `local and central records for ${entryName}`);
    await fsp.writeFile(target, payload);
}

async function renameZipEntry(target, oldName, newName) {
    assert.equal(Buffer.byteLength(oldName), Buffer.byteLength(newName));
    await patchZipEntry(target, oldName, (payload, record) => {
        payload.write(newName, record.nameOffset, record.nameLength, 'utf8');
    });
}

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'i4-archive-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

const minimalThreeMf = () => [
    { name: '[Content_Types].xml', data: '<Types />', store: true },
    { name: '_rels/.rels', data: '<Relationships />', store: true },
    { name: '3D/3dmodel.model', data: '<model />', store: true }
];

test('generated ZIP inspection and extraction accept exactly one bounded flat model', async (t) => {
    const root = await fixture(t);
    const source = path.join(root, 'model.zip');
    const destination = path.join(root, 'model.stl');
    await makeArchive(source, [{ name: 'model.stl', data: 'solid bounded', store: true }]);
    const [entry] = await inspectZipFile(source, new Set(['.stl']));
    assert.equal(entry.fileName, 'model.stl');
    assert.equal(await extractZipEntry(source, entry, destination), destination);
    assert.equal(await fsp.readFile(destination, 'utf8'), 'solid bounded');
});

test('generated ZIPs reject paths, unsupported/multiple entries, and compression bombs', async (t) => {
    const root = await fixture(t);
    const scenarios = [
        [{ name: 'nested/model.stl', data: 'solid' }],
        [{ name: 'model.exe', data: 'solid' }],
        [{ name: 'one.stl', data: 'one' }, { name: 'two.stl', data: 'two' }],
        [{ name: 'bomb.stl', data: Buffer.alloc(1024 * 1024, 0x41) }]
    ];
    for (let index = 0; index < scenarios.length; index += 1) {
        const source = path.join(root, `${index}.zip`);
        await makeArchive(source, scenarios[index]);
        await assert.rejects(inspectZipFile(source, new Set(['.stl'])));
    }
});

test('3MF inspection streams mandatory parts and rejects path, type, count, and ratio attacks', async (t) => {
    const root = await fixture(t);
    const valid = path.join(root, 'valid.3mf');
    await makeArchive(valid, minimalThreeMf());
    assert.deepEqual(await inspectThreeMfArchive(valid), {
        entries: 3,
        declaredBytes: 35,
        actualBytes: 35
    });

    const cases = [
        [...minimalThreeMf(), { name: '../escape.xml', data: '<x />' }],
        [...minimalThreeMf(), { name: '3D/payload.exe', data: 'x' }],
        [...minimalThreeMf(), { name: '3D/deep/a/b/c/model.model', data: '<x />' }],
        minimalThreeMf().map((entry, index) => index === 2
            ? { ...entry, data: Buffer.alloc(1024 * 1024, 0x41), store: false }
            : entry)
    ];
    for (let index = 0; index < cases.length; index += 1) {
        const candidate = path.join(root, `invalid-${index}.3mf`);
        await makeArchive(candidate, cases[index]);
        await assert.rejects(inspectThreeMfArchive(candidate));
    }

    const countLimited = path.join(root, 'count.3mf');
    await makeArchive(countLimited, minimalThreeMf());
    await assert.rejects(inspectThreeMfArchive(countLimited, {
        resourcePolicy: { ...resolveResourcePolicy({}), MAX_ZIP_ENTRIES: 2 }
    }), { code: 'SLICE_RESOURCE_LIMIT_EXCEEDED' });
});

test('3MF package controls reject canonical duplicates, special types, encryption, and missing parts', async (t) => {
    const root = await fixture(t);
    const scenarios = [
        {
            name: 'case-duplicate',
            entries: [
                ...minimalThreeMf(),
                { name: '3D/extra.model', data: '<one />' },
                { name: '3D/EXTRA.model', data: '<two />' }
            ]
        },
        {
            name: 'normalized-duplicate',
            entries: [
                ...minimalThreeMf(),
                { name: '3D/x/extra.model', data: '<one />' },
                { name: '3D/extra.model', data: '<two />' }
            ],
            patch: (target) => renameZipEntry(target, '3D/x/extra.model', '3D/./extra.model')
        },
        {
            name: 'symlink',
            entries: [
                ...minimalThreeMf(),
                { name: '3D/link.model', symlinkTarget: '3dmodel.model' }
            ]
        },
        {
            name: 'directory',
            entries: [...minimalThreeMf(), { name: '3D/folder/', data: '' }]
        },
        {
            name: 'encrypted',
            entries: [...minimalThreeMf(), { name: '3D/extra.model', data: '<x />' }],
            patch: (target) => patchZipEntry(target, '3D/extra.model', (payload, record) => {
                const flagOffset = record.offset + (record.local ? 6 : 8);
                payload.writeUInt16LE(payload.readUInt16LE(flagOffset) | 0x1, flagOffset);
            })
        },
        {
            name: 'missing-required',
            entries: minimalThreeMf().slice(0, 2)
        }
    ];

    for (const scenario of scenarios) {
        const candidate = path.join(root, `${scenario.name}.3mf`);
        await makeArchive(candidate, scenario.entries);
        await scenario.patch?.(candidate);
        await assert.rejects(inspectThreeMfArchive(candidate), {
            code: 'INVALID_SOURCE_ARCHIVE'
        });
        const moved = `${candidate}.settled`;
        await fsp.rename(candidate, moved);
        await fsp.rename(moved, candidate);
    }
});

test('SL1 config.ini metadata is read from a generated archive', async (t) => {
    const root = await fixture(t);
    const sl1 = path.join(root, 'model.sl1');
    await makeArchive(sl1, [
        { name: 'config.ini', data: 'printTime=120\nusedMaterial=4.25\n', store: true },
        { name: '0.png', data: Buffer.from([1, 2, 3]), store: true }
    ]);
    assert.deepEqual(await parseSl1Stats(sl1), {
        print_time_seconds: 120,
        material_used_ml: 4.25
    });
});

test('writeFully survives short writes and rejects zero progress', async () => {
    const written = [];
    await writeFully({
        async write(chunk, offset, length) {
            const bytesWritten = Math.min(2, length);
            written.push(chunk.subarray(offset, offset + bytesWritten));
            return { bytesWritten };
        }
    }, Buffer.from('abcdef'));
    assert.equal(Buffer.concat(written).toString(), 'abcdef');
    await assert.rejects(writeFully({ async write() { return { bytesWritten: 0 }; } }, Buffer.from('x')), {
        code: 'INVALID_SOURCE_ARCHIVE'
    });
});
