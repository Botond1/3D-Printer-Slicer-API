/**
 * Pricing route definitions for read/update/delete pricing configuration.
 */

const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const { adminRateLimiter } = require('../middleware/rateLimit');
const { getClientIp } = require('../utils/client-ip');
const {
    getPricing,
    commitPricingMutation,
    findMaterialKey
} = require('../services/pricing.service');
const {
    parseMaterialOrResponse,
    parsePriceOrResponse,
    parseTechnologyOrResponse,
    persistenceFailure
} = require('./pricing-request');

const router = express.Router();

/**
 * Log pricing mutation details with request trace context.
 * @param {import('express').Request} req Express request object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {string} materialKey Material key.
 * @param {string} actionMessage Mutation summary message.
 * @returns {void}
 */
function logPricingUpdate(req, technology, materialKey, actionMessage) {
    const clientIp = getClientIp(req);
    const requestId = req.requestId || 'n/a';
    console.log(`[PRICING UPDATE] ${technology}.${materialKey} ${actionMessage} by ${clientIp} (requestId=${requestId})`);
}

/**
 * Create a new material entry for a specific technology.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @returns {import('express').Response}
 */
async function createMaterialForTechnology(req, res, technology) {
    const materialResult = parseMaterialOrResponse(res, req.body?.material);
    if (materialResult.response) {
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const priceResult = parsePriceOrResponse(res, req.body?.price);
    if (priceResult.response) {
        return priceResult.response;
    }
    const price = priceResult.price;

    let materialKey;
    try {
        materialKey = await commitPricingMutation((candidate) => {
            const requested = String(materialParam).trim().toUpperCase();
            const existing = Object.keys(candidate[technology]).find((key) => key.toUpperCase() === requested);
            if (existing) {
                const conflict = new Error('Material already exists for this technology.');
                conflict.code = 'PRICING_CONFLICT';
                throw conflict;
            }
            candidate[technology][requested] = price;
            return requested;
        });
    } catch (error) {
        if (error.code === 'PRICING_CONFLICT') {
            return res.status(409).json({ success: false, error: error.message });
        }
        return persistenceFailure(res);
    }

    logPricingUpdate(req, technology, materialKey, `created at ${price} HUF/hour`);
    return res.status(201).json({
        success: true,
        technology,
        material: materialKey,
        price,
        message: 'Material created successfully.'
    });
}

/**
 * Get current pricing map.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.get('/pricing', (req, res) => {
    res.status(200).json(getPricing());
});

/**
 * Create a new FDM material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.post('/pricing/FDM', adminRateLimiter, requireAdmin, (req, res) => createMaterialForTechnology(req, res, 'FDM'));

/**
 * Create a new SLA material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.post('/pricing/SLA', adminRateLimiter, requireAdmin, (req, res) => createMaterialForTechnology(req, res, 'SLA'));

/**
 * Update an existing material hourly pricing entry.
 * Rejects unknown materials with HTTP 400.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.patch('/pricing/:technology/:material', adminRateLimiter, requireAdmin, async (req, res) => {
    const technologyResult = parseTechnologyOrResponse(res, req.params.technology);
    if (technologyResult.response) {
        return technologyResult.response;
    }
    const technology = technologyResult.technology;

    const priceResult = parsePriceOrResponse(res, req.body?.price);
    if (priceResult.response) {
        return priceResult.response;
    }
    const price = priceResult.price;

    const materialResult = parseMaterialOrResponse(res, req.params.material);
    if (materialResult.response) {
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const existingMaterialKey = findMaterialKey(technology, materialParam);
    if (!existingMaterialKey) {
        return res.status(400).json({
            success: false,
            error: 'Material does not exist for this technology. Only existing materials can be updated.'
        });
    }

    let materialKey;
    try {
        materialKey = await commitPricingMutation((candidate) => {
            const current = Object.keys(candidate[technology]).find(
                (key) => key.toUpperCase() === String(existingMaterialKey).toUpperCase()
            );
            if (!current) {
                const missing = new Error('Material does not exist for this technology.');
                missing.code = 'PRICING_NOT_FOUND';
                throw missing;
            }
            candidate[technology][current] = price;
            return current;
        });
    } catch (error) {
        if (error.code === 'PRICING_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        return persistenceFailure(res);
    }

    logPricingUpdate(req, technology, materialKey, `updated to ${price} HUF/hour`);
    return res.status(200).json({
        success: true,
        technology,
        material: materialKey,
        price
    });
});

/**
 * Delete a material pricing entry from selected technology.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.delete('/pricing/:technology/:material', adminRateLimiter, requireAdmin, async (req, res) => {
    const technologyResult = parseTechnologyOrResponse(res, req.params.technology);
    if (technologyResult.response) {
        return technologyResult.response;
    }
    const technology = technologyResult.technology;

    const materialResult = parseMaterialOrResponse(res, req.params.material);
    if (materialResult.response) {
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const materialKey = findMaterialKey(technology, materialParam);
    if (!materialKey) {
        return res.status(404).json({ success: false, error: 'Material not found.' });
    }

    try {
        await commitPricingMutation((candidate) => {
            const current = Object.keys(candidate[technology]).find(
                (key) => key.toUpperCase() === String(materialKey).toUpperCase()
            );
            if (!current) {
                const missing = new Error('Material not found.');
                missing.code = 'PRICING_NOT_FOUND';
                throw missing;
            }
            delete candidate[technology][current];
            return current;
        });
    } catch (error) {
        if (error.code === 'PRICING_NOT_FOUND') {
            return res.status(404).json({ success: false, error: error.message });
        }
        return persistenceFailure(res);
    }

    logPricingUpdate(req, technology, materialKey, 'deleted');
    return res.status(200).json({
        success: true,
        technology,
        material: materialKey,
        message: 'Material deleted successfully.'
    });
});

module.exports = router;
