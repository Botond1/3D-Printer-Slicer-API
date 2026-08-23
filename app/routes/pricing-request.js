'use strict';

const { resolveResourcePolicy } = require('../config/resource-policy');
const { normalizeTechnology } = require('../services/pricing.service');
const { isSafeMaterialName } = require('../services/pricing/validation');

const MAX_HOURLY_PRICE_HUF = resolveResourcePolicy(process.env).MAX_HOURLY_PRICE_HUF;

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
                error: 'material must be 1-128 printable characters and use a safe property name.'
            })
        };
    }
    return { response: null, material };
}

function parsePriceOrResponse(res, rawPrice) {
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_HOURLY_PRICE_HUF) {
        return {
            response: res.status(400).json({
                success: false,
                error: `price must be a positive number no greater than ${MAX_HOURLY_PRICE_HUF}.`
            })
        };
    }
    return { response: null, price };
}

function parseTechnologyOrResponse(res, rawTechnology) {
    const technology = normalizeTechnology(rawTechnology);
    if (!technology) {
        return {
            response: res.status(400).json({
                success: false,
                error: 'Technology must be FDM or SLA.'
            })
        };
    }
    return { response: null, technology };
}

function persistenceFailure(res) {
    return res.status(500).json({
        success: false,
        error: 'Failed to persist pricing update.'
    });
}

module.exports = {
    parseMaterialOrResponse,
    parsePriceOrResponse,
    parseTechnologyOrResponse,
    persistenceFailure
};
