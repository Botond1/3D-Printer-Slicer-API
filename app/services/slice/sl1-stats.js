'use strict';

const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidStats, resourceLimit } = require('./resource-errors');
const { openZipWithRetry } = require('./zip-open');
const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require('./zip-policy');

/**
 * Parse SL1 `config.ini` metadata into bounded stats.
 * `usedMaterial` is resin volume in millilitres and is required; `printTime`
 * is an uncalibrated slicer estimate (0 when absent) and never a measured
 * value. No mass is derived here: the SLA path publishes `material_used_g`
 * as null.
 * @param {string} content Raw config.ini text.
 * @returns {{print_time_seconds: number, material_used_ml: number}} Parsed stats.
 */
function parseConfig(content) {
    const values = {};
    for (const line of String(content).split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
    const printTime = Number(values.printtime);
    const usedMaterial = Number(values.usedmaterial);
    if (!Number.isFinite(usedMaterial) || usedMaterial <= 0) {
        throw invalidStats('SLA output is missing positive usedMaterial metadata.');
    }
    return {
        print_time_seconds: Number.isFinite(printTime) && printTime > 0 ? printTime : 0,
        material_used_ml: usedMaterial
    };
}

async function readEntryBounded(zipFile, entry, maximumBytes) {
    const stream = await new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value));
    });
    const { chunks, bytes } = await new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        stream.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > maximumBytes) {
                stream.destroy(resourceLimit('SL1 metadata exceeds its parse-byte limit.'));
                return;
            }
            chunks.push(chunk);
        });
        stream.once('end', () => resolve({ chunks, bytes }));
        stream.once('error', reject);
    });
    if (bytes !== entry.uncompressedSize) throw invalidStats('SL1 metadata size changed while reading.');
    return Buffer.concat(chunks, bytes).toString('utf8');
}

async function parseSl1Stats(filePath, options = {}) {
    const policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
    const zipFile = await openZipWithRetry(filePath);
    return new Promise((resolve, reject) => {
        let entries = 0;
        let totalBytes = 0;
        let configPromise = null;
        let failed = false;
        const fail = (error) => {
            if (failed) return;
            failed = true;
            zipFile.close();
            reject(error);
        };
        zipFile.on('entry', (entry) => {
            if (failed) return;
            try {
                if (isUnsafeZipPath(entry.fileName)) throw invalidStats('SL1 contains an unsafe path.');
                if (!entry.fileName.endsWith('/')) {
                    entries++;
                    if (entries > policy.MAX_ZIP_ENTRIES) throw resourceLimit('SL1 contains too many entries.');
                    assertDeclaredEntryPolicy(entry, { ...policy, MAX_ZIP_PATH_DEPTH: 8 });
                    totalBytes += entry.uncompressedSize;
                    if (totalBytes > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                        throw resourceLimit('SL1 expanded bytes exceed the allowed limit.');
                    }
                    if (entry.fileName.toLowerCase() === 'config.ini') {
                        if (configPromise) throw invalidStats('SL1 contains duplicate config.ini metadata.');
                        configPromise = readEntryBounded(zipFile, entry, policy.MAX_PROFILE_BYTES);
                    }
                }
                zipFile.readEntry();
            } catch (error) {
                fail(error);
            }
        });
        zipFile.once('end', async () => {
            if (failed) return;
            try {
                if (!configPromise) throw invalidStats('SL1 is missing config.ini metadata.');
                const result = parseConfig(await configPromise);
                zipFile.close();
                resolve(result);
            } catch (error) {
                fail(error);
            }
        });
        zipFile.once('error', fail);
        zipFile.readEntry();
    });
}

module.exports = {
    parseSl1Stats,
    parseConfig
};
