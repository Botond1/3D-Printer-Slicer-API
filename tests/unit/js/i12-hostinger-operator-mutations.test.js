'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
    ALLOWLIST_PLACEHOLDER,
    DISABLED_HOST,
    LIVE_DYNAMIC_RELEASE_MISMATCH,
    PACK_ROOT,
    loadOperatorPack,
    validateCapacityProducerSource,
    validateComposeSource,
    validateLiveDynamicSource,
    validateRouterSource,
    validateRunbookSource
} = require('../../../scripts/i12-hostinger-operator-contract');

const SOURCES = loadOperatorPack();

function replaceRequired(source, pattern, replacement) {
    if (typeof pattern === 'string') {
        assert.ok(source.includes(pattern), `missing mutation seam: ${pattern}`);
    } else {
        assert.match(source, pattern, `missing mutation seam: ${pattern}`);
    }
    const mutated = source.replace(pattern, replacement);
    assert.notEqual(mutated, source, `mutation did not change source: ${pattern}`);
    return mutated;
}

function assertRejected(validator, source, label) {
    const result = validator(source);
    assert.equal(typeof result, 'string', `${label} must fail closed`);
    assert.match(result, /^[a-z][a-z0-9_]*$/, `${label} must return a stable reason code`);
}

test('live dynamic source release mutations fail closed', async (t) => {
    const expected = path.join(PACK_ROOT, 'dynamic');
    const differentRelease = path.join(path.dirname(PACK_ROOT), 'different-release', 'dynamic');
    const cases = [
        ['different release', differentRelease, undefined],
        ['relative source', path.relative(PACK_ROOT, expected), undefined],
        ['trailing separator alias', `${expected}${path.sep}`, undefined],
        ['dot-dot alias', `${expected}${path.sep}..${path.sep}dynamic`, undefined],
        ['realpath mismatch', expected, {
            lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
            realpathSync: () => differentRelease
        }],
        ['non-directory source', expected, {
            lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => false }),
            realpathSync: () => expected
        }],
        ['symlink source', expected, {
            lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
            realpathSync: () => expected
        }]
    ];
    assert.equal(validateLiveDynamicSource(expected), null);
    for (const [label, source, runtimeFs] of cases) await t.test(label, () => {
        assert.equal(
            validateLiveDynamicSource(source, runtimeFs),
            LIVE_DYNAMIC_RELEASE_MISMATCH
        );
    });
});

test('Compose mutations cannot widen publication, privilege, mount, or network scope', async (t) => {
    const compose = SOURCES.compose;
    const cases = [
        ['version check enabled', replaceRequired(compose, /global\.checkNewVersion=false/, 'global.checkNewVersion=true')],
        ['anonymous usage enabled', replaceRequired(compose, /global\.sendAnonymousUsage=false/, 'global.sendAnonymousUsage=true')],
        ['mutable Traefik tag', replaceRequired(compose, /^    image:.*$/m, '    image: traefik:v3.7.11')],
        ['digest drift', replaceRequired(compose, /5203c3f/, '0203c3f')],
        ['extra host port', replaceRequired(compose, /^    ports:\n/m, '    ports:\n      - "3000:3000/tcp"\n')],
        ['host networking', replaceRequired(compose, /^    ports:\n/m, '    network_mode: host\n    ports:\n')],
        ['writable root', replaceRequired(compose, /^    read_only: true$/m, '    read_only: false')],
        ['privileged runtime', replaceRequired(compose, /^    read_only: true$/m, '    privileged: true\n    read_only: true')],
        ['capability added', replaceRequired(compose, /^    cap_drop:\n/m, '    cap_add:\n      - NET_ADMIN\n    cap_drop:\n')],
        ['capability drop weakened', replaceRequired(compose, /^      - ALL$/m, '      - NET_RAW')],
        ['no-new-privileges weakened', replaceRequired(compose, /no-new-privileges:true/, 'no-new-privileges:false')],
        ['tmpfs executable', replaceRequired(compose, /,noexec/, '')],
        ['world-writable tmpfs', replaceRequired(compose, /mode=0700/, 'mode=0777')],
        ['Docker provider reintroduced', replaceRequired(
            compose,
            /^      - --providers\.file=true$/m,
            '      - --providers.docker=true\n      - --providers.file=true'
        )],
        ['dynamic config writable', replaceRequired(
            compose,
            /(source: \.\/dynamic\n        target: \/etc\/traefik\/dynamic\n        )read_only: true/,
            '$1read_only: false'
        )],
        ['Docker socket reintroduced', replaceRequired(
            compose,
            /^      - type: volume\n        source: traefik-acme/m,
            '      - type: bind\n        source: /var/run/docker.sock\n'
                + '        target: /var/run/docker.sock\n        read_only: true\n'
                + '      - type: volume\n        source: traefik-acme'
        )],
        ['router template loaded initially', replaceRequired(compose, /source: \.\/dynamic/, 'source: ./templates')],
        ['private network not external', replaceRequired(compose, /^    external: true$/m, '    external: false')],
        ['private network renamed', replaceRequired(compose, /^    name: slicer-api-private$/m, '    name: broad-shared-network')],
        ['ingress internal flag removed', replaceRequired(compose, /^    internal: false\n/m, '')],
        ['ingress made internal', replaceRequired(compose, /^    internal: false$/m, '    internal: true')],
        ['extra top-level ingress option', replaceRequired(
            compose,
            /^    internal: false$/m,
            '    internal: false\n    attachable: true'
        )],
        ['ingress gateway priority removed', replaceRequired(compose, /^        gw_priority: 1\n/m, '')],
        ['private gateway priority removed', replaceRequired(compose, /^        gw_priority: 0\n/m, '')],
        ['gateway priorities tied at zero', replaceRequired(compose, /^        gw_priority: 1$/m, '        gw_priority: 0')],
        ['gateway priorities tied at one', replaceRequired(compose, /^        gw_priority: 0$/m, '        gw_priority: 1')],
        ['gateway priorities reversed', replaceRequired(
            compose,
            '        gw_priority: 1\n      slicer-api-private:\n        gw_priority: 0',
            '        gw_priority: 0\n      slicer-api-private:\n        gw_priority: 1'
        )],
        ['ordinary priority substituted', replaceRequired(compose, /gw_priority/g, 'priority')],
        ['short network list restored', replaceRequired(
            compose,
            '    networks:\n      traefik-ingress:\n        gw_priority: 1\n      slicer-api-private:\n        gw_priority: 0',
            '    networks:\n      - traefik-ingress\n      - slicer-api-private'
        )],
        ['extra service network attachment', replaceRequired(
            compose,
            /^    restart: unless-stopped$/m,
            '      unexpected-network:\n        gw_priority: 0\n    restart: unless-stopped'
        )],
        ['extra ingress network option', replaceRequired(
            compose,
            /^        gw_priority: 1$/m,
            '        gw_priority: 1\n        priority: 100'
        )],
        ['extra peer service', replaceRequired(
            compose,
            /^networks:\n/m,
            '  forward-proxy:\n    image: nginx:latest\nnetworks:\n'
        )],
        ['extra network', replaceRequired(
            compose,
            /^networks:\n/m,
            'networks:\n  broad-default:\n    driver: bridge\n'
        )],
        ['embedded credential', replaceRequired(
            compose,
            /^    labels:\n/m,
            '    environment:\n      API_KEY: "not-a-real-secret-but-forbidden"\n    labels:\n'
        )],
        ['host gateway escape', replaceRequired(
            compose,
            /^    labels:\n/m,
            '    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    labels:\n'
        )],
        ['legacy short healthcheck', replaceRequired(
            compose,
            /^      test: \["CMD", "traefik", "healthcheck".*$/m,
            '      test: ["CMD", "traefik", "healthcheck", "--ping"]'
        )],
        ['healthcheck ping disabled', replaceRequired(
            compose,
            /healthcheck", "--ping=true"/,
            'healthcheck", "--ping=false"'
        )],
        ['healthcheck entrypoint drift', replaceRequired(
            compose,
            /--ping\.entryPoint=health/,
            '--ping.entryPoint=traefik'
        )],
        ['healthcheck endpoint drift', replaceRequired(
            compose,
            /--entryPoints\.health\.address=127\.0\.0\.1:8082/,
            '--entryPoints.health.address=127.0.0.1:8080'
        )]
    ];
    for (const [label, source] of cases) {
        await t.test(label, () => assertRejected(validateComposeSource, source, label));
    }
});

test('CLI-only static and ACME mutations fail closed', async (t) => {
    const compose = SOURCES.compose;
    const cases = [
        ['redirect removed', replaceRequired(compose, /^      - --entryPoints\.web\.http\.redirections\.entryPoint\.to=.*\n/m, '')],
        ['redirect reverted to internal entrypoint', replaceRequired(
            compose, /entryPoint\.to=:443/, 'entryPoint.to=websecure'
        )],
        ['redirect leaked internal port', replaceRequired(
            compose, /entryPoint\.to=:443/, 'entryPoint.to=:8443'
        )],
        ['redirect scheme weakened', replaceRequired(compose, /entryPoint\.scheme=https/, 'entryPoint.scheme=http')],
        ['redirect permanence weakened', replaceRequired(compose, /entryPoint\.permanent=true/, 'entryPoint.permanent=false')],
        ['file provider disabled', replaceRequired(compose, /providers\.file=true/, 'providers.file=false')],
        ['file provider drift', replaceRequired(compose, /file\.directory=\/etc\/traefik\/dynamic/, 'file.directory=/etc/traefik')],
        ['file watch disabled', replaceRequired(compose, /providers\.file\.watch=true/, 'providers.file.watch=false')],
        ['dashboard enabled', replaceRequired(compose, /api\.dashboard=false/, 'api.dashboard=true')],
        ['insecure API enabled', replaceRequired(compose, /api\.insecure=false/, 'api.insecure=true')],
        ['generic HTTP provider', replaceRequired(
            compose,
            /^      - --providers\.file\.directory=/m,
            '      - --providers.http.endpoint=https://config.invalid\n      - --providers.file.directory='
        )],
        ['direct privileged entrypoint', replaceRequired(compose, /web\.address=:8080/, 'web.address=:80')],
        ['static file mixed in', replaceRequired(
            compose,
            /^    ports:\n/m,
            '      - --configFile=/etc/traefik/traefik.yml\n    ports:\n'
        )],
        ['ACME email removed', replaceRequired(compose, /^      - --certificatesResolvers.*acme\.email=.*\n/m, '')],
        ['ACME email hardcoded', replaceRequired(
            compose,
            /acme\.email=\$\{ACME_EMAIL:[^}]+\}/,
            'acme.email=operator@example.invalid'
        )],
        ['ACME storage drift', replaceRequired(compose, /storage=\/letsencrypt\/acme\.json/, 'storage=/tmp/acme.json')],
        ['ACME challenge disabled', replaceRequired(compose, /httpChallenge=true/, 'httpChallenge=false')],
        ['ACME challenge entrypoint drift', replaceRequired(compose, /httpChallenge\.entryPoint=web/, 'httpChallenge.entryPoint=websecure')],
        ['ACME mount drift', replaceRequired(compose, /target: \/letsencrypt/, 'target: /tmp/letsencrypt')],
        ['ACME mount made read-only', replaceRequired(compose, /target: \/letsencrypt/, 'target: /letsencrypt\n        read_only: true')],
        ['ACME volume not external', replaceRequired(
            compose,
            /(TRAEFIK_ACME_VOLUME:[^\n]+\n    )external: true/,
            '$1external: false'
        )],
        ['ACME volume name hardcoded', replaceRequired(
            compose,
            /name: "\$\{TRAEFIK_ACME_VOLUME:[^}]+\}"/,
            'name: traefik-acme-new'
        )]
    ];
    for (const [label, source] of cases) {
        await t.test(label, () => assertRejected(validateComposeSource, source, label));
    }
});

test('router mutations cannot become a generic proxy or drift from the exact API', async (t) => {
    const router = SOURCES.routerTemplate;
    const cases = [
        ['backend container drift', replaceRequired(router, /3d-psa-backend-server/, 'attacker-backend')],
        ['backend port drift', replaceRequired(router, /:3000/, ':8080')],
        ['catch-all host rule', replaceRequired(router, /Host\(`slicer-api\.invalid`\)/, 'HostRegexp(`{host:.+}`)')],
        ['path prefix widening', replaceRequired(router, /^      service: slicer-api$/m, '      rule: "PathPrefix(`/`)"\n      service: slicer-api')],
        ['plain HTTP entrypoint', replaceRequired(router, /- websecure/, '- web')],
        ['TLS removed', replaceRequired(router, /^      tls:\n        certResolver: letsencrypt\n/m, '')],
        ['certificate resolver drift', replaceRequired(router, /certResolver: letsencrypt/, 'certResolver: default')],
        ['readiness path drift', replaceRequired(router, /path: \/ready/, 'path: /health')],
        ['duplicate passHostHeader override', replaceRequired(
            router,
            /^        passHostHeader: true$/m,
            '        passHostHeader: true\n        passHostHeader: false'
        )],
        ['second healthCheck block', replaceRequired(
            router,
            /^        servers:$/m,
            '        healthCheck:\n          path: /health\n          interval: 10s\n'
                + '          timeout: 3s\n        servers:'
        )],
        ['extra backend', replaceRequired(router, /^          - url:.*$/m, '$&\n          - url: "http://other:3000"')],
        ['multiline extra backend item', replaceRequired(
            router,
            /^          - url:.*$/m,
            '$&\n          -\n            url: "http://other:3000"'
        )],
        ['forward-auth scope', replaceRequired(router, /^      service: slicer-api$/m, '      middlewares: [forwardAuth]\n      service: slicer-api')]
    ];
    for (const [label, source] of cases) {
        await t.test(label, () => assertRejected(
            (candidate) => validateRouterSource(candidate, DISABLED_HOST, true), source, label
        ));
    }
});

test('router allowlist mutations cannot widen the direct-peer single-/32 boundary', async (t) => {
    const router = SOURCES.routerTemplate;
    const cases = [
        ['legacy IPWhiteList', replaceRequired(router, /ipAllowList:/, 'ipWhiteList:')],
        ['ipStrategy depth', replaceRequired(
            router,
            '        sourceRange:',
            '        ipStrategy:\n          depth: 1\n        sourceRange:'
        )],
        ['forwarded headers', replaceRequired(
            router,
            '        sourceRange:',
            '        forwardedHeaders:\n          insecure: true\n        sourceRange:'
        )],
        ['X-Forwarded-For', replaceRequired(
            router,
            '        sourceRange:',
            '        x-forwarded-for: true\n        sourceRange:'
        )],
        ['plural source ranges', replaceRequired(
            router,
            `          - "${ALLOWLIST_PLACEHOLDER}"`,
            `          - "${ALLOWLIST_PLACEHOLDER}"\n          - "198.51.100.20/32"`
        )],
        ['shared /24', replaceRequired(
            router, `"${ALLOWLIST_PLACEHOLDER}"`, '"192.0.2.0/24"'
        )]
    ];
    for (const [label, source] of cases) await t.test(label, () => {
        assertRejected(
            (candidate) => validateRouterSource(candidate, DISABLED_HOST, true),
            source,
            label
        );
    });
});

test('runbook mutations cannot skip identity, hash, atomic activation, or safe rollback', async (t) => {
    const runbook = SOURCES.runbook;
    const cases = [
        ['ordering drift', runbook
            .replace('## 2. Start and qualify the API while it is dark', '## TEMPORARY HEADING')
            .replace(
                '## 5. Disable and roll back without destroying state',
                '## 2. Start and qualify the API while it is dark'
            )
            .replace('## TEMPORARY HEADING', '## 5. Disable and roll back without destroying state')],
        ['bounded identity flags removed', replaceRequired(runbook, /--rm --pull never --network none --read-only --cap-drop ALL/, '--rm')],
        ['production Compose validator removed', replaceRequired(
            runbook,
            /SLICER_API_IMAGE="\$candidate_image" node scripts\/i7-production-compose-contract\.js/,
            'skip production Compose validation'
        )],
        ['rendered API image equality removed', replaceRequired(
            runbook,
            /\[ "\$rendered_api_image" = "\$candidate_image" \] \|\| exit 1/,
            '[ -n "$rendered_api_image" ] || true'
        )],
        ['root identity accepted', replaceRequired(runbook, /reject UID 0 or GID 0/, 'accept UID 0 or GID 0')],
        ['hardcoded API identity', `${runbook}\nSLICER_UID=999\n`],
        ['single qualification pass', replaceRequired(runbook, /matrix twice/, 'matrix once')],
        ['Compose minimum version gate removed', replaceRequired(
            runbook,
            /node scripts\/i12-hostinger-operator-contract\.js --check-compose-version "\$compose_version" \|\| exit 1/,
            'skip Compose version gate'
        )],
        ['Compose interpolation failure absorbed', replaceRequired(
            runbook,
            /config --quiet \|\| exit 1/,
            'config --quiet || true'
        )],
        ['API and operator source identities conflated', replaceRequired(
            runbook,
            /API-image source commit and signed digest separately from the\nexact operator-pack source commit/,
            'repository commit'
        )],
        ['file-provider-only gate removed', replaceRequired(
            runbook,
            /Docker provider and Engine socket are absent/,
            'Docker discovery may be enabled'
        )],
        ['gateway-priority runtime proof removed', replaceRequired(
            runbook,
            /that the actual default\nroute uses `traefik-ingress`/,
            'that a default route exists'
        )],
        ['ordinary ingress boundary removed', replaceRequired(
            runbook,
            /non-internal `traefik-ingress`/,
            'ingress network'
        )],
        ['effective read-only mount proof removed', replaceRequired(
            runbook,
            /effective `RW=false`/,
            'mount is probably read-only'
        )],
        ['ACME writable-volume contract weakened', replaceRequired(
            runbook,
            /strictly `RW=true` and `Mode="rw"`/,
            'writable when convenient'
        )],
        ['gateway-priority field weakened', replaceRequired(
            runbook,
            /`gw_priority: 1`/,
            '`priority: 1`'
        )],
        ['CLI-only contract removed', replaceRequired(runbook, /CLI-only/, 'configuration')],
        ['ACME mode weakened', replaceRequired(runbook, /mode `0600`/, 'mode `0644`')],
        ['ACME preservation removed', replaceRequired(
            runbook,
            /Never delete, truncate, recreate, reset, or\nreplace the ACME volume or `acme\.json`/,
            'Replace the ACME volume when validation fails'
        )],
        ['ACME volume deletion added', `${runbook}\nRun docker volume rm traefik-acme.\n`],
        ['ACME file truncation added', `${runbook}\nRun truncate /letsencrypt/acme.json.\n`],
        ['previous proxy identity omitted', replaceRequired(
            runbook,
            /previous Traefik image digest/,
            'previous proxy version'
        )],
        ['shared proxy parity stop removed', replaceRequired(
            runbook,
            /STOP_EXISTING_PROXY_PARITY_UNPROVEN/,
            'CONTINUE_WITH_SHARED_PROXY'
        )],
        ['stopped-old retention removed', replaceRequired(
            runbook,
            /Keep the stopped-old rollback retention/,
            'Remove the previous proxy after cutover'
        )],
        ['candidate proxy starts before old listeners close', runbook
            .replace(
                'docker compose --env-file "$operator_values_file" -f ops/hostinger/docker-compose.traefik.yml up --detach --no-deps --pull never traefik',
                'deferred candidate start'
            )
            .replace(
                'Before starting the\ncandidate, inventory the owners of both host ports 80 and 443',
                'docker compose --env-file "$operator_values_file" -f ops/hostinger/docker-compose.traefik.yml up --detach --no-deps --pull never traefik\n'
                    + 'Before starting the\ncandidate, inventory the owners of both host ports 80 and 443'
            )],
        ['dark cutover ACME continuity removed', replaceRequired(
            runbook,
            /dark proxy cutover and any proxy\nrestore must leave that hash unchanged/,
            'proxy cutover may replace the ACME state'
        )],
        ['cleanup consumer unavailable guard removed', replaceRequired(
            runbook,
            /STOP_CLEANUP_CONSUMER_UNAVAILABLE/,
            'CONTINUE_WITHOUT_CLEANUP_CONSUMER'
        )],
        ['cleanup consumer identity drift', replaceRequired(
            runbook,
            /scripts\/i12-capacity-artifact-cleanup\.js/g,
            'scripts/unverified-cleanup.js'
        )],
        ['cleanup consumer mount target drift', replaceRequired(
            runbook,
            /\/run\/i12-capacity-artifact-cleanup\.js/g,
            '/tmp/unverified-cleanup.js'
        )],
        ['cleanup manifest schema removed', replaceRequired(
            runbook,
            /i12-queue-cleanup-v1/,
            'unversioned cleanup data'
        )],
        ['cleanup manifest argument removed', replaceRequired(
            runbook,
            /--cleanup-manifest/,
            '--write-anywhere'
        )],
        ['bounded report target removed', replaceRequired(
            runbook,
            /--report/,
            '--unbounded-report'
        )],
        ['artifact audience credential omitted', replaceRequired(
            runbook,
            /ARTIFACT_API_KEY/g,
            'SHARED_API_KEY'
        )],
        ['producer non-root identity removed', replaceRequired(
            runbook,
            /--service-uid "\$resolved_slicer_uid"/,
            '--service-uid "0"'
        )],
        ['producer helper absolute path removed', replaceRequired(
            runbook,
            /\/usr\/bin\/python3 "\$verified_checkout\/scripts\/i12-capacity-producer-exec\.py"/,
            'python3 scripts/i12-capacity-producer-exec.py'
        )],
        ['producer environment reset removed', replaceRequired(
            runbook,
            /\/usr\/bin\/env -i \\\n/,
            ''
        )],
        ['producer credential-file order drift', replaceRequired(
            runbook,
            '  --slicer-base-url-file "$slicer_base_url_file" \\\n'
                + '  --slice-service-api-key-file "$slice_service_api_key_file" \\\n',
            '  --slice-service-api-key-file "$slice_service_api_key_file" \\\n'
                + '  --slicer-base-url-file "$slicer_base_url_file" \\\n'
        )],
        ['producer ambient environment forwarded', replaceRequired(
            runbook,
            /  \/usr\/bin\/python3 "\$verified_checkout\/scripts\/i12-capacity-producer-exec\.py" \\\n/,
            '  PATH="$PATH" \\\n'
                + '  /usr/bin/python3 "$verified_checkout/scripts/i12-capacity-producer-exec.py" \\\n'
        )],
        ['producer Python absolute path removed', replaceRequired(
            runbook,
            /\/usr\/bin\/python3 "\$verified_checkout\/scripts\/i12-capacity-producer-exec\.py"/,
            'python3 "$verified_checkout/scripts/i12-capacity-producer-exec.py"'
        )],
        ['capacity evidence directory reused', replaceRequired(
            runbook,
            /run_owned_private_dir="\$\(mktemp -d -p "\$evidence_parent" 'i12-capacity\.XXXXXXXXXX'\)" \|\| exit 1/,
            'install -d "$run_owned_private_dir"'
        )],
        ['cleanup non-root identity removed', replaceRequired(
            runbook,
            /--user "\$resolved_slicer_uid:\$resolved_slicer_gid"/,
            '--user 0:0'
        )],
        ['cleanup output bind made read-only', replaceRequired(
            runbook,
            /--mount type=bind,src="\$slicer_output_dir",dst=\/app\/output,rw/,
            '--mount type=bind,src="$slicer_output_dir",dst=/app/output,ro'
        )],
        ['API stop before cleanup removed', replaceRequired(
            runbook,
            /docker compose --env-file "\$operator_values_file" -f docker-compose\.production\.yml stop --timeout 30 slicer-api/,
            'skip API stop'
        )],
        ['stopped container proof weakened', replaceRequired(
            runbook,
            /\[ "\$api_stop_state" = "exited false 0 false" \] \|\| exit 1/,
            '[ -n "$api_stop_state" ] || true'
        )],
        ['cleanup moved before API stop', runbook
            .replace(
                'docker compose --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api',
                'deferred API stop'
            )
            .replace(
                'docker run --rm --pull never --network none --read-only \\\n  --user "$resolved_slicer_uid:$resolved_slicer_gid"',
                'docker run --rm --pull never --network none --read-only \\\n'
                    + 'docker compose --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api\n'
                    + '  --user "$resolved_slicer_uid:$resolved_slicer_gid"'
            )],
        ['cleanup exit initialization removed', replaceRequired(
            runbook,
            /cleanup_exit=0/,
            'cleanup_exit=unrecorded'
        )],
        ['cleanup exit capture removed', replaceRequired(
            runbook,
            /\|\| cleanup_exit=\$\?/,
            '|| true'
        )],
        ['cleanup on runner failure removed', replaceRequired(
            runbook,
            /Run the consumer even when the qualification runner exits nonzero/,
            'Run cleanup only when qualification succeeds'
        )],
        ['same-digest API restart removed', replaceRequired(
            runbook,
            /After the bounded cleanup attempt, restart the API from the same digest/,
            'Leave the API stopped after cleanup'
        )],
        ['restarted API image identity proof removed', replaceRequired(
            runbook,
            /\[ "\$api_runtime_identity" = "\$candidate_image \$candidate_image_id running true 0 false" \] \|\| exit 1/,
            '[ -n "$api_runtime_identity" ] || true'
        )],
        ['restarted dark matrix reduced to one pass', replaceRequired(
            runbook,
            /private-peer matrix twice/,
            'private-peer matrix once'
        )],
        ['qualification exact-zero gate weakened', replaceRequired(
            runbook,
            /\[ "\$qualification_exit" -eq 0 \] \|\| exit 1/,
            '[ -n "$qualification_exit" ] || true'
        )],
        ['cleanup exact-zero gate weakened', replaceRequired(
            runbook,
            /\[ "\$cleanup_exit" -eq 0 \] \|\| exit 1/,
            '[ -n "$cleanup_exit" ] || true'
        )],
        ['capacity result gates moved after Traefik', runbook
            .replace(
                '[ "$qualification_exit" -eq 0 ] || exit 1\n[ "$cleanup_exit" -eq 0 ] || exit 1',
                'deferred capacity result gates'
            )
            .replace(
                '## 3. Start Traefik with routing still disabled',
                '## 3. Start Traefik with routing still disabled\n\n'
                    + '[ "$qualification_exit" -eq 0 ] || exit 1\n'
                    + '[ "$cleanup_exit" -eq 0 ] || exit 1'
            )],
        ['broad recursive deletion added', `${runbook}\nrm -rf /app/output\n`],
        ['DNS disabled boundary removed', replaceRequired(
            runbook,
            /Keep the router disabled while the approved hostname or its DNS result is\nmissing/,
            'Enable the router before hostname and DNS validation'
        )],
        ['config hash removed', replaceRequired(runbook, /exact SHA-256/, 'configuration checksum')],
        ['clobbering route activation', replaceRequired(
            runbook,
            /same-filesystem, no-clobber hard\nlink/,
            'ordinary rename'
        )],
        ['router activation helper bypassed', replaceRequired(
            runbook,
            /--activate-router <temporary-file>/,
            '--skip-activation <temporary-file>'
        )],
        ['router disable helper bypassed', replaceRequired(
            runbook,
            /--disable-router <create-new-retained-path>/,
            '--skip-disable <create-new-retained-path>'
        )],
        ['route disabled before retained identity', replaceRequired(
            runbook,
            /preserves the live\nrouter with a no-clobber hard link/,
            'Unlink the live router before preserving it'
        )],
        ['state preservation removed', replaceRequired(
            runbook,
            /Keep input, output,\nconfigs, pricing-state, the private network, Traefik/,
            'Delete input, output, configs, pricing-state, the private network, Traefik'
        )],
        ['project teardown added', `${runbook}\nRun docker compose -f production.yml down.\n`],
        ['engine prune added', `${runbook}\nRun docker system prune.\n`],
        ['host network fallback added', `${runbook}\nRetry with --network host.\n`]
    ];
    for (const [label, source] of cases) {
        await t.test(label, () => assertRejected(validateRunbookSource, source, label));
    }
});

test('capacity producer credential and exec mutations fail closed', async (t) => {
    const producer = SOURCES.capacityProducerExec;
    const cases = [
        ['no-follow removed', replaceRequired(producer, '"O_RDONLY", "O_CLOEXEC", "O_NOFOLLOW"', '"O_RDONLY", "O_CLOEXEC"')],
        ['credential mode weakened', replaceRequired(producer, '!= 0o600', '!= 0o644')],
        ['root owner weakened', replaceRequired(producer, 'metadata.st_uid != 0 or metadata.st_gid != 0', 'metadata.st_uid < 0')],
        ['hard-link guard removed', replaceRequired(producer, ' or metadata.st_nlink != 1', '')],
        ['credential size bound removed', replaceRequired(producer, 'metadata.st_size > maximum_bytes', 'False')],
        ['no-new-privileges removed', replaceRequired(producer, 'prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)', '0')],
        ['supplementary groups retained', replaceRequired(producer, 'runtime.setgroups([])', 'pass')],
        ['saved UID not dropped', replaceRequired(
            producer,
            'runtime.setresuid(plan.service_uid, plan.service_uid, plan.service_uid)',
            'runtime.seteuid(plan.service_uid)'
        )],
        ['absolute Python drift', replaceRequired(producer, 'PYTHON_EXECUTABLE = "/usr/bin/python3"', 'PYTHON_EXECUTABLE = "python3"')],
        ['execve PATH lookup introduced', replaceRequired(producer, 'runtime.execve(PYTHON_EXECUTABLE', 'runtime.execvpe(PYTHON_EXECUTABLE')],
        ['ambient environment inherited', replaceRequired(
            producer,
            'environment = {',
            'environment = {**os.environ,'
        )],
        ['fifth environment name added', replaceRequired(
            producer,
            '    "ARTIFACT_API_KEY",\n)',
            '    "ARTIFACT_API_KEY",\n    "PATH",\n)'
        )],
        ['secret argv guard removed', replaceRequired(
            producer,
            '        or any(value in argument for value in plan.environment.values() for argument in plan.argv)\n',
            ''
        )],
        ['secret-bearing debug output added', `${producer}\nprint(environment)\n`]
    ];
    for (const [label, source] of cases) {
        await t.test(label, () => assertRejected(validateCapacityProducerSource, source, label));
    }
});
