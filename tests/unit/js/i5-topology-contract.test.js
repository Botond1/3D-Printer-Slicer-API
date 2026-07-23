'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    IMAGE_LABEL,
    PRIVATE_REASON_CODES,
    SENTINEL_REASON_CODES,
    VALIDATION_LABEL,
    expectedPrivateTmpfs,
    validatePrivateTopology,
    validateSentinelTopology
} = require(path.resolve(__dirname, '../../../scripts/i5-topology-contract'));

const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const NETWORK = 'i5-private-123-1';
const SENTINEL_NETWORK = 'i5-sentinel-net-123-1';
const DNS = '192.0.2.2';
const UID = '999';
const GID = '999';
const LABELS = Object.freeze({
    [VALIDATION_LABEL]: 'true',
    [IMAGE_LABEL]: IMAGE_ID
});

function privateFixture(shape = 'hosted-linux-docker-28') {
    const runtimePorts = shape === 'docker-desktop-29'
        ? { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '31000' }] }
        : { '3000/tcp': [] };
    return {
        network: {
            Internal: true,
            Driver: 'bridge',
            Labels: { ...LABELS }
        },
        container: {
            Image: IMAGE_ID,
            Config: {
                Labels: { ...LABELS, 'org.opencontainers.image.title': 'slicer-api' },
                User: 'slicer',
                StopTimeout: 30
            },
            HostConfig: {
                NetworkMode: NETWORK,
                PortBindings: {
                    '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '31000' }]
                },
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                SecurityOpt: ['no-new-privileges'],
                Dns: [DNS],
                PidsLimit: 512,
                Memory: 4_294_967_296,
                MemorySwap: 4_294_967_296,
                NanoCpus: 2_000_000_000,
                LogConfig: {
                    Type: 'json-file',
                    Config: { 'max-size': '20m', 'max-file': '5' }
                },
                Tmpfs: expectedPrivateTmpfs(UID, GID)
            },
            NetworkSettings: {
                Networks: {
                    [NETWORK]: {
                        Gateway: shape === 'docker-desktop-29' ? '' : '198.51.100.1',
                        IPAddress: '198.51.100.2'
                    }
                },
                Ports: runtimePorts
            }
        },
        networkName: NETWORK,
        imageId: IMAGE_ID,
        uid: UID,
        gid: GID,
        syntheticDns: DNS,
        runtimeProbe: { uid: 999, gid: 999, externalDefaultRoute: false }
    };
}

function sentinelFixture() {
    return {
        network: { Internal: false, Driver: 'bridge', Labels: { ...LABELS } },
        container: {
            Image: IMAGE_ID,
            Config: { Labels: { ...LABELS } },
            HostConfig: {
                ReadonlyRootfs: true,
                CapDrop: ['ALL'],
                SecurityOpt: ['no-new-privileges'],
                Sysctls: { 'net.ipv4.ip_unprivileged_port_start': '0' }
            },
            NetworkSettings: {
                Networks: {
                    [SENTINEL_NETWORK]: { IPAddress: DNS }
                }
            }
        },
        networkName: SENTINEL_NETWORK,
        imageId: IMAGE_ID,
        syntheticIp: DNS
    };
}

test('Docker 28 and Docker Desktop 29 inspect shapes use canonical HostConfig binding', () => {
    for (const shape of ['hosted-linux-docker-28', 'docker-desktop-29']) {
        const fixture = privateFixture(shape);
        assert.deepEqual(validatePrivateTopology(fixture), { ok: true, reason: 'success' });
    }
    const fixture = privateFixture();
    assert.deepEqual(fixture.container.NetworkSettings.Ports['3000/tcp'], []);
    assert.deepEqual(fixture.container.HostConfig.PortBindings['3000/tcp'], [{
        HostIp: '127.0.0.1',
        HostPort: '31000'
    }]);
});

test('missing, multiple, and wildcard canonical port bindings fail closed', () => {
    const mutations = [
        [fixture => { fixture.container.HostConfig.PortBindings = {}; },
            'private_port_binding_shape'],
        [fixture => {
            fixture.container.HostConfig.PortBindings['3000/tcp'].push({
                HostIp: '127.0.0.1', HostPort: '31001'
            });
        }, 'private_port_binding_shape'],
        [fixture => {
            fixture.container.HostConfig.PortBindings['3000/tcp'][0].HostIp = '0.0.0.0';
        }, 'private_port_binding_host_ip_mismatch'],
        [fixture => {
            fixture.container.HostConfig.PortBindings['3000/tcp'][0].HostPort = '0';
        }, 'private_port_binding_host_port_mismatch']
    ];
    for (const [mutate, reason] of mutations) {
        const fixture = privateFixture();
        mutate(fixture);
        assert.deepEqual(validatePrivateTopology(fixture), { ok: false, reason });
    }
});

test('every private allowlisted predicate reason has an executable mutation', () => {
    const mutations = new Map([
        ['private_network_shape_invalid', f => { f.network.Labels = null; }],
        ['private_network_internal_required', f => { f.network.Internal = false; }],
        ['private_network_driver_mismatch', f => { f.network.Driver = 'overlay'; }],
        ['private_network_labels_mismatch', f => { f.network.Labels.extra = 'value'; }],
        ['private_container_shape_invalid', f => { f.container.HostConfig = null; }],
        ['private_network_mode_mismatch', f => { f.container.HostConfig.NetworkMode = 'bridge'; }],
        ['private_network_attachment_mismatch',
            f => { f.container.NetworkSettings.Networks.extra = { Gateway: '' }; }],
        ['private_gateway_shape_invalid',
            f => { f.container.NetworkSettings.Networks[NETWORK].Gateway = null; }],
        ['private_image_mismatch', f => { f.container.Image = `sha256:${'b'.repeat(64)}`; }],
        ['private_container_labels_mismatch',
            f => { delete f.container.Config.Labels[VALIDATION_LABEL]; }],
        ['private_user_mismatch', f => { f.container.Config.User = 'root'; }],
        ['private_readonly_root_required', f => { f.container.HostConfig.ReadonlyRootfs = false; }],
        ['private_cap_drop_mismatch', f => { f.container.HostConfig.CapDrop = []; }],
        ['private_no_new_privileges_required', f => { f.container.HostConfig.SecurityOpt = []; }],
        ['private_dns_mismatch', f => { f.container.HostConfig.Dns = ['8.8.8.8']; }],
        ['private_port_binding_shape', f => { f.container.HostConfig.PortBindings = []; }],
        ['private_port_binding_host_ip_mismatch',
            f => { f.container.HostConfig.PortBindings['3000/tcp'][0].HostIp = '::'; }],
        ['private_port_binding_host_port_mismatch',
            f => { f.container.HostConfig.PortBindings['3000/tcp'][0].HostPort = '31001'; }],
        ['private_resource_envelope_mismatch', f => { f.container.HostConfig.PidsLimit = 0; }],
        ['private_tmpfs_shape_mismatch', f => { delete f.container.HostConfig.Tmpfs['/tmp']; }],
        ['private_tmpfs_options_mismatch',
            f => { f.container.HostConfig.Tmpfs['/tmp'] = 'rw,size=64m'; }],
        ['private_runtime_probe_shape', f => { f.runtimeProbe.externalDefaultRoute = 'false'; }],
        ['private_runtime_identity_mismatch', f => { f.runtimeProbe.uid = 0; }],
        ['private_default_route_present', f => { f.runtimeProbe.externalDefaultRoute = true; }]
    ]);
    assert.deepEqual([...mutations.keys()].sort(),
        PRIVATE_REASON_CODES.filter(reason => reason !== 'success').sort());
    for (const [reason, mutate] of mutations) {
        const fixture = privateFixture();
        mutate(fixture);
        assert.deepEqual(validatePrivateTopology(fixture), { ok: false, reason });
    }
});

test('every sentinel allowlisted predicate reason has an executable mutation', () => {
    const mutations = new Map([
        ['sentinel_network_shape_invalid', f => { f.network.Labels = null; }],
        ['sentinel_network_external_required', f => { f.network.Internal = true; }],
        ['sentinel_network_driver_mismatch', f => { f.network.Driver = 'overlay'; }],
        ['sentinel_network_labels_mismatch', f => { f.network.Labels.extra = 'value'; }],
        ['sentinel_container_shape_invalid', f => { f.container.HostConfig = null; }],
        ['sentinel_network_attachment_mismatch',
            f => { f.container.NetworkSettings.Networks.extra = {}; }],
        ['sentinel_ip_mismatch',
            f => { f.container.NetworkSettings.Networks[SENTINEL_NETWORK].IPAddress = '192.0.2.3'; }],
        ['sentinel_image_mismatch', f => { f.container.Image = `sha256:${'c'.repeat(64)}`; }],
        ['sentinel_container_labels_mismatch',
            f => { delete f.container.Config.Labels[IMAGE_LABEL]; }],
        ['sentinel_readonly_root_required', f => { f.container.HostConfig.ReadonlyRootfs = false; }],
        ['sentinel_cap_drop_mismatch', f => { f.container.HostConfig.CapDrop = []; }],
        ['sentinel_no_new_privileges_required', f => { f.container.HostConfig.SecurityOpt = []; }],
        ['sentinel_port_sysctl_mismatch', f => { f.container.HostConfig.Sysctls = {}; }]
    ]);
    assert.deepEqual([...mutations.keys()].sort(), [...SENTINEL_REASON_CODES].sort());
    for (const [reason, mutate] of mutations) {
        const fixture = sentinelFixture();
        mutate(fixture);
        assert.deepEqual(validateSentinelTopology(fixture), { ok: false, reason });
    }
    assert.deepEqual(validateSentinelTopology(sentinelFixture()), { ok: true, reason: 'success' });
});
