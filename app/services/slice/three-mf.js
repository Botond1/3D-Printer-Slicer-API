'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidArchive, resourceLimit } = require('./resource-errors');
const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require('./zip-policy');
const { archiveIdentity, openZipWithRetry } = require('./zip-open');

const REQUIRED_PARTS = new Set(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
const REQUIRED_PARTS_LOWER = new Set([...REQUIRED_PARTS].map((part) => part.toLowerCase()));
/** Allowed top-level package directories, compared case-insensitively like duplicate detection. */
const ALLOWED_ROOTS = new Set(['_rels', '3d', 'metadata', 'auxiliaries', 'textures']);
/** Part types accepted under any allowed root (OPC core plus texture/thumbnail parts). */
const ALLOWED_EXTENSIONS = new Set([
    '.xml', '.rels', '.model', '.config', '.json', '.png', '.jpg', '.jpeg', '.pmap'
]);
/**
 * Additional part types that Bambu Studio / OrcaSlicer project exports place
 * under `Metadata/` and `Auxiliaries/` (plate G-code, checksums, thumbnails,
 * settings, notes). They are inspected for envelope safety and then ignored
 * by the converter; only `3D/3dmodel.model` geometry is used.
 */
const PROJECT_METADATA_EXTENSIONS = new Set([
    '.gcode', '.md5', '.png', '.json', '.config', '.xml', '.txt'
]);
const PROJECT_METADATA_ROOTS = new Set(['metadata', 'auxiliaries']);

function canonicalThreeMfPartName(name) {
    const raw = String(name || '');
    const slashed = raw.replaceAll('\\', '/');
    const normalized = path.posix.normalize(slashed);
    const segments = slashed.split('/');
    if (
        raw !== slashed
        || normalized !== slashed
        || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
        || isUnsafeZipPath(raw)
    ) {
        throw invalidArchive('3MF contains a non-canonical part path.');
    }
    return normalized.toLowerCase();
}

/**
 * Decide whether a canonical-shaped part name is an accepted 3MF package part.
 * Roots are matched case-insensitively, consistent with duplicate detection,
 * so `3D/` and `3d/` are the same package directory.
 * @param {string} name Raw part name (already canonical-checked by the caller).
 * @returns {boolean} True when the part type is allowed.
 */
function isAllowedThreeMfPart(name) {
    const lowered = String(name).replaceAll('\\', '/').toLowerCase();
    if (REQUIRED_PARTS_LOWER.has(lowered)) return true;
    const segments = lowered.split('/');
    const root = segments[0];
    const extension = path.posix.extname(lowered);
    if (!ALLOWED_ROOTS.has(root)) return false;
    if (ALLOWED_EXTENSIONS.has(extension)) return true;
    return PROJECT_METADATA_ROOTS.has(root) && PROJECT_METADATA_EXTENSIONS.has(extension);
}

async function consumeEntry(zipFile, entry, policy) {
    const stream = await new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value));
    });
    const actualBytes = await new Promise((resolve, reject) => {
        let bytes = 0;
        stream.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > policy.MAX_ZIP_ENTRY_BYTES || bytes > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                stream.destroy(resourceLimit('3MF entry exceeded the actual-byte limit.'));
            }
        });
        stream.once('end', () => resolve(bytes));
        stream.once('error', reject);
    });
    if (actualBytes !== entry.uncompressedSize) {
        throw invalidArchive('3MF actual bytes do not match the declared entry size.');
    }
    return actualBytes;
}

async function inspectThreeMfArchive(filePath, options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const before = await fs.lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw invalidArchive('Unsafe 3MF archive target.');
    const expectedIdentity = archiveIdentity(before);
    const zipFile = await openZipWithRetry(filePath);
    const closeSettlement = new Promise((resolve) => {
        zipFile.once('close', resolve);
        zipFile.once('error', resolve);
    });
    const seen = new Set();
    let count = 0;
    let declaredTotal = 0;
    let actualTotal = 0;

    try {
        await new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error) => {
                if (settled) return;
                settled = true;
                zipFile.close();
                reject(error);
            };
            zipFile.on('entry', async (entry) => {
                try {
                    if (entry.generalPurposeBitFlag & 0x1) {
                        throw invalidArchive('Encrypted 3MF parts are not supported.');
                    }
                    const canonicalName = canonicalThreeMfPartName(entry.fileName);
                    if (entry.fileName.endsWith('/') || seen.has(canonicalName)) {
                        throw invalidArchive('3MF contains an unsafe or duplicate part path.');
                    }
                    if (!isAllowedThreeMfPart(entry.fileName)) {
                        throw invalidArchive('3MF contains an unsupported part type.');
                    }
                    assertDeclaredEntryPolicy(entry, {
                        ...policy,
                        MAX_ZIP_PATH_DEPTH: policy.MAX_3MF_PATH_DEPTH
                    });
                    seen.add(canonicalName);
                    count += 1;
                    declaredTotal += entry.uncompressedSize;
                    if (
                        count > policy.MAX_ZIP_ENTRIES
                        || !Number.isSafeInteger(declaredTotal)
                        || declaredTotal > policy.MAX_ZIP_UNCOMPRESSED_BYTES
                    ) throw resourceLimit('3MF archive exceeded its declared resource envelope.');
                    actualTotal += await consumeEntry(zipFile, entry, policy);
                    if (actualTotal > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                        throw resourceLimit('3MF archive exceeded its actual-byte envelope.');
                    }
                    zipFile.readEntry();
                } catch (error) {
                    fail(error);
                }
            });
            zipFile.once('end', () => {
                if (settled) return;
                settled = true;
                resolve();
            });
            zipFile.once('error', () => fail(invalidArchive('3MF archive could not be inspected.')));
            zipFile.readEntry();
        });
    } finally {
        zipFile.close();
        await closeSettlement;
    }
    const after = await fs.lstat(filePath, { bigint: true }).catch(() => null);
    if (!after || archiveIdentity(after) !== expectedIdentity) {
        throw invalidArchive('3MF archive changed during inspection.');
    }
    for (const required of REQUIRED_PARTS_LOWER) {
        if (!seen.has(required)) {
            throw invalidArchive('3MF archive is missing a required package part.');
        }
    }
    return { entries: count, declaredBytes: declaredTotal, actualBytes: actualTotal };
}

module.exports = {
    inspectThreeMfArchive,
    isAllowedThreeMfPart,
    canonicalThreeMfPartName
};
