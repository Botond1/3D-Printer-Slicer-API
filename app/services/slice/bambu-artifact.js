'use strict';
const { createHash } = require('node:crypto');
const { openZipWithRetry } = require('./zip-open');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { assertDeclaredEntryPolicy, isUnsafeZipPath } = require('./zip-policy');
const { SliceResourceError } = require('./resource-errors');

/** Verify the retained project contains exactly the G-code used for stats. */
async function verifyBambuArtifact(file, expectedGcodeHash) {
    const policy = resolveResourcePolicy();
    const archive = await openZipWithRetry(file);
    const seen = new Set();
    let gcodeCount = 0;
    let total = 0;
    const closed = new Promise((resolve) => archive.once('close', resolve));
    try {
        await new Promise((resolve, reject) => {
            archive.once('error', reject);
            archive.once('end', resolve);
            archive.on('entry', async (entry) => {
                try {
                    const name = entry.fileName.toLowerCase();
                    if (isUnsafeZipPath(entry.fileName) || seen.has(name) || entry.generalPurposeBitFlag & 1) {
                        throw new Error('Unsafe native package entry.');
                    }
                    seen.add(name);
                    assertDeclaredEntryPolicy(entry, { ...policy, MAX_ZIP_PATH_DEPTH: policy.MAX_3MF_PATH_DEPTH });
                    total += entry.uncompressedSize;
                    if (seen.size > policy.MAX_ZIP_ENTRIES || total > policy.MAX_ZIP_UNCOMPRESSED_BYTES) {
                        throw new Error('Native package exceeds resource bounds.');
                    }
                    if (name.endsWith('.gcode')) {
                        if (name !== 'metadata/plate_1.gcode' || ++gcodeCount !== 1) throw new Error('Multiple native plates.');
                        const stream = await new Promise((done, fail) => archive.openReadStream(entry,
                            (error, value) => error ? fail(error) : done(value)));
                        const hash = createHash('sha256');
                        let bytes = 0;
                        for await (const chunk of stream) {
                            bytes += chunk.length;
                            if (bytes > policy.MAX_OUTPUT_BYTES || bytes > entry.uncompressedSize) {
                                stream.destroy(); throw new Error('Native G-code exceeds its envelope.');
                            }
                            hash.update(chunk);
                        }
                        if (bytes !== entry.uncompressedSize || hash.digest('hex') !== expectedGcodeHash) {
                            throw new Error('Native artifact and parsed G-code differ.');
                        }
                    }
                    archive.readEntry();
                } catch (error) { archive.close(); reject(error); }
            });
            archive.readEntry();
        });
        if (gcodeCount !== 1) throw new Error('Native artifact lacks a single plate.');
    } catch {
        throw new SliceResourceError('BAMBU_RESULT_UNVERIFIED', 'Native package statistics binding failed.', 422);
    } finally {
        archive.close(); await closed;
    }
}
module.exports = { verifyBambuArtifact };
