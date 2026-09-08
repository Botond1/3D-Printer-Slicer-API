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
        if (data.schema !== 'r3d-mesh-inspection-v1' || data.valid !== true
            || data.component_count !== 1 || !data.watertight || !data.winding_consistent
            || !Number.isFinite(data.volume_mm3) || data.volume_mm3 <= 0) {
            throw new Error('Invalid mesh inspection result.');
        }
        return data;
    } catch (error) {
        if (/INVALID_SOURCE_GEOMETRY\|ambiguous_scope/.test(error?.stderr || '')) {
            throw new SliceResourceError('AMBIGUOUS_MANUFACTURING_SCOPE',
                'Automatic Bambu slicing requires one connected solid and one build instance.', 422);
        }
        throw error;
    }
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

async function captureBambuSource(inputFile, normalizedFile, signal) {
    const inspection = await inspectBambuMesh(normalizedFile, signal);
    return { inspection, source: {
        sha256: await hashFile(inputFile), format: path.extname(inputFile).slice(1).toLowerCase(),
        normalized_geometry_sha256: await hashFile(normalizedFile),
        units: 'mm', unit_source: 'source_format_normalization'
    } };
}

module.exports = { hashFile, inspectBambuMesh, measureBambuMesh, measurementFromBambuInspection, captureBambuSource };
