'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(ROOT, 'scripts/i2-image-runtime-diagnostics.js');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const DOCKERFILE_PATH = path.join(ROOT, 'Dockerfile');
const SOURCE = fs.readFileSync(HELPER_PATH, 'utf8').replace(/\r\n?/g, '\n');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');
const DOCKERFILE = fs.readFileSync(DOCKERFILE_PATH, 'utf8').replace(/\r\n?/g, '\n');
const identity = require(HELPER_PATH);

const REF = `local/slicer-api-validation:${'a'.repeat(40)}`;
const ID = `sha256:${'b'.repeat(64)}`;

function step(id, source = WORKFLOW) {
    const start = source.indexOf(`        id: ${id}`);
    assert.notEqual(start, -1, `missing ${id}`);
    const end = source.indexOf('\n      - name:', start);
    return source.slice(start, end < 0 ? source.length : end);
}

function helperContract(source) {
    for (const anchor of [
        "spawnSync('docker', args,", 'shell: false', 'maxBuffer: MAX_COMMAND_BYTES',
        "new Set(['image inspect', 'run --rm', 'container inspect'])",
        "configuredUser !== 'slicer'", '!Number.isSafeInteger(value) || value <= 0',
        "--entrypoint', '/usr/bin/id'", "'--pull', 'never'", "'--network', 'none'",
        "'--cap-drop', 'ALL'", "'--security-opt', 'no-new-privileges'",
        'io.s3a.validation-only=true', 'io.s3a.expected-image-id=${exactImageId}',
        'configured_user=${identity.configuredUser}', 'classification=success'
    ]) assert.ok(source.includes(anchor), `missing ${anchor}`);
    assert.doesNotMatch(source, /(?:^|[^\w.])exec(?:Sync)?\s*\(|\bshell\s*:\s*true|\beval\s*\(|\/bin\/(?:ba)?sh|\$\(/);
    assert.doesNotMatch(source, /\b999\b|\/etc\/passwd/);
    assert.match(source, /::error title=I2 runtime identity::runtime_identity_failure:/);
}

function workflowContract(source) {
    const resolver = step('runtime_identity', source);
    const orca = step('orca_cli_smoke', source);
    const start = step('container_start', source);
    const smoke = step('smoke_gate', source);
    const cleanup = step('exact_cleanup', source);
    const final = step('final_enforcement', source);
    const boundary = step('artifact_boundary', source);
    const upload = step('evidence_upload', source);
    assert.match(resolver, /if: \$\{\{ always\(\) && steps\.build\.outcome == 'success' \}\}[\s\S]*continue-on-error: true[\s\S]*node scripts\/i2-image-runtime-diagnostics\.js/);
    assert.match(orca, /if: \$\{\{ steps\.runtime_identity\.outcome == 'success' \}\}[\s\S]*continue-on-error: true[\s\S]*node scripts\/i2-orca-runtime-smoke\.js/);
    assert.match(start, /if: \$\{\{ steps\.runtime_identity\.outcome == 'success' \}\}/);
    for (const anchor of [
        'CONFIGURED_USER: ${{ steps.runtime_identity.outputs.configured_user }}',
        'SERVICE_UID: ${{ steps.runtime_identity.outputs.uid }}',
        'SERVICE_GID: ${{ steps.runtime_identity.outputs.gid }}',
        '[[ ! "$SERVICE_UID" =~ ^[0-9]+$ ]]', '[[ ! "$SERVICE_GID" =~ ^[0-9]+$ ]]',
        '[ "$SERVICE_UID" = "0" ]', '[ "$SERVICE_GID" = "0" ]',
        '--pull never', '--network none', '--cap-drop ALL', '--security-opt no-new-privileges',
        '--label "io.s3a.expected-image-id=$EXPECTED_IMAGE_ID"',
        "docker inspect --format '{{.State.Pid}}'", '/usr/bin/ps -o uid=,gid= -p "$container_pid"',
        '[ "$kernel_uid" != "$SERVICE_UID" ]', '[ "$kernel_gid" != "$SERVICE_GID" ]'
    ]) assert.ok(start.includes(anchor), `start missing ${anchor}`);
    const mounts = [...start.matchAll(/--tmpfs "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(mounts.map((mount) => mount.split(':')[0]), ['/app/input', '/app/output']);
    for (const mount of mounts) {
        for (const option of ['rw', 'nosuid', 'nodev', 'noexec', 'size=64m',
            'uid=${SERVICE_UID}', 'gid=${SERVICE_GID}', 'mode=0700']) {
            assert.ok(mount.split(':')[1].split(',').includes(option), `mount missing ${option}`);
        }
    }
    assert.match(smoke, /if \[ "\$running" = "true" \] && \[ "\$health" = "healthy" \]; then/);
    assert.doesNotMatch(source, /\b999\b|mode=0777|I2_PROBE_[ABC]_NAME|runtime-ownership\.json|ownership_(?:characterization|finalization)/);
    for (const file of ['image-identity.txt', 'runtime-diagnostics.json', 'sbom.spdx.json', 'grype.json']) {
        assert.ok(boundary.includes(file) && upload.includes(file), `missing ${file}`);
    }
    assert.match(boundary, /'configured_user', 'service_uid', 'service_gid', 'kernel_uid', 'kernel_gid'/);
    assert.match(boundary, /!\/\^\[1-9\]\[0-9\]\*\$\/\.test\(identity\.service_uid\)/);
    assert.match(boundary, /identity\.kernel_uid !== identity\.service_uid/);
    assert.match(cleanup, /if: \$\{\{ always\(\) \}\}[\s\S]*continue-on-error: true/);
    for (const name of ['I2_UID_PROBE_NAME', 'I2_GID_PROBE_NAME',
        'I2_ORCA_PROBE_NAME', 'CONTAINER_NAME']) assert.ok(cleanup.includes(name));
    assert.match(cleanup, /::error title=I2 exact cleanup::\$1/);
    assert.match(cleanup, /container_ownership_failure/);
    assert.match(cleanup, /\[ "\$validation_label" != "true" \]/);
    assert.match(cleanup, /\[ "\$expected_label" != "\$EXPECTED_IMAGE_ID" \]/);
    assert.match(cleanup, /docker container rm --force "\$container_id"/);
    assert.doesNotMatch(cleanup, /docker container rm --force "\$exact_container"/);
    assert.equal((cleanup.match(/classification=cleanup_failure/g) || []).length, 1);
    assert.equal((cleanup.match(/classification=success/g) || []).length, 1);
    assert.ok(cleanup.indexOf('classification=cleanup_failure') > cleanup.indexOf('if [ "$cleanup_status" -ne 0 ]; then'));
    assert.ok(source.indexOf('id: exact_cleanup') < source.indexOf('id: final_enforcement'));
    for (const anchor of ['RUNTIME_IDENTITY_OUTCOME', 'RUNTIME_IDENTITY_CLASSIFICATION',
        "failures.push('runtime_identity_failure');", 'CLEANUP_OUTCOME', "failures.push('cleanup_failure');",
        'ORCA_CLI_SMOKE_OUTCOME', 'ORCA_CLI_SMOKE_CLASSIFICATION',
        "failures.push('orca_cli_smoke_failure');",
        "if (process.env.CLEANUP_OUTCOME !== 'success')",
        "process.env.SMOKE_OUTCOME !== 'success'", "process.env.SMOKE_CLASSIFICATION !== 'success'",
        'process.exit(1);']) assert.ok(final.includes(anchor), `final missing ${anchor}`);
    assert.match(DOCKERFILE, /^USER slicer$/m);
}

test('identity lookup accepts only the exact immutable slicer image and positive single-line IDs', () => {
    assert.deepEqual(identity.parseInspectOutput(`${JSON.stringify(ID)}|"slicer"\n`, ID),
        { id: ID, configuredUser: 'slicer' });
    for (const bad of ['', '0\n', '-1\n', '1001\n1002\n', 'slicer\n', ' 1001\n']) {
        assert.throws(() => identity.parsePositiveId(bad, 'uid'));
    }
    assert.throws(() => identity.parseInspectOutput(`${JSON.stringify(ID)}|"root"\n`, ID));
    assert.throws(() => identity.parseInspectOutput(`${JSON.stringify(`sha256:${'c'.repeat(64)}`)}|"slicer"\n`, ID));
    for (const floating of ['ubuntu:latest', 'local/slicer-api-validation:latest', `${REF}\n--privileged`]) {
        assert.throws(() => identity.validateImageRef(floating));
    }
});

test('resolver command is non-shell, exact-image-bound, isolated, bounded, and dynamically selected', async (t) => {
    for (const [selector, name] of [['-u', 'uid-probe'], ['-g', 'gid-probe']]) {
        const args = identity.buildResolverArgs(name, ID, selector);
        assert.equal(args[0], 'run');
        assert.deepEqual(args.slice(-3), ['/usr/bin/id', ID, selector]);
        for (const token of ['--rm', '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--pids-limit', '64',
            'io.s3a.validation-only=true', `io.s3a.expected-image-id=${ID}`]) {
            assert.ok(args.includes(token));
        }
        assert.equal(args.filter((item) => item === '--entrypoint').length, 1);
    }
    assert.throws(() => identity.buildResolverArgs('uid-probe', REF, '-u'));
    assert.throws(() => identity.buildResolverArgs('uid-probe', ID, '--help'));
    helperContract(SOURCE);
    const mutations = [
        ['shell: false', 'shell: true'], ['maxBuffer: MAX_COMMAND_BYTES', 'maxBuffer: Infinity'],
        ["new Set(['image inspect', 'run --rm', 'container inspect'])", "new Set(['*'])"],
        ['!Number.isSafeInteger(value) || value <= 0', 'value <= 0'],
        ["spawnSync('docker', args,", "eval(args.join(' ')); spawnSync('docker', args,"]
    ];
    for (const [from, to] of mutations) await t.test(from, () => {
        assert.ok(SOURCE.includes(from));
        assert.throws(() => helperContract(SOURCE.replace(from, to)));
    });
});

test('container absence parsing is strict but accepts the Docker empty-template newline', () => {
    assert.equal(identity.parsePresenceResult({ status: 0, stdout: `"${'c'.repeat(64)}"\n`, stderr: '' }, 'probe'), true);
    for (const stdout of ['', '\n', '[]\n']) assert.equal(identity.parsePresenceResult({ status: 1, stdout,
        stderr: 'Error: No such object: probe\n' }, 'probe'), false);
    for (const malformed of [
        { status: 1, stdout: '[{}]\n', stderr: 'Error: No such object: probe\n' },
        { status: 1, stdout: '[]\n', stderr: 'permission denied\n' },
        { status: 0, stdout: '[]\n', stderr: '' }
    ]) assert.throws(() => identity.parsePresenceResult(malformed, 'probe'));
});

test('final workflow preserves dynamic restrictive tmpfs, exact cleanup, and fail-closed aggregation', () => {
    workflowContract(WORKFLOW);
});

test('required workflow mutations are rejected', async (t) => {
    const mutations = [
        ['hard-coded uid', 'uid=${SERVICE_UID}', 'uid=999'],
        ['root uid accepted', '[ "$SERVICE_UID" = "0" ]', '[ "$SERVICE_UID" = "never" ]'],
        ['root gid accepted', '[ "$SERVICE_GID" = "0" ]', '[ "$SERVICE_GID" = "never" ]'],
        ['uid validation removed', '[[ ! "$SERVICE_UID" =~ ^[0-9]+$ ]]', 'false'],
        ['gid validation removed', '[[ ! "$SERVICE_GID" =~ ^[0-9]+$ ]]', 'false'],
        ['kernel uid check removed', '[ "$kernel_uid" != "$SERVICE_UID" ]', 'false'],
        ['kernel gid check removed', '[ "$kernel_gid" != "$SERVICE_GID" ]', 'false'],
        ['input uid missing', 'size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700', 'size=64m,gid=${SERVICE_GID},mode=0700'],
        ['output gid missing', 'size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700', 'size=64m,uid=${SERVICE_UID},mode=0700', 2],
        ['world writable', 'mode=0700', 'mode=0777'], ['noexec missing', 'nodev,noexec,size=64m', 'nodev,size=64m'],
        ['nosuid missing', 'rw,nosuid,nodev', 'rw,nodev'], ['nodev missing', 'nosuid,nodev,noexec', 'nosuid,noexec'],
        ['unbounded tmpfs', 'size=64m,uid=', 'uid='], ['only one mount', '            --tmpfs "/app/output:rw,nosuid,nodev,noexec,size=64m,uid=${SERVICE_UID},gid=${SERVICE_GID},mode=0700" \\\n', ''],
        ['identity step bypassed', "        id: runtime_identity\n        if: ${{ always() && steps.build.outcome == 'success' }}", "        id: runtime_identity\n        if: ${{ false }}"],
        ['health accepts exited container', 'if [ "$running" = "true" ] && [ "$health" = "healthy" ]; then', 'if [ "$health" = "healthy" ]; then'],
        ['health weakened', "process.env.SMOKE_OUTCOME !== 'success'", 'false'],
        ['final identity ignored', "failures.push('runtime_identity_failure');", ''],
        ['final Orca smoke ignored', "failures.push('orca_cli_smoke_failure');", ''],
        ['cleanup outcome ignored', "if (process.env.CLEANUP_OUTCOME !== 'success')", 'if (false)'],
        ['cleanup skipped', '        id: exact_cleanup\n        if: ${{ always() }}', '        id: exact_cleanup\n        if: ${{ success() }}'],
        ['cleanup probe omitted', '              "$I2_ORCA_PROBE_NAME" "$CONTAINER_NAME"', '              "$CONTAINER_NAME"'],
        ['cleanup ownership removed', '[ "$validation_label" != "true" ]', 'false'],
        ['cleanup switches to name', 'docker container rm --force "$container_id"', 'docker container rm --force "$exact_container"']
    ];
    for (const [name, from, to, occurrence = 1] of mutations) await t.test(name, () => {
        let mutated = WORKFLOW;
        for (let index = 0; index < occurrence; index += 1) {
            const at = mutated.indexOf(from, index === 0 ? 0 : mutated.indexOf(to) + to.length);
            assert.notEqual(at, -1, `missing mutation anchor ${name}`);
            mutated = `${mutated.slice(0, at)}${to}${mutated.slice(at + from.length)}`;
        }
        assert.throws(() => workflowContract(mutated));
    });
});
