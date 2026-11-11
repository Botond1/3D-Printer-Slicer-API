'use strict';

/**
 * 3.9.0 §2.1 / §4.8: `GET /capabilities` behind the slice key. The document
 * mirrors the resolved resource policy, the release policy and the running
 * generation; a wrong or empty key is always today's 401 (never a 429), and
 * only a keyless flood reaches the limiter's 429.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');

const ROOT = path.resolve(__dirname, '../../..');
const { resolveServiceKeyRing } = require('../../../app/config/service-auth');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const releasePolicy = require('../../../app/config/release-policy');
const { createRequireSliceService } = require('../../../app/middleware/requireSliceService');
const { createAuthFailureLimiter } = require('../../../app/middleware/sliceAdmission');
const {
    PYTHON_BUILD_WALK_LIMITS,
    SERVICE_VERSION,
    buildCapabilitiesDocument,
    createCapabilitiesRouter
} = require('../../../app/routes/capabilities.routes');
const { ARCHIVE_RULES } = require('../../../app/services/slice/resource-errors');
const { ERROR_ANSWERS } = require('../../contract/live-plugin-29a4a1c7/fixtures');

const FIXTURE_401 = ERROR_ANSWERS.find((answer) => answer.name === '401 with a wrong key');
const key = (name) => `caps-${name}-${'k'.repeat(40)}`;
const KEYS = Object.freeze({
    woocommerce: key('woocommerce'),
    woocommercePrevious: key('woocommerce-previous'),
    leadpilot: key('leadpilot'),
    wrong: key('wrong')
});
const GENERATION = 'a'.repeat(64);

function keyRing() {
    return resolveServiceKeyRing({
        SLICE_SERVICE_AUTH_MODE: 'principals',
        SLICE_SERVICE_WOOCOMMERCE_API_KEY: KEYS.woocommerce,
        SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS: KEYS.woocommercePrevious,
        SLICE_SERVICE_LEADPILOT_API_KEY: KEYS.leadpilot,
        PRICING_API_KEY: key('pricing'),
        ARTIFACT_API_KEY: key('artifact'),
        OPERATIONS_API_KEY: key('operations')
    }, { now: Date.parse('2026-11-11T12:00:00.000Z') });
}

async function start(t, options = {}) {
    const app = express();
    app.use(createCapabilitiesRouter({
        authenticate: createRequireSliceService({ keyRing: keyRing(), logger: { warn() {} } }),
        authFailureLimiter: options.authFailureLimiter || createAuthFailureLimiter(),
        resourcePolicy: options.resourcePolicy || resolveResourcePolicy({}),
        readGeneration: () => ({ measurement_generation: GENERATION }),
        ...options.router
    }));
    app.all('*', (req, res) => res.status(404).json({ success: false, error: 'Route not found.', errorCode: 'ROUTE_NOT_FOUND' }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

test('the document is the §2.1 shape, mirrored from the resolved policies', async (t) => {
    const resourcePolicy = resolveResourcePolicy({ MAX_UPLOAD_BYTES: '125829120', ARTIFACT_TTL_MS: '3600000' });
    const url = await start(t, { resourcePolicy });
    const response = await fetch(`${url}/capabilities`, { headers: { 'x-slicer-api-key': KEYS.woocommerce } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const document = await response.json();
    assert.deepEqual(Object.keys(document), [
        'schema', 'service_version', 'async_contract', 'measurement_generation', 'authenticated_as',
        'export', 'deletion', 'archive_limits'
    ]);
    assert.equal(document.schema, 'r3d-slicer-capabilities-v1');
    assert.equal(document.service_version, '3.9.0');
    assert.equal(document.async_contract, 1);
    assert.deepEqual(document.measurement_generation, { bambu: GENERATION });
    assert.deepEqual(document.authenticated_as, { principal: 'woocommerce', rotation: 'active' });
    assert.deepEqual(document.export, {
        enabled: releasePolicy.export.EXPORT_ROUTE_ENABLED,
        contract: 1,
        route: '/bambu/export',
        formats: ['stl', '3mf'],
        fidelity: ['exact', 'unverified'],
        sync_deadline_ms: 90_000,
        async_deadline_ms: releasePolicy.export.EXPORT_ASYNC_DEADLINE_MS,
        result_ttl_ms: 900_000,
        max_upload_bytes: 125_829_120
    });
    assert.deepEqual(document.deletion, {
        artifact_ttl_ms: 3_600_000,
        artifact_sweep_interval_ms: 300_000,
        job_delete_removes_artifact: true,
        startup_orphan_purge: true,
        core_dumps: false
    });
    assert.deepEqual(document.archive_limits, {
        max_entries: 500,
        max_total_uncompressed_bytes: 524_288_000,
        max_entry_bytes: 524_288_000,
        max_entry_compression_ratio: 100,
        max_path_depth: 4,
        max_model_parts: 512,
        max_component_depth: 16,
        max_build_items: 4096,
        max_expanded_triangles: 50_000_000,
        max_expanded_instances: 100_000,
        rules: [
            'ARCHIVE_UNREADABLE', 'ARCHIVE_ENCRYPTED', 'ARCHIVE_UNSAFE_PATH', 'ARCHIVE_NESTED',
            'ARCHIVE_DISALLOWED_PART', 'ARCHIVE_TOO_MANY_ENTRIES', 'ARCHIVE_TOO_LARGE',
            'ARCHIVE_RATIO_EXCEEDED', 'ARCHIVE_EXPANSION_EXCEEDED'
        ]
    });
    assert.deepEqual(document.archive_limits.rules, [...ARCHIVE_RULES]);
});

test('the previous rotation and another principal are named; export.enabled follows the policy', async (t) => {
    const url = await start(t);
    const previous = await (await fetch(`${url}/capabilities`, {
        headers: { 'x-slicer-api-key': KEYS.woocommercePrevious }
    })).json();
    assert.deepEqual(previous.authenticated_as, { principal: 'woocommerce', rotation: 'previous' });
    const leadpilot = await (await fetch(`${url}/capabilities`, {
        headers: { 'x-slicer-api-key': KEYS.leadpilot }
    })).json();
    assert.deepEqual(leadpilot.authenticated_as, { principal: 'leadpilot', rotation: 'active' });

    const on = buildCapabilitiesDocument({
        resourcePolicy: resolveResourcePolicy({}),
        policy: { ...releasePolicy, export: { ...releasePolicy.export, EXPORT_ROUTE_ENABLED: true } },
        readGeneration: () => ({ measurement_generation: GENERATION })
    });
    assert.equal(on.export.enabled, true);
    const off = buildCapabilitiesDocument({
        resourcePolicy: resolveResourcePolicy({}),
        policy: { ...releasePolicy, export: { ...releasePolicy.export, EXPORT_ROUTE_ENABLED: false } },
        readGeneration: () => ({ measurement_generation: GENERATION })
    });
    assert.equal(off.export.enabled, false);
});

test('an unavailable generation reads as null, never as a made-up value', () => {
    for (const readGeneration of [() => { throw new Error('not initialised'); }, () => null,
        () => ({ measurement_generation: 'nope' })]) {
        const document = buildCapabilitiesDocument({ resourcePolicy: resolveResourcePolicy({}), readGeneration });
        assert.deepEqual(document.measurement_generation, { bambu: null });
    }
});

test('a wrong or empty key is always today\'s 401, never a 429; only keyless requests reach the 429', async (t) => {
    const url = await start(t);
    let withRetryAfter = 0;
    for (let index = 0; index < 120; index += 1) {
        const response = await fetch(`${url}/capabilities`, {
            headers: { 'x-slicer-api-key': index % 10 === 0 ? '' : KEYS.wrong }
        });
        assert.equal(response.status, 401, `request ${index}`);
        assert.deepEqual(await response.json(), FIXTURE_401.body);
        if (response.headers.get('retry-after')) withRetryAfter += 1;
    }
    // The failure bucket (burst 30) is spent, so the 401s carry Retry-After.
    assert.ok(withRetryAfter >= 60, `401 with Retry-After: ${withRetryAfter}`);

    // A valid key from the same address is still admitted.
    const valid = await fetch(`${url}/capabilities`, { headers: { 'x-slicer-api-key': KEYS.woocommerce } });
    assert.equal(valid.status, 200);

    // No key header at all: once the bucket is spent the limiter answers 429.
    const keyless = await fetch(`${url}/capabilities`);
    assert.equal(keyless.status, 429);
    assert.ok(Number(keyless.headers.get('retry-after')) >= 1);
    assert.equal((await keyless.json()).errorCode, 'RATE_LIMIT_EXCEEDED');
});

test('the mirrored numbers match their sources', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(SERVICE_VERSION, packageJson.version);
    const mesh2stl = fs.readFileSync(path.join(ROOT, 'app', 'mesh2stl.py'), 'utf8');
    assert.match(mesh2stl, new RegExp(`^THREE_MF_MAX_PARTS = ${PYTHON_BUILD_WALK_LIMITS.max_model_parts}\\s*$`, 'm'));
    assert.match(mesh2stl, new RegExp(`^THREE_MF_MAX_DEPTH = ${PYTHON_BUILD_WALK_LIMITS.max_component_depth}\\s*$`, 'm'));
    assert.match(mesh2stl, new RegExp(`^THREE_MF_MAX_INSTANCES = ${PYTHON_BUILD_WALK_LIMITS.max_build_items}\\s*$`, 'm'));
    // The spec document carries the same shipped defaults (§2.1).
    const specification = fs.readFileSync(path.join(ROOT, 'docs', 'release', '3.9.0-specification.md'), 'utf8');
    assert.match(specification, /"max_expanded_triangles": 50000000, "max_expanded_instances": 100000/);
    assert.equal(releasePolicy.archive.MAX_3MF_EXPANDED_TRIANGLES, 50_000_000);
    assert.ok(releasePolicy.archive.MAX_3MF_EXPANDED_TRIANGLES >= 4 * 10_403_988, 'default ≥ 4 × the T-ARC-2 corpus maximum');
});

test('the document carries no key material, digest of a key or path', async (t) => {
    const url = await start(t);
    const text = await (await fetch(`${url}/capabilities`, { headers: { 'x-slicer-api-key': KEYS.woocommerce } })).text();
    for (const secret of Object.values(KEYS)) assert.equal(text.includes(secret), false);
    assert.doesNotMatch(text, /[A-Za-z]:\\\\|\/app\/|\/srv\//);
});
