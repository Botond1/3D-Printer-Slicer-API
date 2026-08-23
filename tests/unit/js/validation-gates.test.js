const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const pythonLauncher = require(path.join(REPOSITORY_ROOT, 'scripts/run-python'));
const javascriptSyntax = require(path.join(REPOSITORY_ROOT, 'scripts/validate-js-syntax'));

test('Python launcher preserves the explicit interpreter override', () => {
    assert.deepEqual(
        pythonLauncher.pythonCandidates({
            configuredExecutable: 'C:\\inert-tools\\python.exe',
            platform: 'win32'
        }),
        [{ command: 'C:\\inert-tools\\python.exe', prefixArguments: [] }]
    );
});

test('Python launcher selects python3 deterministically on a python3-only Linux host', () => {
    const calls = [];
    const selected = pythonLauncher.selectPython({
        candidates: pythonLauncher.pythonCandidates({
            configuredExecutable: '',
            platform: 'linux'
        }),
        spawn(command, args, options) {
            calls.push({ command, args, options });
            if (command === 'python3') {
                return { status: 0 };
            }
            return { status: null, error: new Error('not found') };
        },
        environment: {}
    });

    assert.deepEqual(selected, { command: 'python3', prefixArguments: [] });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [...pythonLauncher.PYTHON_PROBE_ARGUMENTS]);
    assert.equal(calls[0].options.env.PYTHONDONTWRITEBYTECODE, '1');
});

test('Python launcher supports the py -3 Windows fallback without a shell', () => {
    const calls = [];
    const selected = pythonLauncher.selectPython({
        candidates: pythonLauncher.pythonCandidates({
            configuredExecutable: '',
            platform: 'win32'
        }),
        spawn(command, args, options) {
            calls.push({ command, args, options });
            if (command === 'py') {
                return { status: 0 };
            }
            return { status: null, error: new Error('not found') };
        },
        environment: {}
    });

    assert.deepEqual(selected, { command: 'py', prefixArguments: ['-3'] });
    assert.deepEqual(calls.map(({ command }) => command), ['python', 'py']);
    assert.deepEqual(calls[1].args, ['-3', ...pythonLauncher.PYTHON_PROBE_ARGUMENTS]);
    assert.equal(calls[1].options.shell, undefined);
});

test('Python launcher reports a deterministic error when no candidate works', () => {
    assert.throws(
        () => pythonLauncher.selectPython({
            candidates: [
                { command: 'python3', prefixArguments: [] },
                { command: 'python', prefixArguments: [] }
            ],
            spawn: () => ({ status: null, error: new Error('not found') }),
            environment: {}
        }),
        /Attempted: python3, python\./
    );
});

test('Python launcher forwards argument arrays and disables bytecode writes', () => {
    const calls = [];
    const status = pythonLauncher.runPython(['script.py', '--flag', 'inert value'], {
        select: () => ({ command: 'python3', prefixArguments: [] }),
        spawn(command, args, options) {
            calls.push({ command, args, options });
            return { status: 7 };
        },
        environment: { S0_INERT_ENV: 'present' }
    });

    assert.equal(status, 7);
    assert.deepEqual(calls[0].args, ['script.py', '--flag', 'inert value']);
    assert.equal(calls[0].options.env.S0_INERT_ENV, 'present');
    assert.equal(calls[0].options.env.PYTHONDONTWRITEBYTECODE, '1');
    assert.equal(calls[0].options.shell, undefined);
});

test('empty JavaScript syntax scope is an expected fail-closed mutation', () => {
    const errors = [];
    const status = javascriptSyntax.validateJavaScriptFiles(
        REPOSITORY_ROOT,
        [],
        {
            spawn: assert.fail,
            stdout: assert.fail,
            stderr: (message) => errors.push(message)
        }
    );

    assert.equal(status, 1);
    assert.deepEqual(errors, [
        'JavaScript syntax validation failed: no applicable tracked files were found.'
    ]);
});

test('explicit nonempty JavaScript syntax scope is checked', () => {
    const calls = [];
    const output = [];
    const status = javascriptSyntax.validateJavaScriptFiles(
        REPOSITORY_ROOT,
        ['synthetic.js'],
        {
            spawn(command, args, options) {
                calls.push({ command, args, options });
                return { status: 0 };
            },
            stdout: (message) => output.push(message),
            stderr: assert.fail
        }
    );

    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.equal(calls[0].args[0], '--check');
    assert.equal(calls[0].options.shell, undefined);
    assert.deepEqual(output, ['JavaScript syntax OK: 1 tracked file(s).']);
});
