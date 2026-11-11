'use strict';

/**
 * Crafted 3MF archives, one or more per `archive_rule` of the 3.9.0
 * specification §2.5, built at test time so no hostile binary is committed.
 * `baseline-3.8.3.json` records what the unmodified 3.8.3 Node checks
 * answered for each case (status and errorCode, or `admitted`); T-ARC-1
 * asserts that 3.9.0 keeps every pre-existing answer and adds the rule label.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { ZipArchive } = require('archiver');

const MiB = 1024 * 1024;

async function makeArchive(target, entries) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' });
        const archive = new ZipArchive({ zlib: { level: 9 } });
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

/**
 * Patch the local and central records of one entry in place.
 * @param {string} target Archive path.
 * @param {string} entryName Entry name as written.
 * @param {(payload: Buffer, record: {offset: number, local: boolean, nameOffset: number, nameLength: number}) => void} patcher Mutation.
 */
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
    if (patched !== 2) throw new Error(`expected local and central records for ${entryName}, patched ${patched}`);
    await fsp.writeFile(target, payload);
}

async function renameZipEntry(target, oldName, newName) {
    if (Buffer.byteLength(oldName) !== Buffer.byteLength(newName)) throw new Error('rename must keep the byte length');
    await patchZipEntry(target, oldName, (payload, record) => {
        payload.write(newName, record.nameOffset, record.nameLength, 'latin1');
    });
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

/** One closed tetrahedron object (4 vertices, 4 triangles). */
function tetrahedronObject(id) {
    return `<object id="${id}" type="model"><mesh><vertices>`
        + '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>'
        + '</vertices><triangles>'
        + '<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/>'
        + '</triangles></mesh></object>';
}

function modelXml(resources, build) {
    return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:p="${PROD_NS}">`
        + `<resources>${resources}</resources><build>${build}</build></model>`;
}

/** A small valid single-object 3MF (one tetrahedron, one build item). */
function tetrahedronThreeMf(extra = []) {
    return [
        { name: '[Content_Types].xml', data: CONTENT_TYPES },
        { name: '_rels/.rels', data: RELS },
        { name: '3D/3dmodel.model', data: modelXml(tetrahedronObject(1), '<item objectid="1"/>') },
        ...extra
    ];
}

/**
 * The 2 KB fan-out bomb: object k has ten components that reference object
 * k+1 for 16 levels, the last object is one tetrahedron. The build therefore
 * expands to 4 × 10^16 triangles while the file stays tiny.
 */
function fanOutModel(levels = 16, fanOut = 10) {
    let resources = tetrahedronObject(levels + 1);
    for (let level = levels; level >= 1; level -= 1) {
        const refs = Array.from({ length: fanOut }, () => `<component objectid="${level + 1}"/>`).join('');
        resources += `<object id="${level}" type="model"><components>${refs}</components></object>`;
    }
    return modelXml(resources, '<item objectid="1"/>');
}

/** A cycle: object 1 references itself `fanOut` times. */
function cycleModel(fanOut) {
    const refs = Array.from({ length: fanOut }, () => '<component objectid="1"/>').join('');
    return modelXml(`<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh><components>${refs}</components></object>`,
        '<item objectid="1"/>');
}

function withModel(model, extra = []) {
    return [
        { name: '[Content_Types].xml', data: CONTENT_TYPES },
        { name: '_rels/.rels', data: RELS },
        { name: '3D/3dmodel.model', data: model },
        ...extra
    ];
}

/**
 * Every crafted case. `policy` is a resource-policy override applied on top
 * of the defaults (the test-time stand-in for a smaller envelope).
 * @returns {Array<{name: string, rule: string|null, entries: object[], patch?: (file: string) => Promise<void>, policy?: object, raw?: Buffer}>}
 */
function archiveCases() {
    return [
        { name: 'valid-tetrahedron', rule: null, entries: tetrahedronThreeMf() },
        { name: 'unreadable-missing-part', rule: 'ARCHIVE_UNREADABLE', entries: tetrahedronThreeMf().slice(0, 2) },
        { name: 'unreadable-not-a-zip', rule: 'ARCHIVE_UNREADABLE', raw: Buffer.from('this is not a zip archive at all, only text\n'.repeat(4)) },
        {
            name: 'encrypted-entry', rule: 'ARCHIVE_ENCRYPTED',
            entries: tetrahedronThreeMf([{ name: '3D/extra.model', data: '<x />' }]),
            patch: (target) => patchZipEntry(target, '3D/extra.model', (payload, record) => {
                const flagOffset = record.offset + (record.local ? 6 : 8);
                payload.writeUInt16LE(payload.readUInt16LE(flagOffset) | 0x1, flagOffset);
            })
        },
        {
            name: 'unsafe-dotdot', rule: 'ARCHIVE_UNSAFE_PATH',
            entries: tetrahedronThreeMf([{ name: '3D/zz/extra.xml', data: '<x />' }]),
            patch: (target) => renameZipEntry(target, '3D/zz/extra.xml', '3D/../extra.xml')
        },
        {
            name: 'backslash-normalised-by-yauzl', rule: null,
            entries: tetrahedronThreeMf([{ name: '3D/zz/extra.xml', data: '<x />' }]),
            patch: (target) => renameZipEntry(target, '3D/zz/extra.xml', '3D\\zz\\extra.xml')
        },
        {
            name: 'unsafe-dot-segment', rule: 'ARCHIVE_UNSAFE_PATH',
            entries: tetrahedronThreeMf([{ name: '3D/x/extra.model', data: '<x />' }]),
            patch: (target) => renameZipEntry(target, '3D/x/extra.model', '3D/./extra.model')
        },
        {
            name: 'unsafe-nul', rule: 'ARCHIVE_UNSAFE_PATH',
            entries: tetrahedronThreeMf([{ name: '3D/xx.model', data: '<x />' }]),
            patch: (target) => renameZipEntry(target, '3D/xx.model', '3D/x\u0000.model')
        },
        {
            name: 'unsafe-case-duplicate', rule: 'ARCHIVE_UNSAFE_PATH',
            entries: tetrahedronThreeMf([{ name: '3D/extra.model', data: '<one />' }, { name: '3D/EXTRA.model', data: '<two />' }])
        },
        { name: 'unsafe-directory', rule: 'ARCHIVE_UNSAFE_PATH', entries: tetrahedronThreeMf([{ name: '3D/folder/', data: '' }]) },
        { name: 'unsafe-symlink', rule: 'ARCHIVE_UNSAFE_PATH', entries: tetrahedronThreeMf([{ name: '3D/link.model', symlinkTarget: '3dmodel.model' }]) },
        { name: 'unsafe-depth', rule: 'ARCHIVE_UNSAFE_PATH', entries: tetrahedronThreeMf([{ name: '3D/deep/a/b/c/model.model', data: '<x />' }]) },
        { name: 'nested-3mf', rule: 'ARCHIVE_NESTED', entries: tetrahedronThreeMf([{ name: '3D/inner.3mf', data: 'PK' }]) },
        { name: 'nested-zip', rule: 'ARCHIVE_NESTED', entries: tetrahedronThreeMf([{ name: 'Metadata/inner.zip', data: 'PK' }]) },
        { name: 'disallowed-extension', rule: 'ARCHIVE_DISALLOWED_PART', entries: tetrahedronThreeMf([{ name: '3D/payload.exe', data: 'x' }]) },
        { name: 'disallowed-root', rule: 'ARCHIVE_DISALLOWED_PART', entries: tetrahedronThreeMf([{ name: 'Other/a.xml', data: '<x />' }]) },
        { name: 'too-many-entries', rule: 'ARCHIVE_TOO_MANY_ENTRIES', entries: tetrahedronThreeMf(), policy: { MAX_ZIP_ENTRIES: 2 } },
        {
            name: 'too-large-entry', rule: 'ARCHIVE_TOO_LARGE',
            entries: tetrahedronThreeMf([{ name: 'Metadata/big.txt', data: Buffer.alloc(4096, 0x41), store: true }]),
            policy: { MAX_ZIP_ENTRY_BYTES: 2048 }
        },
        {
            name: 'too-large-total', rule: 'ARCHIVE_TOO_LARGE',
            entries: tetrahedronThreeMf([{ name: 'Metadata/big.txt', data: Buffer.alloc(4096, 0x41), store: true }]),
            policy: { MAX_ZIP_UNCOMPRESSED_BYTES: 3000 }
        },
        {
            name: 'ratio-exceeded', rule: 'ARCHIVE_RATIO_EXCEEDED',
            entries: tetrahedronThreeMf([{ name: 'Metadata/bomb.txt', data: Buffer.alloc(MiB, 0x41) }])
        },
        { name: 'expansion-fanout-1e16', rule: 'ARCHIVE_EXPANSION_EXCEEDED', entries: withModel(fanOutModel()) },
        { name: 'expansion-cycle-fanout-10', rule: 'ARCHIVE_EXPANSION_EXCEEDED', entries: withModel(cycleModel(10)) },
        { name: 'cycle-fanout-1-left-to-python', rule: null, entries: withModel(cycleModel(1)) }
    ];
}

/**
 * Write one case to `directory/<name>.3mf`.
 * @returns {Promise<string>} Archive path.
 */
async function writeArchiveCase(directory, entry) {
    const target = path.join(directory, `${entry.name}.3mf`);
    if (entry.raw) {
        await fsp.writeFile(target, entry.raw, { flag: 'wx' });
    } else {
        await makeArchive(target, entry.entries);
        await entry.patch?.(target);
    }
    return target;
}

module.exports = {
    CONTENT_TYPES,
    RELS,
    archiveCases,
    cycleModel,
    fanOutModel,
    makeArchive,
    modelXml,
    patchZipEntry,
    renameZipEntry,
    tetrahedronObject,
    tetrahedronThreeMf,
    withModel,
    writeArchiveCase
};
