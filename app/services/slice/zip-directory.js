'use strict';

/**
 * Structural agreement of a ZIP's end record and its central directory
 * (3.9.0 §2.5, `ARCHIVE_UNREADABLE`).
 *
 * yauzl reads `entryCount` central records from the end record's
 * directory offset and never looks at the declared directory size. Python's
 * `zipfile` (the converter and the scope inspector) locates the directory
 * at end-record position − size, shifts every local offset by the
 * difference, and reads records until `size` bytes are consumed; 3.12 also
 * silently falls back to the classic end record when the ZIP64 record is not
 * directly before its locator. An archive on which these readings differ (a
 * record hidden past the count, a second directory, a misplaced ZIP64
 * record) could carry a part the Node inspection never saw. This check
 * admits only an archive on which they cannot differ:
 *
 * - the end record is the one yauzl chose (the last signature, its comment
 *   running to the end of the file) and names one disk;
 * - with a ZIP64 locator, the ZIP64 record (44 bytes, no extensible data)
 *   ends at the locator, and every classic field is its sentinel or equals
 *   the ZIP64 value;
 * - directory offset + size = the position of the ZIP64 record or, without
 *   one, of the end record;
 * - the directory holds exactly `count` central records whose lengths sum
 *   to `size`, and `count` is yauzl's `entryCount`.
 *
 * It reads only the end records and the directory (in bounded chunks), never
 * an entry, so a large archive does not hold the event loop.
 */

const fs = require('node:fs/promises');
const { invalidArchive, labelArchiveError } = require('./resource-errors');

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_RECORD_SIGNATURE = 0x06064b50;
const ZIP64_RECORD_SIZE = 56;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_FIXED = 46;
const CHUNK_BYTES = 64 * 1024;

function inconsistent(detail) {
    const error = labelArchiveError(invalidArchive('ZIP central directory does not agree with its end record.'), 'ARCHIVE_UNREADABLE');
    error.directoryDetail = detail;
    return error;
}

async function readExactly(handle, length, position) {
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
        const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
        if (bytesRead <= 0) throw inconsistent('short read');
        filled += bytesRead;
    }
    return buffer;
}

function safeU64(buffer, offset) {
    const value = buffer.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw inconsistent('64-bit field out of range');
    return Number(value);
}

/**
 * Read the end records the way yauzl selects them.
 * @param {import('node:fs/promises').FileHandle} handle Open archive.
 * @param {number} fileSize Archive size.
 * @returns {Promise<{count: number, size: number, offset: number, directoryEnd: number}>} Directory geometry.
 */
async function readEndRecords(handle, fileSize) {
    const tailLength = Math.min(fileSize, ZIP64_LOCATOR_SIZE + EOCD_SIZE + MAX_COMMENT);
    const tailStart = fileSize - tailLength;
    const tail = await readExactly(handle, tailLength, tailStart);
    let at = -1;
    for (let i = tailLength - EOCD_SIZE; i >= 0; i -= 1) {
        if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
            at = i;
            break;
        }
    }
    if (at < 0) throw inconsistent('no end record');
    if (tail.readUInt16LE(at + 20) !== tailLength - at - EOCD_SIZE) throw inconsistent('comment does not reach the end');
    const eocdPosition = tailStart + at;
    if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0) throw inconsistent('multi-disk end record');
    const classic = {
        diskCount: tail.readUInt16LE(at + 8),
        count: tail.readUInt16LE(at + 10),
        size: tail.readUInt32LE(at + 12),
        offset: tail.readUInt32LE(at + 16)
    };

    const locatorAt = at - ZIP64_LOCATOR_SIZE;
    if (locatorAt < 0 || tail.readUInt32LE(locatorAt) !== ZIP64_LOCATOR_SIGNATURE) {
        if (classic.diskCount !== classic.count) throw inconsistent('disk count differs from total count');
        if (classic.offset + classic.size !== eocdPosition) throw inconsistent('directory does not end at the end record');
        return { count: classic.count, size: classic.size, offset: classic.offset, directoryEnd: eocdPosition };
    }

    const locatorPosition = eocdPosition - ZIP64_LOCATOR_SIZE;
    if (tail.readUInt32LE(locatorAt + 4) !== 0 || tail.readUInt32LE(locatorAt + 16) > 1) {
        throw inconsistent('multi-disk ZIP64 locator');
    }
    const recordPosition = safeU64(tail, locatorAt + 8);
    if (recordPosition !== locatorPosition - ZIP64_RECORD_SIZE) throw inconsistent('ZIP64 record is not before its locator');
    const record = await readExactly(handle, ZIP64_RECORD_SIZE, recordPosition);
    if (record.readUInt32LE(0) !== ZIP64_RECORD_SIGNATURE) throw inconsistent('ZIP64 record signature');
    if (safeU64(record, 4) !== ZIP64_RECORD_SIZE - 12) throw inconsistent('ZIP64 extensible data');
    if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) throw inconsistent('multi-disk ZIP64 record');
    const zip64 = {
        diskCount: safeU64(record, 24),
        count: safeU64(record, 32),
        size: safeU64(record, 40),
        offset: safeU64(record, 48)
    };
    if (zip64.diskCount !== zip64.count) throw inconsistent('ZIP64 disk count differs from total count');
    const agrees = (classicValue, sentinel, value) => classicValue === sentinel || classicValue === value;
    if (
        !agrees(classic.diskCount, 0xffff, zip64.count)
        || !agrees(classic.count, 0xffff, zip64.count)
        || !agrees(classic.size, 0xffffffff, zip64.size)
        || !agrees(classic.offset, 0xffffffff, zip64.offset)
    ) throw inconsistent('classic end record disagrees with ZIP64');
    if (zip64.offset + zip64.size !== recordPosition) throw inconsistent('directory does not end at the ZIP64 record');
    return { count: zip64.count, size: zip64.size, offset: zip64.offset, directoryEnd: recordPosition };
}

/**
 * Walk the central directory and require exactly `count` records filling
 * exactly `size` bytes.
 */
async function walkDirectory(handle, { count, size, offset }) {
    if (count * CENTRAL_FIXED > size) throw inconsistent('directory too small for its count');
    let buffer = Buffer.alloc(0);
    let bufferStart = offset;
    const end = offset + size;
    const ensure = async (position, length) => {
        if (position + length > end) throw inconsistent('record runs past the directory');
        if (position >= bufferStart && position + length <= bufferStart + buffer.length) return;
        const readLength = Math.min(end - position, Math.max(length, CHUNK_BYTES));
        buffer = await readExactly(handle, readLength, position);
        bufferStart = position;
    };
    let cursor = offset;
    for (let index = 0; index < count; index += 1) {
        await ensure(cursor, CENTRAL_FIXED);
        const at = cursor - bufferStart;
        if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw inconsistent('central record signature');
        cursor += CENTRAL_FIXED + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
        if (cursor > end) throw inconsistent('record runs past the directory');
    }
    if (cursor !== end) throw inconsistent('directory holds bytes past its counted records');
}

/**
 * Refuse an archive whose end record and central directory a strict reader
 * and Python's `zipfile` could read differently.
 * @param {string} filePath Archive path.
 * @param {{entryCount?: number, fileSize?: number}} [zipFile] The yauzl handle opened on the same file.
 * @returns {Promise<void>} Resolves when consistent; rejects with `ARCHIVE_UNREADABLE`.
 */
async function assertCentralDirectoryConsistent(filePath, zipFile = {}) {
    const handle = await fs.open(filePath, 'r');
    try {
        const fileSize = Number((await handle.stat({ bigint: true })).size);
        if (Number.isFinite(zipFile.fileSize) && zipFile.fileSize !== fileSize) throw inconsistent('archive size changed');
        const geometry = await readEndRecords(handle, fileSize);
        if (Number.isFinite(zipFile.entryCount) && zipFile.entryCount !== geometry.count) throw inconsistent('count differs from the reader');
        await walkDirectory(handle, geometry);
    } finally {
        await handle.close();
    }
}

module.exports = { assertCentralDirectoryConsistent };
