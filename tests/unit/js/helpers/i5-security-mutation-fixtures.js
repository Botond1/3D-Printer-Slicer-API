'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadCommonJsFromSource } = require('./load-commonjs-from-source');

const ROOT = path.resolve(__dirname, '../../../..');
const FILES = Object.freeze({
    auth: path.join(ROOT, 'app/config/service-auth.js'),
    audience: path.join(ROOT, 'app/middleware/requireAudience.js'),
    cors: path.join(ROOT, 'app/middleware/corsPolicy.js'),
    trust: path.join(ROOT, 'app/config/trust-proxy.js'),
    requestId: path.join(ROOT, 'app/middleware/requestId.js'),
    events: path.join(ROOT, 'app/services/observability/events.js')
});
const source = (name) => fs.readFileSync(FILES[name], 'utf8');
const keyMaterial = (name) => `i5-${name}-${'x'.repeat(48)}`;

function mutateAndLoad(name, from, to) {
    const original = source(name);
    assert.ok(original.includes(from), `missing I5 mutation anchor in ${name}: ${from}`);
    return loadCommonJsFromSource(FILES[name], original.replace(from, to));
}

module.exports = { keyMaterial, mutateAndLoad };
