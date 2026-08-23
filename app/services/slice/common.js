/**
 * Shared slice pipeline utilities.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { EXTENSIONS } = require('../../config/constants');

/**
 * Build set of supported input extensions.
 * @returns {Set<string>} Lowercase extension whitelist.
 */
function getSupportedInputExtensions() {
    return new Set([
        ...EXTENSIONS.direct,
        ...EXTENSIONS.cad,
        ...EXTENSIONS.archive
    ]);
}

/**
 * Check whether an extension is accepted by the slice pipeline.
 * @param {string} extension File extension including dot.
 * @returns {boolean} True when extension is supported.
 */
function isSupportedInputExtension(extension) {
    if (!extension) return false;
    return getSupportedInputExtensions().has(extension.toLowerCase());
}

/**
 * Render supported input extensions as human-readable CSV string.
 * @returns {string} Comma-separated sorted extension list.
 */
function getSupportedInputExtensionsText() {
    return Array.from(getSupportedInputExtensions()).sort((a, b) => a.localeCompare(b)).join(', ');
}

/**
 * Normalize output base filename for safe filesystem usage.
 * @param {string} fileName Original uploaded filename.
 * @returns {string} Sanitized base name.
 */
function sanitizeOutputBaseName(fileName) {
    const parsedName = path.parse(fileName || '').name;
    const normalized = parsedName
        .trim()
        .replaceAll(/[^a-zA-Z0-9]+/g, '-')
        .replaceAll(/(^-+)|(-+$)/g, '');

    return normalized || 'output';
}

/**
 * Build deterministic output artifact filename.
 * @param {string} originalFileName Original uploaded file name.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {string} Generated output file name.
 */
function buildOutputFilename(originalFileName, technology, artifactId) {
    const extension = technology === 'SLA' ? 'sl1' : 'gcode';
    const baseName = sanitizeOutputBaseName(originalFileName);
    const uniqueSuffix = artifactId || `artifact-${require('node:crypto').randomBytes(16).toString('hex')}`;
    if (!/^artifact-[a-f0-9]{32}$/.test(uniqueSuffix)) throw new Error('Invalid artifact identifier.');

    return `${baseName}-output-${uniqueSuffix}.${extension}`;
}

/**
 * Round finite numeric value to 3 decimals.
 * @param {number} value Input numeric value.
 * @returns {number} Rounded number or `0` for non-finite values.
 */
function roundToThree(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1000) / 1000;
}

/**
 * Round XYZ dimension object to 3 decimal precision.
 * @param {{x: number, y: number, z: number}} dimensions Raw dimensions.
 * @returns {{x: number, y: number, z: number}} Rounded dimensions.
 */
function roundDimensions(dimensions) {
    return {
        x: roundToThree(dimensions.x),
        y: roundToThree(dimensions.y),
        z: roundToThree(dimensions.z)
    };
}

/**
 * Resolve a single generated file from an isolated output directory.
 * @param {string} outputDir Output directory path.
 * @param {string} extension Extension filter (e.g. `.gcode`).
 * @param {{assertContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<string | null>} Matching regular non-symlink file path or null.
 */
async function resolveSingleOutputFile(outputDir, extension, workspace) {
    const safeOutputDir = workspace.assertContainedPath(outputDir);
    let entries;
    try {
        entries = await fs.readdir(safeOutputDir, { withFileTypes: true });
    } catch (error_) {
        if (error_?.code === 'ENOENT') return null;
        throw error_;
    }

    const candidates = entries
        .filter((entry) => (
            entry.isFile() &&
            !entry.isSymbolicLink() &&
            entry.name.toLowerCase().endsWith(extension)
        ))
        .map((entry) => workspace.assertContainedPath(path.join(safeOutputDir, entry.name)));

    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
        throw new Error(`Expected one generated ${extension} file, got ${candidates.length}.`);
    }

    return candidates[0];
}

module.exports = {
    isSupportedInputExtension,
    getSupportedInputExtensionsText,
    buildOutputFilename,
    roundToThree,
    roundDimensions,
    resolveSingleOutputFile
};
