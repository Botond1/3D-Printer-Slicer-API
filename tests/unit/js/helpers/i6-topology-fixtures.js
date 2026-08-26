'use strict';

const {
    API_ALIAS,
    API_IP,
    IMAGE_LABEL,
    INTERNAL_SUBNET,
    PEER_ALIAS,
    PEER_IP,
    SENTINEL_IP,
    SENTINEL_SUBNET,
    VALIDATION_LABEL,
    expectedApiTmpfs
} = require('../../../../scripts/i6-topology-contract');

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

module.exports = {
    API_NAME,
    IMAGE_ID,
    IMAGE_LABEL,
    NETWORK,
    PEER_NAME,
    SENTINEL_NETWORK,
    apiFixture,
    peerFixture,
    sentinelFixture
};
