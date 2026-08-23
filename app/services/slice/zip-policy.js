'use strict';

const path = require('node:path');
const { invalidArchive, resourceLimit } = require('./resource-errors');

function isUnsafeZipPath(entryPath) {
    const raw = String(entryPath || '');
    const slashed = raw.replaceAll('\\', '/');
    const normalized = path.posix.normalize(slashed);
    const segments = slashed.split('/');
    return (
        !slashed
        || raw !== slashed
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

function assertDeclaredEntryPolicy(entry, policy) {
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw invalidArchive('ZIP entry has an invalid declared size.');
    }
    if (entry.uncompressedSize > policy.MAX_ZIP_ENTRY_BYTES) {
        throw resourceLimit('ZIP entry exceeds the expanded-byte limit.');
    }
    if (zipPathDepth(entry.fileName) > policy.MAX_ZIP_PATH_DEPTH) {
        throw invalidArchive('ZIP entry nesting exceeds the allowed policy.');
    }
    if (!isRegularZipEntry(entry)) throw invalidArchive('ZIP contains an unsupported entry type.');
    const compressed = Number(entry.compressedSize);
    const ratio = compressed === 0 ? (entry.uncompressedSize === 0 ? 1 : Infinity) : entry.uncompressedSize / compressed;
    if (!Number.isFinite(ratio) || ratio > policy.MAX_ZIP_COMPRESSION_RATIO) {
        throw resourceLimit('ZIP entry exceeds the compression-ratio limit.');
    }
}

module.exports = {
    isUnsafeZipPath,
    assertDeclaredEntryPolicy
};
