'use strict';

const {TOPOLOGY_CONTRACT_REASONS} = require('./i5-topology-contract');

const TOPOLOGY_EVIDENCE_KEYS = Object.freeze([
  'classification',
  'contractReason',
  'sentinelOperational',
  'internalNetwork',
  'loopbackIngress',
  'authenticatedReadiness',
  'apiEgressDenied',
  'nativeEgressDenied',
]);

const CLASSIFICATIONS = Object.freeze([
  'success',
  'BLOCKED_S4_EGRESS_CAPABILITY',
  'BLOCKED_S4_HOSTED_RUNTIME_CAPABILITY',
  'topology_gate_failure',
]);

function validateTopologyEvidence(topology) {
  if (!topology || typeof topology !== 'object' || Array.isArray(topology)) {
    return 'topology_evidence_not_object';
  }
  if (JSON.stringify(Object.keys(topology).sort()) !==
      JSON.stringify([...TOPOLOGY_EVIDENCE_KEYS].sort())) {
    return 'topology_evidence_schema_mismatch';
  }
  if (!CLASSIFICATIONS.includes(topology.classification)) {
    return 'topology_evidence_classification_mismatch';
  }
  if (!TOPOLOGY_CONTRACT_REASONS.includes(topology.contractReason)) {
    return 'topology_evidence_reason_mismatch';
  }
  const booleanKeys = TOPOLOGY_EVIDENCE_KEYS.slice(2);
  if (booleanKeys.some((key) => typeof topology[key] !== 'boolean')) {
    return 'topology_evidence_boolean_mismatch';
  }
  if (topology.classification === 'success' &&
      (topology.contractReason !== 'success' ||
       booleanKeys.some((key) => topology[key] !== true))) {
    return 'topology_evidence_success_mismatch';
  }
  if (topology.classification !== 'success' &&
      topology.contractReason === 'success') {
    return 'topology_evidence_failure_reason_mismatch';
  }
  if (topology.classification === 'BLOCKED_S4_EGRESS_CAPABILITY') {
    const invariant = topology.sentinelOperational === true &&
      topology.internalNetwork === true &&
      topology.apiEgressDenied === true &&
      topology.nativeEgressDenied === true;
    const reasonMatches = topology.contractReason === 'loopback_ingress_unavailable'
      ? topology.loopbackIngress === false && topology.authenticatedReadiness === false
      : topology.contractReason === 'authenticated_readiness_unavailable' &&
        topology.loopbackIngress === true && topology.authenticatedReadiness === false;
    if (!invariant || !reasonMatches) {
      return 'topology_evidence_egress_classification_mismatch';
    }
  }
  if (topology.classification === 'BLOCKED_S4_HOSTED_RUNTIME_CAPABILITY') {
    const allowed = [
      'docker_command_unavailable',
      'private_runtime_probe_unavailable',
    ];
    if (!allowed.includes(topology.contractReason) ||
        topology.loopbackIngress !== false ||
        topology.authenticatedReadiness !== false ||
        topology.apiEgressDenied !== false ||
        topology.nativeEgressDenied !== false ||
        (topology.contractReason === 'private_runtime_probe_unavailable' &&
         (topology.sentinelOperational !== true ||
          topology.internalNetwork !== false))) {
      return 'topology_evidence_hosted_classification_mismatch';
    }
  }
  return null;
}

module.exports = {
  CLASSIFICATIONS,
  TOPOLOGY_EVIDENCE_KEYS,
  validateTopologyEvidence,
};
