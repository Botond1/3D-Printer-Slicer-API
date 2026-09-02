/**
 * Pricing route definitions for read/update/delete pricing configuration.
 */

const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const { adminRateLimiter } = require('../middleware/rateLimit');
const { emitEvent } = require('../services/observability/events');
const defaultPricingService = require('../services/pricing.service');
const { LAST_MATERIAL_PROTECTED, assertNotLastMaterial } = require('../services/pricing/catalog');
const {
    PRICING_ERROR_CODES,
    parseMaterialOrResponse,
    parsePriceOrResponse,
    parseTechnologyOrResponse,
    persistenceFailure
} = require('./pricing-request');

/**
 * Log pricing mutation details with request trace context.
 * @param {import('express').Request} req Express request object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {string} materialKey Material key.
 * @param {string} actionMessage Mutation summary message.
 * @returns {void}
 */
function recordPricingMutation(req, technology, action, outcome, errorCode) {
    emitEvent('pricing.mutated', {
        request_id: req.requestId,
        audience: 'pricing',
        outcome,
        error_code: errorCode,
        extra: { technology, action }
    });
}

/**
 * Create a new material entry for a specific technology.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {(mutator: Function) => Promise<unknown>} commitPricingMutation Serialized pricing mutation coordinator.
 * @returns {import('express').Response}
 */
async function createMaterialForTechnology(req, res, technology, commitPricingMutation) {
    const materialResult = parseMaterialOrResponse(res, req.body?.material);
    if (materialResult.response) {
        recordPricingMutation(req, technology, 'create', 'failure', 'PRICING_VALIDATION_FAILED');
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const priceResult = parsePriceOrResponse(res, req.body?.price);
    if (priceResult.response) {
        recordPricingMutation(req, technology, 'create', 'failure', 'PRICING_VALIDATION_FAILED');
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
            recordPricingMutation(req, technology, 'create', 'failure', 'PRICING_CONFLICT');
            return res.status(409).json({
                success: false,
                error: error.message,
                errorCode: PRICING_ERROR_CODES.MATERIAL_ALREADY_EXISTS
            });
        }
        recordPricingMutation(req, technology, 'create', 'failure', 'PRICING_PERSISTENCE_FAILED');
        return persistenceFailure(res);
    }

    recordPricingMutation(req, technology, 'create', 'success');
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
function createPricingRouter(options = {}) {
    const router = express.Router();
    const authenticatePricing = options.authenticate || requireAdmin;
    // Injectable service seam: tests bind an isolated catalog/repository pair;
    // production uses the module singleton backed by the root-scoped state.
    const { getPricing, commitPricingMutation, findMaterialKey } = options.pricingService || defaultPricingService;

    router.get('/pricing', (req, res) => {
        res.status(200).json(getPricing());
    });

/**
 * Create a new FDM material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
    router.post('/pricing/FDM', adminRateLimiter, authenticatePricing, (req, res) => createMaterialForTechnology(req, res, 'FDM', commitPricingMutation));

/**
 * Create a new SLA material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
    router.post('/pricing/SLA', adminRateLimiter, authenticatePricing, (req, res) => createMaterialForTechnology(req, res, 'SLA', commitPricingMutation));

/**
 * Update an existing material hourly pricing entry.
 * Rejects unknown materials with HTTP 400.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
    router.patch('/pricing/:technology/:material', adminRateLimiter, authenticatePricing, async (req, res) => {
    const technologyResult = parseTechnologyOrResponse(res, req.params.technology);
    if (technologyResult.response) {
        recordPricingMutation(req, undefined, 'update', 'failure', 'PRICING_VALIDATION_FAILED');
        return technologyResult.response;
    }
    const technology = technologyResult.technology;

    const priceResult = parsePriceOrResponse(res, req.body?.price);
    if (priceResult.response) {
        recordPricingMutation(req, technology, 'update', 'failure', 'PRICING_VALIDATION_FAILED');
        return priceResult.response;
    }
    const price = priceResult.price;

    const materialResult = parseMaterialOrResponse(res, req.params.material);
    if (materialResult.response) {
        recordPricingMutation(req, technology, 'update', 'failure', 'PRICING_VALIDATION_FAILED');
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const existingMaterialKey = findMaterialKey(technology, materialParam);
    if (!existingMaterialKey) {
        recordPricingMutation(req, technology, 'update', 'failure', 'PRICING_NOT_FOUND');
        return res.status(400).json({
            success: false,
            error: 'Material does not exist for this technology. Only existing materials can be updated.',
            errorCode: PRICING_ERROR_CODES.MATERIAL_NOT_FOUND
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
            recordPricingMutation(req, technology, 'update', 'failure', 'PRICING_NOT_FOUND');
            return res.status(404).json({
                success: false,
                error: error.message,
                errorCode: PRICING_ERROR_CODES.MATERIAL_NOT_FOUND
            });
        }
        recordPricingMutation(req, technology, 'update', 'failure', 'PRICING_PERSISTENCE_FAILED');
        return persistenceFailure(res);
    }

    recordPricingMutation(req, technology, 'update', 'success');
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
    router.delete('/pricing/:technology/:material', adminRateLimiter, authenticatePricing, async (req, res) => {
    const technologyResult = parseTechnologyOrResponse(res, req.params.technology);
    if (technologyResult.response) {
        recordPricingMutation(req, undefined, 'delete', 'failure', 'PRICING_VALIDATION_FAILED');
        return technologyResult.response;
    }
    const technology = technologyResult.technology;

    const materialResult = parseMaterialOrResponse(res, req.params.material);
    if (materialResult.response) {
        recordPricingMutation(req, technology, 'delete', 'failure', 'PRICING_VALIDATION_FAILED');
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const materialKey = findMaterialKey(technology, materialParam);
    if (!materialKey) {
        recordPricingMutation(req, technology, 'delete', 'failure', 'PRICING_NOT_FOUND');
        return res.status(404).json({
            success: false,
            error: 'Material not found.',
            errorCode: PRICING_ERROR_CODES.MATERIAL_NOT_FOUND
        });
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
            // Readiness requires non-empty FDM and SLA maps; the last material
            // of a technology is protected so a pricing edit cannot take the
            // service out of READY. Checked inside the serialized mutation so a
            // concurrent delete cannot race past it.
            assertNotLastMaterial(candidate[technology], current);
            delete candidate[technology][current];
            return current;
        });
    } catch (error) {
        if (error.code === 'PRICING_NOT_FOUND') {
            recordPricingMutation(req, technology, 'delete', 'failure', 'PRICING_NOT_FOUND');
            return res.status(404).json({
                success: false,
                error: error.message,
                errorCode: PRICING_ERROR_CODES.MATERIAL_NOT_FOUND
            });
        }
        if (error.code === LAST_MATERIAL_PROTECTED) {
            recordPricingMutation(req, technology, 'delete', 'failure', LAST_MATERIAL_PROTECTED);
            return res.status(409).json({
                success: false,
                error: error.message,
                errorCode: PRICING_ERROR_CODES.LAST_MATERIAL_PROTECTED
            });
        }
        recordPricingMutation(req, technology, 'delete', 'failure', 'PRICING_PERSISTENCE_FAILED');
        return persistenceFailure(res);
    }

    recordPricingMutation(req, technology, 'delete', 'success');
    return res.status(200).json({
        success: true,
        technology,
        material: materialKey,
        message: 'Material deleted successfully.'
    });
    });
    return router;
}

const router = createPricingRouter();
module.exports = router;
module.exports.createPricingRouter = createPricingRouter;
