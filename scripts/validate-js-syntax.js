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

class ValidationError extends Error {}

function run(command, args, options = {}, spawn = spawnSync) {
    const result = spawn(command, args, {
        encoding: 'utf8',
        ...options
    });

    if (result.error) {
        throw new ValidationError(`Unable to run ${command}: ${result.error.message}`);
    }

    return result;
}

function findRepositoryRoot(spawn = spawnSync) {
    const result = run('git', ['rev-parse', '--show-toplevel'], {}, spawn);
    if (result.status !== 0) {
        throw new ValidationError('JavaScript syntax validation must run inside a Git worktree.');
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

function trackedJavaScriptFiles(repositoryRoot, spawn = spawnSync) {
    const result = run(
        'git',
        ['ls-files', '--cached', '-z', '--', '*.js'],
        {
            cwd: repositoryRoot,
            encoding: 'buffer'
        },
        spawn
    );

    if (result.status !== 0) {
        throw new ValidationError('Unable to enumerate tracked JavaScript files from the Git index.');
    }

    return result.stdout
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .filter((filePath) => filePath.endsWith('.js'))
        .filter((filePath) => !isExcluded(filePath))
        .sort((left, right) => left.localeCompare(right));
}

function validateJavaScriptFiles(repositoryRoot, files, {
    spawn = spawnSync,
    stdout = console.log,
    stderr = console.error
} = {}) {
    if (files.length === 0) {
        stderr('JavaScript syntax validation failed: no applicable tracked files were found.');
        return 1;
    }

    let failed = 0;
    for (const filePath of files) {
        const absolutePath = path.resolve(repositoryRoot, ...filePath.split('/'));
        const result = spawn(process.execPath, ['--check', absolutePath], {
            cwd: repositoryRoot,
            stdio: 'inherit'
        });

        if (result.error) {
            stderr(`Unable to validate JavaScript file ${filePath}: ${result.error.message}`);
            failed += 1;
            continue;
        }

        if (result.status !== 0) {
            failed += 1;
        }
    }

    if (failed > 0) {
        stderr(`JavaScript syntax validation failed for ${failed} of ${files.length} tracked file(s).`);
        return 1;
    }

    stdout(`JavaScript syntax OK: ${files.length} tracked file(s).`);
    return 0;
}

function main({
    findRoot = findRepositoryRoot,
    findFiles = trackedJavaScriptFiles,
    spawn = spawnSync,
    stdout = console.log,
    stderr = console.error
} = {}) {
    let repositoryRoot;
    let files;
    try {
        repositoryRoot = findRoot(spawn);
        files = findFiles(repositoryRoot, spawn);
    } catch (error) {
        stderr(error.message);
        return 1;
    }

    return validateJavaScriptFiles(repositoryRoot, files, { spawn, stdout, stderr });
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = {
    ValidationError,
    findRepositoryRoot,
    isExcluded,
    main,
    trackedJavaScriptFiles,
    validateJavaScriptFiles
};
