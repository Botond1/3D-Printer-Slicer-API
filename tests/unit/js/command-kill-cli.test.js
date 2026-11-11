'use strict';

/**
 * T-OOM at the CLI (3.9.0 §4.6): real processes, real `choom`. `choom`
 * replaces itself with the program (`execvp`), so the PID, the process group,
 * the exit status and the signal the classifier reads are the program's own:
 * a `/bin/sh -c 'kill -9 $$'` under the wrapper still reads as
 * `killed_by_system: true`, exactly as it does without it. Skipped where
 * there is no Linux `choom` (Windows dev machines); the image is Ubuntu 24.04
 * (util-linux) and GitHub's Ubuntu runners carry it too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    createCommandRunner,
    createOomWrapper,
    findExecutableOnPath
} = require('../../../app/services/slice/command');
const { spawnFile } = require('../../../app/services/slice/spawn-file');
const { reportNativeFailure } = require('../../../app/services/slice/errors');
const { setEventWriter } = require('../../../app/services/observability/events');

setEventWriter(() => {});

const LINUX = process.platform === 'linux';
const CHOOM = LINUX ? findExecutableOnPath('choom', process.env.PATH) : null;

/**
 * The score the self-test can set: an unprivileged process may raise its
 * score but not lower it, so never ask for less than the runner's own.
 */
function attainableScore() {
    let current = 0;
    try {
        current = Number.parseInt(fs.readFileSync('/proc/self/oom_score_adj', 'utf8'), 10) || 0;
    } catch {
        current = 0;
    }
    return Math.max(500, current);
}

function runnerWith(oomWrapper, pids = []) {
    return createCommandRunner({
        telemetry: 'none',
        oomWrapper,
        execFile: (file, args, options, callback) => {
            const child = spawnFile(file, args, options, callback);
            pids.push(child.pid);
            return child;
        },
        terminationDependencies: { graceMs: 200, pollMs: 10 }
    });
}

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('the command should have failed');
}

test('kill -9 without the wrapper reads as killed_by_system (control)', { skip: !LINUX && 'Linux only' }, async () => {
    const error = await rejection(runnerWith(null)('/bin/sh', ['-c', 'kill -9 $$']));
    assert.equal(error.signal, 'SIGKILL');
    assert.equal(error.killed, false);
    assert.equal(error.cmd, '/bin/sh -c kill -9 $$');
    assert.equal(reportNativeFailure(error).killed_by_system, true);
});

test('under choom: same PID and process group, configured score, kill -9 still killed_by_system',
    { skip: !CHOOM && 'no Linux choom on this host' }, async (t) => {
        const score = attainableScore();
        const wrapper = createOomWrapper({ scoreAdj: score });
        const verdict = await wrapper.resolve();
        if (!verdict.active) {
            t.skip(`wrapper off on this host: ${verdict.reason}`);
            return;
        }
        assert.equal(verdict.choomPath, CHOOM);

        const pids = [];
        const run = runnerWith(wrapper, pids);
        const { stdout } = await run('/bin/sh', ['-c',
            'printf "%s %s " "$$" "$(cut -d" " -f5 /proc/$$/stat)"; cat /proc/self/oom_score_adj']);
        const [pid, group, childScore] = stdout.trim().split(/\s+/).map(Number);
        assert.equal(pid, pids[0], 'choom exec-ed in place: the spawned PID is the program');
        assert.equal(group, pids[0], 'the program leads its own process group (detached)');
        assert.equal(childScore, score, 'descendants inherit the score');

        const killed = await rejection(run('/bin/sh', ['-c', 'kill -9 $$']));
        assert.equal(killed.signal, 'SIGKILL');
        assert.equal(killed.killed, false);
        assert.equal(killed.cmd, '/bin/sh -c kill -9 $$', 'the error names the original program');
        assert.match(killed.message, /^Command failed: \/bin\/sh -c kill -9 \$\$/);
        assert.equal(reportNativeFailure(killed).killed_by_system, true);

        const exited = await rejection(run('/bin/sh', ['-c', 'exit 137']));
        assert.equal(exited.code, 137);
        assert.equal(reportNativeFailure(exited).killed_by_system, true);

        const unwrappedMissing = await rejection(runnerWith(null)('/nonexistent/r3d-native', ['a']));
        const missing = await rejection(run('/nonexistent/r3d-native', ['a']));
        assert.equal(missing.code, unwrappedMissing.code);
        assert.equal(missing.code, 'ENOENT');
        assert.equal(missing.message, unwrappedMissing.message);
        assert.equal(missing.stderr, unwrappedMissing.stderr);
    });

test('the runner terminates a wrapped tree on abort', { skip: !CHOOM && 'no Linux choom on this host' }, async (t) => {
    const wrapper = createOomWrapper({ scoreAdj: attainableScore() });
    if (!(await wrapper.resolve()).active) {
        t.skip('wrapper off on this host');
        return;
    }
    const controller = new AbortController();
    const running = runnerWith(wrapper)('/bin/sh', ['-c', 'sleep 30 & wait'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const error = await rejection(running);
    assert.equal(error.name, 'AbortError');
});
