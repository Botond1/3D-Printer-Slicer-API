'use strict';

const FORBIDDEN_MATERIAL_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafeMaterialName(value) {
    if (typeof value !== 'string') return false;
    const material = value.trim();
    return material.length >= 1
        && material.length <= 128
        && /^[\x20-\x7e]+$/.test(material)
        && !FORBIDDEN_MATERIAL_KEYS.has(material.toLowerCase());
}

module.exports = { isSafeMaterialName };
