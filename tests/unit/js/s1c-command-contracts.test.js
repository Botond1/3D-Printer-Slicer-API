'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PATH = path.join(ROOT, 'app/services/slice/command.js');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});
const actualCommand = require(COMMAND_PATH);
const { createChildEnvironment } = require('../../../app/services/slice/child-environment');
const { APPLICATION_ROOT, resolvePythonHelper } = require('../../../app/services/slice/helper-paths');

function restoreEnvironment(snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

test('minimal environment passes runtime essentials and excludes secret/application variables', () => {
    const source = {
        PATH: 'runtime-path', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
        PATHEXT: '.EXE', TEMP: 'C:\\Temp', TMP: 'C:\\Tmp', LANG: 'C.UTF-8',
        ADMIN_API_KEY: String(41), SLICE_SERVICE_API_KEY: String(42),
        SECRET_MARKER: String(43), DATABASE_URL: String(44),
        CLOUD_API_KEY: String(45), TELEGRAM_BOT_TOKEN: String(46), EMAIL_API_KEY: String(47),
        SLICE_RATE_LIMIT_MAX_REQUESTS: String(48), NODE_OPTIONS: '--inspect', PYTHONPATH: 'unsafe'
    };
    const env = createChildEnvironment(source, 'win32');
    assert.deepEqual(env, {
        PATH: 'runtime-path', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
        PATHEXT: '.EXE', TEMP: 'C:\\Temp', TMP: 'C:\\Tmp', LANG: 'C.UTF-8',
        PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
        PYTHONUNBUFFERED: '1', PYTHONUTF8: '1'
    });
    for (const key of ['ADMIN_API_KEY', 'SLICE_SERVICE_API_KEY', 'SECRET_MARKER',
        'DATABASE_URL', 'CLOUD_API_KEY',
        'TELEGRAM_BOT_TOKEN', 'EMAIL_API_KEY', 'SLICE_RATE_LIMIT_MAX_REQUESTS',
        'NODE_OPTIONS', 'PYTHONPATH']) assert.equal(env[key], undefined, key);
});
test('Windows allowlist lookup is case-insensitive and empty optional values stay omitted', () => {
    const env = createChildEnvironment({
        Path: 'C:\\runtime',
        systemroot: 'C:\\Windows',
        lang: '',
        LC_ALL: ''
    }, 'win32');
    assert.equal(env.PATH, 'C:\\runtime');
    assert.equal(env.SystemRoot, 'C:\\Windows');
    assert.equal(Object.hasOwn(env, 'LANG'), false);
    assert.equal(Object.hasOwn(env, 'LC_ALL'), false);
});
test('POSIX child environment uses fixed writable homes and never inherits parent HOME/XDG paths', () => {
    const env = createChildEnvironment({
        PATH: '/usr/bin',
        TMPDIR: '/tmp',
        HOME: '/secret/home',
        XDG_CACHE_HOME: '/secret/cache',
        XDG_CONFIG_HOME: '/secret/config',
        XDG_RUNTIME_DIR: '/secret/runtime'
    }, 'linux');
    assert.deepEqual({
        TMPDIR: env.TMPDIR,
        TEMP: env.TEMP,
        TMP: env.TMP,
        HOME: env.HOME,
        XDG_CACHE_HOME: env.XDG_CACHE_HOME,
        XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
        XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR
    }, {
        TMPDIR: '/tmp',
        TEMP: '/tmp',
        TMP: '/tmp',
        HOME: '/tmp/slicer-home',
        XDG_CACHE_HOME: '/tmp/xdg-cache',
        XDG_CONFIG_HOME: '/tmp/xdg-config',
        XDG_RUNTIME_DIR: '/tmp/xdg-runtime'
    });
});

test('POSIX child environment rejects arbitrary, normalized, relative, and NUL TMPDIR authorities', () => {
    for (const candidate of ['/app/output', '/etc', '/tmp/../etc', '../../secret', '/tmp\0/escape']) {
        const env = createChildEnvironment({ TMPDIR: candidate, HOME: '/secret/home' }, 'linux');
        assert.equal(env.TMPDIR, '/tmp', candidate);
        assert.equal(env.HOME, '/tmp/slicer-home', candidate);
    }
});

test('real child sees required allowlist values but no inert secret markers', async () => {
    const keys = ['ADMIN_API_KEY', 'SLICE_SERVICE_API_KEY', 'SECRET_MARKER', 'DATABASE_URL'];
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
        keys.forEach((key, index) => { process.env[key] = String(51 + index); });
        const { stdout } = await actualCommand.runCommand(process.execPath, ['-e', [
            "const e=process.env;process.stdout.write(JSON.stringify({",
            "path:Boolean(e.PATH),root:Boolean(e.SystemRoot||e.WINDIR),",
            "python:[e.PYTHONDONTWRITEBYTECODE,e.PYTHONNOUSERSITE,e.PYTHONUNBUFFERED,e.PYTHONUTF8],",
            "leaked:['ADMIN_API_KEY','SLICE_SERVICE_API_KEY','SECRET_MARKER','DATABASE_URL'].filter(k=>k in e)}))"
        ].join('')]);
        const observed = JSON.parse(stdout);
        assert.equal(observed.path, true);
        if (process.platform === 'win32') assert.equal(observed.root, true);
        assert.deepEqual(observed.python, ['1', '1', '1', '1']);
        assert.deepEqual(observed.leaked, []);
    } finally {
        restoreEnvironment(original);
    }
});

test('helper resolution is absolute, allowlisted, cwd-independent, and Docker-layout compatible', () => {
    const originalCwd = process.cwd();
    process.chdir(os.tmpdir());
    try {
        for (const name of ['mesh2stl.py', 'cad2stl.py', 'orient.py', 'scale_model.py', 'render_preview.py']) {
            assert.equal(resolvePythonHelper(name), path.join(APPLICATION_ROOT, name));
            assert.equal(path.isAbsolute(resolvePythonHelper(name)), true);
        }
        assert.throws(() => resolvePythonHelper('../other.py'), /Unknown Python/);
    } finally {
        process.chdir(originalCwd);
    }
    const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert.match(docker, /WORKDIR \/app/);
    assert.match(docker, /COPY --chown=0:0 app\/ \.\//);
    assert.equal(path.posix.resolve('/app/services/slice', '../..'), '/app');
});
