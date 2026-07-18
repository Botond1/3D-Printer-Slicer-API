'use strict';

const { spawnSync } = require('node:child_process');

const configuredExecutable = process.env.TEST_PYTHON_EXECUTABLE;
const pythonExecutable = configuredExecutable && configuredExecutable.trim()
    ? configuredExecutable
    : 'python';
const pythonArguments = process.argv.slice(2);

if (pythonArguments.length === 0) {
    console.error('Usage: node scripts/run-python.js <python arguments>');
    process.exit(2);
}

const result = spawnSync(pythonExecutable, pythonArguments, {
    env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1'
    },
    stdio: 'inherit'
});

if (result.error) {
    console.error(`Unable to start the configured Python interpreter: ${result.error.message}`);
    process.exit(1);
}

if (result.status === null) {
    console.error(`Python ended without an exit status${result.signal ? ` (${result.signal})` : ''}.`);
    process.exit(1);
}

process.exit(result.status);
