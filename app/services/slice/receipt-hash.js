'use strict';
const { createHash } = require('node:crypto');
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite receipt value.');
    if (value === undefined) throw new Error('Undefined receipt value.');
    return value;
}
function hashValue(value) {
    return createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}
module.exports = { canonical, hashValue };
