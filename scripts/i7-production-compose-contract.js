'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_NAME = 'docker-compose.production.yml';
const MAX_MANIFEST_BYTES = 128 * 1024;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/[a-z0-9]+(?:(?:[._-]|\/)[a-z0-9]+)*@sha256:[0-9a-f]{64}$/;
const IMAGE_INTERPOLATION =
    'image: "${SLICER_API_IMAGE:?Set SLICER_API_IMAGE to registry/repository@sha256:<64 lowercase hex>}"';
const SERVICE_KEYS = Object.freeze([
    'image', 'container_name', 'env_file', 'environment', 'user', 'healthcheck',
    'security_opt', 'cap_drop', 'read_only', 'init', 'pids_limit', 'mem_limit',
    'memswap_limit', 'cpus', 'tmpfs', 'logging', 'volumes', 'networks',
    'restart', 'stop_grace_period'
]);
const ENVIRONMENT_KEYS = Object.freeze([
    'EXPECTED_SERVICE_UID', 'EXPECTED_SERVICE_GID', 'EXPECTED_PIDS_LIMIT',
    'EXPECTED_MEMORY_BYTES', 'EXPECTED_CPU_LIMIT', 'EXPECTED_LOG_MAX_SIZE',
    'EXPECTED_LOG_MAX_FILES', 'EXPECTED_STOP_GRACE_PERIOD'
]);

function directMappingKeys(source, parentKey) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const parentIndex = lines.findIndex((line) => line === `${parentKey}:`);
    if (parentIndex === -1) return [];
    const keys = [];
    for (let index = parentIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line && !line.startsWith(' ')) break;
        const match = line.match(/^  ([A-Za-z0-9_.-]+):(?:\s|$)/);
        if (match) keys.push(match[1]);
    }
    return keys;
}

function occurrences(source, fragment) {
    return source.split(fragment).length - 1;
}

function indentedBlock(source, anchor, indent) {
    const lines = source.split('\n');
    const start = lines.findIndex((line) => line === anchor);
    if (start === -1) return '';
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() && line.match(/^ */)[0].length <= indent) {
            end = index;
            break;
        }
    }
    return lines.slice(start, end).join('\n');
}

function directBlockKeys(source, indent) {
    const prefix = ' '.repeat(indent);
    const pattern = new RegExp(`^${prefix}([A-Za-z0-9_.-]+):(?:\\s|$)`);
    return source.split('\n')
        .map((line) => line.match(pattern))
        .filter(Boolean)
        .map((match) => match[1]);
}

function exactLineCount(source, line) {
    return source.split('\n').filter((candidate) => candidate === line).length;
}

function hasExactLines(source, lines) {
    return lines.every((line) => exactLineCount(source, line) === 1);
}

function validateImageReference(value) {
    if (typeof value !== 'string' || !IMAGE_REFERENCE.test(value)) {
        return 'immutable_image_reference_required';
    }
    const repository = value.slice(0, value.indexOf('@sha256:'));
    if (!repository.includes('/') || repository.includes(':latest')
        || repository.endsWith(':') || repository.includes('//')) {
        return 'immutable_image_reference_required';
    }
    return null;
}

function validateProductionComposeSource(source) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_MANIFEST_BYTES
        || source.includes('\t') || source.includes('\r')) return 'compose_source_malformed';
    const activeSource = source.split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
    if (/^\s*[A-Za-z0-9_.-]+:\s*[|>][-+]?\s*$/m.test(activeSource)
        || /^\s*<<:/m.test(activeSource)
        || exactLineCount(activeSource, 'services:') !== 1
        || exactLineCount(activeSource, 'networks:') !== 1) {
        return 'compose_source_malformed';
    }
    if (JSON.stringify(directMappingKeys(activeSource, 'services')) !== JSON.stringify(['slicer-api'])) {
        return 'compose_service_allowlist_mismatch';
    }
    if (JSON.stringify(directMappingKeys(activeSource, 'networks')) !== JSON.stringify(['slicer-api-private'])) {
        return 'compose_network_allowlist_mismatch';
    }
    const service = indentedBlock(activeSource, '  slicer-api:', 2);
    if (JSON.stringify(directBlockKeys(service, 4)) !== JSON.stringify(SERVICE_KEYS)) {
        return 'compose_service_schema_mismatch';
    }
    if (!hasExactLines(service, [
        `    ${IMAGE_INTERPOLATION}`,
        '    user: "${SLICER_UID:?Set SLICER_UID to the image slicer user\'s positive numeric UID}:${SLICER_GID:?Set SLICER_GID to the image slicer user\'s positive numeric GID}"',
        '    read_only: true',
        '    init: true',
        '    pids_limit: ${SLICER_PIDS_LIMIT:-512}',
        '    mem_limit: ${SLICER_MEMORY_BYTES:-4294967296}',
        '    memswap_limit: ${SLICER_MEMORY_BYTES:-4294967296}',
        '    cpus: ${SLICER_CPU_LIMIT:-2.0}',
        '    restart: unless-stopped',
        '    stop_grace_period: ${SLICER_STOP_GRACE_PERIOD:-30s}'
    ])) return 'compose_security_envelope_mismatch';
    const environment = indentedBlock(service, '    environment:', 4);
    if (JSON.stringify(directBlockKeys(environment, 6)) !== JSON.stringify(ENVIRONMENT_KEYS)
        || !hasExactLines(environment, [
            '      EXPECTED_SERVICE_UID: "${SLICER_UID:?Set SLICER_UID to the image slicer user\'s positive numeric UID}"',
            '      EXPECTED_SERVICE_GID: "${SLICER_GID:?Set SLICER_GID to the image slicer user\'s positive numeric GID}"',
            '      EXPECTED_PIDS_LIMIT: "${SLICER_PIDS_LIMIT:-512}"',
            '      EXPECTED_MEMORY_BYTES: "${SLICER_MEMORY_BYTES:-4294967296}"',
            '      EXPECTED_CPU_LIMIT: "${SLICER_CPU_LIMIT:-2.0}"',
            '      EXPECTED_LOG_MAX_SIZE: "${SLICER_LOG_MAX_SIZE:-20m}"',
            '      EXPECTED_LOG_MAX_FILES: "${SLICER_LOG_MAX_FILES:-5}"',
            '      EXPECTED_STOP_GRACE_PERIOD: "${SLICER_STOP_GRACE_PERIOD:-30s}"'
        ])) return 'compose_environment_contract_mismatch';
    if (!service.includes(`    ${IMAGE_INTERPOLATION}`)) return 'compose_image_contract_mismatch';
    if (/^\s+(?:build|ports|expose|network_mode|privileged|pid|ipc|uts|userns_mode|cgroupns_mode|devices|cap_add):/m
        .test(activeSource)) return 'compose_forbidden_runtime_key';
    if (/^\s+external:\s*true\s*$/m.test(activeSource) || /^\s+read_only:\s*false\s*$/m.test(activeSource)) {
        return 'compose_security_envelope_mismatch';
    }
    for (const required of [
        '      EXPECTED_SERVICE_UID: "${SLICER_UID:?',
        '      EXPECTED_SERVICE_GID: "${SLICER_GID:?',
        '    read_only: true',
        '    cap_drop:\n      - ALL',
        '    security_opt:\n      - no-new-privileges:true',
        '    pids_limit: ${SLICER_PIDS_LIMIT:-512}',
        '    mem_limit: ${SLICER_MEMORY_BYTES:-4294967296}',
        '    memswap_limit: ${SLICER_MEMORY_BYTES:-4294967296}',
        '    cpus: ${SLICER_CPU_LIMIT:-2.0}',
        '        max-size: "${SLICER_LOG_MAX_SIZE:-20m}"',
        '        max-file: "${SLICER_LOG_MAX_FILES:-5}"',
        '    stop_grace_period: ${SLICER_STOP_GRACE_PERIOD:-30s}',
        '      - /tmp:rw,nosuid,nodev,noexec,size=64m,uid=${SLICER_UID:?',
        'gid=${SLICER_GID:?',
        'mode=0700',
        '    networks:\n      - slicer-api-private',
        '  slicer-api-private:\n    name: slicer-api-private\n    driver: bridge\n    internal: true'
    ]) {
        if (!activeSource.includes(required)) return 'compose_security_envelope_mismatch';
    }
    const volumes = indentedBlock(activeSource, '    volumes:', 4);
    if ((volumes.match(/^      - /gm) || []).length !== 4
        || occurrences(volumes, '      - type: bind') !== 4
        || occurrences(activeSource, 'create_host_path: false') !== 4) {
        return 'compose_mount_contract_mismatch';
    }
    for (const [sourcePath, target, readOnly] of [
        ['${SLICER_INPUT_DIR:-./input}', '/app/input', false],
        ['${SLICER_OUTPUT_DIR:-./output}', '/app/output', false],
        ['${SLICER_CONFIGS_DIR:-./configs}', '/app/configs', true],
        ['${SLICER_PRICING_STATE_DIR:-./configs/pricing-state}', '/app/configs/pricing-state', false]
    ]) {
        const mount = `        source: ${sourcePath}\n        target: ${target}`;
        if (!activeSource.includes(readOnly ? `${mount}\n        read_only: true` : mount)) {
            return 'compose_mount_contract_mismatch';
        }
    }
    if (/target:\s+\/app\/(?:input|output|configs)(?:\/|\s)[\s\S]{0,80}read_only:\s+false/m.test(activeSource)
        || /mode=0?777|\/var\/run\/docker\.sock|\/proc:|\/sys:/.test(activeSource)) {
        return 'compose_writable_surface_mismatch';
    }
    if (!activeSource.includes('      - "${SLICER_ENV_FILE:?Set SLICER_ENV_FILE to the operator-managed service environment file}"')) {
        return 'compose_environment_file_required';
    }
    if (/^\s+(?:[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|API_KEY)[A-Z0-9_]*):\s*(?!"?\$\{)/m.test(activeSource)
        || /(?:password|secret|api[_-]?key|token)\s*[:=]\s*["']?(?:placeholder|changeme|example|test|prod)/i
            .test(activeSource)) {
        return 'compose_embedded_secret_forbidden';
    }
    return null;
}

function loadManifest(repositoryRoot) {
    const target = path.resolve(repositoryRoot, MANIFEST_NAME);
    const details = fs.lstatSync(target);
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0
        || details.size > MAX_MANIFEST_BYTES || fs.realpathSync(target) !== target) {
        throw new Error('production Compose manifest must be a bounded regular non-link file');
    }
    return fs.readFileSync(target, 'utf8');
}

function main() {
    const repositoryRoot = path.resolve(__dirname, '..');
    let source;
    try {
        source = loadManifest(repositoryRoot);
    } catch {
        console.error('production_compose_manifest_invalid');
        process.exitCode = 2;
        return;
    }
    const error = validateImageReference(process.env.SLICER_API_IMAGE)
        || validateProductionComposeSource(source);
    if (error) {
        console.error(error);
        process.exitCode = 2;
        return;
    }
    console.log('production_compose_contract=PASS');
}

if (require.main === module) main();

module.exports = Object.freeze({
    IMAGE_INTERPOLATION,
    MANIFEST_NAME,
    MAX_MANIFEST_BYTES,
    validateImageReference,
    validateProductionComposeSource
});
