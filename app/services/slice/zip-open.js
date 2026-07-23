'use strict';

const yauzl = require('yauzl');

function archiveIdentity(stats) {
    return [
        stats.dev, stats.ino, stats.size,
        stats.mtimeNs ?? BigInt(Math.trunc(Number(stats.mtimeMs) * 1_000_000))
    ].map(String).join(':');
}

function openZip(zipPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
            if (error) reject(error);
            else resolve(zipFile);
        });
    });
}

async function openZipWithRetry(zipPath, attempts = 5, waitMs = 80) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await openZip(zipPath);
        } catch (error) {
            lastError = error;
            if (error?.code !== 'ENOENT' || attempt === attempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
    throw lastError;
}

module.exports = {
    archiveIdentity,
    openZipWithRetry
};
