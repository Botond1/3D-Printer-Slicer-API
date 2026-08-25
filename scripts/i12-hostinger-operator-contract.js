'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
const CAPACITY_PRODUCER_EXEC = path.join('scripts', 'i12-capacity-producer-exec.py');
const FILES = Object.freeze({
    compose: 'docker-compose.traefik.yml',
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
    '--entryPoints.web.http.redirections.entryPoint.to=websecure',
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

function validComposeVersion(value) {
    const match = typeof value === 'string' && value.length <= 32
        ? value.match(/^([1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/) : null;
    if (!match) return false;
    const [major, minor, patch] = match.slice(1).map(Number);
    if (![major, minor, patch].every(Number.isSafeInteger)) return false;
    return major > 2 || (major === 2 && (minor > 33 || (minor === 33 && patch >= 1)));
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

function validateRouterSource(source, expectedHost = DISABLED_HOST, disabled = true) {
    if (!safeSource(source) || !validHostname(expectedHost, disabled)) return 'traefik_router_source_malformed';
    const active = activeSource(source);
    const escapedHost = expectedHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (exactLineCount(active, `      rule: "Host(\`${expectedHost}\`)"`) !== 1
        || exactLineCount(active, `          - url: "${BACKEND_URL}"`) !== 1
        || occurrences(active, BACKEND_URL) !== 1
        || !new RegExp(`Host\\(\\\`${escapedHost}\\\`\\)`).test(active)) {
        return 'traefik_router_identity_mismatch';
    }
    for (const fragment of [
        '      entryPoints:\n        - websecure', '      service: slicer-api',
        '      tls:\n        certResolver: letsencrypt', '        passHostHeader: true',
        '        healthCheck:\n          path: /ready\n          interval: 10s\n          timeout: 3s'
    ]) {
        if (!active.includes(fragment)) return 'traefik_router_contract_mismatch';
    }
    if (occurrences(active, 'Host(`') !== 1 || occurrences(active, '          - url:') !== 1
        || /HostRegexp|PathPrefix|catchall|0\.0\.0\.0|localhost|127\.0\.0\.1|forwardAuth|serversTransport/i.test(active)
        || /(?:forwardproxy|forward-proxy|socks|connect|dns|masquerade|nat)/i.test(active)) {
        return 'traefik_router_scope_mismatch';
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
        'Calculate and\nrecord the exact SHA-256',
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
        'Allow exactly three binds', '/usr/bin/node',
        '/run/i12-capacity-artifact-cleanup.js',
        'SLICER_API_IMAGE="$candidate_image" node scripts/i7-production-compose-contract.js || exit 1',
        'rendered_api_image="$(SLICER_API_IMAGE="$candidate_image" docker compose',
        '[ "$rendered_api_image" = "$candidate_image" ] || exit 1',
        'mktemp -d -p "$evidence_parent"',
        '--user "$resolved_slicer_uid:$resolved_slicer_gid"',
        '--mount type=bind,src="$slicer_output_dir",dst=/app/output,rw',
        '--mount type=bind,src="$run_owned_private_dir/queue-cleanup.json",dst=/run/i12-cleanup.json,ro',
        '--mount type=bind,src="$verified_checkout/scripts/i12-capacity-artifact-cleanup.js",dst=/run/i12-capacity-artifact-cleanup.js,ro',
        'docker compose --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api',
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
        'same-filesystem, no-clobber hard\nlink',
        "helper's `--disable-router` mode",
        'preserves the live\nrouter with a no-clobber hard link',
        'exact retained\ndev/inode identity',
        'retained_router_prepare_rolled_back', 'retained_router_prepare_rollback_uncertain',
        'node scripts/i12-hostinger-operator-contract.js || exit 1',
        '--active-router <temporary-file> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1',
        '--activate-router <temporary-file> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1',
        '--disable-router <create-new-retained-path> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1',
        'only `.gitkeep` remains'
    ]) {
        if (!source.includes(fragment)) return 'hostinger_runbook_contract_mismatch';
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
    if (occurrences(
        source,
        'SLICER_API_IMAGE="$candidate_image" docker compose --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api'
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
        'docker compose --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api',
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
        'SLICER_API_IMAGE="$candidate_image" docker compose --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api'
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
        'SLICER_API_IMAGE="$candidate_image" docker compose --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api'
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
        '--active-router <temporary-file> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1',
        '--activate-router <temporary-file> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1',
        'Confirm the loaded file hash',
        '--disable-router <create-new-retained-path> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1'
    ].map((fragment) => source.indexOf(fragment));
    if (routerMutationOrder.some((index) => index < 0)
        || routerMutationOrder.some((index, position) => position > 0
            && index <= routerMutationOrder[position - 1])) {
        return 'hostinger_router_mutation_order_mismatch';
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

function readBoundedRegular(target, root = PACK_ROOT) {
    const resolved = path.resolve(target);
    if (!containedPath(root, resolved)) throw new Error('operator_path_outside_boundary');
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_FILE_BYTES
        || fs.realpathSync(resolved) !== resolved) throw new Error('operator_file_invalid');
    return fs.readFileSync(resolved, 'utf8');
}

function validateDarkDynamicDirectory(packRoot = PACK_ROOT) {
    const dynamicRoot = path.resolve(packRoot, 'dynamic');
    try {
        const rootStat = fs.lstatSync(dynamicRoot);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
            || fs.realpathSync(dynamicRoot) !== dynamicRoot) {
            return 'traefik_dynamic_directory_unsafe';
        }
        const entries = fs.readdirSync(dynamicRoot, { withFileTypes: true });
        if (entries.length !== 1 || entries[0].name !== DARK_DYNAMIC_ENTRY
            || !entries[0].isFile() || entries[0].isSymbolicLink()) {
            return 'traefik_dark_router_residue';
        }
        const sentinel = path.join(dynamicRoot, DARK_DYNAMIC_ENTRY);
        const sentinelStat = fs.lstatSync(sentinel);
        if (!sentinelStat.isFile() || sentinelStat.isSymbolicLink()
            || sentinelStat.size !== 1 || fs.realpathSync(sentinel) !== sentinel
            || !fs.readFileSync(sentinel).equals(Buffer.from('\n'))) {
            return 'traefik_dynamic_sentinel_invalid';
        }
    } catch {
        return 'traefik_dynamic_directory_unavailable';
    }
    return null;
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
    const dynamicError = validateDarkDynamicDirectory();
    if (dynamicError) throw new Error(dynamicError);
    return loadOperatorSources();
}

function validateOperatorPack(sources) {
    return validateComposeSource(sources.compose) || validateRouterSource(sources.routerTemplate)
        || validateRunbookSource(sources.runbook)
        || validateCapacityProducerSource(sources.capacityProducerExec);
}

function parseRouterArguments(args) {
    if (args.length !== 6) return null;
    const values = {};
    const actionKeys = ['--active-router', '--activate-router', '--disable-router'];
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        if (![...actionKeys, '--host', '--sha256'].includes(key) || values[key]) return null;
        values[key] = args[index + 1];
    }
    const actions = actionKeys.filter((key) => values[key]);
    return actions.length === 1 && values['--host'] && values['--sha256']
        ? { action: actions[0], target: values[actions[0]], ...values }
        : null;
}

function validateActiveRouter(target, hostname, expectedHash, packRoot = PACK_ROOT) {
    if (!/^[0-9a-f]{64}$/.test(expectedHash || '') || !validHostname(hostname)) {
        return 'active_router_argument_invalid';
    }
    const resolved = path.resolve(target);
    if (!containedPath(packRoot, resolved)
        || containedPath(path.join(packRoot, 'dynamic'), resolved)) {
        return 'active_router_path_invalid';
    }
    let source;
    try { source = readBoundedRegular(resolved, packRoot); } catch { return 'active_router_file_invalid'; }
    const contractError = validateRouterSource(source, hostname, false);
    if (contractError) return contractError;
    const actualHash = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    return actualHash === expectedHash ? null : 'active_router_hash_mismatch';
}

function validateActiveDynamicDirectory(hostname, expectedHash, packRoot = PACK_ROOT) {
    const dynamicRoot = path.resolve(packRoot, 'dynamic');
    try {
        const rootStat = fs.lstatSync(dynamicRoot);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
            || fs.realpathSync(dynamicRoot) !== dynamicRoot) {
            return 'traefik_dynamic_directory_unsafe';
        }
        const names = fs.readdirSync(dynamicRoot).sort();
        if (!exactArray(names, [DARK_DYNAMIC_ENTRY, ACTIVE_ROUTER_NAME].sort())) {
            return 'traefik_active_router_set_invalid';
        }
        const sentinel = path.join(dynamicRoot, DARK_DYNAMIC_ENTRY);
        const sentinelStat = fs.lstatSync(sentinel);
        if (!sentinelStat.isFile() || sentinelStat.isSymbolicLink()
            || sentinelStat.size !== 1 || fs.realpathSync(sentinel) !== sentinel
            || !fs.readFileSync(sentinel).equals(Buffer.from('\n'))) {
            return 'traefik_dynamic_sentinel_invalid';
        }
        const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
        const source = readBoundedRegular(live, packRoot);
        const sourceError = validateRouterSource(source, hostname, false);
        if (sourceError) return sourceError;
        const actualHash = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
        return actualHash === expectedHash ? null : 'active_router_hash_mismatch';
    } catch {
        return 'traefik_active_router_unavailable';
    }
}

function sameFileIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
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

function rollbackActivatedRouter(runtime, live, stagedStat) {
    try {
        const liveStat = fs.lstatSync(live);
        if (!liveStat.isFile() || liveStat.isSymbolicLink()
            || fs.realpathSync(live) !== live || !sameFileIdentity(stagedStat, liveStat)) {
            return false;
        }
        fs.unlinkSync(live);
        runtime.fsync(path.dirname(live));
        return validateDarkDynamicDirectory(runtime.packRoot) === null;
    } catch {
        return false;
    }
}

function activationFailure(runtime, live, stagedStat) {
    return rollbackActivatedRouter(runtime, live, stagedStat)
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

function rollbackRetainedRouter(runtime, retained, retainedParent, live, liveStat, hostname, expectedHash) {
    try {
        const retainedStat = fs.lstatSync(retained);
        if (!retainedStat.isFile() || retainedStat.isSymbolicLink()
            || fs.realpathSync(retained) !== retained || !sameFileIdentity(liveStat, retainedStat)) {
            return false;
        }
        fs.unlinkSync(retained);
        runtime.fsync(retainedParent);
        if (!pathEntryAbsent(retained)) return false;
        const currentLiveStat = fs.lstatSync(live);
        return sameFileIdentity(liveStat, currentLiveStat)
            && validateActiveDynamicDirectory(hostname, expectedHash, runtime.packRoot) === null;
    } catch {
        return false;
    }
}

function retainedPrepareFailure(runtime, retained, retainedParent, live, liveStat, hostname, expectedHash) {
    return rollbackRetainedRouter(
        runtime, retained, retainedParent, live, liveStat, hostname, expectedHash
    ) ? 'retained_router_prepare_rolled_back' : 'retained_router_prepare_rollback_uncertain';
}

function activateRouter(target, hostname, expectedHash, options = {}) {
    const runtime = routerMutationRuntime(options);
    if (runtime.platform !== 'linux') return 'router_mutation_platform_unsupported';
    const preflightError = validateDarkDynamicDirectory(runtime.packRoot)
        || validateActiveRouter(target, hostname, expectedHash, runtime.packRoot);
    if (preflightError) return preflightError;
    const staged = path.resolve(target);
    const dynamicRoot = path.join(runtime.packRoot, 'dynamic');
    const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
    let stagedStat;
    try {
        stagedStat = fs.lstatSync(staged);
        fs.linkSync(staged, live);
    } catch (error) {
        return error?.code === 'EEXIST' ? 'active_router_target_exists' : 'active_router_link_failed';
    }
    try {
        runtime.fsync(live);
        runtime.fsync(dynamicRoot);
        const liveStat = fs.lstatSync(live);
        if (!sameFileIdentity(stagedStat, liveStat)) {
            return activationFailure(runtime, live, stagedStat);
        }
        const activeError = validateActiveDynamicDirectory(hostname, expectedHash, runtime.packRoot);
        if (activeError) return activationFailure(runtime, live, stagedStat);
        fs.unlinkSync(staged);
        runtime.fsync(path.dirname(staged));
        return null;
    } catch {
        return activationFailure(runtime, live, stagedStat);
    }
}

function disableRouter(retainedTarget, hostname, expectedHash, options = {}) {
    const runtime = routerMutationRuntime(options);
    if (runtime.platform !== 'linux') return 'router_mutation_platform_unsupported';
    const activeError = validateActiveDynamicDirectory(hostname, expectedHash, runtime.packRoot);
    if (activeError) return activeError;
    const dynamicRoot = path.join(runtime.packRoot, 'dynamic');
    const live = path.join(dynamicRoot, ACTIVE_ROUTER_NAME);
    const retained = path.resolve(retainedTarget);
    const retainedParent = path.dirname(retained);
    if (!containedPath(runtime.packRoot, retained)
        || containedPath(dynamicRoot, retained)) return 'retained_router_path_invalid';
    let liveStat;
    try {
        const parentStat = fs.lstatSync(retainedParent);
        liveStat = fs.lstatSync(live);
        if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
            || fs.realpathSync(retainedParent) !== retainedParent
            || parentStat.dev !== liveStat.dev || fs.existsSync(retained)) {
            return 'retained_router_target_invalid';
        }
        fs.linkSync(live, retained);
    } catch (error) {
        return error?.code === 'EEXIST' ? 'retained_router_target_exists' : 'retained_router_link_failed';
    }
    try {
        runtime.fsync(retained);
        runtime.fsync(retainedParent);
        const retainedStat = fs.lstatSync(retained);
        if (!sameFileIdentity(liveStat, retainedStat)
            || validateActiveRouter(retained, hostname, expectedHash, runtime.packRoot)) {
            return retainedPrepareFailure(
                runtime, retained, retainedParent, live, liveStat, hostname, expectedHash
            );
        }
    } catch {
        return retainedPrepareFailure(
            runtime, retained, retainedParent, live, liveStat, hostname, expectedHash
        );
    }
    try {
        fs.unlinkSync(live);
        runtime.fsync(dynamicRoot);
        return validateDarkDynamicDirectory(runtime.packRoot);
    } catch {
        return 'active_router_disable_uncertain';
    }
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
    const values = parseRouterArguments(args);
    if (!values) { console.error('active_router_argument_invalid'); process.exitCode = 2; return; }
    let error;
    if (values.action === '--active-router') {
        error = validateActiveRouter(values.target, values['--host'], values['--sha256']);
    } else if (values.action === '--activate-router') {
        error = activateRouter(values.target, values['--host'], values['--sha256']);
    } else {
        error = disableRouter(values.target, values['--host'], values['--sha256']);
    }
    if (error) { console.error(error); process.exitCode = 2; return; }
    const classification = values.action === '--active-router' ? 'active_router_contract'
        : values.action === '--activate-router' ? 'router_activation' : 'router_disable';
    console.log(`${classification}=PASS sha256=${values['--sha256']} host=${values['--host']}`);
}

if (require.main === module) main();

module.exports = Object.freeze({
    ACTIVE_ROUTER_NAME, BACKEND_URL, CAPACITY_PRODUCER_EXEC, DARK_DYNAMIC_ENTRY, DISABLED_HOST, FILES, MAX_FILE_BYTES, PACK_ROOT, TRAEFIK_COMMANDS,
    TRAEFIK_HEALTHCHECK, TRAEFIK_IMAGE, TRAEFIK_INGRESS_NETWORK_BLOCK,
    TRAEFIK_PRIVATE_NETWORK_BLOCK, TRAEFIK_SERVICE_NETWORKS_BLOCK,
    activateRouter, disableRouter, loadOperatorPack, validateActiveDynamicDirectory,
    validateActiveRouter, validateCapacityProducerSource, validateComposeSource, validateOperatorPack,
    validateDarkDynamicDirectory, validateRouterSource, validateRunbookSource, validComposeVersion
});
