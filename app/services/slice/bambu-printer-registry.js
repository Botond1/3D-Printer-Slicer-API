'use strict';

/**
 * Server-owned Bambu Studio printer registry.
 *
 * `configs/bambu/printers.json` maps the public printer ids (`P1S`, `H2D`) to
 * the exact vendor profile NAMES that Bambu Studio ships inside its AppImage.
 * The registry is loaded once, validated strictly, and frozen; a malformed
 * registry refuses startup with a typed error instead of degrading into a
 * guessed profile selection.
 */

const path = require('node:path');
const { CONFIGS_DIR } = require('../../config/paths');
const { readProfileJson } = require('./profile-readers');

const BAMBU_PRINTER_REGISTRY_SCHEMA = 'r3d-bambu-printer-registry-v1';
const BAMBU_PRINTER_REGISTRY_ERROR_CODE = 'STARTUP_BAMBU_REGISTRY_INVALID';
const DEFAULT_REGISTRY_PATH = path.join(CONFIGS_DIR, 'bambu', 'printers.json');
const BAMBU_PROFILE_NAME_PATTERN = /^[A-Za-z0-9 @._+-]{1,128}$/;
const PRINTER_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const PRINTER_NAME_PATTERN = /^[\x20-\x7e]{1,128}$/;
const LAYER_KEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;
const MATERIAL_KEY_PATTERN = /^[A-Z][A-Z0-9-]{0,31}$/;
const BED_TYPE_PATTERN = /^[\x20-\x7e]{1,64}$/;
const REGISTRY_KEYS = Object.freeze(['schema', 'default_printer', 'printers']);
const PRINTER_KEYS = Object.freeze(['name', 'machine', 'bed_type', 'processes', 'filaments']);

let cachedRegistry = null;

function registryError(message, cause) {
    const error = new Error(`Bambu printer registry is invalid: ${message}`, cause ? { cause } : undefined);
    error.code = BAMBU_PRINTER_REGISTRY_ERROR_CODE;
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

function assertProfileName(value, label) {
    if (typeof value !== 'string' || !BAMBU_PROFILE_NAME_PATTERN.test(value) || value.trim() !== value) {
        throw registryError(`${label} must be a bounded vendor profile name.`);
    }
    return value;
}

function validateNameMap(map, keyPattern, label, keyLabel) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw registryError(`${label} must be a JSON object.`);
    }
    const entries = Object.entries(map);
    if (entries.length === 0) {
        throw registryError(`${label} must contain at least one entry.`);
    }
    const result = {};
    for (const [key, value] of entries) {
        if (!keyPattern.test(key)) {
            throw registryError(`${label} ${keyLabel} "${key}" is not canonical.`);
        }
        result[key] = assertProfileName(value, `${label} entry "${key}"`);
    }
    return Object.freeze(result);
}

function validateLayerKeys(processes, printerId) {
    const validated = validateNameMap(processes, LAYER_KEY_PATTERN, `printer ${printerId} processes`, 'layer key');
    const numericKeys = new Set();
    for (const key of Object.keys(validated)) {
        const numeric = Number.parseFloat(key);
        if (!Number.isFinite(numeric) || numeric <= 0 || String(numeric) !== key) {
            throw registryError(`printer ${printerId} layer key "${key}" must be a canonical positive decimal.`);
        }
        if (numericKeys.has(numeric)) {
            throw registryError(`printer ${printerId} layer key "${key}" is duplicated.`);
        }
        numericKeys.add(numeric);
    }
    return validated;
}

function validatePrinter(printerId, raw) {
    if (!PRINTER_ID_PATTERN.test(printerId)) {
        throw registryError(`printer id "${printerId}" is not canonical.`);
    }
    assertExactKeys(raw, PRINTER_KEYS, `printer ${printerId}`);
    if (typeof raw.name !== 'string' || !PRINTER_NAME_PATTERN.test(raw.name)) {
        throw registryError(`printer ${printerId} name must be bounded printable ASCII.`);
    }
    if (typeof raw.bed_type !== 'string' || !BED_TYPE_PATTERN.test(raw.bed_type) || raw.bed_type.trim() !== raw.bed_type) {
        throw registryError(`printer ${printerId} bed_type must be bounded printable ASCII.`);
    }
    return Object.freeze({
        id: printerId,
        name: raw.name,
        machine: assertProfileName(raw.machine, `printer ${printerId} machine`),
        bedType: raw.bed_type,
        processes: validateLayerKeys(raw.processes, printerId),
        filaments: validateNameMap(raw.filaments, MATERIAL_KEY_PATTERN, `printer ${printerId} filaments`, 'material key')
    });
}

/**
 * Validate a parsed registry document into its frozen runtime shape.
 * @param {unknown} raw Parsed JSON document.
 * @returns {Readonly<{schema: string, defaultPrinter: string, printers: Readonly<Record<string, object>>}>} Frozen registry.
 */
function validateBambuPrinterRegistry(raw) {
    assertExactKeys(raw, REGISTRY_KEYS, 'registry');
    if (raw.schema !== BAMBU_PRINTER_REGISTRY_SCHEMA) {
        throw registryError(`schema must be ${BAMBU_PRINTER_REGISTRY_SCHEMA}.`);
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
function loadBambuPrinterRegistry(options = {}) {
    const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
    let raw;
    try {
        raw = readProfileJson(registryPath);
    } catch (cause) {
        throw registryError('the registry file could not be read as bounded JSON.', cause);
    }
    return validateBambuPrinterRegistry(raw);
}

/**
 * Return the process-wide registry, loading it on first use.
 * @param {{registryPath?: string, reload?: boolean}} [options] Test seam.
 * @returns {Readonly<object>} Frozen registry.
 */
function getBambuPrinterRegistry(options = {}) {
    if (!cachedRegistry || options.reload === true || options.registryPath) {
        const loaded = loadBambuPrinterRegistry(options);
        if (!options.registryPath) cachedRegistry = loaded;
        return loaded;
    }
    return cachedRegistry;
}

/**
 * Resolve the public printer id from raw request input, case-insensitively.
 * @param {unknown} raw Request value.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string|null} Canonical printer id, the default when omitted, or null when unknown.
 */
function resolveBambuPrinterId(raw, registry = getBambuPrinterRegistry()) {
    if (raw === undefined || raw === null) return registry.defaultPrinter;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return registry.defaultPrinter;
    const upper = trimmed.toUpperCase();
    return Object.hasOwn(registry.printers, upper) ? upper : null;
}

/**
 * Return one registered printer or throw when the id is unknown.
 * @param {string} printerId Canonical printer id.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {Readonly<object>} Frozen printer entry.
 */
function getBambuPrinter(printerId, registry = getBambuPrinterRegistry()) {
    const printer = registry.printers[printerId];
    if (!printer) throw new Error('Unknown Bambu printer id.');
    return printer;
}

/**
 * List the layer keys a printer offers, sorted numerically.
 * @param {string} printerId Canonical printer id.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string[]} Layer keys such as `0.08`, `0.1`, `0.2`.
 */
function getBambuAllowedLayerKeys(printerId, registry = getBambuPrinterRegistry()) {
    return Object.keys(getBambuPrinter(printerId, registry).processes)
        .sort((left, right) => Number.parseFloat(left) - Number.parseFloat(right));
}

/**
 * Match a numeric layer height against the printer's registry keys.
 * @param {number} layerHeight Parsed layer height.
 * @param {string} printerId Canonical printer id.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string|null} Matching layer key or null.
 */
function resolveBambuLayerKey(layerHeight, printerId, registry = getBambuPrinterRegistry()) {
    if (!Number.isFinite(layerHeight)) return null;
    return getBambuAllowedLayerKeys(printerId, registry)
        .find((key) => Math.abs(Number.parseFloat(key) - layerHeight) < 1e-9) || null;
}

/**
 * List the process names a printer offers, deduplicated and sorted.
 * @param {string} printerId Canonical printer id.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string[]} Vendor process names.
 */
function getBambuProcessNames(printerId, registry = getBambuPrinterRegistry()) {
    return [...new Set(Object.values(getBambuPrinter(printerId, registry).processes))].sort();
}

/**
 * Resolve the vendor process name for a layer key or an explicit request.
 * @param {string} printerId Canonical printer id.
 * @param {string} layerKey Registry layer key.
 * @param {string|null} [explicitProcess] Optional request-selected process name.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string|null} Vendor process name or null when the request is not offered.
 */
function resolveBambuProcessName(printerId, layerKey, explicitProcess = null, registry = getBambuPrinterRegistry()) {
    const printer = getBambuPrinter(printerId, registry);
    if (explicitProcess) {
        return getBambuProcessNames(printerId, registry).includes(explicitProcess) ? explicitProcess : null;
    }
    return printer.processes[layerKey] || null;
}

/**
 * Resolve the vendor filament name for a material.
 * @param {string} printerId Canonical printer id.
 * @param {string} material Requested material key.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string|null} Vendor filament name or null when unmapped.
 */
function resolveBambuFilamentName(printerId, material, registry = getBambuPrinterRegistry()) {
    const normalized = String(material || '').trim().toUpperCase();
    return getBambuPrinter(printerId, registry).filaments[normalized] || null;
}

/**
 * List the materials a printer offers, sorted.
 * @param {string} printerId Canonical printer id.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {string[]} Material keys.
 */
function getBambuMaterials(printerId, registry = getBambuPrinterRegistry()) {
    return Object.keys(getBambuPrinter(printerId, registry).filaments).sort();
}

/**
 * Enumerate every vendor profile the registry references, for startup verification.
 * @param {Readonly<object>} [registry] Registry.
 * @returns {Array<{role: 'machine'|'process'|'filament', name: string}>} Unique role/name pairs.
 */
function listBambuRegistryProfileReferences(registry = getBambuPrinterRegistry()) {
    const seen = new Set();
    const references = [];
    const push = (role, name) => {
        const key = `${role} ${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        references.push(Object.freeze({ role, name }));
    };
    for (const printerId of Object.keys(registry.printers).sort()) {
        const printer = registry.printers[printerId];
        push('machine', printer.machine);
        for (const name of getBambuProcessNames(printerId, registry)) push('process', name);
        for (const material of getBambuMaterials(printerId, registry)) {
            push('filament', printer.filaments[material]);
        }
    }
    return Object.freeze(references);
}

module.exports = {
    BAMBU_PRINTER_REGISTRY_ERROR_CODE,
    BAMBU_PRINTER_REGISTRY_SCHEMA,
    BAMBU_PROFILE_NAME_PATTERN,
    DEFAULT_REGISTRY_PATH,
    getBambuAllowedLayerKeys,
    getBambuMaterials,
    getBambuPrinter,
    getBambuPrinterRegistry,
    getBambuProcessNames,
    listBambuRegistryProfileReferences,
    loadBambuPrinterRegistry,
    resolveBambuFilamentName,
    resolveBambuLayerKey,
    resolveBambuPrinterId,
    resolveBambuProcessName,
    validateBambuPrinterRegistry
};
