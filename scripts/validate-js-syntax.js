'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXCLUDED_PREFIXES = [
    'input/',
    'output/',
    'tests/testing-scripts/results/',
    'coverage/',
    'dist/',
    'build/'
];

const EXCLUDED_SEGMENTS = new Set([
    '.git',
    'node_modules',
    '.venv',
    'venv',
    '__pycache__',
    '.cache',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache'
]);

function fail(message) {
    console.error(message);
    process.exit(1);
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        ...options
    });

    if (result.error) {
        fail(`Unable to run ${command}: ${result.error.message}`);
    }

    return result;
}

function findRepositoryRoot() {
    const result = run('git', ['rev-parse', '--show-toplevel']);
    if (result.status !== 0) {
        fail('JavaScript syntax validation must run inside a Git worktree.');
    }

    return result.stdout.trim();
}

function isExcluded(relativePath) {
    const normalized = relativePath.replaceAll('\\', '/');
    if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
        return true;
    }

    return normalized.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function trackedJavaScriptFiles(repositoryRoot) {
    const result = run('git', ['ls-files', '--cached', '-z', '--', '*.js'], {
        cwd: repositoryRoot,
        encoding: 'buffer'
    });

    if (result.status !== 0) {
        fail('Unable to enumerate tracked JavaScript files from the Git index.');
    }

    return result.stdout
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .filter((filePath) => filePath.endsWith('.js'))
        .filter((filePath) => !isExcluded(filePath))
        .sort((left, right) => left.localeCompare(right));
}

const repositoryRoot = findRepositoryRoot();
const files = trackedJavaScriptFiles(repositoryRoot);
let failed = 0;

for (const filePath of files) {
    const absolutePath = path.resolve(repositoryRoot, ...filePath.split('/'));
    const result = spawnSync(process.execPath, ['--check', absolutePath], {
        cwd: repositoryRoot,
        stdio: 'inherit'
    });

    if (result.error) {
        console.error(`Unable to validate JavaScript file ${filePath}: ${result.error.message}`);
        failed += 1;
        continue;
    }

    if (result.status !== 0) {
        failed += 1;
    }
}

if (failed > 0) {
    fail(`JavaScript syntax validation failed for ${failed} of ${files.length} tracked file(s).`);
}

console.log(`JavaScript syntax OK: ${files.length} tracked file(s).`);
