'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    PACK_ROOT,
    loadOperatorPack,
    validateAllowlistProbeSource,
    validateOperatorPack,
    validatePerimeterScriptSource,
    validatePerimeterServiceSource
} = require('../../../scripts/i12-hostinger-operator-contract');

const SOURCES = loadOperatorPack();
const ROOT = path.resolve(__dirname, '../../..');

function replaceRequired(source, pattern, replacement) {
    if (typeof pattern === 'string') assert.ok(source.includes(pattern), `missing mutation seam: ${pattern}`);
    else assert.match(source, pattern, `missing mutation seam: ${pattern}`);
    const mutated = source.replace(pattern, replacement);
    assert.notEqual(mutated, source, `mutation did not change source: ${pattern}`);
    return mutated;
}

function assertRejected(validator, source, label) {
    const result = validator(source);
    assert.equal(typeof result, 'string', `${label} must fail closed`);
    assert.match(result, /^[a-z][a-z0-9_]*$/, `${label} must return a stable reason code`);
}

test('versioned Hostinger perimeter artifacts satisfy the operator-pack contract', () => {
    assert.equal(validatePerimeterScriptSource(SOURCES.perimeterScript), null);
    assert.equal(validateAllowlistProbeSource(SOURCES.allowlistProbe), null);
    assert.equal(validatePerimeterServiceSource(SOURCES.perimeterService), null);
    assert.equal(validateOperatorPack(SOURCES), null);
    assert.doesNotMatch(
        `${SOURCES.perimeterScript}\n${SOURCES.allowlistProbe}\n${SOURCES.perimeterService}`,
        /\b[a-z0-9.-]+\.hu\b|\b[0-9a-f]{40}\b/i
    );
});

test('perimeter shell artifacts and systemd unit retain executable repository modes', () => {
    const expected = new Map([
        ['ops/hostinger/perimeter/r3d-perimeter.sh', '100755'],
        ['ops/hostinger/perimeter/r3d-allowlist-probe.sh', '100755'],
        ['ops/hostinger/perimeter/r3d-perimeter.service', '100644']
    ]);
    for (const [relative, mode] of expected) {
        const result = spawnSync('git', ['ls-files', '--stage', '--', relative], {
            cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`^${mode} [0-9a-f]{40,64} [0-3]\\t`));
    }
});

test('perimeter script mutations fail closed', async (t) => {
    const source = SOURCES.perimeterScript;
    const cases = [
        ['release path fallback restored', replaceRequired(
            source,
            ': "${R3D_ALLOWLIST_FILE:?Set R3D_ALLOWLIST_FILE to the absolute root-private allowlist path}"',
            'ALLOWLIST_FILE="${R3D_ALLOWLIST_FILE:-/etc/rocket3d/slicer-api/deadbeef/allowlist.txt}"'
        )],
        ['original destination removed', replaceRequired(
            source,
            '--ctorigdst "$PUBIP" --ctorigdstport 443',
            '--ctorigdstport 443'
        )],
        ['plain post-DNAT port restored', replaceRequired(
            source,
            'iptables -I DOCKER-USER "$pos" -i "$IFACE" -p tcp -m conntrack --ctorigdst "$PUBIP" --ctorigdstport 443',
            'iptables -I DOCKER-USER "$pos" -i "$IFACE" -p tcp --dport 443'
        )],
        ['allow return removed', replaceRequired(
            source, '--comment "$TAG_ALLOW" -j RETURN', '--comment "$TAG_ALLOW" -j ACCEPT'
        )],
        ['rate limit removed', replaceRequired(
            source, '-m limit --limit 6/min --limit-burst 10', '-m limit'
        )],
        ['deny changed to DROP', replaceRequired(
            source, '--comment "$TAG_DENY" -j REJECT --reject-with tcp-reset',
            '--comment "$TAG_DENY" -j DROP'
        )],
        ['timeout measurement shortened', replaceRequired(
            source, '#   waits the full timeout and receives nothing:',
            '#   receives a reset immediately:'
        )],
        ['REJECT versus DROP evidence warning removed', replaceRequired(
            source, '#   told separately. Do not re-litigate REJECT vs DROP here without new',
            '#   told separately.'
        )],
        ['descending IPv4 deletion weakened', replaceRequired(
            source, "sort -rn); do\n        iptables -D DOCKER-USER \"$n\"",
            "sort -n); do\n        iptables -D DOCKER-USER \"$n\""
        )],
        ['IPv6 rule moved to DOCKER-USER', replaceRequired(
            source, 'ip6tables -I INPUT 1 -p tcp --dport 443',
            'ip6tables -I DOCKER-USER 1 -p tcp --dport 443'
        )],
        ['IPv6 NEW state removed', replaceRequired(
            source, '--dport 443 -m conntrack --ctstate NEW', '--dport 443'
        )],
        ['IPv6 port 80 filtered', replaceRequired(
            source, 'ip6tables -I INPUT 1 -p tcp --dport 443',
            'ip6tables -I INPUT 1 -p tcp --dport 80'
        )],
        ['ACME guard weakened', replaceRequired(
            source, '--dport $HTTP_CPORT|--ctorigdstport 80', '--dport 22'
        )],
        ['public address literal added', `${source}\nPUBIP=198.51.100.42\n`]
    ];
    for (const [label, mutated] of cases) await t.test(label, () => {
        assertRejected(validatePerimeterScriptSource, mutated, label);
    });
});

test('allowlist probe mutations fail closed', async (t) => {
    const source = SOURCES.allowlistProbe;
    const cases = [
        ['production hostname default restored', replaceRequired(
            source, 'HOST="${R3D_PROBE_HOST:-slicer-api.invalid}"',
            'HOST="${R3D_PROBE_HOST:-production-host.example}"'
        )],
        ['loopback resolution removed', replaceRequired(
            source, '--resolve "$HOST:443:127.0.0.1"', '--resolve "$HOST:443:$HOST"'
        )],
        ['403 success changed', replaceRequired(source, '    403)', '    401)')],
        ['fail-open 200 accepted', replaceRequired(source, '    200)', '    201)')],
        ['loopback explanation shortened', replaceRequired(
            source, '# WHY 127.0.0.1 AND NOT THE PUBLIC NAME:', '# WHY LOOPBACK:'
        )]
    ];
    for (const [label, mutated] of cases) await t.test(label, () => {
        assertRejected(validateAllowlistProbeSource, mutated, label);
    });
});

test('perimeter service mutations fail closed', async (t) => {
    const source = SOURCES.perimeterService;
    const cases = [
        ['Docker restart coupling removed', replaceRequired(
            source, 'PartOf=docker.service', 'PartOf=network.target'
        )],
        ['environment file made optional', replaceRequired(
            source,
            'EnvironmentFile=/etc/rocket3d/slicer-api/r3d-perimeter.env',
            'EnvironmentFile=-/etc/rocket3d/slicer-api/r3d-perimeter.env'
        )],
        ['oneshot weakened', replaceRequired(source, 'Type=oneshot', 'Type=simple')],
        ['remain-after-exit removed', replaceRequired(
            source, 'RemainAfterExit=yes', 'RemainAfterExit=no'
        )],
        ['script path drifted', replaceRequired(
            source, 'ExecStart=/usr/local/sbin/r3d-perimeter.sh',
            'ExecStart=/tmp/r3d-perimeter.sh'
        )]
    ];
    for (const [label, mutated] of cases) await t.test(label, () => {
        assertRejected(validatePerimeterServiceSource, mutated, label);
    });
});

test('perimeter artifacts stay under the bounded Hostinger operator pack', () => {
    for (const relative of [
        'perimeter/r3d-perimeter.sh',
        'perimeter/r3d-allowlist-probe.sh',
        'perimeter/r3d-perimeter.service'
    ]) {
        const resolved = path.resolve(PACK_ROOT, relative);
        assert.ok(resolved.startsWith(`${path.resolve(PACK_ROOT)}${path.sep}`));
    }
});
