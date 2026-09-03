'use strict';

const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidStats, resourceLimit } = require('./resource-errors');
const { openZipWithRetry } = require('./zip-open');
const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require('./zip-policy');

/**
 * Parse SL1 `config.ini` metadata into bounded stats.
 *
 * `usedMaterial` is resin volume in millilitres (model + supports + pad, from
 * polygon areas, independent of raster resolution) and is required.
 * `numFast`/`numSlow` are the normal-exposure layer counts; their sum is the
 * total layer count and must be at least one. `numFade` is the transition
 * layer count. `layerHeight` is parsed only to fail closed on malformed
 * metadata; the request's own layer height drives the time model. `printTime`
 * is PrusaSlicer's own uncalibrated SL1 estimate and is never a measured
 * value, so it is returned separately and ignored by the layer-time model.
 * @param {string} content Raw config.ini text.
 * @returns {{material_used_ml: number, layer_count: number, fade_layers: number, sl1_print_time_seconds: number}} Parsed stats.
 */
function parseConfig(content) {
    const values = {};
    for (const line of String(content).split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
    const usedMaterial = Number(values.usedmaterial);
    if (!Number.isFinite(usedMaterial) || usedMaterial <= 0) {
        throw invalidStats('SLA output is missing positive usedMaterial metadata.');
    }
    const layerHeight = Number(values.layerheight);
    if (!Number.isFinite(layerHeight) || layerHeight <= 0) {
        throw invalidStats('SLA output is missing positive layerHeight metadata.');
    }
    const numFast = Number(values.numfast);
    const numSlow = Number(values.numslow);
    if (!Number.isInteger(numFast) || numFast < 0 || !Number.isInteger(numSlow) || numSlow < 0) {
        throw invalidStats('SLA output is missing non-negative numFast/numSlow layer counts.');
    }
    const layerCount = numFast + numSlow;
    if (layerCount < 1) {
        throw invalidStats('SLA output reports zero total layers.');
    }
    const numFade = Number(values.numfade);
    const fadeLayers = Number.isInteger(numFade) && numFade >= 0 ? numFade : 0;
    const printTime = Number(values.printtime);
    return {
        material_used_ml: usedMaterial,
        layer_count: layerCount,
        fade_layers: fadeLayers,
        sl1_print_time_seconds: Number.isFinite(printTime) && printTime > 0 ? printTime : 0
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

/**
 * Parse one `.sl1` archive's `config.ini` metadata.
 *
 * A `.sl1` carries one PNG per layer, so its entry count is a layer budget
 * rather than the general upload ZIP policy: `MAX_SL1_ENTRIES` (20000) is
 * dedicated and independent from `MAX_ZIP_ENTRIES` (500), which would refuse
 * any model taller than a few centimetres at a fine layer height. Only
 * `config.ini` is ever read (bounded by `MAX_PROFILE_BYTES`); every other
 * entry's declared size is counted toward the cumulative `MAX_OUTPUT_BYTES`
 * bound but its bytes are never read.
 * @param {string} filePath Path to the `.sl1` archive.
 * @param {{resourcePolicy?: object, env?: NodeJS.ProcessEnv}} [options] Resource policy override.
 * @returns {Promise<{material_used_ml: number, layer_count: number, fade_layers: number, sl1_print_time_seconds: number}>} Parsed stats.
 */
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
                    if (entries > policy.MAX_SL1_ENTRIES) throw resourceLimit('SL1 contains too many entries.');
                    assertDeclaredEntryPolicy(entry, { ...policy, MAX_ZIP_PATH_DEPTH: 8 });
                    totalBytes += entry.uncompressedSize;
                    if (totalBytes > policy.MAX_OUTPUT_BYTES) {
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
