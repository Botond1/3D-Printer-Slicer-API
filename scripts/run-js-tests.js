'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const testRoot = path.join(repositoryRoot, 'tests', 'unit', 'js');

function findTests(directory) {
    const tests = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            tests.push(...findTests(entryPath));
        } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
            tests.push(entryPath);
        }
    }

    return tests;
}

if (!fs.existsSync(testRoot)) {
    console.error(`JavaScript test directory does not exist: ${path.relative(repositoryRoot, testRoot)}`);
    process.exit(1);
}

let testFiles;
try {
    testFiles = findTests(testRoot);
} catch (error) {
    console.error(`Unable to enumerate JavaScript tests: ${error.message}`);
    process.exit(1);
}

if (testFiles.length === 0) {
    console.error('No JavaScript *.test.js files were found under tests/unit/js.');
    process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: repositoryRoot,
    stdio: 'inherit'
});

if (result.error) {
    console.error(`Unable to start the Node.js test runner: ${result.error.message}`);
    process.exit(1);
}

if (result.status === null) {
    console.error(`The Node.js test runner ended without an exit status${result.signal ? ` (${result.signal})` : ''}.`);
    process.exit(1);
}

process.exit(result.status);
