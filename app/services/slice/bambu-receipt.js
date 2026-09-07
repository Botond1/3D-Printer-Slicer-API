'use strict';

/** Native config, single-plate scope and durable technical evidence. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { readBoundedText } = require('./model-stats');
const { hashFile, inspectBambuMesh } = require('./bambu-source');
const { hashValue } = require('./receipt-hash');
const { getBambuGeneration, PROCESSING_SCHEMA } = require('./bambu-generation');
const { getBambuPrinter } = require('./bambu-printer-registry');
const { SliceResourceError } = require('./resource-errors');
const { verifyBambuArtifact } = require('./bambu-artifact');

function unverified(reason, status = 422) {
    return new SliceResourceError('BAMBU_RESULT_UNVERIFIED', reason, status);
}

function parseConfig(content) {
    const blocks = [...content.matchAll(/^; CONFIG_BLOCK_START\r?\n([\s\S]*?)^; CONFIG_BLOCK_END\s*$/gm)];
    if (blocks.length !== 1) throw unverified('Native applied configuration is unavailable.');
    const config = {};
    for (const line of blocks[0][1].split(/\r?\n/)) {
        const match = /^; ([a-z][a-z0-9_]*) = (.*)$/.exec(line);
        if (!match) continue;
        if (Object.hasOwn(config, match[1])) throw unverified('Native configuration contains duplicate keys.');
        config[match[1]] = match[2];
    }
    return config;
}

function nativeName(value) {
    return /^"[^";]+"$/.test(value || '') ? value.slice(1, -1) : value;
}

function validateAppliedConfig(content, context, version) {
    const config = parseConfig(content);
    const headers = [...content.matchAll(/^; BambuStudio ([0-9]+(?:\.[0-9]+){2,3})\s*$/gm)];
    if (headers.length !== 1 || headers[0][1] !== version) throw unverified('Native build header differs from startup identity.');
    const layer = Number(config.layer_height);
    const infill = /^(\d{1,3})%$/.exec(config.sparse_infill_density || '');
    const support = config.enable_support === '1' ? true : config.enable_support === '0' ? false : null;
    // The registry accepts trimmed, case-insensitive request material names;
    // the native value must still exactly match that canonical material.
    const material = String(context.material || '').trim().toUpperCase();
    if (!Number.isFinite(layer) || layer <= 0 || layer !== context.layerHeight
        || !infill || Number(infill[1]) !== Number.parseInt(context.infillPercentage, 10)
        || support !== context.supports || config.filament_type !== material) {
        throw unverified('Native applied layer, infill, support or material does not match the request.');
    }
    const printer = getBambuPrinter(context.profileOverrides?.bambuPrinter);
    if (nativeName(config.printer_settings_id) !== printer.machine
        || config.curr_bed_type !== printer.bedType) throw unverified('Native printer or bed differs from the registry.');
    if (!/^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)*$/.test(config.nozzle_diameter || '')) {
        throw unverified('Native nozzle diameter is unavailable.');
    }
    return { config, applied: { layer_height_mm: layer, infill_percent: Number(infill[1]), supports: support,
        material: config.filament_type, evidence: 'bambu_gcode_config', configuration_sha256: hashValue(config) } };
}

function validateNativeScope(result, gcode, stats) {
    if (result.return_code !== 0 || result.plate_index !== 0
        || !Array.isArray(result.sliced_plates) || result.sliced_plates.length !== 1) {
        throw unverified('Bambu output requires exactly one successful plate.');
    }
    const plate = result.sliced_plates[0];
    if (plate.id !== 1 || !Array.isArray(plate.filaments) || plate.filaments.length !== 1
        || plate.filaments[0].id !== 1 || !(plate.triangle_count > 0)
        || !/^; total layer number: [1-9][0-9]*\s*$/m.test(gcode)
        || !/^; FEATURE: (?:Outer wall|Inner wall|Bottom surface|Internal solid infill)\s*$/m.test(gcode)) {
        throw unverified('Bambu output has no verified single-part toolpath.');
    }
    if (stats.print_time_source !== 'total_estimated_time' || stats.material_used_g_source !== 'total_filament_weight_g'
        || !Number.isFinite(plate.total_predication) || plate.total_predication <= 0
        || !Number.isFinite(plate.filaments[0].total_used_g) || plate.filaments[0].total_used_g <= 0
        || Math.abs(plate.total_predication - stats.print_time_seconds) >= 1
        || Math.abs(plate.filaments[0].total_used_g - stats.material_used_g) > 0.005001) {
        throw unverified('Native independent totals disagree with G-code precision.');
    }
    return plate;
}

async function readNativeResult(directory, workspace) {
    const file = workspace.assertContainedPath(path.join(directory, 'result.json'));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 65536) {
        throw unverified('Native result summary is unavailable.');
    }
    return JSON.parse(await fs.readFile(file, 'utf8'));
}

function assertExpectedIdentity(context, effectiveProfileSha256) {
    if (context.engine !== 'bambu') return;
    const current = getBambuGeneration();
    for (const [field, expected] of [['expectedProfileSha256', effectiveProfileSha256],
        ['expectedMeasurementGeneration', current.measurement_generation]]) {
        if (context[field] !== undefined && (!/^[a-f0-9]{64}$/.test(context[field]) || context[field] !== expected)) {
            throw new SliceResourceError('SLICE_IDENTITY_MISMATCH', 'Selected profile or measurement generation is stale.', 409);
        }
    }
}

function collectWarnings(result, plate, modelTransform, nativeResult = {}) {
    const warnings = [];
    if ((typeof plate.warning_message === 'string' && plate.warning_message.trim())
        || (Array.isArray(result.warnings) && result.warnings.length)
        || /\b(?:warning|warn)\b/i.test(`${nativeResult.stdout || ''}\n${nativeResult.stderr || ''}`)) {
        warnings.push({ code: 'NATIVE_WARNING_UNCLASSIFIED', severity: 'warning', source: 'native' });
    }
    if (modelTransform.orientation_outcome === 'fallback_unmodified') {
        warnings.push({ code: 'ORIENTATION_FALLBACK', severity: 'warning', source: 'orientation' });
    }
    return warnings;
}

async function buildBambuReceipt(context, generated, stats, effectiveProfileSha256, runtimeConfigFile, nativeResult) {
    const generation = getBambuGeneration();
    const policy = resolveResourcePolicy();
    const gcode = await readBoundedText(generated.statsPath, policy.MAX_OUTPUT_PARSE_BYTES);
    const { config, applied } = validateAppliedConfig(gcode, context, generation.engine.version);
    const result = await readNativeResult(context.engineOutputDir, context.workspace);
    const plate = validateNativeScope(result, gcode, stats);
    const finalGeometry = await inspectBambuMesh(context.processableFile, context.signal);
    const processProfile = JSON.parse(await fs.readFile(runtimeConfigFile, 'utf8'));
    const machineProfile = JSON.parse(await fs.readFile(context.orcaMachineConfigFile, 'utf8'));
    const filamentProfile = JSON.parse(await fs.readFile(context.orcaFilamentConfigFile, 'utf8'));
    if (!Array.isArray(machineProfile.nozzle_diameter)
        || machineProfile.nozzle_diameter.map(String).join(',') !== config.nozzle_diameter) {
        throw unverified('Native nozzle differs from the selected machine snapshot.');
    }
    if (nativeName(config.print_settings_id) !== processProfile.name
        || nativeName(config.filament_settings_id) !== filamentProfile.name) {
        throw unverified('Native process or filament differs from selected snapshots.');
    }
    if (!Number.isFinite(result.layer_height) || Math.abs(result.layer_height - applied.layer_height_mm) > 1e-6
        || result.sparse_infill_density !== applied.infill_percent) throw unverified('Native result settings disagree.');
    const info = context.workspace.getOutputCandidateInfo(context.outputCandidate);
    const printer = getBambuPrinter(context.profileOverrides?.bambuPrinter);
    const source = { ...context.sourceEvidence.source, sliced_geometry_sha256: await hashFile(context.processableFile) };
    const profiles = { printer: printer.id, machine: nativeName(config.printer_settings_id),
        process: nativeName(config.print_settings_id), filament: nativeName(config.filament_settings_id),
        effective_profile_sha256: effectiveProfileSha256, bundle_sha256: generation.bundle_sha256,
        machine_sha256: await hashFile(context.orcaMachineConfigFile),
        process_sha256: await hashFile(runtimeConfigFile), filament_sha256: await hashFile(context.orcaFilamentConfigFile),
        nozzle_diameter_mm: Number(config.nozzle_diameter.split(',')[0]),
        extruder_mode: 'single_filament_first_extruder', bed_type: printer.bedType };
    const scope = { kind: 'single_part', object_count: 1, instance_count: 1, plate_count: 1, filament_count: 1, quantity: 1 };
    const geometry = { valid: true, watertight: true, winding_consistent: true, component_count: 1,
        volume_mm3: finalGeometry.volume_mm3, volume_source: finalGeometry.volume_source, model_transform: context.modelTransform };
    const jobIdentity = { engine: generation.engine, profiles, applied, source, geometry, scope };
    const artifactStat = await fs.stat(generated.artifactPath);
    const gcodeSha256 = await hashFile(generated.statsPath);
    await verifyBambuArtifact(generated.artifactPath, gcodeSha256);
    const receipt = { schema: 'r3d-technical-receipt-v1', request_id: context.requestId,
        job_id: info.jobId, measurement_generation: generation.measurement_generation,
        source, engine: generation.engine, profiles, applied, geometry, scope,
        estimates: { print_time_seconds: stats.print_time_seconds, print_time_source: stats.print_time_source,
            time_basis: 'including_start_sequence', material_used_g: stats.material_used_g,
            // result.json main_predication and the G-code model-time header have
            // different flush/start accounting. No public subtotal is inferred.
            material_used_g_source: stats.material_used_g_source, model_time_seconds: null,
            preparation_time_seconds: null,
            support_material_g: null, calibration: 'raw_slicer_estimate' },
        artifact: { id: info.artifactId, sha256: await hashFile(generated.artifactPath), size_bytes: artifactStat.size,
            media_type: 'model/3mf', extension: '.gcode.3mf', gcode_sha256: gcodeSha256,
            access: 'artifact_audience', retention_seconds: policy.ARTIFACT_TTL_MS / 1000 },
        warnings: collectWarnings(result, plate, context.modelTransform, nativeResult),
        identity: { schema: 'r3d-slice-identity-v1', job_sha256: hashValue(jobIdentity), processing_schema: PROCESSING_SCHEMA } };
    receipt.receipt_sha256 = hashValue(receipt);
    return receipt;
}

module.exports = { buildBambuReceipt, validateAppliedConfig, validateNativeScope, assertExpectedIdentity, parseConfig, collectWarnings };
