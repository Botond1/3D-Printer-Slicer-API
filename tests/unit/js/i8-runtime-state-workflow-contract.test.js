'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(ROOT, 'scripts/i8-runtime-state-proof.js');
const ACTION_PATH = path.join(ROOT, '.github/actions/exact-image-gate/action.yml');
const PUBLICATION_PATH = path.join(ROOT, '.github/workflows/candidate-publication.yml');
const SOURCE = fs.readFileSync(HELPER_PATH, 'utf8').replace(/\r\n?/g, '\n');
const ACTION = fs.readFileSync(ACTION_PATH, 'utf8').replace(/\r\n?/g, '\n');
const PUBLICATION = fs.readFileSync(PUBLICATION_PATH, 'utf8').replace(/\r\n?/g, '\n');
const OLD_TAG = 'candidate-81872eda8d7c594ce3a12d79d4c02ecf9e26c6f3';
const DIGEST_RUNTIME_ANCHORS = [
    '--pull never', '--restart no', '--network none', '--cap-drop ALL',
    '--security-opt no-new-privileges', '--read-only', '--pids-limit 512',
    '--memory 4g', '--memory-swap 4g', '--cpus 2', '--stop-timeout 30',
    '--log-driver json-file', '--log-opt max-size=20m', '--log-opt max-file=5',
    '--env "EXPECTED_SERVICE_UID=$SERVICE_UID"',
    '--env "EXPECTED_SERVICE_GID=$SERVICE_GID"',
    '--env EXPECTED_PIDS_LIMIT=512',
    '--env EXPECTED_MEMORY_BYTES=4294967296',
    '--env EXPECTED_CPU_LIMIT=2.0',
    '--env EXPECTED_LOG_MAX_SIZE=20m',
    '--env EXPECTED_LOG_MAX_FILES=5',
    '--env EXPECTED_STOP_GRACE_PERIOD=30s'
];

function workflowStep(source, id) {
    const lines = source.split('\n');
    const marker = lines.findIndex((line) => line.trim() === `id: ${id}`);
    assert.notEqual(marker, -1, `missing step ${id}`);
    let start = marker;
    while (start >= 0 && !/^\s*-\s+name:/.test(lines[start])) start -= 1;
    let end = marker + 1;
    while (end < lines.length && !/^\s*-\s+name:/.test(lines[end])) end += 1;
    return lines.slice(start, end).join('\n');
}

function workflowContract(action = ACTION, publication = PUBLICATION, source = SOURCE) {
    const start = workflowStep(action, 'container_start');
    const smoke = workflowStep(action, 'smoke_gate');
    const roundTrip = workflowStep(publication, 'digest_roundtrip');
    assert.match(start,
        /container_id="\$\([\s\S]*docker run --detach[\s\S]*\)"[\s\S]*container_id=\$container_id/);
    assert.doesNotMatch(start, /State\.Pid|\/usr\/bin\/ps/);
    assert.match(smoke,
        /EXPECTED_CONTAINER_ID: \$\{\{ steps\.container_start\.outputs\.container_id \}\}/);
    assert.match(smoke, /^\s*node scripts\/i8-runtime-state-proof\.js\s*$/m);
    assert.ok(smoke.indexOf('node scripts/i8-runtime-state-proof.js')
        < smoke.indexOf('node scripts/i4-image-runtime-envelope.js'));
    assert.match(roundTrip, /^\s*node scripts\/i8-runtime-state-proof\.js\s*$/m);
    assert.ok(roundTrip.indexOf('node scripts/i8-runtime-state-proof.js')
        < roundTrip.indexOf('node scripts/i7-production-compose-contract.js'));
    for (const runtimeAnchor of DIGEST_RUNTIME_ANCHORS) {
        assert.ok(roundTrip.includes(runtimeAnchor), `missing digest runtime anchor ${runtimeAnchor}`);
    }
    assert.match(roundTrip,
        /container_id="\$\([\s\S]*docker run --detach[\s\S]*\n\s+"\$RUNTIME_IMAGE_REF"\n\s+\)"/,
        'the digest runtime container must start from the proved local publication alias');
    assert.doesNotMatch(`${action}\n${publication}`,
        /docker inspect --format '\{\{\.State\.Pid\}\}'/);
    for (const field of [
        '.Id', '.Image', '.State.Status', '.State.Running', '.State.Paused',
        '.State.Restarting', '.State.Dead', '.State.Pid', '.State.Health.Status',
        '.State.ExitCode', '.State.OOMKilled', '.State.Error'
    ]) assert.ok(source.includes(field), `missing inspect field ${field}`);
    for (const anchor of [
        'const MAX_ATTEMPTS = 120;', 'const WAIT_MS = 2000;',
        "'container', 'inspect', '--format', INSPECT_FORMAT",
        "runExact('/usr/bin/ps', ['-o', 'uid=,gid=', '-p', String(pid)]",
        'runtime_container_log_begin', "'docker', ['logs', '--tail', '200'",
        "state.status !== 'running'",
        "state.paused || state.status === 'paused'",
        "state.restarting || state.status === 'restarting'",
        "state.dead || state.status === 'dead'",
        "state.health === 'healthy'", '/^[1-9][0-9]*$/.test(String(state.pid))'
    ]) assert.ok(source.includes(anchor), `missing helper anchor ${anchor}`);
    assert.doesNotMatch(source,
        /\bdocker exec\b|--privileged|--network host|console\.log\(process\.env|JSON\.stringify\(process\.env\)/);
    assert.doesNotMatch(publication, new RegExp(OLD_TAG));
    assert.doesNotMatch(publication, /gh api[\s\S]{0,120}--method DELETE/);
}

test('workflow ordering, digest identity, quarantine, and mutation contracts remain fail closed',
    async (t) => {
        workflowContract();
        const mutations = [
            ['shared runtime proof removed', ACTION,
                '          node scripts/i8-runtime-state-proof.js\n', '', workflowContract],
            ['Compose runs before runtime proof', PUBLICATION,
                '          CONTAINER_NAME="$I8_DIGEST_CONTAINER_NAME" \\\n'
                    + '            EXPECTED_CONTAINER_ID="$container_id" \\\n'
                    + '            node scripts/i8-runtime-state-proof.js\n'
                    + '          node scripts/i7-production-compose-contract.js',
                '          node scripts/i7-production-compose-contract.js\n'
                    + '          CONTAINER_NAME="$I8_DIGEST_CONTAINER_NAME" \\\n'
                    + '            EXPECTED_CONTAINER_ID="$container_id" \\\n'
                    + '            node scripts/i8-runtime-state-proof.js',
                (value) => workflowContract(ACTION, value)],
            ['Candidate runtime proof failure neutralized', PUBLICATION,
                '            node scripts/i8-runtime-state-proof.js',
                '            node scripts/i8-runtime-state-proof.js || true',
                (value) => workflowContract(ACTION, value)],
            ['running status requirement removed', SOURCE,
                "state.status !== 'running'", 'false',
                (value) => workflowContract(ACTION, PUBLICATION, value)],
            ['paused transition requirement removed', SOURCE,
                "state.paused || state.status === 'paused'", 'false',
                (value) => workflowContract(ACTION, PUBLICATION, value)],
            ['restarting transition requirement removed', SOURCE,
                "state.restarting || state.status === 'restarting'", 'false',
                (value) => workflowContract(ACTION, PUBLICATION, value)],
            ['dead transition requirement removed', SOURCE,
                "state.dead || state.status === 'dead'", 'false',
                (value) => workflowContract(ACTION, PUBLICATION, value)],
            ['old tag overwrite introduced', PUBLICATION,
                '          node scripts/i7-production-compose-contract.js',
                `          docker push ghcr.io/botond1/3d-printer-slicer-api:${OLD_TAG}\n`
                    + '          node scripts/i7-production-compose-contract.js',
                (value) => workflowContract(ACTION, value)],
            ['registry delete introduced', PUBLICATION,
                '          node scripts/i7-production-compose-contract.js',
                '          gh api --method DELETE repos/Botond1/3D-Printer-Slicer-API/packages/container/x\n'
                    + '          node scripts/i7-production-compose-contract.js',
                (value) => workflowContract(ACTION, value)],
            ['digest runtime container switched from local alias to digest', PUBLICATION,
                '              "$RUNTIME_IMAGE_REF"\n          )"',
                '              "$DIGEST_REF"\n          )"',
                (value) => workflowContract(ACTION, value)]
        ];
        for (const [name, original, from, to, validate] of mutations) {
            await t.test(name, () => {
                assert.ok(original.includes(from), `missing mutation anchor ${name}`);
                assert.throws(() => validate(original.replace(from, to)));
            });
        }
        for (const runtimeAnchor of DIGEST_RUNTIME_ANCHORS) {
            await t.test(`digest runtime contract rejects removal of ${runtimeAnchor}`, () => {
                assert.ok(PUBLICATION.includes(runtimeAnchor), `missing mutation anchor ${runtimeAnchor}`);
                assert.throws(() => workflowContract(ACTION, PUBLICATION.replace(runtimeAnchor, '')));
            });
        }
    });
