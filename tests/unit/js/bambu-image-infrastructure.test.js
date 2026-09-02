'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const WRAPPER_PATH = path.join(ROOT, 'scripts/bambu-studio-wrapper.sh');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').replace(/\r\n?/g, '\n');
const WRAPPER = fs.readFileSync(WRAPPER_PATH, 'utf8').replace(/\r\n?/g, '\n');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').replace(/\r\n?/g, '\n');
const PRODUCTION_COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.production.yml'), 'utf8')
    .replace(/\r\n?/g, '\n');
const DEV_COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.dev.yml'), 'utf8').replace(/\r\n?/g, '\n');

const BAMBU_URL = 'https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/'
    + 'BambuStudio_ubuntu24.04-v02.08.02.61-20260820225108.AppImage';
const BAMBU_SHA256 = 'd501b103fac5424513ec0e8d6bc145fb30719de2c7d94d7320d723740c81a7fd';
const RUNTIME_PACKAGES = [
    'xvfb', 'libgl1', 'libgl1-mesa-dri', 'libglx-mesa0',
    'libgstreamer1.0-0', 'libgstreamer-plugins-base1.0-0'
];

function stages(source) {
    const parts = source.split(/^FROM /m).slice(1).map((part) => `FROM ${part}`);
    assert.ok(parts.length >= 4, 'expected the preserved multi-stage image');
    return parts;
}

function slicerBaseStage(source) {
    const stage = stages(source).find((part) => part.startsWith('FROM ubuntu:24.04 AS slicer-base'));
    assert.ok(stage, 'missing slicer-base stage');
    return stage;
}

function runtimeStage(source) {
    return stages(source).at(-1);
}

function exactLines(source, line) {
    return source.split('\n').filter((candidate) => candidate === line).length;
}

function dockerfileBambuContract(source) {
    const base = slicerBaseStage(source);
    assert.equal(exactLines(base, `ARG BAMBU_APPIMAGE_URL="${BAMBU_URL}"`), 1);
    assert.equal(exactLines(base, `ARG BAMBU_APPIMAGE_SHA256="${BAMBU_SHA256}"`), 1);
    assert.ok(base.indexOf('ARG ORCA_APPIMAGE_URL=') < base.indexOf('ARG BAMBU_APPIMAGE_URL='));
    assert.ok(base.indexOf('ARG ORCA_APPIMAGE_SHA256=') < base.indexOf('ARG BAMBU_APPIMAGE_SHA256='));
    for (const step of [
        '&& wget -q "$BAMBU_APPIMAGE_URL" -O BambuStudio.AppImage \\',
        '&& echo "$BAMBU_APPIMAGE_SHA256  BambuStudio.AppImage" | sha256sum -c - \\',
        '&& chmod +x BambuStudio.AppImage \\',
        '&& ./BambuStudio.AppImage --appimage-extract \\',
        '&& mv squashfs-root bambu-squashfs-root \\'
    ]) assert.ok(base.includes(step), `missing Bambu extraction step: ${step}`);
    assert.ok(base.indexOf('&& mv squashfs-root orca-squashfs-root') < base.indexOf('wget -q "$BAMBU_APPIMAGE_URL"'));
    assert.ok(base.indexOf('sha256sum -c -') < base.indexOf('./BambuStudio.AppImage --appimage-extract'));
    assert.match(base, /&& rm -- \/tmp\/PrusaSlicer\.AppImage \/tmp\/OrcaSlicer\.AppImage \/tmp\/BambuStudio\.AppImage/);

    const runtime = runtimeStage(source);
    const install = runtime.slice(runtime.indexOf('apt-get install -y --no-install-recommends \\'),
        runtime.indexOf('&& mkdir -p /etc/apt/keyrings'));
    assert.ok(install.length > 0, 'missing runtime apt install block');
    const installed = install.replace(/\\\n/g, ' ').split(/\s+/);
    for (const name of RUNTIME_PACKAGES) {
        assert.equal(installed.filter((token) => token === name).length, 1, `runtime package ${name}`);
    }
    for (const preserved of ['libglu1-mesa', 'libgtk-3-0', 'libegl1', 'libwebkit2gtk-4.1-0',
        'libgomp1', 'libosmesa6', 'libxft2', 'libxinerama1']) {
        assert.ok(installed.includes(preserved), `preserved runtime package ${preserved}`);
    }
    assert.doesNotMatch(runtime, /xvfb-run|xauth|x11-xserver-utils/);
    assert.equal(exactLines(runtime, 'COPY --from=slicer-base /tmp/bambu-squashfs-root /opt/bambustudio'), 1);
    assert.equal(exactLines(runtime,
        'COPY --chown=0:0 --chmod=0555 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio'), 1);
    assert.doesNotMatch(runtime, /ln -sf? \/opt\/bambustudio/);
    assert.equal(exactLines(runtime, 'RUN ln -sf /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer \\'), 1);
    assert.equal(exactLines(runtime, '    && ln -sf /opt/orcaslicer/AppRun /usr/local/bin/orca-slicer'), 1);
    assert.match(runtime,
        /^RUN chown -R root:root \/app \/opt\/venv \/opt\/prusaslicer \/opt\/orcaslicer \/opt\/bambustudio \\$/m);
    assert.match(runtime,
        /^    && chmod -R a-w \/app \/opt\/venv \/opt\/prusaslicer \/opt\/orcaslicer \/opt\/bambustudio \\$/m);
    assert.ok(runtime.indexOf('COPY --from=slicer-base /tmp/bambu-squashfs-root /opt/bambustudio')
        < runtime.indexOf('RUN chown -R root:root'));
}

function wrapperContract(source) {
    assert.match(source, /^#!\/bin\/sh\n/);
    assert.match(source, /^set -eu$/m);
    assert.match(source, /^apprun=\/opt\/bambustudio\/AppRun$/m);
    assert.match(source, /^xvfb=\/usr\/bin\/Xvfb$/m);
    assert.match(source, /^socket_dir=\/tmp\/\.X11-unix$/m);
    assert.match(source, /--export-3mf\|--export-3mf=\*\) needs_display=1 ;;/);
    assert.match(source, /if \[ "\$needs_display" -eq 0 \]; then\n    exec "\$apprun" "\$@"\nfi/);
    assert.match(source, /^trap cleanup EXIT$/m);
    assert.match(source, /^trap 'forward TERM; exit 143' TERM$/m);
    assert.match(source, /^trap 'forward INT; exit 130' INT$/m);
    assert.match(source, /kill "\$xvfb_pid" 2>\/dev\/null \|\| true/);
    assert.match(source, /display=\$\(\( \$\$ % 900 \+ 100 \)\)/);
    assert.match(source, /\[ "\$attempt" -lt 8 \]/);
    assert.match(source, /\[ ! -e "\$socket_dir\/X\$display" \] && \[ ! -e "\/tmp\/\.X\$display-lock" \]/);
    assert.match(source,
        /"\$xvfb" ":\$display" -screen 0 1280x1024x24 -nolisten tcp >\/dev\/null 2>&1 &\n\s+xvfb_pid=\$!/);
    assert.match(source, /\[ "\$waited" -lt 50 \]/);
    assert.match(source, /sleep 0\.1/);
    assert.match(source, /\[ -S "\$socket_dir\/X\$display" \] && kill -0 "\$xvfb_pid" 2>\/dev\/null/);
    assert.match(source, /if \[ -z "\$xvfb_pid" \]; then\n\s+printf '%s\\n' 'bambu-studio-wrapper: xvfb_unavailable' >&2\n\s+exit 70\nfi/);
    assert.match(source, /^DISPLAY=":\$display"$/m);
    assert.match(source, /^LIBGL_ALWAYS_SOFTWARE=1$/m);
    assert.match(source, /^GALLIUM_DRIVER=llvmpipe$/m);
    assert.match(source, /^export DISPLAY LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER$/m);
    assert.match(source, /^"\$apprun" "\$@" &\nchild_pid=\$!\nstatus=0\nwait "\$child_pid" \|\| status=\$\?\nchild_pid=\ncleanup\nexit "\$status"\n$/m);
    assert.equal((source.match(/"\$apprun" "\$@"/g) || []).length, 2, 'AppRun receives argv verbatim on both paths');
    const active = source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    assert.doesNotMatch(active, /xvfb-run|\beval\b|\bsudo\b|\bsu\b|\bexec\s+(?!"\$apprun")/);
    assert.doesNotMatch(active, /\$\([^(]/, 'no command substitution');
    for (const written of active.matchAll(/>+\s*("?[^ \n";]+"?)/g)) {
        const target = written[1].replace(/"/g, '');
        assert.ok(target === '/dev/null' || target === '&2' || target === '&1',
            `wrapper may only redirect to /dev/null or stderr, not ${target}`);
    }
    assert.doesNotMatch(active, /\/var\/|\/home\/|\/app\/|\/root\/|\/run\//);
}

test('Dockerfile pins, verifies, extracts, and immutably installs Bambu Studio next to Prusa and Orca', () => {
    dockerfileBambuContract(DOCKERFILE);
});

test('Dockerfile Bambu Studio weakening mutations fail the contract', async (t) => {
    const mutations = [
        ['URL drift', `ARG BAMBU_APPIMAGE_URL="${BAMBU_URL}"`,
            `ARG BAMBU_APPIMAGE_URL="${BAMBU_URL.replace('v02.08.02.61/', 'v02.08.02.62/')}"`],
        ['digest drift', `ARG BAMBU_APPIMAGE_SHA256="${BAMBU_SHA256}"`,
            `ARG BAMBU_APPIMAGE_SHA256="${'0'.repeat(64)}"`],
        ['digest verification removed',
            '    && echo "$BAMBU_APPIMAGE_SHA256  BambuStudio.AppImage" | sha256sum -c - \\\n', ''],
        ['AppImage retained in the build stage',
            '&& rm -- /tmp/PrusaSlicer.AppImage /tmp/OrcaSlicer.AppImage /tmp/BambuStudio.AppImage',
            '&& rm -- /tmp/PrusaSlicer.AppImage /tmp/OrcaSlicer.AppImage'],
        ['Xvfb dependency removed', '        xvfb libgl1 libgl1-mesa-dri libglx-mesa0 \\\n', ''],
        ['GStreamer dependency removed', '        libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \\\n', ''],
        ['xvfb-run introduced', '        xvfb libgl1 libgl1-mesa-dri libglx-mesa0 \\\n',
            '        xvfb xvfb-run libgl1 libgl1-mesa-dri libglx-mesa0 \\\n'],
        ['wrapper replaced by a bare symlink',
            'COPY --chown=0:0 --chmod=0555 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio',
            'RUN ln -sf /opt/bambustudio/AppRun /usr/local/bin/bambu-studio'],
        ['wrapper mode widened',
            'COPY --chown=0:0 --chmod=0555 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio',
            'COPY --chown=0:0 --chmod=0775 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio'],
        ['wrapper owned by the service user',
            'COPY --chown=0:0 --chmod=0555 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio',
            'COPY --chown=slicer:slicer --chmod=0555 scripts/bambu-studio-wrapper.sh /usr/local/bin/bambu-studio'],
        ['Bambu Studio tree left writable',
            '    && chmod -R a-w /app /opt/venv /opt/prusaslicer /opt/orcaslicer /opt/bambustudio \\\n',
            '    && chmod -R a-w /app /opt/venv /opt/prusaslicer /opt/orcaslicer \\\n'],
        ['Bambu Studio tree not root-owned',
            'RUN chown -R root:root /app /opt/venv /opt/prusaslicer /opt/orcaslicer /opt/bambustudio \\\n',
            'RUN chown -R root:root /app /opt/venv /opt/prusaslicer /opt/orcaslicer \\\n']
    ];
    for (const [name, from, to] of mutations) {
        await t.test(name, () => {
            assert.ok(DOCKERFILE.includes(from), `missing mutation anchor: ${from}`);
            assert.throws(() => dockerfileBambuContract(DOCKERFILE.replace(from, to)));
        });
    }
});

test('bambu-studio wrapper only adds a private, reaped Xvfb for --export-3mf and forwards argv verbatim', () => {
    wrapperContract(WRAPPER);
    const check = spawnSync('sh', ['-n', WRAPPER_PATH], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000 });
    if (check.error?.code !== 'ENOENT') {
        assert.equal(check.status, 0, `sh -n rejected the wrapper: ${check.stderr}`);
    }
});

test('bambu-studio wrapper weakening mutations fail the contract', async (t) => {
    const mutations = [
        ['set -eu removed', 'set -eu\n', ''],
        ['plain path stops exec-ing AppRun', 'if [ "$needs_display" -eq 0 ]; then\n    exec "$apprun" "$@"\nfi',
            'if [ "$needs_display" -eq 0 ]; then\n    "$apprun" "$@"\nfi'],
        ['Xvfb listens on TCP', '-screen 0 1280x1024x24 -nolisten tcp', '-screen 0 1280x1024x24'],
        ['EXIT trap removed', 'trap cleanup EXIT\n', ''],
        ['TERM no longer forwarded', "trap 'forward TERM; exit 143' TERM\n", ''],
        ['software GL disabled', 'LIBGL_ALWAYS_SOFTWARE=1\n', ''],
        ['DISPLAY not exported', 'export DISPLAY LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER',
            'export LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER'],
        ['exit status swallowed', 'wait "$child_pid" || status=$?', 'wait "$child_pid" || true'],
        ['Xvfb not reaped before exit', 'child_pid=\ncleanup\nexit "$status"', 'child_pid=\nexit "$status"'],
        ['xvfb-run reintroduced', '"$xvfb" ":$display" -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 &',
            'xvfb-run -a "$apprun" "$@" &'],
        ['socket directory moved outside /tmp', 'socket_dir=/tmp/.X11-unix', 'socket_dir=/var/run/x11'],
        ['display collision retry unbounded', '[ "$attempt" -lt 8 ]', 'true'],
        ['socket wait unbounded', '[ "$waited" -lt 50 ]', 'true'],
        ['Xvfb unavailability silently ignored',
            "printf '%s\\n' 'bambu-studio-wrapper: xvfb_unavailable' >&2\n    exit 70\n", ''],
        ['argv re-interpreted through eval', '"$apprun" "$@" &', 'eval "$apprun" "$@" &'],
        ['positional argument inspected directly', '"$apprun" "$@" &', '"$apprun" "$1" "$@" &']
    ];
    for (const [name, from, to] of mutations) {
        await t.test(name, () => {
            assert.ok(WRAPPER.includes(from), `missing mutation anchor: ${from}`);
            assert.throws(() => wrapperContract(WRAPPER.replace(from, to)));
        });
    }
});

test('Compose manifests run the service under init and the dev overlay mounts scale_model.py', () => {
    assert.equal(exactLines(COMPOSE, '    init: true'), 1);
    assert.equal(exactLines(PRODUCTION_COMPOSE, '    init: true'), 1);
    assert.match(COMPOSE, /^    read_only: true\n    init: true\n/m);
    assert.match(PRODUCTION_COMPOSE, /^    read_only: true\n    init: true\n/m);
    for (const helper of ['cad2stl.py', 'mesh2stl.py', 'orient.py', 'scale_model.py']) {
        assert.equal(exactLines(DEV_COMPOSE, `      - ./app/${helper}:/app/${helper}`), 1, helper);
    }
});
