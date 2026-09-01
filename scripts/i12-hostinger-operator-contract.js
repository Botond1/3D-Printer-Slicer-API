'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PACK_ROOT = path.join(ROOT, 'ops', 'hostinger');
const MAX_FILE_BYTES = 128 * 1024;
const TRAEFIK_IMAGE = 'traefik:v3.7.11@sha256:5203c3f39ca70de6790d964624e042463ffbd57715bc82be155cf224c0dd5144';
const TRAEFIK_HEALTHCHECK = '      test: ["CMD", "traefik", "healthcheck", "--ping=true", "--ping.entryPoint=health", "--entryPoints.health.address=127.0.0.1:8082"]';
const TRAEFIK_HEALTHCHECK_BLOCK = `    healthcheck:\n${TRAEFIK_HEALTHCHECK}\n      interval: 30s\n      timeout: 5s\n      retries: 3\n      start_period: 10s`;
const TRAEFIK_SERVICE_NETWORKS_BLOCK = '    networks:\n'
    + '      traefik-ingress:\n'
    + '        gw_priority: 1\n'
    + '      slicer-api-private:\n'
    + '        gw_priority: 0';
const TRAEFIK_INGRESS_NETWORK_BLOCK = '  traefik-ingress:\n'
    + '    name: 3d-psa-traefik-ingress\n'
    + '    driver: bridge\n'
    + '    internal: false';
const TRAEFIK_PRIVATE_NETWORK_BLOCK = '  slicer-api-private:\n'
    + '    name: slicer-api-private\n'
    + '    external: true\n';
const BACKEND_URL = 'http://3d-psa-backend-server:3000';
const ACTIVE_ROUTER_NAME = 'slicer-api.yml';
const DISABLED_HOST = 'slicer-api.invalid';
const DARK_DYNAMIC_ENTRY = '.gitkeep';
const PRIVATE_RUNTIME_DIRECTORY = '.runtime-private';
const PRIVATE_STAGING_DIRECTORY = 'staging';
const PRIVATE_ROLLBACK_DIRECTORY = 'rollback';
const REHEARSAL_LOCK_NAME = 'route-rehearsal.lock';
const REHEARSAL_LOCK_FD = 9;
const FLOCK_CONFLICT_EXIT_CODE = 75;
const PRIVATE_STAGING_FILE_PATTERN = /^slicer-api-[a-z0-9][a-z0-9._-]{0,79}\.yml\.tmp$/;
const PRIVATE_ROLLBACK_FILE_PATTERN = /^slicer-api-[a-z0-9][a-z0-9._-]{0,79}\.yml\.disabled$/;
const PRIVATE_RUNTIME_IGNORE_PATTERN = '/ops/hostinger/.runtime-private/';
const ACTIVE_ROUTER_IGNORE_PATTERN = '/ops/hostinger/dynamic/slicer-api.yml';
const ALLOWLIST_MIDDLEWARE = 'slicer-api-source-allowlist';
const ALLOWLIST_PLACEHOLDER = '__J2_SOURCE_RANGE__';
const ROUTER_RENDER_COMMENT = '# Render only through scripts/i12-hostinger-operator-contract.js. It replaces\n'
    + '# the exact .invalid hostname and __J2_SOURCE_RANGE__ placeholder from private\n'
    + '# inputs.';
const ALLOWLIST_PHASES = Object.freeze(['leadpilot-only']);
const MAX_ALLOWLIST_ENTRIES = 1;
const MAX_ALLOWLIST_FILE_BYTES = 256;
const MAX_PRIVATE_INPUT_PATH_BYTES = 4096;
const LIVE_DYNAMIC_RELEASE_MISMATCH = 'STOP_LIVE_DYNAMIC_RELEASE_MISMATCH';
const PRODUCTION_COMPOSE_PREFIX = 'docker compose -p slicer-api '
    + '--env-file "$operator_values_file" -f docker-compose.production.yml';
const PRIVATE_INPUT_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const RAW_IPV4_PATH_PATTERN = /(?:^|[^0-9])(?:[0-9]{1,3}[._-]){3}[0-9]{1,3}(?:[^0-9]|$)/;
const ROOT_ROUTER_METADATA_POLICY = Object.freeze({
    fileUid: 0,
    fileGid: 0,
    fileMode: 0o600,
    parentUid: 0,
    parentGid: 0,
    parentMode: 0o700
});
const CAPACITY_PRODUCER_EXEC = path.join('scripts', 'i12-capacity-producer-exec.py');
const PERIMETER_COMMENT_SHA256 = '00079a0e680b63b43c6e13af60c2bf2409cce0c7011313e63addbbe58b745e1d';
const ALLOWLIST_PROBE_COMMENT_SHA256 = '9a4ea7ea7344b8a7ec72a13091ca02f6a81e9535a86962641948a46bb4b3739e';
const FILES = Object.freeze({
    compose: 'docker-compose.traefik.yml',
    perimeterScript: path.join('perimeter', 'r3d-perimeter.sh'),
    allowlistProbe: path.join('perimeter', 'r3d-allowlist-probe.sh'),
    perimeterService: path.join('perimeter', 'r3d-perimeter.service'),
    routerTemplate: path.join('templates', 'slicer-api-router.yml.disabled'),
    runbook: 'RUNBOOK.md'
});
const SERVICE_KEYS = Object.freeze([
    'image', 'container_name', 'command', 'ports', 'security_opt', 'cap_drop',
    'read_only', 'pids_limit', 'mem_limit', 'memswap_limit', 'cpus', 'tmpfs',
    'logging', 'healthcheck', 'volumes', 'labels', 'networks', 'restart',
    'stop_grace_period'
]);
const TRAEFIK_COMMANDS = Object.freeze([
    '--global.checkNewVersion=false',
    '--global.sendAnonymousUsage=false',
    '--entryPoints.web.address=:8080',
    '--entryPoints.web.http.redirections.entryPoint.to=:443',
    '--entryPoints.web.http.redirections.entryPoint.scheme=https',
    '--entryPoints.web.http.redirections.entryPoint.permanent=true',
    '--entryPoints.websecure.address=:8443',
    '--entryPoints.health.address=127.0.0.1:8082',
    '--providers.file=true',
    '--providers.file.directory=/etc/traefik/dynamic',
    '--providers.file.watch=true',
    '--api.dashboard=false',
    '--api.insecure=false',
    '--ping=true',
    '--ping.entryPoint=health',
    '--log.level=INFO',
    '--log.format=json',
    '--accessLog=true',
    '--accessLog.format=json',
    '--certificatesResolvers.letsencrypt.acme.email=${ACME_EMAIL:?Set ACME_EMAIL to the existing ACME account contact address}',
    '--certificatesResolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
    '--certificatesResolvers.letsencrypt.acme.httpChallenge=true',
    '--certificatesResolvers.letsencrypt.acme.httpChallenge.entryPoint=web'
]);

function normalize(source) {
    return typeof source === 'string' ? source.replace(/\r\n?/g, '\n') : '';
}

function activeSource(source) {
    return normalize(source).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
}

function commentSourceDigest(source) {
    const comments = normalize(source).split('\n')
        .filter((line) => /^\s*#/.test(line)).join('\n') + '\n';
    return crypto.createHash('sha256').update(comments, 'utf8').digest('hex');
}

function occurrences(source, fragment) {
    return source.split(fragment).length - 1;
}

function exactLineCount(source, line) {
    return normalize(source).split('\n').filter((candidate) => candidate === line).length;
}

function indentedBlock(source, anchor, indent) {
    const lines = normalize(source).split('\n');
    const start = lines.indexOf(anchor);
    if (start === -1) return '';
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
        if (lines[index].trim() && lines[index].match(/^ */)[0].length <= indent) {
            end = index;
            break;
        }
    }
    return lines.slice(start, end).join('\n');
}

function directKeys(source, indent) {
    const pattern = new RegExp(`^${' '.repeat(indent)}([A-Za-z0-9_.-]+):(?:\\s|$)`);
    return normalize(source).split('\n').map((line) => line.match(pattern))
        .filter(Boolean).map((match) => match[1]);
}

function exactArray(actual, expected) {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function safeSource(source) {
    return typeof source === 'string' && Buffer.byteLength(source, 'utf8') > 0
        && Buffer.byteLength(source, 'utf8') <= MAX_FILE_BYTES
        && !source.includes('\r') && !source.includes('\t') && !source.includes('\0');
}

function canonicalIpv4Cidr(value) {
    if (typeof value !== 'string' || value.length > 18) return false;
    const match = value.match(/^((?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3})\/32$/);
    return Boolean(match && match[1].split('.').every((octet) => Number(octet) <= 255));
}

function validateAllowlistCidrs(cidrs, phase = null) {
    if (!Array.isArray(cidrs) || cidrs.length !== MAX_ALLOWLIST_ENTRIES
        || cidrs.some((cidr) => !canonicalIpv4Cidr(cidr))
        || new Set(cidrs).size !== cidrs.length) {
        return 'j2_allowlist_cidr_invalid';
    }
    if (phase !== null && !ALLOWLIST_PHASES.includes(phase)) return 'j2_allowlist_phase_invalid';
    return null;
}

function parsePrivateAllowlist(source, phase) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') < 8
        || Buffer.byteLength(source, 'utf8') > MAX_ALLOWLIST_FILE_BYTES
        || source.includes('\r') || source.includes('\t') || source.includes('\0')
        || !source.endsWith('\n')) {
        return Object.freeze({ error: 'j2_allowlist_file_malformed', cidrs: null });
    }
    const cidrs = source.slice(0, -1).split('\n');
    if (cidrs.some((cidr) => !cidr)) {
        return Object.freeze({ error: 'j2_allowlist_file_malformed', cidrs: null });
    }
    const error = validateAllowlistCidrs(cidrs, phase);
    return Object.freeze({ error, cidrs: error ? null : Object.freeze(cidrs) });
}

function parseRenderedSourceRanges(block) {
    const lines = normalize(block).split('\n');
    if (lines[0] !== '        sourceRange:' || lines.length !== 2) return null;
    const cidrs = [];
    for (const line of lines.slice(1)) {
        const match = line.match(/^          - "([^"]+)"$/);
        if (!match) return null;
        cidrs.push(match[1]);
    }
    return validateAllowlistCidrs(cidrs) ? null : cidrs;
}

function validComposeVersion(value) {
    const match = typeof value === 'string' && value.length <= 32
        ? value.match(/^([1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/) : null;
    if (!match) return false;
    const [major, minor, patch] = match.slice(1).map(Number);
    if (![major, minor, patch].every(Number.isSafeInteger)) return false;
    return major > 2 || (major === 2 && (minor > 33 || (minor === 33 && patch >= 1)));
}

function validFirewallBackend(value) {
    return value === 'iptables';
}

function validateLiveDynamicSource(source, runtimeFs = fs) {
    if (typeof source !== 'string'
        || Buffer.byteLength(source, 'utf8') < 1
        || Buffer.byteLength(source, 'utf8') > MAX_PRIVATE_INPUT_PATH_BYTES
        || source.includes('\r') || source.includes('\n') || source.includes('\t')
        || source.includes('\0') || !path.isAbsolute(source)
        || path.resolve(source) !== source) {
        return LIVE_DYNAMIC_RELEASE_MISMATCH;
    }
    const expected = path.join(PACK_ROOT, 'dynamic');
    if (source !== expected || !runtimeFs || typeof runtimeFs.realpathSync !== 'function'
        || typeof runtimeFs.lstatSync !== 'function') {
        return LIVE_DYNAMIC_RELEASE_MISMATCH;
    }
    try {
        const details = runtimeFs.lstatSync(source);
        const actualReal = runtimeFs.realpathSync(source);
        const expectedReal = runtimeFs.realpathSync(expected);
        if (!details.isDirectory() || details.isSymbolicLink()
            || actualReal !== source || expectedReal !== expected || actualReal !== expectedReal) {
            return LIVE_DYNAMIC_RELEASE_MISMATCH;
        }
    } catch {
        return LIVE_DYNAMIC_RELEASE_MISMATCH;
    }
    return null;
}

function validateComposeMountNetworkAndVolumeContract(service, networks, volumes) {
    const mounts = indentedBlock(service, '    volumes:', 4);
    for (const fragment of [
        '        source: ./dynamic\n        target: /etc/traefik/dynamic\n        read_only: true',
        '      - type: volume\n        source: traefik-acme\n        target: /letsencrypt'
    ]) {
        if (!mounts.includes(fragment)) return 'traefik_mount_contract_mismatch';
    }
    if (occurrences(mounts, '      - type: bind') !== 1
        || occurrences(mounts, '      - type: volume') !== 1
        || occurrences(mounts, '          create_host_path: false') !== 1
        || occurrences(mounts, '        read_only: true') !== 1
        || /docker\.sock|providers\.docker/.test(mounts)) {
        return 'traefik_mount_contract_mismatch';
    }
    if (indentedBlock(service, '    networks:', 4) !== TRAEFIK_SERVICE_NETWORKS_BLOCK) {
        return 'traefik_service_network_priority_mismatch';
    }
    const ingress = indentedBlock(networks, '  traefik-ingress:', 2);
    const privateNetwork = indentedBlock(networks, '  slicer-api-private:', 2);
    if (ingress !== TRAEFIK_INGRESS_NETWORK_BLOCK
        || privateNetwork !== TRAEFIK_PRIVATE_NETWORK_BLOCK) {
        return 'traefik_network_contract_mismatch';
    }
    if (!exactArray(directKeys(volumes, 2), ['traefik-acme'])
        || !volumes.includes('    name: "${TRAEFIK_ACME_VOLUME:?Set TRAEFIK_ACME_VOLUME to the existing Traefik ACME volume name}"')
        || !volumes.includes('    external: true') || volumes.includes('driver:')) {
        return 'traefik_acme_volume_contract_mismatch';
    }
    return null;
}

function validateComposeSource(source) {
    if (!safeSource(source)) return 'traefik_compose_source_malformed';
    const active = activeSource(source);
    if (/--providers\.docker(?:[.=]|$)|docker\.sock/i.test(active)) {
        return 'traefik_docker_control_plane_forbidden';
    }
    if (exactLineCount(active, 'services:') !== 1 || exactLineCount(active, 'networks:') !== 1
        || exactLineCount(active, 'volumes:') !== 1
        || /^\s*[A-Za-z0-9_.-]+:\s*[|>][-+]?\s*$/m.test(active) || /^\s*<<:/m.test(active)) {
        return 'traefik_compose_source_malformed';
    }
    if (!exactArray(directKeys(active, 0), ['services', 'networks', 'volumes'])) {
        return 'traefik_compose_topology_mismatch';
    }
    const services = indentedBlock(active, 'services:', 0);
    const networks = indentedBlock(active, 'networks:', 0);
    const volumes = indentedBlock(active, 'volumes:', 0);
    if (!exactArray(directKeys(services, 2), ['traefik'])) return 'traefik_service_allowlist_mismatch';
    if (!exactArray(directKeys(networks, 2), ['traefik-ingress', 'slicer-api-private'])) {
        return 'traefik_network_allowlist_mismatch';
    }
    const service = indentedBlock(active, '  traefik:', 2);
    if (!exactArray(directKeys(service, 4), SERVICE_KEYS)) return 'traefik_service_schema_mismatch';
    if (indentedBlock(service, '    healthcheck:', 4) !== TRAEFIK_HEALTHCHECK_BLOCK) {
        return 'traefik_healthcheck_subprocess_contract_mismatch';
    }
    const command = indentedBlock(service, '    command:', 4);
    const actualCommands = command.split('\n').map((line) => line.match(/^      - (.+)$/))
        .filter(Boolean).map((match) => match[1]);
    if (!exactArray(actualCommands, TRAEFIK_COMMANDS)
        || /--configFile|TRAEFIK_[A-Z0-9_]+=|\/etc\/traefik\/traefik\.ya?ml/.test(command)) {
        return 'traefik_cli_static_contract_mismatch';
    }
    if (exactLineCount(service, `    image: ${TRAEFIK_IMAGE}`) !== 1
        || occurrences(active, '    image:') !== 1 || /image:\s+[^\n]*:(?:latest|v?3\.7\.11)(?:\s|$)/m.test(active)) {
        return 'traefik_image_pin_mismatch';
    }
    for (const line of [
        '      - "80:8080/tcp"', '      - "443:8443/tcp"',
        TRAEFIK_HEALTHCHECK,
        '      - no-new-privileges:true', '      - ALL', '    read_only: true',
        '    pids_limit: 128', '    mem_limit: 268435456', '    memswap_limit: 268435456',
        '    cpus: 0.50', '      - /tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700',
        '        max-size: "10m"', '        max-file: "3"',
        '      traefik.enable: "false"', '        gw_priority: 1',
        '        gw_priority: 0', '    restart: unless-stopped',
        '    stop_grace_period: 30s'
    ]) {
        if (exactLineCount(service, line) !== 1) return 'traefik_runtime_envelope_mismatch';
    }
    if (occurrences(service, '      - "80:8080/tcp"') !== 1
        || occurrences(service, '      - "443:8443/tcp"') !== 1
        || (service.match(/^      - "[0-9]+:[0-9]+\/tcp"$/gm) || []).length !== 2) {
        return 'traefik_port_contract_mismatch';
    }
    if (/^\s+(?:build|network_mode|privileged|cap_add|devices|device_cgroup_rules|dns|dns_search|extra_hosts|pid|ipc|uts|userns_mode):/m.test(active)
        || /host\.docker\.internal|network_mode:\s*host|mode=0?777|no-new-privileges:false/.test(active)) {
        return 'traefik_forbidden_runtime_key';
    }
    const mountOrNetworkError = validateComposeMountNetworkAndVolumeContract(service, networks, volumes);
    if (mountOrNetworkError) return mountOrNetworkError;
    if (/^\s+(?:[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|API_KEY)[A-Z0-9_]*):/mi.test(active)
        || /(?:password|secret|api[_-]?key|token)\s*[:=]\s*["']?[^${\s]/i.test(active)) {
        return 'traefik_embedded_secret_forbidden';
    }
    return null;
}

function validHostname(hostname, allowDisabled = false) {
    if (typeof hostname !== 'string' || hostname.length > 253
        || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return false;
    return allowDisabled || hostname !== DISABLED_HOST;
}

function validateRouterSource(source, expectedHost = DISABLED_HOST, disabled = true, expectedCidrs = null) {
    if (!safeSource(source) || !validHostname(expectedHost, disabled)) return 'traefik_router_source_malformed';
    if (!source.includes(ROUTER_RENDER_COMMENT)) return 'traefik_router_render_boundary_mismatch';
    const active = activeSource(source);
    const escapedHost = expectedHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (exactLineCount(active, `      rule: "Host(\`${expectedHost}\`)"`) !== 1
        || exactLineCount(active, `          - url: "${BACKEND_URL}"`) !== 1
        || occurrences(active, BACKEND_URL) !== 1
        || !new RegExp(`Host\\(\\\`${escapedHost}\\\`\\)`).test(active)) {
        return 'traefik_router_identity_mismatch';
    }
    const http = indentedBlock(active, 'http:', 0);
    const routers = indentedBlock(http, '  routers:', 2);
    const router = indentedBlock(routers, '    slicer-api:', 4);
    const middlewares = indentedBlock(http, '  middlewares:', 2);
    const middleware = indentedBlock(middlewares, `    ${ALLOWLIST_MIDDLEWARE}:`, 4);
    const ipAllowList = indentedBlock(middleware, '      ipAllowList:', 6);
    const rangeBlock = indentedBlock(ipAllowList, '        sourceRange:', 8);
    const services = indentedBlock(http, '  services:', 2);
    const service = indentedBlock(services, '    slicer-api:', 4);
    const loadBalancer = indentedBlock(service, '      loadBalancer:', 6);
    const healthCheck = indentedBlock(loadBalancer, '        healthCheck:', 8);
    const servers = indentedBlock(loadBalancer, '        servers:', 8);
    const expectedServers = `        servers:\n          - url: "${BACKEND_URL}"`;
    const canonicalServers = servers.endsWith('\n') ? servers.slice(0, -1) : servers;
    if (!exactArray(directKeys(active, 0), ['http'])
        || !exactArray(directKeys(http, 2), ['routers', 'middlewares', 'services'])
        || !exactArray(directKeys(routers, 4), ['slicer-api'])
        || !exactArray(directKeys(router, 6), ['entryPoints', 'rule', 'service', 'middlewares', 'tls'])
        || !exactArray(directKeys(middlewares, 4), [ALLOWLIST_MIDDLEWARE])
        || !exactArray(directKeys(middleware, 6), ['ipAllowList'])
        || !exactArray(directKeys(ipAllowList, 8), ['sourceRange'])
        || !exactArray(directKeys(services, 4), ['slicer-api'])
        || !exactArray(directKeys(service, 6), ['loadBalancer'])
        || !exactArray(directKeys(loadBalancer, 8), ['passHostHeader', 'healthCheck', 'servers'])
        || !exactArray(directKeys(healthCheck, 10), ['path', 'interval', 'timeout'])
        || !exactArray(directKeys(servers, 10), [])) {
        return 'traefik_router_schema_mismatch';
    }
    for (const fragment of [
        '      entryPoints:\n        - websecure', '      service: slicer-api',
        `      middlewares:\n        - ${ALLOWLIST_MIDDLEWARE}`,
        '      tls:\n        certResolver: letsencrypt', '        passHostHeader: true',
        '        healthCheck:\n          path: /ready\n          interval: 10s\n          timeout: 3s'
    ]) {
        if (!active.includes(fragment)) return 'traefik_router_contract_mismatch';
    }
    if (exactLineCount(loadBalancer, '        passHostHeader: true') !== 1
        || exactLineCount(healthCheck, '          path: /ready') !== 1
        || exactLineCount(healthCheck, '          interval: 10s') !== 1
        || exactLineCount(healthCheck, '          timeout: 3s') !== 1
        || canonicalServers !== expectedServers
        || exactLineCount(servers, `          - url: "${BACKEND_URL}"`) !== 1) {
        return 'traefik_router_service_mismatch';
    }
    if (occurrences(active, ALLOWLIST_MIDDLEWARE) !== 2 || occurrences(active, 'ipAllowList:') !== 1
        || /ipWhiteList|ipStrategy|forwarded|x-forwarded-for|\bxff\b|remoteAddr|depth:|excludedIPs:/i.test(active)) {
        return 'traefik_allowlist_strategy_mismatch';
    }
    if (disabled) {
        if (expectedCidrs !== null
            || rangeBlock !== `        sourceRange:\n          - "${ALLOWLIST_PLACEHOLDER}"`
            || occurrences(active, ALLOWLIST_PLACEHOLDER) !== 1) {
            return 'traefik_allowlist_template_mismatch';
        }
    } else {
        const actualCidrs = parseRenderedSourceRanges(rangeBlock);
        if (!actualCidrs || occurrences(active, ALLOWLIST_PLACEHOLDER) !== 0) {
            return 'traefik_allowlist_source_range_mismatch';
        }
        if (expectedCidrs !== null
            && (validateAllowlistCidrs(expectedCidrs) || !exactArray(actualCidrs, expectedCidrs))) {
            return 'traefik_allowlist_identity_mismatch';
        }
    }
    if (occurrences(active, 'Host(`') !== 1 || occurrences(active, '          - url:') !== 1
        || /HostRegexp|PathPrefix|catchall|0\.0\.0\.0|localhost|127\.0\.0\.1|forwardAuth|serversTransport/i.test(active)
        || /(?:forwardproxy|forward-proxy|socks|connect|dns|masquerade|nat)/i.test(active)) {
        return 'traefik_router_scope_mismatch';
    }
    return null;
}

function renderRouterSource(template, hostname, cidrs) {
    const templateError = validateRouterSource(template);
    const inputError = validHostname(hostname) ? validateAllowlistCidrs(cidrs) : 'active_router_argument_invalid';
    const markerLine = `          - "${ALLOWLIST_PLACEHOLDER}"`;
    if (templateError || inputError || occurrences(template, DISABLED_HOST) !== 1
        || exactLineCount(template, markerLine) !== 1) {
        return Object.freeze({ error: templateError || inputError || 'traefik_router_template_mismatch', source: null });
    }
    const source = template.replace(DISABLED_HOST, hostname).replace(
        markerLine,
        `          - "${cidrs[0]}"`
    );
    const error = validateRouterSource(source, hostname, false, cidrs);
    return Object.freeze({ error, source: error ? null : source });
}

function validatePerimeterScriptSource(source) {
    if (!safeSource(source)) return 'hostinger_perimeter_script_source_malformed';
    const normalized = normalize(source);
    const executable = activeSource(source);
    if (commentSourceDigest(source) !== PERIMETER_COMMENT_SHA256) {
        return 'hostinger_perimeter_script_comment_contract_mismatch';
    }
    for (const fragment of [
        '#!/bin/sh', 'set -eu',
        ': "${R3D_ALLOWLIST_FILE:?Set R3D_ALLOWLIST_FILE to the absolute root-private allowlist path}"',
        ': "${R3D_PUBLIC_IPV4_FILE:?Set R3D_PUBLIC_IPV4_FILE to the absolute root-private public-IPv4 path}"',
        'ALLOWLIST_FILE="$R3D_ALLOWLIST_FILE"', 'PUBIP_FILE="$R3D_PUBLIC_IPV4_FILE"',
        'IFACE="${R3D_PUBLIC_IFACE:-eth0}"',
        'DOCKER-USER sits in the FORWARD chain, which runs AFTER nat/PREROUTING.',
        'Deleted BY RULE NUMBER, highest first -- not by reconstructing the rule text',
        "sort -rn); do\n        iptables -D DOCKER-USER \"$n\"",
        'iptables -I DOCKER-USER "$pos" -i "$IFACE" -p tcp -m conntrack --ctorigdst "$PUBIP" --ctorigdstport 443',
        'iptables -A DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdst "$PUBIP" --ctorigdstport 443',
        '--comment "$TAG_ALLOW" -j RETURN',
        '-m limit --limit 6/min --limit-burst 10',
        '--comment "$TAG_LOG" -j LOG --log-prefix "r3d-perimeter-deny: " --log-level 6',
        '--comment "$TAG_DENY" -j REJECT --reject-with tcp-reset',
        'waits the full timeout and receives nothing',
        'FROM THE CALLER\'S POINT OF VIEW THIS', 'BEHAVES AS A DROP.',
        'Do not re-litigate REJECT vs DROP here without new',
        'Docker binds [::]:443 through docker-proxy and there is NO IPv6 DNAT on',
        'it arrives\n#   as INPUT to the host',
        'putting it in DOCKER-USER would look right and do nothing',
        "sort -rn); do\n        ip6tables -D INPUT \"$n\"",
        'ip6tables -I INPUT 1 -p tcp --dport 443 -m conntrack --ctstate NEW',
        '--comment "$TAG_V6DENY" -j REJECT --reject-with tcp-reset',
        'Port 80 over IPv6 is deliberately untouched',
        'if iptables -S DOCKER-USER | grep -qE -- "--dport $HTTP_CPORT|--ctorigdstport 80"; then',
        'FATAL that breaks ACME HTTP-01 renewal. Refusing to leave this state.'
    ]) {
        if (!normalized.includes(fragment)) return 'hostinger_perimeter_script_contract_mismatch';
    }
    if (occurrences(executable, '--ctorigdst "$PUBIP" --ctorigdstport 443') !== 3
        || occurrences(executable, 'iptables -A DOCKER-USER') !== 2
        || occurrences(executable, 'ip6tables -I INPUT 1') !== 1
        || /R3D_(?:ALLOWLIST_FILE|PUBLIC_IPV4_FILE):-/.test(executable)
        || /^iptables\s.*--dport\s+(?:443|"?\$HTTPS_CPORT"?)/m.test(executable)
        || /^ip6tables\s.*DOCKER-USER/m.test(executable)
        || /^ip6tables\s.*--dport\s+80(?:\s|$)/m.test(executable)
        || /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/.test(normalized)
        || /\b[0-9a-f]{40}\b/i.test(executable)) {
        return 'hostinger_perimeter_script_contract_mismatch';
    }
    const allowIndex = executable.indexOf('--comment "$TAG_ALLOW" -j RETURN');
    const logIndex = executable.indexOf('--comment "$TAG_LOG" -j LOG');
    const denyIndex = executable.indexOf('--comment "$TAG_DENY" -j REJECT');
    if (allowIndex < 0 || logIndex <= allowIndex || denyIndex <= logIndex) {
        return 'hostinger_perimeter_rule_order_mismatch';
    }
    return null;
}

function validateAllowlistProbeSource(source) {
    if (!safeSource(source)) return 'hostinger_allowlist_probe_source_malformed';
    const normalized = normalize(source);
    const executable = activeSource(source);
    if (commentSourceDigest(source) !== ALLOWLIST_PROBE_COMMENT_SHA256) {
        return 'hostinger_allowlist_probe_comment_contract_mismatch';
    }
    for (const fragment of [
        '#!/bin/sh', 'set -eu',
        'WHY THIS EXISTS, AND WHY IT MATTERS MORE THAN THE IPTABLES LAYER',
        'WHY 127.0.0.1 AND NOT THE PUBLIC NAME',
        'HOST="${R3D_PROBE_HOST:-slicer-api.invalid}"',
        '[ "$HOST" != "slicer-api.invalid" ]',
        'set R3D_PROBE_HOST to the approved hostname',
        '--resolve "$HOST:443:127.0.0.1"',
        '403)', 'OK (403) -- Traefik allowlist is refusing non-allowlisted callers',
        '200)', 'THE TRAEFIK ALLOWLIST HAS FAILED OPEN.',
        '000)', 'FAIL (no response) -- Traefik not answering on 443 locally'
    ]) {
        if (!normalized.includes(fragment)) return 'hostinger_allowlist_probe_contract_mismatch';
    }
    const withoutLoopback = normalized.replaceAll('127.0.0.1', 'loopback');
    if (occurrences(executable, 'slicer-api.invalid') !== 2
        || exactLineCount(normalized, '    403)') !== 1
        || exactLineCount(normalized, '    200)') !== 1
        || exactLineCount(normalized, '    000)') !== 1
        || /\b[a-z0-9.-]+\.hu\b/i.test(normalized)
        || /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/.test(withoutLoopback)) {
        return 'hostinger_allowlist_probe_contract_mismatch';
    }
    return null;
}

function validatePerimeterServiceSource(source) {
    if (!safeSource(source)) return 'hostinger_perimeter_service_source_malformed';
    const normalized = normalize(source);
    const required = [
        '[Unit]',
        'Description=R3D network-layer perimeter for the public HTTPS listener',
        'Documentation=file:///usr/local/sbin/r3d-perimeter.sh',
        'After=docker.service', 'Requires=docker.service', 'PartOf=docker.service',
        '[Service]', 'Type=oneshot', 'RemainAfterExit=yes',
        'EnvironmentFile=/etc/rocket3d/slicer-api/r3d-perimeter.env',
        'ExecStart=/usr/local/sbin/r3d-perimeter.sh',
        '[Install]', 'WantedBy=multi-user.target'
    ];
    let prior = -1;
    for (const fragment of required) {
        const index = normalized.indexOf(fragment);
        if (index <= prior || occurrences(normalized, fragment) !== 1) {
            return 'hostinger_perimeter_service_contract_mismatch';
        }
        prior = index;
    }
    if (/^EnvironmentFile=-/m.test(normalized) || /^Environment=/m.test(normalized)
        || /^ExecStop=/m.test(normalized)) {
        return 'hostinger_perimeter_service_contract_mismatch';
    }
    return null;
}

function validateRunbookSource(source) {
    if (!safeSource(source)) return 'hostinger_runbook_source_malformed';
    const required = [
        'Verify sources and resolve the API identity', 'Start and qualify the API while it is dark',
        'Start Traefik with routing still disabled', 'Atomically enable the exact route',
        'Disable and roll back without destroying state'
    ];
    let prior = -1;
    for (const heading of required) {
        const index = source.indexOf(heading);
        if (index <= prior) return 'hostinger_runbook_order_mismatch';
        prior = index;
    }
    for (const fragment of [
        '--rm --pull never --network none --read-only --cap-drop ALL',
        '--security-opt no-new-privileges', '--pids-limit 16', '--memory 64m',
        'Accept only positive decimal UID and GID values; reject UID 0 or GID 0.',
        'mode\n`0700`', 'Run the readiness/authentication/egress matrix twice',
        'CLI-only', 'ACME_EMAIL', 'TRAEFIK_ACME_VOLUME', '/letsencrypt/acme.json',
        'regular non-link status. `acme.json` must remain mode `0600`.',
        'Docker provider and Engine socket are absent',
        'The file provider is the only discovery mechanism.',
        'helper internally recomputes the exact SHA-256',
        'Keep the router disabled while the approved hostname or its DNS result is\nmissing',
        'Never delete, truncate, recreate, reset, or\nreplace the ACME volume or `acme.json`',
        'stop only the\nnamed `slicer-api` service',
        'Keep input, output,\nconfigs, pricing-state, the private network, Traefik',
        'previous Traefik image digest', 'STOP_EXISTING_PROXY_PARITY_UNPROVEN',
        'unrelated routers or services', 'retain the stopped previous container for rollback',
        'dark proxy cutover and any proxy\nrestore must leave that hash unchanged',
        'Keep the stopped-old rollback retention',
        'Before starting the\ncandidate, inventory the owners of both host ports 80 and 443',
        'Prove that both old listeners are closed before creating or\nstarting the candidate',
        'Prove candidate identity, health, redirect,\nprovider set, the exact two network attachments',
        'Compose `2.33.1` or newer', '`gw_priority: 1`', '`gw_priority: 0`',
        'non-internal `traefik-ingress`', 'actual default\nroute uses `traefik-ingress`',
        'entrypoint redirect target must be the literal external port `:443`',
        'container entrypoint name `websecure` and not the internal port `:8443`',
        'Location authority with no explicit `:8443`',
        '--check-live-dynamic-source "$live_dynamic_source" || exit 1',
        'STOP_LIVE_DYNAMIC_RELEASE_MISMATCH',
        'compose_version="$(docker compose version --short)" || exit 1',
        'node scripts/i12-hostinger-operator-contract.js --check-compose-version "$compose_version" || exit 1',
        'scripts/i12-capacity-artifact-cleanup.js',
        'STOP_CLEANUP_CONSUMER_UNAVAILABLE',
        'scripts/i12-capacity-producer-exec.py',
        '--expected-max-concurrent', '--cleanup-manifest', '--report',
        'qualification_exit=0', 'cleanup_exit=0', 'postflight queue idle',
        'root:root-owned, mode `0600`, regular, non-link, single-link',
        'no-follow and close-on-\nexec semantics', 'real/effective/saved\nUID and GID',
        '/usr/bin/env -i', '/usr/bin/python3 "$verified_checkout/scripts/i12-capacity-producer-exec.py"',
        'No ambient\noperator environment survives `/usr/bin/env -i`;',
        'Secret values never appear in shell expansion, process\narguments, logs, or helper output.',
        '--service-uid', '--service-gid', '--slicer-base-url-file',
        '--slice-service-api-key-file', '--operations-api-key-file',
        '--artifact-api-key-file', 'ARTIFACT_API_KEY', 'mode `0600`', 'i12-queue-cleanup-v1',
        'takes no CLI arguments', '/run/i12-cleanup.json', '/app/output',
        'bounded classification and count',
        'Run the consumer even when the qualification runner exits nonzero',
        'same exact signed API digest', 'resolved non-root UID:GID',
        'exact API-image source commit and signed digest separately from the\nexact operator-pack source commit',
        'Never relabel an older verified API image as if it were built\nfrom a later operator-only commit.',
        'API-image source SHA and operator-pack source SHA are deliberately not an\nequality pair.',
        'Merging the later operator pack does not\nrelabel that image or by itself require a new candidate',
        'Allow exactly three binds', '/usr/bin/node',
        '/run/i12-capacity-artifact-cleanup.js',
        'SLICER_API_IMAGE="$candidate_image" node scripts/i7-production-compose-contract.js || exit 1',
        'rendered_api_image="$(SLICER_API_IMAGE="$candidate_image" docker compose -p slicer-api',
        '[ "$rendered_api_image" = "$candidate_image" ] || exit 1',
        'production Compose project name is always the literal `slicer-api`',
        'must pass explicit `-p slicer-api` before\n`--env-file`',
        '[ "$api_compose_project" = "slicer-api" ] || exit 1',
        'mktemp -d -p "$evidence_parent"',
        '--user "$resolved_slicer_uid:$resolved_slicer_gid"',
        '--mount type=bind,src="$slicer_output_dir",dst=/app/output,rw',
        '--mount type=bind,src="$run_owned_private_dir/queue-cleanup.json",dst=/run/i12-cleanup.json,ro',
        '--mount type=bind,src="$verified_checkout/scripts/i12-capacity-artifact-cleanup.js",dst=/run/i12-capacity-artifact-cleanup.js,ro',
        'docker compose -p slicer-api --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api',
        "docker inspect --format '{{.State.Status}} {{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}' 3d-psa-backend-server",
        '[ "$api_stop_state" = "exited false 0 false" ] || exit 1',
        'successful\ncleanup never converts a failed capacity qualification into a pass',
        'After the bounded cleanup attempt, restart the API from the same digest',
        'candidate_image_id="$(docker image inspect --format',
        'api_runtime_identity="$(docker inspect --format',
        '[ "$api_runtime_identity" = "$candidate_image $candidate_image_id running true 0 false" ] || exit 1',
        'repeat the full dark readiness, negative-authentication,\nAPI/native egress-denial and private-peer matrix twice',
        '[ "$qualification_exit" -eq 0 ] || exit 1',
        '[ "$cleanup_exit" -eq 0 ] || exit 1',
        '`source_compatibility_verification_failure` because `configs/` intentionally\ndiffers',
        'does not turn the CI run green or weaken its source\ncompatibility guard',
        'route is proved dark before, throughout, and after the operation',
        'actual-host `candidate -> previous -> candidate` switch',
        'separate clean compatibility-verification checkout pinned\nto the candidate source',
        'not in the later live operator-pack checkout',
        'exact commits exist; the checked-out `HEAD` equals the candidate source SHA',
        'previous source is its ancestor; `docker-compose.production.yml` is unchanged',
        'intentional `configs/` diff is the only nonzero compatibility\npredicate',
        'production Compose drift forbids the substitute',
        "For each direction, bind that release's separately recorded exact signed image\ndigest",
        'Require both the previous release and the restored\ncandidate to become healthy within the same bounded deadline',
        'operator-host rehearsal is an accepted\nsubstitute for the blocked automatic\nruntime rehearsal only',
        'owner-reported 2026-09-01 precedent used the signed `bf5e712` API image',
        'same-filesystem, no-clobber hard\nlink',
        "helper's `--disable-router` mode",
        'only repository-resident private router-state\nroot is the exact\n`ops/hostinger/.runtime-private` directory',
        '`/ops/hostinger/.runtime-private/` rule',
        '`/ops/hostinger/dynamic/slicer-api.yml` rule',
        '`ops/hostinger/dynamic/.gitkeep` remains tracked',
        'uses `git check-ignore -v --no-index`',
        'queries `git ls-tree` and `git\nls-files --cached` separately to refuse any tracked runtime-private descendant',
        'exact `.runtime-private/staging` and `.runtime-private/rollback`',
        '`slicer-api-<run-token>.yml.tmp`', '`slicer-api-<run-token>.yml.disabled`',
        'The renderer refuses\nthe rollback subtree',
        'The disable helper refuses a staging path',
        'mode `0600` single-link file',
        'owner, mode, and link count two',
        'mode `0600` identity with link count one',
        'preserves the live\nrouter with a no-clobber hard link',
        'exact retained\ndev/inode identity',
        'retained_router_prepare_rolled_back', 'retained_router_prepare_rollback_uncertain',
        'Successful activation consumes only its exact proven staging or retained source',
        'never recursively clean the runtime-private\nroot',
        'terminal second retained file is kept for owner review',
        'Before any\nNode helper process is spawned, the external orchestrator must validate every\nexpanded path argument',
        'A\nfailure is a stop before process creation',
        'The helper repeats this check only\nas defence in depth after process start; that late check cannot retroactively\nremove a caller-supplied raw pathname from `/proc/<pid>/cmdline`',
        'router digest and every raw IP never appear in\nprocess arguments, helper stdout/stderr, logs, or shared evidence',
        'A dynamic router or any low-entropy file derived from caller addresses\nnever contributes a digest to shared evidence.',
        'their digests never become shell variables or evidence.',
        '`finally`/restart branch; a signal handler is not recovery authority because\n`SIGKILL` cannot be handled',
        'Never glob, scan either private\ndirectory',
        'It is never terminal proof while the exact known source still\nexists',
        'even when that initial dark check\npasses',
        'fsyncs the source and source parent before the live unlink',
        'idempotent recovery after each logically injected fsync cutpoint',
        'process crash, kernel crash, or power-loss durability rehearsal remains\nexternal `NOT_VERIFIED`',
        '`router_dark_recovery_source_unavailable`',
        'must not inspect or unlink\na live-only route',
        'node scripts/i12-hostinger-operator-contract.js || exit 1',
        '--render-router <create-new-temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--active-router <temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--activate-router <temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--disable-router <create-new-retained-path> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--recover-router-dark <known-staging-source> --source-kind staging --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--recover-router-dark <known-rollback-source> --source-kind rollback --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--assert-router-dark <second-known-rollback-source> --source-kind rollback --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        'every directory from\nthe exact operator-pack root and the root-private allowlist parent through the\nfilesystem root must be canonical, non-symlink, root-owned, and neither group-\nnor world-writable',
        'before input read, immediately before each action, and\nafter each action',
        '`.runtime-private/route-rehearsal.lock` as a root:root-owned mode `0600`',
        'same shell FD and lock continuously across every activation, external\nobservation, disable, retained replay, and terminal dark assertion',
        '/usr/bin/flock --nonblock --exclusive --conflict-exit-code 75 9 || exit 1',
        'A second activation or concurrent disable therefore fails closed',
        'explicitly proves the consumed source pathname is\nabsent',
        'strict `--assert-router-dark` contract with the exact known single-link source',
        'separate `HEAD`/index Git contract',
        'release the full-rehearsal lock with `exec 9>&-`',
        'only `.gitkeep` remains',
        'canonical format is exactly one unique IPv4 `/32` line',
        'Only phase `leadpilot-only` exists.',
        'A second address,\nanother phase, `/24`, or any prefix other than `/32` is forbidden.',
        'machine-level perimeter control, not an application-level',
        'approved address belongs to a shared host that currently carries',
        'owner accepted that scope explicitly; the separate',
        'no verified provider reservation. Rebuild, migration, or',
        'No current control detects this event. The',
        'consumer must notify the owner before any rebuild or migration',
        'dynamic directory must be root:root-owned\nmode `0700`',
        '`.gitkeep`, must be a root:root-owned mode\n`0600`, regular, non-link, single-link file containing exactly one LF',
        'current pinned Traefik runtime is root (`UID:GID 0:0`)',
        'future non-root\nruntime is a stop requiring a separately designed permission model',
        'opaque,\naddress-free ASCII basename of at most 96 safe characters',
        'no path\ncomponent may contain a dotted, dashed, or underscored raw IPv4 address',
        'mandatory external pre-spawn path gate',
        'authoritative read-only API response', '`proxied` field is boolean `false`',
        'STOP_DNS_ONLY_BOUNDARY_UNPROVEN', 'deliberately has no `ipStrategy`',
        '--check-firewall-backend "$firewall_backend" || exit 1',
        'STOP_DOCKER_FIREWALL_BACKEND_UNSUPPORTED',
        'Require and inventory the IPv4\n`DOCKER-USER` chain',
        '`ip6tables` `DOCKER-USER` rule is not an IPv6 enforcement seam',
        'owner-observed starting state was an empty IPv4 `DOCKER-USER` chain with\ninactive UFW',
        'Published Docker ports can bypass UFW',
        'only while this Traefik serves exactly the one',
        'second hostname is therefore a\nstop requiring a separately designed per-host boundary',
        'ops/hostinger/perimeter/r3d-perimeter.sh',
        'ops/hostinger/perimeter/r3d-allowlist-probe.sh',
        'ops/hostinger/perimeter/r3d-perimeter.service',
        '`-` prefix, `/etc/rocket3d/slicer-api/r3d-perimeter.env`',
        'R3D_ALLOWLIST_FILE=<absolute-release-local-root-private-allowlist-file>',
        'R3D_PUBLIC_IPV4_FILE=<absolute-release-local-root-private-public-ipv4-file>',
        '`slicer-api.invalid` placeholder',
        'systemd does not\ninherit the invoking shell\'s environment',
        'verified public ingress interface and root-private public VPS IPv4',
        'Keep every real address,\nhostname, and path value out of the repository and shared evidence',
        'removes only its own comment-tagged rules, by rule number in\ndescending order',
        'installs directly in IPv4 `DOCKER-USER`, in this\norder',
        '`--ctorigdst <verified-public-VPS-IPv4>`', '`--ctorigdstport 443`',
        'Plain `--dport 443`, internal `--dport 8443`, and any\nrule matching original port 80 are forbidden',
        'Port 80 remains globally\nreachable over IPv4',
        'for the current singular `/32`',
        'exact fixed prefix `r3d-perimeter-deny: `',
        '`REJECT --reject-with tcp-reset` is retained as the exact installed deny',
        'waited for the full client timeout and received\nnothing',
        'From the caller\'s perspective this layer therefore behaves\nas a drop',
        'connection timeout, no reset,\nand no HTTP status',
        'Do not reopen `REJECT` versus `DROP` without new contrary\nevidence',
        'Docker exposes\n`[::]:443` through `docker-proxy` without IPv6 DNAT',
        'places one rule at the start of `ip6tables INPUT` to reject every new inbound\nTCP connection to port 443',
        'IPv6 port 80 remains\nuntouched',
        'exactly three IPv4 rules and one IPv6 rule',
        'the loopback Traefik-only probe returned HTTP 403',
        'State after a real host reboot remains `NOT_VERIFIED`',
        'Traefik HTTP 403', 'HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED`',
        '`traefik-letsencrypt`', '`traefik_traefik-letsencrypt`',
        'STOP_ACME_VOLUME_IDENTITY_UNPROVEN', 'STOP_ACME_RENEWAL_REHEARSAL_UNPROVEN',
        'external orchestrator', '`dark -> active -> dark -> active -> dark`',
        'explicit rollback source for the second activation',
        'Rendering remains staging-only and disabling remains\nrollback-only',
        '`final_route_state=dark`', 'STOP_J2_EXTERNAL_BOUNDARY_UNPROVEN',
        'Permanent route\nactivation is a separate owner-controlled stop'
    ]) {
        if (!source.includes(fragment)) return 'hostinger_runbook_contract_mismatch';
    }
    if (occurrences(source, ALLOWLIST_PLACEHOLDER) !== 1
        || occurrences(source, '--check-live-dynamic-source "$live_dynamic_source" || exit 1') !== 1
        || source.includes('__J2_SOURCE_RANGES__') || source.includes('Phase `expanded`')) {
        return 'hostinger_runbook_contract_mismatch';
    }
    if (occurrences(source, '--rm --pull never --network none --read-only --cap-drop ALL') !== 3
        || occurrences(source, '--security-opt no-new-privileges') !== 5
        || occurrences(source, '--pids-limit 16') !== 4
        || occurrences(source, '--memory 64m') !== 4
        || occurrences(source, '--entrypoint /usr/bin/id "$candidate_image" -u') !== 1
        || occurrences(source, '--entrypoint /usr/bin/id "$candidate_image" -g') !== 1) {
        return 'hostinger_runbook_identity_lookup_mismatch';
    }
    if (occurrences(source, 'scripts/i12-capacity-artifact-cleanup.js') !== 3
        || occurrences(source, '/run/i12-cleanup.json') !== 3
        || occurrences(source, '/run/i12-capacity-artifact-cleanup.js') !== 4
        || occurrences(source, '--expected-max-concurrent') !== 1
        || occurrences(source, '--cleanup-manifest') !== 1
        || occurrences(source, '--report') !== 1
        || occurrences(source, 'scripts/i12-capacity-producer-exec.py') !== 2
        || occurrences(source, '--user "$resolved_slicer_uid:$resolved_slicer_gid"') !== 1) {
        return 'hostinger_cleanup_consumer_contract_mismatch';
    }
    const capacityProducerInvocation = [
        '/usr/bin/env -i \\',
        '  /usr/bin/python3 "$verified_checkout/scripts/i12-capacity-producer-exec.py" \\',
        '  --service-uid "$resolved_slicer_uid" \\',
        '  --service-gid "$resolved_slicer_gid" \\',
        '  --slicer-base-url-file "$slicer_base_url_file" \\',
        '  --slice-service-api-key-file "$slice_service_api_key_file" \\',
        '  --operations-api-key-file "$operations_api_key_file" \\',
        '  --artifact-api-key-file "$artifact_api_key_file" \\',
        '  --count 3 \\'
    ].join('\n');
    if (occurrences(source, capacityProducerInvocation) !== 1
        || occurrences(source, '/usr/bin/env -i \\') !== 1
        || occurrences(source, '  /usr/bin/python3 "$verified_checkout/scripts/i12-capacity-producer-exec.py" \\') !== 1
        || /(?:SLICER_BASE_URL|SLICE_SERVICE_API_KEY|OPERATIONS_API_KEY|ARTIFACT_API_KEY)="\$/.test(source)) {
        return 'hostinger_capacity_producer_environment_mismatch';
    }
    const productionComposeCommands = normalize(source).split('\n').filter(
        (line) => line.includes('docker compose') && line.includes('docker-compose.production.yml')
    );
    if (productionComposeCommands.length !== 6
        || productionComposeCommands.some((line) => !line.includes(PRODUCTION_COMPOSE_PREFIX))) {
        return 'hostinger_compose_project_name_mismatch';
    }
    if (occurrences(
        source,
        'SLICER_API_IMAGE="$candidate_image" docker compose -p slicer-api --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api'
    ) !== 2) return 'hostinger_api_restart_contract_mismatch';
    if (occurrences(source, 'qualification_exit=0') !== 1
        || occurrences(source, '|| qualification_exit=$?') !== 1
        || occurrences(source, 'cleanup_exit=0') !== 1
        || occurrences(source, '|| cleanup_exit=$?') !== 1
        || occurrences(source, '[ "$qualification_exit" -eq 0 ] || exit 1') !== 1
        || occurrences(source, '[ "$cleanup_exit" -eq 0 ] || exit 1') !== 1) {
        return 'hostinger_capacity_exit_gate_mismatch';
    }
    const capacityOrder = [
        'qualification_exit=0',
        'postflight queue idle',
        'docker compose -p slicer-api --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api',
        '[ "$api_stop_state" = "exited false 0 false" ] || exit 1',
        'docker run --rm --pull never --network none --read-only \\\n  --user "$resolved_slicer_uid:$resolved_slicer_gid"'
    ].map((fragment) => source.indexOf(fragment));
    if (capacityOrder.some((index) => index < 0)
        || capacityOrder.some((index, position) => position > 0 && index <= capacityOrder[position - 1])) {
        return 'hostinger_capacity_cleanup_order_mismatch';
    }
    const proxyOrder = [
        'node scripts/i12-hostinger-operator-contract.js --check-compose-version "$compose_version" || exit 1',
        'docker compose -f ops/hostinger/docker-compose.traefik.yml config --quiet || exit 1',
        'Before starting the\ncandidate, inventory the owners of both host ports 80 and 443',
        'Prove that both old listeners are closed before creating or\nstarting the candidate',
        'docker compose --env-file "$operator_values_file" -f ops/hostinger/docker-compose.traefik.yml up --detach --no-deps --pull never traefik',
        'Prove candidate identity, health, redirect,\nprovider set, the exact two network attachments',
        'effective `RW=false`', '`Mode=""` or `Mode="ro"`',
        'ACME volume\nstrictly `RW=true` and `Mode="rw"`'
    ].map((fragment) => source.indexOf(fragment));
    if (proxyOrder.some((index) => index < 0)
        || proxyOrder.some((index, position) => position > 0 && index <= proxyOrder[position - 1])) {
        return 'hostinger_proxy_cutover_order_mismatch';
    }
    const composeIdentityOrder = [
        'SLICER_API_IMAGE="$candidate_image" node scripts/i7-production-compose-contract.js || exit 1',
        '[ "$rendered_api_image" = "$candidate_image" ] || exit 1',
        'SLICER_API_IMAGE="$candidate_image" docker compose -p slicer-api --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api'
    ].map((fragment) => source.indexOf(fragment));
    if (composeIdentityOrder.some((index) => index < 0)
        || composeIdentityOrder.some((index, position) => position > 0
            && index <= composeIdentityOrder[position - 1])) {
        return 'hostinger_compose_identity_order_mismatch';
    }
    const cleanupIndex = source.indexOf(
        'docker run --rm --pull never --network none --read-only \\\n  --user "$resolved_slicer_uid:$resolved_slicer_gid"'
    );
    const restartIndex = source.lastIndexOf(
        'SLICER_API_IMAGE="$candidate_image" docker compose -p slicer-api --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api'
    );
    const restartedIdentityIndex = source.indexOf('api_runtime_identity="$(docker inspect --format');
    const traefikSectionIndex = source.indexOf('## 3. Start Traefik with routing still disabled');
    if (cleanupIndex < 0 || restartIndex <= cleanupIndex
        || restartedIdentityIndex <= restartIndex || traefikSectionIndex <= restartedIdentityIndex) {
        return 'hostinger_api_restart_order_mismatch';
    }
    const capacityAcceptanceOrder = [
        'qualification_exit=0',
        '|| qualification_exit=$?',
        'cleanup_exit=0',
        '|| cleanup_exit=$?',
        '[ "$api_runtime_identity" = "$candidate_image $candidate_image_id running true 0 false" ] || exit 1',
        'repeat the full dark readiness, negative-authentication,\nAPI/native egress-denial and private-peer matrix twice',
        '[ "$qualification_exit" -eq 0 ] || exit 1',
        '[ "$cleanup_exit" -eq 0 ] || exit 1',
        '## 3. Start Traefik with routing still disabled'
    ].map((fragment) => source.indexOf(fragment));
    if (capacityAcceptanceOrder.some((index) => index < 0)
        || capacityAcceptanceOrder.some((index, position) => position > 0
            && index <= capacityAcceptanceOrder[position - 1])) {
        return 'hostinger_capacity_acceptance_order_mismatch';
    }
    const routerMutationOrder = [
        '--render-router <create-new-temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--active-router <temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--activate-router <temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        'Confirm the loaded file hash',
        '--disable-router <create-new-retained-path> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--recover-router-dark <known-staging-source> --source-kind staging --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--recover-router-dark <known-rollback-source> --source-kind rollback --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1',
        '--assert-router-dark <second-known-rollback-source> --source-kind rollback --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1'
    ].map((fragment) => source.indexOf(fragment));
    if (routerMutationOrder.some((index) => index < 0)
        || routerMutationOrder.some((index, position) => position > 0
            && index <= routerMutationOrder[position - 1])) {
        return 'hostinger_router_mutation_order_mismatch';
    }
    const forbiddenDigestArgument = ['--sha', '256'].join('');
    if (source.includes(forbiddenDigestArgument)) {
        return 'hostinger_router_digest_privacy_mismatch';
    }
    const runbookWithoutCapacityProducer = source.replace(capacityProducerInvocation, '');
    if (/docker\s+compose(?:\s+--?[^\s]+\s+\S+)*\s+down|docker\s+(?:system|image|container|network|volume)\s+prune|docker\s+volume\s+(?:rm|create)|(?:rm|truncate)\s+[^\n]*acme\.json|^\s*(?:sudo\s+)?rm\s+-(?:rf|fr)\b|chmod\s+0?777|--network[= ]host/im.test(source)
        || /(?:SLICER_UID|SLICER_GID)\s*=\s*(?:999|1000)/i.test(source)
        || /(?:password|token|api[_-]?key|secret)\s*[:=]\s*\S{8,}/i.test(runbookWithoutCapacityProducer)) {
        return 'hostinger_runbook_forbidden_operation';
    }
    return null;
}

function validateCapacityProducerSource(source) {
    if (!safeSource(source)) return 'hostinger_capacity_producer_source_malformed';
    const environmentBlock = [
        'ENVIRONMENT_NAMES = (',
        '    "SLICER_BASE_URL",',
        '    "SLICE_SERVICE_API_KEY",',
        '    "OPERATIONS_API_KEY",',
        '    "ARTIFACT_API_KEY",',
        ')'
    ].join('\n');
    for (const fragment of [
        '#!/usr/bin/python3', 'PYTHON_EXECUTABLE = "/usr/bin/python3"',
        environmentBlock, '("O_RDONLY", "O_CLOEXEC", "O_NOFOLLOW")',
        'runtime.path.realpath(path_value) != path_value',
        'metadata.st_uid != 0 or metadata.st_gid != 0',
        'stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1',
        'metadata.st_size < minimum_bytes or metadata.st_size > maximum_bytes',
        'len(content) > maximum_bytes', 'len(content) != after_fd.st_size',
        'all(0x20 <= byte <= 0x7E for byte in content)',
        'runtime.geteuid() != 0', 'prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)',
        'runtime.setgroups([])',
        'runtime.setresgid(plan.service_gid, plan.service_gid, plan.service_gid)',
        'runtime.setresuid(plan.service_uid, plan.service_uid, plan.service_uid)',
        'runtime.getresgid() != (plan.service_gid,) * 3',
        'runtime.getresuid() != (plan.service_uid,) * 3',
        'or any(value in argument for value in plan.environment.values() for argument in plan.argv)',
        'runtime.execve(PYTHON_EXECUTABLE, list(plan.argv), dict(plan.environment))',
        'os.write(2, b"capacity_producer_exec=FAIL\\n")'
    ]) {
        if (!source.includes(fragment)) return 'hostinger_capacity_producer_contract_mismatch';
    }
    const runnerArgv = source.slice(source.indexOf('    runner_argv = ('), source.indexOf('    return LaunchPlan('));
    if (!runnerArgv || /environment|credential|API_KEY|BASE_URL/.test(runnerArgv)
        || /\bos\.environ\b|\bsubprocess\b|shell\s*=|\bexecvp(?:e)?\b|\bprint\s*\(|\blogging\b|\btraceback\b/.test(source)
        || occurrences(source, 'runtime.execve(PYTHON_EXECUTABLE, list(plan.argv), dict(plan.environment))') !== 1
        || occurrences(source, 'os.write(2, b"capacity_producer_exec=FAIL\\n")') !== 1) {
        return 'hostinger_capacity_producer_scope_mismatch';
    }
    return null;
}

function containedPath(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function withinPathBoundary(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    return resolvedCandidate === resolvedRoot || containedPath(resolvedRoot, resolvedCandidate);
}

function repositoryRootForPack(packRoot) {
    const resolvedPackRoot = path.resolve(packRoot);
    const repositoryRoot = path.resolve(resolvedPackRoot, '..', '..');
    return path.resolve(repositoryRoot, 'ops', 'hostinger') === resolvedPackRoot
        ? repositoryRoot : null;
}

function gitPath(repositoryRoot, target) {
    return path.relative(repositoryRoot, target).split(path.sep).join('/');
}

function runGit(repositoryRoot, args) {
    return spawnSync('git', ['-C', repositoryRoot, ...args], {
        encoding: 'utf8', timeout: 10_000, windowsHide: true,
        maxBuffer: 64 * 1024
    });
}

function protectedDirectoryMetadata(stat) {
    return Boolean(stat && typeof stat.isDirectory === 'function' && stat.isDirectory()
        && (typeof stat.isSymbolicLink !== 'function' || !stat.isSymbolicLink())
        && stat.uid === 0 && stat.gid === 0 && (stat.mode & 0o022) === 0
        && Number.isSafeInteger(stat.dev) && Number.isSafeInteger(stat.ino));
}

function inspectProtectedDirectoryChain(target, runtimeFs = fs) {
    if (typeof target !== 'string' || !path.isAbsolute(target)
        || path.resolve(target) !== target) {
        return Object.freeze({ error: 'router_protected_ancestor_argument_invalid' });
    }
    const states = [];
    try {
        let current = target;
        for (;;) {
            const stat = runtimeFs.lstatSync(current);
            if (!protectedDirectoryMetadata(stat)
                || runtimeFs.realpathSync(current) !== current) {
                return Object.freeze({ error: 'router_protected_ancestor_unsafe' });
            }
            states.push(Object.freeze({
                path: current, dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid,
                mode: stat.mode & 0o777, nlink: stat.nlink
            }));
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
        return Object.freeze({ error: null, states: Object.freeze(states) });
    } catch {
        return Object.freeze({ error: 'router_protected_ancestor_unavailable' });
    }
}

function sameProtectedDirectoryChain(left, right) {
    return Boolean(left && right && !left.error && !right.error
        && exactArray(left.states, right.states));
}

function inspectRouterSecurityBoundary(packRoot, allowlistFile, runtimeFs = fs) {
    const root = path.resolve(packRoot);
    if (typeof allowlistFile !== 'string' || !path.isAbsolute(allowlistFile)
        || path.resolve(allowlistFile) !== allowlistFile) {
        return Object.freeze({ error: 'router_security_boundary_argument_invalid' });
    }
    const runtimeRoot = path.join(root, PRIVATE_RUNTIME_DIRECTORY);
    const targets = [...new Set([
        root,
        runtimeRoot,
        path.join(runtimeRoot, PRIVATE_STAGING_DIRECTORY),
        path.join(runtimeRoot, PRIVATE_ROLLBACK_DIRECTORY),
        path.join(root, 'dynamic'),
        path.dirname(allowlistFile)
    ])].sort();
    const chains = [];
    for (const target of targets) {
        const chain = inspectProtectedDirectoryChain(target, runtimeFs);
        if (chain.error) return Object.freeze({ error: chain.error });
        chains.push(Object.freeze({ target, states: chain.states }));
    }
    return Object.freeze({ error: null, chains: Object.freeze(chains) });
}

function sameRouterSecurityBoundary(left, right) {
    return Boolean(left && right && !left.error && !right.error
        && exactArray(left.chains, right.chains));
}

function verifyRouterRehearsalLock(packRoot = PACK_ROOT, options = {}) {
    const platform = options.platform || process.platform;
    const runtimeFs = options.fs || fs;
    const spawn = options.spawn || spawnSync;
    const descriptor = options.fd === undefined ? REHEARSAL_LOCK_FD : options.fd;
    if (platform !== 'linux' || descriptor !== REHEARSAL_LOCK_FD) {
        return Object.freeze({ error: 'router_rehearsal_lock_unavailable' });
    }
    const root = path.resolve(packRoot);
    const runtimeRoot = path.join(root, PRIVATE_RUNTIME_DIRECTORY);
    const lockPath = path.join(runtimeRoot, REHEARSAL_LOCK_NAME);
    try {
        const chainBefore = inspectProtectedDirectoryChain(runtimeRoot, runtimeFs);
        const pathBefore = runtimeFs.lstatSync(lockPath);
        const descriptorBefore = runtimeFs.fstatSync(descriptor);
        if (chainBefore.error
            || !secureRootPrivateFileMetadata(pathBefore, 0, 0)
            || !sameSecureRootPrivateFileState(pathBefore, descriptorBefore, 0, 0)
            || runtimeFs.realpathSync(lockPath) !== lockPath) {
            return Object.freeze({ error: 'router_rehearsal_lock_unsafe' });
        }
        const inheritedStdio = Array.from(
            { length: REHEARSAL_LOCK_FD + 1 }, () => 'ignore'
        );
        inheritedStdio[REHEARSAL_LOCK_FD] = REHEARSAL_LOCK_FD;
        const sameDescription = spawn('/usr/bin/flock', [
            '--nonblock', '--exclusive', '--conflict-exit-code',
            String(FLOCK_CONFLICT_EXIT_CODE), String(REHEARSAL_LOCK_FD)
        ], {
            encoding: 'utf8', timeout: 5_000, windowsHide: true, stdio: inheritedStdio
        });
        const contender = spawn('/usr/bin/flock', [
            '--nonblock', '--exclusive', '--conflict-exit-code',
            String(FLOCK_CONFLICT_EXIT_CODE), lockPath, '/usr/bin/true'
        ], {
            encoding: 'utf8', timeout: 5_000, windowsHide: true
        });
        if (sameDescription.status !== 0 || sameDescription.error
            || contender.status !== FLOCK_CONFLICT_EXIT_CODE || contender.error
            || sameDescription.stdout || sameDescription.stderr
            || contender.stdout || contender.stderr) {
            return Object.freeze({ error: 'router_rehearsal_lock_not_held' });
        }
        const chainAfter = inspectProtectedDirectoryChain(runtimeRoot, runtimeFs);
        const pathAfter = runtimeFs.lstatSync(lockPath);
        const descriptorAfter = runtimeFs.fstatSync(descriptor);
        if (!sameProtectedDirectoryChain(chainBefore, chainAfter)
            || !sameSecureRootPrivateFileState(pathBefore, pathAfter, 0, 0)
            || !sameSecureRootPrivateFileState(pathBefore, descriptorAfter, 0, 0)
            || runtimeFs.realpathSync(lockPath) !== lockPath) {
            return Object.freeze({ error: 'router_rehearsal_lock_changed' });
        }
        return Object.freeze({ error: null, lockPath });
    } catch {
        return Object.freeze({ error: 'router_rehearsal_lock_unavailable' });
    }
}

function gitIgnoreWinners(repositoryRoot, expectations) {
    const unique = new Map();
    for (const { target, pattern } of expectations) {
        const relative = gitPath(repositoryRoot, target);
        if (unique.has(relative) && unique.get(relative) !== pattern) return false;
        unique.set(relative, pattern);
    }
    const entries = [...unique].map(([relative, pattern]) => ({ relative, pattern }));
    const result = runGit(repositoryRoot, [
        'check-ignore', '-v', '--no-index', '--', ...entries.map(({ relative }) => relative)
    ]);
    if (result.status !== 0 || result.stderr || typeof result.stdout !== 'string') return false;
    const observed = new Map();
    for (const output of result.stdout.trimEnd().split('\n')) {
        const tab = output.lastIndexOf('\t');
        if (tab <= 0) return false;
        const relative = output.slice(tab + 1);
        const metadata = output.slice(0, tab);
        const match = metadata.match(/^(.*):(\d+):(.*)$/);
        if (!match || match[1] !== '.gitignore' || observed.has(relative)) return false;
        observed.set(relative, match[3]);
    }
    return observed.size === entries.length
        && entries.every(({ relative, pattern }) => observed.get(relative) === pattern);
}

function validateRepositoryPrivateStorageContract(packRoot = PACK_ROOT, privateTarget = null) {
    const resolvedPackRoot = path.resolve(packRoot);
    const repositoryRoot = repositoryRootForPack(resolvedPackRoot);
    if (!repositoryRoot) return 'router_repository_layout_invalid';
    try {
        const repositoryResult = runGit(repositoryRoot, ['rev-parse', '--show-toplevel']);
        if (repositoryResult.status !== 0 || repositoryResult.stderr
            || path.resolve(repositoryResult.stdout.trim()) !== repositoryRoot) {
            return 'router_repository_identity_invalid';
        }
        const ignoreFile = path.join(repositoryRoot, '.gitignore');
        const ignoreStat = fs.lstatSync(ignoreFile);
        if (!ignoreStat.isFile() || ignoreStat.isSymbolicLink()
            || !Number.isSafeInteger(ignoreStat.size) || ignoreStat.size < 1
            || ignoreStat.size > MAX_FILE_BYTES || fs.realpathSync(ignoreFile) !== ignoreFile) {
            return 'router_gitignore_contract_invalid';
        }
        const ignoreSource = fs.readFileSync(ignoreFile, 'utf8');
        if (exactLineCount(ignoreSource, PRIVATE_RUNTIME_IGNORE_PATTERN) !== 1
            || exactLineCount(ignoreSource, ACTIVE_ROUTER_IGNORE_PATTERN) !== 1
        ) {
            return 'router_gitignore_contract_invalid';
        }
        const runtimeRoot = path.join(resolvedPackRoot, PRIVATE_RUNTIME_DIRECTORY);
        const stagingProbe = path.join(
            runtimeRoot, PRIVATE_STAGING_DIRECTORY, 'slicer-api-contract.yml.tmp'
        );
        const rollbackProbe = path.join(
            runtimeRoot, PRIVATE_ROLLBACK_DIRECTORY, 'slicer-api-contract.yml.disabled'
        );
        const dynamicRoot = path.join(resolvedPackRoot, 'dynamic');
        const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
        const sentinel = path.join(dynamicRoot, DARK_DYNAMIC_ENTRY);
        const ignoreExpectations = [
            { target: stagingProbe, pattern: PRIVATE_RUNTIME_IGNORE_PATTERN },
            { target: rollbackProbe, pattern: PRIVATE_RUNTIME_IGNORE_PATTERN },
            { target: live, pattern: ACTIVE_ROUTER_IGNORE_PATTERN }
        ];
        if (privateTarget) ignoreExpectations.push({
            target: privateTarget, pattern: PRIVATE_RUNTIME_IGNORE_PATTERN
        });
        if (!gitIgnoreWinners(repositoryRoot, ignoreExpectations)) {
            return 'router_gitignore_contract_invalid';
        }
        const protectedGitPaths = [
            gitPath(repositoryRoot, ignoreFile), gitPath(repositoryRoot, sentinel),
            gitPath(repositoryRoot, runtimeRoot), gitPath(repositoryRoot, live)
        ];
        const indexTracked = runGit(repositoryRoot, [
            'ls-files', '--cached', '--', ...protectedGitPaths
        ]);
        const headTracked = runGit(repositoryRoot, [
            'ls-tree', '-r', '--name-only', 'HEAD', '--', ...protectedGitPaths
        ]);
        const indexPaths = indexTracked.status === 0 && !indexTracked.stderr
            ? indexTracked.stdout.trim().split('\n').filter(Boolean).sort() : [];
        const headPaths = headTracked.status === 0 && !headTracked.stderr
            ? headTracked.stdout.trim().split('\n').filter(Boolean).sort() : [];
        const expectedTracked = [
            gitPath(repositoryRoot, ignoreFile), gitPath(repositoryRoot, sentinel)
        ].sort();
        if (!exactArray(indexPaths, expectedTracked)
            || !exactArray(headPaths, expectedTracked)) {
            return 'router_private_storage_tracking_invalid';
        }
        return null;
    } catch {
        return 'router_repository_contract_unavailable';
    }
}

function privateStoragePath(packRoot, kind) {
    const child = kind === 'staging' ? PRIVATE_STAGING_DIRECTORY
        : kind === 'rollback' ? PRIVATE_ROLLBACK_DIRECTORY : null;
    return child ? path.join(path.resolve(packRoot), PRIVATE_RUNTIME_DIRECTORY, child) : null;
}

function inspectPrivateRouterStorageDirectories(root, parent) {
    const runtimeRoot = path.join(root, PRIVATE_RUNTIME_DIRECTORY);
    const stagingRoot = path.join(runtimeRoot, PRIVATE_STAGING_DIRECTORY);
    const rollbackRoot = path.join(runtimeRoot, PRIVATE_ROLLBACK_DIRECTORY);
    const dynamicRoot = path.join(root, 'dynamic');
    try {
        const packStat = fs.lstatSync(root);
        const runtimeStat = fs.lstatSync(runtimeRoot);
        const stagingStat = fs.lstatSync(stagingRoot);
        const rollbackStat = fs.lstatSync(rollbackRoot);
        const dynamicStat = fs.lstatSync(dynamicRoot);
        const parentStat = parent === stagingRoot ? stagingStat : rollbackStat;
        if (!packStat.isDirectory() || packStat.isSymbolicLink()
            || !secureRouterDirectoryMetadata(runtimeStat, ROOT_ROUTER_METADATA_POLICY)
            || !secureRouterDirectoryMetadata(stagingStat, ROOT_ROUTER_METADATA_POLICY)
            || !secureRouterDirectoryMetadata(rollbackStat, ROOT_ROUTER_METADATA_POLICY)
            || !secureRouterDirectoryMetadata(dynamicStat, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(root) !== root
            || fs.realpathSync(runtimeRoot) !== runtimeRoot
            || fs.realpathSync(stagingRoot) !== stagingRoot
            || fs.realpathSync(rollbackRoot) !== rollbackRoot
            || fs.realpathSync(dynamicRoot) !== dynamicRoot
            || runtimeStat.dev !== stagingStat.dev || stagingStat.dev !== rollbackStat.dev
            || rollbackStat.dev !== dynamicStat.dev) {
            return Object.freeze({ error: 'router_private_storage_metadata_unsafe' });
        }
        return Object.freeze({
            error: null, packStat, runtimeRoot, runtimeStat, stagingStat, rollbackStat,
            parentStat, dynamicStat
        });
    } catch {
        return Object.freeze({ error: 'router_private_storage_unavailable' });
    }
}

function inspectPrivateRouterStorageTarget(target, kind, packRoot = PACK_ROOT) {
    const root = path.resolve(packRoot);
    if (typeof target !== 'string' || !path.isAbsolute(target)
        || Buffer.byteLength(target, 'utf8') > MAX_PRIVATE_INPUT_PATH_BYTES
        || /[\0\r\n\t]/.test(target) || RAW_IPV4_PATH_PATTERN.test(target)) {
        return Object.freeze({ error: 'router_private_storage_path_invalid' });
    }
    const resolved = path.resolve(target);
    let resolvedKind = kind;
    if (kind === 'activation-source') {
        const stagingParent = privateStoragePath(root, 'staging');
        const rollbackParent = privateStoragePath(root, 'rollback');
        if (path.dirname(resolved) === stagingParent
            && PRIVATE_STAGING_FILE_PATTERN.test(path.basename(resolved))) {
            resolvedKind = 'staging';
        } else if (path.dirname(resolved) === rollbackParent
            && PRIVATE_ROLLBACK_FILE_PATTERN.test(path.basename(resolved))) {
            resolvedKind = 'rollback';
        } else {
            return Object.freeze({ error: 'router_private_storage_path_invalid' });
        }
    }
    const parent = privateStoragePath(root, resolvedKind);
    const filePattern = resolvedKind === 'staging' ? PRIVATE_STAGING_FILE_PATTERN
        : resolvedKind === 'rollback' ? PRIVATE_ROLLBACK_FILE_PATTERN : null;
    if (!parent || !filePattern) {
        return Object.freeze({ error: 'router_private_storage_path_invalid' });
    }
    if (resolved !== target || path.dirname(resolved) !== parent
        || !filePattern.test(path.basename(resolved))) {
        return Object.freeze({ error: 'router_private_storage_path_invalid' });
    }
    const before = inspectPrivateRouterStorageDirectories(root, parent);
    if (before.error) return before;
    const repositoryError = validateRepositoryPrivateStorageContract(root, resolved);
    const after = inspectPrivateRouterStorageDirectories(root, parent);
    if (after.error) return after;
    if (!sameSecureRouterDirectoryState(before.packStat, after.packStat, null)
        || !sameSecureRouterDirectoryState(
            before.runtimeStat, after.runtimeStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterDirectoryState(
            before.stagingStat, after.stagingStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterDirectoryState(
            before.rollbackStat, after.rollbackStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterDirectoryState(
            before.dynamicStat, after.dynamicStat, ROOT_ROUTER_METADATA_POLICY
        )) {
        return Object.freeze({ error: 'router_private_storage_metadata_unsafe' });
    }
    if (repositoryError) return Object.freeze({ error: repositoryError });
    return Object.freeze({
        error: null, kind: resolvedKind, resolved, parent,
        runtimeRoot: after.runtimeRoot, runtimeStat: after.runtimeStat,
        parentStat: after.parentStat, dynamicStat: after.dynamicStat
    });
}

function readBoundedRegular(target, root = PACK_ROOT) {
    const resolved = path.resolve(target);
    if (!containedPath(root, resolved)) throw new Error('operator_path_outside_boundary');
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_FILE_BYTES
        || fs.realpathSync(resolved) !== resolved) throw new Error('operator_file_invalid');
    return fs.readFileSync(resolved, 'utf8');
}

function secureRootPrivateFileMetadata(stat, minimumBytes, maximumBytes, expectedLinks = 1) {
    return Boolean(stat && typeof stat.isFile === 'function' && stat.isFile()
        && (typeof stat.isSymbolicLink !== 'function' || !stat.isSymbolicLink())
        && stat.uid === 0 && stat.gid === 0 && (stat.mode & 0o777) === 0o600
        && stat.nlink === expectedLinks && Number.isSafeInteger(stat.size)
        && stat.size >= minimumBytes && stat.size <= maximumBytes);
}

function sameSecureRootPrivateFileState(left, right, minimumBytes, maximumBytes, expectedLinks = 1) {
    return sameFileIdentity(left, right)
        && secureRootPrivateFileMetadata(right, minimumBytes, maximumBytes, expectedLinks)
        && left.uid === right.uid && left.gid === right.gid
        && (left.mode & 0o777) === (right.mode & 0o777)
        && left.nlink === right.nlink && left.size === right.size;
}

function readPrivateAllowlistFile(target, phase, options = {}) {
    const platform = options.platform || process.platform;
    const runtimeFs = options.fs || fs;
    if (platform !== 'linux' || typeof target !== 'string' || !path.isAbsolute(target)
        || path.resolve(target) !== target
        || Buffer.byteLength(target, 'utf8') > MAX_PRIVATE_INPUT_PATH_BYTES
        || /[\0\r\n\t]/.test(target)
        || !PRIVATE_INPUT_BASENAME_PATTERN.test(path.basename(target))
        || RAW_IPV4_PATH_PATTERN.test(target)) {
        return Object.freeze({ error: 'j2_allowlist_file_argument_invalid', cidrs: null });
    }
    if (withinPathBoundary(ROOT, target)) {
        return Object.freeze({ error: 'j2_allowlist_file_inside_repository', cidrs: null });
    }
    let descriptor;
    try {
        const before = runtimeFs.lstatSync(target);
        const beforeRealpath = runtimeFs.realpathSync(target);
        if (!secureRootPrivateFileMetadata(before, 8, MAX_ALLOWLIST_FILE_BYTES)
            || beforeRealpath !== target || withinPathBoundary(ROOT, beforeRealpath)) {
            return Object.freeze({ error: 'j2_allowlist_file_unsafe', cidrs: null });
        }
        descriptor = runtimeFs.openSync(
            target, runtimeFs.constants.O_RDONLY | runtimeFs.constants.O_NOFOLLOW
        );
        const opened = runtimeFs.fstatSync(descriptor);
        if (!sameSecureRootPrivateFileState(before, opened, 8, MAX_ALLOWLIST_FILE_BYTES)) {
            return Object.freeze({ error: 'j2_allowlist_file_changed', cidrs: null });
        }
        const bytes = runtimeFs.readFileSync(descriptor);
        const after = runtimeFs.fstatSync(descriptor);
        if (!sameSecureRootPrivateFileState(before, after, 8, MAX_ALLOWLIST_FILE_BYTES)
            || bytes.length !== before.size) {
            return Object.freeze({ error: 'j2_allowlist_file_changed', cidrs: null });
        }
        let current;
        try { current = runtimeFs.lstatSync(target); } catch {
            return Object.freeze({ error: 'j2_allowlist_file_changed', cidrs: null });
        }
        const currentRealpath = runtimeFs.realpathSync(target);
        if (!sameSecureRootPrivateFileState(before, current, 8, MAX_ALLOWLIST_FILE_BYTES)
            || currentRealpath !== target || withinPathBoundary(ROOT, currentRealpath)) {
            return Object.freeze({ error: 'j2_allowlist_file_changed', cidrs: null });
        }
        return parsePrivateAllowlist(bytes.toString('utf8'), phase);
    } catch {
        return Object.freeze({ error: 'j2_allowlist_file_unavailable', cidrs: null });
    } finally {
        if (descriptor !== undefined) {
            try { runtimeFs.closeSync(descriptor); } catch { /* read result is already fixed */ }
        }
    }
}

function removeExactRenderedTarget(target, identity, fsync) {
    try {
        const current = fs.lstatSync(target);
        if (!sameFileIdentity(identity, current) || !current.isFile() || current.isSymbolicLink()) return false;
        fs.unlinkSync(target);
        fsync(path.dirname(target));
        return pathEntryAbsent(target);
    } catch {
        return false;
    }
}

function renderRouterFile(target, hostname, allowlistFile, phase, options = {}) {
    const platform = options.platform || process.platform;
    const packRoot = path.resolve(options.packRoot || PACK_ROOT);
    const fsync = options.fsync || fsyncPath;
    if (platform !== 'linux') return Object.freeze({ error: 'router_mutation_platform_unsupported' });
    const storage = inspectPrivateRouterStorageTarget(target, 'staging', packRoot);
    if (storage.error) return Object.freeze({ error: storage.error });
    const allowlist = readPrivateAllowlistFile(allowlistFile, phase, { platform });
    if (allowlist.error) return Object.freeze({ error: allowlist.error });
    const { resolved, parent, parentStat, runtimeRoot, runtimeStat, dynamicStat } = storage;
    if (!pathEntryAbsent(resolved)) {
        return Object.freeze({ error: 'router_render_target_invalid' });
    }
    let template;
    try {
        template = options.templateSource || readBoundedRegular(
            path.join(packRoot, FILES.routerTemplate), packRoot
        );
    } catch {
        return Object.freeze({ error: 'router_render_template_unavailable' });
    }
    const rendered = renderRouterSource(template, hostname, allowlist.cidrs);
    if (rendered.error) return Object.freeze({ error: rendered.error });
    let descriptor;
    let identity;
    try {
        descriptor = fs.openSync(
            resolved,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            0o600
        );
        identity = fs.fstatSync(descriptor);
        if (!secureRouterFileMetadata(identity, 1, ROOT_ROUTER_METADATA_POLICY, 0)
            || identity.dev !== parentStat.dev) {
            throw new Error('router_render_created_metadata_unsafe');
        }
        fs.writeFileSync(descriptor, rendered.source, { encoding: 'utf8' });
        fs.fsyncSync(descriptor);
        const writtenStat = fs.fstatSync(descriptor);
        if (!sameFileIdentity(identity, writtenStat)
            || !secureRouterFileMetadata(writtenStat, 1, ROOT_ROUTER_METADATA_POLICY)) {
            throw new Error('router_render_written_metadata_unsafe');
        }
        fs.closeSync(descriptor);
        descriptor = undefined;
        fsync(parent);
        const finalStat = fs.lstatSync(resolved);
        const finalParentStat = fs.lstatSync(parent);
        const finalRuntimeStat = fs.lstatSync(runtimeRoot);
        const finalDynamicStat = fs.lstatSync(path.join(packRoot, 'dynamic'));
        const digest = crypto.createHash('sha256').update(rendered.source, 'utf8').digest('hex');
        if (!sameFileIdentity(identity, finalStat)
            || !secureRouterFileMetadata(finalStat, 1, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(resolved) !== resolved
            || finalStat.dev !== parentStat.dev
            || !sameSecureRouterDirectoryState(
                parentStat, finalParentStat, ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterDirectoryState(
                runtimeStat, finalRuntimeStat, ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterDirectoryState(
                dynamicStat, finalDynamicStat, ROOT_ROUTER_METADATA_POLICY
            ) || fs.realpathSync(parent) !== parent
            || fs.realpathSync(runtimeRoot) !== runtimeRoot
            || validateActiveRouter(
                resolved, hostname, digest, packRoot, allowlist.cidrs, 'staging'
            )) {
            throw new Error('router_render_validation_failed');
        }
        return Object.freeze({ error: null, count: allowlist.cidrs.length, phase });
    } catch {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* fixed classification below */ }
        }
        if (!identity) return Object.freeze({ error: 'router_render_create_failed' });
        return Object.freeze({
            error: removeExactRenderedTarget(resolved, identity, fsync)
                ? 'router_render_failed_rolled_back' : 'router_render_rollback_uncertain'
        });
    }
}

function exactFileState(left, right) {
    return sameFileIdentity(left, right) && left.uid === right.uid && left.gid === right.gid
        && (left.mode & 0o777) === (right.mode & 0o777)
        && left.nlink === right.nlink && left.size === right.size;
}

function inspectDynamicDirectoryState(packRoot = PACK_ROOT, active = false, expectedLiveLinks = 1) {
    const dynamicRoot = path.resolve(packRoot, 'dynamic');
    try {
        const rootBefore = fs.lstatSync(dynamicRoot);
        if (!secureRouterDirectoryMetadata(rootBefore, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(dynamicRoot) !== dynamicRoot) {
            return Object.freeze({ error: 'traefik_dynamic_directory_unsafe' });
        }
        const entries = fs.readdirSync(dynamicRoot, { withFileTypes: true });
        const expectedNames = active
            ? [DARK_DYNAMIC_ENTRY, ACTIVE_ROUTER_NAME].sort() : [DARK_DYNAMIC_ENTRY];
        const actualNames = entries.map((entry) => entry.name).sort();
        if (!exactArray(actualNames, expectedNames)
            || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
            return Object.freeze({
                error: active ? 'traefik_active_router_set_invalid' : 'traefik_dark_router_residue'
            });
        }
        const sentinel = path.join(dynamicRoot, DARK_DYNAMIC_ENTRY);
        const sentinelBefore = fs.lstatSync(sentinel);
        if (!secureRouterFileMetadata(sentinelBefore, 1, ROOT_ROUTER_METADATA_POLICY)
            || sentinelBefore.size !== 1 || sentinelBefore.dev !== rootBefore.dev
            || fs.realpathSync(sentinel) !== sentinel
            || !fs.readFileSync(sentinel).equals(Buffer.from('\n'))) {
            return Object.freeze({ error: 'traefik_dynamic_sentinel_invalid' });
        }
        const sentinelAfter = fs.lstatSync(sentinel);
        const rootAfter = fs.lstatSync(dynamicRoot);
        if (!exactFileState(sentinelBefore, sentinelAfter)
            || !sameSecureRouterDirectoryState(
                rootBefore, rootAfter, ROOT_ROUTER_METADATA_POLICY
            ) || fs.realpathSync(sentinel) !== sentinel
            || fs.realpathSync(dynamicRoot) !== dynamicRoot) {
            return Object.freeze({ error: 'traefik_dynamic_state_changed' });
        }
        let liveStat = null;
        if (active) {
            const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
            liveStat = fs.lstatSync(live);
            if (!secureRouterFileMetadata(
                liveStat, expectedLiveLinks, ROOT_ROUTER_METADATA_POLICY
            )
                || liveStat.dev !== rootAfter.dev || fs.realpathSync(live) !== live) {
                return Object.freeze({ error: 'traefik_active_router_metadata_unsafe' });
            }
        }
        return Object.freeze({
            error: null, rootStat: rootAfter, sentinelStat: sentinelAfter, liveStat
        });
    } catch {
        return Object.freeze({ error: 'traefik_dynamic_directory_unavailable' });
    }
}

function validateRepositoryDarkDynamicDirectory(packRoot = PACK_ROOT) {
    const dynamicRoot = path.resolve(packRoot, 'dynamic');
    const sentinel = path.join(dynamicRoot, DARK_DYNAMIC_ENTRY);
    try {
        const rootBefore = fs.lstatSync(dynamicRoot);
        if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()
            || fs.realpathSync(dynamicRoot) !== dynamicRoot) {
            return 'traefik_dynamic_directory_unsafe';
        }
        const entries = fs.readdirSync(dynamicRoot, { withFileTypes: true });
        if (entries.length !== 1 || entries[0].name !== DARK_DYNAMIC_ENTRY
            || !entries[0].isFile() || entries[0].isSymbolicLink()) {
            return 'traefik_dark_router_residue';
        }
        const sentinelBefore = fs.lstatSync(sentinel);
        if (!sentinelBefore.isFile() || sentinelBefore.isSymbolicLink()
            || sentinelBefore.nlink !== 1 || sentinelBefore.size !== 1
            || sentinelBefore.dev !== rootBefore.dev || fs.realpathSync(sentinel) !== sentinel
            || !fs.readFileSync(sentinel).equals(Buffer.from('\n'))) {
            return 'traefik_dynamic_sentinel_invalid';
        }
        const sentinelAfter = fs.lstatSync(sentinel);
        const rootAfter = fs.lstatSync(dynamicRoot);
        if (!exactFileState(sentinelBefore, sentinelAfter)
            || !sameSecureRouterDirectoryState(rootBefore, rootAfter, null)
            || fs.realpathSync(sentinel) !== sentinel
            || fs.realpathSync(dynamicRoot) !== dynamicRoot) {
            return 'traefik_dynamic_state_changed';
        }
        return null;
    } catch {
        return 'traefik_dynamic_directory_unavailable';
    }
}

function sameDynamicBaseState(left, right) {
    return Boolean(left && right && !left.error && !right.error
        && sameSecureRouterDirectoryState(left.rootStat, right.rootStat, null)
        && exactFileState(left.sentinelStat, right.sentinelStat));
}

function sameActiveDynamicState(left, right, expectedLinks) {
    return sameDynamicBaseState(left, right)
        && sameSecureRouterFileState(left.liveStat, right.liveStat, expectedLinks, null);
}

function validateDarkDynamicDirectory(packRoot = PACK_ROOT) {
    return inspectDynamicDirectoryState(packRoot).error;
}

function loadOperatorSources() {
    for (const name of ['traefik.yml', 'traefik.yaml', 'traefik.toml']) {
        if (fs.existsSync(path.join(PACK_ROOT, name))) throw new Error('static_configuration_file_forbidden');
    }
    const sources = Object.fromEntries(Object.entries(FILES).map(([key, relative]) => [
        key, readBoundedRegular(path.join(PACK_ROOT, relative))
    ]));
    sources.capacityProducerExec = readBoundedRegular(path.join(ROOT, CAPACITY_PRODUCER_EXEC), ROOT);
    return sources;
}

function loadOperatorPack() {
    const dynamicError = validateRepositoryDarkDynamicDirectory(PACK_ROOT);
    if (dynamicError) throw new Error(dynamicError);
    const privateStorageError = validateRepositoryPrivateStorageContract(PACK_ROOT);
    if (privateStorageError) throw new Error(privateStorageError);
    return loadOperatorSources();
}

function validateOperatorPack(sources) {
    return validateComposeSource(sources.compose) || validateRouterSource(sources.routerTemplate)
        || validatePerimeterScriptSource(sources.perimeterScript)
        || validateAllowlistProbeSource(sources.allowlistProbe)
        || validatePerimeterServiceSource(sources.perimeterService)
        || validateRunbookSource(sources.runbook)
        || validateCapacityProducerSource(sources.capacityProducerExec);
}

function parseRouterArguments(args) {
    if (args.length < 6 || args.length % 2 !== 0) return null;
    const values = {};
    const actionKeys = [
        '--render-router', '--active-router', '--activate-router', '--disable-router',
        '--recover-router-dark', '--assert-router-dark'
    ];
    const allowedKeys = [...actionKeys, '--host', '--allowlist-file', '--phase', '--source-kind'];
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        if (!allowedKeys.includes(key) || values[key]) return null;
        values[key] = args[index + 1];
    }
    const actions = actionKeys.filter((key) => values[key]);
    if (actions.length !== 1 || !values['--host']) return null;
    const action = actions[0];
    const required = ['--recover-router-dark', '--assert-router-dark'].includes(action)
        ? [action, '--source-kind', '--host', '--allowlist-file', '--phase']
        : [action, '--host', '--allowlist-file', '--phase'];
    if (!exactArray(Object.keys(values).sort(), [...required].sort())
        || required.some((key) => !values[key])) return null;
    return { action, target: values[action], ...values };
}

function readSecureRouterFileIdentity(target, parentDev, allowedLinks) {
    let descriptor;
    try {
        const before = fs.lstatSync(target);
        if (!allowedLinks.includes(before.nlink)
            || !secureRouterFileMetadata(before, before.nlink, ROOT_ROUTER_METADATA_POLICY)
            || before.dev !== parentDev || fs.realpathSync(target) !== target) {
            return Object.freeze({ error: 'metadata' });
        }
        descriptor = fs.openSync(
            target,
            fs.constants.O_RDONLY
                | (fs.constants.O_NOFOLLOW || 0)
                | (fs.constants.O_CLOEXEC || 0)
        );
        const opened = fs.fstatSync(descriptor);
        if (!sameSecureRouterFileState(
            before, opened, before.nlink, ROOT_ROUTER_METADATA_POLICY
        )) return Object.freeze({ error: 'changed' });
        const bytes = fs.readFileSync(descriptor);
        const afterDescriptor = fs.fstatSync(descriptor);
        const afterPath = fs.lstatSync(target);
        if (bytes.length !== before.size || !sameSecureRouterFileState(
            before, afterDescriptor, before.nlink, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileState(
            before, afterPath, before.nlink, ROOT_ROUTER_METADATA_POLICY
        ) || fs.realpathSync(target) !== target) {
            return Object.freeze({ error: 'changed' });
        }
        return Object.freeze({
            bytes, error: null, source: bytes.toString('utf8'), stat: afterPath
        });
    } catch {
        return Object.freeze({ error: 'invalid' });
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* fixed read result is already bounded */ }
        }
    }
}

function inspectValidatedPrivateRouterSource(
    target, hostname, packRoot = PACK_ROOT, expectedCidrs = null,
    storageKind = 'activation-source', allowedLinks = [1]
) {
    if (!validHostname(hostname) || !Array.isArray(allowedLinks)
        || allowedLinks.length < 1 || allowedLinks.length > 2
        || allowedLinks.some((links) => ![1, 2].includes(links))
        || new Set(allowedLinks).size !== allowedLinks.length) {
        return Object.freeze({ error: 'active_router_argument_invalid' });
    }
    const storage = inspectPrivateRouterStorageTarget(target, storageKind, packRoot);
    if (storage.error) {
        if (storage.error === 'router_private_storage_path_invalid') {
            return Object.freeze({ error: 'active_router_path_invalid' });
        }
        if (['router_private_storage_metadata_unsafe', 'router_private_storage_unavailable']
            .includes(storage.error)) {
            return Object.freeze({ error: 'router_staging_metadata_unsafe' });
        }
        return Object.freeze({ error: storage.error });
    }
    const { resolved, parentStat } = storage;
    try {
        const read = readSecureRouterFileIdentity(resolved, parentStat.dev, allowedLinks);
        if (read.error === 'metadata') {
            return Object.freeze({ error: 'router_staging_metadata_unsafe' });
        }
        if (read.error === 'changed') {
            return Object.freeze({ error: 'active_router_file_changed' });
        }
        if (read.error) return Object.freeze({ error: 'active_router_file_invalid' });
        const finalStorage = inspectPrivateRouterStorageTarget(
            resolved, storage.kind, packRoot
        );
        const finalStat = fs.lstatSync(resolved);
        if (finalStorage.error || !sameSecureRouterFileState(
            read.stat, finalStat, read.stat.nlink, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterDirectoryState(
            storage.runtimeStat, finalStorage.runtimeStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterDirectoryState(
            storage.parentStat, finalStorage.parentStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterDirectoryState(
            storage.dynamicStat, finalStorage.dynamicStat, ROOT_ROUTER_METADATA_POLICY
        ) || fs.realpathSync(resolved) !== resolved) {
            return Object.freeze({ error: 'active_router_file_changed' });
        }
        const contractError = validateRouterSource(
            read.source, hostname, false, expectedCidrs
        );
        if (contractError) return Object.freeze({ error: contractError });
        return Object.freeze({
            error: null,
            digest: crypto.createHash('sha256').update(read.bytes).digest('hex'),
            links: read.stat.nlink,
            stat: read.stat,
            storage
        });
    } catch { return Object.freeze({ error: 'active_router_file_invalid' }); }
}

function validateActiveRouter(
    target, hostname, expectedHash, packRoot = PACK_ROOT, expectedCidrs = null,
    storageKind = 'activation-source', expectedLinks = 1
) {
    if (!/^[0-9a-f]{64}$/.test(expectedHash || '') || ![1, 2].includes(expectedLinks)) {
        return 'active_router_argument_invalid';
    }
    const inspected = inspectValidatedPrivateRouterSource(
        target, hostname, packRoot, expectedCidrs, storageKind, [expectedLinks]
    );
    if (inspected.error) return inspected.error;
    return inspected.digest === expectedHash ? null : 'active_router_hash_mismatch';
}

function inspectValidatedActiveDynamicDirectory(
    hostname, packRoot = PACK_ROOT, expectedCidrs = null, expectedLiveLinks = 1
) {
    if (!validHostname(hostname) || ![1, 2].includes(expectedLiveLinks)) {
        return Object.freeze({ error: 'active_router_argument_invalid' });
    }
    const dynamicRoot = path.resolve(packRoot, 'dynamic');
    const before = inspectDynamicDirectoryState(packRoot, true, expectedLiveLinks);
    if (before.error) return Object.freeze({ error: before.error });
    try {
        const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
        const read = readSecureRouterFileIdentity(
            live, before.rootStat.dev, [expectedLiveLinks]
        );
        if (read.error) {
            return Object.freeze({
                error: read.error === 'metadata'
                    ? 'traefik_active_router_metadata_unsafe'
                    : 'traefik_dynamic_state_changed'
            });
        }
        const after = inspectDynamicDirectoryState(packRoot, true, expectedLiveLinks);
        if (after.error) return Object.freeze({ error: after.error });
        if (!sameSecureRouterFileState(
            before.liveStat, read.stat, expectedLiveLinks, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileState(
            read.stat, after.liveStat, expectedLiveLinks, ROOT_ROUTER_METADATA_POLICY
        ) || !sameActiveDynamicState(before, after, expectedLiveLinks)) {
            return Object.freeze({ error: 'traefik_dynamic_state_changed' });
        }
        const sourceError = validateRouterSource(
            read.source, hostname, false, expectedCidrs
        );
        if (sourceError) return Object.freeze({ error: sourceError });
        return Object.freeze({
            error: null,
            digest: crypto.createHash('sha256').update(read.bytes).digest('hex'),
            state: after,
            stat: read.stat
        });
    } catch {
        return Object.freeze({ error: 'traefik_active_router_unavailable' });
    }
}

function validateActiveDynamicDirectory(
    hostname, expectedHash, packRoot = PACK_ROOT, expectedCidrs = null,
    expectedLiveLinks = 1
) {
    if (!/^[0-9a-f]{64}$/.test(expectedHash || '')) return 'active_router_argument_invalid';
    const inspected = inspectValidatedActiveDynamicDirectory(
        hostname, packRoot, expectedCidrs, expectedLiveLinks
    );
    if (inspected.error) return inspected.error;
    return inspected.digest === expectedHash ? null : 'active_router_hash_mismatch';
}

function sameFileIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}

function secureRouterDirectoryMetadata(stat, policy = ROOT_ROUTER_METADATA_POLICY) {
    return Boolean(stat && policy && typeof stat.isDirectory === 'function' && stat.isDirectory()
        && (typeof stat.isSymbolicLink !== 'function' || !stat.isSymbolicLink())
        && stat.uid === policy.parentUid && stat.gid === policy.parentGid
        && (stat.mode & 0o777) === policy.parentMode);
}

function sameSecureRouterDirectoryState(left, right, policy = ROOT_ROUTER_METADATA_POLICY) {
    const validRight = policy ? secureRouterDirectoryMetadata(right, policy)
        : right && right.isDirectory() && !right.isSymbolicLink();
    return sameFileIdentity(left, right) && validRight
        && left.uid === right.uid && left.gid === right.gid
        && (left.mode & 0o777) === (right.mode & 0o777)
        && left.nlink === right.nlink;
}

function secureRouterFileMetadata(
    stat, expectedLinks, policy = ROOT_ROUTER_METADATA_POLICY, minimumBytes = 1
) {
    return Boolean(stat && policy && typeof stat.isFile === 'function' && stat.isFile()
        && (typeof stat.isSymbolicLink !== 'function' || !stat.isSymbolicLink())
        && stat.uid === policy.fileUid && stat.gid === policy.fileGid
        && (stat.mode & 0o777) === policy.fileMode && stat.nlink === expectedLinks
        && Number.isSafeInteger(stat.size) && stat.size >= minimumBytes && stat.size <= MAX_FILE_BYTES);
}

function sameSecureRouterFileTransition(
    left, right, expectedLinks, policy = ROOT_ROUTER_METADATA_POLICY
) {
    const validRight = policy ? secureRouterFileMetadata(right, expectedLinks, policy)
        : right && right.isFile() && !right.isSymbolicLink()
            && right.nlink === expectedLinks && Number.isSafeInteger(right.size)
            && right.size >= 1 && right.size <= MAX_FILE_BYTES;
    return sameFileIdentity(left, right) && validRight
        && left.uid === right.uid && left.gid === right.gid
        && (left.mode & 0o777) === (right.mode & 0o777)
        && left.size === right.size;
}

function sameSecureRouterFileState(left, right, expectedLinks, policy = ROOT_ROUTER_METADATA_POLICY) {
    return sameSecureRouterFileTransition(left, right, expectedLinks, policy)
        && left.nlink === expectedLinks;
}

function inspectRouterActivationSource(
    target, packRoot = PACK_ROOT, storageKind = 'activation-source'
) {
    const storage = inspectPrivateRouterStorageTarget(target, storageKind, packRoot);
    if (storage.error) return Object.freeze({
        error: storage.error === 'router_private_storage_path_invalid'
            ? 'router_staging_path_invalid' : storage.error,
        stat: null
    });
    const { resolved, parentStat } = storage;
    try {
        const stagedStat = fs.lstatSync(resolved);
        if (!secureRouterFileMetadata(stagedStat, 1, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(resolved) !== resolved
            || stagedStat.dev !== parentStat.dev) {
            return Object.freeze({ error: 'router_staging_metadata_unsafe', stat: null });
        }
        return Object.freeze({ error: null, stat: stagedStat });
    } catch {
        return Object.freeze({ error: 'router_staging_metadata_unavailable', stat: null });
    }
}

function validateRouterStagingMetadata(target, packRoot = PACK_ROOT) {
    return inspectRouterActivationSource(target, packRoot).error;
}

function fsyncPath(target) {
    const descriptor = fs.openSync(target, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function routerMutationRuntime(options = {}) {
    return {
        packRoot: path.resolve(options.packRoot || PACK_ROOT),
        platform: options.platform || process.platform,
        fsync: options.fsync || fsyncPath
    };
}

function rollbackActivatedRouter(runtime, live, stagedStat, dynamicState) {
    try {
        const liveStat = fs.lstatSync(live);
        if (![1, 2].includes(liveStat.nlink)
            || !sameSecureRouterFileTransition(
                stagedStat, liveStat, liveStat.nlink, ROOT_ROUTER_METADATA_POLICY
            ) || fs.realpathSync(live) !== live) {
            return false;
        }
        fs.unlinkSync(live);
        runtime.fsync(path.dirname(live));
        const darkState = inspectDynamicDirectoryState(runtime.packRoot);
        return !darkState.error && sameDynamicBaseState(dynamicState, darkState);
    } catch {
        return false;
    }
}

function activationFailure(runtime, live, stagedStat, dynamicState) {
    return rollbackActivatedRouter(runtime, live, stagedStat, dynamicState)
        ? 'active_router_activation_rolled_back'
        : 'active_router_activation_rollback_uncertain';
}

function pathEntryAbsent(target) {
    try {
        fs.lstatSync(target);
        return false;
    } catch (error) {
        return error?.code === 'ENOENT';
    }
}

function rollbackRetainedRouter(
    runtime, retained, retainedParent, retainedParentStat, live, liveStat,
    dynamicState, hostname, expectedHash, expectedCidrs
) {
    try {
        const currentParentStat = fs.lstatSync(retainedParent);
        const retainedStat = fs.lstatSync(retained);
        const linkedLiveStat = fs.lstatSync(live);
        if (!sameSecureRouterDirectoryState(
            retainedParentStat, currentParentStat, ROOT_ROUTER_METADATA_POLICY
        ) || fs.realpathSync(retainedParent) !== retainedParent
            || !sameSecureRouterFileTransition(
                liveStat, retainedStat, 2, ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterFileTransition(
                liveStat, linkedLiveStat, 2, ROOT_ROUTER_METADATA_POLICY
            ) || fs.realpathSync(retained) !== retained) {
            return false;
        }
        fs.unlinkSync(retained);
        runtime.fsync(live);
        runtime.fsync(retainedParent);
        if (!pathEntryAbsent(retained)) return false;
        const currentLiveStat = fs.lstatSync(live);
        const finalParentStat = fs.lstatSync(retainedParent);
        const finalDynamicState = inspectDynamicDirectoryState(runtime.packRoot, true, 1);
        return sameSecureRouterDirectoryState(
            retainedParentStat, finalParentStat, ROOT_ROUTER_METADATA_POLICY
        ) && sameSecureRouterFileTransition(
            liveStat, currentLiveStat, 1, ROOT_ROUTER_METADATA_POLICY
        ) && !finalDynamicState.error
            && sameDynamicBaseState(dynamicState, finalDynamicState)
            && fs.realpathSync(live) === live
            && validateActiveDynamicDirectory(
                hostname, expectedHash, runtime.packRoot, expectedCidrs
            ) === null;
    } catch {
        return false;
    }
}

function retainedPrepareFailure(
    runtime, retained, retainedParent, retainedParentStat, live, liveStat,
    dynamicState, hostname, expectedHash, expectedCidrs
) {
    return rollbackRetainedRouter(
        runtime, retained, retainedParent, retainedParentStat, live, liveStat,
        dynamicState, hostname, expectedHash, expectedCidrs
    ) ? 'retained_router_prepare_rolled_back' : 'retained_router_prepare_rollback_uncertain';
}

function activateRouter(target, hostname, expectedHash, options = {}) {
    const runtime = routerMutationRuntime(options);
    if (runtime.platform !== 'linux') return 'router_mutation_platform_unsupported';
    const initialDarkState = inspectDynamicDirectoryState(runtime.packRoot);
    const preflightError = initialDarkState.error || validateActiveRouter(
        target, hostname, expectedHash, runtime.packRoot, options.expectedCidrs || null
    );
    if (preflightError) return preflightError;
    const staged = path.resolve(target);
    const dynamicRoot = path.join(runtime.packRoot, 'dynamic');
    const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
    const initialStorage = inspectPrivateRouterStorageTarget(
        staged, 'activation-source', runtime.packRoot
    );
    if (initialStorage.error) return initialStorage.error;
    const inspected = inspectRouterActivationSource(
        staged, runtime.packRoot, initialStorage.kind
    );
    if (inspected.error) return inspected.error;
    let stagedStat;
    try {
        const beforeLink = inspectRouterActivationSource(staged, runtime.packRoot);
        const beforeLinkDarkState = inspectDynamicDirectoryState(runtime.packRoot);
        if (beforeLink.error || !sameSecureRouterFileState(
            inspected.stat, beforeLink.stat, 1, ROOT_ROUTER_METADATA_POLICY
        ) || beforeLinkDarkState.error
            || !sameDynamicBaseState(initialDarkState, beforeLinkDarkState)) {
            return 'router_staging_file_changed';
        }
        stagedStat = beforeLink.stat;
        fs.linkSync(staged, live);
    } catch (error) {
        return error?.code === 'EEXIST' ? 'active_router_target_exists' : 'active_router_link_failed';
    }
    try {
        runtime.fsync(live);
        runtime.fsync(dynamicRoot);
        const liveStat = fs.lstatSync(live);
        const stagedLinkedStat = fs.lstatSync(staged);
        const linkedDynamicState = inspectDynamicDirectoryState(runtime.packRoot, true, 2);
        if (!sameSecureRouterFileTransition(
            stagedStat, liveStat, 2, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileTransition(
            stagedStat, stagedLinkedStat, 2, ROOT_ROUTER_METADATA_POLICY
        ) || linkedDynamicState.error
            || !sameDynamicBaseState(initialDarkState, linkedDynamicState)) {
            return activationFailure(runtime, live, stagedStat, initialDarkState);
        }
        const activeError = validateActiveDynamicDirectory(
            hostname, expectedHash, runtime.packRoot, options.expectedCidrs || null, 2
        );
        if (activeError) {
            return activationFailure(runtime, live, stagedStat, initialDarkState);
        }
        fs.unlinkSync(staged);
        runtime.fsync(live);
        runtime.fsync(path.dirname(staged));
        const retainedLiveStat = fs.lstatSync(live);
        const finalActiveState = inspectDynamicDirectoryState(runtime.packRoot, true, 1);
        const finalStorage = inspectPrivateRouterStorageTarget(
            staged, initialStorage.kind, runtime.packRoot
        );
        if (!sameSecureRouterFileTransition(
            stagedStat, retainedLiveStat, 1, ROOT_ROUTER_METADATA_POLICY
        ) || finalActiveState.error
            || !sameDynamicBaseState(initialDarkState, finalActiveState)
            || !pathEntryAbsent(staged)
            || finalStorage.error
            || !sameSecureRouterDirectoryState(
                initialStorage.runtimeStat, finalStorage.runtimeStat,
                ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterDirectoryState(
                initialStorage.parentStat, finalStorage.parentStat,
                ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterDirectoryState(
                initialStorage.dynamicStat, finalStorage.dynamicStat,
                ROOT_ROUTER_METADATA_POLICY
            )
            || validateActiveDynamicDirectory(
                hostname, expectedHash, runtime.packRoot, options.expectedCidrs || null
            )) {
            return activationFailure(runtime, live, stagedStat, initialDarkState);
        }
        return null;
    } catch {
        return activationFailure(runtime, live, stagedStat, initialDarkState);
    }
}

function disableRouter(retainedTarget, hostname, expectedHash, options = {}) {
    const runtime = routerMutationRuntime(options);
    if (runtime.platform !== 'linux') return 'router_mutation_platform_unsupported';
    const expectedCidrs = options.expectedCidrs || null;
    const initialDynamicState = inspectDynamicDirectoryState(runtime.packRoot, true, 1);
    const activeError = initialDynamicState.error
        || validateActiveDynamicDirectory(
            hostname, expectedHash, runtime.packRoot, expectedCidrs
        );
    if (activeError) return activeError;
    const dynamicRoot = path.join(runtime.packRoot, 'dynamic');
    const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
    const storage = inspectPrivateRouterStorageTarget(
        retainedTarget, 'rollback', runtime.packRoot
    );
    if (storage.error) {
        if (storage.error === 'router_private_storage_path_invalid') {
            return 'retained_router_path_invalid';
        }
        if (['router_private_storage_metadata_unsafe', 'router_private_storage_unavailable']
            .includes(storage.error)) return 'retained_router_target_invalid';
        return storage.error;
    }
    const retained = storage.resolved;
    const retainedParent = storage.parent;
    let liveStat;
    let retainedParentStat;
    try {
        retainedParentStat = fs.lstatSync(retainedParent);
        const dynamicStat = fs.lstatSync(dynamicRoot);
        liveStat = fs.lstatSync(live);
        if (!secureRouterDirectoryMetadata(retainedParentStat, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(retainedParent) !== retainedParent
            || !secureRouterDirectoryMetadata(dynamicStat, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(dynamicRoot) !== dynamicRoot
            || !secureRouterFileMetadata(liveStat, 1, ROOT_ROUTER_METADATA_POLICY)
            || fs.realpathSync(live) !== live
            || retainedParentStat.dev !== liveStat.dev || liveStat.dev !== dynamicStat.dev
            || !pathEntryAbsent(retained)) {
            return 'retained_router_target_invalid';
        }
        const currentParentStat = fs.lstatSync(retainedParent);
        const currentLiveStat = fs.lstatSync(live);
        const currentDynamicState = inspectDynamicDirectoryState(runtime.packRoot, true, 1);
        if (!sameSecureRouterDirectoryState(
            retainedParentStat, currentParentStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileState(
            liveStat, currentLiveStat, 1, ROOT_ROUTER_METADATA_POLICY
        ) || currentDynamicState.error
            || !sameActiveDynamicState(initialDynamicState, currentDynamicState, 1)
            || fs.realpathSync(retainedParent) !== retainedParent
            || fs.realpathSync(live) !== live || !pathEntryAbsent(retained)
            || validateActiveDynamicDirectory(
                hostname, expectedHash, runtime.packRoot, expectedCidrs
            )) {
            return 'retained_router_identity_changed';
        }
        retainedParentStat = currentParentStat;
        liveStat = currentLiveStat;
        fs.linkSync(live, retained);
    } catch (error) {
        return error?.code === 'EEXIST' ? 'retained_router_target_exists' : 'retained_router_link_failed';
    }
    try {
        runtime.fsync(retained);
        runtime.fsync(retainedParent);
        const retainedStat = fs.lstatSync(retained);
        const linkedLiveStat = fs.lstatSync(live);
        const linkedParentStat = fs.lstatSync(retainedParent);
        const linkedDynamicState = inspectDynamicDirectoryState(runtime.packRoot, true, 2);
        if (!sameSecureRouterDirectoryState(
            retainedParentStat, linkedParentStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileTransition(
            liveStat, retainedStat, 2, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileTransition(
            liveStat, linkedLiveStat, 2, ROOT_ROUTER_METADATA_POLICY
        ) || linkedDynamicState.error
            || !sameDynamicBaseState(initialDynamicState, linkedDynamicState)
            || fs.realpathSync(retained) !== retained
            || validateActiveRouter(
                retained, hostname, expectedHash, runtime.packRoot,
                expectedCidrs, 'rollback', 2
            )
            || validateActiveDynamicDirectory(
                hostname, expectedHash, runtime.packRoot, expectedCidrs, 2
            )) {
            return retainedPrepareFailure(
                runtime, retained, retainedParent, retainedParentStat,
                live, liveStat, initialDynamicState, hostname, expectedHash, expectedCidrs
            );
        }
    } catch {
        return retainedPrepareFailure(
            runtime, retained, retainedParent, retainedParentStat,
            live, liveStat, initialDynamicState, hostname, expectedHash, expectedCidrs
        );
    }
    try {
        fs.unlinkSync(live);
        runtime.fsync(retained);
        runtime.fsync(dynamicRoot);
        const finalDarkState = inspectDynamicDirectoryState(runtime.packRoot);
        const finalRetainedStat = fs.lstatSync(retained);
        const finalParentStat = fs.lstatSync(retainedParent);
        const finalStorage = inspectPrivateRouterStorageTarget(
            retained, 'rollback', runtime.packRoot
        );
        if (finalDarkState.error
            || !sameDynamicBaseState(initialDynamicState, finalDarkState)
            || finalStorage.error
            || !sameSecureRouterDirectoryState(
                storage.runtimeStat, finalStorage.runtimeStat,
                ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterDirectoryState(
                storage.parentStat, finalStorage.parentStat,
                ROOT_ROUTER_METADATA_POLICY
            ) || !sameSecureRouterDirectoryState(
                storage.dynamicStat, finalStorage.dynamicStat,
                ROOT_ROUTER_METADATA_POLICY
            )
            || !sameSecureRouterDirectoryState(
            retainedParentStat, finalParentStat, ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileTransition(
            liveStat, finalRetainedStat, 1, ROOT_ROUTER_METADATA_POLICY
        ) || fs.realpathSync(retained) !== retained
            || validateActiveRouter(
                retained, hostname, expectedHash, runtime.packRoot, expectedCidrs, 'rollback'
            )) {
            return 'active_router_disable_uncertain';
        }
        return null;
    } catch {
        return 'active_router_disable_uncertain';
    }
}

function samePrivateRouterStorageState(left, right) {
    return Boolean(left && right && left.kind === right.kind
        && left.resolved === right.resolved && left.parent === right.parent
        && left.runtimeRoot === right.runtimeRoot
        && sameSecureRouterDirectoryState(
            left.runtimeStat, right.runtimeStat, ROOT_ROUTER_METADATA_POLICY
        )
        && sameSecureRouterDirectoryState(
            left.parentStat, right.parentStat, ROOT_ROUTER_METADATA_POLICY
        )
        && sameSecureRouterDirectoryState(
            left.dynamicStat, right.dynamicStat, ROOT_ROUTER_METADATA_POLICY
        ));
}

function fsyncRecoveredDarkState(runtime, source, sourceParent, dynamicRoot) {
    runtime.fsync(source);
    runtime.fsync(sourceParent);
    runtime.fsync(dynamicRoot);
}

function fsyncRecoverySource(runtime, source, sourceParent) {
    runtime.fsync(source);
    runtime.fsync(sourceParent);
}

function recoverRouterDark(sourceTarget, sourceKind, hostname, options = {}) {
    const runtime = routerMutationRuntime(options);
    const expectedCidrs = options.expectedCidrs;
    if (runtime.platform !== 'linux') return 'router_mutation_platform_unsupported';
    if (!['staging', 'rollback'].includes(sourceKind)
        || !validHostname(hostname) || validateAllowlistCidrs(expectedCidrs)) {
        return 'router_dark_recovery_argument_invalid';
    }
    const storage = inspectPrivateRouterStorageTarget(
        sourceTarget, sourceKind, runtime.packRoot
    );
    if (storage.error) {
        return storage.error === 'router_private_storage_path_invalid'
            ? 'router_dark_recovery_argument_invalid' : storage.error;
    }
    if (pathEntryAbsent(storage.resolved)) return 'router_dark_recovery_source_unavailable';
    const initialSource = inspectValidatedPrivateRouterSource(
        storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [1, 2]
    );
    if (initialSource.error) return initialSource.error;
    const expectedHash = initialSource.digest;
    if (!samePrivateRouterStorageState(storage, initialSource.storage)) {
        return 'router_dark_recovery_state_invalid';
    }
    const dynamicRoot = path.join(runtime.packRoot, 'dynamic');
    const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);

    if (initialSource.links === 1) {
        const initialDark = inspectDynamicDirectoryState(runtime.packRoot);
        if (initialDark.error) return 'router_dark_recovery_state_invalid';
        try {
            fsyncRecoveredDarkState(
                runtime, initialSource.storage.resolved,
                initialSource.storage.parent, dynamicRoot
            );
        } catch {
            return 'router_dark_recovery_uncertain';
        }
        const finalSource = inspectValidatedPrivateRouterSource(
            storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [1]
        );
        const finalDark = inspectDynamicDirectoryState(runtime.packRoot);
        if (finalSource.error || finalSource.digest !== expectedHash || finalDark.error
            || !sameSecureRouterFileState(
                initialSource.stat, finalSource.stat, 1, ROOT_ROUTER_METADATA_POLICY
            ) || !samePrivateRouterStorageState(
                initialSource.storage, finalSource.storage
            ) || !sameDynamicBaseState(initialDark, finalDark)) {
            return 'router_dark_recovery_uncertain';
        }
        return null;
    }

    const initialActive = inspectValidatedActiveDynamicDirectory(
        hostname, runtime.packRoot, expectedCidrs, 2
    );
    if (initialActive.error || initialActive.digest !== expectedHash
        || !sameSecureRouterFileState(
            initialSource.stat, initialActive.stat, 2, ROOT_ROUTER_METADATA_POLICY
        )) {
        return 'router_dark_recovery_state_invalid';
    }
    const beforeDurabilitySource = inspectValidatedPrivateRouterSource(
        storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [2]
    );
    const beforeDurabilityActive = inspectValidatedActiveDynamicDirectory(
        hostname, runtime.packRoot, expectedCidrs, 2
    );
    if (beforeDurabilitySource.error || beforeDurabilityActive.error
        || beforeDurabilitySource.digest !== expectedHash
        || beforeDurabilityActive.digest !== expectedHash
        || !sameSecureRouterFileState(
            initialSource.stat, beforeDurabilitySource.stat, 2,
            ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileState(
            beforeDurabilitySource.stat, beforeDurabilityActive.stat, 2,
            ROOT_ROUTER_METADATA_POLICY
        ) || !samePrivateRouterStorageState(
            initialSource.storage, beforeDurabilitySource.storage
        ) || !sameActiveDynamicState(
            initialActive.state, beforeDurabilityActive.state, 2
        )) {
        return 'router_dark_recovery_state_invalid';
    }
    try {
        fsyncRecoverySource(runtime, storage.resolved, storage.parent);
    } catch {
        return 'router_dark_recovery_uncertain';
    }
    const beforeUnlinkSource = inspectValidatedPrivateRouterSource(
        storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [2]
    );
    const beforeUnlinkActive = inspectValidatedActiveDynamicDirectory(
        hostname, runtime.packRoot, expectedCidrs, 2
    );
    if (beforeUnlinkSource.error || beforeUnlinkActive.error
        || beforeUnlinkSource.digest !== expectedHash
        || beforeUnlinkActive.digest !== expectedHash
        || !sameSecureRouterFileState(
            beforeDurabilitySource.stat, beforeUnlinkSource.stat, 2,
            ROOT_ROUTER_METADATA_POLICY
        ) || !sameSecureRouterFileState(
            beforeUnlinkSource.stat, beforeUnlinkActive.stat, 2,
            ROOT_ROUTER_METADATA_POLICY
        ) || !samePrivateRouterStorageState(
            beforeDurabilitySource.storage, beforeUnlinkSource.storage
        ) || !sameActiveDynamicState(
            beforeDurabilityActive.state, beforeUnlinkActive.state, 2
        )) {
        return 'router_dark_recovery_state_invalid';
    }
    try {
        fs.unlinkSync(live);
        fsyncRecoveredDarkState(
            runtime, storage.resolved, storage.parent, dynamicRoot
        );
    } catch {
        return 'router_dark_recovery_uncertain';
    }
    const finalSource = inspectValidatedPrivateRouterSource(
        storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [1]
    );
    const finalDark = inspectDynamicDirectoryState(runtime.packRoot);
    if (finalSource.error || finalSource.digest !== expectedHash || finalDark.error
        || !sameSecureRouterFileTransition(
            initialSource.stat, finalSource.stat, 1, ROOT_ROUTER_METADATA_POLICY
        ) || !samePrivateRouterStorageState(
            initialSource.storage, finalSource.storage
        ) || !sameDynamicBaseState(initialActive.state, finalDark)
        || !pathEntryAbsent(live)) {
        return 'router_dark_recovery_uncertain';
    }
    return null;
}

function assertRouterDark(sourceTarget, sourceKind, hostname, options = {}) {
    const runtime = routerMutationRuntime(options);
    const expectedCidrs = options.expectedCidrs;
    if (runtime.platform !== 'linux') return 'router_mutation_platform_unsupported';
    if (!['staging', 'rollback'].includes(sourceKind)
        || !validHostname(hostname) || validateAllowlistCidrs(expectedCidrs)) {
        return 'router_dark_assertion_argument_invalid';
    }
    const repositoryError = validateRepositoryPrivateStorageContract(runtime.packRoot);
    if (repositoryError) return repositoryError;
    const storage = inspectPrivateRouterStorageTarget(
        sourceTarget, sourceKind, runtime.packRoot
    );
    if (storage.error) {
        return storage.error === 'router_private_storage_path_invalid'
            ? 'router_dark_assertion_argument_invalid' : storage.error;
    }
    const initialSource = inspectValidatedPrivateRouterSource(
        storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [1]
    );
    const initialDark = inspectDynamicDirectoryState(runtime.packRoot);
    if (initialSource.error || initialDark.error
        || !samePrivateRouterStorageState(storage, initialSource.storage)) {
        return 'router_dark_assertion_state_invalid';
    }
    const finalSource = inspectValidatedPrivateRouterSource(
        storage.resolved, hostname, runtime.packRoot, expectedCidrs, sourceKind, [1]
    );
    const finalDark = inspectDynamicDirectoryState(runtime.packRoot);
    const finalRepositoryError = validateRepositoryPrivateStorageContract(runtime.packRoot);
    if (finalSource.error || finalDark.error || finalRepositoryError
        || finalSource.digest !== initialSource.digest
        || !sameSecureRouterFileState(
            initialSource.stat, finalSource.stat, 1, ROOT_ROUTER_METADATA_POLICY
        ) || !samePrivateRouterStorageState(initialSource.storage, finalSource.storage)
        || !sameDynamicBaseState(initialDark, finalDark)
        || !pathEntryAbsent(path.join(runtime.packRoot, 'dynamic', ACTIVE_ROUTER_NAME))) {
        return 'router_dark_assertion_state_changed';
    }
    return null;
}

function main(args = process.argv.slice(2)) {
    if (args.length === 0) {
        let sources;
        try { sources = loadOperatorPack(); } catch { console.error('operator_pack_file_invalid'); process.exitCode = 2; return; }
        const error = validateOperatorPack(sources);
        if (error) { console.error(error); process.exitCode = 2; return; }
        console.log('i12_hostinger_operator_contract=PASS');
        return;
    }
    let sources;
    try { sources = loadOperatorSources(); } catch { console.error('operator_pack_file_invalid'); process.exitCode = 2; return; }
    const packError = validateOperatorPack(sources);
    if (packError) { console.error(packError); process.exitCode = 2; return; }
    if (args.length === 2 && args[0] === '--check-compose-version') {
        if (!validComposeVersion(args[1])) {
            console.error('compose_version_unsupported'); process.exitCode = 2; return;
        }
        console.log('compose_version_contract=PASS');
        return;
    }
    if (args.length === 2 && args[0] === '--check-firewall-backend') {
        if (!validFirewallBackend(args[1])) {
            console.error('STOP_DOCKER_FIREWALL_BACKEND_UNSUPPORTED'); process.exitCode = 2; return;
        }
        console.log('docker_firewall_backend_contract=PASS');
        return;
    }
    if (args[0] === '--check-live-dynamic-source') {
        const error = args.length === 2
            ? validateLiveDynamicSource(args[1]) : LIVE_DYNAMIC_RELEASE_MISMATCH;
        if (error) { console.error(error); process.exitCode = 2; return; }
        console.log('live_dynamic_source_contract=PASS');
        return;
    }
    const values = parseRouterArguments(args);
    if (!values) { console.error('active_router_argument_invalid'); process.exitCode = 2; return; }
    const initialLock = verifyRouterRehearsalLock(PACK_ROOT);
    if (initialLock.error) { console.error(initialLock.error); process.exitCode = 2; return; }
    const initialBoundary = inspectRouterSecurityBoundary(
        PACK_ROOT, values['--allowlist-file']
    );
    const initialRepositoryError = validateRepositoryPrivateStorageContract(PACK_ROOT);
    if (initialBoundary.error || initialRepositoryError) {
        console.error(initialBoundary.error || initialRepositoryError);
        process.exitCode = 2;
        return;
    }
    const allowlist = readPrivateAllowlistFile(
        values['--allowlist-file'], values['--phase']
    );
    if (allowlist.error) { console.error(allowlist.error); process.exitCode = 2; return; }
    const preActionLock = verifyRouterRehearsalLock(PACK_ROOT);
    const preActionBoundary = inspectRouterSecurityBoundary(
        PACK_ROOT, values['--allowlist-file']
    );
    if (preActionLock.error || preActionBoundary.error
        || !sameRouterSecurityBoundary(initialBoundary, preActionBoundary)) {
        console.error(preActionLock.error || preActionBoundary.error
            || 'router_security_boundary_changed');
        process.exitCode = 2;
        return;
    }
    let error;
    let classification;
    if (values.action === '--render-router') {
        const result = renderRouterFile(
            values.target, values['--host'], values['--allowlist-file'], values['--phase']
        );
        error = result.error;
        classification = 'router_render';
    } else if (values.action === '--active-router') {
        error = inspectValidatedPrivateRouterSource(
            values.target, values['--host'], PACK_ROOT, allowlist.cidrs,
            'activation-source', [1]
        ).error;
        classification = 'active_router_contract';
    } else if (values.action === '--activate-router') {
        const source = inspectValidatedPrivateRouterSource(
            values.target, values['--host'], PACK_ROOT, allowlist.cidrs,
            'activation-source', [1]
        );
        error = source.error || activateRouter(values.target, values['--host'], source.digest, {
            expectedCidrs: allowlist.cidrs
        });
        classification = 'router_activation';
    } else if (values.action === '--disable-router') {
        const active = inspectValidatedActiveDynamicDirectory(
            values['--host'], PACK_ROOT, allowlist.cidrs, 1
        );
        error = active.error || disableRouter(values.target, values['--host'], active.digest, {
            expectedCidrs: allowlist.cidrs
        });
        classification = 'router_disable';
    } else if (values.action === '--recover-router-dark') {
        error = recoverRouterDark(
            values.target, values['--source-kind'], values['--host'], {
                expectedCidrs: allowlist.cidrs
            }
        );
        classification = 'router_dark_recovery';
    } else {
        error = assertRouterDark(
            values.target, values['--source-kind'], values['--host'], {
                expectedCidrs: allowlist.cidrs
            }
        );
        classification = 'router_dark_assertion';
    }
    const finalLock = verifyRouterRehearsalLock(PACK_ROOT);
    const finalBoundary = inspectRouterSecurityBoundary(
        PACK_ROOT, values['--allowlist-file']
    );
    const finalRepositoryError = validateRepositoryPrivateStorageContract(PACK_ROOT);
    const boundaryError = finalLock.error
        || finalBoundary.error
        || (!sameRouterSecurityBoundary(initialBoundary, finalBoundary)
            ? 'router_security_boundary_changed' : null)
        || finalRepositoryError;
    if (boundaryError) { console.error(boundaryError); process.exitCode = 2; return; }
    if (error) { console.error(error); process.exitCode = 2; return; }
    console.log(`${classification}=PASS phase=${values['--phase']} entries=${allowlist.cidrs.length}`);
}

if (require.main === module) main();

module.exports = Object.freeze({
    ACTIVE_ROUTER_NAME, ALLOWLIST_MIDDLEWARE, ALLOWLIST_PHASES, ALLOWLIST_PLACEHOLDER,
    ACTIVE_ROUTER_IGNORE_PATTERN, BACKEND_URL, CAPACITY_PRODUCER_EXEC, DARK_DYNAMIC_ENTRY,
    DISABLED_HOST, FILES, LIVE_DYNAMIC_RELEASE_MISMATCH,
    MAX_ALLOWLIST_ENTRIES, MAX_ALLOWLIST_FILE_BYTES, MAX_FILE_BYTES, PACK_ROOT, TRAEFIK_COMMANDS,
    PRIVATE_ROLLBACK_DIRECTORY, PRIVATE_RUNTIME_DIRECTORY, PRIVATE_RUNTIME_IGNORE_PATTERN,
    PRIVATE_STAGING_DIRECTORY, REHEARSAL_LOCK_FD, REHEARSAL_LOCK_NAME,
    TRAEFIK_HEALTHCHECK, TRAEFIK_IMAGE, TRAEFIK_INGRESS_NETWORK_BLOCK,
    TRAEFIK_PRIVATE_NETWORK_BLOCK, TRAEFIK_SERVICE_NETWORKS_BLOCK,
    activateRouter, assertRouterDark, canonicalIpv4Cidr, disableRouter, loadOperatorPack,
    parsePrivateAllowlist, recoverRouterDark,
    readPrivateAllowlistFile, renderRouterFile, renderRouterSource, validateActiveDynamicDirectory,
    inspectPrivateRouterStorageTarget, inspectProtectedDirectoryChain,
    inspectRouterSecurityBoundary, sameRouterSecurityBoundary,
    secureRootPrivateFileMetadata, secureRouterDirectoryMetadata, secureRouterFileMetadata,
    validateActiveRouter, validateAllowlistCidrs, validateCapacityProducerSource,
    validateAllowlistProbeSource, validateComposeSource, validateOperatorPack,
    validateDarkDynamicDirectory, validatePerimeterScriptSource,
    validatePerimeterServiceSource, validateRouterSource,
    validateRepositoryPrivateStorageContract, validateRouterStagingMetadata,
    validateLiveDynamicSource, validateRunbookSource, verifyRouterRehearsalLock,
    validComposeVersion, validFirewallBackend
});
