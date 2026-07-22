'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/image-validation.yml'), 'utf8')
    .replace(/\r\n?/g, '\n');

function stepText(id) {
    const lines = WORKFLOW.split('\n');
    const idIndex = lines.findIndex((line) => line === `        id: ${id}`);
    assert.notEqual(idIndex, -1, `Missing workflow step ${id}`);
    let start = idIndex;
    while (start >= 0 && !lines[start].startsWith('      - ')) start -= 1;
    let end = idIndex + 1;
    while (end < lines.length && !lines[end].startsWith('      - ')) end += 1;
    return lines.slice(start, end).join('\n');
}

function nodeHeredoc(id) {
    const match = stepText(id).match(/node <<'NODE'\n([\s\S]*?)\n\s+NODE(?:\n|$)/);
    assert.ok(match, `Missing Node heredoc in ${id}`);
    return match[1].replace(/^ {10}/gm, '');
}

function runNode(code, env) {
    return spawnSync(process.execPath, ['-e', code], {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: 'utf8'
    });
}

const FINAL_GATE = nodeHeredoc('final_enforcement');
const SUCCESS_ENV = Object.freeze({
    SMOKE_OUTCOME: 'success',
    SMOKE_CLASSIFICATION: 'success',
    SBOM_OUTCOME: 'success',
    SBOM_GATE_OUTCOME: 'success',
    SBOM_CLASSIFICATION: 'success',
    SCAN_OUTCOME: 'success',
    SCAN_GATE_OUTCOME: 'success',
    SCAN_CLASSIFICATION: 'success',
    DIAGNOSTIC_OUTCOME: 'success',
    ARTIFACT_BOUNDARY_OUTCOME: 'success',
    EVIDENCE_UPLOAD_OUTCOME: 'success'
});

function runFinal(overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's3a-final-'));
    const summary = path.join(directory, 'summary.md');
    fs.writeFileSync(summary, '');
    const result = runNode(FINAL_GATE, { ...SUCCESS_ENV, ...overrides, GITHUB_STEP_SUMMARY: summary });
    const text = fs.readFileSync(summary, 'utf8');
    fs.rmSync(directory, { recursive: true, force: true });
    return { ...result, summary: text };
}

test('final enforcement preserves independent fail-closed classifications', async (t) => {
    const cases = [
        ['all gates succeed', {}, 0, ['All independent'], []],
        ['runtime fails without scan bypass', { SMOKE_OUTCOME: 'failure' }, 1,
            ['runtime_liveness_failure'], ['sbom_infrastructure_failure', 'scanner_infrastructure_failure']],
        ['runtime classification cannot be masked by a successful step',
            { SMOKE_CLASSIFICATION: 'runtime_liveness_failure' }, 1,
            ['runtime_liveness_failure'], ['sbom_infrastructure_failure', 'scanner_infrastructure_failure']],
        ['SBOM infrastructure fails', { SBOM_OUTCOME: 'failure', SBOM_GATE_OUTCOME: 'failure',
            SBOM_CLASSIFICATION: 'sbom_infrastructure_failure' }, 1,
        ['sbom_infrastructure_failure'], ['runtime_liveness_failure']],
        ['scanner infrastructure fails', { SCAN_OUTCOME: 'failure', SCAN_GATE_OUTCOME: 'failure',
            SCAN_CLASSIFICATION: 'scanner_infrastructure_failure' }, 1,
        ['scanner_infrastructure_failure'], ['vulnerability_gate_failure']],
        ['high or critical finding fails', { SCAN_GATE_OUTCOME: 'failure',
            SCAN_CLASSIFICATION: 'vulnerability_gate_failure' }, 1,
        ['vulnerability_gate_failure'], ['scanner_infrastructure_failure']],
        ['evidence boundary fails', { DIAGNOSTIC_OUTCOME: 'failure' }, 1,
        ['evidence_boundary_failure'], ['runtime_liveness_failure']],
        ['combined failures are not masked', { SMOKE_OUTCOME: 'failure', SBOM_OUTCOME: 'failure',
            SBOM_GATE_OUTCOME: 'failure', SBOM_CLASSIFICATION: 'sbom_infrastructure_failure',
            SCAN_GATE_OUTCOME: 'failure', SCAN_CLASSIFICATION: 'vulnerability_gate_failure',
            EVIDENCE_UPLOAD_OUTCOME: 'skipped' }, 1,
        ['runtime_liveness_failure', 'sbom_infrastructure_failure', 'vulnerability_gate_failure',
            'evidence_boundary_failure'], ['scanner_infrastructure_failure']],
        ['unknown scanner classification fails closed', { SCAN_GATE_OUTCOME: 'failure',
            SCAN_CLASSIFICATION: 'unexpected' }, 1, ['scanner_infrastructure_failure'], []]
    ];

    for (const [name, overrides, status, included, excluded] of cases) {
        await t.test(name, () => {
            const result = runFinal(overrides);
            assert.equal(result.status, status, result.stderr);
            for (const marker of included) assert.match(result.summary, new RegExp(marker));
            for (const marker of excluded) assert.doesNotMatch(result.summary, new RegExp(marker));
        });
    }
});

const BOUNDARY = nodeHeredoc('artifact_boundary');
const CANDIDATE_SHA = 'a'.repeat(40);
const IMAGE_REF = `local/slicer-api-validation:${CANDIDATE_SHA}`;

function validDiagnostic() {
    return {
        running: false,
        exitCode: 1,
        oomKilled: false,
        engineError: '',
        startedAt: '2026-07-22T00:00:00Z',
        finishedAt: '2026-07-22T00:00:01Z',
        healthStatus: 'unhealthy',
        healthLog: [{ start: '', end: '', exitCode: 1, output: 'bounded' }],
        containerLog: 'bounded'
    };
}

function createEvidence() {
    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 's3a-boundary-'));
    const subdir = 'run-evidence';
    const evidenceDir = path.join(runnerTemp, subdir);
    fs.mkdirSync(evidenceDir, { mode: 0o700 });
    fs.writeFileSync(path.join(evidenceDir, 'image-identity.txt'), [
        `candidate_sha=${CANDIDATE_SHA}`,
        `local_image_ref=${IMAGE_REF}`,
        `local_image_id=sha256:${'b'.repeat(64)}`,
        'build_action_image_id=',
        'identity_scope=local-loaded-image-only',
        'registry_digest=not_applicable_no_push',
        'signature=not_created',
        'attestation=not_created',
        ''
    ].join('\n'));
    fs.writeFileSync(path.join(evidenceDir, 'sbom.spdx.json'), JSON.stringify({
        spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', packages: []
    }));
    fs.writeFileSync(path.join(evidenceDir, 'grype.json'), JSON.stringify({ matches: [] }));
    fs.writeFileSync(path.join(evidenceDir, 'runtime-diagnostics.json'), JSON.stringify(validDiagnostic()));
    return { runnerTemp, subdir, evidenceDir };
}

function runBoundary(evidence, overrides = {}) {
    const output = path.join(evidence.runnerTemp, 'output.txt');
    fs.writeFileSync(output, '');
    return runNode(BOUNDARY, {
        RUNNER_TEMP: evidence.runnerTemp,
        EVIDENCE_SUBDIR: evidence.subdir,
        EVIDENCE_DIR: evidence.evidenceDir,
        CANDIDATE_SHA,
        IMAGE_REF,
        GITHUB_OUTPUT: output,
        ...overrides
    });
}

test('runtime diagnostic evidence boundary rejects path, name, shape, and size attacks', async (t) => {
    const cases = [
        ['valid exact evidence', () => {}, 0],
        ['wrong evidence root', () => ({ EVIDENCE_DIR: os.tmpdir() }), 2],
        ['missing diagnostic name', (e) => fs.renameSync(path.join(e.evidenceDir, 'runtime-diagnostics.json'),
            path.join(e.evidenceDir, 'unexpected.json')), 2],
        ['unexpected diagnostic field', (e) => fs.writeFileSync(path.join(e.evidenceDir, 'runtime-diagnostics.json'),
            JSON.stringify({ ...validDiagnostic(), environment: ['forbidden'] })), 2],
        ['oversized diagnostic', (e) => fs.writeFileSync(path.join(e.evidenceDir, 'runtime-diagnostics.json'),
            'x'.repeat(96 * 1024 + 1)), 2]
    ];

    for (const [name, mutate, status] of cases) {
        await t.test(name, () => {
            const evidence = createEvidence();
            const override = mutate(evidence) || {};
            const result = runBoundary(evidence, override);
            assert.equal(result.status, status, result.stderr);
            fs.rmSync(evidence.runnerTemp, { recursive: true, force: true });
        });
    }
});
