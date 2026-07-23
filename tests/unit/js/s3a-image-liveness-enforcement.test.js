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
const TRIAGE_HELPER_PATH = path.join(ROOT, 'scripts/render-image-vulnerability-summary.js');
const TRIAGE_HELPER = fs.readFileSync(TRIAGE_HELPER_PATH, 'utf8').replace(/\r\n?/g, '\n');
const { MAX_FIELD_CHARACTERS, MAX_MATCHES, MAX_ROWS, MAX_SUMMARY_BYTES,
    renderSummary } = require(TRIAGE_HELPER_PATH);

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
    TRIAGE_OUTCOME: 'success',
    TRIAGE_CLASSIFICATION: 'success',
    DIAGNOSTIC_OUTCOME: 'success',
    RUNTIME_IDENTITY_OUTCOME: 'success',
    RUNTIME_IDENTITY_CLASSIFICATION: 'success',
    ORCA_CLI_SMOKE_OUTCOME: 'success',
    ORCA_CLI_SMOKE_CLASSIFICATION: 'success',
    TOPOLOGY_OUTCOME: 'success',
    TOPOLOGY_CLASSIFICATION: 'success',
    TOPOLOGY_CONTRACT_REASON: 'success',
    ARTIFACT_BOUNDARY_OUTCOME: 'success',
    EVIDENCE_UPLOAD_OUTCOME: 'success',
    CLEANUP_OUTCOME: 'success',
    CLEANUP_CLASSIFICATION: 'success'
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
        ['triage parser failure is independently fail-closed', { TRIAGE_OUTCOME: 'failure',
            TRIAGE_CLASSIFICATION: 'triage_parser_failure' }, 1,
        ['triage_parser_failure'], ['scanner_infrastructure_failure']],
        ['evidence boundary fails', { DIAGNOSTIC_OUTCOME: 'failure' }, 1,
        ['evidence_boundary_failure'], ['runtime_liveness_failure']],
        ['combined failures are not masked', { SMOKE_OUTCOME: 'failure', SBOM_OUTCOME: 'failure',
            SBOM_GATE_OUTCOME: 'failure', SBOM_CLASSIFICATION: 'sbom_infrastructure_failure',
            SCAN_GATE_OUTCOME: 'failure', SCAN_CLASSIFICATION: 'vulnerability_gate_failure',
            EVIDENCE_UPLOAD_OUTCOME: 'skipped' }, 1,
        ['runtime_liveness_failure', 'sbom_infrastructure_failure', 'vulnerability_gate_failure',
            'evidence_boundary_failure'], ['scanner_infrastructure_failure']],
        ['unknown scanner classification fails closed', { SCAN_GATE_OUTCOME: 'failure',
            SCAN_CLASSIFICATION: 'unexpected' }, 1, ['scanner_infrastructure_failure'], []],
        ['Orca CLI smoke fails independently', { ORCA_CLI_SMOKE_OUTCOME: 'failure',
            ORCA_CLI_SMOKE_CLASSIFICATION: 'orca_cli_smoke_failure' }, 1,
        ['orca_cli_smoke_failure'], ['runtime_liveness_failure']],
        ['topology success requires success reason',
            { TOPOLOGY_CONTRACT_REASON: 'private_image_mismatch' }, 1,
            ['topology_gate_failure'], ['runtime_liveness_failure']],
        ['cleanup outcome fails independently', { CLEANUP_OUTCOME: 'failure' }, 1,
            ['cleanup_failure'], ['evidence_boundary_failure']]
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

function grypeMatch(id, severity, name, version, type = 'deb', fixVersions = [], fixState = 'fixed') {
    return {
        vulnerability: { id, severity, fix: { versions: fixVersions, state: fixState } },
        artifact: { name, version, type }
    };
}

test('bounded triage renders only HIGH and CRITICAL findings in stable deduplicated order', () => {
    const report = { environment: 'forbidden-secret', sourcePath: '/forbidden/path', matches: [
        grypeMatch('CVE-LOW', 'Low', 'low-package', '1'),
        grypeMatch('CVE-HIGH-2', 'High', 'z-package', '2', 'npm', ['3']),
        grypeMatch('CVE-CRITICAL', 'Critical', 'critical-package', '1', 'python', ['2']),
        grypeMatch('CVE-HIGH-1', 'High', 'a-package', '1', 'deb', ['2', '3', '4', '5', '6', '7']),
        grypeMatch('CVE-HIGH-1', 'High', 'a-package', '1', 'deb', ['2', '3', '4', '5', '6', '7']),
        grypeMatch('CVE-MEDIUM', 'Medium', 'medium-package', '1'),
        grypeMatch('CVE-NEGLIGIBLE', 'Negligible', 'negligible-package', '1'),
        grypeMatch('CVE-UNKNOWN', 'Unknown', 'unknown-package', '1')
    ] };
    const summary = renderSummary(report);

    assert.match(summary, /Total HIGH\/CRITICAL matches: 4/);
    assert.match(summary, /Unique allowlisted rows: 3/);
    assert.doesNotMatch(summary, /CVE-LOW|CVE-MEDIUM|CVE-NEGLIGIBLE|CVE-UNKNOWN/);
    assert.doesNotMatch(summary, /forbidden-secret|forbidden\/path|sourcePath|environment/);
    assert.equal((summary.match(/CVE-HIGH-1/g) || []).length, 1);
    assert.ok(summary.indexOf('CVE-CRITICAL') < summary.indexOf('CVE-HIGH-1'));
    assert.ok(summary.indexOf('CVE-HIGH-1') < summary.indexOf('CVE-HIGH-2'));
    assert.match(summary, /2, 3, 4, 5, 6/);
    assert.doesNotMatch(summary, /2, 3, 4, 5, 6, 7/);
});

test('bounded triage enforces row, byte, field, and injection boundaries', () => {
    const ordinary = Array.from({ length: 60 }, (_, index) => grypeMatch(
        `CVE-NORMAL-${String(index).padStart(4, '0')}`, 'High', `package-${index}`, '1'
    ));
    const ordinaryRows = renderSummary({ matches: ordinary }).split('\n')
        .filter((line) => /^\| HIGH /.test(line));
    assert.equal(ordinaryRows.length, MAX_ROWS);

    const hostile = `line\r\n|\`%\u0001::warning::${'x'.repeat(400)}`;
    const matches = Array.from({ length: 80 }, (_, index) => grypeMatch(
        `CVE-${String(index).padStart(4, '0')}-${hostile}`,
        index % 2 ? 'High' : 'Critical', hostile, hostile, hostile,
        [hostile, hostile, hostile, hostile, hostile, hostile], hostile
    ));
    const summary = renderSummary({ matches });
    const dataRows = summary.split('\n').filter((line) => /^\| (?:HIGH|CRITICAL) /.test(line));

    assert.ok(dataRows.length <= MAX_ROWS);
    assert.ok(Buffer.byteLength(summary, 'utf8') <= MAX_SUMMARY_BYTES);
    assert.match(summary, /Truncated: yes/);
    assert.doesNotMatch(summary, /\r|`|%|\u0001|::warning::/);
    assert.doesNotMatch(summary, /environment|host\/container|full JSON/);
    for (const row of dataRows) {
        const fields = row.split(' | ').slice(1, -1);
        for (const field of fields) assert.ok(Array.from(field).length <= MAX_FIELD_CHARACTERS);
    }
});

test('bounded triage fails closed for missing or malformed matches arrays', () => {
    for (const report of [{}, { matches: null }, { matches: {} }, [], null]) {
        assert.throws(() => renderSummary(report), /triage_parser_failure/);
    }
    assert.throws(() => renderSummary({ matches: [
        { vulnerability: { id: 'CVE-BAD', severity: 'Critical' } }
    ] }), /triage_parser_failure/);
    assert.throws(() => renderSummary({ matches: Array(MAX_MATCHES + 1).fill(
        grypeMatch('CVE-LIMIT', 'High', 'package', '1')) }), /triage_parser_failure/);
});

test('triage CLI appends bounded output and fails closed without exact evidence binding', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's3a-triage-'));
    const input = path.join(directory, 'grype.json');
    const summary = path.join(directory, 'summary.md');
    fs.writeFileSync(input, JSON.stringify({ matches: [grypeMatch('CVE-CLI', 'High', 'package', '1')] }));
    fs.writeFileSync(summary, '');

    const success = spawnSync(process.execPath, [TRIAGE_HELPER_PATH], {
        cwd: ROOT,
        env: { ...process.env, EVIDENCE_DIR: directory, GRYPE_RESULT_PATH: input,
            GITHUB_STEP_SUMMARY: summary },
        encoding: 'utf8'
    });
    assert.equal(success.status, 0, success.stderr);
    assert.match(fs.readFileSync(summary, 'utf8'), /CVE-CLI/);

    const wrongBinding = spawnSync(process.execPath, [TRIAGE_HELPER_PATH], {
        cwd: ROOT,
        env: { ...process.env, EVIDENCE_DIR: directory,
            GRYPE_RESULT_PATH: path.join(directory, 'other.json'), GITHUB_STEP_SUMMARY: summary },
        encoding: 'utf8'
    });
    assert.equal(wrongBinding.status, 2);
    assert.match(wrongBinding.stderr, /triage_parser_failure/);
    assert.doesNotMatch(wrongBinding.stderr, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    fs.rmSync(directory, { recursive: true, force: true });
});

test('triage workflow remains observational and preserves scan, artifact, and cleanup contracts', () => {
    const triageStep = stepText('vulnerability_triage');
    const scanStep = stepText('scan');
    const boundaryStep = stepText('artifact_boundary');
    const cleanupStep = WORKFLOW.slice(WORKFLOW.indexOf('- name: Remove only this run'));

    assert.match(triageStep, /GRYPE_RESULT_PATH:/);
    assert.match(triageStep, /classification=triage_parser_failure/);
    assert.match(scanStep, /severity-cutoff: high/);
    assert.match(scanStep, /grype-version: v0\.110\.0/);
    assert.match(boundaryStep, /'image-identity\.txt': 16 \* 1024/);
    assert.match(boundaryStep, /'runtime-diagnostics\.json': 96 \* 1024/);
    assert.match(boundaryStep, /'sbom\.spdx\.json': 100 \* 1024 \* 1024/);
    assert.match(boundaryStep, /'grype\.json': 100 \* 1024 \* 1024/);
    assert.doesNotMatch(boundaryStep, /vulnerability-summary|triage-summary/);
    assert.match(cleanupStep, /no prune was run/);
    assert.match(cleanupStep,
        /if container_record="\$\(exact_container_record "\$exact_container"\)"; then[\s\S]*container_state=\$\?/);
    assert.match(cleanupStep, /container_ownership_failure/);
    assert.match(cleanupStep, /docker container rm --force "\$container_id"/);
    assert.match(cleanupStep,
        /if exact_image_present "\$IMAGE_REF"; then[\s\S]*image_state=\$\?/);
    assert.doesNotMatch(cleanupStep,
        /^\s*exact_(?:container|image)_present [^\n]+\n\s*(?:container|image)_state=\$\?/m);
    assert.ok(WORKFLOW.indexOf('id: exact_cleanup') < WORKFLOW.indexOf('id: final_enforcement'));
    assert.match(WORKFLOW, /push: false/);
    assert.doesNotMatch(WORKFLOW, /^\s*(?:docker\s+push|ssh\b|scp\b|rsync\b)/m);
});

test('triage mutation anchors reject weakened bounded-output and enforcement contracts', () => {
    const mutations = [
        ["new Set(['critical', 'high'])", "new Set(['critical', 'high', 'low'])"],
        ['const MAX_ROWS = 50;', 'const MAX_ROWS = 500;'],
        [".replace(/%/g, '&#37;')", ''],
        ['fs.appendFileSync(summaryPath, renderSummary(report));',
            'fs.appendFileSync(summaryPath, JSON.stringify(report));']
    ];
    for (const [anchor, replacement] of mutations) {
        assert.ok(TRIAGE_HELPER.includes(anchor), `Missing mutation anchor: ${anchor}`);
        assert.ok(!TRIAGE_HELPER.replace(anchor, replacement).includes(anchor));
    }

    assert.match(WORKFLOW, /severity-cutoff: high/);
    assert.match(WORKFLOW, /failures\.push\('vulnerability_gate_failure'\)/);
    const weakenedCutoff = WORKFLOW.replace('severity-cutoff: high', 'severity-cutoff: critical');
    const bypassedGate = WORKFLOW.replace("failures.push('vulnerability_gate_failure');", '');
    assert.doesNotMatch(weakenedCutoff, /severity-cutoff: high/);
    assert.doesNotMatch(bypassedGate, /failures\.push\('vulnerability_gate_failure'\)/);
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
        'configured_user=slicer',
        'service_uid=1001',
        'service_gid=1002',
        'kernel_uid=1001',
        'kernel_gid=1002',
        ''
    ].join('\n'));
    fs.writeFileSync(path.join(evidenceDir, 'sbom.spdx.json'), JSON.stringify({
        spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', packages: []
    }));
    fs.writeFileSync(path.join(evidenceDir, 'grype.json'), JSON.stringify({ matches: [] }));
    fs.writeFileSync(path.join(evidenceDir, 'runtime-diagnostics.json'), JSON.stringify(validDiagnostic()));
    fs.writeFileSync(path.join(evidenceDir, 'topology-evidence.json'), JSON.stringify({
        classification: 'success',
        contractReason: 'success',
        sentinelOperational: true,
        internalNetwork: true,
        loopbackIngress: true,
        authenticatedReadiness: true,
        apiEgressDenied: true,
        nativeEgressDenied: true
    }));
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
        CONFIGURED_USER: 'slicer',
        SERVICE_UID: '1001',
        SERVICE_GID: '1002',
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
