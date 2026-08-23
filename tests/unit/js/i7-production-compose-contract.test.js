'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    validateImageReference,
    validateProductionComposeSource
} = require('../../../scripts/i7-production-compose-contract');

const ROOT = path.resolve(__dirname, '../../..');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.production.yml'), 'utf8')
    .replace(/\r\n?/g, '\n');
const DIGEST = '0123456789abcdef'.repeat(4);
const IMAGE_LINE = /^    image:.*$/m;

function replaceRequired(source, pattern, replacement) {
    assert.match(source, pattern, `missing mutation seam: ${pattern}`);
    const mutated = source.replace(pattern, replacement);
    assert.notEqual(mutated, source, `mutation did not change source: ${pattern}`);
    return mutated;
}

function addServiceDirective(source, directive) {
    return replaceRequired(source, /^  slicer-api:\n/m, `  slicer-api:\n${directive}`);
}

function addEnvironmentEntry(source, entry) {
    return replaceRequired(source, /^    environment:\n/m, `    environment:\n${entry}`);
}

function addRepositoryService(source, name) {
    return replaceRequired(
        source,
        /^networks:\n/m,
        `  ${name}:\n    image: nginx@sha256:${DIGEST}\nnetworks:\n`
    );
}

function addNetwork(source, name, options = '    internal: true\n') {
    return replaceRequired(source, /^networks:\n/m, `networks:\n  ${name}:\n${options}`);
}

function addVolume(source, entry) {
    return replaceRequired(source, /^    volumes:\n/m, `    volumes:\n${entry}`);
}

function assertRejected(source, label) {
    const result = validateProductionComposeSource(source);
    assert.equal(typeof result, 'string', `${label} must return an error code`);
    assert.match(result, /^[a-z][a-z0-9_]*$/, `${label} must use a stable lowercase error code`);
}

test('immutable image references require a repository and exact lowercase sha256 digest', () => {
    assert.equal(validateImageReference(`ghcr.io/example/slicer-api@sha256:${DIGEST}`), null);
    for (const [label, value] of [
        ['missing', ''],
        ['tag', 'ghcr.io/example/slicer-api:v3.1.4'],
        ['latest', 'ghcr.io/example/slicer-api:latest'],
        ['short digest', 'ghcr.io/example/slicer-api@sha256:0123'],
        ['malformed digest', `ghcr.io/example/slicer-api@sha256:${'g'.repeat(64)}`],
        ['uppercase digest', `ghcr.io/example/slicer-api@sha256:${DIGEST.toUpperCase()}`]
    ]) {
        const result = validateImageReference(value);
        assert.equal(typeof result, 'string', label);
        assert.match(result, /^[a-z][a-z0-9_]*$/, label);
    }
});

test('production Compose satisfies the immutable single-service contract', () => {
    assert.equal(validateProductionComposeSource(COMPOSE), null);
    assert.match(
        COMPOSE,
        /^    image: "\$\{SLICER_API_IMAGE:\?Set SLICER_API_IMAGE to registry\/repository@sha256:<64 lowercase hex>\}"$/m
    );
});

test('production Compose rejects mutable image and build inputs', async (t) => {
    const imageCases = [
        ['missing image', ''],
        ['tag image', '    image: "ghcr.io/example/slicer-api:v3.1.4"'],
        ['latest image', '    image: "ghcr.io/example/slicer-api:latest"'],
        ['short digest', '    image: "ghcr.io/example/slicer-api@sha256:0123"'],
        ['malformed digest', `    image: "ghcr.io/example/slicer-api@sha256:${'g'.repeat(64)}"`],
        ['uppercase digest', `    image: "ghcr.io/example/slicer-api@sha256:${DIGEST.toUpperCase()}"`]
    ];
    for (const [name, replacement] of imageCases) {
        await t.test(name, () => assertRejected(
            replaceRequired(COMPOSE, IMAGE_LINE, replacement),
            name
        ));
    }
    await t.test('build directive', () => assertRejected(
        addServiceDirective(COMPOSE, '    build: .\n'),
        'build directive'
    ));
});

test('production Compose rejects public, extra, default, and external networking', async (t) => {
    const cases = [
        ['published API port', addServiceDirective(COMPOSE, '    ports:\n      - "3000:3000"\n')],
        ['host network', addServiceDirective(COMPOSE, '    network_mode: host\n')],
        ['internal false', replaceRequired(COMPOSE, /^    internal: true$/m, '    internal: false')],
        ['external network', replaceRequired(COMPOSE, /^    internal: true$/m, '    internal: true\n    external: true')],
        ['default network', addNetwork(COMPOSE, 'default')],
        ['extra network', addNetwork(COMPOSE, 'i7-extra')],
        ['repository proxy service', addRepositoryService(COMPOSE, 'reverse-proxy')],
        ['repository peer service', addRepositoryService(COMPOSE, 'private-peer')]
    ];
    for (const [name, source] of cases) {
        await t.test(name, () => assertRejected(source, name));
    }
});

test('production Compose rejects privilege and resource-envelope weakening', async (t) => {
    const cases = [
        ['root user', replaceRequired(COMPOSE, /^    user:.*$/m, '    user: "0:0"')],
        ['privileged', addServiceDirective(COMPOSE, '    privileged: true\n')],
        ['host PID namespace', addServiceDirective(COMPOSE, '    pid: host\n')],
        ['host IPC namespace', addServiceDirective(COMPOSE, '    ipc: host\n')],
        ['capability drop weakened', replaceRequired(COMPOSE, /^      - ALL$/m, '      - NET_RAW')],
        ['new privileges enabled', replaceRequired(
            COMPOSE,
            /^      - no-new-privileges:true$/m,
            '      - no-new-privileges:false'
        )],
        ['writable root', replaceRequired(COMPOSE, /^    read_only: true$/m, '    read_only: false')],
        ['PID limit removed', replaceRequired(COMPOSE, /^    pids_limit:.*\n/m, '')],
        ['PID limit unbounded', replaceRequired(COMPOSE, /^    pids_limit:.*$/m, '    pids_limit: -1')],
        ['memory limit removed', replaceRequired(COMPOSE, /^    mem_limit:.*\n/m, '')],
        ['swap limit raised', replaceRequired(
            COMPOSE,
            /^    memswap_limit:.*$/m,
            '    memswap_limit: 8589934592'
        )],
        ['CPU limit removed', replaceRequired(COMPOSE, /^    cpus:.*\n/m, '')],
        ['log retention raised', replaceRequired(
            COMPOSE,
            /max-file: "\$\{SLICER_LOG_MAX_FILES:-5\}"/,
            'max-file: "50"'
        )],
        ['stop grace weakened', replaceRequired(
            COMPOSE,
            /^    stop_grace_period:.*$/m,
            '    stop_grace_period: 1s'
        )],
        ['tmpfs noexec removed', replaceRequired(COMPOSE, /,noexec/, '')],
        ['world-writable tmpfs', replaceRequired(COMPOSE, /mode=0700/, 'mode=0777')]
    ];
    for (const [name, source] of cases) {
        await t.test(name, () => assertRejected(source, name));
    }
});

test('production Compose rejects duplicate keys, duplicate sections, and textual decoys', async (t) => {
    const weakenedPids = replaceRequired(
        COMPOSE,
        /^    pids_limit:.*$/m,
        '    pids_limit: -1'
    );
    const cases = [
        ['duplicate service key', addServiceDirective(COMPOSE, '    pids_limit: -1\n')],
        ['duplicate services section', `${COMPOSE}\nservices:\n  attacker:\n    image: nginx:latest\n`],
        ['comment decoy', `${weakenedPids}\n#    pids_limit: \${SLICER_PIDS_LIMIT:-512}\n`],
        ['block scalar decoy', `${weakenedPids}\nx-decoy: |\n    pids_limit: \${SLICER_PIDS_LIMIT:-512}\n`],
        ['duplicate environment key', addEnvironmentEntry(
            COMPOSE,
            '      EXPECTED_PIDS_LIMIT: "-1"\n'
        )]
    ];
    for (const [name, source] of cases) {
        await t.test(name, () => assertRejected(source, name));
    }
});

test('production Compose rejects writable-surface drift and embedded secrets', async (t) => {
    const cases = [
        ['input source drift', replaceRequired(
            COMPOSE,
            /\$\{SLICER_INPUT_DIR:-\.\/input\}/,
            '${SLICER_INPUT_DIR:-./app/input}'
        )],
        ['output target drift', replaceRequired(COMPOSE, /target: \/app\/output/, 'target: /tmp/output')],
        ['extra mount', addVolume(COMPOSE, '      - ./extra:/extra\n')],
        ['real embedded secret', addEnvironmentEntry(
            COMPOSE,
            '      SLICE_SERVICE_API_KEY: "i7-real-looking-secret-value-0123456789"\n'
        )],
        ['placeholder embedded secret', addEnvironmentEntry(
            COMPOSE,
            '      OPERATIONS_API_KEY: "replace-me"\n'
        )]
    ];
    for (const [name, source] of cases) {
        await t.test(name, () => assertRejected(source, name));
    }
});
