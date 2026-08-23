'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {TOPOLOGY_CONTRACT_REASONS} = require('../../../scripts/i6-topology-contract');
const {
    BLOCKED_REASONS,
    EGRESS_BLOCKED_REASONS,
    PRIVATE_PEER_BLOCKED_REASONS,
    RUNTIME_BLOCKED_REASONS,
    TOPOLOGY_BOOLEAN_KEYS,
    validateTopologyEvidence
} = require('../../../scripts/i6-topology-evidence-contract');

function validEvidence(overrides = {}) {
    return {
        version: 'i6-s5-private-peer-v1',
        classification: 'success',
        contractReason: 'success',
        privatePeerIngress: true,
        authenticatedReadiness: true,
        authRejectionProof: true,
        apiEgressDenied: true,
        nativeEgressDenied: true,
        hostPortAbsent: true,
        apiNoDefaultRoute: true,
        internalNetwork: true,
        sentinelOperational: true,
        ...overrides
    };
}

function peerBlocked(reason) {
    const tuples = {
        private_peer_probe_unavailable: [false, false, false],
        private_peer_probe_execution_failure: [false, false, false],
        private_peer_ingress_unavailable: [false, false, false],
        authenticated_readiness_unavailable: [true, false, true],
        authenticated_readiness_and_auth_rejection_unavailable: [true, false, false],
        auth_rejection_proof_unavailable: [true, true, false]
    };
    const [privatePeerIngress, authenticatedReadiness, authRejectionProof] = tuples[reason];
    return validEvidence({
        classification: 'BLOCKED_I6_PRIVATE_PEER_CAPABILITY',
        contractReason: reason,
        privatePeerIngress,
        authenticatedReadiness,
        authRejectionProof
    });
}

function egressBlocked(reason) {
    const tuples = {
        api_egress_not_denied: [false, true],
        native_egress_not_denied: [true, false],
        api_and_native_egress_not_denied: [false, false]
    };
    const [apiEgressDenied, nativeEgressDenied] = tuples[reason];
    return validEvidence({
        classification: 'BLOCKED_I6_EGRESS_ENFORCEMENT',
        contractReason: reason,
        privatePeerIngress: false,
        authenticatedReadiness: false,
        authRejectionProof: false,
        apiEgressDenied,
        nativeEgressDenied
    });
}

function runtimeBlocked(reason) {
    const evidence = validEvidence({
        classification: 'BLOCKED_I6_RUNTIME_CAPABILITY',
        contractReason: reason
    });
    for (const key of TOPOLOGY_BOOLEAN_KEYS) evidence[key] = false;
    if (reason === 'private_runtime_probe_unavailable') evidence.sentinelOperational = true;
    return evidence;
}

test('accepts only the exact versioned successful evidence tuple', () => {
    assert.equal(validateTopologyEvidence(validEvidence()), null);
    for (const key of TOPOLOGY_BOOLEAN_KEYS) {
        assert.equal(
            validateTopologyEvidence(validEvidence({[key]: false})),
            'topology_evidence_success_mismatch',
            key
        );
    }
    assert.equal(
        validateTopologyEvidence(validEvidence({version: 'i6-s5-private-peer-v2'})),
        'topology_evidence_version_mismatch'
    );
});

test('rejects missing, extra, non-boolean, arbitrary, and oversized evidence', () => {
    assert.equal(validateTopologyEvidence(null), 'topology_evidence_not_object');
    const missing = validEvidence();
    delete missing.contractReason;
    assert.equal(validateTopologyEvidence(missing), 'topology_evidence_schema_mismatch');
    assert.equal(
        validateTopologyEvidence(validEvidence({inspect: {NetworkSettings: {}}})),
        'topology_evidence_schema_mismatch'
    );
    assert.equal(
        validateTopologyEvidence(validEvidence({privatePeerIngress: 'true'})),
        'topology_evidence_boolean_mismatch'
    );
    assert.equal(
        validateTopologyEvidence(validEvidence({contractReason: 'arbitrary'})),
        'topology_evidence_reason_mismatch'
    );
    assert.equal(
        validateTopologyEvidence(validEvidence({contractReason: 'x'.repeat(65537)})),
        'topology_evidence_reason_mismatch'
    );
});

test('every private-peer blocked reason has one bounded accepted tuple', () => {
    assert.deepEqual([...PRIVATE_PEER_BLOCKED_REASONS].sort(), [
        'auth_rejection_proof_unavailable',
        'authenticated_readiness_and_auth_rejection_unavailable',
        'authenticated_readiness_unavailable',
        'private_peer_ingress_unavailable',
        'private_peer_probe_execution_failure',
        'private_peer_probe_unavailable'
    ]);
    for (const reason of PRIVATE_PEER_BLOCKED_REASONS) {
        const evidence = peerBlocked(reason);
        assert.equal(validateTopologyEvidence(evidence), null, reason);
        assert.equal(
            validateTopologyEvidence({...evidence, apiEgressDenied: false}),
            'topology_evidence_private_peer_classification_mismatch',
            reason
        );
        assert.equal(
            validateTopologyEvidence({...evidence, privatePeerIngress: !evidence.privatePeerIngress}),
            'topology_evidence_private_peer_classification_mismatch',
            reason
        );
    }
});

test('every egress-enforcement blocked reason has one bounded accepted tuple', () => {
    assert.deepEqual([...EGRESS_BLOCKED_REASONS].sort(), [
        'api_and_native_egress_not_denied',
        'api_egress_not_denied',
        'native_egress_not_denied'
    ]);
    for (const reason of EGRESS_BLOCKED_REASONS) {
        const evidence = egressBlocked(reason);
        assert.equal(validateTopologyEvidence(evidence), null, reason);
        assert.equal(
            validateTopologyEvidence({...evidence, privatePeerIngress: true}),
            'topology_evidence_egress_classification_mismatch',
            reason
        );
        assert.equal(
            validateTopologyEvidence({...evidence, apiNoDefaultRoute: false}),
            'topology_evidence_egress_classification_mismatch',
            reason
        );
    }
});

test('every runtime-capability blocked reason has one bounded accepted tuple', () => {
    assert.deepEqual([...RUNTIME_BLOCKED_REASONS].sort(), [
        'docker_command_unavailable',
        'private_runtime_probe_unavailable'
    ]);
    for (const reason of RUNTIME_BLOCKED_REASONS) {
        const evidence = runtimeBlocked(reason);
        assert.equal(validateTopologyEvidence(evidence), null, reason);
        assert.equal(
            validateTopologyEvidence({...evidence, internalNetwork: true}),
            'topology_evidence_runtime_classification_mismatch',
            reason
        );
    }
});

test('blocked reasons cannot be relabeled as success or generic gate failures', () => {
    assert.deepEqual([...BLOCKED_REASONS].sort(), [
        ...PRIVATE_PEER_BLOCKED_REASONS,
        ...EGRESS_BLOCKED_REASONS,
        ...RUNTIME_BLOCKED_REASONS
    ].sort());
    for (const reason of BLOCKED_REASONS) {
        assert.equal(
            validateTopologyEvidence(validEvidence({contractReason: reason})),
            'topology_evidence_success_mismatch',
            reason
        );
        assert.equal(
            validateTopologyEvidence(validEvidence({
                classification: 'topology_gate_failure',
                contractReason: reason
            })),
            'topology_evidence_failure_classification_mismatch',
            reason
        );
    }
});

test('every non-blocked allowlisted failure reason is accepted only as a gate failure', () => {
    const genericReasons = TOPOLOGY_CONTRACT_REASONS.filter(
        (reason) => reason !== 'success' && !BLOCKED_REASONS.includes(reason)
    );
    assert.ok(genericReasons.length > 0);
    for (const reason of genericReasons) {
        assert.equal(validateTopologyEvidence(validEvidence({
            classification: 'topology_gate_failure',
            contractReason: reason
        })), null, reason);
    }
    assert.equal(
        validateTopologyEvidence(validEvidence({classification: 'topology_gate_failure'})),
        'topology_evidence_failure_reason_mismatch'
    );
});
