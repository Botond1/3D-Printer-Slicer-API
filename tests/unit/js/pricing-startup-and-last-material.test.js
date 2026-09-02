'use strict';

/**
 * Startup pricing load fails closed on an untrusted existing file, and the
 * last material of a technology cannot be deleted because readiness requires
 * non-empty FDM and SLA maps.
 */

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
const { LAST_MATERIAL_PROTECTED, PricingCatalog, assertNotLastMaterial } = require('../../../app/services/pricing/catalog');
const { pricingHealthy } = require('../../../app/services/readiness.service');
const {
    PRICING_FILE_INVALID,
    createPricingLoader,
    createPricingMutationCoordinator
} = require('../../../app/services/pricing.service');
const { createPricingRouter } = require('../../../app/routes/pricing.routes');
const { PRICING_ERROR_CODES } = require('../../../app/routes/pricing-request');

const DEFAULT_PRICING = { FDM: { PLA: 800, PETG: 900 }, SLA: { Standard: 1800 } };

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pricing-startup-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const paths = {
        root,
        stateRoot: path.join(root, 'pricing-state'),
        primaryFile: path.join(root, 'pricing-state', 'pricing.json'),
        legacyFile: path.join(root, 'pricing.json')
    };
    const repository = new PricingRepository({
        primaryFile: paths.primaryFile,
        pricingStateRoot: paths.stateRoot,
        legacyFile: paths.legacyFile,
        defaultPricing: DEFAULT_PRICING,
        fs,
        resourcePolicy: resolveResourcePolicy({})
    });
    const catalog = new PricingCatalog(DEFAULT_PRICING);
    const events = [];
    const load = createPricingLoader({
        repository,
        catalog,
        emitEvent: (name, payload) => events.push({ name, ...payload })
    });
    return { paths, repository, catalog, events, load };
}

test('a missing pricing file is seeded with defaults and persisted', async (t) => {
    const { paths, catalog, events, load } = await fixture(t);
    load();
    assert.deepEqual(catalog.getPricing(), DEFAULT_PRICING);
    assert.deepEqual(JSON.parse(await fsp.readFile(paths.primaryFile, 'utf8')), DEFAULT_PRICING);
    assert.deepEqual(events.map((event) => [event.outcome, event.extra.action]), [['success', 'initialize']]);
});

test('an empty pricing file is the only existing file that may be seeded with defaults', async (t) => {
    const { paths, catalog, load } = await fixture(t);
    await fsp.mkdir(paths.stateRoot, { recursive: true });
    for (const empty of ['', '   \n', '\t']) {
        await fsp.writeFile(paths.primaryFile, empty);
        catalog.setPricing({ FDM: { X: 1 }, SLA: { Y: 2 } });
        load();
        assert.deepEqual(catalog.getPricing(), DEFAULT_PRICING, JSON.stringify(empty));
        assert.deepEqual(JSON.parse(await fsp.readFile(paths.primaryFile, 'utf8')), DEFAULT_PRICING);
    }
});

test('a corrupt or invalid existing pricing file refuses startup and is left byte-identical', async (t) => {
    const { paths, catalog, events, load } = await fixture(t);
    await fsp.mkdir(paths.stateRoot, { recursive: true });
    const untrusted = [
        '{ not json',
        '[]',
        'null',
        '"string"',
        '{"FDM":{"PLA":800}}',
        '{"FDM":[],"SLA":{}}',
        '{"FDM":{"PLA":800},"SLA":{"Standard":-1}}',
        '{"FDM":{"PLA":"800"},"SLA":{"Standard":1800}}',
        '{"FDM":{"PLA":0},"SLA":{"Standard":1800}}'
    ];
    for (const content of untrusted) {
        await fsp.writeFile(paths.primaryFile, content);
        catalog.setPricing({ FDM: { KEEP: 5 }, SLA: { KEEP: 6 } });
        events.length = 0;
        assert.throws(load, (error) => {
            assert.equal(error.code, PRICING_FILE_INVALID, content);
            assert.equal(error.errorCode, 'PRICING_FILE_INVALID', content);
            assert.doesNotMatch(error.message, /pricing-state|pricing\.json|\{|\[/, 'no path or content leaks');
            return true;
        }, content);
        assert.equal(await fsp.readFile(paths.primaryFile, 'utf8'), content, 'file must stay untouched');
        assert.deepEqual(catalog.getPricing(), { FDM: { KEEP: 5 }, SLA: { KEEP: 6 } }, 'catalog untouched');
        assert.deepEqual(events.map((event) => [event.outcome, event.error_code]), [['failure', 'PRICING_LOAD_FAILED']]);
    }
});

test('a legacy pricing file is migrated when valid and refused when corrupt', async (t) => {
    const { paths, catalog, load } = await fixture(t);
    await fsp.writeFile(paths.legacyFile, JSON.stringify({ FDM: { PLA: 850 }, SLA: { Standard: 1900 } }));
    load();
    assert.deepEqual(catalog.getPricing(), { FDM: { PLA: 850 }, SLA: { Standard: 1900 } });
    assert.deepEqual(JSON.parse(await fsp.readFile(paths.primaryFile, 'utf8')), { FDM: { PLA: 850 }, SLA: { Standard: 1900 } });

    await fsp.rm(paths.primaryFile);
    await fsp.writeFile(paths.legacyFile, '{"FDM":');
    assert.throws(load, { code: PRICING_FILE_INVALID });
    assert.equal(fs.existsSync(paths.primaryFile), false, 'no primary file is written from a corrupt legacy file');
    assert.equal(await fsp.readFile(paths.legacyFile, 'utf8'), '{"FDM":');
});

test('a valid existing file is authoritative and never merged with defaults', async (t) => {
    const { paths, catalog, load } = await fixture(t);
    await fsp.mkdir(paths.stateRoot, { recursive: true });
    const stored = '{"FDM":{"ASA":1200},"SLA":{"Tough":2400}}';
    await fsp.writeFile(paths.primaryFile, stored);
    load();
    assert.deepEqual(catalog.getPricing(), { FDM: { ASA: 1200 }, SLA: { Tough: 2400 } });
    assert.equal(await fsp.readFile(paths.primaryFile, 'utf8'), stored, 'a valid primary file is not rewritten');
});

test('catalog refuses to remove the last material of a technology', () => {
    const catalog = new PricingCatalog({ FDM: { PLA: 800, PETG: 900 }, SLA: { Standard: 1800 } });
    catalog.removeMaterial('FDM', 'PETG');
    assert.deepEqual(catalog.getAllowedMaterialsForTechnology('FDM'), ['PLA']);
    assert.throws(() => catalog.removeMaterial('FDM', 'PLA'), { code: LAST_MATERIAL_PROTECTED });
    assert.throws(() => catalog.removeMaterial('SLA', 'Standard'), { code: LAST_MATERIAL_PROTECTED });
    assert.deepEqual(catalog.getPricing(), { FDM: { PLA: 800 }, SLA: { Standard: 1800 } });
    assert.equal(pricingHealthy(catalog.getPricing()), true);
    // Unknown keys are a no-op, never a protection error.
    catalog.removeMaterial('FDM', 'NOPE');
    catalog.removeMaterial('XYZ', 'PLA');
    assert.throws(() => assertNotLastMaterial({ ONLY: 1 }, 'ONLY'), { code: LAST_MATERIAL_PROTECTED });
    assert.doesNotThrow(() => assertNotLastMaterial({ ONLY: 1 }, 'OTHER'));
    assert.doesNotThrow(() => assertNotLastMaterial({ A: 1, B: 2 }, 'A'));
    assert.equal(LAST_MATERIAL_PROTECTED, 'LAST_MATERIAL_PROTECTED');
    assert.equal(PRICING_ERROR_CODES.LAST_MATERIAL_PROTECTED, 'LAST_MATERIAL_PROTECTED');
});

async function withIsolatedPricingServer(t, callback) {
    const { paths, repository, catalog } = await fixture(t);
    catalog.setPricing({ FDM: { PLA: 800, PETG: 900 }, SLA: { Standard: 1800 } });
    const commit = createPricingMutationCoordinator(repository, catalog);
    const pricingService = {
        getPricing: () => catalog.getPricing(),
        findMaterialKey: (technology, material) => catalog.findMaterialKey(technology, material),
        commitPricingMutation: (mutator) => commit(mutator)
    };
    const app = express();
    app.use(express.json());
    app.use(createPricingRouter({ authenticate: (req, res, next) => next(), pricingService }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await callback(async (method, route) => {
            const response = await fetch(`${base}${route}`, { method });
            return { status: response.status, payload: await response.json() };
        }, { paths, catalog });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('DELETE answers 409 LAST_MATERIAL_PROTECTED for the last material and leaves pricing intact', async (t) => {
    await withIsolatedPricingServer(t, async (request, { paths, catalog }) => {
        const first = await request('DELETE', '/pricing/FDM/PETG');
        assert.equal(first.status, 200);
        assert.equal(first.payload.material, 'PETG');
        assert.deepEqual(catalog.getAllowedMaterialsForTechnology('FDM'), ['PLA']);

        const last = await request('DELETE', '/pricing/FDM/pla');
        assert.equal(last.status, 409);
        assert.deepEqual(last.payload, {
            success: false,
            error: 'The last material of a technology cannot be deleted.',
            errorCode: 'LAST_MATERIAL_PROTECTED'
        });
        const sla = await request('DELETE', '/pricing/SLA/Standard');
        assert.equal(sla.status, 409);
        assert.equal(sla.payload.errorCode, PRICING_ERROR_CODES.LAST_MATERIAL_PROTECTED);

        assert.deepEqual(catalog.getPricing(), { FDM: { PLA: 800 }, SLA: { Standard: 1800 } });
        assert.equal(pricingHealthy(catalog.getPricing()), true);
        assert.deepEqual(JSON.parse(await fsp.readFile(paths.primaryFile, 'utf8')), { FDM: { PLA: 800 }, SLA: { Standard: 1800 } });

        const listed = await request('GET', '/pricing');
        assert.deepEqual(listed.payload, { FDM: { PLA: 800 }, SLA: { Standard: 1800 } });
    });
});
