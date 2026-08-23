'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_IMAGE = 'mcr.microsoft.com/playwright:v1.55.0-noble@sha256:'
    + 'b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29';
const EXACT_IMAGE = /^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/;
const REQUIRED = ['swiper-bundle.min.js', 'swiper-bundle.min.css'];

function fail(message, status = 1) {
    process.stderr.write(`${message}\n`);
    process.exit(status);
}

function parseArguments(argv) {
    const values = { image: DEFAULT_IMAGE };
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!value || !['--candidate-tree', '--image'].includes(key)) fail(`Unknown or incomplete option: ${key}`);
        values[key.slice(2).replace('-', '')] = value;
    }
    if (!values.candidatetree) fail('--candidate-tree is required');
    if (!EXACT_IMAGE.test(values.image)) fail('Browser image must be an exact sha256 digest selector');
    return values;
}

function readCandidate(root) {
    const resolved = path.resolve(root);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Candidate tree must be a real directory');
    const files = {};
    for (const name of REQUIRED) {
        const file = path.join(resolved, name);
        const fileStat = fs.lstatSync(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || path.dirname(fs.realpathSync(file)) !== fs.realpathSync(resolved)) {
            fail(`Candidate file is not a contained regular file: ${name}`);
        }
        files[name] = file;
    }
    return files;
}

function prepareHarness(candidate) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's3a-v2c-browser-'));
    const sourceRoot = __dirname;
    for (const name of REQUIRED) fs.copyFileSync(candidate[name], path.join(directory, name));
    for (const name of ['browser-harness.html', 'browser-harness.js']) {
        fs.copyFileSync(path.join(sourceRoot, name), path.join(directory, name));
    }
    fs.writeFileSync(path.join(directory, 'run-browser.sh'), [
        '#!/bin/bash',
        'set -euo pipefail',
        "mapfile -t browsers < <(find /ms-playwright -type f -path '*/chrome-linux*/chrome' -perm -u+x)",
        '[[ "${#browsers[@]}" -eq 1 ]] || { echo "Expected exactly one bundled Chromium" >&2; exit 40; }',
        'exec "${browsers[0]}" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \\',
        '  --disable-background-networking --disable-component-update --disable-default-apps \\',
        '  --disable-sync --metrics-recording-only --no-first-run --mute-audio \\',
        '  --user-data-dir=/tmp/chrome \\',
        '  --virtual-time-budget=3000 --dump-dom file:///work/browser-harness.html',
        ''
    ].join('\n'), { mode: 0o700 });
    return directory;
}

function dockerAvailable() {
    return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
        encoding: 'utf8', timeout: 10000, windowsHide: true
    });
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    let candidate;
    try {
        candidate = readCandidate(options.candidatetree);
    } catch (error) {
        fail(`Candidate verification failed: ${error.message}`);
    }
    const daemon = dockerAvailable();
    if (daemon.error || daemon.status !== 0) {
        const detail = daemon.error ? daemon.error.message : (daemon.stderr || daemon.stdout).trim();
        fail(`NOT_RUN_ENVIRONMENT: Docker daemon unavailable: ${detail}`, 3);
    }

    const directory = prepareHarness(candidate);
    try {
        const mount = `type=bind,source=${directory},target=/work,readonly`;
        const args = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128',
            '--memory', '512m', '--cpus', '1', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
            '--mount', mount, options.image,
            '/bin/bash', '/work/run-browser.sh'];
        const result = spawnSync('docker', args, {
            encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
        });
        if (result.error) fail(`Browser container failed: ${result.error.message}`);
        if (result.status !== 0) fail(`Browser container failed (${result.status}): ${(result.stderr || '').trim()}`);
        const marker = result.stdout.match(/<pre id="s3a-v2c-result" data-status="(PASS|FAIL)">([^<]*)<\/pre>/);
        if (!marker || marker[1] !== 'PASS') fail(`Browser contract failed: ${marker ? marker[2] : 'result marker absent'}`);
        process.stdout.write(`S3a-V2C browser contract PASS: ${marker[2]}\n`);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

if (require.main === module) main();

module.exports = { DEFAULT_IMAGE, EXACT_IMAGE, parseArguments };
