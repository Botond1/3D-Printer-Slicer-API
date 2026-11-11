'use strict';

// 3.9.0 §4.10 / §7 T-TRF renderer cases: ordered 1–4 source ranges, the
// public-routes rule line byte for byte, the healthCheck pin, and the live
// file reproduced byte for byte from its own CIDR list and the 3.8.3 rule.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    ALLOWLIST_PLACEHOLDER,
    MAX_ALLOWLIST_ENTRIES,
    RULE_SET_HOST_ONLY,
    expectedRuleLine,
    loadOperatorPack,
    parsePrivateAllowlist,
    renderFromLiveSource,
    renderPublicRouteRule,
    renderRouterSource,
    validateAllowlistCidrs,
    validatePublicRoutesDocument,
    validateRouterSource
} = require('../../../scripts/i12-hostinger-operator-contract');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'scripts', 'i12-hostinger-operator-contract.js');
const HOST = 'api.rocket3d.hu';
// The live ranges in their live order (F §3): LeadPilot, then the shop's egress.
const LIVE_CIDRS = Object.freeze(['31.97.75.126/32', '45.84.204.13/32']);
const LIVE_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'hostinger', 'live-slicer-api-3.8.3.yml');
// sha256 of /opt/rocket3d/slicer-api-9e9621a3…/ops/hostinger/dynamic/slicer-api.yml,
// read on the VPS on 2026-11-11 (867 bytes, modified 2026-10-09 09:02, D139).
const LIVE_SHA256 = '446ac43d2aff8832f084d883dd5900b2d8d1af3c1ecba3ac14eefa029a92d9fc';
const TEMPLATE = loadOperatorPack().routerTemplate;

// The §4.10 rule, unwrapped onto one line.
const SPEC_RULE = 'Host(`api.rocket3d.hu`) && ('
    + '(Method(`POST`) && (Path(`/bambu/slice`) || Path(`/prusa/slice`) || Path(`/bambu/export`)))'
    + ' || ((Method(`GET`) || Method(`DELETE`)) && (PathRegexp(`^/bambu/slice/jobs/sj_[0-9a-f]{32}$`)'
    + ' || PathRegexp(`^/bambu/export/jobs/ex_[0-9a-f]{32}$`)))'
    + ' || (Method(`GET`) && (PathRegexp(`^/bambu/export/jobs/ex_[0-9a-f]{32}/file$`) || Path(`/capabilities`)'
    + ' || Path(`/profiles`) || Path(`/health`) || Path(`/pricing`))))';

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

test('the live fixture is the byte copy of the live router file', () => {
    const live = fs.readFileSync(LIVE_FIXTURE, 'utf8');
    assert.equal(Buffer.byteLength(live, 'utf8'), 867);
    assert.equal(sha256(live), LIVE_SHA256);
});

test('the renderer reproduces the live file byte for byte from its own CIDR list and the 3.8.3 rule', () => {
    const live = fs.readFileSync(LIVE_FIXTURE, 'utf8');
    const rendered = renderRouterSource(TEMPLATE, HOST, LIVE_CIDRS, {
        ruleSet: RULE_SET_HOST_ONLY, phase: 'production-two-range'
    });
    assert.equal(rendered.error, null);
    assert.equal(rendered.source, live);
    assert.equal(sha256(rendered.source), LIVE_SHA256);
    const reproduced = renderFromLiveSource(TEMPLATE, live, HOST, {
        phase: 'production-two-range', ruleSet: RULE_SET_HOST_ONLY
    });
    assert.equal(reproduced.error, null);
    assert.equal(reproduced.source, live);
    assert.equal(reproduced.differing, 0);
});

test('the 3.9.0 render from the live file differs only in the rule line', () => {
    const live = fs.readFileSync(LIVE_FIXTURE, 'utf8');
    const result = renderFromLiveSource(TEMPLATE, live, HOST, { phase: 'production-two-range' });
    assert.equal(result.error, null);
    assert.equal(result.entries, 2);
    const liveLines = live.split('\n');
    const newLines = result.source.split('\n');
    assert.equal(newLines.length, liveLines.length);
    const changed = newLines.map((line, index) => (line === liveLines[index] ? null : index)).filter((v) => v !== null);
    assert.deepEqual(changed.map((index) => liveLines[index]), ['      rule: "Host(`api.rocket3d.hu`)"']);
    assert.equal(newLines[changed[0]], `      rule: "${SPEC_RULE}"`);
    assert.equal(renderPublicRouteRule(HOST), SPEC_RULE);
    assert.equal(expectedRuleLine(HOST, 'public-routes'), `      rule: "${SPEC_RULE}"`);
    // Two ranges render two lines, in input order.
    assert.match(result.source, /sourceRange:\n {10}- "31\.97\.75\.126\/32"\n {10}- "45\.84\.204\.13\/32"\n/);
    assert.match(result.source, /healthCheck:\n {10}path: \/ready\n {10}interval: 10s\n {10}timeout: 8s\n/);
    assert.equal(validateRouterSource(result.source, HOST, false, LIVE_CIDRS), null);
    // The reversed order is a different file (the identity check is ordered).
    assert.equal(validateRouterSource(result.source, HOST, false, [...LIVE_CIDRS].reverse()),
        'traefik_allowlist_identity_mismatch');
});

test('range lists: 0, 5, duplicate and non-canonical are refused; 1–4 render in order', () => {
    const five = ['192.0.2.1/32', '192.0.2.2/32', '192.0.2.3/32', '192.0.2.4/32', '192.0.2.5/32'];
    for (const [label, cidrs] of [
        ['zero', []],
        ['five', five],
        ['duplicate', ['192.0.2.1/32', '192.0.2.1/32']],
        ['leading zero', ['192.0.2.01/32']],
        ['not /32', ['192.0.2.0/24']],
        ['octet > 255', ['192.0.2.256/32']],
        ['ipv6', ['2001:db8::1/128']],
        ['not a list', '192.0.2.1/32']
    ]) {
        assert.equal(validateAllowlistCidrs(cidrs), 'j2_allowlist_cidr_invalid', label);
        assert.equal(renderRouterSource(TEMPLATE, HOST, cidrs).error, 'j2_allowlist_cidr_invalid', label);
    }
    assert.equal(MAX_ALLOWLIST_ENTRIES, 4);
    for (let count = 1; count <= 4; count += 1) {
        const cidrs = five.slice(0, count).reverse();
        const rendered = renderRouterSource(TEMPLATE, HOST, cidrs);
        assert.equal(rendered.error, null, `count ${count}`);
        const lines = rendered.source.split('\n').filter((line) => /^ {10}- "/.test(line));
        assert.deepEqual(lines, cidrs.map((cidr) => `          - "${cidr}"`));
        // Only the header comment (byte-identical to the live file's) names the placeholder.
        const active = rendered.source.split('\n').filter((line) => !line.startsWith('#')).join('\n');
        assert.equal(active.includes(ALLOWLIST_PLACEHOLDER), false);
    }
});

test('a phase pins the entry count', () => {
    assert.equal(validateAllowlistCidrs(['192.0.2.1/32'], 'leadpilot-only'), null);
    assert.equal(validateAllowlistCidrs(LIVE_CIDRS, 'leadpilot-only'), 'j2_allowlist_cidr_invalid');
    assert.equal(validateAllowlistCidrs(LIVE_CIDRS, 'production-two-range'), null);
    assert.equal(validateAllowlistCidrs([...LIVE_CIDRS, '192.0.2.9/32'], 'production-two-range'),
        'j2_allowlist_cidr_invalid');
    assert.equal(validateAllowlistCidrs(LIVE_CIDRS, 'expanded'), 'j2_allowlist_phase_invalid');
    assert.equal(parsePrivateAllowlist(`${LIVE_CIDRS.join('\n')}\n`, 'production-two-range').error, null);
    assert.equal(parsePrivateAllowlist(`${LIVE_CIDRS.join('\n')}\n`, 'leadpilot-only').error,
        'j2_allowlist_cidr_invalid');
});

test('a rule differing by one byte is refused', () => {
    const rendered = renderRouterSource(TEMPLATE, HOST, LIVE_CIDRS).source;
    for (const [label, from, to] of [
        ['sj_ id length', 'sj_[0-9a-f]{32}', 'sj_[0-9a-f]{31}'],
        ['method', 'Method(`POST`)', 'Method(`PUT`)'],
        ['path', 'Path(`/profiles`)', 'Path(`/profileS`)'],
        ['extra space', '&& ((Method', '&&  ((Method'],
        ['host-only rule in an active file', `rule: "${SPEC_RULE}"`, 'rule: "Host(`api.rocket3d.hu`)"']
    ]) {
        assert.equal(rendered.includes(from), true, label);
        const mutated = rendered.replace(from, to);
        assert.equal(validateRouterSource(mutated, HOST, false, LIVE_CIDRS), 'traefik_router_identity_mismatch', label);
    }
    const prefix = rendered.replace(`rule: "${SPEC_RULE}"`, `rule: "${SPEC_RULE} || PathPrefix(\`/\`)"`);
    assert.notEqual(validateRouterSource(prefix, HOST, false, LIVE_CIDRS), null);
    const second = rendered.replace('      service: slicer-api\n', `      service: slicer-api\n      rule: "${SPEC_RULE}"\n`);
    assert.notEqual(validateRouterSource(second, HOST, false, LIVE_CIDRS), null);
});

test('the healthCheck block is pinned to /ready 10 s / 8 s', () => {
    const rendered = renderRouterSource(TEMPLATE, HOST, LIVE_CIDRS).source;
    for (const [from, to] of [
        ['interval: 10s', 'interval: 5s'], ['timeout: 8s', 'timeout: 3s'], ['path: /ready', 'path: /health']
    ]) {
        assert.notEqual(validateRouterSource(rendered.replace(from, to), HOST, false, LIVE_CIDRS), null, from);
    }
    const extra = rendered.replace('          timeout: 8s\n', '          timeout: 8s\n          port: 3000\n');
    assert.notEqual(validateRouterSource(extra, HOST, false, LIVE_CIDRS), null);
});

test('render-from-live refuses a third range, an edited block and a live file that is not 3.8.3', () => {
    const live = fs.readFileSync(LIVE_FIXTURE, 'utf8');
    const third = live.replace('          - "45.84.204.13/32"\n', '          - "45.84.204.13/32"\n          - "192.0.2.7/32"\n');
    assert.equal(renderFromLiveSource(TEMPLATE, third, HOST, { phase: 'production-two-range' }).error,
        'j2_allowlist_cidr_invalid');
    const healthEdited = live.replace('timeout: 8s', 'timeout: 3s');
    assert.match(renderFromLiveSource(TEMPLATE, healthEdited, HOST, { phase: 'production-two-range' }).error, /^live_/);
    const already = renderFromLiveSource(TEMPLATE, live, HOST, { phase: 'production-two-range' }).source;
    assert.match(renderFromLiveSource(TEMPLATE, already, HOST, { phase: 'production-two-range' }).error, /^live_/);
    assert.equal(renderFromLiveSource(TEMPLATE, live, HOST, { phase: 'nope' }).error, 'j2_allowlist_phase_invalid');
    assert.match(renderFromLiveSource(TEMPLATE, live, 'other.example.com', { phase: 'production-two-range' }).error, /^live_/);
});

test('public-routes.json is a valid document and every group is anchored', () => {
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops', 'hostinger', 'public-routes.json'), 'utf8'));
    assert.equal(validatePublicRoutesDocument(document), null);
    const bad = JSON.parse(JSON.stringify(document));
    bad.router[1].matchers[0].PathRegexp = '^/bambu/slice/jobs/.*';
    assert.equal(validatePublicRoutesDocument(bad), 'public_routes_contract_mismatch');
    const prefix = JSON.parse(JSON.stringify(document));
    prefix.router[0].matchers.push({ PathPrefix: '/' });
    assert.equal(validatePublicRoutesDocument(prefix), 'public_routes_contract_mismatch');
    const method = JSON.parse(JSON.stringify(document));
    method.router[0].methods = ['PUT'];
    assert.equal(validatePublicRoutesDocument(method), 'public_routes_contract_mismatch');
});

test('CLI: --reproduce-live and --render-from-live print no address and write a 0600 non-config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-live-render-'));
    try {
        const live = path.join(dir, 'slicer-api.yml');
        fs.copyFileSync(LIVE_FIXTURE, live);
        const reproduce = spawnSync(process.execPath, [SCRIPT, '--reproduce-live', live, '--host', HOST,
            '--phase', 'production-two-range'], { encoding: 'utf8' });
        assert.equal(reproduce.status, 0, reproduce.stderr);
        assert.equal(reproduce.stdout.trim(),
            'router_reproduce_live=PASS phase=production-two-range entries=2 byte_identical=true');
        const output = path.join(dir, '.slicer-api.tmp-20261111T020000Z');
        const render = spawnSync(process.execPath, [SCRIPT, '--render-from-live', live, '--host', HOST,
            '--phase', 'production-two-range', '--output', output], { encoding: 'utf8' });
        assert.equal(render.status, 0, render.stderr);
        assert.equal(render.stdout.trim(),
            'router_render_from_live=PASS phase=production-two-range entries=2 differing_lines=rule');
        for (const text of [reproduce.stdout, reproduce.stderr, render.stdout, render.stderr]) {
            assert.doesNotMatch(text, /31\.97|45\.84|[0-9a-f]{64}/);
        }
        assert.equal(fs.readFileSync(output, 'utf8').includes(SPEC_RULE), true);
        if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
        const again = spawnSync(process.execPath, [SCRIPT, '--render-from-live', live, '--host', HOST,
            '--phase', 'production-two-range', '--output', output], { encoding: 'utf8' });
        assert.equal(again.status, 2);
        assert.equal(again.stderr.trim(), 'live_render_output_create_failed');
        const yml = spawnSync(process.execPath, [SCRIPT, '--render-from-live', live, '--host', HOST,
            '--phase', 'production-two-range', '--output', path.join(dir, 'second.yml')], { encoding: 'utf8' });
        assert.equal(yml.stderr.trim(), 'live_render_output_name_forbidden');
        const third = path.join(dir, 'third.yml');
        fs.writeFileSync(third, fs.readFileSync(live, 'utf8')
            .replace('          - "45.84.204.13/32"\n', '          - "45.84.204.13/32"\n          - "192.0.2.7/32"\n'));
        const refused = spawnSync(process.execPath, [SCRIPT, '--reproduce-live', third, '--host', HOST,
            '--phase', 'production-two-range'], { encoding: 'utf8' });
        assert.equal(refused.status, 2);
        assert.equal(refused.stderr.trim(), 'j2_allowlist_cidr_invalid');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
