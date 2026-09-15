'use strict';

/** Bambu geometry evidence, independent of optional native slicers. */
const path = require('node:path');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand, PYTHON_HELPER_TIMEOUT_MS } = require('./command');
const { resolvePythonHelper } = require('./helper-paths');
const { createMeasuredModelMeasurement } = require('./model-stats');
const { SliceResourceError } = require('./resource-errors');

/** Since 3.6.0 the inspection describes the mesh; only unprintable geometry is refused. */
const INSPECTION_SCHEMA = 'r3d-mesh-inspection-v2';
const VOLUME_SOURCES = new Set(['validated_triangle_mesh', 'signed_volume_estimate']);
const AMBIGUOUS_SCOPE_MESSAGE = 'Automatic Bambu slicing needs a 3MF whose build items reference plain mesh objects in one model part; assemblies (components) and external part references are not admitted.';

function isCount(value, minimum = 0) {
    return Number.isInteger(value) && value >= minimum;
}

async function hashFile(filePath) {
    const hash = createHash('sha256');
    for await (const bytes of fs.createReadStream(filePath)) hash.update(bytes);
    return hash.digest('hex');
}

async function inspectBambuMesh(filePath, signal) {
    try {
        const result = await runCommand(PYTHON_EXECUTABLE,
            [resolvePythonHelper('inspect_mesh.py'), filePath],
            { signal, timeoutMs: PYTHON_HELPER_TIMEOUT_MS });
        const data = JSON.parse(result.stdout);
        if (data.schema !== INSPECTION_SCHEMA || data.valid !== true
            || typeof data.watertight !== 'boolean' || typeof data.winding_consistent !== 'boolean'
            || !isCount(data.component_count, 1) || !isCount(data.closed_component_count)
            || !isCount(data.open_edge_count) || !isCount(data.dropped_degenerate_faces)
            || !isCount(data.dropped_duplicate_faces) || !isCount(data.triangle_count, 1)
            || !Number.isFinite(data.volume_mm3) || data.volume_mm3 <= 0
            || !VOLUME_SOURCES.has(data.volume_source)) {
            throw new Error('Invalid mesh inspection result.');
        }
        return data;
    } catch (error) {
        if (/INVALID_SOURCE_GEOMETRY\|ambiguous_scope/.test(error?.stderr || '')) {
            throw ambiguousScope();
        }
        throw error;
    }
}

/**
 * The 422 for a 3MF build the converter cannot flatten faithfully.
 * @returns {SliceResourceError} Bounded scope refusal.
 */
function ambiguousScope() {
    return new SliceResourceError('AMBIGUOUS_MANUFACTURING_SCOPE', AMBIGUOUS_SCOPE_MESSAGE, 422);
}

/**
 * The 3MF scope helper's answer, bounded to the two counts the receipt reports.
 * @param {string} stdout Helper stdout.
 * @returns {{object_count: number, instance_count: number}} Source build counts.
 */
function parseThreeMfScope(stdout) {
    const data = JSON.parse(stdout);
    if (!isCount(data.object_count, 1) || !isCount(data.instance_count, 1)) {
        throw new Error('Invalid 3MF scope inspection result.');
    }
    return { object_count: data.object_count, instance_count: data.instance_count };
}

/**
 * The measured-model contract for an inspection that already ran on the file.
 * @param {{dimensions_mm: {x: number, y: number, z: number}, volume_mm3: number}} inspection Validated inspection.
 * @returns {ReturnType<typeof createMeasuredModelMeasurement>} Measured model measurement.
 */
function measurementFromBambuInspection(inspection) {
    return createMeasuredModelMeasurement({ ...inspection.dimensions_mm,
        height_mm: inspection.dimensions_mm.z, volume_mm3: inspection.volume_mm3 });
}

async function measureBambuMesh(filePath, signal) {
    return measurementFromBambuInspection(await inspectBambuMesh(filePath, signal));
}

/**
 * Source evidence: the inspection of the normalized STL, the source hashes and
 * the build scope. A 3MF carries the counts its build declared; every other
 * format is one object with one instance.
 * @param {string} inputFile Uploaded source path.
 * @param {string} normalizedFile Normalized STL path.
 * @param {AbortSignal} [signal] Request cancellation signal.
 * @param {{object_count: number, instance_count: number}|null} [threeMfScope] Parsed 3MF scope, when the source was a 3MF.
 * @returns {Promise<{inspection: object, source: object, scope: {object_count: number, instance_count: number}}>} Evidence.
 */
async function captureBambuSource(inputFile, normalizedFile, signal, threeMfScope = null) {
    const inspection = await inspectBambuMesh(normalizedFile, signal);
    return { inspection, source: {
        sha256: await hashFile(inputFile), format: path.extname(inputFile).slice(1).toLowerCase(),
        normalized_geometry_sha256: await hashFile(normalizedFile),
        units: 'mm', unit_source: 'source_format_normalization'
    }, scope: threeMfScope || { object_count: 1, instance_count: 1 } };
}

module.exports = { hashFile, inspectBambuMesh, measureBambuMesh, measurementFromBambuInspection, captureBambuSource,
    parseThreeMfScope, ambiguousScope, INSPECTION_SCHEMA, VOLUME_SOURCES };
