'use strict';

/**
 * Record `skeleton-3.8.3.json` from an exported 3.8.3 tree:
 *
 *   git archive dbc539e app tests/unit/js/helpers | tar -x -C <tree>
 *   (link <tree>/node_modules to this checkout's node_modules)
 *   node tests/contract/live-plugin-29a4a1c7/capture-skeleton.js <tree>
 *
 * It drives the 3.8.3 routes, queue and job store of <tree> with this
 * suite's fixtures and writes the skeleton next to this file.
 */

const fs = require('node:fs');
const path = require('node:path');
const { captureSkeletons } = require('./skeleton');

async function main() {
    const tree = path.resolve(process.argv[2] || '');
    const harnessPath = path.join(tree, 'tests/unit/js/helpers/async-slice-harness.js');
    if (!fs.existsSync(harnessPath)) throw new Error(`no async-slice harness under ${tree}`);
    const cleanups = [];
    try {
        const skeleton = await captureSkeletons(harnessPath, { after: (fn) => cleanups.push(fn) });
        const target = path.join(__dirname, 'skeleton-3.8.3.json');
        fs.writeFileSync(target, `${JSON.stringify({ recorded_from: `3.8.3 unit-test harness (fake pipeline) of an exported dbc539e tree`, skeleton }, null, 2)}\n`);
        console.log(`wrote ${target}`);
    } finally {
        for (const cleanup of cleanups.reverse()) await cleanup();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
