'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const FILES = Object.freeze({
    env: 'tests/testing-scripts/common/env_utils.py',
    pricing: 'tests/testing-scripts/pricing/pricing_cycle_test_runner.py',
    artifact: 'tests/testing-scripts/admin/admin_output_files_test_runner.py',
    rateLimit: 'tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py',
    operations: 'tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py'
});
const SOURCES = Object.fromEntries(Object.entries(FILES).map(([name, relative]) => [
    name, fs.readFileSync(path.join(ROOT, relative), 'utf8')
]));

function validate(sources) {
    assert.match(sources.env,
        /def resolve_pricing_api_key_candidates[\s\S]{0,160}?"PRICING_API_KEY"/);
    assert.match(sources.env,
        /def resolve_artifact_api_key_candidates[\s\S]{0,160}?"ARTIFACT_API_KEY"/);
    assert.match(sources.env,
        /def resolve_operations_api_key_candidates[\s\S]{0,160}?"OPERATIONS_API_KEY"/);
    assert.doesNotMatch(sources.env, /resolve_admin_key|get_preferred_admin/);
    assert.match(sources.pricing, /resolve_pricing_api_key_candidates\(PROJECT_ROOT\)/);
    assert.doesNotMatch(sources.pricing, /resolve_admin|ADMIN_API_KEY/);
    assert.match(sources.artifact, /resolve_artifact_api_key_candidates\(PROJECT_ROOT\)/);
    assert.doesNotMatch(sources.artifact, /resolve_admin|ADMIN_API_KEY/);
    assert.match(sources.rateLimit, /resolve_artifact_api_key_candidates\(PROJECT_ROOT\)/);
    assert.doesNotMatch(sources.rateLimit, /resolve_admin|ADMIN_API_KEY/);
    assert.match(sources.operations, /resolve_operations_api_key_candidates\(PROJECT_ROOT\)/);
    assert.match(sources.operations,
        /OPERATIONS_PATHS = \(\s*"\/health\/detailed",\s*"\/operations\/readiness",\s*"\/operations\/metrics",\s*\)/);
}

test('integration runners reject broad or cross-audience credential mutations', async (t) => {
    validate(SOURCES);
    const cases = [
        ['pricing uses artifact credential', 'pricing',
            'resolve_pricing_api_key_candidates(PROJECT_ROOT)',
            'resolve_artifact_api_key_candidates(PROJECT_ROOT)'],
        ['artifact uses pricing credential', 'artifact',
            'resolve_artifact_api_key_candidates(PROJECT_ROOT)',
            'resolve_pricing_api_key_candidates(PROJECT_ROOT)'],
        ['rate-limit artifact probe uses operations credential', 'rateLimit',
            'resolve_artifact_api_key_candidates(PROJECT_ROOT)',
            'resolve_operations_api_key_candidates(PROJECT_ROOT)'],
        ['operations uses artifact credential', 'operations',
            'resolve_operations_api_key_candidates(PROJECT_ROOT)',
            'resolve_artifact_api_key_candidates(PROJECT_ROOT)'],
        ['metrics probe removed', 'operations',
            '    "/operations/metrics",', '']
    ];
    for (const [name, file, from, to] of cases) await t.test(name, () => {
        assert.ok(SOURCES[file].includes(from), `missing runner mutation seam: ${name}`);
        assert.throws(() => validate({
            ...SOURCES,
            [file]: SOURCES[file].replace(from, to)
        }), assert.AssertionError);
    });
});
