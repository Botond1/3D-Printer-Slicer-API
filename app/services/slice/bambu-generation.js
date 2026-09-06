'use strict';

/** One immutable native build and resolved vendor bundle per process generation. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { hashValue } = require('./receipt-hash');
const { resolveSlicerExecutable } = require('./engine');
const { flattenBambuProfile } = require('./bambu-profile-chain');
const { listBambuRegistryProfileReferences, getBambuPrinterRegistry } = require('./bambu-printer-registry');
const PROCESSING_SCHEMA = 'r3d-bambu-processing-v1';
let generation = null;
let nativeIdentity = [];

function hashNativeFile(file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 512 * 1024 * 1024) {
        throw new Error('Invalid native build component.');
    }
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function initializeBambuGeneration(version, options = {}) {
    const executable = options.executable || resolveSlicerExecutable('bambu');
    const platform = options.platform || process.platform;
    const root = platform === 'win32' ? path.dirname(executable) : '/opt/bambustudio';
    const components = platform === 'win32'
        ? [executable, path.join(root, 'BambuStudio.dll')]
        : [path.join(root, 'AppRun'), path.join(root, 'bin/bambu-studio')];
    const nativeHashes = components.map((file) => ({ name: path.basename(file), sha256: hashNativeFile(file) }));
    nativeIdentity = components.map((file, index) => ({ file, sha256: nativeHashes[index].sha256 }));
    const registry = getBambuPrinterRegistry();
    const bundle = Object.fromEntries(listBambuRegistryProfileReferences(registry).map(({ role, name }) =>
        [`${role}:${name}`, flattenBambuProfile(role, name)]));
    const buildSha256 = hashValue({ platform, version, components: nativeHashes });
    const bundleSha256 = hashValue({ registry, bundle });
    const appRoot = path.resolve(__dirname, '../..');
    const processingFiles = ['mesh2stl.py', 'cad2stl.py', 'orient.py', 'scale_model.py', 'inspect_mesh.py',
        'services/slice/gcode-metrics.js', 'services/slice/bambu-receipt.js', 'services/slice/bambu-source.js',
        'services/slice/bambu-artifact.js', 'services/slice/transform.js', 'services/slice/engine.js',
        'services/slice/pipeline.js', 'services/slice/input-processing.js', 'services/slice/model-stats.js',
        'services/slice/profiles.js', 'services/slice/profile-digest.js', 'services/slice/profile-snapshot.js',
        'services/slice/bambu-profile-chain.js', 'services/slice/bambu-placement.js',
        'services/slice/bambu-bed-geometry.js', 'services/slice/orientation-contract.js',
        'services/slice/output-lifecycle.js', 'services/slice/receipt-hash.js'];
    const processingSha256 = hashValue(processingFiles.map((name) => ({ name, sha256: hashNativeFile(path.join(appRoot, name)) })));
    const measurementGeneration = hashValue({ build_sha256: buildSha256, bundle_sha256: bundleSha256,
        processing_schema: PROCESSING_SCHEMA, processing_sha256: processingSha256 });
    generation = Object.freeze({ engine: Object.freeze({ name: 'bambu', version, platform, build_sha256: buildSha256 }),
        bundle_sha256: bundleSha256, measurement_generation: measurementGeneration });
    return generation;
}

function assertBambuBuildCurrent() {
    if (!generation || nativeIdentity.some(({ file, sha256 }) => hashNativeFile(file) !== sha256)) {
        throw new Error('Bambu runtime build changed after startup.');
    }
}

function getBambuGeneration(required = true) {
    if (!generation && required) throw new Error('Bambu runtime identity is unavailable.');
    return generation;
}

function catalogueGenerationFields() {
    const current = getBambuGeneration(false);
    return current ? { measurement_generation: current.measurement_generation,
        engine_build_sha256: current.engine.build_sha256, profile_bundle_sha256: current.bundle_sha256 } : {};
}
module.exports = { PROCESSING_SCHEMA, initializeBambuGeneration, getBambuGeneration, catalogueGenerationFields, assertBambuBuildCurrent };
