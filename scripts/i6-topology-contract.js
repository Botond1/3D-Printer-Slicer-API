'use strict';

const VALIDATION_LABEL = 'io.s3a.validation-only';
const IMAGE_LABEL = 'io.s3a.expected-image-id';
const INTERNAL_SUBNET = '198.51.100.0/28';
const API_IP = '198.51.100.2';
const PEER_IP = '198.51.100.3';
const API_ALIAS = 'i6-api.private';
const PEER_ALIAS = 'i6-peer.private';
const SENTINEL_SUBNET = '192.0.2.0/28';
const SENTINEL_IP = '192.0.2.2';
const SCOPED_CREDENTIALS = Object.freeze([
    'SLICE_SERVICE_API_KEY',
    'SLICE_SERVICE_API_KEY_PREVIOUS',
    'SLICE_SERVICE_WOOCOMMERCE_API_KEY',
    'SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS',
    'SLICE_SERVICE_LEADPILOT_API_KEY',
    'SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS',
    'PRICING_API_KEY',
    'PRICING_API_KEY_PREVIOUS',
    'ARTIFACT_API_KEY',
    'ARTIFACT_API_KEY_PREVIOUS',
    'OPERATIONS_API_KEY',
    'OPERATIONS_API_KEY_PREVIOUS'
]);

const API_REASON_CODES = Object.freeze([
    'success',
    'private_network_shape_invalid',
    'private_network_internal_required',
    'private_network_driver_mismatch',
    'private_network_subnet_mismatch',
    'private_network_labels_mismatch',
    'api_container_shape_invalid',
    'api_network_mode_mismatch',
    'api_network_attachment_mismatch',
    'api_static_ip_mismatch',
    'api_network_alias_mismatch',
    'api_dns_names_mismatch',
    'api_image_mismatch',
    'api_container_labels_mismatch',
    'api_user_mismatch',
    'api_readonly_root_required',
    'api_cap_drop_mismatch',
    'api_cap_add_forbidden',
    'api_no_new_privileges_required',
    'api_dns_mismatch',
    'api_trusted_peer_mismatch',
    'api_host_port_present',
    'api_resource_envelope_mismatch',
    'api_tmpfs_shape_mismatch',
    'api_tmpfs_options_mismatch',
    'api_runtime_probe_shape',
    'api_runtime_identity_mismatch',
    'api_default_route_present'
]);

const PEER_REASON_CODES = Object.freeze([
    'peer_container_shape_invalid',
    'peer_network_mode_mismatch',
    'peer_network_attachment_mismatch',
    'peer_static_ip_mismatch',
    'peer_network_alias_mismatch',
    'peer_dns_names_mismatch',
    'peer_image_mismatch',
    'peer_container_labels_mismatch',
    'peer_user_mismatch',
    'peer_readonly_root_required',
    'peer_cap_drop_mismatch',
    'peer_cap_add_forbidden',
    'peer_no_new_privileges_required',
    'peer_dns_override_forbidden',
    'peer_host_port_present',
    'peer_privileged_forbidden',
    'peer_host_namespace_forbidden',
    'peer_host_mount_forbidden',
    'peer_resource_envelope_mismatch',
    'peer_tmpfs_mismatch',
    'peer_credential_scope_mismatch'
]);

const SENTINEL_REASON_CODES = Object.freeze([
    'sentinel_network_shape_invalid',
    'sentinel_network_external_required',
    'sentinel_network_driver_mismatch',
    'sentinel_network_subnet_mismatch',
    'sentinel_network_labels_mismatch',
    'sentinel_container_shape_invalid',
    'sentinel_network_attachment_mismatch',
    'sentinel_ip_mismatch',
    'sentinel_image_mismatch',
    'sentinel_container_labels_mismatch',
    'sentinel_user_mismatch',
    'sentinel_readonly_root_required',
    'sentinel_cap_drop_mismatch',
    'sentinel_cap_add_forbidden',
    'sentinel_no_new_privileges_required',
    'sentinel_host_port_present',
    'sentinel_port_sysctl_mismatch'
]);

const RUNTIME_REASON_CODES = Object.freeze([
    'environment_contract_failure',
    'evidence_boundary_failure',
    'docker_command_unavailable',
    'private_runtime_probe_unavailable',
    'private_network_create_failure',
    'sentinel_network_create_failure',
    'sentinel_container_start_failure',
    'api_container_start_failure',
    'peer_container_start_failure',
    'sentinel_probe_attach_failure',
    'sentinel_probe_execution_failure',
    'sentinel_not_operational',
    'sentinel_probe_detach_failure',
    'private_runtime_probe_execution_failure',
    'api_egress_probe_execution_failure',
    'api_output_failure',
    'api_json_failure',
    'api_probe_failure',
    'native_egress_probe_execution_failure',
    'native_output_failure',
    'native_json_failure',
    'native_probe_failure',
    'api_egress_not_denied',
    'native_egress_not_denied',
    'api_and_native_egress_not_denied',
    'private_peer_probe_unavailable',
    'private_peer_probe_execution_failure',
    'private_peer_output_failure',
    'private_peer_json_failure',
    'private_peer_probe_shape_failure',
    'private_peer_ingress_unavailable',
    'authenticated_readiness_unavailable',
    'authenticated_readiness_and_auth_rejection_unavailable',
    'auth_rejection_proof_unavailable',
    'topology_evidence_boundary_failure',
    'docker_command_failure',
    'docker_output_unbounded',
    'unclassified_failure'
]);

const TOPOLOGY_CONTRACT_REASONS = Object.freeze([
    ...new Set([
        ...API_REASON_CODES,
        ...PEER_REASON_CODES,
        ...SENTINEL_REASON_CODES,
        ...RUNTIME_REASON_CODES
    ])
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameKeys(value, expected) {
    return isPlainObject(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function emptyArrayOrNull(value) {
    return value == null || (Array.isArray(value) && value.length === 0);
}

function emptyObjectOrNull(value) {
    return value == null || (isPlainObject(value) && Object.keys(value).length === 0);
}

function hasValidationLabels(labels, imageId) {
    return isPlainObject(labels)
        && labels[VALIDATION_LABEL] === 'true'
        && labels[IMAGE_LABEL] === imageId;
}

function hasExactValidationLabels(labels, imageId) {
    return hasValidationLabels(labels, imageId)
        && sameKeys(labels, [IMAGE_LABEL, VALIDATION_LABEL]);
}

function normalizeTmpfs(value) {
    if (typeof value !== 'string') return null;
    const items = value.split(',');
    return items.length === new Set(items).size ? [...items].sort() : null;
}

function expectedApiTmpfs(uid, gid) {
    const options = `rw,nosuid,nodev,noexec,size=64m,uid=${uid},gid=${gid},mode=0700`;
    return {
        '/app/input': options,
        '/app/output': options,
        '/app/configs/pricing-state': options,
        '/tmp': options
    };
}

function validatePrivateNetwork(network, imageId) {
    if (!isPlainObject(network) || !isPlainObject(network.Labels)
        || !isPlainObject(network.IPAM) || !Array.isArray(network.IPAM.Config)) {
        return { ok: false, reason: 'private_network_shape_invalid' };
    }
    if (network.Internal !== true) {
        return { ok: false, reason: 'private_network_internal_required' };
    }
    if (network.Driver !== 'bridge') {
        return { ok: false, reason: 'private_network_driver_mismatch' };
    }
    if (network.IPAM.Config.length !== 1
        || !isPlainObject(network.IPAM.Config[0])
        || network.IPAM.Config[0].Subnet !== INTERNAL_SUBNET) {
        return { ok: false, reason: 'private_network_subnet_mismatch' };
    }
    if (!hasExactValidationLabels(network.Labels, imageId)) {
        return { ok: false, reason: 'private_network_labels_mismatch' };
    }
    return null;
}

function validateOnlyPrivateEndpoint(container, expected, prefix) {
    const host = container.HostConfig;
    const networks = container.NetworkSettings.Networks;
    if (host.NetworkMode !== expected.networkName) {
        return { ok: false, reason: `${prefix}_network_mode_mismatch` };
    }
    if (!sameKeys(networks, [expected.networkName])
        || !isPlainObject(networks[expected.networkName])) {
        return { ok: false, reason: `${prefix}_network_attachment_mismatch` };
    }
    const endpoint = networks[expected.networkName];
    if (endpoint.IPAddress !== expected.ip) {
        return { ok: false, reason: `${prefix}_static_ip_mismatch` };
    }
    if (JSON.stringify(endpoint.Aliases) !== JSON.stringify([expected.alias])) {
        return { ok: false, reason: `${prefix}_network_alias_mismatch` };
    }
    const containerId = typeof container.Id === 'string' ? container.Id : '';
    const dnsNames = Array.isArray(endpoint.DNSNames) ? [...endpoint.DNSNames].sort() : [];
    if (!/^[0-9a-f]{64}$/.test(containerId)
        || JSON.stringify(dnsNames) !== JSON.stringify([
            expected.containerName,
            expected.alias,
            containerId.slice(0, 12)
        ].sort())) {
        return { ok: false, reason: `${prefix}_dns_names_mismatch` };
    }
    return null;
}

function validateNoHostPorts(container, reason) {
    const host = container.HostConfig;
    const ports = container.NetworkSettings.Ports;
    const runtimeBindingsAbsent = emptyObjectOrNull(ports)
        || Object.values(ports).every((bindings) => bindings == null);
    if (!emptyObjectOrNull(host.PortBindings)
        || host.PublishAllPorts !== false
        || !runtimeBindingsAbsent) {
        return { ok: false, reason };
    }
    return null;
}

function validateApiResources(host, config, uid, gid) {
    const log = host.LogConfig;
    if (host.PidsLimit !== 512 || host.Memory !== 4_294_967_296
        || host.MemorySwap !== 4_294_967_296 || host.NanoCpus !== 2_000_000_000
        || !isPlainObject(log) || log.Type !== 'json-file'
        || !sameKeys(log.Config, ['max-size', 'max-file'])
        || log.Config['max-size'] !== '20m' || log.Config['max-file'] !== '5'
        || config.StopTimeout !== 30) {
        return { ok: false, reason: 'api_resource_envelope_mismatch' };
    }
    const expected = expectedApiTmpfs(uid, gid);
    if (!sameKeys(host.Tmpfs, Object.keys(expected))) {
        return { ok: false, reason: 'api_tmpfs_shape_mismatch' };
    }
    for (const [target, options] of Object.entries(expected)) {
        const actual = normalizeTmpfs(host.Tmpfs[target]);
        if (!actual || JSON.stringify(actual) !== JSON.stringify(normalizeTmpfs(options))) {
            return { ok: false, reason: 'api_tmpfs_options_mismatch' };
        }
    }
    return null;
}

function validateApiRuntime(runtimeProbe, uid, gid) {
    if (!sameKeys(runtimeProbe, ['uid', 'gid', 'externalDefaultRoute'])
        || !Number.isSafeInteger(runtimeProbe.uid)
        || !Number.isSafeInteger(runtimeProbe.gid)
        || typeof runtimeProbe.externalDefaultRoute !== 'boolean') {
        return { ok: false, reason: 'api_runtime_probe_shape' };
    }
    if (runtimeProbe.uid !== Number(uid) || runtimeProbe.gid !== Number(gid)
        || runtimeProbe.uid <= 0 || runtimeProbe.gid <= 0) {
        return { ok: false, reason: 'api_runtime_identity_mismatch' };
    }
    if (runtimeProbe.externalDefaultRoute) {
        return { ok: false, reason: 'api_default_route_present' };
    }
    return { ok: true, reason: 'success' };
}

function validateApiTopology(input) {
    const {
        network, container, networkName, containerName, imageId, uid, gid,
        apiIp = API_IP, apiAlias = API_ALIAS, syntheticDns = SENTINEL_IP, runtimeProbe
    } = input || {};
    const networkError = validatePrivateNetwork(network, imageId);
    if (networkError) return networkError;
    if (!isPlainObject(container) || !isPlainObject(container.HostConfig)
        || !isPlainObject(container.Config) || !isPlainObject(container.NetworkSettings)
        || !isPlainObject(container.NetworkSettings.Networks)) {
        return { ok: false, reason: 'api_container_shape_invalid' };
    }
    const endpointError = validateOnlyPrivateEndpoint(container, {
        networkName, containerName, ip: apiIp, alias: apiAlias
    }, 'api');
    if (endpointError) return endpointError;
    if (container.Image !== imageId) return { ok: false, reason: 'api_image_mismatch' };
    if (!hasValidationLabels(container.Config.Labels, imageId)) {
        return { ok: false, reason: 'api_container_labels_mismatch' };
    }
    const host = container.HostConfig;
    if (container.Config.User !== `${uid}:${gid}`) return { ok: false, reason: 'api_user_mismatch' };
    if (host.ReadonlyRootfs !== true) return { ok: false, reason: 'api_readonly_root_required' };
    if (JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])) {
        return { ok: false, reason: 'api_cap_drop_mismatch' };
    }
    if (!emptyArrayOrNull(host.CapAdd)) return { ok: false, reason: 'api_cap_add_forbidden' };
    if (JSON.stringify(host.SecurityOpt) !== JSON.stringify(['no-new-privileges'])) {
        return { ok: false, reason: 'api_no_new_privileges_required' };
    }
    if (JSON.stringify(host.Dns) !== JSON.stringify([syntheticDns])) {
        return { ok: false, reason: 'api_dns_mismatch' };
    }
    const trustEntries = Array.isArray(container.Config.Env)
        ? container.Config.Env.filter((entry) => (
            typeof entry === 'string'
            && (entry.startsWith('TRUST_PROXY=') || entry.startsWith('TRUST_PROXY_CIDRS='))
        )).sort()
        : [];
    if (JSON.stringify(trustEntries) !== JSON.stringify([
        'TRUST_PROXY=true',
        `TRUST_PROXY_CIDRS=${PEER_IP}`
    ].sort())) {
        return { ok: false, reason: 'api_trusted_peer_mismatch' };
    }
    return validateNoHostPorts(container, 'api_host_port_present')
        || validateApiResources(host, container.Config, uid, gid)
        || validateApiRuntime(runtimeProbe, uid, gid);
}

function validatePeerResources(host, config, uid, gid) {
    const expectedTmpfs = `rw,nosuid,nodev,noexec,size=16m,uid=${uid},gid=${gid},mode=0700`;
    const log = host.LogConfig;
    if (host.PidsLimit !== 64 || host.Memory !== 134_217_728
        || host.MemorySwap !== 134_217_728 || host.NanoCpus !== 250_000_000
        || config.StopTimeout !== 5 || !isPlainObject(log) || log.Type !== 'json-file'
        || !sameKeys(log.Config, ['max-size', 'max-file'])
        || log.Config['max-size'] !== '1m' || log.Config['max-file'] !== '1') {
        return { ok: false, reason: 'peer_resource_envelope_mismatch' };
    }
    if (!sameKeys(host.Tmpfs, ['/tmp'])
        || JSON.stringify(normalizeTmpfs(host.Tmpfs['/tmp']))
            !== JSON.stringify(normalizeTmpfs(expectedTmpfs))) {
        return { ok: false, reason: 'peer_tmpfs_mismatch' };
    }
    return null;
}

function validatePeerCredentials(env, operationsKey) {
    if (!Array.isArray(env) || env.some((entry) => typeof entry !== 'string')) return false;
    const scoped = env.filter((entry) => SCOPED_CREDENTIALS.some((name) => entry.startsWith(`${name}=`)));
    return JSON.stringify(scoped) === JSON.stringify([`OPERATIONS_API_KEY=${operationsKey}`]);
}

function validatePeerTopology(input) {
    const {
        container, networkName, containerName, imageId, uid, gid, operationsKey,
        peerIp = PEER_IP, peerAlias = PEER_ALIAS
    } = input || {};
    if (!isPlainObject(container) || !isPlainObject(container.HostConfig)
        || !isPlainObject(container.Config) || !isPlainObject(container.NetworkSettings)
        || !isPlainObject(container.NetworkSettings.Networks)) {
        return { ok: false, reason: 'peer_container_shape_invalid' };
    }
    const endpointError = validateOnlyPrivateEndpoint(container, {
        networkName, containerName, ip: peerIp, alias: peerAlias
    }, 'peer');
    if (endpointError) return endpointError;
    if (container.Image !== imageId) return { ok: false, reason: 'peer_image_mismatch' };
    if (!hasValidationLabels(container.Config.Labels, imageId)) {
        return { ok: false, reason: 'peer_container_labels_mismatch' };
    }
    const host = container.HostConfig;
    if (container.Config.User !== `${uid}:${gid}`) return { ok: false, reason: 'peer_user_mismatch' };
    if (host.ReadonlyRootfs !== true) return { ok: false, reason: 'peer_readonly_root_required' };
    if (JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])) {
        return { ok: false, reason: 'peer_cap_drop_mismatch' };
    }
    if (!emptyArrayOrNull(host.CapAdd)) return { ok: false, reason: 'peer_cap_add_forbidden' };
    if (JSON.stringify(host.SecurityOpt) !== JSON.stringify(['no-new-privileges'])) {
        return { ok: false, reason: 'peer_no_new_privileges_required' };
    }
    const dnsUnset = host.Dns === null
        || (Array.isArray(host.Dns) && host.Dns.length === 0);
    if (!dnsUnset
        || !Array.isArray(host.DnsOptions) || host.DnsOptions.length !== 0
        || !Array.isArray(host.DnsSearch) || host.DnsSearch.length !== 0) {
        return { ok: false, reason: 'peer_dns_override_forbidden' };
    }
    const portError = validateNoHostPorts(container, 'peer_host_port_present');
    if (portError) return portError;
    if (host.Privileged !== false) return { ok: false, reason: 'peer_privileged_forbidden' };
    if (host.PidMode === 'host' || host.IpcMode === 'host' || host.UTSMode === 'host'
        || host.UsernsMode === 'host' || host.CgroupnsMode === 'host') {
        return { ok: false, reason: 'peer_host_namespace_forbidden' };
    }
    if (!emptyArrayOrNull(host.Binds) || !emptyArrayOrNull(container.Mounts)
        || !emptyArrayOrNull(host.Devices)) {
        return { ok: false, reason: 'peer_host_mount_forbidden' };
    }
    return validatePeerResources(host, container.Config, uid, gid)
        || (!validatePeerCredentials(container.Config.Env, operationsKey)
            ? { ok: false, reason: 'peer_credential_scope_mismatch' }
            : { ok: true, reason: 'success' });
}

function validateSentinelTopology(input) {
    const { network, container, networkName, imageId, uid, gid, syntheticIp = SENTINEL_IP } = input || {};
    if (!isPlainObject(network) || !isPlainObject(network.Labels)
        || !isPlainObject(network.IPAM) || !Array.isArray(network.IPAM.Config)) {
        return { ok: false, reason: 'sentinel_network_shape_invalid' };
    }
    if (network.Internal !== false) return { ok: false, reason: 'sentinel_network_external_required' };
    if (network.Driver !== 'bridge') return { ok: false, reason: 'sentinel_network_driver_mismatch' };
    if (network.IPAM.Config.length !== 1 || network.IPAM.Config[0]?.Subnet !== SENTINEL_SUBNET) {
        return { ok: false, reason: 'sentinel_network_subnet_mismatch' };
    }
    if (!hasExactValidationLabels(network.Labels, imageId)) {
        return { ok: false, reason: 'sentinel_network_labels_mismatch' };
    }
    if (!isPlainObject(container) || !isPlainObject(container.HostConfig)
        || !isPlainObject(container.Config) || !isPlainObject(container.NetworkSettings?.Networks)) {
        return { ok: false, reason: 'sentinel_container_shape_invalid' };
    }
    const networks = container.NetworkSettings.Networks;
    if (!sameKeys(networks, [networkName]) || !isPlainObject(networks[networkName])) {
        return { ok: false, reason: 'sentinel_network_attachment_mismatch' };
    }
    if (networks[networkName].IPAddress !== syntheticIp) {
        return { ok: false, reason: 'sentinel_ip_mismatch' };
    }
    if (container.Image !== imageId) return { ok: false, reason: 'sentinel_image_mismatch' };
    if (!hasValidationLabels(container.Config.Labels, imageId)) {
        return { ok: false, reason: 'sentinel_container_labels_mismatch' };
    }
    const host = container.HostConfig;
    if (container.Config.User !== `${uid}:${gid}`) {
        return { ok: false, reason: 'sentinel_user_mismatch' };
    }
    if (host.ReadonlyRootfs !== true) return { ok: false, reason: 'sentinel_readonly_root_required' };
    if (JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])) {
        return { ok: false, reason: 'sentinel_cap_drop_mismatch' };
    }
    if (!emptyArrayOrNull(host.CapAdd)) return { ok: false, reason: 'sentinel_cap_add_forbidden' };
    if (JSON.stringify(host.SecurityOpt) !== JSON.stringify(['no-new-privileges'])) {
        return { ok: false, reason: 'sentinel_no_new_privileges_required' };
    }
    const portError = validateNoHostPorts(container, 'sentinel_host_port_present');
    if (portError) return portError;
    if (host.Sysctls?.['net.ipv4.ip_unprivileged_port_start'] !== '0') {
        return { ok: false, reason: 'sentinel_port_sysctl_mismatch' };
    }
    return { ok: true, reason: 'success' };
}

module.exports = {
    API_ALIAS,
    API_IP,
    API_REASON_CODES,
    IMAGE_LABEL,
    INTERNAL_SUBNET,
    PEER_ALIAS,
    PEER_IP,
    PEER_REASON_CODES,
    RUNTIME_REASON_CODES,
    SCOPED_CREDENTIALS,
    SENTINEL_IP,
    SENTINEL_REASON_CODES,
    SENTINEL_SUBNET,
    TOPOLOGY_CONTRACT_REASONS,
    VALIDATION_LABEL,
    expectedApiTmpfs,
    validateApiTopology,
    validatePeerTopology,
    validatePrivateNetwork,
    validateSentinelTopology
};
