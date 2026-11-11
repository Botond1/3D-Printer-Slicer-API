'use strict';

/** 3.9.0 §4.5 / H8: the JSON and form parsers run only behind pricing authentication. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { createPricingRouter } = require('../../../app/routes/pricing.routes');

function pricingService(commits) {
    return {
        getPricing: () => ({ FDM: { PLA: 1 }, SLA: { RESIN: 1 } }),
        findMaterialKey: () => null,
        commitPricingMutation: async (mutator) => {
            const candidate = { FDM: {}, SLA: {} };
            const result = mutator(candidate);
            commits.push(candidate);
            return result;
        }
    };
}

async function start(t, authenticate, commits) {
    const app = express();
    // No app-level parser: the integrator removes `server.js`'s.
    app.use(createPricingRouter({ authenticate, pricingService: pricingService(commits) }));
    app.use((error, req, res, next) => {
        void next;
        res.status(error.status || 500).json({ parserError: error.type || 'other' });
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

test('an unauthenticated pricing mutation is refused before its body is parsed', async (t) => {
    let parsedBodySeen = false;
    const url = await start(t, (req, res) => {
        parsedBodySeen = req.body !== undefined;
        res.status(401).json({ success: false, error: 'Unauthorized' });
    }, []);
    const response = await fetch(`${url}/pricing/FDM`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json'
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, error: 'Unauthorized' });
    assert.equal(parsedBodySeen, false);
});

test('after authentication the JSON body is parsed (1 MiB limit) and an over-limit body is 413', async (t) => {
    const commits = [];
    const url = await start(t, (req, res, next) => next(), commits);
    const created = await fetch(`${url}/pricing/FDM`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ material: 'petg', price: 12 })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).material, 'PETG');
    assert.equal(commits.length, 1);
    const malformed = await fetch(`${url}/pricing/FDM`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json'
    });
    assert.equal(malformed.status, 400);
    const huge = await fetch(`${url}/pricing/FDM`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ material: 'x', pad: 'a'.repeat(1024 * 1024 + 16) })
    });
    assert.equal(huge.status, 413);
    const form = await fetch(`${url}/pricing/SLA`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'material=tough&price=7'
    });
    assert.equal(form.status, 201);
});

test('GET /pricing stays public and parser-free', async (t) => {
    const url = await start(t, (req, res) => res.status(401).end(), []);
    const response = await fetch(`${url}/pricing`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { FDM: { PLA: 1 }, SLA: { RESIN: 1 } });
});
