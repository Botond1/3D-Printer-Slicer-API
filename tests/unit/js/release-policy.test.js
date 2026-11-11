'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const releasePolicy = require('../../../app/config/release-policy');

const { RELEASE_POLICY_DEFINITIONS, resolveReleasePolicy } = releasePolicy;
const SECTIONS = Object.freeze(['identity', 'retention', 'archive', 'authFailure', 'children', 'export']);
const MODULE_PATH = path.resolve(__dirname, '../../../app/config/release-policy.js');

const EXPECTED_DEFAULTS = Object.freeze({
    identity: {
        NATIVE_IDENTITY_MONITOR: true,
        NATIVE_IDENTITY_VERIFY_INTERVAL_MS: 300_000,
        NATIVE_IDENTITY_MAX_AGE_MS: 900_000,
        NATIVE_IDENTITY_TIMEOUT_MS: 120_000
    },
    retention: { ARTIFACT_SWEEP_INTERVAL_MS: 300_000, ARTIFACT_SWEEP_MAX_MS: 10_000 },
    archive: {
        // Raised from the spec's 25 000 000 by the T-ARC-2 rule (default ≥ 4 × the
        // corpus maximum 10 403 988 = 41 615 952).
        MAX_3MF_EXPANDED_TRIANGLES: 50_000_000,
        MAX_3MF_EXPANDED_INSTANCES: 100_000,
        MAX_3MF_MODEL_OBJECTS: 100_000
    },
    authFailure: {
        AUTH_FAILURE_RATE_LIMIT_WINDOW_MS: 60_000,
        AUTH_FAILURE_RATE_LIMIT_MAX_REQUESTS: 60,
        AUTH_FAILURE_RATE_LIMIT_BURST_CAPACITY: 30
    },
    children: { CHILD_OOM_SCORE_ADJ: 500 },
    export: {
        EXPORT_ROUTE_ENABLED: false,
        EXPORT_SYNC_DEADLINE_MS: 90_000,
        EXPORT_ASYNC_DEADLINE_MS: 900_000,
        EXPORT_RESULT_TTL_MS: 900_000,
        EXPORT_MAX_JOBS: 4,
        EXPORT_RATE_LIMIT_WINDOW_MS: 60_000,
        EXPORT_RATE_LIMIT_MAX_REQUESTS: 6,
        EXPORT_RATE_LIMIT_BURST_CAPACITY: 3
    }
});

// The live async slice deadline (900 s); the export default is bounded by it.
const LIVE_ENV = Object.freeze({ ASYNC_SLICE_DEADLINE_MS: '900000' });

test('absent keys resolve to the §6 defaults, one frozen object per section', () => {
    const policy = resolveReleasePolicy({ ...LIVE_ENV });
    assert.deepEqual(Object.keys(policy).sort(), [...SECTIONS].sort());
    for (const section of SECTIONS) {
        assert.deepEqual({ ...policy[section] }, EXPECTED_DEFAULTS[section], section);
        assert.equal(Object.isFrozen(policy[section]), true, section);
    }
    assert.equal(Object.isFrozen(policy), true);
});

test('the module exports each section resolved from process.env at load', () => {
    for (const section of SECTIONS) {
        assert.equal(releasePolicy[section], releasePolicy.RELEASE_POLICY[section], section);
        assert.equal(Object.isFrozen(releasePolicy[section]), true, section);
    }
    // Every §6 key is defined in exactly one section.
    const names = SECTIONS.flatMap((section) => Object.keys(RELEASE_POLICY_DEFINITIONS[section]));
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.length, 21);
});

test('without ASYNC_SLICE_DEADLINE_MS the export async default follows the 600 s slice default', () => {
    assert.equal(resolveReleasePolicy({}).export.EXPORT_ASYNC_DEADLINE_MS, 600_000);
    assert.equal(resolveReleasePolicy({ ASYNC_SLICE_DEADLINE_MS: '1800000' }).export.EXPORT_ASYNC_DEADLINE_MS,
        900_000);
});

test('every integer key accepts its bounds and refuses outside, non-canonical and non-integer values', () => {
    for (const section of SECTIONS) {
        for (const [name, definition] of Object.entries(RELEASE_POLICY_DEFINITIONS[section])) {
            if (definition.type !== 'integer') continue;
            const base = { ASYNC_SLICE_DEADLINE_MS: '1800000' };
            // Keep the cross-key rule satisfiable while one bound is probed.
            if (name === 'NATIVE_IDENTITY_MAX_AGE_MS') base.NATIVE_IDENTITY_VERIFY_INTERVAL_MS = '60000';
            if (name === 'NATIVE_IDENTITY_VERIFY_INTERVAL_MS') base.NATIVE_IDENTITY_MAX_AGE_MS = '7200000';
            for (const bound of [definition.min, definition.max]) {
                const resolved = resolveReleasePolicy({ ...base, [name]: String(bound) });
                assert.equal(resolved[section][name], bound, `${name}=${bound}`);
            }
            const refused = [String(definition.max + 1), '01', '+5', '1e3', '1.0', ' 5', '5 ', '-1', '', 'NaN',
                '9007199254740993'];
            if (definition.min > 0) refused.push(String(definition.min - 1), '0');
            for (const value of refused) {
                assert.throws(() => resolveReleasePolicy({ ...base, [name]: value }), new RegExp(name),
                    `${name}=${JSON.stringify(value)}`);
            }
        }
    }
});

test('0 is admitted only where the range starts at 0', () => {
    assert.equal(resolveReleasePolicy({ CHILD_OOM_SCORE_ADJ: '0' }).children.CHILD_OOM_SCORE_ADJ, 0);
    const zeroStarts = SECTIONS.flatMap((section) => Object.entries(RELEASE_POLICY_DEFINITIONS[section]))
        .filter(([, definition]) => definition.type === 'integer' && definition.min === 0)
        .map(([name]) => name);
    assert.deepEqual(zeroStarts, ['CHILD_OOM_SCORE_ADJ']);
    assert.throws(() => resolveReleasePolicy({ EXPORT_MAX_JOBS: '0' }), /EXPORT_MAX_JOBS/);
});

test('enums take exact spellings only', () => {
    assert.equal(resolveReleasePolicy({ NATIVE_IDENTITY_MONITOR: 'off' }).identity.NATIVE_IDENTITY_MONITOR, false);
    assert.equal(resolveReleasePolicy({ NATIVE_IDENTITY_MONITOR: 'on' }).identity.NATIVE_IDENTITY_MONITOR, true);
    assert.equal(resolveReleasePolicy({ EXPORT_ROUTE_ENABLED: 'true' }).export.EXPORT_ROUTE_ENABLED, true);
    assert.equal(resolveReleasePolicy({ EXPORT_ROUTE_ENABLED: 'false' }).export.EXPORT_ROUTE_ENABLED, false);
    for (const value of ['ON', 'true', '1', '', 'yes', ' on']) {
        assert.throws(() => resolveReleasePolicy({ NATIVE_IDENTITY_MONITOR: value }), /NATIVE_IDENTITY_MONITOR/);
    }
    for (const value of ['TRUE', 'on', '1', '', 'yes']) {
        assert.throws(() => resolveReleasePolicy({ EXPORT_ROUTE_ENABLED: value }), /EXPORT_ROUTE_ENABLED/);
    }
});

test('cross-key rules: MAX_AGE >= 2 × INTERVAL, export async deadline <= async slice deadline', () => {
    assert.equal(resolveReleasePolicy({
        NATIVE_IDENTITY_VERIFY_INTERVAL_MS: '450000'
    }).identity.NATIVE_IDENTITY_MAX_AGE_MS, 900_000);
    assert.throws(() => resolveReleasePolicy({ NATIVE_IDENTITY_VERIFY_INTERVAL_MS: '450001' }),
        /NATIVE_IDENTITY_MAX_AGE_MS/);
    assert.throws(() => resolveReleasePolicy({
        NATIVE_IDENTITY_VERIFY_INTERVAL_MS: '600000', NATIVE_IDENTITY_MAX_AGE_MS: '1199999'
    }), /NATIVE_IDENTITY_MAX_AGE_MS/);

    assert.equal(resolveReleasePolicy({ ...LIVE_ENV, EXPORT_ASYNC_DEADLINE_MS: '900000' })
        .export.EXPORT_ASYNC_DEADLINE_MS, 900_000);
    assert.throws(() => resolveReleasePolicy({ ...LIVE_ENV, EXPORT_ASYNC_DEADLINE_MS: '900001' }),
        /EXPORT_ASYNC_DEADLINE_MS/);
    assert.throws(() => resolveReleasePolicy({ EXPORT_ASYNC_DEADLINE_MS: '900000' }),
        /EXPORT_ASYNC_DEADLINE_MS/);
});

test('an invalid value refuses startup when the module is first required', () => {
    const run = (env) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(MODULE_PATH)})`], {
        env: { ...process.env, ...env }, encoding: 'utf8'
    });
    const refused = run({ EXPORT_MAX_JOBS: '17' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /EXPORT_MAX_JOBS must be between 1 and 16/);
    const admitted = run({ EXPORT_MAX_JOBS: '16' });
    assert.equal(admitted.status, 0, admitted.stderr);
});

test('no secret is read: the staging key names are not part of the policy', () => {
    const policy = resolveReleasePolicy({
        SLICE_SERVICE_STAGING_API_KEY: 'x'.repeat(48), SLICE_SERVICE_STAGING_API_KEY_PREVIOUS: 'y'.repeat(48)
    });
    assert.doesNotMatch(JSON.stringify(policy), /xxxx|yyyy|STAGING/);
});
