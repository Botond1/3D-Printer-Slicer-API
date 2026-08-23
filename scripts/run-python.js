'use strict';

const { spawnSync } = require('node:child_process');

const PYTHON_PROBE_ARGUMENTS = Object.freeze([
    '-c',
    'import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)'
]);

const WINDOWS_CANDIDATES = Object.freeze([
    Object.freeze({ command: 'python', prefixArguments: [] }),
    Object.freeze({ command: 'py', prefixArguments: ['-3'] }),
    Object.freeze({ command: 'python3', prefixArguments: [] })
]);

const POSIX_CANDIDATES = Object.freeze([
    Object.freeze({ command: 'python3', prefixArguments: [] }),
    Object.freeze({ command: 'python', prefixArguments: [] })
]);

function pythonEnvironment(environment = process.env) {
    return {
        ...environment,
        PYTHONDONTWRITEBYTECODE: '1'
    };
}

function pythonCandidates({
    configuredExecutable = process.env.TEST_PYTHON_EXECUTABLE,
    platform = process.platform
} = {}) {
    const configured = String(configuredExecutable || '').trim();
    if (configured) {
        return [{ command: configured, prefixArguments: [] }];
    }

    return (platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES)
        .map(({ command, prefixArguments }) => ({
            command,
            prefixArguments: [...prefixArguments]
        }));
}

function candidateLabel(candidate) {
    return [candidate.command, ...candidate.prefixArguments].join(' ');
}

function selectPython({
    candidates = pythonCandidates(),
    spawn = spawnSync,
    environment = process.env
} = {}) {
    const attempts = [];

    for (const candidate of candidates) {
        attempts.push(candidateLabel(candidate));
        const result = spawn(
            candidate.command,
            [...candidate.prefixArguments, ...PYTHON_PROBE_ARGUMENTS],
            {
                env: pythonEnvironment(environment),
                stdio: 'ignore',
                windowsHide: true
            }
        );

        if (!result.error && result.status === 0) {
            return candidate;
        }
    }

    throw new Error(
        `Unable to locate a working Python interpreter. Attempted: ${attempts.join(', ')}.`
    );
}

function runPython(arguments_, {
    select = selectPython,
    spawn = spawnSync,
    environment = process.env
} = {}) {
    if (arguments_.length === 0) {
        console.error('Usage: node scripts/run-python.js <python arguments>');
        return 2;
    }

    let selected;
    try {
        selected = select({ spawn, environment });
    } catch (error) {
        console.error(error.message);
        return 1;
    }

    const result = spawn(
        selected.command,
        [...selected.prefixArguments, ...arguments_],
        {
            env: pythonEnvironment(environment),
            stdio: 'inherit',
            windowsHide: true
        }
    );

    if (result.error) {
        console.error(`Unable to start the configured Python interpreter: ${result.error.message}`);
        return 1;
    }

    if (result.status === null) {
        console.error(`Python ended without an exit status${result.signal ? ` (${result.signal})` : ''}.`);
        return 1;
    }

    return result.status;
}

function main() {
    return runPython(process.argv.slice(2));
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = {
    POSIX_CANDIDATES,
    PYTHON_PROBE_ARGUMENTS,
    WINDOWS_CANDIDATES,
    pythonCandidates,
    pythonEnvironment,
    runPython,
    selectPython
};
