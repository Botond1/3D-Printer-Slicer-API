'use strict';

/**
 * A JavaScript port of the LIVE plugin's (`r3d-quote` build `29a4a1c7`)
 * validators of the slicer's answers, so the slicer's own CI can prove that
 * every answer it gives is still read the way the shop reads it today.
 *
 * Ported, rule for rule (the PHP files and their sha256 are in
 * SOURCE-PINS.json):
 *  - `json_decode($body, true)`: integers and floats stay distinct (an integer
 *    literal is a BigInt, a float a Number), objects keep their member order
 *    and PHP's integer-like keys, `{}` and `[]` are both an empty array;
 *  - `IdentitySignature::technicalReceipt()` / `javascriptJson()`;
 *  - `TechnicalReceipt::validate()` with its closed enums;
 *  - `HttpSlicerClient::toSliceResult()`, `interpretAnswer()`, `answer()`,
 *    `machineCode()`, `mapErrorCode()`, `gatewayGap()` and
 *    `SlicerContract::assert()`;
 *  - `AsyncSliceAcceptance::fromResponse()`, `AsyncSliceStatus::fromResponse()`;
 *  - `QuoteService::classifyFailure()` (the ordered substring classifier).
 *
 * Every function is pure. A refusal throws `PluginRefusal` with the plugin's
 * own error code (and, for the receipt, the rule it names).
 */

const { createHash } = require('node:crypto');

class PluginRefusal extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.code = code;
        this.context = context;
    }
}

// ------------------------------------------------------------ json_decode

/** A PHP array: ordered keys, integer-like keys normalized to integers. */
class PhpArray extends Map {}

function phpKey(key) {
    if (typeof key === 'number') return key;
    if (/^(?:0|-?[1-9][0-9]*)$/.test(key)) {
        const value = BigInt(key);
        if (value >= -(2n ** 63n) && value < 2n ** 63n) return Number.isSafeInteger(Number(key)) ? Number(key) : key;
    }
    return key;
}

/**
 * `json_decode($text, true)`. Returns `undefined` where PHP returns null for
 * invalid JSON (a decoded JSON `null` is `null`).
 */
function phpJsonDecode(text) {
    const source = String(text);
    let index = 0;
    const fail = () => { throw new SyntaxError('invalid'); };
    const ws = () => { while (index < source.length && ' \t\n\r'.includes(source[index])) index += 1; };
    function string() {
        index += 1;
        let out = '';
        while (index < source.length) {
            const character = source[index];
            if (character === '"') { index += 1; return out; }
            if (character < ' ') fail();
            if (character === '\\') {
                const escape = source[index + 1];
                index += 2;
                const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
                if (Object.hasOwn(simple, escape)) { out += simple[escape]; continue; }
                if (escape !== 'u') fail();
                const hex = source.slice(index, index + 4);
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
                index += 4;
                const unit = parseInt(hex, 16);
                if (unit >= 0xd800 && unit <= 0xdbff) {
                    const low = /^\\u([dD][c-fC-F][0-9a-fA-F]{2})$/.exec(source.slice(index, index + 6));
                    if (!low) fail();
                    index += 6;
                    out += String.fromCharCode(unit, parseInt(low[1], 16));
                } else if (unit >= 0xdc00 && unit <= 0xdfff) {
                    fail();
                } else {
                    out += String.fromCharCode(unit);
                }
                continue;
            }
            out += character;
            index += 1;
        }
        return fail();
    }
    function number() {
        const match = /^-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(source.slice(index));
        if (!match) fail();
        index += match[0].length;
        if (match[1] === undefined && match[2] === undefined) {
            const value = BigInt(match[0]);
            if (value >= -(2n ** 63n) && value < 2n ** 63n) return value;
        }
        return Number(match[0]);
    }
    function value() {
        ws();
        const character = source[index];
        if (character === '{') {
            index += 1;
            const out = new PhpArray();
            ws();
            if (source[index] === '}') { index += 1; return out; }
            for (;;) {
                ws();
                if (source[index] !== '"') fail();
                const key = string();
                ws();
                if (source[index] !== ':') fail();
                index += 1;
                out.set(phpKey(key), value());
                ws();
                if (source[index] === ',') { index += 1; continue; }
                if (source[index] === '}') { index += 1; return out; }
                fail();
            }
        }
        if (character === '[') {
            index += 1;
            const out = new PhpArray();
            ws();
            if (source[index] === ']') { index += 1; return out; }
            for (let position = 0; ; position += 1) {
                out.set(position, value());
                ws();
                if (source[index] === ',') { index += 1; continue; }
                if (source[index] === ']') { index += 1; return out; }
                fail();
            }
        }
        if (character === '"') return string();
        if (source.startsWith('true', index)) { index += 4; return true; }
        if (source.startsWith('false', index)) { index += 5; return false; }
        if (source.startsWith('null', index)) { index += 4; return null; }
        return number();
    }
    try {
        const result = value();
        ws();
        if (index !== source.length) return undefined;
        return result;
    } catch (error) {
        if (error instanceof SyntaxError) return undefined;
        throw error;
    }
}

/** A JavaScript value as `json_decode` would have returned it (for fixtures built in JS). */
function fromJs(value) {
    return phpJsonDecode(JSON.stringify(value));
}

const isArray = (value) => value instanceof PhpArray;
const isInt = (value) => typeof value === 'bigint';
const isFloat = (value) => typeof value === 'number';
const isString = (value) => typeof value === 'string';
const isNumber = (value) => (isInt(value) || isFloat(value)) && Number.isFinite(Number(value));
const toFloat = (value) => (isInt(value) ? Number(value) : isFloat(value) ? value
    : isString(value) && isNumericString(value) ? Number(value.trim()) : value === true ? 1 : 0);

/** `$array[$key] ?? null`. */
function get(value, key) {
    if (!isArray(value)) return null;
    const result = value.get(phpKey(key));
    return result === undefined ? null : result;
}

/** `array_key_exists($key, $array)`. */
function has(value, key) {
    return isArray(value) && value.has(phpKey(key));
}

function at(value, path) {
    let current = value;
    for (const key of path.split('.')) {
        if (!isArray(current) || !current.has(phpKey(key))) return null;
        current = current.get(phpKey(key));
    }
    return current;
}

function isList(value) {
    let expected = 0;
    for (const key of value.keys()) {
        if (key !== expected) return false;
        expected += 1;
    }
    return true;
}

/** PHP 8 `is_numeric()` for a string. */
function isNumericString(value) {
    return /^[ \t\n\r\v\f]*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\r\v\f]*$/.test(value);
}

/** PHP `===` between decoded values (scalars; arrays by key order and values). */
function same(left, right) {
    if (isArray(left) || isArray(right)) {
        if (!isArray(left) || !isArray(right) || left.size !== right.size) return false;
        const a = [...left.entries()];
        const b = [...right.entries()];
        return a.every(([key, value], position) => b[position][0] === key && same(value, b[position][1]));
    }
    return left === right;
}

const phpTrim = (value) => value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');

// ------------------------------------------------- IdentitySignature

function javascriptNumber(value) {
    if (!Number.isFinite(value)) throw new PluginRefusal('r3d_receipt_number_not_finite', 'non-finite number');
    if (value === 0) return '0';
    return String(value);
}

function compareBytes(left, right) {
    return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'));
}

/** `IdentitySignature::javascriptJson()`. */
function javascriptJson(value) {
    if (isArray(value)) {
        if (isList(value)) return `[${[...value.values()].map(javascriptJson).join(',')}]`;
        const keys = [...value.keys()].sort(compareBytes);
        return `{${keys.map((key) => `${JSON.stringify(String(key))}:${javascriptJson(value.get(key))}`).join(',')}}`;
    }
    if (value === null) return 'null';
    if (value === true || value === false) return value ? 'true' : 'false';
    if (isInt(value)) return value.toString();
    if (isFloat(value)) return javascriptNumber(value);
    if (isString(value)) return JSON.stringify(value);
    throw new PluginRefusal('r3d_receipt_value_unsupported', 'unsupported value');
}

/** `IdentitySignature::technicalReceipt()`. */
function technicalReceiptDigest(payload) {
    return createHash('sha256').update(javascriptJson(payload), 'utf8').digest('hex');
}

// ------------------------------------------------- TechnicalReceipt

const RECEIPT_SCHEMA = 'r3d-technical-receipt-v1';
const SCALE_ECHO_HALF_UNIT = 0.0005;
const ROTATION_ECHO_HALF_UNIT = 0.0000005;
const ECHO_EPSILON = 1e-9;
const DIGEST = /^[a-f0-9]{64}$/;

function receiptRequire(ok, rule = 'receipt', observed = null) {
    if (ok) return;
    throw new PluginRefusal('r3d_contract_receipt_invalid',
        `Native technical receipt or its request binding is invalid (rule: ${rule}).`, { receipt_rule: rule, receipt_observed: observed });
}

const digest = (value) => isString(value) && DIGEST.test(value);
const echoes = (observed, requested, halfUnit) => isNumber(observed) && Math.abs(Number(observed) - requested) <= halfUnit + ECHO_EPSILON;

/** `TechnicalReceipt::infill()`. */
function receiptInfill(value) {
    if (isInt(value) && value >= 0n && value <= 100n) return Number(value);
    const match = isString(value) ? /^(0|[1-9][0-9]?|100)%$/.exec(value) : null;
    return match ? Number(match[1]) : null;
}

function validateGeometryDescription(r) {
    receiptRequire(typeof at(r, 'geometry.watertight') === 'boolean', 'geometry.watertight', at(r, 'geometry.watertight'));
    receiptRequire(typeof at(r, 'geometry.winding_consistent') === 'boolean', 'geometry.winding_consistent', at(r, 'geometry.winding_consistent'));
    receiptRequire(['validated_triangle_mesh', 'signed_volume_estimate'].includes(at(r, 'geometry.volume_source')),
        'geometry.volume_source', at(r, 'geometry.volume_source'));
    for (const path of ['geometry.component_count', 'scope.object_count', 'scope.instance_count']) {
        const value = at(r, path);
        receiptRequire(isInt(value) && value >= 1n, path, value);
    }
    for (const path of ['geometry.closed_component_count', 'geometry.open_edge_count', 'geometry.dropped_degenerate_faces', 'geometry.dropped_duplicate_faces']) {
        const value = at(r, path);
        receiptRequire(value === null || (isInt(value) && value >= 0n), path, value);
    }
}

function validateResponseAgreement(response, r, request) {
    const p = request.verifiedProfile;
    receiptRequire(['win32', 'linux', 'darwin'].includes(at(r, 'engine.platform')), 'engine.platform', at(r, 'engine.platform'));
    receiptRequire(isString(get(r, 'job_id')) && get(r, 'job_id') !== '' && get(response, 'job_id') === get(r, 'job_id'), 'job_id');
    receiptRequire(isString(at(r, 'artifact.id')) && at(r, 'artifact.id') !== '' && get(response, 'artifact_id') === at(r, 'artifact.id'), 'artifact.id');
    for (const [top, receipt] of Object.entries({ printer: 'printer', machine_profile: 'machine', process_profile: 'process',
        filament_profile: 'filament', bed_type: 'bed_type' })) {
        const value = at(r, `profiles.${receipt}`);
        receiptRequire(isString(value) && value !== '' && at(response, `profiles.${top}`) === value, `response.profiles.${top}`, at(response, `profiles.${top}`));
    }
    receiptRequire(['stl', 'obj', '3mf', 'step', 'stp', 'igs', 'iges', 'ply', 'zip'].includes(at(r, 'source.format')), 'source.format', at(r, 'source.format'));
    receiptRequire(isString(at(r, 'source.unit_source')) && at(r, 'source.unit_source') !== '', 'source.unit_source', at(r, 'source.unit_source'));
    for (const [key, expected] of Object.entries({ success: true, technology: 'FDM', slicer_engine: 'bambu',
        engine_version: p.engineVersion, material: request.material, supports: request.supports })) {
        receiptRequire(get(response, key) === expected, `response.${key}`, get(response, key));
    }
    receiptRequire(receiptInfill(get(response, 'infill')) === request.infill, 'response.infill', get(response, 'infill'));
    receiptRequire(at(response, 'profiles.effective_profile_sha256') === p.profileHash, 'response.profiles.effective_profile_sha256');
    for (const [path, expected] of [['applied.layer_height_mm', request.layerHeight],
        ['estimates.print_time_seconds', at(response, 'stats.print_time_seconds')],
        ['estimates.material_used_g', at(response, 'stats.material_used_g')]]) {
        const value = at(r, path);
        receiptRequire(isNumber(value) && isNumber(expected) && Number(value) === Number(expected), path, value);
    }
    receiptRequire(isNumber(get(response, 'applied_layer_height_mm')) && Number(get(response, 'applied_layer_height_mm')) === request.layerHeight,
        'response.applied_layer_height_mm', get(response, 'applied_layer_height_mm'));
    receiptRequire(at(response, 'stats.print_time_source') === at(r, 'estimates.print_time_source'), 'response.stats.print_time_source');
    receiptRequire(at(response, 'stats.material_used_g_source') === at(r, 'estimates.material_used_g_source'), 'response.stats.material_used_g_source');
}

/**
 * `TechnicalReceipt::validate()`.
 * @param {PhpArray} response Decoded slice answer.
 * @param {object} request `SliceRequest` (see README of the fixtures).
 * @returns {PhpArray} The receipt.
 */
function validateTechnicalReceipt(response, request) {
    const r = get(response, 'technical_receipt');
    receiptRequire(isArray(r) && get(r, 'schema') === RECEIPT_SCHEMA, 'schema', isArray(r) ? get(r, 'schema') : null);
    const hash = get(r, 'receipt_sha256');
    receiptRequire(digest(hash), 'receipt_sha256');
    const body = new PhpArray(r);
    body.delete('receipt_sha256');
    receiptRequire(hash === technicalReceiptDigest(body), 'receipt_sha256.digest');
    const p = request.verifiedProfile;
    receiptRequire(p !== null && p !== undefined && p.engine === 'bambu' && p.generation !== '', 'request.verified_profile');
    for (const path of ['source.sha256', 'source.normalized_geometry_sha256', 'source.sliced_geometry_sha256',
        'engine.build_sha256', 'profiles.effective_profile_sha256', 'profiles.bundle_sha256', 'profiles.machine_sha256',
        'profiles.process_sha256', 'profiles.filament_sha256', 'applied.configuration_sha256', 'artifact.sha256',
        'artifact.gcode_sha256', 'identity.job_sha256', 'measurement_generation']) {
        receiptRequire(digest(at(r, path)), path, at(r, path));
    }
    const expectations = {
        request_id: request.requestId, 'source.sha256': request.sourceSha256,
        'source.units': 'mm', 'engine.name': 'bambu', 'engine.version': p.engineVersion,
        'engine.build_sha256': p.buildHash, 'profiles.bundle_sha256': p.bundleHash,
        measurement_generation: p.generation, 'profiles.printer': p.filename,
        'profiles.process': p.processProfile, 'profiles.effective_profile_sha256': p.profileHash,
        'profiles.extruder_mode': 'single_filament_first_extruder',
        'applied.material': request.material, 'applied.infill_percent': BigInt(request.infill),
        'applied.supports': request.supports, 'applied.evidence': 'bambu_gcode_config',
        'geometry.valid': true,
        'scope.kind': 'single_part', 'scope.plate_count': 1n, 'scope.filament_count': 1n, 'scope.quantity': 1n,
        'estimates.time_basis': 'including_start_sequence', 'estimates.calibration': 'raw_slicer_estimate',
        'estimates.print_time_source': 'total_estimated_time', 'estimates.material_used_g_source': 'total_filament_weight_g',
        'artifact.media_type': 'model/3mf', 'artifact.extension': '.gcode.3mf', 'artifact.access': 'artifact_audience',
        'identity.schema': 'r3d-slice-identity-v1', 'identity.processing_schema': 'r3d-bambu-processing-v1'
    };
    for (const [path, expected] of Object.entries(expectations)) receiptRequire(same(at(r, path), expected), path, at(r, path));
    validateGeometryDescription(r);
    for (const role of ['machine', 'process', 'filament']) {
        const entries = p.components.filter((component) => component.role === role);
        receiptRequire(entries.length === 1 && at(r, `profiles.${role}`) === (entries[0].basename ?? null), `profiles.${role}`, at(r, `profiles.${role}`));
    }
    validateResponseAgreement(response, r, request);
    for (const path of ['geometry.volume_mm3', 'profiles.nozzle_diameter_mm', 'artifact.size_bytes', 'artifact.retention_seconds']) {
        receiptRequire(isNumber(at(r, path)) && Number(at(r, path)) > 0, path, at(r, path));
    }
    const estimates = get(r, 'estimates');
    for (const key of ['model_time_seconds', 'preparation_time_seconds', 'support_material_g']) {
        receiptRequire(has(estimates, key), `estimates.${key}`);
        const value = get(estimates, key);
        receiptRequire(value === null || (isNumber(value) && Number(value) >= 0), `estimates.${key}`, value);
    }
    const transform = at(r, 'geometry.model_transform');
    const responseTransform = has(response, 'model_transform') && get(response, 'model_transform') !== null ? get(response, 'model_transform') : new PhpArray();
    receiptRequire(isArray(transform) && technicalReceiptDigest(transform) === technicalReceiptDigest(responseTransform), 'geometry.model_transform');
    receiptRequire(same(get(transform, 'transform_schema'), 2n), 'geometry.model_transform.transform_schema', get(transform, 'transform_schema'));
    receiptRequire(get(transform, 'size_unit') === request.sizeUnit, 'geometry.model_transform.size_unit', get(transform, 'size_unit'));
    receiptRequire(get(transform, 'orientation_mode') === request.orientationMode, 'geometry.model_transform.orientation_mode', get(transform, 'orientation_mode'));
    for (const [axis, degrees] of [['x', request.rotationX], ['y', request.rotationY], ['z', request.rotationZ]]) {
        receiptRequire(echoes(at(transform, `requested_rotation_deg.${axis}`), degrees, ROTATION_ECHO_HALF_UNIT),
            `geometry.model_transform.requested_rotation_deg.${axis}`, at(transform, `requested_rotation_deg.${axis}`));
        receiptRequire(echoes(at(transform, `scale_factors.${axis}`), (request.scalePercent ?? 100) / 100, SCALE_ECHO_HALF_UNIT),
            `geometry.model_transform.scale_factors.${axis}`, at(transform, `scale_factors.${axis}`));
    }
    const warnings = get(r, 'warnings');
    receiptRequire(isArray(warnings) && warnings.size <= 32, 'warnings', isArray(warnings) ? warnings.size : null);
    for (const warning of warnings.values()) {
        const code = get(warning, 'code');
        receiptRequire(isString(code) && /^[A-Z0-9_]{1,80}$/.test(code), 'warnings.code', code);
        receiptRequire(get(warning, 'severity') === 'warning', 'warnings.severity', get(warning, 'severity'));
        receiptRequire(['native', 'geometry', 'orientation'].includes(get(warning, 'source')), 'warnings.source', get(warning, 'source'));
    }
    return r;
}

// ------------------------------------------------- SlicerContract / toSliceResult

const ALLOWED_LAYER_HEIGHTS = [0.1, 0.2, 0.3];

function positiveNumber(value) {
    return (isInt(value) || isFloat(value) || (isString(value) && isNumericString(value)))
        && Number.isFinite(toFloat(value)) && toFloat(value) > 0;
}

function responseInfill(value) {
    return receiptInfill(value);
}

/** `HttpSlicerClient::toSliceResult()`. */
function toSliceResult(request, decoded) {
    const stats = isArray(get(decoded, 'stats')) ? get(decoded, 'stats') : new PhpArray();
    const printTime = get(stats, 'print_time_seconds');
    if (!positiveNumber(printTime) || toFloat(printTime) > 9223372036854775807
        || Math.floor(toFloat(printTime)) !== toFloat(printTime) || !positiveNumber(get(stats, 'material_used_m'))) {
        throw new PluginRefusal('r3d_contract_stats_invalid', 'Missing or invalid print time / filament length.');
    }
    if (!positiveNumber(get(stats, 'material_used_g'))) {
        throw new PluginRefusal('r3d_contract_filament_g_not_positive', 'The slice has no positive finite mass in grams.');
    }
    const engineVersion = get(decoded, 'engine_version');
    const profileHash = at(decoded, 'profiles.effective_profile_sha256');
    const timeSource = get(stats, 'print_time_source');
    if (!isString(engineVersion) || phpTrim(engineVersion) === ''
        || !isString(profileHash) || !DIGEST.test(profileHash)
        || !['total_estimated_time', 'm73_p0_r_minutes', 'estimated_printing_time', 'time_seconds'].includes(timeSource)
        || get(decoded, 'slicer_engine') !== (request.verifiedProfile?.engine ?? 'prusa')
        || get(decoded, 'technology') !== request.technology
        || get(decoded, 'material') !== request.material
        || responseInfill(get(decoded, 'infill')) !== request.infill
        || get(decoded, 'supports') !== request.supports) {
        throw new PluginRefusal('r3d_contract_provenance_invalid', 'Missing or inconsistent response provenance/configuration.');
    }
    if (request.verifiedProfile && (engineVersion !== request.verifiedProfile.engineVersion
        || profileHash !== request.verifiedProfile.profileHash)) {
        throw new PluginRefusal('r3d_contract_profile_changed', 'The deployed profile changed during this slice.');
    }
    if (request.verifiedProfile?.engine === 'bambu') validateTechnicalReceipt(decoded, request);
    const transform = isArray(get(decoded, 'model_transform')) ? get(decoded, 'model_transform') : new PhpArray();
    const finalDims = isArray(get(transform, 'final_dimensions_mm')) ? get(transform, 'final_dimensions_mm') : null;
    const buildVolume = isArray(get(decoded, 'build_volume_limits_mm')) ? get(decoded, 'build_volume_limits_mm') : null;
    let refusedAxes = [];
    const envelope = {};
    for (const axis of ['x', 'y', 'z']) {
        if (!positiveNumber(get(finalDims, axis)) || !positiveNumber(at(buildVolume, `max.${axis}`))) {
            throw new PluginRefusal('r3d_contract_dimensions_invalid', 'Transformed dimensions must fit the verified profile.');
        }
        envelope[axis] = request.verifiedProfile
            ? Math.min(toFloat(at(buildVolume, `max.${axis}`)), request.verifiedProfile.limits[axis])
            : toFloat(at(buildVolume, `max.${axis}`));
        if (toFloat(get(finalDims, axis)) > envelope[axis]) refusedAxes.push(axis);
    }
    if (refusedAxes.length > 0 && !refusedAxes.includes('z') && request.verifiedProfile) {
        for (const footprint of request.verifiedProfile.alternativeFootprints || []) {
            if (toFloat(get(finalDims, 'x')) <= footprint.x && toFloat(get(finalDims, 'y')) <= footprint.y) { refusedAxes = []; break; }
        }
    }
    if (refusedAxes.length > 0) {
        throw new PluginRefusal('r3d_contract_dimensions_invalid', 'Transformed dimensions must fit the verified profile.', { refused_axes: refusedAxes });
    }
    return {
        status: 'succeeded',
        technology: get(decoded, 'technology'),
        engine: get(decoded, 'slicer_engine'),
        engineVersion,
        printTimeS: Math.trunc(toFloat(printTime)),
        printTimeSource: timeSource,
        filamentLenM: toFloat(get(stats, 'material_used_m')),
        filamentG: toFloat(get(stats, 'material_used_g')),
        effectiveProfileSha256: profileHash
    };
}

/** `SlicerContract::assert()`. */
function assertSliceContract(request, result) {
    if (result.status !== 'succeeded') throw new PluginRefusal('r3d_contract_status_not_succeeded', 'not succeeded');
    if (result.technology !== request.technology) throw new PluginRefusal('r3d_contract_technology_mismatch', 'technology');
    if (result.printTimeS <= 0) throw new PluginRefusal('r3d_contract_print_time_invalid', 'print time');
    if (!Number.isFinite(result.filamentLenM) || result.filamentLenM <= 0) throw new PluginRefusal('r3d_contract_filament_length_invalid', 'length');
    if (!Number.isFinite(result.filamentG) || result.filamentG <= 0) throw new PluginRefusal('r3d_contract_filament_g_not_positive', 'grams');
    if (!ALLOWED_LAYER_HEIGHTS.some((allowed) => Math.abs(request.layerHeight - allowed) < 0.0005)) {
        throw new PluginRefusal('r3d_contract_layer_height_out_of_domain', 'layer');
    }
    if (request.infill < 0 || request.infill > 100 || request.sizeUnit !== 'mm'
        || phpTrim(request.material) === '' || phpTrim(request.printerProfile) === '') {
        throw new PluginRefusal('r3d_contract_configuration_invalid', 'configuration');
    }
}

// ------------------------------------------------- codes

/** `HttpSlicerClient::machineCode()`: `errorCode`, else `code`. */
function machineCode(decoded) {
    if (!isArray(decoded)) return null;
    const errorCode = get(decoded, 'errorCode');
    const code = errorCode !== null ? errorCode : get(decoded, 'code');
    return isString(code) ? code : null;
}

const DEADLINE_EXCEEDED_CODE = 'r3d_slicer_deadline_exceeded';

/** `HttpSlicerClient::mapErrorCode()`: `code` → `errorCode` → `error.code`, [A-Za-z0-9_]{1,53}. */
function mapErrorCode(status, body) {
    const decoded = phpJsonDecode(body);
    if (isArray(decoded)) {
        for (const key of ['code', 'errorCode', 'error']) {
            let value = get(decoded, key);
            if (isArray(value)) value = get(value, 'code');
            else if (key === 'error') continue;
            if (isString(value) && /^[A-Za-z0-9_]{1,53}$/.test(value)) {
                if (value === 'SLICE_DEADLINE_EXCEEDED') return DEADLINE_EXCEEDED_CODE;
                return `r3d_slicer_${value.toLowerCase()}`;
            }
        }
    }
    return `r3d_slicer_http_${status}`;
}

function gatewayGap(status, body) {
    return [502, 503, 504].includes(status) && mapErrorCode(status, body) === `r3d_slicer_http_${status}`;
}

// ------------------------------------------------- QuoteService::classifyFailure

const OUTAGE_CODES = Object.freeze(['r3d_geometry_sig_missing', 'r3d_effective_geometry_sig_invalid', 'r3d_job_params_missing',
    'r3d_job_orphaned', 'r3d_slicer_unhealthy', 'r3d_slice_budget_exceeded', 'r3d_slicer_deadline_exceeded',
    'r3d_slicer_async_lost', 'r3d_derived_layer_unpinned']);
const OUTAGE_PREFIXES = Object.freeze(['r3d_upload_', 'r3d_contract_', 'r3d_profile_']);
const OUTAGE_MARKERS = Object.freeze(['timeout', 'breaker', 'circuit', 'unhealthy', 'unavailable', 'orphaned', 'missing',
    'rate_limit', 'transport', 'auth']);
const GEOMETRY_CODES = Object.freeze(['r3d_slicer_invalid_source_geometry', 'r3d_slicer_unsliceable_source_geometry',
    'r3d_slicer_ambiguous_manufacturing_scope']);
const OUT_OF_BOUNDS_CODE = 'r3d_slicer_model_out_of_printer_bounds';
const DIMENSIONS_REFUSED_CODE = 'r3d_contract_dimensions_invalid';

/** @returns {'out_of_bounds'|'slicer_down'|'geometry_rejected'} The `RfqReason` value. */
function classifyFailure(errorCode) {
    const code = String(errorCode ?? '').toLowerCase();
    const contains = (words) => words.some((word) => code.includes(word));
    if (code === DIMENSIONS_REFUSED_CODE) return 'out_of_bounds';
    if (OUTAGE_CODES.includes(code) || OUTAGE_PREFIXES.some((prefix) => code.startsWith(prefix)) || contains(OUTAGE_MARKERS)) return 'slicer_down';
    if (GEOMETRY_CODES.includes(code)) return 'geometry_rejected';
    if (code === OUT_OF_BOUNDS_CODE || (code.startsWith('r3d_slicer_') && contains(['bound', 'envelope', 'bed']))) return 'out_of_bounds';
    return 'slicer_down';
}

// ------------------------------------------------- async

const JOB_ID_PATTERN = /^sj_[0-9a-f]{32}$/;

function retryAfterHeader(header) {
    const value = Array.isArray(header) ? header[0] : header;
    if ((typeof value === 'number' && Number.isInteger(value)) || (typeof value === 'string' && /^\s*[0-9]{1,6}\s*$/.test(value))) {
        return Math.max(1, parseInt(String(value), 10));
    }
    return null;
}

const nonNegativeInt = (value) => (isInt(value) && value >= 0n ? Number(value) : null);

/** `AsyncSliceAcceptance::fromResponse()`. */
function asyncAcceptance(body, retryAfter, engine) {
    const decoded = phpJsonDecode(body);
    const jobId = isArray(decoded) ? get(decoded, 'job_id') : null;
    const status = isArray(decoded) ? get(decoded, 'status') : null;
    const statusUrl = isArray(decoded) ? get(decoded, 'status_url') : null;
    const valid = isArray(decoded) && get(decoded, 'success') === true && same(get(decoded, 'async_contract'), 1n)
        && isString(jobId) && JOB_ID_PATTERN.test(jobId) && ['queued', 'running'].includes(status)
        && (statusUrl === null || statusUrl === `/${engine}/slice/jobs/${jobId}`);
    if (!valid) throw new PluginRefusal('r3d_slicer_malformed_response', 'unusable 202 body');
    return { jobId, status, pollAfterMs: nonNegativeInt(get(decoded, 'poll_after_ms')), retryAfterSeconds: retryAfterHeader(retryAfter),
        deadlineMs: nonNegativeInt(get(decoded, 'deadline_ms')) };
}

/** `AsyncSliceStatus::fromResponse()` (and the 401/403 short cut of `HttpSlicerClient::status()`). */
function asyncStatus(httpStatus, body, retryAfter, jobId) {
    const retry = retryAfterHeader(retryAfter);
    if (httpStatus === 404) return { kind: 'not_found', detail: 'http_404' };
    if (httpStatus === 401 || httpStatus === 403) return { kind: 'unauthorized', detail: `http_${httpStatus}`, errorCode: mapErrorCode(httpStatus, body) };
    if (httpStatus !== 200) return { kind: 'unavailable', detail: `http_${httpStatus}`, retryAfterSeconds: retry };
    const decoded = phpJsonDecode(body);
    if (!isArray(decoded) || get(decoded, 'success') !== true || !same(get(decoded, 'async_contract'), 1n) || get(decoded, 'job_id') !== jobId) {
        return { kind: 'unavailable', detail: 'unrecognised_body', retryAfterSeconds: retry };
    }
    const status = get(decoded, 'status');
    if (status === 'queued' || status === 'running') {
        const position = get(decoded, 'queue_position');
        return { kind: 'pending', detail: `remote_${status}`, remoteStatus: status, pollAfterMs: nonNegativeInt(get(decoded, 'poll_after_ms')),
            queuePosition: isInt(position) && position >= 1n ? Number(position) : null, elapsedMs: nonNegativeInt(get(decoded, 'elapsed_ms')) };
    }
    if (status !== 'completed') return { kind: 'unavailable', detail: 'remote_status_unknown', retryAfterSeconds: retry };
    const resultStatus = get(decoded, 'result_status');
    const result = get(decoded, 'result');
    if (!isInt(resultStatus) || resultStatus < 100n || resultStatus > 599n || !isArray(result) || (result.size > 0 && isList(result))) {
        return { kind: 'malformed', detail: 'completed_without_result' };
    }
    const resultRetry = nonNegativeInt(get(decoded, 'result_retry_after_seconds'));
    return { kind: 'completed', detail: `completed_${resultStatus}`, resultStatus: Number(resultStatus), result,
        resultRetryAfterSeconds: resultRetry === null ? null : Math.max(1, resultRetry), elapsedMs: nonNegativeInt(get(decoded, 'elapsed_ms')) };
}

// ------------------------------------------------- the result path

/**
 * `HttpSlicerClient::interpretAnswer()`: a synchronous answer or a finished
 * job's `result_status` + `result`. Returns the slice result, or throws the
 * plugin's refusal with `breakerStrike` in its context.
 */
function interpretAnswer(request, status, body, decoded, { finished = false } = {}) {
    if (status === 429) throw new PluginRefusal('r3d_rate_limited', 'Slicer API returned 429.', { breakerStrike: true });
    if (status >= 500) throw new PluginRefusal(mapErrorCode(status, body), `HTTP ${status}`, { breakerStrike: !finished, finished });
    if (status !== 200) throw new PluginRefusal(mapErrorCode(status, body), `HTTP ${status}`, { breakerStrike: false });
    if (!isArray(decoded) || get(decoded, 'success') !== true) {
        throw new PluginRefusal('r3d_slicer_malformed_response', 'unsuccessful 200', { breakerStrike: true });
    }
    const result = toSliceResult(request, decoded);
    assertSliceContract(request, result);
    return result;
}

/**
 * `HttpSlicerClient::answer()` for a slice submission.
 * @returns {{kind: 'accepted', acceptance: object}|{kind: 'result', result: object}} Outcome (refusals throw).
 */
function readSubmission(request, { status, body, retryAfter = null, preferAsync = false, provenAsync = false, engine = 'bambu' }) {
    const decoded = phpJsonDecode(body);
    if (preferAsync && status === 202) return { kind: 'accepted', acceptance: asyncAcceptance(body, retryAfter, engine) };
    const noRoom = status === 429 || (status === 503 && machineCode(decoded) === 'SLICE_QUEUE_FULL');
    if (preferAsync && noRoom && (provenAsync || machineCode(decoded) === 'SLICE_ASYNC_JOBS_FULL')) {
        throw new PluginRefusal('r3d_slicer_busy', 'no room; waits and resubmits', { breakerStrike: false, slicer_code: machineCode(decoded) });
    }
    if (gatewayGap(status, body)) throw new PluginRefusal(mapErrorCode(status, body), 'gateway gap', { gateway_gap: true, breakerStrike: 'once' });
    return { kind: 'result', result: interpretAnswer(request, status, body, decoded) };
}

/** `HttpSlicerClient::completed()` after a `completed` poll. */
function readCompleted(request, statusView, resultBody) {
    if (statusView.kind !== 'completed') throw new PluginRefusal('r3d_slicer_malformed_response', 'no finished result');
    return interpretAnswer(request, statusView.resultStatus, resultBody, statusView.result, { finished: true });
}

module.exports = {
    DEADLINE_EXCEEDED_CODE,
    GEOMETRY_CODES,
    OUTAGE_CODES,
    OUTAGE_MARKERS,
    OUTAGE_PREFIXES,
    PhpArray,
    PluginRefusal,
    asyncAcceptance,
    asyncStatus,
    assertSliceContract,
    classifyFailure,
    fromJs,
    gatewayGap,
    interpretAnswer,
    javascriptJson,
    machineCode,
    mapErrorCode,
    phpJsonDecode,
    readCompleted,
    readSubmission,
    technicalReceiptDigest,
    toSliceResult,
    validateTechnicalReceipt
};
