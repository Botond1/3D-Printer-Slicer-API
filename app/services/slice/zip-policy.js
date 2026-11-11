'use strict';

const path = require('node:path');
const { invalidArchive, labelArchiveError, resourceLimit } = require('./resource-errors');

/**
 * Whether an entry path is unsafe: empty, absolute, a drive letter, a
 * backslash, a `.`/`..`/empty segment, or (3.9.0) a NUL anywhere in it.
 * Python's `zipfile` truncates a name at NUL, so such a name would be read
 * as a different part by the converter than by these checks. A NUL never
 * occurs in a Bambu output name, so the native artifact read is unaffected.
 * @param {unknown} entryPath Raw entry name.
 * @returns {boolean} True when the path must be refused.
 */
function isUnsafeZipPath(entryPath) {
    const raw = String(entryPath || '');
    const slashed = raw.replaceAll('\\', '/');
    const normalized = path.posix.normalize(slashed);
    const segments = slashed.split('/');
    return (
        !slashed
        || raw !== slashed
        || raw.includes('\u0000')
        || normalized !== slashed
        || path.posix.isAbsolute(normalized)
        || /^[a-z]:\//i.test(normalized)
        || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    );
}

function isRegularZipEntry(entry) {
    if (entry.fileName.endsWith('/')) return false;
    const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
    return unixType === 0 || unixType === 0o100000;
}

function zipPathDepth(entryPath) {
    return String(entryPath).replaceAll('\\', '/').split('/').filter(Boolean).length;
}

/**
 * Declared-size, depth, type and ratio checks of one entry. The decisions
 * and the thrown codes/statuses are those of 3.8.3; 3.9.0 only adds the
 * `archive_rule` label as properties on the thrown error.
 * @param {{fileName: string, uncompressedSize: number, compressedSize: number, externalFileAttributes: number}} entry ZIP entry.
 * @param {{MAX_ZIP_ENTRY_BYTES: number, MAX_ZIP_PATH_DEPTH: number, MAX_ZIP_COMPRESSION_RATIO: number}} policy Resource policy.
 */
function assertDeclaredEntryPolicy(entry, policy) {
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw labelArchiveError(invalidArchive('ZIP entry has an invalid declared size.'), 'ARCHIVE_UNREADABLE');
    }
    if (entry.uncompressedSize > policy.MAX_ZIP_ENTRY_BYTES) {
        throw labelArchiveError(resourceLimit('ZIP entry exceeds the expanded-byte limit.'),
            'ARCHIVE_TOO_LARGE', policy.MAX_ZIP_ENTRY_BYTES);
    }
    if (zipPathDepth(entry.fileName) > policy.MAX_ZIP_PATH_DEPTH) {
        throw labelArchiveError(invalidArchive('ZIP entry nesting exceeds the allowed policy.'),
            'ARCHIVE_UNSAFE_PATH', policy.MAX_ZIP_PATH_DEPTH);
    }
    if (!isRegularZipEntry(entry)) {
        throw labelArchiveError(invalidArchive('ZIP contains an unsupported entry type.'), 'ARCHIVE_UNSAFE_PATH');
    }
    const compressed = Number(entry.compressedSize);
    const ratio = compressed === 0 ? (entry.uncompressedSize === 0 ? 1 : Infinity) : entry.uncompressedSize / compressed;
    if (!Number.isFinite(ratio) || ratio > policy.MAX_ZIP_COMPRESSION_RATIO) {
        throw labelArchiveError(resourceLimit('ZIP entry exceeds the compression-ratio limit.'),
            'ARCHIVE_RATIO_EXCEEDED', policy.MAX_ZIP_COMPRESSION_RATIO);
    }
}

module.exports = {
    isUnsafeZipPath,
    assertDeclaredEntryPolicy
};
