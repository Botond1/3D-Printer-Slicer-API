'use strict';

/**
 * Feature detection for the V3 plugin: `GET /capabilities` (3.9.0 §2.1, §4.8).
 *
 * Slice-key authentication through `authenticateOrCharge` (a wrong or empty
 * key is always today's 401, never a 429), then the document built from the
 * resolved resource policy, the release policy, the running generation and
 * `req.slicePrincipal`. `Cache-Control: no-store`, written without an ETag so
 * a read can never become a 304. The document is never digested.
 *
 * 3.8.x answers 404 `ROUTE_NOT_FOUND` here: a client reads that as "none of
 * §2.2–2.6". A feature absent from the document is absent.
 */

const express = require('express');
const releasePolicy = require('../config/release-policy');
const requireSliceService = require('../middleware/requireSliceService');
const { createAuthenticateOrCharge } = require('../middleware/sliceAdmission');
const { getBambuGeneration } = require('../services/slice/bambu-generation');
const { ARCHIVE_RULES } = require('../services/slice/resource-errors');
const { defaultExpansionLimits } = require('../services/slice/three-mf-expansion');

/**
 * The release this document describes. A literal, not a `package.json` read:
 * the image flattens `app/` into `/app` beside `package.json`, the checkout
 * does not. `tests/unit/js/capabilities.test.js` pins it to `package.json`.
 */
const SERVICE_VERSION = '3.9.0';
const CAPABILITIES_ROUTE_PATH = '/capabilities';
const CAPABILITIES_SCHEMA = 'r3d-slicer-capabilities-v1';
const ASYNC_CONTRACT = 1;
const EXPORT_CONTRACT = 1;
const EXPORT_FORMATS = Object.freeze(['stl', '3mf']);
const EXPORT_FIDELITY = Object.freeze(['exact', 'unverified']);
/**
 * The Python build walk's own bounds (the parts, depth and instances
 * constants of `app/mesh2stl.py`). `mesh2stl.py` is a hashed
 * processing file, so the numbers are mirrored here and pinned against its
 * source by `tests/unit/js/capabilities.test.js`.
 */
const PYTHON_BUILD_WALK_LIMITS = Object.freeze({
    max_model_parts: 512,
    max_component_depth: 16,
    max_build_items: 4096
});
const HEX64 = /^[a-f0-9]{64}$/;

function runningGeneration(readGeneration) {
    try {
        const current = readGeneration();
        const value = current?.measurement_generation;
        return typeof value === 'string' && HEX64.test(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * Build the §2.1 document.
 * @param {object} options `resourcePolicy` (resolved), optional `policy`
 *   (release policy), `readGeneration`, `expansionLimits`, `principal`.
 * @returns {object} The capabilities document.
 */
function buildCapabilitiesDocument(options) {
    const resourcePolicy = options.resourcePolicy;
    const policy = options.policy || releasePolicy;
    const expansion = options.expansionLimits || defaultExpansionLimits();
    const principal = options.principal || {};
    const exportPolicy = policy.export;
    return {
        schema: CAPABILITIES_SCHEMA,
        service_version: options.serviceVersion || SERVICE_VERSION,
        async_contract: ASYNC_CONTRACT,
        measurement_generation: { bambu: runningGeneration(options.readGeneration || (() => getBambuGeneration(false))) },
        authenticated_as: {
            principal: typeof principal.slot === 'string' ? principal.slot : null,
            rotation: typeof principal.rotation === 'string' ? principal.rotation : null
        },
        export: {
            enabled: exportPolicy.EXPORT_ROUTE_ENABLED === true,
            contract: EXPORT_CONTRACT,
            route: '/bambu/export',
            formats: [...EXPORT_FORMATS],
            fidelity: [...EXPORT_FIDELITY],
            sync_deadline_ms: exportPolicy.EXPORT_SYNC_DEADLINE_MS,
            async_deadline_ms: exportPolicy.EXPORT_ASYNC_DEADLINE_MS,
            result_ttl_ms: exportPolicy.EXPORT_RESULT_TTL_MS,
            max_upload_bytes: resourcePolicy.MAX_UPLOAD_BYTES
        },
        deletion: {
            artifact_ttl_ms: resourcePolicy.ARTIFACT_TTL_MS,
            artifact_sweep_interval_ms: policy.retention.ARTIFACT_SWEEP_INTERVAL_MS,
            job_delete_removes_artifact: true,
            startup_orphan_purge: true,
            core_dumps: false
        },
        archive_limits: {
            max_entries: resourcePolicy.MAX_ZIP_ENTRIES,
            max_total_uncompressed_bytes: resourcePolicy.MAX_ZIP_UNCOMPRESSED_BYTES,
            max_entry_bytes: resourcePolicy.MAX_ZIP_ENTRY_BYTES,
            max_entry_compression_ratio: resourcePolicy.MAX_ZIP_COMPRESSION_RATIO,
            max_path_depth: resourcePolicy.MAX_3MF_PATH_DEPTH,
            ...PYTHON_BUILD_WALK_LIMITS,
            max_expanded_triangles: expansion.maxTriangles,
            max_expanded_instances: expansion.maxInstances,
            rules: [...ARCHIVE_RULES]
        }
    };
}

/**
 * Build the capabilities router.
 * @param {object} options `resourcePolicy` (required), `authenticate` (the
 *   slice authenticator) or a ready `authenticateOrCharge`,
 *   `authFailureLimiter`, and the `buildCapabilitiesDocument` seams.
 * @returns {import('express').Router} Router.
 */
function createCapabilitiesRouter(options = {}) {
    if (!options.resourcePolicy || typeof options.resourcePolicy !== 'object') {
        throw new Error('A resolved resource policy is required.');
    }
    const router = express.Router();
    const authenticate = options.authenticateOrCharge || createAuthenticateOrCharge({
        authenticate: options.authenticate || requireSliceService,
        failureLimiter: options.authFailureLimiter
    });
    router.get(CAPABILITIES_ROUTE_PATH, authenticate, (req, res) => {
        const document = buildCapabilitiesDocument({ ...options, principal: req.slicePrincipal });
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).end(JSON.stringify(document));
    });
    return router;
}

module.exports = {
    CAPABILITIES_ROUTE_PATH,
    CAPABILITIES_SCHEMA,
    PYTHON_BUILD_WALK_LIMITS,
    SERVICE_VERSION,
    buildCapabilitiesDocument,
    createCapabilitiesRouter
};
