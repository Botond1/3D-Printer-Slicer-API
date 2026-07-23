'use strict';

const VALIDATION_LABEL = 'io.s3a.validation-only';
const IMAGE_LABEL = 'io.s3a.expected-image-id';
const PRIVATE_CONTAINER_PORT = '3000/tcp';
const PRIVATE_HOST_IP = '127.0.0.1';
const PRIVATE_HOST_PORT = '31000';

const PRIVATE_REASON_CODES = Object.freeze([
    'success',
    'private_network_shape_invalid',
    'private_network_internal_required',
    'private_network_driver_mismatch',
    'private_network_labels_mismatch',
    'private_container_shape_invalid',
    'private_network_mode_mismatch',
    'private_network_attachment_mismatch',
    'private_gateway_shape_invalid',
    'private_image_mismatch',
    'private_container_labels_mismatch',
    'private_user_mismatch',
    'private_readonly_root_required',
    'private_cap_drop_mismatch',
    'private_no_new_privileges_required',
    'private_dns_mismatch',
    'private_port_binding_shape',
    'private_port_binding_host_ip_mismatch',
    'private_port_binding_host_port_mismatch',
    'private_resource_envelope_mismatch',
    'private_tmpfs_shape_mismatch',
    'private_tmpfs_options_mismatch',
    'private_runtime_probe_shape',
    'private_runtime_identity_mismatch',
    'private_default_route_present'
]);

const SENTINEL_REASON_CODES = Object.freeze([
    'sentinel_network_shape_invalid',
    'sentinel_network_external_required',
    'sentinel_network_driver_mismatch',
    'sentinel_network_labels_mismatch',
    'sentinel_container_shape_invalid',
    'sentinel_network_attachment_mismatch',
    'sentinel_ip_mismatch',
    'sentinel_image_mismatch',
    'sentinel_container_labels_mismatch',
    'sentinel_readonly_root_required',
    'sentinel_cap_drop_mismatch',
    'sentinel_no_new_privileges_required',
    'sentinel_port_sysctl_mismatch'
]);

const TOPOLOGY_CONTRACT_REASONS = Object.freeze([
    ...PRIVATE_REASON_CODES,
    ...SENTINEL_REASON_CODES,
    'environment_contract_failure',
    'evidence_boundary_failure',
    'docker_command_unavailable',
    'private_runtime_probe_unavailable',
    'private_network_create_failure',
    'sentinel_network_create_failure',
    'sentinel_container_start_failure',
    'private_container_start_failure',
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
    'ingress_response_unbounded',
    'loopback_ingress_unavailable',
    'authenticated_readiness_unavailable',
    'authenticated_readiness_shape_failure',
    'topology_evidence_boundary_failure',
    'docker_command_failure',
    'docker_output_unbounded',
    'unclassified_failure'
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValidationLabels(labels, imageId) {
    if (!isPlainObject(labels)) return false;
    return labels[VALIDATION_LABEL] === 'true' && labels[IMAGE_LABEL] === imageId;
}

function hasExactValidationLabels(labels, imageId) {
    return hasValidationLabels(labels, imageId)
        && JSON.stringify(Object.keys(labels).sort())
            === JSON.stringify([IMAGE_LABEL, VALIDATION_LABEL].sort());
}

function normalizeTmpfs(value) {
    if (typeof value !== 'string') return null;
    const items = value.split(',');
    return items.length === new Set(items).size ? [...items].sort() : null;
}

function expectedPrivateTmpfs(uid, gid) {
    const value = `rw,nosuid,nodev,noexec,size=64m,uid=${uid},gid=${gid},mode=0700`;
    return {
        '/app/input': value,
        '/app/output': value,
        '/app/configs/pricing-state': value,
        '/tmp': value
    };
}

function validatePrivateNetwork(network, imageId) {
    if (!isPlainObject(network) || !isPlainObject(network.Labels)) {
        return { ok: false, reason: 'private_network_shape_invalid' };
    }
    if (network.Internal !== true) {
        return { ok: false, reason: 'private_network_internal_required' };
    }
    if (network.Driver !== 'bridge') {
        return { ok: false, reason: 'private_network_driver_mismatch' };
    }
    if (!hasExactValidationLabels(network.Labels, imageId)) {
        return { ok: false, reason: 'private_network_labels_mismatch' };
    }
    return null;
}

function validatePrivateContainer(container, expected) {
    const {networkName, imageId, syntheticDns} = expected;
    if (!isPlainObject(container) || !isPlainObject(container.HostConfig)
        || !isPlainObject(container.Config) || !isPlainObject(container.NetworkSettings)
        || !isPlainObject(container.NetworkSettings.Networks)) {
        return { ok: false, reason: 'private_container_shape_invalid' };
    }

    const host = container.HostConfig;
    const config = container.Config;
    const networks = container.NetworkSettings.Networks;
    if (host.NetworkMode !== networkName) {
        return { ok: false, reason: 'private_network_mode_mismatch' };
    }
    if (JSON.stringify(Object.keys(networks)) !== JSON.stringify([networkName])
        || !isPlainObject(networks[networkName])) {
        return { ok: false, reason: 'private_network_attachment_mismatch' };
    }
    const gateway = networks[networkName].Gateway;
    if (typeof gateway !== 'string' || gateway.length > 64) {
        return { ok: false, reason: 'private_gateway_shape_invalid' };
    }
    if (container.Image !== imageId) {
        return { ok: false, reason: 'private_image_mismatch' };
    }
    if (!hasValidationLabels(config.Labels, imageId)) {
        return { ok: false, reason: 'private_container_labels_mismatch' };
    }
    if (config.User !== 'slicer') {
        return { ok: false, reason: 'private_user_mismatch' };
    }
    if (host.ReadonlyRootfs !== true) {
        return { ok: false, reason: 'private_readonly_root_required' };
    }
    if (JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])) {
        return { ok: false, reason: 'private_cap_drop_mismatch' };
    }
    if (!Array.isArray(host.SecurityOpt)
        || !host.SecurityOpt.includes('no-new-privileges')) {
        return { ok: false, reason: 'private_no_new_privileges_required' };
    }
    if (JSON.stringify(host.Dns) !== JSON.stringify([syntheticDns])) {
        return { ok: false, reason: 'private_dns_mismatch' };
    }
    return null;
}

function validatePrivateBinding(host) {
    if (!isPlainObject(host.PortBindings)
        || JSON.stringify(Object.keys(host.PortBindings)) !== JSON.stringify([PRIVATE_CONTAINER_PORT])
        || !Array.isArray(host.PortBindings[PRIVATE_CONTAINER_PORT])
        || host.PortBindings[PRIVATE_CONTAINER_PORT].length !== 1
        || !isPlainObject(host.PortBindings[PRIVATE_CONTAINER_PORT][0])) {
        return { ok: false, reason: 'private_port_binding_shape' };
    }
    const binding = host.PortBindings[PRIVATE_CONTAINER_PORT][0];
    if (binding.HostIp !== PRIVATE_HOST_IP) {
        return { ok: false, reason: 'private_port_binding_host_ip_mismatch' };
    }
    if (binding.HostPort !== PRIVATE_HOST_PORT) {
        return { ok: false, reason: 'private_port_binding_host_port_mismatch' };
    }
    return null;
}

function validatePrivateResources(host, config, uid, gid) {
    const logConfig = host.LogConfig;
    if (host.PidsLimit !== 512 || host.Memory !== 4_294_967_296
        || host.MemorySwap !== 4_294_967_296 || host.NanoCpus !== 2_000_000_000
        || !isPlainObject(logConfig) || logConfig.Type !== 'json-file'
        || !isPlainObject(logConfig.Config) || logConfig.Config['max-size'] !== '20m'
        || logConfig.Config['max-file'] !== '5' || config.StopTimeout !== 30) {
        return { ok: false, reason: 'private_resource_envelope_mismatch' };
    }
    const expectedTmpfs = expectedPrivateTmpfs(uid, gid);
    if (!isPlainObject(host.Tmpfs)
        || JSON.stringify(Object.keys(host.Tmpfs).sort())
            !== JSON.stringify(Object.keys(expectedTmpfs).sort())) {
        return { ok: false, reason: 'private_tmpfs_shape_mismatch' };
    }
    for (const [target, expected] of Object.entries(expectedTmpfs)) {
        const actualOptions = normalizeTmpfs(host.Tmpfs[target]);
        if (!actualOptions
            || JSON.stringify(actualOptions) !== JSON.stringify(normalizeTmpfs(expected))) {
            return { ok: false, reason: 'private_tmpfs_options_mismatch' };
        }
    }
    return null;
}

function validatePrivateRuntime(runtimeProbe, uid, gid) {
    if (!isPlainObject(runtimeProbe)
        || JSON.stringify(Object.keys(runtimeProbe).sort())
            !== JSON.stringify(['externalDefaultRoute', 'gid', 'uid'])
        || !Number.isSafeInteger(runtimeProbe.uid) || !Number.isSafeInteger(runtimeProbe.gid)
        || typeof runtimeProbe.externalDefaultRoute !== 'boolean') {
        return { ok: false, reason: 'private_runtime_probe_shape' };
    }
    if (runtimeProbe.uid !== Number(uid) || runtimeProbe.gid !== Number(gid)
        || runtimeProbe.uid <= 0 || runtimeProbe.gid <= 0) {
        return { ok: false, reason: 'private_runtime_identity_mismatch' };
    }
    if (runtimeProbe.externalDefaultRoute) {
        return { ok: false, reason: 'private_default_route_present' };
    }
    return { ok: true, reason: 'success' };
}

function validatePrivateTopology(input) {
    const {
        network, container, networkName, imageId, uid, gid, syntheticDns, runtimeProbe
    } = input || {};
    return validatePrivateNetwork(network, imageId)
        || validatePrivateContainer(container, {networkName, imageId, syntheticDns})
        || validatePrivateBinding(container.HostConfig)
        || validatePrivateResources(container.HostConfig, container.Config, uid, gid)
        || validatePrivateRuntime(runtimeProbe, uid, gid);
}

function validateSentinelTopology(input) {
    const { network, container, networkName, imageId, syntheticIp } = input || {};
    if (!isPlainObject(network) || !isPlainObject(network.Labels)) {
        return { ok: false, reason: 'sentinel_network_shape_invalid' };
    }
    if (network.Internal !== false) {
        return { ok: false, reason: 'sentinel_network_external_required' };
    }
    if (network.Driver !== 'bridge') {
        return { ok: false, reason: 'sentinel_network_driver_mismatch' };
    }
    if (!hasExactValidationLabels(network.Labels, imageId)) {
        return { ok: false, reason: 'sentinel_network_labels_mismatch' };
    }
    if (!isPlainObject(container) || !isPlainObject(container.HostConfig)
        || !isPlainObject(container.Config) || !isPlainObject(container.NetworkSettings?.Networks)) {
        return { ok: false, reason: 'sentinel_container_shape_invalid' };
    }
    const networks = container.NetworkSettings.Networks;
    if (JSON.stringify(Object.keys(networks)) !== JSON.stringify([networkName])
        || !isPlainObject(networks[networkName])) {
        return { ok: false, reason: 'sentinel_network_attachment_mismatch' };
    }
    if (networks[networkName].IPAddress !== syntheticIp) {
        return { ok: false, reason: 'sentinel_ip_mismatch' };
    }
    if (container.Image !== imageId) {
        return { ok: false, reason: 'sentinel_image_mismatch' };
    }
    if (!hasValidationLabels(container.Config.Labels, imageId)) {
        return { ok: false, reason: 'sentinel_container_labels_mismatch' };
    }
    if (container.HostConfig.ReadonlyRootfs !== true) {
        return { ok: false, reason: 'sentinel_readonly_root_required' };
    }
    if (JSON.stringify(container.HostConfig.CapDrop) !== JSON.stringify(['ALL'])) {
        return { ok: false, reason: 'sentinel_cap_drop_mismatch' };
    }
    if (!Array.isArray(container.HostConfig.SecurityOpt)
        || !container.HostConfig.SecurityOpt.includes('no-new-privileges')) {
        return { ok: false, reason: 'sentinel_no_new_privileges_required' };
    }
    if (container.HostConfig.Sysctls?.['net.ipv4.ip_unprivileged_port_start'] !== '0') {
        return { ok: false, reason: 'sentinel_port_sysctl_mismatch' };
    }
    return { ok: true, reason: 'success' };
}

module.exports = {
    IMAGE_LABEL,
    PRIVATE_REASON_CODES,
    SENTINEL_REASON_CODES,
    TOPOLOGY_CONTRACT_REASONS,
    VALIDATION_LABEL,
    expectedPrivateTmpfs,
    validatePrivateTopology,
    validateSentinelTopology
};
