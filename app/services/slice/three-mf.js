'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { invalidArchive, resourceLimit } = require('./resource-errors');
const { isUnsafeZipPath, assertDeclaredEntryPolicy } = require('./zip-policy');
const { archiveIdentity, openZipWithRetry } = require('./zip-open');

const REQUIRED_PARTS = new Set(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
const ALLOWED_ROOTS = new Set(['_rels', '3D', 'Metadata', 'Auxiliaries', 'Textures']);
const ALLOWED_EXTENSIONS = new Set([
    '.xml', '.rels', '.model', '.config', '.json', '.png', '.jpg', '.jpeg', '.pmap'
]);

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

function isAllowedThreeMfPart(name) {
    if (REQUIRED_PARTS.has(name)) return true;
    const segments = name.split('/');
    return ALLOWED_ROOTS.has(segments[0]) && ALLOWED_EXTENSIONS.has(path.posix.extname(name).toLowerCase());
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
    for (const required of REQUIRED_PARTS) {
        if (!seen.has(required.toLowerCase())) {
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
