'use strict';

/**
 * The code vocabulary of the service: every SCREAMING_SNAKE string literal
 * with an underscore in `app/**.js` (the API docs excluded). Every `errorCode`
 * the slice and job routes can answer is such a literal, so a literal that
 * 3.8.3 did not hold is the only way a new code can reach the live plugin.
 * `emitted-codes-3.8.3.json` is this set at dbc539e
 * (`node codes.js --record` in a dbc539e checkout or with `--rev dbc539e`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const LITERAL = /(['"`])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g;

function literalsOf(text, into = new Set()) {
    for (const match of String(text).matchAll(LITERAL)) into.add(match[2]);
    return into;
}

function isScanned(file) {
    const normalized = file.split(path.sep).join('/');
    return normalized.startsWith('app/') && normalized.endsWith('.js') && !normalized.startsWith('app/docs/');
}

/** Literals of the working tree. */
function workingTreeLiterals(root = ROOT) {
    const found = new Set();
    const walk = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            const relative = path.relative(root, absolute).split(path.sep).join('/');
            if (entry.isDirectory()) {
                if (relative !== 'app/docs') walk(absolute);
            } else if (isScanned(relative)) {
                literalsOf(fs.readFileSync(absolute, 'utf8'), found);
            }
        }
    };
    walk(path.join(root, 'app'));
    return found;
}

/** Literals of a Git revision. */
function revisionLiterals(revision, root = ROOT) {
    const listing = spawnSync('git', ['ls-tree', '-r', '--name-only', revision, 'app'], { cwd: root, encoding: 'utf8' });
    if (listing.status !== 0) throw new Error(`git ls-tree ${revision} failed`);
    const found = new Set();
    for (const file of listing.stdout.split('\n').filter(isScanned)) {
        const blob = spawnSync('git', ['cat-file', 'blob', `${revision}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        literalsOf(blob.stdout, found);
    }
    return found;
}

if (require.main === module) {
    const revisionIndex = process.argv.indexOf('--rev');
    const revision = revisionIndex === -1 ? 'dbc539e' : process.argv[revisionIndex + 1];
    const literals = [...revisionLiterals(revision)].sort();
    if (process.argv.includes('--record')) {
        fs.writeFileSync(path.join(__dirname, 'emitted-codes-3.8.3.json'),
            `${JSON.stringify({ recorded_from: `string literals of app/**.js at ${revision} (app/docs excluded)`, literals }, null, 2)}\n`);
    }
    console.log(`${literals.length} literals at ${revision}`);
}

module.exports = { literalsOf, revisionLiterals, workingTreeLiterals };
