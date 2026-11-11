'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidArchive, labelArchiveError, resourceLimit } = require('./resource-errors');
const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require('./zip-policy');
const { archiveIdentity, openZipWithRetry } = require('./zip-open');
const { assertCentralDirectoryConsistent } = require('./zip-directory');
const { ExpansionCounter, consumeExpansionVerdict, isModelPart } = require('./three-mf-expansion');

const REQUIRED_PARTS = new Set(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
const REQUIRED_PARTS_LOWER = new Set([...REQUIRED_PARTS].map((part) => part.toLowerCase()));
/** Allowed top-level package directories, compared case-insensitively like duplicate detection. */
const ALLOWED_ROOTS = new Set(['_rels', '3d', 'metadata', 'auxiliaries', 'textures', 'cura']);
/** Part types accepted under any allowed root (OPC core plus texture/thumbnail parts). */
const ALLOWED_EXTENSIONS = new Set([
    '.xml', '.rels', '.model', '.config', '.json', '.png', '.jpg', '.jpeg', '.pmap'
]);
/**
 * Additional part types that Bambu Studio / OrcaSlicer project exports place
 * under `Metadata/` and `Auxiliaries/` (plate G-code, checksums, thumbnails,
 * settings, notes, the model and profile pictures Bambu Studio stores as
 * `.webp`, attached `.pdf` sheets) and Cura under `Cura/` (`.cfg`, `.ini`,
 * `.fdm_material`, `.json`). They are inspected for envelope safety and then ignored
 * by the converter; the geometry comes from `3D/3dmodel.model` and the
 * production-extension model parts it references (`3D/Objects/*.model`).
 */
const PROJECT_METADATA_EXTENSIONS = new Set([
    '.gcode', '.md5', '.png', '.json', '.config', '.xml', '.txt', '.webp', '.pdf', '.cfg', '.ini', '.fdm_material'
]);
const PROJECT_METADATA_ROOTS = new Set(['metadata', 'auxiliaries', 'cura']);
/** Archive extensions the part allowlist refuses, labelled `ARCHIVE_NESTED`. */
const NESTED_ARCHIVE_EXTENSIONS = new Set(['.zip', '.3mf']);
/** yauzl's own entry-name refusals, which surface as an archive `error` event. */
const YAUZL_UNSAFE_NAME = /^(?:invalid characters in fileName|absolute path|invalid relative path):/;

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
        throw labelArchiveError(invalidArchive('3MF contains a non-canonical part path.'), 'ARCHIVE_UNSAFE_PATH');
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

/**
 * The `archive_rule` of a part the allowlist refuses.
 * @param {string} name Raw part name.
 * @returns {'ARCHIVE_NESTED'|'ARCHIVE_DISALLOWED_PART'} Rule label.
 */
function disallowedPartRule(name) {
    const extension = path.posix.extname(String(name).toLowerCase());
    return NESTED_ARCHIVE_EXTENSIONS.has(extension) ? 'ARCHIVE_NESTED' : 'ARCHIVE_DISALLOWED_PART';
}

/**
 * Stream one entry once: count its actual bytes and, for a model part, feed
 * the expansion scanner with the same chunks.
 */
async function consumeEntry(zipFile, entry, policy, scanner = null) {
    const stream = await new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value));
    });
    const actualBytes = await new Promise((resolve, reject) => {
        let bytes = 0;
        stream.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > policy.MAX_ZIP_ENTRY_BYTES || bytes > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                stream.destroy(labelArchiveError(resourceLimit('3MF entry exceeded the actual-byte limit.'),
                    'ARCHIVE_TOO_LARGE', Math.min(policy.MAX_ZIP_ENTRY_BYTES, policy.MAX_ZIP_UNCOMPRESSED_BYTES)));
                return;
            }
            if (scanner) {
                try {
                    scanner.write(chunk);
                } catch (error) {
                    stream.destroy(error);
                }
            }
        });
        stream.once('end', () => resolve(bytes));
        stream.once('error', reject);
    });
    scanner?.end();
    if (actualBytes !== entry.uncompressedSize) {
        throw labelArchiveError(invalidArchive('3MF actual bytes do not match the declared entry size.'), 'ARCHIVE_UNREADABLE');
    }
    return actualBytes;
}

/**
 * Inspect a 3MF package and return the 3.8.3 summary plus the expansion
 * counts. The expansion scan is skipped when `options.expansion === false`
 * (the 3.8.3 checks alone, used by the corpus comparison) or when a
 * preflight verdict registered for this very file is consumed (once); the
 * other checks always run.
 * @param {string} filePath 3MF path.
 * @param {{resourcePolicy?: object, env?: object, expansionLimits?: object, expansion?: boolean, ignoreVerdict?: boolean}} [options] Options.
 * @returns {Promise<{summary: {entries: number, declaredBytes: number, actualBytes: number}, expansion: {triangles: number, instances: number, objects: number}|null, verdictConsumed: boolean}>} Result.
 */
async function inspectThreeMfPackage(filePath, options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const before = await fs.lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) {
        throw labelArchiveError(invalidArchive('Unsafe 3MF archive target.'), 'ARCHIVE_UNSAFE_PATH');
    }
    const expectedIdentity = archiveIdentity(before);
    let consumedCounts = null;
    if (options.expansion !== false && options.ignoreVerdict !== true) {
        const realpath = await fs.realpath(filePath).catch(() => null);
        if (realpath) consumedCounts = consumeExpansionVerdict(realpath, before);
    }
    const counter = options.expansion === false || consumedCounts
        ? null
        : new ExpansionCounter(options.expansionLimits);
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
        await assertCentralDirectoryConsistent(filePath, zipFile);
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
                        throw labelArchiveError(invalidArchive('Encrypted 3MF parts are not supported.'), 'ARCHIVE_ENCRYPTED');
                    }
                    const canonicalName = canonicalThreeMfPartName(entry.fileName);
                    if (entry.fileName.endsWith('/') || seen.has(canonicalName)) {
                        throw labelArchiveError(invalidArchive('3MF contains an unsafe or duplicate part path.'),
                            'ARCHIVE_UNSAFE_PATH');
                    }
                    if (!isAllowedThreeMfPart(entry.fileName)) {
                        throw labelArchiveError(invalidArchive('3MF contains an unsupported part type.'),
                            disallowedPartRule(entry.fileName));
                    }
                    assertDeclaredEntryPolicy(entry, {
                        ...policy,
                        MAX_ZIP_PATH_DEPTH: policy.MAX_3MF_PATH_DEPTH
                    });
                    seen.add(canonicalName);
                    count += 1;
                    declaredTotal += entry.uncompressedSize;
                    if (count > policy.MAX_ZIP_ENTRIES) {
                        throw labelArchiveError(resourceLimit('3MF archive exceeded its declared resource envelope.'),
                            'ARCHIVE_TOO_MANY_ENTRIES', policy.MAX_ZIP_ENTRIES);
                    }
                    if (!Number.isSafeInteger(declaredTotal) || declaredTotal > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                        throw labelArchiveError(resourceLimit('3MF archive exceeded its declared resource envelope.'),
                            'ARCHIVE_TOO_LARGE', policy.MAX_ZIP_UNCOMPRESSED_BYTES);
                    }
                    const scanner = counter && isModelPart(canonicalName)
                        ? counter.createPartScanner(entry.fileName)
                        : null;
                    actualTotal += await consumeEntry(zipFile, entry, policy, scanner);
                    if (actualTotal > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                        throw labelArchiveError(resourceLimit('3MF archive exceeded its actual-byte envelope.'),
                            'ARCHIVE_TOO_LARGE', policy.MAX_ZIP_UNCOMPRESSED_BYTES);
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
            zipFile.once('error', (error) => fail(labelArchiveError(
                invalidArchive('3MF archive could not be inspected.'),
                YAUZL_UNSAFE_NAME.test(String(error?.message || '')) ? 'ARCHIVE_UNSAFE_PATH' : 'ARCHIVE_UNREADABLE'
            )));
            zipFile.readEntry();
        });
    } finally {
        zipFile.close();
        await closeSettlement;
    }
    const after = await fs.lstat(filePath, { bigint: true }).catch(() => null);
    if (!after || archiveIdentity(after) !== expectedIdentity) {
        throw labelArchiveError(invalidArchive('3MF archive changed during inspection.'), 'ARCHIVE_UNREADABLE');
    }
    for (const required of REQUIRED_PARTS_LOWER) {
        if (!seen.has(required)) {
            throw labelArchiveError(invalidArchive('3MF archive is missing a required package part.'), 'ARCHIVE_UNREADABLE');
        }
    }
    return {
        summary: { entries: count, declaredBytes: declaredTotal, actualBytes: actualTotal },
        expansion: counter ? counter.finish() : consumedCounts,
        verdictConsumed: Boolean(consumedCounts)
    };
}

/**
 * Inspect a 3MF package: the 3.8.3 envelope checks plus, from 3.9.0, the
 * NUL-name refusal and the build-expansion pre-scan. The return value for an
 * admitted file is exactly that of 3.8.3.
 * @param {string} filePath 3MF path.
 * @param {object} [options] See `inspectThreeMfPackage`.
 * @returns {Promise<{entries: number, declaredBytes: number, actualBytes: number}>} Summary.
 */
async function inspectThreeMfArchive(filePath, options = {}) {
    return (await inspectThreeMfPackage(filePath, options)).summary;
}

module.exports = {
    inspectThreeMfArchive,
    inspectThreeMfPackage,
    isAllowedThreeMfPart,
    canonicalThreeMfPartName
};
