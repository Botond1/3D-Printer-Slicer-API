'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
    ALLOWLIST_MIDDLEWARE,
    ALLOWLIST_PHASES,
    ALLOWLIST_PLACEHOLDER,
    ACTIVE_ROUTER_IGNORE_PATTERN,
    DISABLED_HOST,
    LIVE_DYNAMIC_RELEASE_MISMATCH,
    MAX_ALLOWLIST_ENTRIES,
    PACK_ROOT,
    PRIVATE_ROLLBACK_DIRECTORY,
    PRIVATE_RUNTIME_DIRECTORY,
    PRIVATE_RUNTIME_IGNORE_PATTERN,
    PRIVATE_STAGING_DIRECTORY,
    REHEARSAL_LOCK_FD,
    REHEARSAL_LOCK_NAME,
    canonicalIpv4Cidr,
    disableRouter,
    inspectPrivateRouterStorageTarget,
    inspectProtectedDirectoryChain,
    inspectRouterSecurityBoundary,
    loadOperatorPack,
    parsePrivateAllowlist,
    readPrivateAllowlistFile,
    renderRouterFile,
    renderRouterSource,
    secureRootPrivateFileMetadata,
    secureRouterDirectoryMetadata,
    secureRouterFileMetadata,
    sameRouterSecurityBoundary,
    validateActiveRouter,
    validateLiveDynamicSource,
    validateRepositoryPrivateStorageContract,
    validateRouterSource,
    validateRunbookSource,
    verifyRouterRehearsalLock,
    validFirewallBackend
} = require('../../../scripts/i12-hostinger-operator-contract');

const ROOT = path.resolve(__dirname, '../../..');
const LEADPILOT = '192.0.2.10/32';
const SECOND_DOCUMENTATION_CIDR = '198.51.100.20/32';

function fileStat(overrides = {}) {
    return {
        dev: 11,
        ino: 29,
        uid: 0,
        gid: 0,
        mode: 0o100600,
        nlink: 1,
        size: Buffer.byteLength(`${LEADPILOT}\n`),
        isFile: () => true,
        isSymbolicLink: () => false,
        ...overrides
    };
}

function directoryStat(overrides = {}) {
    return {
        dev: 11,
        ino: 17,
        uid: 0,
        gid: 0,
        mode: 0o40700,
        nlink: 1,
        isDirectory: () => true,
        isSymbolicLink: () => false,
        ...overrides
    };
}

function protectedTreeFilesystem(lockPath, overrides = {}) {
    const lock = fileStat({ ino: 91, size: 0, ...overrides.lock });
    const identities = new Map();
    return {
        lstatSync: (target) => {
            const resolved = path.resolve(target);
            if (resolved === path.resolve(lockPath)) return lock;
            if (!identities.has(resolved)) identities.set(resolved, 100 + identities.size);
            return directoryStat({ ino: identities.get(resolved), ...overrides.directory });
        },
        fstatSync: () => lock,
        realpathSync: (target) => path.resolve(target)
    };
}

function allowlistFilesystem(target, pathStates, descriptorStates) {
    const pathQueue = [...pathStates];
    const descriptorQueue = [...descriptorStates];
    return {
        constants: fs.constants,
        lstatSync: () => pathQueue.shift(),
        realpathSync: () => target,
        openSync: () => 41,
        fstatSync: () => descriptorQueue.shift(),
        readFileSync: () => Buffer.from(`${LEADPILOT}\n`, 'utf8'),
        closeSync: () => {}
    };
}

function mutateRequired(source, from, to) {
    if (typeof from === 'string') {
        assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    } else {
        assert.match(source, from, `missing mutation seam: ${from}`);
    }
    const mutated = source.replace(from, to);
    assert.notEqual(mutated, source, `mutation did not change source: ${from}`);
    return mutated;
}

function runGit(repositoryRoot, args) {
    const result = spawnSync('git', args, {
        cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000, windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

function createPrivateStorageRepository(prefix = 'j2-private-router-') {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const packRoot = path.join(repositoryRoot, 'ops', 'hostinger');
    const dynamic = path.join(packRoot, 'dynamic');
    const runtimeRoot = path.join(packRoot, PRIVATE_RUNTIME_DIRECTORY);
    const staging = path.join(runtimeRoot, PRIVATE_STAGING_DIRECTORY);
    const rollback = path.join(runtimeRoot, PRIVATE_ROLLBACK_DIRECTORY);
    fs.mkdirSync(dynamic, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(rollback, { recursive: true });
    fs.writeFileSync(path.join(dynamic, '.gitkeep'), '\n', { flag: 'wx' });
    fs.writeFileSync(
        path.join(repositoryRoot, '.gitignore'),
        `${PRIVATE_RUNTIME_IGNORE_PATTERN}\n${ACTIVE_ROUTER_IGNORE_PATTERN}\n`,
        { encoding: 'utf8', flag: 'wx' }
    );
    runGit(repositoryRoot, ['init', '--quiet']);
    runGit(repositoryRoot, [
        'add', '--', '.gitignore', 'ops/hostinger/dynamic/.gitkeep'
    ]);
    runGit(repositoryRoot, [
        '-c', 'user.name=J2 Fixture', '-c', 'user.email=j2-fixture@example.invalid',
        'commit', '--quiet', '-m', 'fixture'
    ]);
    return {
        dynamic, packRoot, repositoryRoot, rollback, runtimeRoot, staging
    };
}

function metadataView(stat, overrides) {
    return new Proxy(stat, {
        get(target, property) {
            if (Object.prototype.hasOwnProperty.call(overrides, property)) {
                return overrides[property];
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

function withPrivateRouterMetadata(fixture, filePaths, callback) {
    const originalLstatSync = fs.lstatSync;
    const originalFstatSync = fs.fstatSync;
    const parents = [fixture.dynamic, fixture.runtimeRoot, fixture.staging, fixture.rollback]
        .map((target) => path.resolve(target));
    const files = [path.join(fixture.dynamic, '.gitkeep'), ...filePaths]
        .map((target) => path.resolve(target));
    fs.lstatSync = function patchedLstatSync(target, ...args) {
        const stat = originalLstatSync.call(fs, target, ...args);
        const resolved = path.resolve(target);
        if (parents.includes(resolved)) {
            return metadataView(stat, { uid: 0, gid: 0, mode: 0o700 });
        }
        if (files.includes(resolved)) {
            return metadataView(stat, { uid: 0, gid: 0, mode: 0o600 });
        }
        return stat;
    };
    fs.fstatSync = function patchedFstatSync(descriptor, ...args) {
        const stat = originalFstatSync.call(fs, descriptor, ...args);
        return metadataView(stat, { uid: 0, gid: 0, mode: 0o600 });
    };
    try { return callback(); } finally {
        fs.lstatSync = originalLstatSync;
        fs.fstatSync = originalFstatSync;
    }
}

test('private allowlist accepts exactly one canonical IPv4 /32 in the only phase', () => {
    assert.deepEqual(ALLOWLIST_PHASES, ['leadpilot-only']);
    assert.equal(MAX_ALLOWLIST_ENTRIES, 1);
    assert.equal(canonicalIpv4Cidr(LEADPILOT), true);
    assert.equal(canonicalIpv4Cidr('192.000.2.10/32'), false);
    assert.equal(canonicalIpv4Cidr('192.0.2.10/24'), false);

    assert.deepEqual(parsePrivateAllowlist(`${LEADPILOT}\n`, 'leadpilot-only'), {
        error: null,
        cidrs: [LEADPILOT]
    });
    const rejected = [
        ['', 'leadpilot-only', 'j2_allowlist_file_malformed'],
        [LEADPILOT, 'leadpilot-only', 'j2_allowlist_file_malformed'],
        [`${LEADPILOT}\n${LEADPILOT}\n`, 'leadpilot-only', 'j2_allowlist_cidr_invalid'],
        [`${LEADPILOT}\n${SECOND_DOCUMENTATION_CIDR}\n`, 'leadpilot-only', 'j2_allowlist_cidr_invalid'],
        [`${LEADPILOT}\n`, 'expanded', 'j2_allowlist_phase_invalid'],
        [`192.000.2.10/32\n`, 'leadpilot-only', 'j2_allowlist_cidr_invalid'],
        [`192.0.2.0/24\n`, 'leadpilot-only', 'j2_allowlist_cidr_invalid'],
        [`${LEADPILOT}\n`, 'future', 'j2_allowlist_phase_invalid']
    ];
    for (const [source, phase, error] of rejected) {
        assert.equal(parsePrivateAllowlist(source, phase).error, error, `${phase}:${source.length}`);
    }
});

test('private allowlist read re-proves full descriptor and pathname security state', () => {
    const target = path.join(path.parse(ROOT).root, 'j2-root-private-allowlist-test');
    const original = fileStat();
    assert.equal(secureRootPrivateFileMetadata(original, 8, 256), true);
    for (const drift of [
        fileStat({ uid: 1000 }),
        fileStat({ gid: 1000 }),
        fileStat({ mode: 0o100640 }),
        fileStat({ nlink: 2 })
    ]) assert.equal(secureRootPrivateFileMetadata(drift, 8, 256), false);
    assert.equal(readPrivateAllowlistFile(
        path.join(ROOT, 'j2-forbidden-private-allowlist'), 'leadpilot-only', { platform: 'linux' }
    ).error, 'j2_allowlist_file_inside_repository');
    for (const rawAddressPath of [
        path.join(path.parse(ROOT).root, 'private', '192.0.2.10'),
        path.join(path.parse(ROOT).root, 'private', 'leadpilot-192-0-2-10.txt'),
        path.join(path.parse(ROOT).root, 'private', 'leadpilot_192_0_2_10.txt')
    ]) {
        assert.equal(
            readPrivateAllowlistFile(
                rawAddressPath, 'leadpilot-only', { platform: 'linux' }
            ).error,
            'j2_allowlist_file_argument_invalid'
        );
    }

    const accepted = readPrivateAllowlistFile(target, 'leadpilot-only', {
        platform: 'linux',
        fs: allowlistFilesystem(target, [original, original], [original, original])
    });
    assert.deepEqual(accepted, { error: null, cidrs: [LEADPILOT] });

    for (const changedPath of [
        fileStat({ ino: 30 }),
        fileStat({ uid: 1000 }),
        fileStat({ mode: 0o100640 }),
        fileStat({ nlink: 2 })
    ]) {
        const result = readPrivateAllowlistFile(target, 'leadpilot-only', {
            platform: 'linux',
            fs: allowlistFilesystem(target, [original, changedPath], [original, original])
        });
        assert.equal(result.error, 'j2_allowlist_file_changed');
    }

    for (const changedDescriptor of [
        fileStat({ mode: 0o100640 }),
        fileStat({ nlink: 2 }),
        fileStat({ size: original.size + 1 })
    ]) {
        const result = readPrivateAllowlistFile(target, 'leadpilot-only', {
            platform: 'linux',
            fs: allowlistFilesystem(
                target, [original, original], [original, changedDescriptor]
            )
        });
        assert.equal(result.error, 'j2_allowlist_file_changed');
    }
});

test('router activation metadata accepts only root-owned 0600 files under root-owned 0700 parents', () => {
    assert.equal(secureRouterDirectoryMetadata(directoryStat()), true);
    assert.equal(secureRouterDirectoryMetadata(directoryStat({ uid: 1000 })), false);
    assert.equal(secureRouterDirectoryMetadata(directoryStat({ mode: 0o40750 })), false);
    assert.equal(secureRouterFileMetadata(fileStat(), 1), true);
    assert.equal(secureRouterFileMetadata(fileStat({ gid: 1000 }), 1), false);
    assert.equal(secureRouterFileMetadata(fileStat({ mode: 0o100640 }), 1), false);
    assert.equal(secureRouterFileMetadata(fileStat({ nlink: 2 }), 1), false);
    assert.equal(secureRouterFileMetadata(fileStat({ nlink: 2 }), 2), true);
});

test('protected router ancestors are canonical root-owned and immutable across the action', () => {
    const filesystemRoot = path.parse(ROOT).root;
    const packRoot = path.resolve(filesystemRoot, 'srv', 'j2', 'ops', 'hostinger');
    const allowlist = path.resolve(filesystemRoot, 'run', 'j2', 'allowlist');
    const lockPath = path.join(packRoot, PRIVATE_RUNTIME_DIRECTORY, REHEARSAL_LOCK_NAME);
    const stableFs = protectedTreeFilesystem(lockPath);
    const chain = inspectProtectedDirectoryChain(packRoot, stableFs);
    assert.equal(chain.error, null);
    assert.equal(chain.states[0].path, packRoot);
    assert.equal(chain.states.at(-1).path, filesystemRoot);
    const before = inspectRouterSecurityBoundary(packRoot, allowlist, stableFs);
    const after = inspectRouterSecurityBoundary(packRoot, allowlist, stableFs);
    assert.equal(before.error, null);
    assert.equal(after.error, null);
    assert.equal(sameRouterSecurityBoundary(before, after), true);

    const writableFs = protectedTreeFilesystem(lockPath, {
        directory: { mode: 0o40720 }
    });
    assert.equal(
        inspectProtectedDirectoryChain(packRoot, writableFs).error,
        'router_protected_ancestor_unsafe'
    );
    const replacedFs = protectedTreeFilesystem(lockPath, { directory: { ino: 900 } });
    const replaced = inspectRouterSecurityBoundary(packRoot, allowlist, replacedFs);
    assert.equal(replaced.error, null);
    assert.equal(sameRouterSecurityBoundary(before, replaced), false);
});

test('global rehearsal lock rejects an unlocked or concurrent-disable caller deterministically', () => {
    const filesystemRoot = path.parse(ROOT).root;
    const packRoot = path.resolve(filesystemRoot, 'srv', 'j2', 'ops', 'hostinger');
    const lockPath = path.join(packRoot, PRIVATE_RUNTIME_DIRECTORY, REHEARSAL_LOCK_NAME);
    const runtimeFs = protectedTreeFilesystem(lockPath);
    const calls = [];
    const held = verifyRouterRehearsalLock(packRoot, {
        fd: REHEARSAL_LOCK_FD,
        fs: runtimeFs,
        platform: 'linux',
        spawn: (command, args, options) => {
            calls.push({ args, command, options });
            return calls.length % 2 === 1
                ? { error: null, status: 0, stderr: '', stdout: '' }
                : { error: null, status: 75, stderr: '', stdout: '' };
        }
    });
    assert.equal(held.error, null);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, '/usr/bin/flock');
    assert.equal(calls[0].options.stdio[REHEARSAL_LOCK_FD], REHEARSAL_LOCK_FD);
    assert.equal(calls[1].args.at(-2), lockPath);

    for (const [name, statuses] of [
        ['caller never locked FD 9', [0, 0]],
        ['another disable owns the inode', [75, 75]]
    ]) {
        let index = 0;
        const result = verifyRouterRehearsalLock(packRoot, {
            fd: REHEARSAL_LOCK_FD,
            fs: runtimeFs,
            platform: 'linux',
            spawn: () => ({
                error: null, status: statuses[index++], stderr: '', stdout: ''
            })
        });
        assert.equal(result.error, 'router_rehearsal_lock_not_held', name);
    }
});

test('router CLI re-proves the inherited lock and ancestor boundary around every action', () => {
    const source = fs.readFileSync(
        path.join(ROOT, 'scripts', 'i12-hostinger-operator-contract.js'), 'utf8'
    );
    assert.equal(source.split('verifyRouterRehearsalLock(PACK_ROOT)').length - 1, 3);
    assert.match(source, /'--recover-router-dark', '--assert-router-dark'/);
    const initialLock = source.indexOf('const initialLock = verifyRouterRehearsalLock(PACK_ROOT)');
    const preActionLock = source.indexOf('const preActionLock = verifyRouterRehearsalLock(PACK_ROOT)');
    const action = source.indexOf("if (values.action === '--render-router')", preActionLock);
    const finalLock = source.indexOf('const finalLock = verifyRouterRehearsalLock(PACK_ROOT)');
    assert.ok(initialLock > 0 && preActionLock > initialLock);
    assert.ok(action > preActionLock && finalLock > action);
    assert.match(
        source.slice(finalLock),
        /sameRouterSecurityBoundary\(initialBoundary, finalBoundary\)/
    );
});

test('private router storage is exact-ignored, untracked, and invisible to normal git add -A', () => {
    assert.equal(validateRepositoryPrivateStorageContract(PACK_ROOT), null);
    const fixture = createPrivateStorageRepository('j2-git-ignore-proof-');
    const target = path.join(fixture.staging, 'slicer-api-git-add-proof.yml.tmp');
    try {
        fs.writeFileSync(target, 'private fixture\n', { encoding: 'utf8', flag: 'wx' });
        assert.equal(withPrivateRouterMetadata(
            fixture, [target], () => inspectPrivateRouterStorageTarget(
                target, 'staging', fixture.packRoot
            ).error
        ), null);
        const relative = path.relative(fixture.repositoryRoot, target).split(path.sep).join('/');
        const ignored = runGit(fixture.repositoryRoot, [
            'check-ignore', '-v', '--no-index', '--', relative
        ]).trim();
        assert.match(ignored, /^\.gitignore:\d+:\/ops\/hostinger\/\.runtime-private\//);
        const dryRun = runGit(fixture.repositoryRoot, ['add', '-A', '--dry-run', '--', '.']);
        assert.doesNotMatch(dryRun, /slicer-api-git-add-proof\.yml\.tmp/);
        const status = runGit(fixture.repositoryRoot, [
            'status', '--short', '--untracked-files=all', '--', relative
        ]);
        assert.equal(status, '');
    } finally {
        fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
});

test('router renderer creates only an exact private staging target', () => {
    const fixture = createPrivateStorageRepository('j2-render-private-router-');
    const allowlist = path.join(fixture.repositoryRoot, '..', `${path.basename(
        fixture.repositoryRoot
    )}-allowlist`);
    const target = path.join(fixture.staging, 'slicer-api-render-proof.yml.tmp');
    try {
        fs.writeFileSync(allowlist, `${LEADPILOT}\n`, { encoding: 'utf8', flag: 'wx' });
        const result = withPrivateRouterMetadata(
            fixture, [allowlist, target], () => renderRouterFile(
                target, 'api.example.test', allowlist, 'leadpilot-only', {
                    packRoot: fixture.packRoot, platform: 'linux', fsync: () => {},
                    templateSource: loadOperatorPack().routerTemplate
                }
            )
        );
        assert.equal(result.error, null);
        assert.equal(result.count, 1);
        assert.equal(Object.hasOwn(result, 'digest'), false);
        const digest = crypto.createHash('sha256').update(
            fs.readFileSync(target)
        ).digest('hex');
        assert.equal(withPrivateRouterMetadata(
            fixture, [target], () => validateActiveRouter(
                target, 'api.example.test', digest, fixture.packRoot, [LEADPILOT]
            )
        ), null);
        assert.equal(withPrivateRouterMetadata(
            fixture, [allowlist, target], () => renderRouterFile(
                target, 'api.example.test', allowlist, 'leadpilot-only', {
                    packRoot: fixture.packRoot, platform: 'linux', fsync: () => {},
                    templateSource: loadOperatorPack().routerTemplate
                }
            ).error
        ), 'router_render_target_invalid');
    } finally {
        fs.rmSync(allowlist, { force: true });
        fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
});

test('router CLI and runbook expose no caller IP commitment or router digest', () => {
    const operatorSource = fs.readFileSync(
        path.join(ROOT, 'scripts', 'i12-hostinger-operator-contract.js'), 'utf8'
    );
    const runbook = loadOperatorPack().runbook;
    assert.doesNotMatch(operatorSource, /--sha256/);
    assert.doesNotMatch(operatorSource, /PASS[^\n`]*(?:sha256|host)=/);
    assert.doesNotMatch(operatorSource, /result\.digest/);
    assert.doesNotMatch(runbook, /--sha256/);
    assert.match(
        runbook,
        /router digest and every raw IP never appear in\nprocess arguments, helper stdout\/stderr, logs, or shared evidence/
    );
    assert.match(
        runbook,
        /low-entropy file derived from caller addresses\nnever contributes a digest to shared evidence/
    );
    assert.match(
        runbook,
        /no path\ncomponent may contain a dotted, dashed, or underscored raw IPv4 address/
    );
    assert.match(
        runbook,
        /Before any\nNode helper process is spawned, the external orchestrator must validate every\nexpanded path argument/
    );
    assert.match(runbook, /failure is a stop before process creation/);
    assert.match(
        runbook,
        /late check cannot retroactively\nremove a caller-supplied raw pathname from `\/proc\/<pid>\/cmdline`/
    );
    assert.match(runbook, /helper internally recomputes the exact SHA-256/);

    const legacyArgument = spawnSync(process.execPath, [
        'scripts/i12-hostinger-operator-contract.js',
        '--active-router', 'temporary-file',
        '--host', 'api.example.test',
        '--sha256', 'legacy-digest-input',
        '--allowlist-file', 'private-input',
        '--phase', 'leadpilot-only'
    ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(legacyArgument.status, 2);
    assert.equal(legacyArgument.stdout, '');
    assert.equal(legacyArgument.stderr.trim(), 'active_router_argument_invalid');
    assert.doesNotMatch(legacyArgument.stdout + legacyArgument.stderr, /(?:192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/);
    assert.doesNotMatch(legacyArgument.stdout + legacyArgument.stderr, /\b[0-9a-f]{64}\b/);
});

test('private router storage rejects ignore drift, tracked state, path crossing, and links', async (t) => {
    await t.test('ignore removal', () => {
        const fixture = createPrivateStorageRepository('j2-ignore-removal-');
        try {
            fs.writeFileSync(
                path.join(fixture.repositoryRoot, '.gitignore'),
                `${ACTIVE_ROUTER_IGNORE_PATTERN}\n`, 'utf8'
            );
            assert.equal(
                validateRepositoryPrivateStorageContract(fixture.packRoot),
                'router_gitignore_contract_invalid'
            );
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    await t.test('ignore broadening drift', () => {
        const fixture = createPrivateStorageRepository('j2-ignore-drift-');
        try {
            fs.writeFileSync(
                path.join(fixture.repositoryRoot, '.gitignore'),
                `${PRIVATE_RUNTIME_IGNORE_PATTERN}\n${ACTIVE_ROUTER_IGNORE_PATTERN}\n`
                    + '/ops/hostinger/**\n',
                'utf8'
            );
            assert.equal(
                validateRepositoryPrivateStorageContract(fixture.packRoot),
                'router_gitignore_contract_invalid'
            );
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    await t.test('live-router ignore removal', () => {
        const fixture = createPrivateStorageRepository('j2-live-ignore-removal-');
        try {
            fs.writeFileSync(
                path.join(fixture.repositoryRoot, '.gitignore'),
                `${PRIVATE_RUNTIME_IGNORE_PATTERN}\n`, 'utf8'
            );
            assert.equal(
                validateRepositoryPrivateStorageContract(fixture.packRoot),
                'router_gitignore_contract_invalid'
            );
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    for (const [name, relative] of [
        ['tracked target', path.join(
            PRIVATE_RUNTIME_DIRECTORY, PRIVATE_STAGING_DIRECTORY,
            'slicer-api-tracked.yml.tmp'
        )],
        ['tracked parent descendant', path.join(
            PRIVATE_RUNTIME_DIRECTORY, PRIVATE_STAGING_DIRECTORY, 'tracked-parent-marker'
        )],
        ['tracked live router', path.join('dynamic', 'slicer-api.yml')]
    ]) await t.test(name, () => {
        const fixture = createPrivateStorageRepository(`j2-${name.replace(/ /g, '-')}-`);
        const tracked = path.join(fixture.packRoot, relative);
        try {
            fs.writeFileSync(tracked, 'tracked private fixture\n', { flag: 'wx' });
            runGit(fixture.repositoryRoot, [
                'add', '--force', '--', path.relative(
                    fixture.repositoryRoot, tracked
                ).split(path.sep).join('/')
            ]);
            assert.equal(
                validateRepositoryPrivateStorageContract(fixture.packRoot),
                'router_private_storage_tracking_invalid'
            );
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    await t.test('HEAD-only private leak remains rejected after index deletion', () => {
        const fixture = createPrivateStorageRepository('j2-head-only-private-leak-');
        const tracked = path.join(
            fixture.staging, 'slicer-api-head-only.yml.tmp'
        );
        const relative = path.relative(
            fixture.repositoryRoot, tracked
        ).split(path.sep).join('/');
        try {
            fs.writeFileSync(tracked, 'tracked private fixture\n', { flag: 'wx' });
            runGit(fixture.repositoryRoot, ['add', '--force', '--', relative]);
            runGit(fixture.repositoryRoot, [
                '-c', 'user.name=J2 Fixture', '-c', 'user.email=j2-fixture@example.invalid',
                'commit', '--quiet', '-m', 'private leak fixture'
            ]);
            runGit(fixture.repositoryRoot, ['rm', '--cached', '--quiet', '--', relative]);
            assert.equal(
                validateRepositoryPrivateStorageContract(fixture.packRoot),
                'router_private_storage_tracking_invalid'
            );
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    await t.test('outside and cross-kind targets', () => {
        const fixture = createPrivateStorageRepository('j2-storage-crossing-');
        const staging = path.join(fixture.staging, 'slicer-api-cross.yml.tmp');
        const rollback = path.join(fixture.rollback, 'slicer-api-cross.yml.disabled');
        const dynamicLive = path.join(fixture.dynamic, 'slicer-api.yml');
        try {
            assert.equal(
                inspectPrivateRouterStorageTarget(
                    path.join(fixture.packRoot, 'arbitrary', 'slicer-api-cross.yml.tmp'),
                    'staging', fixture.packRoot
                ).error,
                'router_private_storage_path_invalid'
            );
            assert.equal(
                inspectPrivateRouterStorageTarget(rollback, 'staging', fixture.packRoot).error,
                'router_private_storage_path_invalid'
            );
            assert.equal(
                inspectPrivateRouterStorageTarget(staging, 'rollback', fixture.packRoot).error,
                'router_private_storage_path_invalid'
            );
            assert.equal(
                inspectPrivateRouterStorageTarget(
                    dynamicLive, 'staging', fixture.packRoot
                ).error,
                'router_private_storage_path_invalid'
            );
            assert.equal(renderRouterFile(
                rollback, 'api.example.test', path.join(fixture.repositoryRoot, 'allowlist'),
                'leadpilot-only', { packRoot: fixture.packRoot, platform: 'linux' }
            ).error, 'router_private_storage_path_invalid');

            const rendered = renderRouterSource(
                loadOperatorPack().routerTemplate, 'api.example.test', [LEADPILOT]
            );
            const live = path.join(fixture.dynamic, 'slicer-api.yml');
            fs.writeFileSync(live, rendered.source, { flag: 'wx' });
            const digest = crypto.createHash('sha256').update(rendered.source).digest('hex');
            assert.equal(withPrivateRouterMetadata(fixture, [live], () => disableRouter(
                staging, 'api.example.test', digest, {
                    packRoot: fixture.packRoot, platform: 'linux', fsync: () => {}
                }
            )), 'retained_router_path_invalid');
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    await t.test('router target arguments reject raw IPv4 path tokens before filesystem use', () => {
        const fixture = createPrivateStorageRepository('j2-storage-private-argv-');
        try {
            for (const [kind, parent, suffix] of [
                ['staging', fixture.staging, '.yml.tmp'],
                ['rollback', fixture.rollback, '.yml.disabled']
            ]) {
                for (const token of [
                    '192.0.2.10', 'leadpilot-192-0-2-10', 'leadpilot_192_0_2_10'
                ]) {
                    const target = path.join(parent, `slicer-api-${token}${suffix}`);
                    assert.equal(
                        inspectPrivateRouterStorageTarget(target, kind, fixture.packRoot).error,
                        'router_private_storage_path_invalid',
                        `${kind}:${token}`
                    );
                }
            }
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    for (const [kind, targetParentName, suffix, linkedParentName] of [
        ['staging', 'staging', '.yml.tmp', 'staging'],
        ['staging', 'staging', '.yml.tmp', 'rollback'],
        ['rollback', 'rollback', '.yml.disabled', 'staging'],
        ['rollback', 'rollback', '.yml.disabled', 'rollback']
    ]) await t.test(`${kind} target rejects ${linkedParentName} directory link`, () => {
        const fixture = createPrivateStorageRepository(
            `j2-${kind}-${linkedParentName}-storage-link-`
        );
        const outside = path.join(fixture.repositoryRoot, `outside-${linkedParentName}`);
        const target = path.join(fixture[targetParentName], `slicer-api-link${suffix}`);
        const linkedParent = fixture[linkedParentName];
        try {
            fs.mkdirSync(outside);
            fs.rmSync(linkedParent, { recursive: true, force: true });
            fs.symlinkSync(
                outside, linkedParent, process.platform === 'win32' ? 'junction' : 'dir'
            );
            assert.equal(withPrivateRouterMetadata(
                fixture, [], () => inspectPrivateRouterStorageTarget(
                    target, kind, fixture.packRoot
                ).error
            ), 'router_private_storage_metadata_unsafe');
        } finally {
            fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
        }
    });

    for (const [name, changedParentName, ignoreDrift] of [
        ['staging identity change across repository validation', 'staging', false],
        ['rollback identity change across repository validation', 'rollback', false],
        ['storage identity change is not masked by repository drift', 'staging', true]
    ]) {
        await t.test(name, () => {
            const fixture = createPrivateStorageRepository(
                `j2-${changedParentName}-identity-change-`
            );
            const target = path.join(fixture.staging, 'slicer-api-identity-change.yml.tmp');
            const originalLstatSync = fs.lstatSync;
            const protectedDirectories = [
                fixture.dynamic, fixture.runtimeRoot, fixture.staging, fixture.rollback
            ].map((entry) => path.resolve(entry));
            const changedParent = path.resolve(fixture[changedParentName]);
            let changedParentReads = 0;
            try {
                if (ignoreDrift) fs.writeFileSync(
                    path.join(fixture.repositoryRoot, '.gitignore'),
                    `${ACTIVE_ROUTER_IGNORE_PATTERN}\n`, 'utf8'
                );
                fs.lstatSync = function patchedLstatSync(candidate, ...args) {
                    const stat = originalLstatSync.call(fs, candidate, ...args);
                    const resolved = path.resolve(candidate);
                    if (!protectedDirectories.includes(resolved)) return stat;
                    const overrides = { uid: 0, gid: 0, mode: 0o700 };
                    if (resolved === changedParent && ++changedParentReads >= 2) {
                        overrides.ino = stat.ino === 0 ? 1 : 0;
                    }
                    return metadataView(stat, overrides);
                };
                const error = inspectPrivateRouterStorageTarget(
                    target, 'staging', fixture.packRoot
                ).error;
                assert.equal(changedParentReads, 2);
                assert.equal(error, 'router_private_storage_metadata_unsafe');
            } finally {
                fs.lstatSync = originalLstatSync;
                fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
            }
        });
    }
});

test('rendered router binds one router-scoped IPAllowList with no forwarded-IP strategy', () => {
    const template = loadOperatorPack().routerTemplate;
    assert.equal(validateRouterSource(template), null);
    assert.match(template, new RegExp(ALLOWLIST_PLACEHOLDER));
    const hostname = 'api.example.test';
    const rendered = renderRouterSource(template, hostname, [LEADPILOT]);
    assert.equal(rendered.error, null);
    assert.equal(validateRouterSource(rendered.source, hostname, false, [LEADPILOT]), null);
    assert.equal(rendered.source.split(ALLOWLIST_MIDDLEWARE).length - 1, 2);
    assert.equal(rendered.source.split('ipAllowList:').length - 1, 1);
    assert.doesNotMatch(rendered.source, /ipStrategy|forwardedHeaders/);
    assert.equal(rendered.source.split(`"${LEADPILOT}"`).length - 1, 1);

    const wrongIdentity = [SECOND_DOCUMENTATION_CIDR];
    assert.equal(
        validateRouterSource(rendered.source, hostname, false, wrongIdentity),
        'traefik_allowlist_identity_mismatch'
    );
});

test('active router hash and private allowlist identity are both mandatory', () => {
    const hostname = 'api.example.test';
    const rendered = renderRouterSource(loadOperatorPack().routerTemplate, hostname, [LEADPILOT]);
    assert.equal(rendered.error, null);
    const digest = crypto.createHash('sha256').update(rendered.source, 'utf8').digest('hex');
    const fixture = createPrivateStorageRepository('j2-active-router-');
    const target = path.join(fixture.staging, 'slicer-api-contract.yml.tmp');
    try {
        fs.writeFileSync(target, rendered.source, { encoding: 'utf8', flag: 'wx' });
        assert.equal(withPrivateRouterMetadata(fixture, [target], () => validateActiveRouter(
            target, hostname, digest, fixture.packRoot, [LEADPILOT]
        )), null);
        assert.equal(withPrivateRouterMetadata(fixture, [target], () => validateActiveRouter(
            target, hostname, digest, fixture.packRoot, ['198.51.100.20/32']
        )), 'traefik_allowlist_identity_mismatch');
    } finally {
        fs.rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
});

test('router weakening mutations fail closed', async (t) => {
    const template = loadOperatorPack().routerTemplate;
    const cases = [
        ['renderer boundary comment drifted', mutateRequired(
            template,
            '# the exact .invalid hostname and __J2_SOURCE_RANGE__ placeholder from private',
            '# replace any configuration token from private'
        )],
        ['middleware detached', mutateRequired(
            template,
            `      middlewares:\n        - ${ALLOWLIST_MIDDLEWARE}\n`,
            ''
        )],
        ['IPAllowList replaced by legacy IPWhiteList', mutateRequired(
            template, '      ipAllowList:', '      ipWhiteList:'
        )],
        ['forwarded strategy added', mutateRequired(
            template,
            '        sourceRange:',
            '        ipStrategy:\n          depth: 1\n        sourceRange:'
        )],
        ['forwarded headers added', mutateRequired(
            template,
            '        sourceRange:',
            '        forwardedHeaders:\n          insecure: true\n        sourceRange:'
        )],
        ['X-Forwarded-For strategy added', mutateRequired(
            template,
            '        sourceRange:',
            '        x-forwarded-for: true\n        sourceRange:'
        )],
        ['second source range added', mutateRequired(
            template,
            `          - "${ALLOWLIST_PLACEHOLDER}"`,
            `          - "${ALLOWLIST_PLACEHOLDER}"\n          - "${SECOND_DOCUMENTATION_CIDR}"`
        )],
        ['placeholder widened', mutateRequired(
            template,
            `          - "${ALLOWLIST_PLACEHOLDER}"`,
            '          - "192.0.2.0/24"'
        )],
        ['middleware promoted to another router', mutateRequired(
            template,
            '  middlewares:',
            '  routers:\n    unrelated:\n      middlewares:\n        - slicer-api-source-allowlist\n  middlewares:'
        )]
    ];
    for (const [name, source] of cases) await t.test(name, () => {
        assert.notEqual(validateRouterSource(source, DISABLED_HOST, true), null);
    });
});

test('live dynamic source guard and CLI bind only the canonical current release path', () => {
    const expected = path.join(PACK_ROOT, 'dynamic');
    assert.equal(validateLiveDynamicSource(expected), null);

    const otherRelease = path.join(path.dirname(PACK_ROOT), 'other-release', 'dynamic');
    const nonCanonical = `${expected}${path.sep}..${path.sep}dynamic`;
    for (const candidate of [
        '', path.relative(ROOT, expected), `${expected}${path.sep}`, nonCanonical, otherRelease
    ]) {
        assert.equal(
            validateLiveDynamicSource(candidate),
            LIVE_DYNAMIC_RELEASE_MISMATCH,
            JSON.stringify(candidate)
        );
    }
    assert.equal(validateLiveDynamicSource(expected, {
        lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
        realpathSync: () => otherRelease
    }), LIVE_DYNAMIC_RELEASE_MISMATCH);

    const pass = spawnSync(process.execPath, [
        'scripts/i12-hostinger-operator-contract.js', '--check-live-dynamic-source', expected
    ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(pass.stdout.trim(), 'live_dynamic_source_contract=PASS');
    assert.equal(pass.stderr, '');

    for (const argv of [
        ['--check-live-dynamic-source', otherRelease],
        ['--check-live-dynamic-source', path.relative(ROOT, expected)],
        ['--check-live-dynamic-source']
    ]) {
        const reject = spawnSync(process.execPath, [
            'scripts/i12-hostinger-operator-contract.js', ...argv
        ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
        assert.equal(reject.status, 2, reject.stdout);
        assert.equal(reject.stdout, '');
        assert.equal(reject.stderr.trim(), LIVE_DYNAMIC_RELEASE_MISMATCH);
    }
});

test('Docker firewall backend gate accepts iptables only and CLI stops otherwise', () => {
    assert.equal(validFirewallBackend('iptables'), true);
    for (const value of ['', 'unknown', 'nftables', 'iptables\n', 'IPTABLES']) {
        assert.equal(validFirewallBackend(value), false, JSON.stringify(value));
    }
    const pass = spawnSync(process.execPath, [
        'scripts/i12-hostinger-operator-contract.js', '--check-firewall-backend', 'iptables'
    ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(pass.stdout.trim(), 'docker_firewall_backend_contract=PASS');
    assert.equal(pass.stderr, '');
    const reject = spawnSync(process.execPath, [
        'scripts/i12-hostinger-operator-contract.js', '--check-firewall-backend', 'nftables'
    ], { cwd: ROOT, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(reject.status, 2);
    assert.equal(reject.stdout, '');
    assert.equal(reject.stderr.trim(), 'STOP_DOCKER_FIREWALL_BACKEND_UNSUPPORTED');
});

test('runbook mutations cannot weaken DNS-only, firewall, ACME, or final-dark gates', async (t) => {
    const runbook = loadOperatorPack().runbook;
    const cases = [
        ['single /32 contract widened', mutateRequired(
            runbook,
            'canonical format is exactly one unique IPv4 `/32` line',
            'canonical format is one to four IPv4 CIDR lines'
        )],
        ['expanded phase reintroduced', mutateRequired(
            runbook, 'Only phase `leadpilot-only` exists.', 'Phase `expanded` also exists.'
        )],
        ['/24 widening admitted', mutateRequired(
            runbook,
            'A second address,\nanother phase, `/24`, or any prefix other than `/32` is forbidden.',
            'A shared provider `/24` may be admitted.'
        )],
        ['machine perimeter mislabeled as application identity', mutateRequired(
            runbook,
            'machine-level perimeter control, not an application-level',
            'application-level identity, not a machine perimeter control'
        )],
        ['shared-host reachability scope removed', mutateRequired(
            runbook,
            'approved address belongs to a shared host that currently carries',
            'approved address belongs only to the consumer process'
        )],
        ['provider reservation assumed', mutateRequired(
            runbook,
            'no verified provider reservation. Rebuild, migration, or',
            'a verified permanent provider reservation. Rebuild, migration, or'
        )],
        ['silent reassignment detector invented', mutateRequired(
            runbook, 'No current control detects this event. The', 'The control detects reassignment. The'
        )],
        ['migration notice obligation removed', mutateRequired(
            runbook,
            'consumer must notify the owner before any rebuild or migration',
            'consumer need not notify the owner before rebuild or migration'
        )],
        ['redirect reverted to internal entrypoint name', mutateRequired(
            runbook,
            'entrypoint redirect target must be the literal external port `:443`',
            'entrypoint redirect target may be the internal entrypoint `websecure`'
        )],
        ['redirect may leak internal 8443', mutateRequired(
            runbook,
            'Location authority with no explicit `:8443`',
            'Location authority may include explicit `:8443`'
        )],
        ['live dynamic source equality command removed', mutateRequired(
            runbook,
            '--check-live-dynamic-source "$live_dynamic_source" || exit 1',
            'skip live dynamic release equality'
        )],
        ['live dynamic release mismatch continued', mutateRequired(
            runbook,
            'STOP_LIVE_DYNAMIC_RELEASE_MISMATCH',
            'CONTINUE_WITH_DIFFERENT_DYNAMIC_RELEASE'
        )],
        ['owner-observed empty IPv4 DOCKER-USER state omitted', mutateRequired(
            runbook,
            'owner-observed starting state was an empty IPv4 `DOCKER-USER` chain with\ninactive UFW',
            'current IPv4 firewall state is inferred from the repository with active UFW'
        )],
        ['published ports assumed to obey UFW', mutateRequired(
            runbook, 'Published Docker ports can bypass UFW', 'Published Docker ports always obey UFW'
        )],
        ['second hostname silently admitted', mutateRequired(
            runbook,
            'second hostname is therefore a\nstop requiring a separately designed per-host boundary',
            'second hostname is therefore allowed by the existing destination-port rule'
        )],
        ['Cloudflare proxy accepted', mutateRequired(
            runbook, '`proxied` field is boolean `false`', '`proxied` field may be true'
        )],
        ['forwarded strategy admitted', mutateRequired(
            runbook, 'deliberately has no `ipStrategy`', 'uses `ipStrategy` depth 1'
        )],
        ['nftables continued', mutateRequired(
            runbook,
            'STOP_DOCKER_FIREWALL_BACKEND_UNSUPPORTED',
            'CONTINUE_WITH_UNKNOWN_FIREWALL_BACKEND'
        )],
        ['IPv6 listener incorrectly assumed to traverse DOCKER-USER', mutateRequired(
            runbook,
            'Docker exposes\n`[::]:443` through `docker-proxy` without IPv6 DNAT',
            'Docker exposes\n`[::]:443` through IPv6 DNAT and `DOCKER-USER`'
        )],
        ['dedicated IPv4 chain reintroduced', mutateRequired(
            runbook,
            'installs directly in IPv4 `DOCKER-USER`, in this\norder',
            'installs through a dedicated chain jumped from IPv4 `DOCKER-USER`, in this\norder'
        )],
        ['original-destination conntrack replaced by post-DNAT port', mutateRequired(
            runbook,
            'every IPv4 rule must\nuse conntrack `--ctorigdst <verified-public-VPS-IPv4>` together with\n`--ctorigdstport 443`',
            'every IPv4 rule may instead use the post-DNAT internal `--dport 8443`'
        )],
        ['original destination is not owner-bound public input', mutateRequired(
            runbook,
            '`--ctorigdst <verified-public-VPS-IPv4>`',
            '`--ctorigdst <private-VPS-IPv4>`'
        )],
        ['original port 80 filtering admitted', mutateRequired(
            runbook,
            'Plain `--dport 443`, internal `--dport 8443`, and any\nrule matching original port 80 are forbidden',
            'Original-destination port 80 may use the same perimeter rule'
        )],
        ['retained parent becomes writable', mutateRequired(
            runbook,
            'exact `.runtime-private/staging` and `.runtime-private/rollback`\nchildren as canonical, non-link, root:root-owned mode `0700` directories',
            'shared staging and rollback children as mode `0777` directories'
        )],
        ['runtime-private root moved', mutateRequired(
            runbook,
            '`ops/hostinger/.runtime-private` directory',
            '`ops/hostinger/operator-temp` directory'
        )],
        ['git ignore runtime proof skipped', mutateRequired(
            runbook,
            'uses `git check-ignore -v --no-index`',
            'trusts documentation instead of Git ignore state'
        )],
        ['tracked runtime state accepted', mutateRequired(
            runbook,
            'queries `git ls-tree` and `git\nls-files --cached` separately to refuse any tracked runtime-private descendant',
            'allows tracked private router state'
        )],
        ['render allowed into rollback', mutateRequired(
            runbook,
            'The renderer refuses\nthe rollback subtree',
            'The renderer may write the rollback subtree'
        )],
        ['disable allowed into staging', mutateRequired(
            runbook,
            'The disable helper refuses a staging path',
            'The disable helper accepts a staging path'
        )],
        ['router digest exposed to shared evidence', mutateRequired(
            runbook,
            'router digest and every raw IP never appear in\nprocess arguments, helper stdout/stderr, logs, or shared evidence',
            'router digest and raw IP may appear in shared evidence'
        )],
        ['low-entropy configuration digest exposed', mutateRequired(
            runbook,
            'A dynamic router or any low-entropy file derived from caller addresses\nnever contributes a digest to shared evidence.',
            'Low-entropy caller configuration digests are uploaded.'
        )],
        ['allowlist pathname leaks a raw caller address', mutateRequired(
            runbook,
            'no path\ncomponent may contain a dotted, dashed, or underscored raw IPv4 address',
            'the allowlist pathname may contain the caller IPv4 address'
        )],
        ['external pre-spawn privacy gate removed', mutateRequired(
            runbook,
            'Before any\nNode helper process is spawned, the external orchestrator must validate every\nexpanded path argument',
            'The helper validates path arguments after process creation'
        )],
        ['SIGKILL restart branch removed', mutateRequired(
            runbook,
            '`finally`/restart branch; a signal handler is not recovery authority because\n`SIGKILL` cannot be handled',
            'a signal handler is sufficient recovery authority'
        )],
        ['recovery directory scan admitted', mutateRequired(
            runbook,
            'Never glob, scan either private\ndirectory',
            'Scan both private directories for a likely source'
        )],
        ['apparent dark skips known-source durability recovery', mutateRequired(
            runbook,
            'It is never terminal proof while the exact known source still\nexists',
            'The first apparent dark result is terminal proof'
        )],
        ['recovery source kind weakened', mutateRequired(
            runbook,
            '--recover-router-dark <known-staging-source> --source-kind staging',
            '--recover-router-dark <unknown-source> --source-kind auto'
        )],
        ['pre-unlink source durability removed', mutateRequired(
            runbook,
            'fsyncs the source and source parent before the live unlink',
            'unlinks live before source durability'
        )],
        ['recovery idempotence removed', mutateRequired(
            runbook,
            'idempotent recovery after each logically injected fsync cutpoint',
            'recovery is single-attempt only'
        )],
        ['real crash durability guessed from logical cutpoints', mutateRequired(
            runbook,
            'process crash, kernel crash, or power-loss durability rehearsal remains\nexternal `NOT_VERIFIED`',
            'process crash and power-loss durability are locally verified'
        )],
        ['protected ancestor chain removed', mutateRequired(
            runbook,
            'every directory from\nthe exact operator-pack root and the root-private allowlist parent through the\nfilesystem root must be canonical, non-symlink, root-owned, and neither group-\nnor world-writable',
            'only the immediate target directory is inspected'
        )],
        ['full rehearsal lock shortened to one command', mutateRequired(
            runbook,
            'same shell FD and lock continuously across every activation, external\nobservation, disable, retained replay, and terminal dark assertion',
            'a new lock is acquired for each mutation command'
        )],
        ['concurrent disable admitted', mutateRequired(
            runbook,
            'A second activation or concurrent disable therefore fails closed',
            'Concurrent disable is allowed'
        )],
        ['activation source absence proof removed', mutateRequired(
            runbook,
            'explicitly proves the consumed source pathname is\nabsent',
            'assumes the consumed source pathname is absent'
        )],
        ['terminal strict dark assertion removed', mutateRequired(
            runbook,
            'strict `--assert-router-dark` contract with the exact known single-link source',
            'no-argument observation is terminal proof'
        )],
        ['live-only guessing admitted', mutateRequired(
            runbook,
            'must not inspect or unlink\na live-only route',
            'may guess from and unlink a live-only route'
        )],
        ['retained rollback replay replaced with rerender', mutateRequired(
            runbook,
            'an explicit rollback source for the second activation',
            'a newly rendered staging source for the second activation'
        )],
        ['retained single-link identity is not re-proved', mutateRequired(
            runbook,
            'mode `0600` identity with link count one',
            'unverified retained identity'
        )],
        ['dynamic directory mode is widened', mutateRequired(
            runbook,
            'dynamic directory must be root:root-owned\nmode `0700`',
            'dynamic directory must be root:root-owned\nmode `0755`'
        )],
        ['dynamic sentinel ownership is weakened', mutateRequired(
            runbook,
            '`.gitkeep`, must be a root:root-owned mode\n`0600`',
            '`.gitkeep`, may be operator-owned mode\n`0600`'
        )],
        ['dynamic sentinel mode is widened', mutateRequired(
            runbook,
            '`.gitkeep`, must be a root:root-owned mode\n`0600`',
            '`.gitkeep`, must be a root:root-owned mode\n`0644`'
        )],
        ['Traefik root-runtime identity is removed', mutateRequired(
            runbook,
            'current pinned Traefik runtime is root (`UID:GID 0:0`)',
            'current Traefik runtime identity is unspecified'
        )],
        ['non-root runtime silently widens the bind', mutateRequired(
            runbook,
            'a future non-root\nruntime is a stop requiring a separately designed permission model',
            'a future non-root\nruntime may widen the bind permissions'
        )],
        ['HTTP-01 restricted', mutateRequired(
            runbook,
            'Port 80 remains globally\nreachable over IPv4',
            'Port 80 uses the caller allowlist'
        )],
        ['HTTPS source scope widened', mutateRequired(
            runbook,
            'for the current singular `/32`',
            'for every IPv4 source'
        )],
        ['deny event loses fixed classification', mutateRequired(
            runbook, 'exact fixed prefix `r3d-perimeter-deny: `', 'variable prefix `NETWORK_EVENT`'
        )],
        ['installed deny target changes to DROP', mutateRequired(
            runbook, '`REJECT --reject-with tcp-reset`', '`DROP`'
        )],
        ['drop-like caller behavior changed to immediate refusal', mutateRequired(
            runbook,
            "From the caller's perspective this layer therefore behaves\nas a drop",
            "From the caller's perspective this layer behaves as an immediate refusal"
        )],
        ['firewall timeout misreported as HTTP', mutateRequired(
            runbook,
            'connection timeout, no reset,\nand no HTTP status',
            'caller-visible HTTP 403 response'
        )],
        ['measured REJECT-versus-DROP boundary reopened without evidence', mutateRequired(
            runbook,
            'Do not reopen `REJECT` versus `DROP` without new contrary\nevidence',
            'Prefer `REJECT` over `DROP` without additional evidence'
        )],
        ['IPv6 deny moved from INPUT to DOCKER-USER', mutateRequired(
            runbook,
            'places one rule at the start of `ip6tables INPUT` to reject every new inbound\nTCP connection to port 443',
            'places one rule in IPv6 `DOCKER-USER` for every new inbound TCP connection to port 443'
        )],
        ['IPv6 deny moved from 443 to 80', mutateRequired(
            runbook,
            'TCP connection to port 443. Putting that rule in IPv6 `DOCKER-USER`',
            'TCP connection to port 80. Putting that rule in IPv6 `DOCKER-USER`'
        )],
        ['IPv6 port 80 filtered', mutateRequired(
            runbook,
            'IPv6 port 80 remains\nuntouched',
            'IPv6 port 80 is rejected'
        )],
        ['perimeter idempotence rule count widened', mutateRequired(
            runbook,
            'exactly three IPv4 rules and one IPv6 rule',
            'an arbitrary number of IPv4 and IPv6 rules'
        )],
        ['retained proxy boot inventory skipped', mutateRequired(
            runbook,
            'After every real host reboot, re-inventory the retained old proxy before',
            'After the initial cutover, do not re-inventory the retained old proxy before'
        )],
        ['retained proxy boot identity generalized', mutateRequired(
            runbook,
            'exist as exactly `traefik-traefik-1`, remain stopped/exited with',
            'exist under any Traefik-like name in any runtime state with'
        )],
        ['retained proxy boot state tuple weakened', mutateRequired(
            runbook,
            '`Running=false` and `ExitCode=0`, retain restart policy `unless-stopped`, and\nreport an empty runtime port map as `ports={}`',
            '`Running=true` with any exit code, restart policy, and port-binding set'
        )],
        ['retained proxy listener ownership proof removed', mutateRequired(
            runbook,
            'it owns no\nlistener on host ports 80 or 443',
            'listener ownership need not be checked'
        )],
        ['runtime port map overclaimed as saved-binding safety', mutateRequired(
            runbook,
            '`ports={}` on a stopped container does not prove that saved\n`HostConfig.PortBindings` or `Config.ExposedPorts` is empty, that a later manual\nstart cannot reclaim 80/443',
            '`ports={}` proves saved bindings are empty and every later manual start is safe'
        )],
        ['post-reboot proxy inventory acceptance gate removed', mutateRequired(
            runbook,
            'After a host reboot, the retained-old-proxy boot inventory in the recovery\nboundary above must pass before listener or public-route acceptance.',
            'After a host reboot, public-route acceptance may precede retained-proxy inventory.'
        )],
        ['owner reboot timestamp replaced by Docker-only evidence', mutateRequired(
            runbook,
            '`2026-09-01 13:14:41`',
            '`Docker-service restart only`'
        )],
        ['boot perimeter service state and reapply proof removed', mutateRequired(
            runbook,
            '`r3d-perimeter.service` was both `active` and `enabled` and\nreapplied the rules at boot',
            '`r3d-perimeter.service` state and boot execution were not observed'
        )],
        ['post-boot perimeter rule count widened', mutateRequired(
            runbook,
            'post-boot policy remained exactly three\nIPv4 rules plus one IPv6 rule',
            'post-boot policy contained an arbitrary number of rules'
        )],
        ['post-boot container health and digest binding removed', mutateRequired(
            runbook,
            'both `healthy` at `t+5s`; the API\nremained on the deployed candidate image recorded for this reboot only as\nprefix `sha256:153987840361...`',
            'had unspecified health, timing, and API image identity'
        )],
        ['post-boot caller TLS and dual-stack matrix weakened', mutateRequired(
            runbook,
            'HTTP 200 with valid\nTLS in 0.13 seconds; IPv6 port 443 remained blocked; port 80 remained reachable\nwith ACME unaffected; and the loopback Traefik-only probe returned HTTP 403',
            'an incomplete local-only request was observed'
        )],
        ['post-boot retained proxy observation removed', mutateRequired(
            runbook,
            'The retained old `traefik-traefik-1` container remained stopped with exit code\n0, restart policy `unless-stopped`, and runtime `ports={}`, and did not own\nports 80 or 443.',
            'The retained proxy state was not inspected after reboot.'
        )],
        ['owner reboot closure regressed to NOT_VERIFIED', mutateRequired(
            runbook,
            'closes the last open perimeter-\npersistence element for this exact observed host configuration',
            'leaves real host reboot perimeter persistence `NOT_VERIFIED`'
        )],
        ['owner reboot observations relabeled as universal proof', mutateRequired(
            runbook,
            'These are\npoint-in-time owner observations',
            'These are universal continuity guarantees'
        )],
        ['point-in-time reboot evidence generalized to future recovery', mutateRequired(
            runbook,
            'not prove continuity of pre-reboot counters or rule objects, freedom from every\nboot-order race, a future reboot, Docker-crash recovery, or crash/power-loss\nrecovery. The verified persistence mechanism is the enabled service reapplying\nthe policy at this one observed normal boot.',
            'prove every future reboot and crash/power-loss recovery'
        )],
        ['403 and 401 conflated', mutateRequired(
            runbook, /Traefik HTTP 403/g, 'backend HTTP 401'
        )],
        ['ACME ambiguity ignored', mutateRequired(
            runbook, 'STOP_ACME_VOLUME_IDENTITY_UNPROVEN', 'CONTINUE_WITH_ANY_ACME_VOLUME'
        )],
        ['renewal proof skipped', mutateRequired(
            runbook,
            'STOP_ACME_RENEWAL_REHEARSAL_UNPROVEN',
            'CONTINUE_WITH_ISSUANCE_ONLY'
        )],
        ['external proof skipped', mutateRequired(
            runbook, 'STOP_J2_EXTERNAL_BOUNDARY_UNPROVEN', 'CONTINUE_WITH_VPS_LOCAL_CURL'
        )],
        ['terminal state active', mutateRequired(runbook, '`final_route_state=dark`', '`final_route_state=active`')],
        ['owner stop removed', mutateRequired(
            runbook,
            'Permanent route\nactivation is a separate owner-controlled stop',
            'Permanent route activation follows automatically'
        )]
    ];
    for (const [name, source] of cases) await t.test(name, () => {
        assert.notEqual(validateRunbookSource(source), null);
    });
});
