'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateTopologyEvidence,
} = require('../../../scripts/i5-topology-evidence-contract');

function validEvidence(overrides = {}) {
  return {
    classification: 'success',
    contractReason: 'success',
    sentinelOperational: true,
    internalNetwork: true,
    loopbackIngress: true,
    authenticatedReadiness: true,
    apiEgressDenied: true,
    nativeEgressDenied: true,
    ...overrides,
  };
}

test('accepts exact successful topology evidence', () => {
  assert.equal(validateTopologyEvidence(validEvidence()), null);
});

test('rejects missing, extra, and excessive evidence fields', () => {
  const missing = validEvidence();
  delete missing.contractReason;
  assert.equal(validateTopologyEvidence(missing), 'topology_evidence_schema_mismatch');
  for (const extra of [
    {inspect: {NetworkSettings: {}}},
    {environment: 'A=secret'},
    {path: '/proc/net/route'},
    {secret: 'token'},
  ]) {
    assert.equal(
      validateTopologyEvidence(validEvidence(extra)),
      'topology_evidence_schema_mismatch',
    );
  }
});

test('rejects arbitrary and oversized reason strings', () => {
  assert.equal(
    validateTopologyEvidence(validEvidence({contractReason: 'arbitrary'})),
    'topology_evidence_reason_mismatch',
  );
  assert.equal(
    validateTopologyEvidence(validEvidence({contractReason: 'x'.repeat(65537)})),
    'topology_evidence_reason_mismatch',
  );
});

test('rejects incomplete success proof', () => {
  assert.equal(
    validateTopologyEvidence(validEvidence({loopbackIngress: false})),
    'topology_evidence_success_mismatch',
  );
});

test('accepts only bounded egress capability evidence', () => {
  const blocked = validEvidence({
    classification: 'BLOCKED_S4_EGRESS_CAPABILITY',
    contractReason: 'loopback_ingress_unavailable',
    loopbackIngress: false,
    authenticatedReadiness: false,
  });
  assert.equal(validateTopologyEvidence(blocked), null);
  assert.equal(
    validateTopologyEvidence({...blocked, internalNetwork: false}),
    'topology_evidence_egress_classification_mismatch',
  );
  assert.equal(
    validateTopologyEvidence({...blocked, loopbackIngress: true}),
    'topology_evidence_egress_classification_mismatch',
  );
  assert.equal(
    validateTopologyEvidence({
      ...blocked,
      contractReason: 'authenticated_readiness_unavailable',
      loopbackIngress: false,
    }),
    'topology_evidence_egress_classification_mismatch',
  );
});

test('rejects failure classifications carrying the success reason', () => {
  assert.equal(
    validateTopologyEvidence(validEvidence({classification: 'topology_gate_failure'})),
    'topology_evidence_failure_reason_mismatch',
  );
});

test('hosted-runtime capability evidence accepts only possible bounded tuples', () => {
  const hosted = validEvidence({
    classification: 'BLOCKED_S4_HOSTED_RUNTIME_CAPABILITY',
    contractReason: 'private_runtime_probe_unavailable',
    internalNetwork: false,
    loopbackIngress: false,
    authenticatedReadiness: false,
    apiEgressDenied: false,
    nativeEgressDenied: false,
  });
  assert.equal(validateTopologyEvidence(hosted), null);
  assert.equal(
    validateTopologyEvidence({
      ...hosted,
      contractReason: 'docker_command_unavailable',
      internalNetwork: true,
    }),
    null,
  );
  assert.equal(
    validateTopologyEvidence({...hosted, contractReason: 'private_image_mismatch'}),
    'topology_evidence_hosted_classification_mismatch',
  );
  assert.equal(
    validateTopologyEvidence({...hosted, apiEgressDenied: true}),
    'topology_evidence_hosted_classification_mismatch',
  );
  assert.equal(
    validateTopologyEvidence({...hosted, sentinelOperational: false}),
    'topology_evidence_hosted_classification_mismatch',
  );
});
