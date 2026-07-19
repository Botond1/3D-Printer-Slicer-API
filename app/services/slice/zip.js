/**
 * ZIP inspection and safe extraction helpers for uploaded archives.
 */

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { EXTENSIONS, DEFAULTS } = require('../../config/constants');
const { parsePositiveInt } = require('./number-utils');

const MAX_ZIP_UNCOMPRESSED_BYTES = parsePositiveInt(
    process.env.MAX_ZIP_UNCOMPRESSED_BYTES || `${DEFAULTS.MAX_ZIP_UNCOMPRESSED_BYTES}`,
    DEFAULTS.MAX_ZIP_UNCOMPRESSED_BYTES
);
const MAX_ZIP_ENTRIES = parsePositiveInt(process.env.MAX_ZIP_ENTRIES || `${DEFAULTS.MAX_ZIP_ENTRIES}`, DEFAULTS.MAX_ZIP_ENTRIES);

/**
 * Open ZIP archive in lazy-entry mode for safe bounded traversal.
 * @param {string} zipPath Path to ZIP file.
 * @returns {Promise<import('yauzl').ZipFile>} Opened zip handle.
 */
function openZip(zipPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
            if (err) return reject(err);
            return resolve(zipFile);
        });
    });
}

/**
 * Sleep helper for retry pacing.
 * @param {number} ms Wait duration in milliseconds.
 * @returns {Promise<void>} Promise resolved after timeout.
 */
function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open ZIP with retries to mitigate transient filesystem visibility delays.
 * @param {string} zipPath ZIP path.
 * @param {number} [attempts=5] Maximum open attempts.
 * @param {number} [waitMs=80] Delay between retries in milliseconds.
 * @returns {Promise<import('yauzl').ZipFile>} Opened zip handle.
 */
async function openZipWithRetry(zipPath, attempts = 5, waitMs = 80) {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await openZip(zipPath);
        } catch (error_) {
            lastError = error_;
            if (error_?.code !== 'ENOENT' || attempt === attempts) {
                throw error_;
            }
            await sleepMs(waitMs);
        }
    }

    throw lastError || new Error('ZIP_GUARD|Unable to open uploaded ZIP file.');
}

/**
 * Detect unsafe ZIP entry names (path traversal / absolute paths).
 * @param {string} entryPath ZIP internal entry name.
 * @returns {boolean} True when the entry path is unsafe.
 */
function isUnsafeZipPath(entryPath) {
    const normalized = path.posix.normalize(String(entryPath || '')).replaceAll('\\', '/');
    if (!normalized || path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized)) return true;
    return normalized.split('/').includes('..');
}

/**
 * Inspect ZIP entries before extraction to enforce anti-zip-bomb constraints.
 * @param {string} zipPath Path to ZIP archive.
 * @param {Set<string>} supportedExts Allowed extension set.
 * @returns {Promise<string[]>} Candidate entry names matching supported extensions.
 */
async function inspectZipFile(zipPath, supportedExts) {
    const zipFile = await openZipWithRetry(zipPath);

    return new Promise((resolve, reject) => {
        let totalUncompressed = 0;
        let fileEntryCount = 0;
        const candidates = [];

        zipFile.on('entry', (entry) => {
            if (entry.generalPurposeBitFlag & 0x1) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|Encrypted ZIP files are not supported.'));
                return;
            }

            if (isUnsafeZipPath(entry.fileName)) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|ZIP contains unsafe file paths.'));
                return;
            }

            totalUncompressed += entry.uncompressedSize;
            if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|ZIP extracted size exceeds allowed limit.'));
                return;
            }

            if (!entry.fileName.endsWith('/')) {
                fileEntryCount += 1;
                if (fileEntryCount > MAX_ZIP_ENTRIES) {
                    zipFile.close();
                    reject(new Error('ZIP_GUARD|ZIP contains too many files.'));
                    return;
                }

                const ext = path.extname(entry.fileName).toLowerCase();
                if (!supportedExts.has(ext)) {
                    zipFile.close();
                    reject(new Error('ZIP_GUARD|ZIP contains unsupported file type.'));
                    return;
                }

                candidates.push(entry.fileName);
            }

            zipFile.readEntry();
        });

        zipFile.once('end', () => {
            if (candidates.length > 1) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|ZIP must contain exactly one supported source file.'));
                return;
            }

            zipFile.close();
            resolve(candidates);
        });

        zipFile.once('error', (err) => {
            reject(err);
        });

        zipFile.readEntry();
    });
}

/**
 * Extract a single validated ZIP entry to destination path.
 * @param {string} zipPath Path to ZIP archive.
 * @param {string} entryName Entry name inside ZIP.
 * @param {string} destinationPath Absolute output path.
 * @returns {Promise<string>} Extracted file path.
 */
async function extractZipEntry(zipPath, entryName, destinationPath) {
    const zipFile = await openZipWithRetry(zipPath);

    return new Promise((resolve, reject) => {
        let extracted = false;

        zipFile.on('entry', (entry) => {
            if (entry.fileName !== entryName) {
                zipFile.readEntry();
                return;
            }

            extracted = true;

            zipFile.openReadStream(entry, async (err, readStream) => {
                if (err) {
                    zipFile.close();
                    reject(err);
                    return;
                }

                try {
                    await pipeline(readStream, fs.createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }));
                    zipFile.close();
                    resolve(destinationPath);
                } catch (error_) {
                    zipFile.close();
                    reject(error_);
                }
            });
        });

        zipFile.once('end', () => {
            if (!extracted) {
                reject(new Error('ZIP_GUARD|No supported file found in ZIP archive.'));
            }
        });

        zipFile.once('error', (err) => {
            reject(err);
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
    console.log('[INFO] Extracting ZIP...');
    workspace.assertContainedPath(inputFile);
    const zipPath = await resolveExistingZipPath(inputFile, workspace);

    const unzipDir = resolveExtractionDirectory(workspace, options.pathFactory);
    await fsPromises.mkdir(unzipDir, { mode: 0o700 });
    const supportedExts = new Set([...EXTENSIONS.direct, ...EXTENSIONS.cad]);

    const zipCandidates = await inspectZipFile(zipPath, supportedExts);
    const selectedEntry = zipCandidates[0];
    if (!selectedEntry) throw new Error('ZIP does not contain a supported model file.');

    const selectedName = path.basename(selectedEntry);
    const extractedPath = workspace.assertContainedPath(path.join(unzipDir, selectedName));
    await extractZipEntry(zipPath, selectedEntry, extractedPath);

    const extractedStat = await fsPromises.lstat(extractedPath);
    if (!extractedStat.isFile() || extractedStat.isSymbolicLink()) {
        throw new Error('ZIP_GUARD|Failed to extract validated source file from ZIP.');
    }

    console.log('[INFO] Extracted one validated model from ZIP.');
    return extractedPath;
}

module.exports = {
    extractFirstSupportedFromZip,
    resolveExtractionDirectory
};
