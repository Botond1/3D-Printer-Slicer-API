/**
 * ZIP inspection and safe extraction helpers for uploaded archives.
 */

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { EXTENSIONS } = require('../../config/constants');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidArchive, resourceLimit } = require('./resource-errors');
const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require('./zip-policy');
const { archiveIdentity, openZipWithRetry } = require('./zip-open');
const { extractZipEntry } = require('./zip-stream');

/**
 * Detect unsafe ZIP entry names (path traversal / absolute paths).
 * @param {string} entryPath ZIP internal entry name.
 * @returns {boolean} True when the entry path is unsafe.
 */
/**
 * Inspect ZIP entries before extraction to enforce anti-zip-bomb constraints.
 * @param {string} zipPath Path to ZIP archive.
 * @param {Set<string>} supportedExts Allowed extension set.
 * @returns {Promise<string[]>} Candidate entry names matching supported extensions.
 */
async function inspectZipFile(zipPath, supportedExts, options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const before = await fsPromises.lstat(zipPath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw invalidArchive('Unsafe ZIP archive target.');
    const expectedArchiveIdentity = archiveIdentity(before);
    const zipFile = await openZipWithRetry(zipPath);

    return new Promise((resolve, reject) => {
        let totalUncompressed = 0;
        let fileEntryCount = 0;
        const candidates = [];
        let settled = false;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            zipFile.close();
            reject(error);
        };

        zipFile.on('entry', (entry) => {
            if (entry.generalPurposeBitFlag & 0x1) {
                return fail(invalidArchive('Encrypted ZIP files are not supported.'));
            }

            if (isUnsafeZipPath(entry.fileName)) {
                return fail(invalidArchive('ZIP contains unsafe file paths.'));
            }

            if (entry.fileName.endsWith('/')) {
                return fail(invalidArchive('ZIP directories are not supported.'));
            }
            try {
                assertDeclaredEntryPolicy(entry, policy);
            } catch (error) {
                return fail(error);
            }
            totalUncompressed += entry.uncompressedSize;
            if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                return fail(resourceLimit('ZIP expanded size exceeds the allowed limit.'));
            }

            fileEntryCount += 1;
            if (fileEntryCount > policy.MAX_ZIP_ENTRIES) {
                return fail(resourceLimit('ZIP contains too many files.'));
            }

            const ext = path.extname(entry.fileName).toLowerCase();
            if (!supportedExts.has(ext)) {
                return fail(invalidArchive('ZIP contains unsupported file type.'));
            }

            candidates.push({
                fileName: entry.fileName,
                declaredBytes: entry.uncompressedSize,
                compressedBytes: entry.compressedSize
            });

            zipFile.readEntry();
        });

        zipFile.once('end', async () => {
            if (settled) return;
            settled = true;
            zipFile.close();
            const after = await fsPromises.lstat(zipPath, { bigint: true }).catch(() => null);
            if (!after || archiveIdentity(after) !== expectedArchiveIdentity) {
                reject(invalidArchive('ZIP archive changed during inspection.'));
            } else if (candidates.length !== 1) {
                reject(invalidArchive('ZIP must contain exactly one supported source file.'));
            } else {
                candidates[0].archiveIdentity = expectedArchiveIdentity;
                resolve(candidates);
            }
        });

        zipFile.once('error', (err) => {
            fail(invalidArchive('ZIP archive could not be inspected.'));
        });

        zipFile.readEntry();
    });
}

/**
 * Resolve runtime ZIP path variations (`.zip` renamed during upload pipeline).
 * @param {string} zipPath Candidate ZIP file path.
 * @returns {string} Existing ZIP path.
 */
async function resolveExistingZipPath(zipPath, workspace) {
    const candidates = [zipPath];
    candidates.push(zipPath.toLowerCase().endsWith('.zip') ? zipPath.slice(0, -4) : `${zipPath}.zip`);

    for (const candidate of candidates) {
        const safeCandidate = workspace.assertContainedPath(candidate);
        try {
            const stats = await fsPromises.lstat(safeCandidate);
            if (stats.isFile() && !stats.isSymbolicLink()) return safeCandidate;
        } catch (error_) {
            if (error_?.code !== 'ENOENT') throw error_;
        }
    }

    throw new Error('ZIP_GUARD|Uploaded ZIP file is not accessible at runtime.');
}

/**
 * Resolve a collision-resistant extraction directory inside the owning workspace.
 * @param {{resolvePath(...segments: string[]): string, assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {(defaultPath: string) => string} [pathFactory] Test-only candidate override.
 * @returns {string} Contained extraction directory.
 */
function resolveExtractionDirectory(workspace, pathFactory) {
    const defaultPath = workspace.resolvePath(`extract-${randomBytes(16).toString('hex')}`);
    return workspace.assertContainedPath(pathFactory ? pathFactory(defaultPath) : defaultPath);
}

/**
 * Extract first supported file from uploaded ZIP archive.
 * @param {string} inputFile Uploaded zip file path.
 * @param {{resolvePath(...segments: string[]): string, assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @param {{pathFactory?: (defaultPath: string) => string}} [options] Test-only path seam.
 * @returns {Promise<string>} Extracted file path.
 */
async function extractFirstSupportedFromZip(inputFile, workspace, options = {}) {
    workspace.assertContainedPath(inputFile);
    const zipPath = await resolveExistingZipPath(inputFile, workspace);

    const unzipDir = resolveExtractionDirectory(workspace, options.pathFactory);
    await fsPromises.mkdir(unzipDir, { mode: 0o700 });
    const supportedExts = new Set([...EXTENSIONS.direct, ...EXTENSIONS.cad]);

    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const zipCandidates = await inspectZipFile(zipPath, supportedExts, { resourcePolicy: policy });
    const selectedEntry = zipCandidates[0];
    if (!selectedEntry) throw invalidArchive('ZIP does not contain a supported model file.');

    const selectedName = path.basename(selectedEntry.fileName);
    const extractedPath = workspace.assertContainedPath(path.join(unzipDir, selectedName));
    try {
        await extractZipEntry(zipPath, selectedEntry, extractedPath, { resourcePolicy: policy });
    } catch (error) {
        await fsPromises.rm(unzipDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }

    const extractedStat = await fsPromises.lstat(extractedPath);
    if (!extractedStat.isFile() || extractedStat.isSymbolicLink()) {
        throw invalidArchive('Failed to extract validated source file from ZIP.');
    }

    return extractedPath;
}

module.exports = {
    extractFirstSupportedFromZip,
    resolveExtractionDirectory,
    inspectZipFile,
    extractZipEntry,
    isUnsafeZipPath,
    assertDeclaredEntryPolicy
};
