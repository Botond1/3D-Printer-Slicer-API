'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').replace(/\r\n?/g, '\n');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').replace(/\r\n?/g, '\n');
const ENTRYPOINT = fs.readFileSync(path.join(ROOT, 'scripts/i4-container-entrypoint.sh'), 'utf8')
    .replace(/\r\n?/g, '\n');
const PRICING_STATE_MARKER = path.join(ROOT, 'configs/pricing-state/.gitkeep');

const REQUIRED_ID = '${SLICER_UID:?Set SLICER_UID to the image slicer user\'s positive numeric UID}';
const REQUIRED_GROUP = '${SLICER_GID:?Set SLICER_GID to the image slicer user\'s positive numeric GID}';
const TMPFS_OPTIONS = `rw,nosuid,nodev,noexec,size=64m,uid=${REQUIRED_ID},gid=${REQUIRED_GROUP},mode=0700`;

function finalStage(source) {
    const stages = source.split(/^FROM /m);
    assert.ok(stages.length >= 5, 'expected the preserved multi-stage image');
    return `FROM ${stages.at(-1)}`;
}

function composeContract(source) {
    assert.match(source, /ports:\n\s+- "127\.0\.0\.1:3000:3000"/);
    assert.match(source, new RegExp(`user: "\\$\\{SLICER_UID:\\?[^"]+\\}:\\$\\{SLICER_GID:\\?[^"]+\\}"`));
    assert.match(source, /EXPECTED_SERVICE_UID: "\$\{SLICER_UID:\?[^"]+\}"/);
    assert.match(source, /EXPECTED_SERVICE_GID: "\$\{SLICER_GID:\?[^"]+\}"/);
    for (const expected of [
        'EXPECTED_PIDS_LIMIT: "${SLICER_PIDS_LIMIT:-512}"',
        'EXPECTED_MEMORY_BYTES: "${SLICER_MEMORY_BYTES:-4294967296}"',
        'EXPECTED_CPU_LIMIT: "${SLICER_CPU_LIMIT:-2.0}"',
        'EXPECTED_LOG_MAX_SIZE: "${SLICER_LOG_MAX_SIZE:-20m}"',
        'EXPECTED_LOG_MAX_FILES: "${SLICER_LOG_MAX_FILES:-5}"',
        'EXPECTED_STOP_GRACE_PERIOD: "${SLICER_STOP_GRACE_PERIOD:-30s}"'
    ]) assert.ok(source.includes(expected), `missing startup-bound resource value: ${expected}`);
    assert.match(source, /^    read_only: true$/m);
    assert.match(source, /^\s+cap_drop:\n\s+- ALL$/m);
    assert.match(source, /^\s+security_opt:\n\s+- no-new-privileges:true$/m);

    const resources = {
        pids_limit: '${SLICER_PIDS_LIMIT:-512}',
        mem_limit: '${SLICER_MEMORY_BYTES:-4294967296}',
        memswap_limit: '${SLICER_MEMORY_BYTES:-4294967296}',
        cpus: '${SLICER_CPU_LIMIT:-2.0}',
        stop_grace_period: '${SLICER_STOP_GRACE_PERIOD:-30s}'
    };
    for (const [key, value] of Object.entries(resources)) {
        assert.match(source, new RegExp(`^\\s+${key}: ${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    }
    assert.match(source, /max-size: "\$\{SLICER_LOG_MAX_SIZE:-20m\}"/);
    assert.match(source, /max-file: "\$\{SLICER_LOG_MAX_FILES:-5\}"/);

    const tmpfsLines = source.split('\n').map((line) => line.trim())
        .filter((line) => line.startsWith('- /tmp:') || line.startsWith('- /app/input/.slice-jobs:'));
    assert.deepEqual(tmpfsLines, [`- /tmp:${TMPFS_OPTIONS}`]);
    assert.doesNotMatch(source, /\/app\/input\/\.slice-jobs:rw,/);

    for (const [sourcePath, target] of [
        ['${SLICER_INPUT_DIR:-./input}', '/app/input'],
        ['${SLICER_OUTPUT_DIR:-./output}', '/app/output'],
        ['${SLICER_CONFIGS_DIR:-./configs}', '/app/configs'],
        ['${SLICER_PRICING_STATE_DIR:-./configs/pricing-state}', '/app/configs/pricing-state']
    ]) {
        assert.ok(source.includes(`source: ${sourcePath}\n        target: ${target}`),
            `missing deterministic bind ${sourcePath} -> ${target}`);
    }
    assert.equal((source.match(/create_host_path: false/g) || []).length, 4);
    assert.match(source,
        /source: \$\{SLICER_CONFIGS_DIR:-\.\/configs\}\n\s+target: \/app\/configs\n\s+read_only: true/);
    assert.doesNotMatch(source,
        /source: \$\{SLICER_PRICING_STATE_DIR[^]*?target: \/app\/configs\/pricing-state\n\s+read_only: true/);
    assert.doesNotMatch(source, /(?:app\/input|app\/output|app\/configs):\/app\//);
}

function dockerfileContract(source) {
    const runtime = finalStage(source);
    assert.match(runtime, /^USER slicer$/m);
    for (const environment of [
        'TMPDIR=/tmp',
        'HOME=/tmp/slicer-home',
        'XDG_CACHE_HOME=/tmp/xdg-cache',
        'XDG_CONFIG_HOME=/tmp/xdg-config',
        'XDG_RUNTIME_DIR=/tmp/xdg-runtime'
    ]) assert.ok(runtime.includes(environment), `missing restrictive runtime environment: ${environment}`);
    for (const copy of [
        'COPY --chown=0:0 app/ ./',
        'COPY --chown=0:0 configs/ ./configs/',
        'COPY --chown=0:0 package.json package-lock.json ./'
    ]) assert.ok(runtime.includes(copy), `missing immutable copy contract: ${copy}`);
    assert.match(runtime, /chown -R root:root \/app \/opt\/venv \/opt\/prusaslicer \/opt\/orcaslicer/);
    assert.match(runtime, /chmod -R a-w \/app \/opt\/venv \/opt\/prusaslicer \/opt\/orcaslicer/);
    assert.match(runtime, /mkdir -p input output configs\/pricing-state/);
    assert.match(runtime, /chown slicer:slicer input output configs\/pricing-state/);
    assert.match(runtime, /chmod 0700 input output configs\/pricing-state/);
    assert.match(runtime,
        /COPY --chown=0:0 --chmod=0555 scripts\/i4-container-entrypoint\.sh \/usr\/local\/bin\/i4-container-entrypoint/);
    assert.match(runtime, /^ENTRYPOINT \["\/usr\/local\/bin\/i4-container-entrypoint"\]$/m);
    assert.doesNotMatch(runtime, /COPY --chown=slicer|chown -R slicer:slicer|chmod\s+(?:-R\s+)?0?777/);
}

function entrypointContract(source) {
    assert.match(source, /^#!\/bin\/sh\nset -eu$/m);
    assert.match(source,
        /case "\$expected_uid" in\n\s+''\|\*\[!0-9\]\*\|0\|0\[0-9\]\*\) exit 78/);
    assert.match(source,
        /case "\$expected_gid" in\n\s+''\|\*\[!0-9\]\*\|0\|0\[0-9\]\*\) exit 78/);
    assert.match(source, /actual_uid="\$\(id -u\)"/);
    assert.match(source, /actual_gid="\$\(id -g\)"/);
    assert.match(source,
        /\[ "\$actual_uid" != "\$expected_uid" \] \|\| \[ "\$actual_gid" != "\$expected_gid" \]/);
    assert.match(source, /\[ "\$pids_limit" -lt 64 \] \|\| \[ "\$pids_limit" -gt 512 \]/);
    assert.match(source,
        /\[ "\$memory_bytes" -lt 1073741824 \] \|\| \[ "\$memory_bytes" -gt 8589934592 \]/);
    assert.match(source, /\[ "\$log_max_files" -lt 1 \] \|\| \[ "\$log_max_files" -gt 5 \]/);
    assert.match(source, /0\.5\|1\.0\|1\.5\|2\.0\|2\.5\|3\.0\|3\.5\|4\.0\)/);
    assert.match(source, /5m\|10m\|20m\|50m\)/);
    assert.match(source, /10s\|20s\|30s\|45s\|60s\)/);
    assert.match(source, /if \[ -L "\$runtime_directory" \] \|\| \{ \[ -e "\$runtime_directory" \] && \[ ! -d "\$runtime_directory" \]; \}; then/);
    assert.match(source, /mkdir -m 0700 -- "\$runtime_directory"/);
    assert.match(source, /stat -c '%u:%g:%a:%F' -- "\$runtime_directory"/);
    assert.match(source, /realpath -e -- "\$runtime_directory"/);
    assert.match(source, /"\$actual_uid:\$actual_gid:700:directory"/);
    assert.match(source, /\[ ! -w "\$runtime_directory" \]/);
    assert.match(source,
        /for runtime_directory in \/app\/input \/app\/output \/app\/configs\/pricing-state \/tmp; do/);
    assert.match(source,
        /for profile_directory in \/app\/configs\/prusa \/app\/configs\/orca; do/);
    assert.match(source, /realpath -e -- "\$profile_directory"/);
    assert.match(source, /stat -c '%A' -- "\$profile_directory"/);
    assert.match(source, /\?\?\?\?\?w\?\?\?\?\|\?\?\?\?\?\?\?\?w\?\) exit 78/);
    assert.match(source, /\[ -w "\$profile_directory" \]/);
    for (const directory of [
        '/tmp/slice-jobs',
        '/tmp/slicer-home',
        '/tmp/xdg-cache',
        '/tmp/xdg-config',
        '/tmp/xdg-runtime'
    ]) assert.ok(source.includes(directory), `missing safely-created runtime directory: ${directory}`);
    assert.match(source, /^exec "\$@"$/m);
    assert.doesNotMatch(source, /echo|printenv|env\b|set -x|sudo|su\b/);
}

test('final image keeps immutable content root-owned and only runtime state service-owned', () => {
    dockerfileContract(DOCKERFILE);
    entrypointContract(ENTRYPOINT);
});

test('production Compose is read-only with an exact writable-surface and resource allowlist', () => {
    composeContract(COMPOSE);
    const marker = fs.lstatSync(PRICING_STATE_MARKER);
    assert.equal(marker.isFile(), true);
    assert.equal(marker.isSymbolicLink(), false);
    assert.equal(fs.readFileSync(PRICING_STATE_MARKER, 'utf8').replace(/\r\n?/g, '\n'), '\n');
});

test('container-envelope weakening mutations fail the focused contract', async (t) => {
    const mutations = [
        ['read-only root removed', COMPOSE, '    read_only: true\n', '', composeContract],
        ['runtime user becomes root', COMPOSE, 'user: "${SLICER_UID:', 'user: "0:', composeContract],
        ['tmpfs loses noexec', COMPOSE, 'nodev,noexec,size=64m', 'nodev,size=64m', composeContract],
        ['tmpfs grows beyond 64m', COMPOSE, 'size=64m', 'size=1g', composeContract],
        ['tmpfs becomes world-writable', COMPOSE, 'mode=0700', 'mode=0777', composeContract],
        ['PID limit becomes unbounded', COMPOSE, '${SLICER_PIDS_LIMIT:-512}', '-1', composeContract],
        ['memory limit removed', COMPOSE, '    mem_limit: ${SLICER_MEMORY_BYTES:-4294967296}\n', '', composeContract],
        ['CPU limit removed', COMPOSE, '    cpus: ${SLICER_CPU_LIMIT:-2.0}\n', '', composeContract],
        ['log retention expands', COMPOSE, '${SLICER_LOG_MAX_FILES:-5}', '${SLICER_LOG_MAX_FILES:-50}', composeContract],
        ['profiles become writable', COMPOSE, '        read_only: true\n', '', composeContract],
        ['bind auto-creation enabled', COMPOSE, 'create_host_path: false', 'create_host_path: true', composeContract],
        ['application ownership weakened', DOCKERFILE, 'COPY --chown=0:0 app/ ./',
            'COPY --chown=slicer:slicer app/ ./', dockerfileContract],
        ['runtime HOME routed to immutable passwd home', DOCKERFILE,
            'HOME=/tmp/slicer-home', 'HOME=/home/slicer', dockerfileContract],
        ['immutable chmod removed', DOCKERFILE,
            '    && chmod -R a-w /app /opt/venv /opt/prusaslicer /opt/orcaslicer \\\n', '', dockerfileContract],
        ['world-writable runtime added', DOCKERFILE, 'chmod 0700', 'chmod 0777', dockerfileContract]
    ];

    for (const [name, source, from, to, validate] of mutations) {
        await t.test(name, () => {
            assert.ok(source.includes(from), `missing mutation anchor: ${from}`);
            assert.throws(() => validate(source.replace(from, to)));
        });
    }
});

test('service-identity startup guard weakening mutations fail closed', async (t) => {
    const mutations = [
        ['non-numeric UID accepted',
            'case "$expected_uid" in\n    \'\'|*[!0-9]*|0|0[0-9]*) exit 78',
            'case "$expected_uid" in\n    \'\'|0|0[0-9]*) exit 78'],
        ['root UID accepted',
            'case "$expected_uid" in\n    \'\'|*[!0-9]*|0|0[0-9]*) exit 78',
            'case "$expected_uid" in\n    \'\'|*[!0-9]*|never|0[0-9]*) exit 78'],
        ['actual identity comparison removed',
            'if [ "$actual_uid" != "$expected_uid" ] || [ "$actual_gid" != "$expected_gid" ]; then',
            'if false; then'],
        ['PID upper bound removed', '[ "$pids_limit" -gt 512 ]', 'false'],
        ['memory upper bound removed', '[ "$memory_bytes" -gt 8589934592 ]', 'false'],
        ['log-file upper bound removed', '[ "$log_max_files" -gt 5 ]', 'false'],
        ['CPU allowlist widened', '0.5|1.0|1.5|2.0|2.5|3.0|3.5|4.0)',
            '0.5|1.0|1.5|2.0|2.5|3.0|3.5|4.0|40.0)'],
        ['log-size allowlist widened', '5m|10m|20m|50m)', '5m|10m|20m|50m|5g)'],
        ['stop-grace allowlist widened', '10s|20s|30s|45s|60s)', '10s|20s|30s|45s|60s|1h)'],
        ['runtime symlink guard removed',
            'if [ -L "$runtime_directory" ] || { [ -e "$runtime_directory" ] && [ ! -d "$runtime_directory" ]; }; then',
            'if [ -e "$runtime_directory" ] && [ ! -d "$runtime_directory" ]; then'],
        ['runtime mode becomes group writable',
            'mkdir -m 0700 -- "$runtime_directory"',
            'mkdir -m 0770 -- "$runtime_directory"'],
        ['bind ownership validation removed',
            'for runtime_directory in /app/input /app/output /app/configs/pricing-state /tmp; do',
            'for runtime_directory in /tmp; do'],
        ['bind writability validation removed',
            '|| [ ! -w "$runtime_directory" ]; then',
            '; then'],
        ['profile roots become writable',
            'if [ "$profile_real_path" != "$profile_directory" ] || [ -w "$profile_directory" ]; then',
            'if [ "$profile_real_path" != "$profile_directory" ]; then'],
        ['job scratch creation removed', '    /tmp/slice-jobs \\\n', ''],
        ['exec semantics removed', 'exec "$@"', '"$@"']
    ];
    for (const [name, from, to] of mutations) {
        await t.test(name, () => {
            assert.ok(ENTRYPOINT.includes(from), `missing mutation anchor: ${from}`);
            assert.throws(() => entrypointContract(ENTRYPOINT.replace(from, to)));
        });
    }
});
