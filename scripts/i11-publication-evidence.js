'use strict';

const {createPublicationEvidenceContract} = require('./publication-evidence-contract');

module.exports = createPublicationEvidenceContract(Object.freeze({
    schemaVersion: 'i11-main-signed-candidate-provenance-v1',
    sourceRef: 'refs/heads/main',
    workflowName: 'Candidate Publication - Signed GHCR (NO DEPLOY)',
    workflowPath: '.github/workflows/candidate-publication.yml',
    aggregatorResult: 'I11_MAIN_CANDIDATE_EVIDENCE_READY',
    publicationPolicy: 'recoverable'
}));
