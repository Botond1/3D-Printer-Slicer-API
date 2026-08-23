'use strict';

const contract = require('./i11-publication-evidence');
const {createPublicationEvidenceWriter} = require('./publication-evidence-writer');

const writer = createPublicationEvidenceWriter(Object.freeze({
    contract,
    inputFile: 'i11-publication-draft.json',
    outputFile: 'i11-main-candidate-provenance.json',
    errorPrefix: 'i11',
    successMarker: 'i11_main_candidate_provenance=PASS'
}));

if (require.main === module) writer.main();

module.exports = writer;
