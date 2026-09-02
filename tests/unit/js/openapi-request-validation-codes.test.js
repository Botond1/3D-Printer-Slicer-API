'use strict';

/**
 * Every HTTP 400 `errorCode` literal that the option/transform parsers can
 * emit must be advertised in the slice OpenAPI 400 enum, and every 422 code
 * they emit must sit in the 422 enum. The test walks the source literals so
 * a new code cannot be added to the parsers without reaching the contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REQUEST_VALIDATION_CODES, createSliceResponses } = require('../../../app/docs/slice-openapi');

const SLICE_DIR = path.join(__dirname, '..', '..', '..', 'app', 'services', 'slice');
const CODE_LITERAL = /(?:errorCode:\s*|invalid\([^;]*?,\s*)'([A-Z][A-Z0-9_]+)'/g;

/** Codes the parsers emit with HTTP 422 rather than 400. */
const UNPROCESSABLE_CODES = new Set(['MODEL_OUT_OF_PRINTER_BOUNDS', 'MODEL_DIMENSIONS_UNAVAILABLE']);

function collectCodes(fileName) {
    const source = fs.readFileSync(path.join(SLICE_DIR, fileName), 'utf8');
    const codes = new Set();
    for (const match of source.matchAll(CODE_LITERAL)) codes.add(match[1]);
    return codes;
}

function enumOf(status) {
    return createSliceResponses()[status].content['application/json'].schema.properties.errorCode.enum;
}

test('every 400 errorCode literal in options.js and transform.js is in the OpenAPI 400 enum', () => {
    const codes = new Set([...collectCodes('options.js'), ...collectCodes('transform.js')]);
    assert.ok(codes.size >= 15, `expected the walker to find the parser codes, found ${codes.size}`);
    for (const expected of [
        'INVALID_INFILL', 'INVALID_SUPPORTS', 'INVALID_ORIENTATION_MODE', 'INVALID_SIZE_UNIT',
        'INVALID_KEEP_PROPORTIONS', 'INVALID_SIZE_OPTIONS', 'CONFLICTING_SIZE_OPTIONS',
        'INVALID_ROTATION_OPTIONS', 'INVALID_LAYER_HEIGHT', 'INVALID_PRINTER_PROFILE'
    ]) {
        assert.ok(codes.has(expected), `walker must see ${expected}`);
    }
    const documented400 = new Set(enumOf(400));
    const documented422 = new Set(enumOf(422));
    for (const code of codes) {
        if (UNPROCESSABLE_CODES.has(code)) {
            assert.ok(documented422.has(code), `${code} must be in the 422 enum`);
        } else {
            assert.ok(documented400.has(code), `${code} must be in the 400 enum`);
        }
    }
    for (const code of REQUEST_VALIDATION_CODES) assert.ok(documented400.has(code), code);
    assert.equal(new Set(REQUEST_VALIDATION_CODES).size, REQUEST_VALIDATION_CODES.length, 'no duplicates');
});

test('the transform option codes are explicitly listed', () => {
    for (const code of [
        'INVALID_SIZE_UNIT', 'INVALID_KEEP_PROPORTIONS', 'INVALID_SIZE_OPTIONS',
        'CONFLICTING_SIZE_OPTIONS', 'INVALID_ROTATION_OPTIONS'
    ]) {
        assert.ok(REQUEST_VALIDATION_CODES.includes(code), code);
    }
});
