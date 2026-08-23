'use strict';

const fs = require('node:fs/promises');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidArchive, resourceLimit } = require('./resource-errors');
const { archiveIdentity, openZipWithRetry } = require('./zip-open');

async function writeFully(handle, chunk) {
    let offset = 0;
    while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset);
        if (!Number.isSafeInteger(result?.bytesWritten) || result.bytesWritten <= 0) {
            throw invalidArchive('ZIP extraction made no write progress.');
        }
        offset += result.bytesWritten;
    }
}

function destinationIdentity(stats) {
    return `${String(stats.dev)}:${String(stats.ino)}`;
}

function copyStreamBounded(readStream, handle, policy) {
    return new Promise((resolve, reject) => {
        let actualBytes = 0;
        let pending = Promise.resolve();
        let failed = false;
        readStream.on('data', (chunk) => {
            readStream.pause();
            pending = pending.then(async () => {
                actualBytes += chunk.length;
                if (
                    actualBytes > policy.MAX_ZIP_ENTRY_BYTES
                    || actualBytes > policy.MAX_ZIP_UNCOMPRESSED_BYTES
                ) throw resourceLimit('ZIP extraction exceeded the actual-byte limit.');
                await writeFully(handle, chunk);
                readStream.resume();
            }).catch((error) => {
                failed = true;
                readStream.destroy(error);
                reject(error);
            });
        });
        readStream.once('error', (error) => {
            if (!failed) reject(error);
        });
        readStream.once('end', () => pending.then(() => resolve(actualBytes), reject));
    });
}

async function extractZipEntry(zipPath, selectedEntry, destinationPath, options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const current = await fs.lstat(zipPath, { bigint: true });
    if (
        !current.isFile()
        || current.isSymbolicLink()
        || archiveIdentity(current) !== selectedEntry.archiveIdentity
    ) throw invalidArchive('ZIP archive changed before extraction.');
    const zipFile = await openZipWithRetry(zipPath);

    return new Promise((resolve, reject) => {
        let extracted = false;
        zipFile.on('entry', (entry) => {
            if (entry.fileName !== selectedEntry.fileName) {
                zipFile.readEntry();
                return;
            }
            extracted = true;
            zipFile.openReadStream(entry, async (error, readStream) => {
                if (error) {
                    zipFile.close();
                    reject(error);
                    return;
                }
                let handle;
                try {
                    handle = await fs.open(destinationPath, 'wx', 0o600);
                    const createdIdentity = destinationIdentity(await handle.stat({ bigint: true }));
                    const actualBytes = await copyStreamBounded(readStream, handle, policy);
                    await handle.sync();
                    const finalStat = await handle.stat({ bigint: true });
                    if (
                        !finalStat.isFile()
                        || destinationIdentity(finalStat) !== createdIdentity
                        || Number(finalStat.size) !== actualBytes
                    ) throw invalidArchive('ZIP extraction destination changed or was truncated.');
                    await handle.close();
                    handle = null;
                    validateActualBytes(actualBytes, selectedEntry, policy);
                    zipFile.close();
                    resolve(destinationPath);
                } catch (failure) {
                    await handle?.close().catch(() => {});
                    await fs.rm(destinationPath, { force: true }).catch(() => {});
                    zipFile.close();
                    reject(failure);
                }
            });
        });
        zipFile.once('end', () => {
            if (!extracted) reject(invalidArchive('No supported file found in ZIP archive.'));
        });
        zipFile.once('error', reject);
        zipFile.readEntry();
    });
}

function validateActualBytes(actualBytes, selectedEntry, policy) {
    if (actualBytes !== selectedEntry.declaredBytes) {
        throw invalidArchive('ZIP actual bytes do not match its declared entry size.');
    }
    const ratio = selectedEntry.compressedBytes === 0
        ? (actualBytes === 0 ? 1 : Infinity)
        : actualBytes / selectedEntry.compressedBytes;
    if (!Number.isFinite(ratio) || ratio > policy.MAX_ZIP_COMPRESSION_RATIO) {
        throw resourceLimit('ZIP extraction exceeded the actual compression-ratio limit.');
    }
}

module.exports = {
    extractZipEntry,
    validateActualBytes,
    writeFully
};
