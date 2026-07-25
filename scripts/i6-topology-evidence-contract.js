'use strict';

const {TOPOLOGY_CONTRACT_REASONS} = require('./i6-topology-contract');

const TOPOLOGY_EVIDENCE_VERSION = 'i6-s5-private-peer-v1';
const TOPOLOGY_BOOLEAN_KEYS = Object.freeze([
    'privatePeerIngress',
    'authenticatedReadiness',
    'authRejectionProof',
    'apiEgressDenied',
    'nativeEgressDenied',
    'hostPortAbsent',
    'apiNoDefaultRoute',
    'internalNetwork',
    'sentinelOperational'
]);
const TOPOLOGY_EVIDENCE_KEYS = Object.freeze([
    'version',
    'classification',
    'contractReason',
    ...TOPOLOGY_BOOLEAN_KEYS
]);
const CLASSIFICATIONS = Object.freeze([
    'success',
    'BLOCKED_I6_PRIVATE_PEER_CAPABILITY',
    'BLOCKED_I6_EGRESS_ENFORCEMENT',
    'BLOCKED_I6_RUNTIME_CAPABILITY',
    'topology_gate_failure'
]);
const PRIVATE_PEER_BLOCKED_REASONS = Object.freeze([
    'private_peer_probe_unavailable',
    'private_peer_probe_execution_failure',
    'private_peer_ingress_unavailable',
    'authenticated_readiness_unavailable',
    'authenticated_readiness_and_auth_rejection_unavailable',
    'auth_rejection_proof_unavailable'
]);
const EGRESS_BLOCKED_REASONS = Object.freeze([
    'api_egress_not_denied',
    'native_egress_not_denied',
    'api_and_native_egress_not_denied'
]);
const RUNTIME_BLOCKED_REASONS = Object.freeze([
    'docker_command_unavailable',
    'private_runtime_probe_unavailable'
]);
const BLOCKED_REASONS = Object.freeze([
    ...PRIVATE_PEER_BLOCKED_REASONS,
    ...EGRESS_BLOCKED_REASONS,
    ...RUNTIME_BLOCKED_REASONS
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
    return isPlainObject(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function allTrue(topology, keys) {
    return keys.every((key) => topology[key] === true);
}

function allFalse(topology, keys) {
    return keys.every((key) => topology[key] === false);
}

function validatePrivatePeerBlocked(topology) {
    if (!PRIVATE_PEER_BLOCKED_REASONS.includes(topology.contractReason)
        || !allTrue(topology, [
            'apiEgressDenied',
            'nativeEgressDenied',
            'hostPortAbsent',
            'apiNoDefaultRoute',
            'internalNetwork',
            'sentinelOperational'
        ])) {
        return 'topology_evidence_private_peer_classification_mismatch';
    }
    const tuple = [
        topology.privatePeerIngress,
        topology.authenticatedReadiness,
        topology.authRejectionProof
    ];
    const expected = {
        private_peer_probe_unavailable: [false, false, false],
        private_peer_probe_execution_failure: [false, false, false],
        private_peer_ingress_unavailable: [false, false, false],
        authenticated_readiness_unavailable: [true, false, true],
        authenticated_readiness_and_auth_rejection_unavailable: [true, false, false],
        auth_rejection_proof_unavailable: [true, true, false]
    }[topology.contractReason];
    return JSON.stringify(tuple) === JSON.stringify(expected)
        ? null : 'topology_evidence_private_peer_classification_mismatch';
}

function validateEgressBlocked(topology) {
    if (!EGRESS_BLOCKED_REASONS.includes(topology.contractReason)
        || !allFalse(topology, [
            'privatePeerIngress',
            'authenticatedReadiness',
            'authRejectionProof'
        ])
        || !allTrue(topology, [
            'hostPortAbsent',
            'apiNoDefaultRoute',
            'internalNetwork',
            'sentinelOperational'
        ])) {
        return 'topology_evidence_egress_classification_mismatch';
    }
    const tuple = [topology.apiEgressDenied, topology.nativeEgressDenied];
    const expected = {
        api_egress_not_denied: [false, true],
        native_egress_not_denied: [true, false],
        api_and_native_egress_not_denied: [false, false]
    }[topology.contractReason];
    return JSON.stringify(tuple) === JSON.stringify(expected)
        ? null : 'topology_evidence_egress_classification_mismatch';
}

function validateRuntimeBlocked(topology) {
    if (!RUNTIME_BLOCKED_REASONS.includes(topology.contractReason)) {
        return 'topology_evidence_runtime_classification_mismatch';
    }
    if (topology.contractReason === 'docker_command_unavailable') {
        return allFalse(topology, TOPOLOGY_BOOLEAN_KEYS)
            ? null : 'topology_evidence_runtime_classification_mismatch';
    }
    const expectedTrue = topology.sentinelOperational === true;
    const otherKeys = TOPOLOGY_BOOLEAN_KEYS.filter((key) => key !== 'sentinelOperational');
    return expectedTrue && allFalse(topology, otherKeys)
        ? null : 'topology_evidence_runtime_classification_mismatch';
}

function validateTopologyEvidence(topology) {
    if (!hasExactKeys(topology, TOPOLOGY_EVIDENCE_KEYS)) {
        return isPlainObject(topology)
            ? 'topology_evidence_schema_mismatch' : 'topology_evidence_not_object';
    }
    if (topology.version !== TOPOLOGY_EVIDENCE_VERSION) {
        return 'topology_evidence_version_mismatch';
    }
    if (!CLASSIFICATIONS.includes(topology.classification)) {
        return 'topology_evidence_classification_mismatch';
    }
    if (!TOPOLOGY_CONTRACT_REASONS.includes(topology.contractReason)) {
        return 'topology_evidence_reason_mismatch';
    }
    if (TOPOLOGY_BOOLEAN_KEYS.some((key) => typeof topology[key] !== 'boolean')) {
        return 'topology_evidence_boolean_mismatch';
    }
    if (topology.classification === 'success') {
        return topology.contractReason === 'success'
            && allTrue(topology, TOPOLOGY_BOOLEAN_KEYS)
            ? null : 'topology_evidence_success_mismatch';
    }
    if (topology.contractReason === 'success') {
        return 'topology_evidence_failure_reason_mismatch';
    }
    if (topology.classification === 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY') {
        return validatePrivatePeerBlocked(topology);
    }
    if (topology.classification === 'BLOCKED_I6_EGRESS_ENFORCEMENT') {
        return validateEgressBlocked(topology);
    }
    if (topology.classification === 'BLOCKED_I6_RUNTIME_CAPABILITY') {
        return validateRuntimeBlocked(topology);
    }
    if (BLOCKED_REASONS.includes(topology.contractReason)) {
        return 'topology_evidence_failure_classification_mismatch';
    }
    return null;
}

module.exports = {
    BLOCKED_REASONS,
    CLASSIFICATIONS,
    EGRESS_BLOCKED_REASONS,
    PRIVATE_PEER_BLOCKED_REASONS,
    RUNTIME_BLOCKED_REASONS,
    TOPOLOGY_BOOLEAN_KEYS,
    TOPOLOGY_EVIDENCE_KEYS,
    TOPOLOGY_EVIDENCE_VERSION,
    validateTopologyEvidence
};
