'use strict';

// 3.9.0 §4.10 / §7 "Routes": every Express route mounted by app/server.js is
// listed in ops/hostinger/public-routes.json as public or private, and the
// Traefik rule rendered from that file admits exactly the public ones.
//
// app/server.js starts the service on require, so the test reads its mount
// list statically: top-level `app.<verb>('<path>'` / `app.use('<path>'`
// calls, and `app.use(<x>)` where `const <x> = create<Y>Router(...)` and
// `create<Y>Router` is required from `./routes/<file>`. Each router factory is
// called with inert stubs and its stack is walked.

// Route modules resolve the Python executable on load (slice-route-lifecycle pattern).
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
process.on('exit', () => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderPublicRouteRule } = require('../../../scripts/i12-hostinger-operator-contract');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.join(ROOT, 'app', 'server.js');
const ROUTES = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops', 'hostinger', 'public-routes.json'), 'utf8'));
const HOST = 'api.rocket3d.hu';

function normalizeExpressPath(routePath) {
    return routePath.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param');
}

function key(method, routePath) {
    return `${method.toUpperCase()} ${normalizeExpressPath(routePath)}`;
}

const noop = (req, res, next) => next();
function routerFactoryOptions() {
    const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
    return {
        authenticate: noop,
        authenticateArtifact: noop,
        authenticateOperations: noop,
        rateLimiter: noop,
        isEngineAvailable: () => true,
        resourcePolicy: resolveResourcePolicy({}),
        service: { getSnapshot: () => null, initialize: async () => undefined },
        readinessService: { getStatus: () => ({ ready: true, reasonCodes: [] }) },
        store: {}
    };
}

/**
 * Statically lists the routes app/server.js mounts.
 * @returns {{routes: Set<string>, factories: string[]}} Mounted route keys.
 */
function mountedRoutes() {
    const source = fs.readFileSync(SERVER, 'utf8');
    const mounted = new Set();
    for (const match of source.matchAll(/^app\.(get|post|put|patch|delete|all)\(\s*'([^']+)'/gm)) {
        mounted.add(key(match[1], match[2]));
    }
    for (const match of source.matchAll(/^app\.use\(\s*'([^']+)'/gm)) {
        mounted.add(key('USE', match[1]));
    }
    const requires = new Map();
    for (const match of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\('(\.\/routes\/[^']+)'\)/g)) {
        for (const name of match[1].split(',').map((part) => part.trim().split(':')[0].trim()).filter(Boolean)) {
            requires.set(name, match[2]);
        }
    }
    const instances = new Map();
    for (const match of source.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*(create[A-Za-z0-9_]*Router)\(/g)) {
        instances.set(match[1], match[2]);
    }
    const factories = [];
    for (const match of source.matchAll(/^app\.use\(\s*([A-Za-z0-9_$]+)\s*\)/gm)) {
        const factory = instances.get(match[1]);
        if (!factory) continue; // middleware such as errorHandler, not a router
        const modulePath = requires.get(factory);
        assert.ok(modulePath, `router factory ${factory} has no ./routes require`);
        const created = require(path.join(ROOT, 'app', modulePath))[factory](routerFactoryOptions());
        factories.push(factory);
        for (const layer of created.stack || []) {
            if (!layer.route) continue;
            for (const method of Object.keys(layer.route.methods)) {
                if (method === '_all') continue;
                mounted.add(key(method, layer.route.path));
            }
        }
    }
    return { routes: mounted, factories };
}

// A tiny evaluator of the rendered rule's grammar (Host, Method, Path,
// PathRegexp, &&, ||, parentheses): the matrix runner proves it on Traefik.
function ruleMatches(rule, request) {
    const tokens = rule.match(/\(|\)|&&|\|\||(?:Host|Method|PathRegexp|Path)\(`[^`]*`\)/g);
    assert.equal(tokens.join(''), rule.replace(/\s+/g, ''), 'unexpected rule syntax');
    let index = 0;
    function primary() {
        const token = tokens[index++];
        if (token === '(') {
            const value = or();
            assert.equal(tokens[index++], ')');
            return value;
        }
        const [, name, arg] = token.match(/^(\w+)\(`([^`]*)`\)$/);
        if (name === 'Host') return request.host === arg;
        if (name === 'Method') return request.method === arg;
        if (name === 'Path') return request.path === arg;
        return new RegExp(arg).test(request.path);
    }
    function and() {
        let value = primary();
        while (tokens[index] === '&&') { index += 1; value = primary() && value; }
        return value;
    }
    function or() {
        let value = and();
        while (tokens[index] === '||') { index += 1; value = and() || value; }
        return value;
    }
    const result = or();
    assert.equal(index, tokens.length);
    return result;
}

test('every mounted Express route is listed as public or private', () => {
    const { routes, factories } = mountedRoutes();
    assert.ok(factories.length >= 6, `router factories read from server.js: ${factories.join(', ')}`);
    const listed = new Set(ROUTES.routes.map((route) => key(route.method, route.path)));
    const unlisted = [...routes].filter((entry) => !listed.has(entry));
    assert.deepEqual(unlisted, [], `mounted but not in public-routes.json: ${unlisted.join(', ')}`);
    // Entries from before 3.9.0 must still be mounted (a typo cannot hide a route).
    const stale = ROUTES.routes.filter((route) => !route.since && !routes.has(key(route.method, route.path)));
    assert.deepEqual(stale.map((route) => key(route.method, route.path)), []);
    const duplicates = ROUTES.routes.map((route) => key(route.method, route.path))
        .filter((entry, position, all) => all.indexOf(entry) !== position);
    assert.deepEqual(duplicates, []);
});

test('the rendered rule admits exactly the public routes', () => {
    const rule = renderPublicRouteRule(HOST);
    for (const route of ROUTES.routes) {
        const methods = route.method === 'ALL' || route.method === 'USE'
            ? ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'] : [route.method];
        for (const method of methods) {
            const allowed = ruleMatches(rule, { host: HOST, method, path: route.sample });
            assert.equal(allowed, route.visibility === 'public', `${method} ${route.sample}`);
            assert.equal(ruleMatches(rule, { host: 'other.example.com', method, path: route.sample }), false);
        }
    }
    for (const [method, samplePath] of [
        ['GET', '/bambu/slice/jobs/sj_0123'],
        ['GET', '/bambu/slice/jobs/sj_0123456789abcdef0123456789abcdef/x'],
        ['GET', '/bambu/slice/jobs/ex_0123456789abcdef0123456789abcdef'],
        ['GET', '/bambu/export/jobs/sj_0123456789abcdef0123456789abcdef'],
        ['GET', '/bambu/slice/jobs/sj_0123456789ABCDEF0123456789ABCDEF'],
        ['POST', '/bambu/slice/jobs/sj_0123456789abcdef0123456789abcdef'],
        ['DELETE', '/bambu/export/jobs/ex_0123456789abcdef0123456789abcdef/file'],
        ['GET', '/bambu/slice'],
        ['POST', '/profiles'],
        ['POST', '/pricing'],
        ['GET', '/profiles/'],
        ['GET', '/docs/'],
        ['PUT', '/bambu/slice']
    ]) {
        assert.equal(ruleMatches(rule, { host: HOST, method, path: samplePath }), false, `${method} ${samplePath}`);
    }
});
