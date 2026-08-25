'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PEER_REASON_CODES,
    SENTINEL_REASON_CODES,
    validatePeerTopology,
    validateSentinelTopology
} = require('../../../scripts/i6-topology-contract');
const {
    IMAGE_LABEL,
    NETWORK,
    PEER_NAME,
    SENTINEL_NETWORK,
    peerFixture,
    sentinelFixture
} = require('./helpers/i6-topology-fixtures');

test('every peer allowlisted predicate reason has an executable mutation', () => {
    const mutations = new Map([
        ['peer_container_shape_invalid', (f) => { f.container.Config = null; }],
        ['peer_network_mode_mismatch', (f) => { f.container.HostConfig.NetworkMode = 'host'; }],
        ['peer_network_attachment_mismatch', (f) => { f.container.NetworkSettings.Networks.extra = {}; }],
        ['peer_static_ip_mismatch', (f) => {
            f.container.NetworkSettings.Networks[NETWORK].IPAddress = '198.51.100.4';
        }],
        ['peer_network_alias_mismatch', (f) => {
            f.container.NetworkSettings.Networks[NETWORK].Aliases = [PEER_NAME];
        }],
        ['peer_dns_names_mismatch', (f) => {
            f.container.NetworkSettings.Networks[NETWORK].DNSNames.push('extra');
        }],
        ['peer_image_mismatch', (f) => { f.container.Image = `sha256:${'b'.repeat(64)}`; }],
        ['peer_container_labels_mismatch', (f) => { delete f.container.Config.Labels[IMAGE_LABEL]; }],
        ['peer_user_mismatch', (f) => { f.container.Config.User = 'root'; }],
        ['peer_readonly_root_required', (f) => { f.container.HostConfig.ReadonlyRootfs = false; }],
        ['peer_cap_drop_mismatch', (f) => { f.container.HostConfig.CapDrop = []; }],
        ['peer_cap_add_forbidden', (f) => { f.container.HostConfig.CapAdd = ['SYS_ADMIN']; }],
        ['peer_no_new_privileges_required', (f) => { f.container.HostConfig.SecurityOpt = []; }],
        ['peer_dns_override_forbidden', (f) => { f.container.HostConfig.Dns = ['8.8.8.8']; }],
        ['peer_host_port_present', (f) => { f.container.HostConfig.PublishAllPorts = true; }],
        ['peer_privileged_forbidden', (f) => { f.container.HostConfig.Privileged = true; }],
        ['peer_host_namespace_forbidden', (f) => { f.container.HostConfig.PidMode = 'host'; }],
        ['peer_host_mount_forbidden', (f) => {
            f.container.HostConfig.Binds = ['/var/run/docker.sock:/var/run/docker.sock'];
        }],
        ['peer_resource_envelope_mismatch', (f) => { f.container.HostConfig.Memory = 0; }],
        ['peer_tmpfs_mismatch', (f) => { f.container.HostConfig.Tmpfs['/tmp'] = 'rw'; }],
        ['peer_credential_scope_mismatch', (f) => {
            f.container.Config.Env.push('SLICE_SERVICE_API_KEY=leaked');
        }]
    ]);
    assert.deepEqual([...mutations.keys()].sort(), [...PEER_REASON_CODES].sort());
    for (const [reason, mutate] of mutations) {
        const fixture = peerFixture();
        mutate(fixture);
        assert.deepEqual(validatePeerTopology(fixture), {ok: false, reason});
    }
});
test('peer DNS override predicate rejects every Docker DNS override field', () => {
    for (const [field, value] of [
        ['Dns', ['8.8.8.8']],
        ['DnsOptions', ['ndots:1']],
        ['DnsSearch', ['example.invalid']]
    ]) {
        const fixture = peerFixture();
        fixture.container.HostConfig[field] = value;
        assert.deepEqual(validatePeerTopology(fixture), {
            ok: false,
            reason: 'peer_dns_override_forbidden'
        });
    }
});

test('peer credential scope rejects every consumer-specific slice credential', () => {
    for (const name of [
        'SLICE_SERVICE_WOOCOMMERCE_API_KEY',
        'SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS',
        'SLICE_SERVICE_LEADPILOT_API_KEY',
        'SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS'
    ]) {
        const fixture = peerFixture();
        fixture.container.Config.Env.push(`${name}=inert-leak-sentinel`);
        assert.deepEqual(validatePeerTopology(fixture), {
            ok: false,
            reason: 'peer_credential_scope_mismatch'
        }, name);
    }
});

test('every sentinel allowlisted predicate reason has an executable mutation', () => {
    const mutations = new Map([
        ['sentinel_network_shape_invalid', (f) => { f.network.IPAM = null; }],
        ['sentinel_network_external_required', (f) => { f.network.Internal = true; }],
        ['sentinel_network_driver_mismatch', (f) => { f.network.Driver = 'overlay'; }],
        ['sentinel_network_subnet_mismatch', (f) => {
            f.network.IPAM.Config[0].Subnet = '192.0.2.0/24';
        }],
        ['sentinel_network_labels_mismatch', (f) => { f.network.Labels.extra = 'value'; }],
        ['sentinel_container_shape_invalid', (f) => { f.container.HostConfig = null; }],
        ['sentinel_network_attachment_mismatch', (f) => {
            f.container.NetworkSettings.Networks.extra = {};
        }],
        ['sentinel_ip_mismatch', (f) => {
            f.container.NetworkSettings.Networks[SENTINEL_NETWORK].IPAddress = '192.0.2.3';
        }],
        ['sentinel_image_mismatch', (f) => { f.container.Image = `sha256:${'c'.repeat(64)}`; }],
        ['sentinel_container_labels_mismatch', (f) => {
            delete f.container.Config.Labels[IMAGE_LABEL];
        }],
        ['sentinel_user_mismatch', (f) => { f.container.Config.User = 'slicer'; }],
        ['sentinel_readonly_root_required', (f) => { f.container.HostConfig.ReadonlyRootfs = false; }],
        ['sentinel_cap_drop_mismatch', (f) => { f.container.HostConfig.CapDrop = []; }],
        ['sentinel_cap_add_forbidden', (f) => { f.container.HostConfig.CapAdd = ['NET_ADMIN']; }],
        ['sentinel_no_new_privileges_required', (f) => { f.container.HostConfig.SecurityOpt = []; }],
        ['sentinel_host_port_present', (f) => { f.container.HostConfig.PublishAllPorts = true; }],
        ['sentinel_port_sysctl_mismatch', (f) => { f.container.HostConfig.Sysctls = {}; }]
    ]);
    assert.deepEqual([...mutations.keys()].sort(), [...SENTINEL_REASON_CODES].sort());
    for (const [reason, mutate] of mutations) {
        const fixture = sentinelFixture();
        mutate(fixture);
        assert.deepEqual(validateSentinelTopology(fixture), {ok: false, reason});
    }
});
