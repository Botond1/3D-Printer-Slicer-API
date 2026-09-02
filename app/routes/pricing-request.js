'use strict';

const { resolveResourcePolicy } = require('../config/resource-policy');
const { normalizeTechnology } = require('../services/pricing.service');
const { isSafeMaterialName } = require('../services/pricing/validation');

const MAX_HOURLY_PRICE_HUF = resolveResourcePolicy(process.env).MAX_HOURLY_PRICE_HUF;

/** Stable machine-readable pricing error codes exposed beside the human messages. */
const PRICING_ERROR_CODES = Object.freeze({
    INVALID_MATERIAL: 'INVALID_MATERIAL',
    INVALID_PRICE: 'INVALID_PRICE',
    INVALID_TECHNOLOGY: 'INVALID_TECHNOLOGY',
    MATERIAL_NOT_FOUND: 'MATERIAL_NOT_FOUND',
    MATERIAL_ALREADY_EXISTS: 'MATERIAL_ALREADY_EXISTS',
    LAST_MATERIAL_PROTECTED: 'LAST_MATERIAL_PROTECTED',
    PRICING_PERSISTENCE_FAILED: 'PRICING_PERSISTENCE_FAILED'
});

/**
 * Parse and validate a material name, or send a typed HTTP 400 response.
 * @param {import('express').Response} res Express response object.
 * @param {unknown} rawMaterial Raw material value from the request.
 * @returns {{response: import('express').Response} | {response: null, material: string}} Parsed material or sent response.
 */
function parseMaterialOrResponse(res, rawMaterial) {
    let material = '';
    if (typeof rawMaterial === 'string') {
        material = rawMaterial.trim();
    } else if (typeof rawMaterial === 'number' || typeof rawMaterial === 'boolean') {
        material = `${rawMaterial}`.trim();
    }

    if (!isSafeMaterialName(material)) {
        return {
            response: res.status(400).json({
                success: false,
                error: 'material must be 1-128 printable characters and use a safe property name.',
                errorCode: PRICING_ERROR_CODES.INVALID_MATERIAL
            })
        };
    }
    return { response: null, material };
}

/**
 * Parse and validate an hourly price, or send a typed HTTP 400 response.
 * @param {import('express').Response} res Express response object.
 * @param {unknown} rawPrice Raw price value from the request.
 * @returns {{response: import('express').Response} | {response: null, price: number}} Parsed price or sent response.
 */
function parsePriceOrResponse(res, rawPrice) {
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_HOURLY_PRICE_HUF) {
        return {
            response: res.status(400).json({
                success: false,
                error: `price must be a positive number no greater than ${MAX_HOURLY_PRICE_HUF}.`,
                errorCode: PRICING_ERROR_CODES.INVALID_PRICE
            })
        };
    }
    return { response: null, price };
}

/**
 * Parse and validate a technology key, or send a typed HTTP 400 response.
 * @param {import('express').Response} res Express response object.
 * @param {unknown} rawTechnology Raw technology value from the request.
 * @returns {{response: import('express').Response} | {response: null, technology: 'FDM'|'SLA'}} Parsed technology or sent response.
 */
function parseTechnologyOrResponse(res, rawTechnology) {
    const technology = normalizeTechnology(rawTechnology);
    if (!technology) {
        return {
            response: res.status(400).json({
                success: false,
                error: 'Technology must be FDM or SLA.',
                errorCode: PRICING_ERROR_CODES.INVALID_TECHNOLOGY
            })
        };
    }
    return { response: null, technology };
}

/**
 * Send the typed HTTP 500 persistence-failure response.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response} Sent response.
 */
function persistenceFailure(res) {
    return res.status(500).json({
        success: false,
        error: 'Failed to persist pricing update.',
        errorCode: PRICING_ERROR_CODES.PRICING_PERSISTENCE_FAILED
    });
}

module.exports = {
    PRICING_ERROR_CODES,
    parseMaterialOrResponse,
    parsePriceOrResponse,
    parseTechnologyOrResponse,
    persistenceFailure
};
