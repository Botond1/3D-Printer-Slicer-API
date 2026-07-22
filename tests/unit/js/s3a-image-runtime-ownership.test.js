'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(ROOT, 'scripts/i2-image-runtime-diagnostics.js');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const SOURCE = fs.readFileSync(HELPER_PATH, 'utf8').replace(/\r\n?/g, '\n');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');
const diagnostic = require(HELPER_PATH);

const REF = `local/slicer-api-validation:${'a'.repeat(40)}`;
const ID = `sha256:${'b'.repeat(64)}`;
const UID = 1001;
const GID = 1002;
const SAFE = ['rw', 'nosuid', 'nodev', 'noexec', 'size=64m'];

function write(created = true) {
    return { directoryCreated: created, fileWritten: created, statUid: created ? UID : null,
        statGid: created ? GID : null, statMode: created ? '0600' : null,
        fileRemoved: created, directoryRemoved: created, errorCode: created ? null : 'EACCES' };
}

function result(scenario) {
    const paths = ['/app', '/app/input', '/app/output', '/app/configs'].map((item) => ({
        path: item, isDirectory: true, isSymbolicLink: false, realpath: item,
        uid: scenario === 'C' && /\/(?:input|output)$/.test(item) ? UID : 0,
        gid: scenario === 'C' && /\/(?:input|output)$/.test(item) ? GID : 0,
        mode: scenario === 'C' && /\/(?:input|output)$/.test(item) ? '0700' : '0755', write: write()
    }));
    const options = scenario === 'C' ? [...SAFE, `uid=${UID}`, `gid=${GID}`, 'mode=0700'] : [...SAFE];
    return { version: 1, paths, mounts: scenario === 'A' ? { input: null, output: null } : {
        input: { type: 'tmpfs', options: [...options] }, output: { type: 'tmpfs', options: [...options] }
    } };
}

function cleanup(name, main = false) {
    return { name, presentBefore: main, removeAttempted: main, removeExitCode: main ? 0 : null, absentAfter: true };
}

function validDocument(finalized = true) {
    const probes = Object.fromEntries(['A', 'B', 'C'].map((key) => [key,
        { name: `probe-${key.toLowerCase()}`, result: result(key) }]));
    const cleanups = { uid: cleanup('uid-probe'), gid: cleanup('gid-probe'),
        A: cleanup('probe-a'), B: cleanup('probe-b'), C: cleanup('probe-c') };
    if (finalized) cleanups.main = cleanup('main-container', true);
    return { version: 1, image: { reference: REF, id: ID, configuredUser: 'slicer', uid: UID, gid: GID },
        probes, cleanup: cleanups };
}

function mutate(document, callback) {
    const copy = structuredClone(document);
    callback(copy);
    return copy;
}

function assertRunEnvelope(args, entrypoint) {
    assert.equal(args[0], 'run');
    const required = ['--rm', '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '64'];
    for (const token of required) assert.ok(args.includes(token), `missing ${token}`);
    const at = args.indexOf('--entrypoint');
    assert.equal(args[at + 1], entrypoint);
    assert.equal(args.filter((item) => item === '--entrypoint').length, 1);
    assert.equal(args.at(entrypoint === '/usr/bin/id' ? -2 : -3), ID);
}

function helperSourceContract(source) {
    const required = [
        "spawnSync('docker', args,", 'shell: false',
        "new Set(['image inspect', 'run --rm', 'container inspect', 'container rm'])",
        "if (result.status !== 0) throw new Error('docker_child_failure')", 'maxBuffer: MAX_COMMAND_BYTES',
        "appendClassification(env.GITHUB_OUTPUT, 'success')", '!Number.isSafeInteger(value) || value <= 0'
    ];
    for (const anchor of required) assert.ok(source.includes(anchor), `missing ${anchor}`);
    assert.equal(source.split("for (const scenario of ['A', 'B', 'C'])").length - 1, 2);
    assert.doesNotMatch(source, /(?:^|[^\w.])exec(?:Sync)?\s*\(|\bshell\s*:\s*true|\beval\s*\(|\/bin\/(?:ba)?sh|\$\(/);
    assert.match(source, /::error title=I2 runtime ownership::runtime_ownership_failure:/);
}

function step(id, source = WORKFLOW) {
    const start = source.indexOf(`        id: ${id}`);
    assert.notEqual(start, -1, `missing ${id}`);
    const end = source.indexOf('\n      - name:', start);
    return source.slice(start, end < 0 ? source.length : end);
}

function workflowContract(source) {
    const characterization = step('ownership_characterization', source);
    const finalization = step('ownership_finalization', source);
    const cleanupStep = step('exact_cleanup', source);
    const final = step('final_enforcement', source);
    assert.match(characterization, /continue-on-error: true[\s\S]*characterize/);
    assert.match(finalization, /if: \$\{\{ always\(\) && steps\.build\.outcome == 'success' \}\}[\s\S]*continue-on-error: true[\s\S]*finalize/);
    assert.match(cleanupStep, /if: \$\{\{ always\(\) \}\}[\s\S]*continue-on-error: true[\s\S]*classification=success/);
    assert.ok(source.indexOf('id: exact_cleanup') < source.indexOf('id: final_enforcement'));
    for (const marker of ['OWNERSHIP_CHARACTERIZATION_OUTCOME', 'OWNERSHIP_CHARACTERIZATION_CLASSIFICATION',
        'OWNERSHIP_FINALIZATION_OUTCOME', 'OWNERSHIP_FINALIZATION_CLASSIFICATION', 'CLEANUP_OUTCOME',
        'CLEANUP_CLASSIFICATION', 'ownership_characterization_failure', 'ownership_finalization_failure',
        'cleanup_failure']) assert.ok(final.includes(marker), `final gate missing ${marker}`);
    const files = ['image-identity.txt', 'runtime-diagnostics.json', 'runtime-ownership.json',
        'sbom.spdx.json', 'grype.json'];
    const boundary = step('artifact_boundary', source);
    const upload = step('evidence_upload', source);
    for (const file of files) assert.ok(boundary.includes(file) && upload.includes(file), `missing ${file}`);
    assert.match(boundary, /'runtime-ownership\.json': 128 \* 1024/);
    assert.match(boundary, /validateOwnershipDocument\(ownership, \{ requireMainCleanup: true \}\)/);
    assert.match(boundary, /::error title=I2 evidence boundary::\$\{code\}/);
    assert.match(boundary, /ownership\.image\.reference !== process\.env\.IMAGE_REF[\s\S]*ownership\.image\.id !== identity\.local_image_id/);
    for (const name of ['I2_UID_PROBE_NAME', 'I2_GID_PROBE_NAME', 'I2_PROBE_A_NAME',
        'I2_PROBE_B_NAME', 'I2_PROBE_C_NAME', 'CONTAINER_NAME']) assert.ok(boundary.includes(name));
    assert.match(final, /::error title=I2 final enforcement::\$\{classifications\.join\(','\)\}/);
}

test('identity lookup is exact, positive, single-line, and bound to the loaded immutable image', () => {
    assert.deepEqual(diagnostic.parseInspectOutput(`${JSON.stringify(ID)}|"slicer"\n`, ID),
        { id: ID, configuredUser: 'slicer' });
    for (const bad of ['', '0\n', '-1\n', '1001\n1002\n', 'slicer\n']) {
        assert.throws(() => diagnostic.parsePositiveId(bad, 'uid'));
    }
    assert.throws(() => diagnostic.parseInspectOutput(`${JSON.stringify(`sha256:${'c'.repeat(64)}`)}|"slicer"\n`, ID));
    for (const floating of ['ubuntu:latest', 'local/slicer-api-validation:latest', `${REF}\n--privileged`]) {
        assert.throws(() => diagnostic.validateImageRef(floating));
    }
    assert.doesNotMatch(SOURCE, /(?:uid|gid)\s*=\s*(?:0|1000|1001)\b/);
});

test('container presence parser accepts only bounded known Docker absent forms', () => {
    const present = { status: 0, stdout: `"${'c'.repeat(64)}"\n`, stderr: '' };
    assert.equal(diagnostic.parsePresenceResult(present, 'probe-a'), true);
    for (const stdout of ['', '[]\n']) {
        for (const stderr of [
            'Error: No such object: probe-a\n',
            'Error: No such container: probe-a\n',
            'Error response from daemon: No such container: probe-a\n'
        ]) assert.equal(diagnostic.parsePresenceResult({ status: 1, stdout, stderr }, 'probe-a'), false);
    }
    for (const malformed of [
        { status: 1, stdout: '[{}]\n', stderr: 'Error: No such object: probe-a\n' },
        { status: 1, stdout: '[]\n', stderr: 'permission denied\n' },
        { status: 2, stdout: '[]\n', stderr: 'Error: No such object: probe-a\n' },
        { status: 0, stdout: '[]\n', stderr: '' }
    ]) assert.throws(() => diagnostic.parsePresenceResult(malformed, 'probe-a'));
});

test('resolver and A/B/C probes retain exact non-shell identity and isolation envelopes', async (t) => {
    const resolver = diagnostic.buildResolverArgs('uid-probe', ID, '-u');
    assertRunEnvelope(resolver, '/usr/bin/id');
    assert.deepEqual(resolver.slice(-3), ['/usr/bin/id', ID, '-u']);
    assert.throws(() => diagnostic.buildResolverArgs('uid-probe', REF, '-u'));
    assert.throws(() => diagnostic.buildProbeArgs('A', 'probe-a', REF, UID, GID));
    const expectedMounts = { A: [], B: SAFE, C: [...SAFE, `uid=${UID}`, `gid=${GID}`, 'mode=0700'] };
    for (const scenario of ['A', 'B', 'C']) await t.test(scenario, () => {
        const args = diagnostic.buildProbeArgs(scenario, `probe-${scenario}`, ID, UID, GID);
        assertRunEnvelope(args, '/usr/bin/node');
        const mounts = args.flatMap((item, index) => item === '--tmpfs' ? [args[index + 1]] : []);
        assert.equal(mounts.length, scenario === 'A' ? 0 : 2);
        for (const mount of mounts) assert.deepEqual(mount.split(':')[1].split(','), expectedMounts[scenario]);
        assert.deepEqual(args.slice(-3), [ID, '-e', diagnostic.PROBE_PROGRAM]);
    });
    for (const token of ['--rm', '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL',
        'no-new-privileges']) assert.throws(() =>
        assertRunEnvelope(resolver.filter((item) => item !== token), '/usr/bin/id'));
    assert.throws(() => assertRunEnvelope(['exec', ...resolver.slice(1)], '/usr/bin/id'));
    assert.throws(() => assertRunEnvelope(resolver.with(resolver.indexOf('/usr/bin/id'), '/bin/sh'), '/usr/bin/id'));
});

test('ownership schema accepts only bounded finalized A/B/C evidence', async (t) => {
    assert.equal(diagnostic.validateOwnershipDocument(validDocument(), { requireMainCleanup: true }).version, 1);
    const cases = [
        ['root uid', (d) => { d.image.uid = 0; }], ['root gid', (d) => { d.image.gid = 0; }],
        ['extra field', (d) => { d.secret = 'x'; }], ['missing C', (d) => { delete d.probes.C; }],
        ['malformed paths', (d) => { d.probes.A.result.paths = 'all'; }],
        ['main cleanup omitted', (d) => { delete d.cleanup.main; }],
        ['cleanup incomplete', (d) => { d.cleanup.B.absentAfter = false; }],
        ['file not removed', (d) => { d.probes.B.result.paths[1].write.fileRemoved = false; }],
        ['directory not removed', (d) => { d.probes.B.result.paths[1].write.directoryRemoved = false; }],
        ...['input', 'output'].flatMap((target) => [['uid', `uid=${UID}`], ['gid', `gid=${GID}`],
            ['mode', 'mode=0700']].map(([label, option]) => [`missing ${target} ${label}`, (d) => {
                d.probes.C.result.mounts[target].options = d.probes.C.result.mounts[target].options
                    .filter((item) => item !== option);
            }])),
        ['world writable', (d) => {
            d.probes.C.result.mounts.input.options[d.probes.C.result.mounts.input.options.length - 1] = 'mode=0777';
        }],
        ...['rw', 'nosuid', 'nodev', 'noexec'].map((option) => [`missing ${option}`, (d) => {
            d.probes.B.result.mounts.output.options = d.probes.B.result.mounts.output.options
                .filter((item) => item !== option);
        }]),
        ['A gains tmpfs', (d) => { d.probes.A.result.mounts.input = { type: 'tmpfs', options: [...SAFE] }; }],
        ['unbounded tmpfs', (d) => { d.probes.B.result.mounts.input.options.splice(4, 1); }],
        ['oversized tmpfs', (d) => { d.probes.C.result.mounts.output.options[4] = 'size=1g'; }]
    ];
    for (const [name, change] of cases) await t.test(name, () => assert.throws(() =>
        diagnostic.validateOwnershipDocument(mutate(validDocument(), change), { requireMainCleanup: true })));
});

test('helper source is sequential, allowlisted, bounded, fixed-path, and mutation sensitive', async (t) => {
    helperSourceContract(SOURCE);
    assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.PROBE_PROGRAM.match(/const paths=\[(.*?)\]/)[1])),
        "'/app','/app/input','/app/output','/app/configs'");
    assert.match(diagnostic.PROBE_PROGRAM, /mkdirSync\(directory[\s\S]*writeFileSync\(target[\s\S]*lstatSync\(target\)[\s\S]*unlinkSync\(target\)[\s\S]*rmdirSync\(directory\)/);
    assert.doesNotMatch(diagnostic.PROBE_PROGRAM, /choosenFile|customer|ENTRYPOINT|child_process|process\.env/);
    const mutations = [
        ["for (const scenario of ['A', 'B', 'C'])", "for (const scenario of ['A', 'C'])"],
        ['shell: false', 'shell: true'], ['maxBuffer: MAX_COMMAND_BYTES', 'maxBuffer: Infinity'],
        ["if (result.status !== 0) throw new Error('docker_child_failure')", ''],
        ["new Set(['image inspect', 'run --rm', 'container inspect', 'container rm'])", "new Set(['*'])"],
        ['!Number.isSafeInteger(value) || value <= 0', 'value <= 0'],
        ["spawnSync('docker', args,", "eval(args.join(' ')); spawnSync('docker', args,"]
    ];
    for (const [from, to] of mutations) await t.test(from, () => {
        assert.ok(SOURCE.includes(from));
        assert.throws(() => helperSourceContract(SOURCE.replace(from, to)));
    });
});

test('workflow keeps ownership, cleanup, final aggregation, and five-file evidence fail-closed', async (t) => {
    workflowContract(WORKFLOW);
    const mutations = [
        ['characterization bypass', '        continue-on-error: true\n        env:', '        env:'],
        ['finalization bypass', "        id: ownership_finalization\n        if: ${{ always() && steps.build.outcome == 'success' }}",
            '        id: ownership_finalization\n        if: ${{ false }}'],
        ['cleanup bypass', '        id: exact_cleanup\n        if: ${{ always() }}', '        id: exact_cleanup\n        if: ${{ success() }}'],
        ['aggregator weakened', "failures.push('ownership_characterization_failure');", ''],
        ['ownership evidence omitted', '            ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/runtime-ownership.json\n', '']
    ];
    for (const [name, from, to] of mutations) await t.test(name, () => {
        assert.ok(WORKFLOW.includes(from), `missing mutation anchor ${name}`);
        assert.throws(() => workflowContract(WORKFLOW.replace(from, to)));
    });
    const cleanupStart = WORKFLOW.lastIndexOf('\n      - name:', WORKFLOW.indexOf('id: exact_cleanup'));
    const finalStart = WORKFLOW.lastIndexOf('\n      - name:', WORKFLOW.indexOf('id: final_enforcement'));
    const reordered = WORKFLOW.slice(0, cleanupStart) + WORKFLOW.slice(finalStart)
        + WORKFLOW.slice(cleanupStart, finalStart);
    assert.throws(() => workflowContract(reordered));
});
