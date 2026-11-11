'use strict';

// T-TRF pack (3.9.0 §7): the cases follow public-routes.json, the throwaway
// Traefik is the live digest on an internal network, and `run-matrix.sh plan`
// builds the position-substituted router from a rendered file (no docker).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    TRAEFIK_IMAGE, loadOperatorPack, renderFromLiveSource
} = require('../../../scripts/i12-hostinger-operator-contract');

const ROOT = path.resolve(__dirname, '../../..');
const PACK = path.join(ROOT, 'ops', 'hostinger', 'traefik-matrix');
const ROUTES = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops', 'hostinger', 'public-routes.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(PACK, 'cases.json'), 'utf8'));
const LIVE_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'hostinger', 'live-slicer-api-3.8.3.yml');
const BASH = (() => {
    const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    return probe.status === 0 && probe.stdout.trim() === 'ok' ? 'bash' : null;
})();
function bashPath(target) {
    if (process.platform !== 'win32') return target;
    return target.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replace(/\\/g, '/');
}

test('every listed route is a matrix case with the right router verdict', () => {
    for (const route of ROUTES.routes) {
        const method = route.method === 'USE' || route.method === 'ALL' ? 'GET' : route.method;
        const found = CASES.cases.find((entry) => entry.method === method && entry.path === route.sample);
        assert.ok(found, `${method} ${route.sample}`);
        assert.equal(found.router, route.visibility === 'public', `${method} ${route.sample}`);
    }
    assert.ok(CASES.cases.some((entry) => entry.router) && CASES.cases.some((entry) => !entry.router));
});

test('the throwaway Traefik is the live digest, internal-only, with three fixed client addresses', () => {
    const compose = fs.readFileSync(path.join(PACK, 'compose.yml'), 'utf8');
    assert.ok(compose.includes(`image: ${TRAEFIK_IMAGE}`));
    assert.match(compose, /internal: true/);
    assert.doesNotMatch(compose, /^\s+ports:/m);
    for (const address of ['172.31.239.11', '172.31.239.12', '172.31.239.13']) assert.ok(compose.includes(address));
    assert.match(compose, /- 3d-psa-backend-server/);
});

test('run-matrix.sh plan substitutes the two ranges by position and refuses other files', { skip: BASH ? false : 'bash is not available' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-trf-'));
    try {
        const live = fs.readFileSync(LIVE_FIXTURE, 'utf8');
        const rendered = renderFromLiveSource(loadOperatorPack().routerTemplate, live, 'api.rocket3d.hu', {
            phase: 'production-two-range'
        });
        assert.equal(rendered.error, null);
        const file = path.join(dir, 'rendered');
        fs.writeFileSync(file, rendered.source);
        const plan = spawnSync(BASH, [bashPath(path.join(PACK, 'run-matrix.sh')), 'plan', '--rendered', bashPath(file)],
            { encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /ranges substituted by position=2 differing_lines=2/);
        assert.match(plan.stdout, new RegExp(`${CASES.cases.length} cases x 3 clients`));
        assert.doesNotMatch(plan.stdout, /31\.97|45\.84/);
        const hostOnly = path.join(dir, 'host-only');
        fs.writeFileSync(hostOnly, live);
        const refused = spawnSync(BASH, [bashPath(path.join(PACK, 'run-matrix.sh')), 'plan', '--rendered', bashPath(hostOnly)],
            { encoding: 'utf8' });
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /not the 3\.9\.0 public-routes rule/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
