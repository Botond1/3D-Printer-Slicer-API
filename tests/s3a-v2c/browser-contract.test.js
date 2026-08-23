'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const RUNNER = path.join(__dirname, 'run-browser-contract.js');
const runnerSource = fs.readFileSync(RUNNER, 'utf8');
const harnessSource = fs.readFileSync(path.join(__dirname, 'browser-harness.js'), 'utf8');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').replace(/\r\n?/g, '\n');
const dockerignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').replace(/\r\n?/g, '\n');

function browserBuildErrors(source, ignore) {
    const errors = [];
    const stage = 'FROM mcr.microsoft.com/playwright:v1.55.0-noble@sha256:'
        + 'b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29 AS swiper-browser-check';
    if (!source.includes(stage)) errors.push('browser image must use the exact verified digest');
    for (const name of ['swiper-bundle.min.js', 'swiper-bundle.min.css']) {
        const copy = `COPY --from=slicer-base --chown=pwuser:pwuser `
            + `/tmp/orca-squashfs-root/resources/web/include/swiper/${name} ./${name}`;
        if (!source.includes(copy)) errors.push(`candidate ${name} must come from slicer-base`);
    }
    const browserStage = source.slice(source.indexOf(stage), source.indexOf('FROM ubuntu:24.04\n', source.indexOf(stage)));
    const userIndex = browserStage.indexOf('\nUSER pwuser\n');
    const offlineRunIndex = browserStage.indexOf('\nRUN --network=none ');
    if (!source.includes('COPY --chown=pwuser:pwuser tests/s3a-v2c/browser-harness.html '
        + 'tests/s3a-v2c/browser-harness.js ./') || userIndex < 0 || userIndex > offlineRunIndex) {
        errors.push('browser inputs and execution must use the unprivileged pwuser');
    }
    if (!source.includes("RUN --network=none --mount=type=tmpfs,target=/tmp,size=67108864 <<'SWIPER_BROWSER_CHECK'")) {
        errors.push('browser build must have network none and bounded ephemeral tmpfs');
    }
    if (/require\(['"](?:playwright|playwright-core)['"]\)/.test(browserStage)
        || !browserStage.includes("find /ms-playwright -type f -path '*/chrome-linux*/chrome' -perm -u+x")
        || !browserStage.includes('test "$(wc -l < "$browser_list")" -eq 1')
        || !browserStage.includes('timeout 30s "$browser" \\')
        || !browserStage.includes('--headless=new --no-sandbox')
        || !browserStage.includes('--user-data-dir=/tmp/swiper-browser-profile')
        || !browserStage.includes('--virtual-time-budget=3000 --dump-dom')
        || !browserStage.includes('test "$(wc -c < "$result")" -le 2097152')
        || !browserStage.includes(`grep -Fq 'data-status="PASS"' "$result"`)) {
        errors.push('browser stage must directly execute one bounded bundled Chromium binary');
    }
    if (!source.includes("printf '%s\\n' 'SWIPER_BROWSER_CHECK=PASS' > \"$marker\"")
        || !source.includes(`test "$(cat "$marker")" = 'SWIPER_BROWSER_CHECK=PASS'`)) {
        errors.push('browser stage must create and verify the exact PASS marker');
    }
    const finalStage = source.slice(source.indexOf('FROM ubuntu:24.04\n', source.indexOf('AS swiper-browser-check')));
    const exactMount = 'RUN --mount=from=swiper-browser-check,source=/home/pwuser/swiper-browser-check.pass,'
        + 'target=/tmp/swiper-browser-check.pass,ro \\\n'
        + `    test "$(cat /tmp/swiper-browser-check.pass)" = 'SWIPER_BROWSER_CHECK=PASS'`;
    if (!finalStage.includes(exactMount)) errors.push('final stage must depend on the exact ephemeral PASS mount');
    if (/^COPY\s+--from=swiper-browser-check\b/m.test(finalStage)
        || /^COPY\s+.*(?:browser-harness|swiper-browser-check\.pass)/m.test(finalStage)) {
        errors.push('browser image, harness, and marker must not be copied into the final image');
    }
    const testAllows = ignore.split('\n').filter((line) => line.startsWith('!tests/')).sort();
    const expectedAllows = ['!tests/s3a-v2c/', '!tests/s3a-v2c/browser-harness.html',
        '!tests/s3a-v2c/browser-harness.js'].sort();
    if (!ignore.includes('tests/*') || !ignore.includes('tests/s3a-v2c/*')
        || JSON.stringify(testAllows) !== JSON.stringify(expectedAllows)) {
        errors.push('.dockerignore must expose only the two browser harness assets');
    }
    return errors;
}

test('browser runner pins a verified digest and enforces disposable offline isolation', () => {
    assert.match(runnerSource, /mcr\.microsoft\.com\/playwright:v1\.55\.0-noble@sha256:/);
    assert.match(runnerSource, /b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29/);
    for (const value of ["'--network', 'none'", "'--pull', 'never'", "'--read-only'",
        "'--cap-drop', 'ALL'", "'--security-opt', 'no-new-privileges'", "'--pids-limit', '128'",
        "'--memory', '512m'", "'--cpus', '1'", "'--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m'",
        '--user-data-dir=/tmp/chrome', 'readonly', 'timeout: 60000',
        'maxBuffer: 2 * 1024 * 1024']) {
        assert.ok(runnerSource.includes(value), `missing browser isolation contract: ${value}`);
    }
    assert.doesNotMatch(runnerSource, /--network['"],\s*['"](?:bridge|host)|--privileged|--cap-add/);
});

test('floating browser selectors fail before Docker and leave the Node process pristine', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's3a-v2c-float-'));
    fs.writeFileSync(path.join(directory, 'swiper-bundle.min.js'), 'globalThis.Swiper = function Swiper() {};');
    fs.writeFileSync(path.join(directory, 'swiper-bundle.min.css'), '/* synthetic */');
    const originalIndexOf = Array.prototype.indexOf;
    delete Object.prototype.polluted;
    const result = spawnSync(process.execPath, [RUNNER, '--candidate-tree', directory,
        '--image', 'mcr.microsoft.com/playwright:latest'], { cwd: ROOT, encoding: 'utf8' });
    fs.rmSync(directory, { recursive: true, force: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exact sha256 digest selector/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Docker daemon unavailable/);
    assert.equal(Array.prototype.indexOf, originalIndexOf);
    assert.equal(({}).polluted, undefined);
});

test('browser harness exercises Swiper UI behavior and restores GHSA test mutations', () => {
    for (const marker of ['new Swiper', 'slidesPerGroup: 3', "slidesPerView: 'auto'",
        'pagination:', 'navigation:', 'autoplay:', 'destroy(true, true)',
        'Swiper.extendDefaults', 'Array.prototype.indexOf = () => -1',
        'Array.prototype.indexOf = originalIndexOf', 'delete Object.prototype.polluted',
        "Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')",
        "result.dataset.status = passed ? 'PASS' : 'FAIL'", 'consoleErrors', 'uncaught']) {
        assert.ok(harnessSource.includes(marker), `missing browser/GHSA contract: ${marker}`);
    }
});

test('candidate inputs must be contained regular JS and CSS files', () => {
    assert.match(runnerSource, /Candidate tree must be a real directory/);
    assert.match(runnerSource, /lstatSync\(file\)/);
    assert.match(runnerSource, /isSymbolicLink\(\)/);
    assert.match(runnerSource, /path\.dirname\(fs\.realpathSync\(file\)\) !== fs\.realpathSync\(resolved\)/);
    assert.match(runnerSource, /swiper-bundle\.min\.js/);
    assert.match(runnerSource, /swiper-bundle\.min\.css/);
});

test('Docker build runs the exact remediated candidate in an offline digest-pinned browser stage', () => {
    assert.deepEqual(browserBuildErrors(dockerfile, dockerignore), []);
});

test('Docker browser-stage weakening mutations are rejected in memory', async (t) => {
    const cases = [
        ['floating browser tag', (source) => source.replace(
            /mcr\.microsoft\.com\/playwright:v1\.55\.0-noble@sha256:[0-9a-f]{64}/,
            'mcr.microsoft.com/playwright:latest')],
        ['build networking restored', (source) => source.replace('RUN --network=none ', 'RUN ')],
        ['tmpfs removed', (source) => source.replace('--mount=type=tmpfs,target=/tmp,size=67108864 ', '')],
        ['candidate JS no longer from slicer-base', (source) => source.replace(
            'COPY --from=slicer-base --chown=pwuser:pwuser '
                + '/tmp/orca-squashfs-root/resources/web/include/swiper/swiper-bundle.min.js',
            'COPY tests/s3a-v2c/swiper-bundle.min.js')],
        ['candidate JS ownership is no longer pwuser', (source) => source.replace(
            'COPY --from=slicer-base --chown=pwuser:pwuser '
                + '/tmp/orca-squashfs-root/resources/web/include/swiper/swiper-bundle.min.js',
            'COPY --from=slicer-base '
                + '/tmp/orca-squashfs-root/resources/web/include/swiper/swiper-bundle.min.js')],
        ['offline browser run is no longer pwuser', (source) => source.replace('\nUSER pwuser\n', '\nUSER root\n')],
        ['PASS marker write removed', (source) => source.replace(
            `printf '%s\\n' 'SWIPER_BROWSER_CHECK=PASS' > "$marker"`, ':')],
        ['Playwright Node package substituted for direct Chromium', (source) => source.replace(
            'set -eu', "set -eu\nnode -e \"require('playwright')\"")],
        ['single-browser proof removed', (source) => source.replace(
            'test "$(wc -l < "$browser_list")" -eq 1', ':')],
        ['DOM output bound removed', (source) => source.replace(
            'test "$(wc -c < "$result")" -le 2097152', ':')],
        ['marker copied into final image', (source) => source.replace(
            'RUN --mount=from=swiper-browser-check,source=',
            'COPY --from=swiper-browser-check ')]
    ];
    for (const [name, mutate] of cases) {
        await t.test(name, () => assert.notDeepEqual(browserBuildErrors(mutate(dockerfile), dockerignore), []));
    }
    await t.test('general tests re-included in build context', () => {
        assert.notDeepEqual(browserBuildErrors(dockerfile, `${dockerignore}\n!tests/unit/`), []);
    });
});
