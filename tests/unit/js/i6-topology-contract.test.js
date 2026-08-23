'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    API_ALIAS,
    API_IP,
    API_REASON_CODES,
    IMAGE_LABEL,
    INTERNAL_SUBNET,
    PEER_ALIAS,
    PEER_IP,
    PEER_REASON_CODES,
    SENTINEL_IP,
    SENTINEL_REASON_CODES,
    SENTINEL_SUBNET,
    VALIDATION_LABEL,
    expectedApiTmpfs,
    validateApiTopology,
    validatePeerTopology,
    validateSentinelTopology
} = require('../../../scripts/i6-topology-contract');

const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const NETWORK = 'i6-private-123-1';
const API_NAME = 'i6-api-123-1';
const PEER_NAME = 'i6-peer-123-1';
const SENTINEL_NETWORK = 'i6-sentinel-net-123-1';
const UID = '999';
const GID = '999';
const OPERATIONS_KEY = 'i6-validation-operations-active-260725-d1';
const API_CONTAINER_ID = 'd'.repeat(64);
const PEER_CONTAINER_ID = 'e'.repeat(64);
const LABELS = Object.freeze({
    [VALIDATION_LABEL]: 'true',
    [IMAGE_LABEL]: IMAGE_ID
});

function networkFixture() {
    return {
        Internal: true,
        Driver: 'bridge',
        IPAM: {Config: [{Subnet: INTERNAL_SUBNET}]},
        Labels: {...LABELS}
    };
}

function apiFixture() {
    return {
        network: networkFixture(),
        container: {
            Id: API_CONTAINER_ID,
            Image: IMAGE_ID,
            Config: {
                Labels: {...LABELS, 'org.opencontainers.image.title': 'slicer-api'},
                User: `${UID}:${GID}`,
                StopTimeout: 30,
                Env: ['PATH=/usr/bin:/bin', 'TRUST_PROXY=true', `TRUST_PROXY_CIDRS=${PEER_IP}`]
            },
            HostConfig: {
                NetworkMode: NETWORK,
                PortBindings: {},
                PublishAllPorts: false,
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                CapAdd: null,
                SecurityOpt: ['no-new-privileges'],
                Dns: [SENTINEL_IP],
                PidsLimit: 512,
                Memory: 4_294_967_296,
                MemorySwap: 4_294_967_296,
                NanoCpus: 2_000_000_000,
                LogConfig: {
                    Type: 'json-file',
                    Config: {'max-size': '20m', 'max-file': '5'}
                },
                Tmpfs: expectedApiTmpfs(UID, GID)
            },
            NetworkSettings: {
                Networks: {
                    [NETWORK]: {
                        IPAddress: API_IP,
                        Aliases: [API_ALIAS],
                        DNSNames: [API_NAME, API_ALIAS, API_CONTAINER_ID.slice(0, 12)]
                    }
                },
                Ports: {'3000/tcp': null}
            }
        },
        networkName: NETWORK,
        containerName: API_NAME,
        imageId: IMAGE_ID,
        uid: UID,
        gid: GID,
        runtimeProbe: {uid: 999, gid: 999, externalDefaultRoute: false}
    };
}

function peerFixture() {
    return {
        container: {
            Id: PEER_CONTAINER_ID,
            Image: IMAGE_ID,
            Config: {
                Labels: {...LABELS},
                User: `${UID}:${GID}`,
                StopTimeout: 5,
                Env: ['PATH=/usr/bin:/bin', `OPERATIONS_API_KEY=${OPERATIONS_KEY}`]
            },
            HostConfig: {
                NetworkMode: NETWORK,
                PortBindings: {},
                PublishAllPorts: false,
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                CapAdd: null,
                SecurityOpt: ['no-new-privileges'],
                Dns: null,
                DnsOptions: [],
                DnsSearch: [],
                Privileged: false,
                PidMode: '',
                IpcMode: 'private',
                UTSMode: '',
                UsernsMode: '',
                CgroupnsMode: 'private',
                Binds: null,
                Devices: [],
                PidsLimit: 64,
                Memory: 134_217_728,
                MemorySwap: 134_217_728,
                NanoCpus: 250_000_000,
                LogConfig: {
                    Type: 'json-file',
                    Config: {'max-size': '1m', 'max-file': '1'}
                },
                Tmpfs: {
                    '/tmp': `rw,nosuid,nodev,noexec,size=16m,uid=${UID},gid=${GID},mode=0700`
                }
            },
            Mounts: [],
            NetworkSettings: {
                Networks: {
                    [NETWORK]: {
                        IPAddress: PEER_IP,
                        Aliases: [PEER_ALIAS],
                        DNSNames: [PEER_NAME, PEER_ALIAS, PEER_CONTAINER_ID.slice(0, 12)]
                    }
                },
                Ports: {'3000/tcp': null}
            }
        },
        networkName: NETWORK,
        containerName: PEER_NAME,
        imageId: IMAGE_ID,
        uid: UID,
        gid: GID,
        operationsKey: OPERATIONS_KEY
    };
}

function sentinelFixture() {
    return {
        network: {
            Internal: false,
            Driver: 'bridge',
            IPAM: {Config: [{Subnet: SENTINEL_SUBNET}]},
            Labels: {...LABELS}
        },
        container: {
            Image: IMAGE_ID,
            Config: {Labels: {...LABELS}, User: `${UID}:${GID}`},
            HostConfig: {
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                CapAdd: null,
                SecurityOpt: ['no-new-privileges'],
                PortBindings: {},
                PublishAllPorts: false,
                Sysctls: {'net.ipv4.ip_unprivileged_port_start': '0'}
            },
            NetworkSettings: {
                Networks: {[SENTINEL_NETWORK]: {IPAddress: SENTINEL_IP}},
                Ports: {'3000/tcp': null}
            }
        },
        networkName: SENTINEL_NETWORK,
        imageId: IMAGE_ID,
        uid: UID,
        gid: GID
    };
}

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
