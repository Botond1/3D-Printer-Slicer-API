/**
 * In-memory pricing catalog containing pricing domain logic.
 */

/**
 * @typedef {{FDM: Record<string, number>, SLA: Record<string, number>}} PricingMap
 */
const { isSafeMaterialName } = require('./validation');

class PricingCatalog {
    /**
     * @param {PricingMap} defaultPricing Default pricing configuration.
     */
    constructor(defaultPricing) {
        this.defaultPricing = structuredClone(defaultPricing);
        this.pricing = structuredClone(defaultPricing);
    }

    /**
     * Replace in-memory pricing with the supplied payload.
     *
     * The payload is authoritative: defaults are never merged back in, so a
     * material that an operator deleted stays deleted across restarts. A
     * technology map that is absent from the payload becomes an empty map.
     * @param {Partial<PricingMap> | Record<string, unknown>} pricingPayload Incoming pricing payload.
     * @returns {void}
     */
    setPricing(pricingPayload) {
        const fdmSource = pricingPayload?.FDM && typeof pricingPayload.FDM === 'object' && !Array.isArray(pricingPayload.FDM)
            ? pricingPayload.FDM
            : {};
        const slaSource = pricingPayload?.SLA && typeof pricingPayload.SLA === 'object' && !Array.isArray(pricingPayload.SLA)
            ? pricingPayload.SLA
            : {};

        this.pricing = {
            FDM: { ...fdmSource },
            SLA: { ...slaSource }
        };
    }

    replacePricing(pricingPayload) {
        this.pricing = structuredClone(pricingPayload);
    }

    /**
     * Reset in-memory pricing to defaults.
     * @returns {void}
     */
    resetToDefault() {
        this.pricing = structuredClone(this.defaultPricing);
    }

    /**
     * Get a defensive clone of current pricing.
     * @returns {PricingMap} Current pricing snapshot.
     */
    getPricing() {
        return structuredClone(this.pricing);
    }

    /**
     * Normalize and validate technology key.
     * @param {unknown} value Raw technology value.
     * @returns {'FDM' | 'SLA' | null} Normalized technology or null when invalid.
     */
    normalizeTechnology(value) {
        const normalized = String(value || '').toUpperCase();
        return normalized === 'FDM' || normalized === 'SLA' ? normalized : null;
    }

    /**
     * Normalize material identifier for case-insensitive comparisons.
     * @param {unknown} value Raw material label.
     * @returns {string} Canonical normalized token.
     */
    normalizeMaterialToken(value) {
        const material = typeof value === 'string'
            ? value.trim()
            : ((typeof value === 'number' || typeof value === 'boolean') ? `${value}`.trim() : '');
        return isSafeMaterialName(material) ? material.toUpperCase() : '';
    }

    /**
     * Resolve material key case-insensitively from pricing map.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} materialParam Material name from request.
     * @returns {string | null} Existing material key or null when not found.
     */
    findMaterialKey(technology, materialParam) {
        const requested = this.normalizeMaterialToken(materialParam);
        return Object.keys(this.pricing[technology] || {}).find((key) => this.normalizeMaterialToken(key) === requested) || null;
    }

    /**
     * Resolve where a material exists across technology maps.
     * @param {unknown} materialParam Material name.
     * @returns {'FDM' | 'SLA' | 'BOTH' | null} Resolved technology scope.
     */
    resolveMaterialTechnology(materialParam) {
        const inFdm = Boolean(this.findMaterialKey('FDM', materialParam));
        const inSla = Boolean(this.findMaterialKey('SLA', materialParam));

        if (inFdm && inSla) return 'BOTH';
        if (inFdm) return 'FDM';
        if (inSla) return 'SLA';
        return null;
    }

    /**
     * Check whether a material exists under selected technology.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} materialParam Material name.
     * @returns {boolean} True when material is configured for the selected technology.
     */
    isMaterialValidForTechnology(technology, materialParam) {
        return Boolean(this.findMaterialKey(technology, materialParam));
    }

    /**
     * Return currently configured material keys for selected technology.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @returns {string[]} Material key list.
     */
    getAllowedMaterialsForTechnology(technology) {
        return Object.keys(this.pricing[technology] || {});
    }

    /**
     * Create or update material price for selected technology.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} materialParam Material key from request.
     * @param {number} price Hourly price in HUF.
     * @returns {string} Final material key that was updated.
     */
    updateMaterialPrice(technology, materialParam, price) {
        if (!isSafeMaterialName(String(materialParam))) throw new Error('Invalid material name.');
        const existingMaterialKey = this.findMaterialKey(technology, materialParam);
        const materialKey = existingMaterialKey || this.normalizeMaterialToken(materialParam);
        this.pricing[technology][materialKey] = price;
        return materialKey;
    }

    /**
     * Remove a material from pricing map.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {string} materialKey Material key to remove.
     * @returns {void}
     */
    removeMaterial(technology, materialKey) {
        delete this.pricing[technology][materialKey];
    }

    /**
     * Get the configured hourly rate for a technology/material pair.
     *
     * Fails closed: when the material has no configured positive rate under
     * the selected technology the result is `null`. The rate of another
     * material or a compiled-in default is never substituted, so a caller can
     * never price a quote against a rate the operator did not configure.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} material Material key.
     * @returns {number | null} Hourly rate in HUF, or null when unconfigured.
     */
    getRate(technology, material) {
        const techPricing = this.pricing[technology];
        if (!techPricing || typeof techPricing !== 'object') return null;
        const materialKey = this.findMaterialKey(technology, material);
        if (!materialKey || !Object.hasOwn(techPricing, materialKey)) return null;
        const rate = techPricing[materialKey];
        return Number.isFinite(rate) && rate > 0 ? rate : null;
    }
}

module.exports = {
    PricingCatalog
};
