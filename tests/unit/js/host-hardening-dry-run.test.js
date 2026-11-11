'use strict';

// WP8 acceptance (3.9.0 §9): the PREPARED host scripts print steps only by
// default (no --execute): host hardening (with the sshd dead-man revert), the
// private A/B runner and the staging-key provisioner.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const BASH = (() => {
    const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    return probe.status === 0 && probe.stdout.trim() === 'ok' ? 'bash' : null;
})();
const skip = BASH ? false : 'bash is not available';
function bashPath(target) {
    if (process.platform !== 'win32') return target;
    return target.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replace(/\\/g, '/');
}
function run(relative, args) {
    return spawnSync(BASH, [bashPath(path.join(ROOT, relative)), ...args], { encoding: 'utf8', timeout: 30000 });
}
const HARDENING = 'ops/hostinger/host-hardening/r3d-host-hardening.sh';

test('host hardening: plan and the sshd dry-run print steps, including the dead-man revert', { skip }, () => {
    const plan = run(HARDENING, []);
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /dead-man `at` job in 10 minutes/);
    assert.match(plan.stdout, /SECOND, FRESH key login/);
    const apply = run(HARDENING, ['sshd-apply']);
    assert.equal(apply.status, 0, apply.stderr);
    for (const line of ['PasswordAuthentication no', 'KbdInteractiveAuthentication no',
        'PermitRootLogin prohibit-password', 'X11Forwarding no', 'MaxAuthTries 3', 'LoginGraceTime 30']) {
        assert.ok(apply.stdout.includes(line), line);
    }
    assert.match(apply.stdout, /DRY-RUN would run sshd -t/);
    assert.match(apply.stdout, /DRY-RUN would arm: at now \+ 10 minutes -> restore the backup/);
    assert.match(apply.stdout, /--execute sshd-confirm/);
    for (const sub of ['fail2ban']) {
        const result = run(HARDENING, [sub]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /DRY-RUN would/);
    }
    const unknown = run(HARDENING, ['rm-everything']);
    assert.notEqual(unknown.status, 0);
});

test('host hardening: the script never locks a password and keeps the letsencrypt volume', () => {
    const source = fs.readFileSync(path.join(ROOT, HARDENING), 'utf8');
    // Named only in the printed advice, never run as a command.
    assert.doesNotMatch(source, /^\s*(?:[^#\n`]*[;&|]\s*)?passwd\s+-l\b/m);
    assert.doesNotMatch(source, /docker rm -v|docker volume rm|docker rm --volumes/);
    assert.match(source, /echo "sh \$backup\/restore\.sh" \| at now \+ "\$DEADMAN_MINUTES" minutes/);
    assert.match(source, /\[ "\$SSH_CONNECTION" != "\$applied_conn" \]/);
    assert.match(source, /atrm "\$job"/);
});

test('private A/B and staging key: plan and dry-runs only print', { skip }, () => {
    const plan = run('ops/hostinger/private-ab/run-private-ab.sh', []);
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /heavy-gate/);
    for (const args of [['up', 'B', 'ghcr.io/botond1/3d-printer-slicer-api@sha256:' + 'b'.repeat(64)],
        ['heavy', '60'], ['heavy-gate'], ['down']]) {
        const result = run('ops/hostinger/private-ab/run-private-ab.sh', args);
        assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`);
        assert.match(result.stdout, /DRY-RUN would/);
    }
    const compose = fs.readFileSync(path.join(ROOT, 'ops/hostinger/private-ab/compose.private.yml'), 'utf8');
    assert.match(compose, /oom_score_adj: 1000/);
    assert.match(compose, /internal: true/);
    assert.doesNotMatch(compose, /^\s+ports:/m);
    const key = run('ops/hostinger/keyring/provision-staging-key.sh', []);
    assert.equal(key.status, 0, key.stderr);
    assert.match(key.stdout, /never printed/);
    const generate = run('ops/hostinger/keyring/provision-staging-key.sh', ['generate']);
    assert.equal(generate.status, 0, generate.stderr);
    assert.match(generate.stdout, /DRY-RUN would write a fresh key/);
});
