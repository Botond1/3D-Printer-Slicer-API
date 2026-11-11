'use strict';

// A /bambu/slice success answer in the SERVICE'S OWN shape, for the
// deploy-390.sh post-check tests. The shape is not written here: it is
// materialized from tests/contract/live-plugin-29a4a1c7/skeleton-3.8.3.json
// (recorded from the 3.8.3 routes of an exported dbc539e tree: body keys in
// order, value types, enum values). The 2026-11-11 cutover rolled back because
// the dry-run tests compared hand-written answers whose paths the service
// never produced; an answer built from the skeleton cannot carry such a path.

const fs = require('node:fs');
const path = require('node:path');

const SKELETON = path.resolve(__dirname, '../../../contract/live-plugin-29a4a1c7/skeleton-3.8.3.json');

function skeleton() {
    return JSON.parse(fs.readFileSync(SKELETON, 'utf8')).skeleton.sync_success.body;
}

function materialize(node, at, seed) {
    switch (node.type) {
        case 'object':
            return Object.fromEntries(node.keys.map((key) => [key, materialize(node.fields[key], at ? `${at}.${key}` : key, seed)]));
        case 'array':
            return node.items.map((item, index) => materialize(item, `${at}[${index}]`, seed));
        case 'string':
            return Object.hasOwn(node, 'value') ? node.value : `${seed}:${at}`;
        case 'integer':
            return Object.hasOwn(node, 'value') ? node.value : 1000 + at.length;
        case 'number':
            return Object.hasOwn(node, 'value') ? node.value : 10.5 + at.length / 100;
        case 'boolean':
            return Object.hasOwn(node, 'value') ? node.value : true;
        case 'null':
            return null;
        default:
            throw new Error(`unknown skeleton type ${node.type} at ${at}`);
    }
}

function set(object, dotted, value) {
    const keys = dotted.split('.');
    const last = keys.pop();
    const parent = keys.reduce((current, key) => {
        if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
            throw new Error(`no ${dotted} in the real answer shape`);
        }
        return current[key];
    }, object);
    if (!Object.hasOwn(parent, last)) throw new Error(`no ${dotted} in the real answer shape`);
    parent[last] = value;
}

/**
 * One success answer of a control slice.
 * @param {string} model  'cube' | 'block' (seeds the identity strings, so the two models differ).
 * @param {object} [per]  Per-run values: request/job/artifact ids, retention, timing and grams.
 * @param {object} [overrides]  dotted path -> value, applied last (must exist in the shape).
 */
function realAnswer(model, per = {}, overrides = {}) {
    const answer = materialize(skeleton(), '', model);
    const run = { id: 'run1', retention: 86400, seconds: 2460, grams: 52.3, ...per };
    // Values that legitimately change from run to run and from 3.8.3 to 3.9.0
    // (ids, the artifact, the receipt hash, ARTIFACT_TTL_MS -> retention_seconds).
    for (const [dotted, value] of [
        ['job_id', `sj_${run.id}`], ['artifact_id', `artifact-${run.id}`],
        ['technical_receipt.request_id', `req-${run.id}`], ['technical_receipt.job_id', `job-${run.id}`],
        ['technical_receipt.artifact.id', `artifact-${run.id}`], ['technical_receipt.artifact.sha256', `${run.id}-artifact`],
        ['technical_receipt.artifact.gcode_sha256', `${run.id}-gcode`],
        ['technical_receipt.artifact.retention_seconds', run.retention],
        ['technical_receipt.receipt_sha256', `${run.id}-receipt`],
        ['stats.print_time_seconds', run.seconds], ['stats.material_used_g', run.grams],
        ['technical_receipt.estimates.print_time_seconds', run.seconds],
        ['technical_receipt.estimates.material_used_g', run.grams]
    ]) set(answer, dotted, value);
    for (const [dotted, value] of Object.entries(overrides)) set(answer, dotted, value);
    return answer;
}

module.exports = { SKELETON, realAnswer, skeleton };
