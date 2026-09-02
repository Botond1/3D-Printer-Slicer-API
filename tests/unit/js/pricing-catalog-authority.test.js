'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { PricingRepository } = require('../../../app/services/pricing/repository');
const { PricingCatalog } = require('../../../app/services/pricing/catalog');
const { createPricingRouter } = require('../../../app/routes/pricing.routes');
const {
    PRICING_ERROR_CODES,
    parseMaterialOrResponse,
    parsePriceOrResponse,
    parseTechnologyOrResponse,
    persistenceFailure
} = require('../../../app/routes/pricing-request');

const DEFAULT_PRICING = { FDM: { PLA: 800, PETG: 900 }, SLA: { Standard: 1800 } };

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pricing-authority-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return {
        root,
        stateRoot: path.join(root, 'pricing-state'),
        primaryFile: path.join(root, 'pricing-state', 'pricing.json')
    };
}

function repository(paths) {
    return new PricingRepository({
        primaryFile: paths.primaryFile,
        pricingStateRoot: paths.stateRoot,
        legacyFile: path.join(paths.root, 'pricing.json'),
        defaultPricing: DEFAULT_PRICING,
        fs,
        resourcePolicy: resolveResourcePolicy({})
    });
}

function fakeResponse() {
    const observed = { status: null, payload: null };
    return {
        observed,
        res: {
            status(value) { observed.status = value; return this; },
            json(value) { observed.payload = value; return this; }
        }
    };
}

test('an existing pricing file is authoritative: a deleted default material never resurrects', async (t) => {
    const paths = await fixture(t);
    const target = repository(paths);
    target.saveToPrimary({ FDM: { PLA: 850 }, SLA: { Standard: 1800 } });

    const loaded = target.readPricingFile(paths.primaryFile);
    assert.deepEqual(loaded, { FDM: { PLA: 850 }, SLA: { Standard: 1800 } });
    assert.equal(Object.hasOwn(loaded.FDM, 'PETG'), false, 'defaults must not be merged back');

    const catalog = new PricingCatalog(DEFAULT_PRICING);
    catalog.setPricing(loaded);
    assert.deepEqual(catalog.getPricing(), { FDM: { PLA: 850 }, SLA: { Standard: 1800 } });
    assert.equal(catalog.isMaterialValidForTechnology('FDM', 'PETG'), false);
});

test('empty and malformed pricing files fail closed so the caller seeds defaults', async (t) => {
    const paths = await fixture(t);
    await fsp.mkdir(paths.stateRoot, { recursive: true });
    const target = repository(paths);

    await fsp.writeFile(paths.primaryFile, '');
    assert.throws(() => target.readPricingFile(paths.primaryFile), { code: 'PRICING_FILE_EMPTY' });
    await fsp.writeFile(paths.primaryFile, '   \n');
    assert.throws(() => target.readPricingFile(paths.primaryFile), { code: 'PRICING_FILE_EMPTY' });

    for (const malformed of ['[]', 'null', '{"FDM":{"PLA":800}}', '{"FDM":[],"SLA":{}}']) {
        await fsp.writeFile(paths.primaryFile, malformed);
        assert.throws(() => target.readPricingFile(paths.primaryFile), malformed);
    }
});

test('catalog setPricing never re-merges defaults and getRate fails closed on unknown materials', () => {
    const catalog = new PricingCatalog(DEFAULT_PRICING);
    catalog.setPricing({ FDM: { PLA: 850 }, SLA: {} });
    assert.deepEqual(catalog.getPricing(), { FDM: { PLA: 850 }, SLA: {} });
    assert.deepEqual(catalog.getAllowedMaterialsForTechnology('SLA'), []);

    assert.equal(catalog.getRate('FDM', 'PLA'), 850);
    assert.equal(catalog.getRate('FDM', 'pla'), 850, 'lookup is case-insensitive');
    assert.equal(catalog.getRate('FDM', 'PETG'), null, 'no other material may be substituted');
    assert.equal(catalog.getRate('SLA', 'Standard'), null, 'defaults are never substituted');
    assert.equal(catalog.getRate('FDM', undefined), null);
    assert.equal(catalog.getRate('XYZ', 'PLA'), null);

    catalog.removeMaterial('FDM', 'PLA');
    assert.equal(catalog.getRate('FDM', 'PLA'), null);
    catalog.setPricing({ FDM: { PLA: 0 }, SLA: {} });
    assert.equal(catalog.getRate('FDM', 'PLA'), null, 'a non-positive rate is never published');
});

test('pricing request parsers attach stable error codes beside their existing messages', () => {
    const material = fakeResponse();
    parseMaterialOrResponse(material.res, '');
    assert.equal(material.observed.status, 400);
    assert.equal(material.observed.payload.errorCode, PRICING_ERROR_CODES.INVALID_MATERIAL);
    assert.match(material.observed.payload.error, /safe property name/);
    assert.equal(material.observed.payload.success, false);

    const price = fakeResponse();
    parsePriceOrResponse(price.res, '-1');
    assert.equal(price.observed.status, 400);
    assert.equal(price.observed.payload.errorCode, PRICING_ERROR_CODES.INVALID_PRICE);
    assert.match(price.observed.payload.error, /price must be a positive number/);

    const technology = fakeResponse();
    parseTechnologyOrResponse(technology.res, 'RESIN');
    assert.equal(technology.observed.status, 400);
    assert.equal(technology.observed.payload.errorCode, PRICING_ERROR_CODES.INVALID_TECHNOLOGY);
    assert.equal(technology.observed.payload.error, 'Technology must be FDM or SLA.');

    const persistence = fakeResponse();
    persistenceFailure(persistence.res);
    assert.equal(persistence.observed.status, 500);
    assert.deepEqual(persistence.observed.payload, {
        success: false,
        error: 'Failed to persist pricing update.',
        errorCode: PRICING_ERROR_CODES.PRICING_PERSISTENCE_FAILED
    });

    assert.equal(parseMaterialOrResponse(fakeResponse().res, ' PLA ').material, 'PLA');
    assert.equal(parsePriceOrResponse(fakeResponse().res, '850').price, 850);
    assert.equal(parseTechnologyOrResponse(fakeResponse().res, 'fdm').technology, 'FDM');
});

async function withPricingServer(callback) {
    const app = express();
    app.use(express.json());
    app.use(createPricingRouter({ authenticate: (req, res, next) => next() }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await callback(async (method, route, body) => {
            const response = await fetch(`${base}${route}`, {
                method,
                headers: body ? { 'content-type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined
            });
            return { status: response.status, payload: await response.json() };
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('pricing route rejections carry stable error codes without touching persistence', async () => {
    await withPricingServer(async (request) => {
        const missingDelete = await request('DELETE', '/pricing/FDM/no-such-material-authority');
        assert.equal(missingDelete.status, 404);
        assert.equal(missingDelete.payload.errorCode, PRICING_ERROR_CODES.MATERIAL_NOT_FOUND);
        assert.equal(missingDelete.payload.error, 'Material not found.');

        const missingUpdate = await request('PATCH', '/pricing/SLA/no-such-material-authority', { price: 100 });
        assert.equal(missingUpdate.status, 400);
        assert.equal(missingUpdate.payload.errorCode, PRICING_ERROR_CODES.MATERIAL_NOT_FOUND);
        assert.match(missingUpdate.payload.error, /Only existing materials can be updated/);

        const badTechnology = await request('DELETE', '/pricing/RESIN/PLA');
        assert.equal(badTechnology.status, 400);
        assert.equal(badTechnology.payload.errorCode, PRICING_ERROR_CODES.INVALID_TECHNOLOGY);

        const badPrice = await request('POST', '/pricing/FDM', { material: 'NEWMAT', price: 0 });
        assert.equal(badPrice.status, 400);
        assert.equal(badPrice.payload.errorCode, PRICING_ERROR_CODES.INVALID_PRICE);

        const badMaterial = await request('POST', '/pricing/FDM', { material: '', price: 10 });
        assert.equal(badMaterial.status, 400);
        assert.equal(badMaterial.payload.errorCode, PRICING_ERROR_CODES.INVALID_MATERIAL);

        for (const result of [missingDelete, missingUpdate, badTechnology, badPrice, badMaterial]) {
            assert.equal(result.payload.success, false);
            assert.equal(typeof result.payload.error, 'string');
        }
    });
});
