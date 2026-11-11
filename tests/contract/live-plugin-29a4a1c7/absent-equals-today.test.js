'use strict';

/**
 * "Absent = today" (§7): the live plugin's exact request (field order of
 * `HttpSlicerClient::buildMultipartBody()`, no new header) gets the response
 * skeleton 3.8.3 gave — status, the headers the plugin reads, body keys in
 * order, value types, enum values — through the real slice and job routes
 * of the working tree. `skeleton-3.8.3.json` was recorded from an exported
 * dbc539e tree with `capture-skeleton.js` (fake pipeline, labelled so).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureSkeletons, pluginParts } = require('./skeleton');
const PINNED = require('./skeleton-3.8.3.json');

test('the plugin\'s multipart fields keep the 29a4a1c7 order and add nothing', () => {
    assert.deepEqual(pluginParts().map((part) => part.name), ['material', 'layerHeight', 'infill', 'supports', 'orientationMode',
        'printerProfile', 'sizeUnit', 'rotationX', 'rotationY', 'rotationZ', 'processProfile', 'expectedProfileSha256',
        'expectedMeasurementGeneration', 'choosenFile']);
});

test('the response skeletons equal the 3.8.3 recording', async (t) => {
    assert.match(PINNED.recorded_from, /dbc539e/);
    const current = await captureSkeletons(path.resolve(__dirname, '../../unit/js/helpers/async-slice-harness.js'), t);
    assert.deepEqual(Object.keys(current), Object.keys(PINNED.skeleton));
    for (const name of Object.keys(PINNED.skeleton)) {
        assert.deepEqual(current[name], PINNED.skeleton[name], name);
    }
});
