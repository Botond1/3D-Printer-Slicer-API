'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    API_REASON_CODES,
    validateApiTopology,
    validatePeerTopology,
    validateSentinelTopology
} = require('../../../scripts/i6-topology-contract');
const {
    API_NAME,
    IMAGE_LABEL,
    NETWORK,
    apiFixture,
    peerFixture,
    sentinelFixture
} = require('./helpers/i6-topology-fixtures');

test('accepts the exact private API, hardened peer, and external sentinel topology', () => {
    assert.deepEqual(validateApiTopology(apiFixture()), {ok: true, reason: 'success'});
    assert.deepEqual(validatePeerTopology(peerFixture()), {ok: true, reason: 'success'});
    assert.deepEqual(validateSentinelTopology(sentinelFixture()), {ok: true, reason: 'success'});
});

test('accepts both Docker projections of an unset peer DNS server list', () => {
    const fixture = peerFixture();
    fixture.container.HostConfig.Dns = [];
    assert.deepEqual(validatePeerTopology(fixture), {ok: true, reason: 'success'});
});

test('every API allowlisted predicate reason has an executable mutation', () => {
    const mutations = new Map([
        ['private_network_shape_invalid', (f) => { f.network.IPAM = null; }],
        ['private_network_internal_required', (f) => { f.network.Internal = false; }],
        ['private_network_driver_mismatch', (f) => { f.network.Driver = 'overlay'; }],
        ['private_network_subnet_mismatch', (f) => { f.network.IPAM.Config[0].Subnet = '10.0.0.0/24'; }],
        ['private_network_labels_mismatch', (f) => { f.network.Labels.extra = 'value'; }],
        ['api_container_shape_invalid', (f) => { f.container.HostConfig = null; }],
        ['api_network_mode_mismatch', (f) => { f.container.HostConfig.NetworkMode = 'bridge'; }],
        ['api_network_attachment_mismatch', (f) => { f.container.NetworkSettings.Networks.extra = {}; }],
        ['api_static_ip_mismatch', (f) => {
            f.container.NetworkSettings.Networks[NETWORK].IPAddress = '198.51.100.4';
        }],
        ['api_network_alias_mismatch', (f) => {
            f.container.NetworkSettings.Networks[NETWORK].Aliases = [API_NAME];
        }],
        ['api_dns_names_mismatch', (f) => {
            f.container.NetworkSettings.Networks[NETWORK].DNSNames.pop();
        }],
        ['api_image_mismatch', (f) => { f.container.Image = `sha256:${'b'.repeat(64)}`; }],
        ['api_container_labels_mismatch', (f) => { delete f.container.Config.Labels[IMAGE_LABEL]; }],
        ['api_user_mismatch', (f) => { f.container.Config.User = 'slicer'; }],
        ['api_readonly_root_required', (f) => { f.container.HostConfig.ReadonlyRootfs = false; }],
        ['api_cap_drop_mismatch', (f) => { f.container.HostConfig.CapDrop = []; }],
        ['api_cap_add_forbidden', (f) => { f.container.HostConfig.CapAdd = ['NET_ADMIN']; }],
        ['api_no_new_privileges_required', (f) => { f.container.HostConfig.SecurityOpt = []; }],
        ['api_dns_mismatch', (f) => { f.container.HostConfig.Dns = ['8.8.8.8']; }],
        ['api_trusted_peer_mismatch', (f) => {
            f.container.Config.Env[2] = 'TRUST_PROXY_CIDRS=198.51.100.0/28';
        }],
        ['api_host_port_present', (f) => {
            f.container.HostConfig.PortBindings = {
                '3000/tcp': [{HostIp: '127.0.0.1', HostPort: '31000'}]
            };
        }],
        ['api_resource_envelope_mismatch', (f) => { f.container.HostConfig.PidsLimit = 0; }],
        ['api_tmpfs_shape_mismatch', (f) => { delete f.container.HostConfig.Tmpfs['/tmp']; }],
        ['api_tmpfs_options_mismatch', (f) => {
            f.container.HostConfig.Tmpfs['/tmp'] = 'rw,size=64m';
        }],
        ['api_runtime_probe_shape', (f) => { f.runtimeProbe.externalDefaultRoute = 'false'; }],
        ['api_runtime_identity_mismatch', (f) => { f.runtimeProbe.uid = 0; }],
        ['api_default_route_present', (f) => { f.runtimeProbe.externalDefaultRoute = true; }]
    ]);
    assert.deepEqual([...mutations.keys()].sort(), [...API_REASON_CODES].filter(
        (reason) => reason !== 'success'
    ).sort());
    for (const [reason, mutate] of mutations) {
        const fixture = apiFixture();
        mutate(fixture);
        assert.deepEqual(validateApiTopology(fixture), {ok: false, reason});
    }
});
