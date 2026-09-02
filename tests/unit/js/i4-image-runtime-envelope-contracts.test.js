'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(ROOT, 'scripts/i4-image-runtime-envelope.js');
const WORKFLOW_PATH = path.join(ROOT, '.github/actions/exact-image-gate/action.yml');
const IMAGE_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const PUBLICATION_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/candidate-publication.yml');
const SOURCE = fs.readFileSync(HELPER_PATH, 'utf8').replace(/\r\n?/g, '\n');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');
const IMAGE_WORKFLOW = fs.readFileSync(IMAGE_WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');
const PUBLICATION_WORKFLOW = fs.readFileSync(PUBLICATION_WORKFLOW_PATH, 'utf8')
    .replace(/\r\n?/g, '\n');
const envelope = require(HELPER_PATH);
const {
    CONTAINER_PROBE_FAILURES
} = require(path.join(ROOT, 'scripts/i4-runtime-probe-contract'));

const IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const CONTAINER_ID = 'c'.repeat(64);
const UID = 1001;
const GID = 1002;
const RUN_ID = '30224324993';
const RUN_ATTEMPT = '1';

function step(id, source = WORKFLOW) {
    const marker = `        id: ${id}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing workflow step ${id}`);
    const end = source.indexOf('\n      - name:', start);
    return source.slice(start, end < 0 ? source.length : end);
}

function inspectLine(overrides = {}) {
    const values = {
        id: CONTAINER_ID,
        image: IMAGE_ID,
        readOnly: true,
        pids: 512,
        memory: 4 * 1024 * 1024 * 1024,
        memorySwap: 4 * 1024 * 1024 * 1024,
        nanoCpus: 2_000_000_000,
        logDriver: 'json-file',
        logSize: '20m',
        logFiles: '5',
        stopTimeout: 30,
        capDrop: ['ALL'],
        securityOpt: ['no-new-privileges'],
        tmpfs: envelope.expectedTmpfs(UID, GID),
        running: true,
        pid: 4321,
        ...overrides
    };
    return [
        values.id, values.image, values.readOnly, values.pids, values.memory,
        values.memorySwap, values.nanoCpus, values.logDriver, values.logSize,
        values.logFiles, values.stopTimeout, values.capDrop, values.securityOpt, values.tmpfs,
        values.running, values.pid
    ].map(JSON.stringify).join('\t');
}

function mainContainerName(source) {
    const match = source.match(/^\s+CONTAINER_NAME:\s+([^\n]+)$/m);
    assert.ok(match, 'missing workflow main container name');
    return match[1]
        .replace('${{ github.run_id }}', RUN_ID)
        .replace('${{ github.run_attempt }}', RUN_ATTEMPT);
}

function namespaceContract(imageWorkflow = IMAGE_WORKFLOW,
    publicationWorkflow = PUBLICATION_WORKFLOW,
    validate = envelope.validateContainerReference) {
    const validationName = mainContainerName(imageWorkflow);
    const publicationName = mainContainerName(publicationWorkflow);
    assert.equal(validationName, `s3a-validation-${RUN_ID}-${RUN_ATTEMPT}`);
    assert.equal(publicationName, `s3a-publication-${RUN_ID}-${RUN_ATTEMPT}`);
    assert.notEqual(validationName, publicationName);
    assert.equal(validate(validationName), validationName);
    assert.equal(validate(publicationName), publicationName);
    for (const rejected of [
        `s3a-production-${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-publish-${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-anything-${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-validation-${RUN_ID}`,
        `s3a-publication--${RUN_ATTEMPT}`,
        `s3a-validation-${RUN_ID}-${RUN_ATTEMPT}-extra`,
        `s3a-validation--${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-validation-${RUN_ID}.1-${RUN_ATTEMPT}`,
        `s3a-validation-0x10-${RUN_ATTEMPT}`,
        `s3a-validation-${RUN_ID}-A`,
        `s3a-validation-${RUN_ID}-${RUN_ATTEMPT} `,
        `s3a-publication-${RUN_ID}-${RUN_ATTEMPT}\n`,
        `s3a-publication/${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-publication:${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-publication-${RUN_ID}-${RUN_ATTEMPT};docker`,
        `other-publication-${RUN_ID}-${RUN_ATTEMPT}`,
        `s3a-publication-${'9'.repeat(200)}-${RUN_ATTEMPT}`
    ]) assert.throws(() => validate(rejected), { message: 'container_reference_invalid' });
}

function publicationNamespaceContract(source) {
    namespaceContract(IMAGE_WORKFLOW, source);
}

function helperContract(source) {
    for (const anchor of [
        "spawnSync(command, args,", 'shell: false', 'timeout: options.timeout || DOCKER_TIMEOUT_MS',
        'maxBuffer: MAX_COMMAND_BYTES', "IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/",
        "CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/", "'container', 'inspect', '--format'",
        "CONTAINER_REFERENCE_PATTERN = /^s3a-(?:validation|publication)-[0-9]+-[0-9]+$/",
        'MAX_CONTAINER_REFERENCE_BYTES = 128',
        "Buffer.byteLength(reference, 'utf8') > MAX_CONTAINER_REFERENCE_BYTES",
        'const reference = validateContainerReference(env.CONTAINER_NAME);',
        'record.image !== expected.imageId',
        "'container', 'exec', '--user'", "'run', '--rm', '--pull', 'never', '--network', 'none'",
        "'--cap-drop', 'ALL'", "'--security-opt', 'no-new-privileges'", "'--read-only'",
        "'--pids-limit', '64'", "'--memory', '1g'", "'--memory-swap', '1g'",
        "'--cpus', '0.5'", "'--stop-timeout', '10'", "'--log-driver', 'json-file'",
        "'--log-opt', 'max-size=5m'", "'--log-opt', 'max-file=1'",
        "'EXPECTED_PIDS_LIMIT=64'", "'EXPECTED_MEMORY_BYTES=1073741824'",
        "'EXPECTED_CPU_LIMIT=0.5'", "'EXPECTED_LOG_MAX_SIZE=5m'",
        "'EXPECTED_LOG_MAX_FILES=1'", "'EXPECTED_STOP_GRACE_PERIOD=10s'",
        "status: 78", "['slicer', String(gid)]", "[String(uid), '0']",
        'runtime_resource_contract_failure',
        'BLOCKED_S2_RUNTIME_CAPABILITY', '/app/configs/pricing-state',
        "'/tmp/slice-jobs'", "'/tmp/slicer-home'", "'/tmp/xdg-cache'",
        "'/tmp/xdg-config'", "'/tmp/xdg-runtime'",
        "TMPDIR: '/tmp'", "HOME: '/tmp/slicer-home'",
        "XDG_CACHE_HOME: '/tmp/xdg-cache'", "XDG_CONFIG_HOME: '/tmp/xdg-config'",
        "XDG_RUNTIME_DIR: '/tmp/xdg-runtime'",
        "'/app/configs/prusa'", "'/app/configs/orca'",
        '(stat.mode & 0o022) !== 0', '(stat.mode & 0o777) !== 0o700',
        'fs.realpathSync(directory) !== directory',
        "['EACCES', 'EROFS', 'EPERM']", "process.env.SLICE_SERVICE_API_KEY",
        "await slice('prusa');", "await slice('orca');", 'AbortSignal.timeout(300000)',
        "/^artifact-[a-f0-9]{32}$/.test(body?.artifact_id || '')",
        'await proveClientAbortNoArtifact();', "process.env.ARTIFACT_API_KEY",
        "process.env.OPERATIONS_API_KEY",
        "scopedJson('/operations/readiness', process.env.OPERATIONS_API_KEY)",
        "scopedJson('/health/detailed', process.env.OPERATIONS_API_KEY)",
        'async function cachedQueueStatus()', 'async function freshQueueStatus()',
        "scopedJson('/admin/output-files', process.env.ARTIFACT_API_KEY)",
        'controller.abort();', 'if (!controller.signal.aborted)',
        'evaluateAbortTransport(controller.signal.aborted, outcome)',
        'stderrReasons: CONTAINER_PROBE_FAILURES',
        'const cachedBefore = await cachedQueueStatus();',
        'cachedBefore.activeJobs !== 0 || cachedBefore.queueLength !== 0',
        'attempt < 18',
        'const queue = await freshQueueStatus();\n    if (queue.activeJobs === 1)',
        'queue.activeJobs === 1', 'queue.activeJobs === 0 && queue.queueLength === 0',
        'cachedDuring.activeJobs !== 0 || cachedDuring.queueLength !== 0',
        'cachedReadinessActiveJobs: abortProof.cachedReadinessActiveJobs',
        'freshReadinessActiveJobs: abortProof.freshReadinessActiveJobs',
        'sleep(5000).then(() => ({ timedOut: true }))',
        'JSON.stringify(afterInventory) !== JSON.stringify(beforeInventory)',
        'JSON.stringify(afterEntries) !== JSON.stringify(beforeEntries)',
        'postAbortArtifactDelta: 0',
        'NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION',
        "'container', 'top', record.id, '-eo', 'pid,ppid,comm'",
        'nonzeroCapability: true', "capability: 'docker_top_unavailable'",
        "Buffer.byteLength(text, 'utf8') > 4096", 'processes.length > 16',
        'processes.length === 1 && processes[0].pid === record.pid',
        'Atomics.wait(delayCell, 0, 0, 250)',
        'proveNoPostAbortDescendants(record);',
        'if (total > 65536)', "text.includes('/app/')", "'container', 'stop', '--timeout', '30'",
        "spawnSync('/usr/bin/ps'", 'processState.status !== 1',
        'const rootImmutable = (stat) => stat.uid === 0 && (stat.mode & 0o022) === 0 && !stat.isSymbolicLink();',
        "for (const target of ['/opt/bambustudio', '/opt/bambustudio/AppRun'])",
        "if (!rootImmutable(fs.lstatSync(target))) fail('immutable_mode');",
        "if (!stat.isFile() || !rootImmutable(stat) || (stat.mode & 0o111) === 0) fail('native_executable_mode');",
        "['/usr/local/bin/prusa-slicer', '/opt/prusaslicer/AppRun', /Usage:\\s+prusa-slicer/]",
        "['/usr/local/bin/orca-slicer', '/opt/orcaslicer/AppRun', /Usage:\\s+orca-slicer/]",
        "['/usr/local/bin/bambu-studio', '/usr/local/bin/bambu-studio', /Usage:\\s+bambu-studio/]",
        'fs.accessSync(executable, fs.constants.X_OK)',
        'if (target !== expectedTarget) fail(\'native_executable_target\');',
        '(stat.mode & 0o111) === 0',
        "spawnSync(executable, ['--help'], {",
        "stdio: ['ignore', 'pipe', 'pipe']",
        'if (help.error || help.signal || !helpSentinel.test(helpOutput)) fail(\'native_executable_help\');',
        'classification=success'
    ]) assert.ok(source.includes(anchor), `missing helper anchor: ${anchor}`);
    assert.equal((source.match(/\/\^artifact-\[a-f0-9\]\{32\}\$\/\.test/g) || []).length, 2,
        'slice response and output inventory must both require the exact artifact identifier');
    assert.doesNotMatch(source,
        /\bshell\s*:\s*true|\beval\s*\(|\bexec(?:Sync)?\s*\(|docker\s+(?:system|image|container)\s+prune/);
    assert.doesNotMatch(source, /console\.log\(process\.env|JSON\.stringify\(process\.env\)|docker inspect "\$|--privileged/);
}

function workflowContract(source) {
    const start = step('container_start', source);
    const smoke = step('smoke_gate', source);
    for (const anchor of [
        '--pull never', '--network none', '--cap-drop ALL',
        '--security-opt no-new-privileges', '--read-only', '--pids-limit 512',
        '--memory 4g', '--memory-swap 4g', '--cpus 2', '--stop-timeout 30',
        '--log-driver json-file', '--log-opt max-size=20m',
        '/app/input:rw,nosuid,nodev,noexec,size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700',
        '/app/output:rw,nosuid,nodev,noexec,size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700',
        '/app/configs/pricing-state:rw,nosuid,nodev,noexec,size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700',
        '/tmp:rw,nosuid,nodev,noexec,size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700',
        '--env "EXPECTED_SERVICE_UID=$SERVICE_UID"',
        '--env "EXPECTED_SERVICE_GID=$SERVICE_GID"',
        '--env "EXPECTED_PIDS_LIMIT=512"',
        '--env "EXPECTED_MEMORY_BYTES=4294967296"',
        '--env "EXPECTED_CPU_LIMIT=2.0"',
        '--env "EXPECTED_LOG_MAX_SIZE=20m"',
        '--env "EXPECTED_LOG_MAX_FILES=5"',
        '--env "EXPECTED_STOP_GRACE_PERIOD=30s"',
        '--label "io.s3a.expected-image-id=$EXPECTED_IMAGE_ID"'
    ]) assert.ok(start.includes(anchor), `missing workflow start anchor: ${anchor}`);
    assert.match(start, /^\s+--log-opt max-file=5 \\$/m);
    assert.match(source, /EXPECTED_IMAGE_ID: \$\{\{ steps\.image_identity\.outputs\.image_id \}\}/);
    assert.match(source, /SERVICE_UID: \$\{\{ steps\.runtime_identity\.outputs\.uid \}\}/);
    assert.match(source, /SERVICE_GID: \$\{\{ steps\.runtime_identity\.outputs\.gid \}\}/);
    assert.match(smoke,
        /node scripts\/i8-runtime-state-proof\.js[\s\S]*node scripts\/i4-image-runtime-envelope\.js[\s\S]*classification=success/);
    assert.ok(source.indexOf('node scripts/i4-image-runtime-envelope.js')
        < source.indexOf('id: runtime_diagnostics'));
    const final = step('final_enforcement', source);
    assert.match(final, /process\.env\.SMOKE_OUTCOME !== 'success'/);
    assert.match(final, /process\.env\.SMOKE_CLASSIFICATION !== 'success'/);
    assert.match(final, /failures\.push\('runtime_liveness_failure'\)/);
    assert.match(final, /process\.exit\(1\)/);
}

test('validation and publication workflows share the exact I4 main-container namespace validator', () => {
    namespaceContract();
});

test('runtime inspect accepts only the exact read-only resource and tmpfs envelope', () => {
    const record = envelope.parseInspectOutput(inspectLine());
    assert.doesNotThrow(() => envelope.assertRuntimeInspect(record, {
        imageId: IMAGE_ID, uid: UID, gid: GID
    }));
    for (const override of [
        { image: `sha256:${'d'.repeat(64)}` },
        { readOnly: false },
        { pids: 0 },
        { memory: 0 },
        { memorySwap: -1 },
        { nanoCpus: 0 },
        { stopTimeout: 300 },
        { logSize: '200m' },
        { capDrop: [] },
        { securityOpt: [] },
        { tmpfs: { ...envelope.expectedTmpfs(UID, GID), '/tmp': 'rw,size=1g' } },
        { running: false }
    ]) {
        const mutated = envelope.parseInspectOutput(inspectLine(override));
        assert.throws(() => envelope.assertRuntimeInspect(mutated, {
            imageId: IMAGE_ID, uid: UID, gid: GID
        }));
    }
});

test('identity, probe output, helper source, and workflow orchestration remain fail closed', () => {
    assert.equal(envelope.parsePositiveId('1001', 'uid'), 1001);
    for (const value of ['', '0', '-1', '01', 'slicer', '1\n2']) {
        assert.throws(() => envelope.parsePositiveId(value, 'uid'));
    }
    assert.deepEqual(envelope.parseProbeOutput({
        stdout: '{"classification":"success","immutableCount":8,"writableCount":9,"authenticatedSliceCount":2,"authenticatedClientAbortCount":1,"postAbortArtifactDelta":0,"cachedReadinessActiveJobs":0,"freshReadinessActiveJobs":1,"abortTransport":"terminal_response"}\n',
        stderr: ''
    }), {
        classification: 'success', immutableCount: 8, writableCount: 9,
        authenticatedSliceCount: 2, authenticatedClientAbortCount: 1,
        postAbortArtifactDelta: 0, cachedReadinessActiveJobs: 0,
        freshReadinessActiveJobs: 1, abortTransport: 'terminal_response'
    });
    for (const [cachedReadinessActiveJobs, freshReadinessActiveJobs] of [[1, 1], [0, 0]]) {
        assert.throws(() => envelope.parseProbeOutput({
            stdout: JSON.stringify({
                classification: 'success', immutableCount: 8, writableCount: 9,
                authenticatedSliceCount: 2, authenticatedClientAbortCount: 1,
                postAbortArtifactDelta: 0, cachedReadinessActiveJobs,
                freshReadinessActiveJobs, abortTransport: 'terminal_response'
            }),
            stderr: ''
        }));
    }
    assert.ok(CONTAINER_PROBE_FAILURES.includes('abort_initial_queue_not_idle'));
    assert.ok(CONTAINER_PROBE_FAILURES.includes('abort_readiness_cache_replaced'));
    assert.deepEqual(envelope.parseTopOutput('PID PPID COMMAND\n4321 1 node\n'), [
        { pid: 4321, ppid: 1, command: 'node' }
    ]);
    for (const output of [
        '', 'PID PPID COMMAND\n', '4321 1 node\n',
        'PID PPID COMMAND\n0 1 node\n', 'PID PPID COMMAND\n1 x node\n',
        'PID PPID COMMAND\n1 0 bad command\n'
    ]) {
        assert.throws(() => envelope.parseTopOutput(output));
    }
    helperContract(SOURCE);
    workflowContract(WORKFLOW);
});

test('runtime-envelope and final-aggregation weakening mutations are rejected', async (t) => {
    const cases = [
        ['read-only root removed', WORKFLOW, '            --read-only \\\n', '', workflowContract],
        ['memory unbounded', WORKFLOW, '            --memory 4g \\\n', '', workflowContract],
        ['CPU unbounded', WORKFLOW, '            --cpus 2 \\\n', '', workflowContract],
        ['log rotation weakened', WORKFLOW, '--log-opt max-file=5',
            '--log-opt max-file=50', workflowContract],
        ['job scratch mount loses noexec', WORKFLOW, '/tmp:rw,nosuid,nodev,noexec,size=64m',
            '/tmp:rw,nosuid,nodev,size=64m', workflowContract],
        ['runtime proof removed', WORKFLOW, '          node scripts/i4-image-runtime-envelope.js\n',
            '', workflowContract],
        ['final smoke aggregation bypassed', WORKFLOW,
            "process.env.SMOKE_OUTCOME !== 'success'", 'false', workflowContract],
        ['validation-only namespace restored', SOURCE,
            '(?:validation|publication)', 'validation', helperContract],
        ['production namespace admitted', SOURCE,
            '(?:validation|publication)', '(?:validation|publication|production)', helperContract],
        ['arbitrary namespace admitted', SOURCE,
            '(?:validation|publication)', '[a-z]+', helperContract],
        ['optional namespace admitted', SOURCE,
            '(?:validation|publication)', '(?:validation|publication)?', helperContract],
        ['workflow/helper publication mismatch', PUBLICATION_WORKFLOW,
            's3a-publication-${{ github.run_id }}-${{ github.run_attempt }}',
            's3a-candidate-${{ github.run_id }}-${{ github.run_attempt }}',
            publicationNamespaceContract],
        ['publication workflow renamed to validation', PUBLICATION_WORKFLOW,
            's3a-publication-${{ github.run_id }}-${{ github.run_attempt }}',
            's3a-validation-${{ github.run_id }}-${{ github.run_attempt }}',
            publicationNamespaceContract],
        ['exact image identity removed', SOURCE,
            'record.image !== expected.imageId', 'false', helperContract],
        ['helper shell enabled', SOURCE, 'shell: false', 'shell: true', helperContract],
        ['malformed UID accepted', SOURCE, "['slicer', String(gid)]",
            "[String(uid), String(gid)]", helperContract],
        ['root GID accepted', SOURCE, "[String(uid), '0']",
            "[String(uid), String(gid)]", helperContract],
        ['identity probe uses invalid unrelated PID bound', SOURCE, "'--pids-limit', '64'",
            "'--pids-limit', '16'", helperContract],
        ['identity probe omits matching memory expectation', SOURCE,
            "'EXPECTED_MEMORY_BYTES=1073741824'", "'EXPECTED_MEMORY_BYTES=1'", helperContract],
        ['immutable mode ignored', SOURCE, '(stat.mode & 0o022) !== 0', 'false', helperContract],
        ['Bambu Studio tree immutability check removed', SOURCE,
            "for (const target of ['/opt/bambustudio', '/opt/bambustudio/AppRun'])",
            'for (const target of [])', helperContract],
        ['Bambu Studio executable check removed', SOURCE,
            "  ['/usr/local/bin/bambu-studio', '/usr/local/bin/bambu-studio', /Usage:\\s+bambu-studio/]\n",
            '', helperContract],
        ['Bambu Studio executable reduced to a bare AppRun symlink', SOURCE,
            "['/usr/local/bin/bambu-studio', '/usr/local/bin/bambu-studio', /Usage:\\s+bambu-studio/]",
            "['/usr/local/bin/bambu-studio', '/opt/bambustudio/AppRun', /Usage:\\s+bambu-studio/]",
            helperContract],
        ['native help sentinel ignored', SOURCE,
            'if (help.error || help.signal || !helpSentinel.test(helpOutput)) fail(\'native_executable_help\');',
            'if (help.error) fail(\'native_executable_help\');', helperContract],
        ['native executable bit ignored', SOURCE, '(stat.mode & 0o111) === 0', 'false', helperContract],
        ['Bambu Studio root ownership ignored', SOURCE,
            'const rootImmutable = (stat) => stat.uid === 0 && (stat.mode & 0o022) === 0 && !stat.isSymbolicLink();',
            'const rootImmutable = (stat) => (stat.mode & 0o022) === 0 && !stat.isSymbolicLink();', helperContract],
        ['authenticated Prusa smoke removed', SOURCE, "  await slice('prusa');\n", '', helperContract],
        ['authenticated Orca smoke removed', SOURCE, "  await slice('orca');\n", '', helperContract],
        ['artifact identifier contract widened', SOURCE,
            "/^artifact-[a-f0-9]{32}$/.test(body?.artifact_id || '')",
            "/^[a-z0-9_-]{16,128}$/.test(body?.artifact_id || '')", helperContract],
        ['client-abort smoke removed', SOURCE,
            '  const abortProof = await proveClientAbortNoArtifact();\n', '', helperContract],
        ['cached readiness is not primed at zero', SOURCE,
            '  const cachedBefore = await cachedQueueStatus();\n', '', helperContract],
        ['active abort observation uses cached readiness', SOURCE,
            '    const queue = await freshQueueStatus();',
            '    const queue = await cachedQueueStatus();', helperContract],
        ['detailed health probe replaced by cached operations readiness', SOURCE,
            "scopedJson('/health/detailed', process.env.OPERATIONS_API_KEY)",
            "scopedJson('/operations/readiness', process.env.OPERATIONS_API_KEY)", helperContract],
        ['active queue observation bypassed', SOURCE, 'queue.activeJobs === 1', 'true', helperContract],
        ['fresh observation replaces normal readiness cache unchecked', SOURCE,
            'cachedDuring.activeJobs !== 0 || cachedDuring.queueLength !== 0',
            'false', helperContract],
        ['post-abort API inventory ignored', SOURCE,
            'JSON.stringify(afterInventory) !== JSON.stringify(beforeInventory)', 'false', helperContract],
        ['post-abort filesystem inventory ignored', SOURCE,
            'JSON.stringify(afterEntries) !== JSON.stringify(beforeEntries)', 'false', helperContract],
        ['post-abort host process proof removed', SOURCE,
            '    proveNoPostAbortDescendants(record);\n', '', helperContract],
        ['post-abort process allowlist widened', SOURCE,
            'processes.length === 1 && processes[0].pid === record.pid', 'processes.length >= 1', helperContract],
        ['post-abort process count unbounded', SOURCE,
            'processes.length > 16', 'false', helperContract],
        ['runtime cache path routed outside tmpfs', SOURCE,
            "XDG_CACHE_HOME: '/tmp/xdg-cache'", "XDG_CACHE_HOME: '/home/slicer/.cache'", helperContract],
        ['response bound removed', SOURCE, 'if (total > 65536)', 'if (false)', helperContract],
        ['graceful timeout unbounded', SOURCE, "'container', 'stop', '--timeout', '30'",
            "'container', 'stop'", helperContract],
        ['orphan check removed', SOURCE, 'processState.status !== 1', 'false', helperContract]
    ];
    for (const [name, source, from, to, validate] of cases) {
        await t.test(name, () => {
            assert.ok(source.includes(from), `missing mutation anchor: ${from}`);
            assert.throws(() => validate(source.replace(from, to)));
        });
    }
});
