'use strict';

/**
 * Server-owned SLA (MSLA resin) printer registry.
 *
 * `configs/sla/printers.json` names the quoting printer(s), their declared
 * build volume, the quote-only raster used purely for `GET /profiles`
 * disclosure, and the owner-tunable layer-time model used to turn a parsed
 * `.sl1` layer count into a print-time estimate. Prusa's SL1 raster output is
 * never a printable file for these machines; a real print requires an
 * external UVtools conversion to the vendor `.goo`/`.ctb` format. The
 * registry is loaded once, validated strictly, and frozen; a malformed
 * registry refuses startup with a typed error instead of degrading into a
 * guessed time model or resin density.
 */

const path = require('node:path');
const { CONFIGS_DIR } = require('../../config/paths');
const { LAYER_HEIGHTS } = require('../../config/constants');
const { readProfileJson } = require('./profile-readers');

const SLA_PRINTER_REGISTRY_SCHEMA = 'r3d-sla-printer-registry-v1';
const SLA_PRINTER_REGISTRY_ERROR_CODE = 'STARTUP_SLA_REGISTRY_INVALID';
const DEFAULT_REGISTRY_PATH = path.join(CONFIGS_DIR, 'sla', 'printers.json');
const PRINTER_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const PRINTER_NAME_PATTERN = /^[\x20-\x7e]{1,128}$/;
const MATERIAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;
const LAYER_HEIGHT_KEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;
const NOTES_PATTERN = /^[\x20-\x7e]{1,512}$/;
const REGISTRY_KEYS = Object.freeze(['schema', 'default_printer', 'printers']);
const PRINTER_KEYS = Object.freeze([
    'name', 'technology', 'declared_build_volume_mm', 'quote_raster_pixels', 'time_model', 'resins'
]);
const TIME_MODEL_KEYS = Object.freeze([
    'version', 'bottom_layers', 'transition_layers', 'motion_seconds_per_layer',
    'motion_seconds_per_bottom_layer', 'exposure_seconds_by_layer_height',
    'bottom_exposure_seconds', 'notes'
]);
/** Only MSLA/resin printers are represented today. */
const SUPPORTED_TECHNOLOGY = 'MSLA';
/** Required exact layer-height coverage, sourced from the shared SLA constants. */
const REQUIRED_LAYER_HEIGHT_KEYS = Object.freeze(
    LAYER_HEIGHTS.BY_TECHNOLOGY.SLA.map((value) => `${value}`)
);

let cachedRegistry = null;

function registryError(message, cause) {
    const error = new Error(`SLA printer registry is invalid: ${message}`, cause ? { cause } : undefined);
    error.code = SLA_PRINTER_REGISTRY_ERROR_CODE;
    return error;
}

function assertExactKeys(value, expectedKeys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw registryError(`${label} must be a JSON object.`);
    }
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw registryError(`${label} must contain exactly the keys ${expected.join(', ')}.`);
    }
    return value;
}

function assertPositiveFiniteNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw registryError(`${label} must be a positive finite number.`);
    }
    return value;
}

function assertNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
        throw registryError(`${label} must be a non-negative integer.`);
    }
    return value;
}

function assertDimensionTriple(value, label) {
    assertExactKeys(value, ['x', 'y', 'z'], label);
    for (const axis of ['x', 'y', 'z']) assertPositiveFiniteNumber(value[axis], `${label}.${axis}`);
    return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function assertPixelPair(value, label) {
    assertExactKeys(value, ['x', 'y'], label);
    for (const axis of ['x', 'y']) {
        if (!Number.isInteger(value[axis]) || value[axis] <= 0) {
            throw registryError(`${label}.${axis} must be a positive integer.`);
        }
    }
    return Object.freeze({ x: value.x, y: value.y });
}

function validateExposureTable(raw, printerId) {
    const label = `printer ${printerId} time_model.exposure_seconds_by_layer_height`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw registryError(`${label} must be a JSON object.`);
    }
    const keys = Object.keys(raw).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...REQUIRED_LAYER_HEIGHT_KEYS].sort())) {
        throw registryError(`${label} must contain exactly the keys ${REQUIRED_LAYER_HEIGHT_KEYS.join(', ')}.`);
    }
    const table = {};
    for (const key of keys) {
        if (!LAYER_HEIGHT_KEY_PATTERN.test(key)) {
            throw registryError(`${label} key "${key}" is not a canonical decimal.`);
        }
        table[key] = assertPositiveFiniteNumber(raw[key], `${label}["${key}"]`);
    }
    return Object.freeze(table);
}

function validateTimeModel(raw, printerId) {
    const label = `printer ${printerId} time_model`;
    assertExactKeys(raw, TIME_MODEL_KEYS, label);
    if (typeof raw.version !== 'string' || !raw.version.trim()) {
        throw registryError(`${label}.version must be a non-empty string.`);
    }
    if (typeof raw.notes !== 'string' || !NOTES_PATTERN.test(raw.notes)) {
        throw registryError(`${label}.notes must be bounded printable ASCII.`);
    }
    return Object.freeze({
        version: raw.version,
        bottomLayers: assertNonNegativeInteger(raw.bottom_layers, `${label}.bottom_layers`),
        transitionLayers: assertNonNegativeInteger(raw.transition_layers, `${label}.transition_layers`),
        motionSecondsPerLayer: assertPositiveFiniteNumber(
            raw.motion_seconds_per_layer, `${label}.motion_seconds_per_layer`
        ),
        motionSecondsPerBottomLayer: assertPositiveFiniteNumber(
            raw.motion_seconds_per_bottom_layer, `${label}.motion_seconds_per_bottom_layer`
        ),
        bottomExposureSeconds: assertPositiveFiniteNumber(
            raw.bottom_exposure_seconds, `${label}.bottom_exposure_seconds`
        ),
        exposureSecondsByLayerHeight: validateExposureTable(raw.exposure_seconds_by_layer_height, printerId),
        notes: raw.notes
    });
}

function validateResins(raw, printerId) {
    const label = `printer ${printerId} resins`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw registryError(`${label} must be a JSON object.`);
    }
    const entries = Object.entries(raw);
    if (entries.length === 0) {
        throw registryError(`${label} must contain at least one entry.`);
    }
    const resins = {};
    for (const [material, value] of entries) {
        if (!MATERIAL_KEY_PATTERN.test(material)) {
            throw registryError(`${label} material key "${material}" is not canonical.`);
        }
        assertExactKeys(value, ['density_g_cm3'], `${label}["${material}"]`);
        resins[material] = Object.freeze({
            densityGcm3: assertPositiveFiniteNumber(
                value.density_g_cm3, `${label}["${material}"].density_g_cm3`
            )
        });
    }
    return Object.freeze(resins);
}

function validatePrinter(printerId, raw) {
    if (!PRINTER_ID_PATTERN.test(printerId)) {
        throw registryError(`printer id "${printerId}" is not canonical.`);
    }
    assertExactKeys(raw, PRINTER_KEYS, `printer ${printerId}`);
    if (typeof raw.name !== 'string' || !PRINTER_NAME_PATTERN.test(raw.name)) {
        throw registryError(`printer ${printerId} name must be bounded printable ASCII.`);
    }
    if (raw.technology !== SUPPORTED_TECHNOLOGY) {
        throw registryError(`printer ${printerId} technology must be ${SUPPORTED_TECHNOLOGY}.`);
    }
    return Object.freeze({
        id: printerId,
        name: raw.name,
        technology: raw.technology,
        declaredBuildVolumeMm: assertDimensionTriple(
            raw.declared_build_volume_mm, `printer ${printerId} declared_build_volume_mm`
        ),
        quoteRasterPixels: assertPixelPair(
            raw.quote_raster_pixels, `printer ${printerId} quote_raster_pixels`
        ),
        timeModel: validateTimeModel(raw.time_model, printerId),
        resins: validateResins(raw.resins, printerId)
    });
}

/**
 * Validate a parsed registry document into its frozen runtime shape.
 * @param {unknown} raw Parsed JSON document.
 * @returns {Readonly<{schema: string, defaultPrinter: string, printers: Readonly<Record<string, object>>}>} Frozen registry.
 */
function validateSlaPrinterRegistry(raw) {
    assertExactKeys(raw, REGISTRY_KEYS, 'registry');
    if (raw.schema !== SLA_PRINTER_REGISTRY_SCHEMA) {
        throw registryError(`schema must be ${SLA_PRINTER_REGISTRY_SCHEMA}.`);
    }
    if (!raw.printers || typeof raw.printers !== 'object' || Array.isArray(raw.printers)) {
        throw registryError('printers must be a JSON object.');
    }
    const printerEntries = Object.entries(raw.printers);
    if (printerEntries.length === 0 || printerEntries.length > 16) {
        throw registryError('printers must contain between 1 and 16 entries.');
    }
    const printers = {};
    for (const [printerId, printer] of printerEntries) {
        printers[printerId] = validatePrinter(printerId, printer);
    }
    if (typeof raw.default_printer !== 'string' || !Object.hasOwn(printers, raw.default_printer)) {
        throw registryError('default_printer must name a registered printer.');
    }
    return Object.freeze({
        schema: raw.schema,
        defaultPrinter: raw.default_printer,
        printers: Object.freeze(printers)
    });
}

/**
 * Load and validate the registry from disk.
 * @param {{registryPath?: string}} [options] Test seam.
 * @returns {Readonly<object>} Frozen registry.
 */
function loadSlaPrinterRegistry(options = {}) {
    const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
    let raw;
    try {
        raw = readProfileJson(registryPath);
    } catch (cause) {
        throw registryError('the registry file could not be read as bounded JSON.', cause);
    }
    return validateSlaPrinterRegistry(raw);
}

/**
 * Return the process-wide registry, loading it on first use.
 * @param {{registryPath?: string, reload?: boolean}} [options] Test seam.
 * @returns {Readonly<object>} Frozen registry.
 */
function getSlaPrinterRegistry(options = {}) {
    if (!cachedRegistry || options.reload === true || options.registryPath) {
        const loaded = loadSlaPrinterRegistry(options);
        if (!options.registryPath) cachedRegistry = loaded;
        return loaded;
    }
    return cachedRegistry;
}

/**
 * Resolve the default SLA printer id from the registry.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string} Canonical default printer id.
 */
function getDefaultSlaPrinterId(registry = getSlaPrinterRegistry()) {
    return registry.defaultPrinter;
}

/**
 * Return one registered SLA printer or throw when the id is unknown.
 * @param {string} [printerId] Canonical printer id; defaults to the registry default.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {Readonly<object>} Frozen printer entry.
 */
function getSlaPrinter(printerId, registry = getSlaPrinterRegistry()) {
    const resolvedId = printerId || registry.defaultPrinter;
    const printer = registry.printers[resolvedId];
    if (!printer) throw new Error('Unknown SLA printer id.');
    return printer;
}

/**
 * Resolve the frozen layer-time model for a printer.
 * @param {string} [printerId] Canonical printer id; defaults to the registry default.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {Readonly<object>} Frozen time model.
 */
function getSlaTimeModel(printerId, registry = getSlaPrinterRegistry()) {
    return getSlaPrinter(printerId, registry).timeModel;
}

/**
 * List the resin material keys a printer offers, sorted.
 * @param {string} [printerId] Canonical printer id; defaults to the registry default.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string[]} Material keys.
 */
function getSlaMaterials(printerId, registry = getSlaPrinterRegistry()) {
    return Object.keys(getSlaPrinter(printerId, registry).resins).sort();
}

/**
 * Resolve resin density for a material, matched case-insensitively against
 * the registry's resin keys (which mirror the pricing catalogue's SLA
 * material keys: `Standard`, `ABS-Like`, `Flexible`).
 * @param {string} material Requested material key.
 * @param {string} [printerId] Canonical printer id; defaults to the registry default.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {number|null} Resin density in g/cm3, or null when the material is unmapped.
 */
function resolveSlaResinDensity(material, printerId, registry = getSlaPrinterRegistry()) {
    const printer = getSlaPrinter(printerId, registry);
    const normalized = String(material || '').trim().toLowerCase();
    if (!normalized) return null;
    for (const [key, value] of Object.entries(printer.resins)) {
        if (key.toLowerCase() === normalized) return value.densityGcm3;
    }
    return null;
}

module.exports = {
    SLA_PRINTER_REGISTRY_ERROR_CODE,
    SLA_PRINTER_REGISTRY_SCHEMA,
    DEFAULT_REGISTRY_PATH,
    getDefaultSlaPrinterId,
    getSlaMaterials,
    getSlaPrinter,
    getSlaPrinterRegistry,
    getSlaTimeModel,
    loadSlaPrinterRegistry,
    resolveSlaResinDensity,
    validateSlaPrinterRegistry
};
