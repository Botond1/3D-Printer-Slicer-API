'use strict';

/**
 * The artifact-read probe of T-ARC-1: reads a Bambu output `.gcode.3mf`
 * through the hashed `bambu-artifact.js` and through the `zip-policy.js`
 * decisions it relies on, and returns one plain stats object. The 3.8.3
 * answer for the control artifact is pinned in `artifact-read-3.8.3.json`.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const yauzl = require('yauzl');

const APP = path.resolve(__dirname, '..', '..', '..', 'app');
const CONTROL_GCODE_SHA256 = '72a2f51c82ccfe056218c7368d66dd2ca7d1f0aefa5caa9786d0bd53a035f894';

function readEntries(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(error);
            const entries = [];
            zip.on('entry', (entry) => {
                entries.push(entry);
                zip.readEntry();
            });
            zip.once('end', () => resolve(entries));
            zip.once('error', reject);
            zip.readEntry();
        });
    });
}

/**
 * @param {string} file Artifact path.
 * @returns {Promise<object>} Stats object (verify verdicts plus per-entry policy decisions).
 */
async function readArtifactStats(file) {
    const { verifyBambuArtifact } = require(path.join(APP, 'services/slice/bambu-artifact'));
    const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require(path.join(APP, 'services/slice/zip-policy'));
    const { resolveResourcePolicy } = require(path.join(APP, 'config/resource-policy'));
    const policy = resolveResourcePolicy({});
    const outcome = async (promise) => {
        try {
            return { resolved: (await promise) === undefined ? 'undefined' : 'value' };
        } catch (error) {
            return { rejected: error.code || error.name, status: error.status ?? null };
        }
    };
    const entries = (await readEntries(file)).map((entry) => {
        let policyVerdict = 'pass';
        try {
            assertDeclaredEntryPolicy(entry, { ...policy, MAX_ZIP_PATH_DEPTH: policy.MAX_3MF_PATH_DEPTH });
        } catch (error) {
            policyVerdict = `${error.code}:${error.status}`;
        }
        return {
            name: entry.fileName,
            unsafe: isUnsafeZipPath(entry.fileName),
            policy: policyVerdict,
            uncompressedSize: entry.uncompressedSize,
            compressedSize: entry.compressedSize
        };
    });
    return {
        verify_correct_hash: await outcome(verifyBambuArtifact(file, CONTROL_GCODE_SHA256)),
        verify_wrong_hash: await outcome(verifyBambuArtifact(file, '0'.repeat(64))),
        entry_count: entries.length,
        entries,
        decisions_sha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex')
    };
}

module.exports = { CONTROL_GCODE_SHA256, readArtifactStats };
