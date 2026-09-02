/**
 * Pricing service facade for loading, persisting, and querying material hourly rates.
 */

const { PRICING_FILE, PRICING_STATE_DIR, LEGACY_PRICING_FILE } = require('../config/paths');
const { DEFAULT_PRICING } = require('../config/constants');
const { PricingRepository } = require('./pricing/repository');
const { PricingCatalog } = require('./pricing/catalog');
const { emitEvent } = require('./observability/events');

const pricingRepository = new PricingRepository({
    primaryFile: PRICING_FILE,
    pricingStateRoot: PRICING_STATE_DIR,
    legacyFile: LEGACY_PRICING_FILE,
    defaultPricing: DEFAULT_PRICING
});

const pricingCatalog = new PricingCatalog(DEFAULT_PRICING);
let activePricingFile = PRICING_FILE;
function createPricingMutationCoordinator(repository, catalog) {
    let tail = Promise.resolve();
    return function commit(mutator) {
        if (typeof mutator !== 'function') return Promise.reject(new Error('Pricing mutator is required.'));
        const operation = tail.then(() => {
            const candidate = catalog.getPricing();
            const result = mutator(candidate);
            repository.saveToPrimary(candidate);
            catalog.replacePricing(candidate);
            return result;
        });
        tail = operation.catch(() => {});
        return operation;
    };
}

const commitDefaultMutation = createPricingMutationCoordinator(pricingRepository, pricingCatalog);

/**
 * Persist current in-memory pricing to disk.
 * @returns {boolean} True when save succeeds, otherwise false.
 */
function savePricingToDisk() {
    try {
        activePricingFile = pricingRepository.saveToPrimary(pricingCatalog.getPricing());
        return true;
    } catch {
        emitEvent('pricing.mutated', {
            audience: 'pricing',
            outcome: 'failure',
            error_code: 'PRICING_PERSISTENCE_FAILED',
            extra: { action: 'persist' }
        });
        return false;
    }
}

/** Error code raised when an existing pricing file cannot be trusted. */
const PRICING_FILE_INVALID = 'PRICING_FILE_INVALID';

/**
 * Build the typed startup refusal for an unreadable, unparsable, or invalid
 * existing pricing file. The message never carries the path or file content.
 * @returns {Error & {code: string, errorCode: string}} Typed error.
 */
function createPricingFileInvalidError() {
    const error = new Error(
        'The existing pricing file could not be read or validated; repair or remove it before starting.'
    );
    error.code = PRICING_FILE_INVALID;
    error.errorCode = PRICING_FILE_INVALID;
    return error;
}

/**
 * Build the startup pricing loader over injectable collaborators.
 *
 * Only a MISSING pricing file or a recognized EMPTY one (`PRICING_FILE_EMPTY`)
 * may be seeded with the compiled-in defaults. Any other read, parse, or
 * validation failure of an existing file leaves that file untouched and
 * throws the typed `PRICING_FILE_INVALID` error so startup refuses and the
 * operator repairs the file; silently replacing operator data is never an
 * option.
 * @param {{repository?: PricingRepository, catalog?: PricingCatalog, emitEvent?: Function, primaryFile?: string}} [dependencies] Test seams; production uses the module singletons.
 * @returns {() => void} Loader that throws `PRICING_FILE_INVALID` on an untrusted existing file.
 */
function createPricingLoader(dependencies = {}) {
    const repository = dependencies.repository || pricingRepository;
    const catalog = dependencies.catalog || pricingCatalog;
    const emit = dependencies.emitEvent || emitEvent;
    const primaryFile = dependencies.primaryFile || repository.primaryFile;

    function persist(action) {
        try {
            activePricingFile = repository.saveToPrimary(catalog.getPricing());
            emit('pricing.mutated', { audience: 'pricing', outcome: 'success', extra: { action } });
            return true;
        } catch {
            emit('pricing.mutated', {
                audience: 'pricing',
                outcome: 'failure',
                error_code: 'PRICING_PERSISTENCE_FAILED',
                extra: { action: 'persist' }
            });
            return false;
        }
    }

    function seedDefaults() {
        catalog.resetToDefault();
        persist('initialize');
    }

    return function loadPricing() {
        const existingCandidates = repository.getExistingCandidates();
        if (existingCandidates.length === 0) {
            seedDefaults();
            return;
        }
        // Exactly one candidate is authoritative: the primary when it exists,
        // otherwise the first safe legacy file. It is never silently replaced.
        const candidateFile = existingCandidates[0];
        let diskPricing;
        try {
            diskPricing = repository.readPricingFile(candidateFile);
        } catch (error) {
            if (error?.code === 'PRICING_FILE_EMPTY') {
                seedDefaults();
                return;
            }
            emit('pricing.mutated', {
                audience: 'pricing',
                outcome: 'failure',
                error_code: 'PRICING_LOAD_FAILED',
                extra: { action: 'load' }
            });
            throw createPricingFileInvalidError();
        }
        catalog.setPricing(diskPricing);
        activePricingFile = primaryFile;
        if (candidateFile !== primaryFile) persist('migrate');
    };
}

/**
 * Load pricing configuration from disk at startup.
 * A missing or empty file is seeded with defaults; an existing file that
 * cannot be read or validated throws `PRICING_FILE_INVALID` unchanged.
 * @returns {void}
 * @throws {Error & {code: 'PRICING_FILE_INVALID'}} When an existing pricing file is untrusted.
 */
function loadPricingFromDisk() {
    createPricingLoader()();
}

/**
 * Get current pricing object.
 * @returns {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
function getPricing() {
    return pricingCatalog.getPricing();
}

/**
 * Normalize and validate technology key.
 * @param {string} value Raw technology value.
 * @returns {'FDM' | 'SLA' | null} Normalized technology or null when invalid.
 */
function normalizeTechnology(value) {
    return pricingCatalog.normalizeTechnology(value);
}

/**
 * Normalize material identifier for case-insensitive comparisons.
 * @param {string} value Raw material label.
 * @returns {string} Canonical normalized token.
 */
function normalizeMaterialToken(value) {
    return pricingCatalog.normalizeMaterialToken(value);
}

/**
 * Resolve material key case-insensitively from pricing map.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material name from request.
 * @returns {string | null} Existing material key or null when not found.
 */
function findMaterialKey(technology, materialParam) {
    return pricingCatalog.findMaterialKey(technology, materialParam);
}

/**
 * Resolve where a material exists across technology maps.
 * @param {string} materialParam Material name.
 * @returns {'FDM' | 'SLA' | 'BOTH' | null} Resolved technology scope.
 */
function resolveMaterialTechnology(materialParam) {
    return pricingCatalog.resolveMaterialTechnology(materialParam);
}

/**
 * Check whether a material exists under selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material name.
 * @returns {boolean} True when material is configured for the selected technology.
 */
function isMaterialValidForTechnology(technology, materialParam) {
    return pricingCatalog.isMaterialValidForTechnology(technology, materialParam);
}

/**
 * Return currently configured material keys for selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @returns {string[]} Material key list.
 */
function getAllowedMaterialsForTechnology(technology) {
    return pricingCatalog.getAllowedMaterialsForTechnology(technology);
}

/**
 * Create or update material price for selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material key from request.
 * @param {number} price Hourly price in HUF.
 * @returns {string} Final material key that was updated.
 */
function updateMaterialPrice(technology, materialParam, price) {
    return pricingCatalog.updateMaterialPrice(technology, materialParam, price);
}

/**
 * Remove a material from pricing map.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialKey Material key to remove.
 * @returns {void}
 */
function removeMaterial(technology, materialKey) {
    pricingCatalog.removeMaterial(technology, materialKey);
}

/**
 * Get effective hourly rate for technology/material pair.
 * Falls back to technology default if material is missing.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} material Material key.
 * @returns {number} Hourly rate in HUF.
 */
function getRate(technology, material) {
    return pricingCatalog.getRate(technology, material);
}

function commitPricingMutation(mutator) {
    return commitDefaultMutation((candidate) => {
        const result = mutator(candidate);
        activePricingFile = pricingRepository.primaryFile;
        return result;
    });
}

module.exports = {
    DEFAULT_PRICING,
    PRICING_FILE_INVALID,
    createPricingLoader,
    loadPricingFromDisk,
    savePricingToDisk,
    getPricing,
    normalizeTechnology,
    normalizeMaterialToken,
    findMaterialKey,
    resolveMaterialTechnology,
    isMaterialValidForTechnology,
    getAllowedMaterialsForTechnology,
    updateMaterialPrice,
    removeMaterial,
    getRate,
    commitPricingMutation,
    createPricingMutationCoordinator
};
