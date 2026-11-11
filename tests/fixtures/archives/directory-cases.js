'use strict';

/**
 * Crafted ZIP containers whose end-of-central-directory metadata a strict
 * reader and Python's `zipfile` can read differently (3.9.0 §2.5,
 * `ARCHIVE_UNREADABLE`). Built byte by byte at test time (stored entries,
 * no compression), so no hostile binary is committed and every offset is
 * under the test's control.
 */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    return b;
}

function u32(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0);
    return b;
}

function u64(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(value));
    return b;
}

function localHeader(name, data, { localName, localSize } = {}) {
    const nameBytes = Buffer.from(localName ?? name, 'utf8');
    const size = localSize ?? data.length;
    return Buffer.concat([
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc32(data)), u32(size), u32(size), u16(nameBytes.length), u16(0), nameBytes
    ]);
}

function centralRecord(name, data, offset) {
    const nameBytes = Buffer.from(name, 'utf8');
    return Buffer.concat([
        u32(0x02014b50), u16(0x031e), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc32(data)), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32((0o100644 << 16) >>> 0), u32(offset), nameBytes
    ]);
}

function classicEocd({ count, size, offset, comment }) {
    return Buffer.concat([
        u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(size), u32(offset),
        u16(comment.length), comment
    ]);
}

function zip64Eocd({ count, size, offset }) {
    return Buffer.concat([
        u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
        u64(count), u64(count), u64(size), u64(offset)
    ]);
}

function zip64Locator(recordOffset) {
    return Buffer.concat([u32(0x07064b50), u32(0), u64(recordOffset), u32(1)]);
}

/**
 * Build a stored ZIP.
 * @param {Array<{name: string, data: string|Buffer, localName?: string, localSize?: number, hidden?: boolean}>} entries
 *   Entries in order. A `hidden` entry gets a local header and a central
 *   record but is not counted in the end record.
 * @param {object} [options] Layout options.
 * @param {string|Buffer} [options.prepend] Bytes before the first local header (offsets stay archive-relative unless `shiftOffsets`).
 * @param {boolean} [options.shiftOffsets] Write offsets relative to the file start, prepend included (a self-extractor's layout).
 * @param {string|Buffer} [options.comment] Archive comment.
 * @param {string|Buffer} [options.trailing] Bytes after the end record (not declared as comment).
 * @param {'none'|'zip64'} [options.format] End record layout.
 * @param {number} [options.classicCount] Count written in the classic end record (default: visible entries, or 0xFFFF with ZIP64).
 * @param {number} [options.zip64Count] Count in the ZIP64 record (default: visible entries).
 * @param {number} [options.cdSizeDelta] Added to the declared central-directory size.
 * @param {number} [options.cdOffsetDelta] Added to the declared central-directory offset.
 * @param {number} [options.zip64Gap] Bytes inserted between the ZIP64 record and its locator.
 * @param {Buffer} [options.decoyDirectory] Bytes placed between the real directory and the end record.
 * @returns {Buffer} Archive bytes.
 */
function buildZip(entries, options = {}) {
    const prepend = Buffer.from(options.prepend ?? '');
    const base = options.shiftOffsets ? prepend.length : 0;
    const locals = [];
    const centrals = [];
    let cursor = 0;
    let visible = 0;
    for (const entry of entries) {
        const data = Buffer.from(entry.data);
        const header = localHeader(entry.name, data, entry);
        centrals.push(centralRecord(entry.name, data, base + cursor));
        locals.push(header, data);
        cursor += header.length + data.length;
        if (!entry.hidden) visible += 1;
    }
    const directory = Buffer.concat(centrals);
    const decoy = options.decoyDirectory ?? Buffer.alloc(0);
    const cdOffset = base + cursor + (options.cdOffsetDelta ?? 0);
    const cdSize = directory.length + (options.cdSizeDelta ?? 0);
    const comment = Buffer.from(options.comment ?? '');
    const parts = [prepend, ...locals, directory, decoy];
    if (options.format === 'zip64') {
        const recordOffset = base + cursor + directory.length + decoy.length;
        parts.push(zip64Eocd({ count: options.zip64Count ?? visible, size: cdSize, offset: cdOffset }));
        parts.push(Buffer.alloc(options.zip64Gap ?? 0));
        parts.push(zip64Locator(recordOffset));
        parts.push(classicEocd({ count: options.classicCount ?? 0xffff, size: 0xffffffff, offset: 0xffffffff, comment }));
    } else {
        parts.push(classicEocd({ count: options.classicCount ?? visible, size: cdSize, offset: cdOffset, comment }));
    }
    parts.push(Buffer.from(options.trailing ?? ''));
    return Buffer.concat(parts);
}

/**
 * Two central directories: the end record's offset names the first (read by
 * a reader that trusts the offset), its size names the second, which ends
 * at the end record (read by a reader that locates the directory as
 * end-record position − size, as Python's `zipfile` does, shifting every
 * local offset by the difference).
 * @param {Array<{name: string, data: string|Buffer}>} offsetEntries Entries of the directory the offset names.
 * @param {Array<{name: string, data: string|Buffer}>} sizeEntries Entries of the directory the size names (same count).
 * @returns {Buffer} Archive bytes.
 */
function twoDirectoryZip(offsetEntries, sizeEntries) {
    if (offsetEntries.length !== sizeEntries.length) throw new Error('both directories need the same count');
    const locals = [];
    const offsets = [];
    let cursor = 0;
    for (const entry of [...offsetEntries, ...sizeEntries]) {
        const data = Buffer.from(entry.data);
        const header = localHeader(entry.name, data);
        offsets.push(cursor);
        locals.push(header, data);
        cursor += header.length + data.length;
    }
    const first = Buffer.concat(offsetEntries.map((entry, i) => centralRecord(entry.name, Buffer.from(entry.data), offsets[i])));
    const shift = first.length;
    const second = Buffer.concat(sizeEntries.map((entry, i) => centralRecord(entry.name, Buffer.from(entry.data),
        offsets[offsetEntries.length + i] - shift)));
    return Buffer.concat([
        ...locals, first, second,
        classicEocd({ count: offsetEntries.length, size: second.length, offset: cursor, comment: Buffer.alloc(0) })
    ]);
}

/**
 * An archive whose comment is a coherent copy of its own end record (count,
 * size and offset, comment length 0), so the last end-record signature in
 * the file is the copy. Both yauzl and Python select the copy.
 */
function eocdInComment(entries) {
    const plain = buildZip(entries);
    const real = plain.subarray(plain.length - EOCD_BYTES);
    return buildZip(entries, { comment: Buffer.from(real) });
}

const EOCD_BYTES = 22;
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const TETRA = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices>'
    + '<triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh>';

function model(resources, build) {
    return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${CORE_NS}" xmlns:p="${PROD_NS}">`
        + `<resources>${resources}</resources><build>${build}</build></model>`;
}

/** A valid one-tetrahedron package. */
function packageEntries() {
    return [
        { name: '[Content_Types].xml', data: CONTENT_TYPES },
        { name: '_rels/.rels', data: RELS },
        { name: '3D/3dmodel.model', data: model(`<object id="1" type="model">${TETRA}</object>`, '<item objectid="1"/>') }
    ];
}

/**
 * The root model references a production part by `p:path`; that part is the
 * last central record and is left out of the end record's count.
 */
function hiddenPartEntries() {
    const root = model('<object id="1" type="model"><components><component objectid="7" p:path="/3D/Objects/hidden.model"/></components></object>',
        '<item objectid="1"/>');
    return [
        { name: '[Content_Types].xml', data: CONTENT_TYPES },
        { name: '_rels/.rels', data: RELS },
        { name: '3D/3dmodel.model', data: root },
        { name: '3D/Objects/hidden.model', data: model(`<object id="7" type="model">${TETRA}</object>`, ''), hidden: true }
    ];
}

/**
 * Every directory case: `refused` is what the strict inspection must answer
 * (`true` = 400 `INVALID_SOURCE_ARCHIVE`, `archive_rule: ARCHIVE_UNREADABLE`;
 * `'yauzl'` = yauzl's own open error, unlabelled, as in 3.8.3).
 * @returns {Array<{name: string, refused: boolean|'yauzl', bytes: Buffer}>}
 */
function directoryCases() {
    const pkg = packageEntries();
    const lastLocal = pkg.slice(0, 2).concat({ ...pkg[2] });
    return [
        { name: 'clean', refused: false, bytes: buildZip(pkg) },
        { name: 'clean-with-comment', refused: false, bytes: buildZip(pkg, { comment: 'made by a tool, PK in text' }) },
        { name: 'clean-zip64', refused: false, bytes: buildZip(pkg, { format: 'zip64' }) },
        { name: 'clean-zip64-with-comment', refused: false, bytes: buildZip(pkg, { format: 'zip64', comment: 'zip64 comment' }) },
        { name: 'clean-zip64-classic-count-kept', refused: false, bytes: buildZip(pkg, { format: 'zip64', classicCount: 3 }) },
        { name: 'hidden-record-past-count', refused: true, bytes: buildZip(hiddenPartEntries()) },
        { name: 'hidden-record-past-count-zip64', refused: true, bytes: buildZip(hiddenPartEntries(), { format: 'zip64' }) },
        { name: 'directory-size-short', refused: true, bytes: buildZip(pkg, { cdSizeDelta: -46 }) },
        {
            name: 'directory-offset-shifted', refused: true,
            bytes: buildZip(pkg, { prepend: Buffer.alloc(64, 0x20), cdOffsetDelta: 0 })
        },
        { name: 'prepended-self-extractor-layout', refused: false, bytes: buildZip(pkg, { prepend: Buffer.alloc(64, 0x20), shiftOffsets: true }) },
        { name: 'gap-before-end-record', refused: true, bytes: buildZip(pkg, { decoyDirectory: Buffer.alloc(46, 0) }) },
        {
            name: 'two-directories-offset-vs-size', refused: true,
            bytes: twoDirectoryZip(pkg, pkg.slice(0, 2).concat({
                name: '3D/3dmodel.model',
                data: model(`<object id="1" type="model">${TETRA.replace('x="10"', 'x="9000"')}</object>`, '<item objectid="1"/>')
            }))
        },
        { name: 'zip64-count-disagrees', refused: true, bytes: buildZip(pkg, { format: 'zip64', classicCount: 2 }) },
        { name: 'zip64-record-not-before-locator', refused: true, bytes: buildZip(pkg, { format: 'zip64', zip64Gap: 16 }) },
        // yauzl itself refuses bytes after the end record (unlabelled, as in 3.8.3).
        { name: 'trailing-bytes-after-end', refused: 'yauzl', bytes: buildZip(pkg, { trailing: 'xyz' }) },
        { name: 'eocd-signature-in-comment', refused: true, bytes: eocdInComment(pkg) },
        {
            // Not a differential: both readers locate the data by the local
            // header's own name/extra lengths and read the central sizes;
            // Python then refuses the name mismatch (BadZipFile), yauzl
            // ignores the local name. Left as 3.8.3 answers it.
            name: 'local-name-differs', refused: false,
            bytes: buildZip(lastLocal.map((entry, index) => (index === 2 ? { ...entry, localName: '3D/3dmodel.mode1' } : entry)))
        },
        {
            name: 'local-size-differs-bit3-clear', refused: false,
            bytes: buildZip(lastLocal.map((entry, index) => (index === 2 ? { ...entry, localSize: 5 } : entry)))
        }
    ];
}

module.exports = { buildZip, twoDirectoryZip, directoryCases, crc32 };
