'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    CONTAINER_SCRIPT,
    DEFAULTS,
    buildDockerInvocation,
    cleanupCalibrationContainer,
    cleanupStagedModel,
    createPathRedactor,
    inspectPrivateFile,
    normalizeContainerRecord,
    parseArgs,
    renderTable,
    sanitizePrivateValue,
    stagePrivateModel,
    validateManifest
} = require('../../../scripts/sz-b2-orca-calibration');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const IMAGE_ID = `sha256:${'c'.repeat(64)}`;
const OPAQUE_PRIVATE_REF = ['opaque', 'private', 'token'].join('-');
const OPAQUE_SECOND_REF = ['opaque', 'second', 'token'].join('-');
const OPAQUE_IMAGE_REF = ['opaque', 'image', 'token'].join('-');
const OPAQUE_MATERIAL_REF = ['OPAQUE', 'MATERIAL', 'TOKEN'].join('_');
const RUN_ID = 'd'.repeat(32);
const CONTAINER_NAME = `r3d-calibration-123-${RUN_ID}`;
const OWNERSHIP = Object.freeze({ containerName: CONTAINER_NAME, runId: RUN_ID });
const CALIBRATION_RUN_LABEL = 'com.rocket3d.calibration.run';
const CALIBRATION_PURPOSE_LABEL = 'com.rocket3d.calibration.purpose';
const CALIBRATION_PURPOSE = 'j1-private-model-measurement';

function manifestEntry(overrides = {}) {
    return {
        id: 'M01',
        sha256: HASH_A,
        path: OPAQUE_PRIVATE_REF,
        ...overrides
    };
}

test('manifest contract accepts only anonymous IDs, lowercase exact hashes, and private references', () => {
    const entries = validateManifest([
        manifestEntry(),
        manifestEntry({ id: 'M10', sha256: HASH_B, path: OPAQUE_SECOND_REF })
    ]);

    assert.deepEqual(entries, [
        { id: 'M01', sha256: HASH_A, privatePath: OPAQUE_PRIVATE_REF },
        { id: 'M10', sha256: HASH_B, privatePath: OPAQUE_SECOND_REF }
    ]);
    assert.ok(entries.every(Object.isFrozen));

    const parsed = parseArgs([
        '--manifest', OPAQUE_PRIVATE_REF,
        '--image', OPAQUE_IMAGE_REF
    ]);
    assert.equal(parsed.options.manifest, OPAQUE_PRIVATE_REF);
    assert.equal(parsed.options.image, OPAQUE_IMAGE_REF);
    assert.equal(parseArgs([
        '--manifest', OPAQUE_PRIVATE_REF,
        '--image', OPAQUE_IMAGE_REF,
        '--material', OPAQUE_MATERIAL_REF
    ]).options.material, OPAQUE_MATERIAL_REF);
    assert.throws(
        () => parseArgs([
            '--manifest', OPAQUE_PRIVATE_REF,
            '--image', OPAQUE_IMAGE_REF,
            '--material', OPAQUE_MATERIAL_REF.toLowerCase()
        ]),
        (error) => error.code === 'CALIBRATION_MATERIAL_INVALID' &&
            !error.message.includes(OPAQUE_MATERIAL_REF.toLowerCase())
    );
    assert.throws(
        () => parseArgs(['--manifest', OPAQUE_PRIVATE_REF]),
        (error) => error.code === 'CALIBRATION_IMAGE_INVALID' &&
            !error.message.includes(OPAQUE_PRIVATE_REF)
    );
    assert.throws(
        () => parseArgs([OPAQUE_PRIVATE_REF, '--image', OPAQUE_IMAGE_REF]),
        (error) => error.code === 'POSITIONAL_MODEL_ARGUMENT_FORBIDDEN' &&
            !error.message.includes(OPAQUE_PRIVATE_REF)
    );
    for (const [name, value, code] of [
        ['memory', '0g', 'CALIBRATION_MEMORY_INVALID'],
        ['memory', '17g', 'CALIBRATION_MEMORY_INVALID'],
        ['memory', '2.5g', 'CALIBRATION_MEMORY_INVALID'],
        ['cpus', '0', 'CALIBRATION_CPUS_INVALID'],
        ['cpus', '17', 'CALIBRATION_CPUS_INVALID'],
        ['cpus', 'unbounded', 'CALIBRATION_CPUS_INVALID']
    ]) {
        assert.throws(
            () => parseArgs([
                '--manifest', OPAQUE_PRIVATE_REF,
                '--image', OPAQUE_IMAGE_REF,
                `--${name}`, value
            ]),
            (error) => error.code === code && !error.message.includes(value)
        );
    }
});

test('manifest validation fails closed without disclosing the private reference', async (t) => {
    const cases = [
        {
            label: 'identifier outside the anonymous range',
            manifest: [manifestEntry({ id: 'M00' })],
            code: 'CALIBRATION_MANIFEST_ID_INVALID'
        },
        {
            label: 'duplicate identifier',
            manifest: [manifestEntry(), manifestEntry({ path: OPAQUE_SECOND_REF })],
            code: 'CALIBRATION_MANIFEST_ID_DUPLICATE'
        },
        {
            label: 'uppercase digest',
            manifest: [manifestEntry({ sha256: HASH_A.toUpperCase() })],
            code: 'CALIBRATION_MANIFEST_SHA256_INVALID'
        },
        {
            label: 'digest with the wrong width',
            manifest: [manifestEntry({ sha256: HASH_A.slice(1) })],
            code: 'CALIBRATION_MANIFEST_SHA256_INVALID'
        },
        {
            label: 'empty private reference',
            manifest: [manifestEntry({ path: '' })],
            code: 'CALIBRATION_MANIFEST_PRIVATE_PATH_INVALID'
        },
        {
            label: 'unexpected metadata',
            manifest: [{ ...manifestEntry(), note: OPAQUE_SECOND_REF }],
            code: 'CALIBRATION_MANIFEST_ENTRY_SHAPE_INVALID'
        }
    ];

    for (const fixture of cases) {
        await t.test(fixture.label, () => {
            assert.throws(
                () => validateManifest(fixture.manifest),
                (error) => error.code === fixture.code &&
                    !error.message.includes(OPAQUE_PRIVATE_REF) &&
                    !error.message.includes(OPAQUE_SECOND_REF)
            );
        });
    }
});

test('redaction removes absolute, directory, basename, separator variant, and container aliases', () => {
    const opaqueRoot = ['opaque', 'root', 'token'].join('-');
    const opaqueLeaf = ['opaque', 'leaf', 'token'].join('-');
    const opaqueAlias = ['opaque', 'alias', 'token'].join('-');
    const canonicalAlias = path.resolve(['canonical', 'target', 'token'].join('-'));
    const absolutePrivate = path.resolve(opaqueRoot, opaqueLeaf);
    const directory = path.dirname(absolutePrivate);
    const separatorVariant = absolutePrivate.replace(/\\/g, '/');
    const redact = createPathRedactor(absolutePrivate, [opaqueAlias, canonicalAlias]);
    const source = {
        stderr_tail: [absolutePrivate, directory, opaqueLeaf, separatorVariant,
            opaqueAlias, canonicalAlias].join('::'),
        nested: [opaqueLeaf]
    };

    const sanitized = sanitizePrivateValue(source, redact);
    const serialized = JSON.stringify(sanitized);
    for (const sensitive of [absolutePrivate, directory, opaqueLeaf, separatorVariant,
        opaqueAlias, canonicalAlias]) {
        assert.ok(!serialized.includes(sensitive));
    }
    assert.match(serialized, /\[private-model\]/);

    const normalized = normalizeContainerRecord({
        ok: false,
        phase: 'slice',
        code: 'ORCA_EXIT_NONZERO',
        stderr_tail: source.stderr_tail,
        path: opaqueLeaf
    }, redact);
    assert.ok(!JSON.stringify(normalized).includes(opaqueLeaf));
    assert.ok(!Object.prototype.hasOwnProperty.call(normalized, 'path'));
    assert.ok(!Object.prototype.hasOwnProperty.call(normalized, 'stderr_tail'));
});

test('private input is copied to a neutral exact-hash stage before Docker arguments are built', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-cal-fixture-'));
    const privateLeaf = ['opaque', 'model', 'fixture'].join('-') + '.stl';
    const privatePath = path.join(fixtureRoot, privateLeaf);
    const bytes = Buffer.from('solid opaque\nendsolid opaque\n', 'ascii');
    fs.writeFileSync(privatePath, bytes, { flag: 'wx', mode: 0o600 });
    const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
    let stage = null;
    try {
        const inspected = inspectPrivateFile(privatePath);
        assert.equal(inspected.ok, true);
        assert.equal(inspected.sha256, expectedHash);
        stage = stagePrivateModel({ id: 'M01', sha256: expectedHash }, inspected);
        assert.equal(inspectPrivateFile(stage.filePath).sha256, expectedHash);

        const invocation = buildDockerInvocation(stage.canonicalPath, {
            ...DEFAULTS,
            image: OPAQUE_IMAGE_REF
        }, { imageId: IMAGE_ID, uid: 123, gid: 456 });
        const serializedArgs = JSON.stringify(invocation.args);
        assert.ok(!serializedArgs.includes(privatePath));
        assert.ok(!serializedArgs.includes(privateLeaf));
        assert.ok(invocation.args.some((argument) => argument.includes(stage.canonicalPath)));
    } finally {
        if (stage) assert.equal(cleanupStagedModel(stage), true);
        if (fs.existsSync(privatePath)) fs.unlinkSync(privatePath);
        if (fs.existsSync(fixtureRoot)) fs.rmdirSync(fixtureRoot);
    }
    assert.equal(stage === null || fs.existsSync(stage.root), false);
});

test('staging cleanup refuses a same-name foreign file replacement without deleting it', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-cal-fixture-'));
    const privatePath = path.join(fixtureRoot, 'opaque-source.stl');
    const bytes = Buffer.from('solid opaque\nendsolid opaque\n', 'ascii');
    fs.writeFileSync(privatePath, bytes, { flag: 'wx', mode: 0o600 });
    const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const inspected = inspectPrivateFile(privatePath);
    const stage = stagePrivateModel({ id: 'M01', sha256: expectedHash }, inspected);
    const foreignBytes = Buffer.from('foreign replacement', 'ascii');
    try {
        fs.unlinkSync(stage.filePath);
        fs.writeFileSync(stage.filePath, foreignBytes, { flag: 'wx', mode: 0o600 });
        assert.equal(cleanupStagedModel(stage), false);
        assert.deepEqual(fs.readFileSync(stage.filePath), foreignBytes);
        assert.equal(fs.existsSync(stage.root), true);
    } finally {
        if (fs.existsSync(stage.filePath)) fs.unlinkSync(stage.filePath);
        if (fs.existsSync(stage.root)) fs.rmdirSync(stage.root);
        if (fs.existsSync(privatePath)) fs.unlinkSync(privatePath);
        if (fs.existsSync(fixtureRoot)) fs.rmdirSync(fixtureRoot);
    }
});

test('staging cleanup refuses a same-name foreign root replacement without removing it', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r3d-cal-fixture-'));
    const privatePath = path.join(fixtureRoot, 'opaque-source.stl');
    const bytes = Buffer.from('solid opaque\nendsolid opaque\n', 'ascii');
    fs.writeFileSync(privatePath, bytes, { flag: 'wx', mode: 0o600 });
    const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const inspected = inspectPrivateFile(privatePath);
    const stage = stagePrivateModel({ id: 'M01', sha256: expectedHash }, inspected);
    try {
        fs.unlinkSync(stage.filePath);
        fs.rmdirSync(stage.root);
        fs.mkdirSync(stage.root, { mode: 0o700 });
        assert.equal(cleanupStagedModel(stage), false);
        assert.equal(fs.existsSync(stage.root), true);
    } finally {
        if (fs.existsSync(stage.filePath)) fs.unlinkSync(stage.filePath);
        if (fs.existsSync(stage.root)) fs.rmdirSync(stage.root);
        if (fs.existsSync(privatePath)) fs.unlinkSync(privatePath);
        if (fs.existsSync(fixtureRoot)) fs.rmdirSync(fixtureRoot);
    }
});

test('Markdown output exposes only anonymous identity and the verified full digest', () => {
    const table = renderTable([{
        id: 'M01',
        sha256: HASH_A,
        bytes: 2 * 1024 * 1024,
        ok: true,
        image_id: IMAGE_ID,
        engine_version: '2.3.1',
        effective_profile_sha256: HASH_B,
        filament_profile: 'PLA_generic.json',
        print_time_seconds: 3660,
        filament_used_g: 12.5,
        privatePath: OPAQUE_PRIVATE_REF,
        model: OPAQUE_SECOND_REF
    }]);

    assert.match(table, /Azonosító/);
    assert.match(table, /M01/);
    assert.match(table, new RegExp(HASH_A));
    assert.match(table, /1h 1m \(3660 mp\)/);
    assert.match(table, /12\.5 g/);
    assert.match(table, new RegExp(IMAGE_ID));
    assert.match(table, /2\.3\.1/);
    assert.match(table, new RegExp(HASH_B));
    assert.match(table, /PLA_generic\.json/);
    assert.ok(!table.includes(OPAQUE_PRIVATE_REF));
    assert.ok(!table.includes(OPAQUE_SECOND_REF));
});

test('container contract binds snapshots, engine version, profile digest, filament metadata, and order', () => {
    const compact = CONTAINER_SCRIPT.replace(/\s+/g, ' ');
    assert.match(
        compact,
        /await createRuntimeSlicerProfile\( 'orca', snapshots\.baseConfigFile, 'FDM', Number\(job\.layer\), job\.infill, workspace\)/
    );
    assert.match(compact, /await snapshotProfileSelection\('orca'/);
    assert.match(compact, /calculateEffectiveProfileSha256\(\{/);
    assert.match(compact, /readOrcaFilamentProfileMetadata\(/);
    assert.match(compact, /parseEngineVersionOutput\('orca', help\)/);
    assert.match(compact, /resolveScratchPath: \(\.\.\.segments\)/);
    assert.match(compact, /assertScratchContainedPath: assertContained/);
    assert.match(
        compact,
        /const settings = \[snapshots\.orcaMachineConfigFile, runtimeProcessProfile, snapshots\.orcaFilamentConfigFile\]/
    );
    assert.match(compact, /'--arrange', '1', '--orient', '0'/);
    assert.doesNotMatch(compact, /'--orient', '1'/);
    assert.match(compact, /process\.getuid\(\) === 0/);
});

test('Docker invocation retains network, filesystem, privilege, and resource isolation', () => {
    const neutralStage = path.resolve('r3d-calibration-stage', 'input.stl');
    const options = {
        ...DEFAULTS,
        image: OPAQUE_IMAGE_REF,
        machine: 'opaque-profile.json'
    };
    const runtimeIdentity = { imageId: IMAGE_ID, uid: 123, gid: 456 };
    const { args, ownership } = buildDockerInvocation(
        neutralStage,
        options,
        runtimeIdentity,
        OWNERSHIP
    );

    assert.equal(args[args.indexOf('--network') + 1], 'none');
    assert.ok(args.includes('--read-only'));
    assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
    assert.equal(args[args.indexOf('--security-opt') + 1], 'no-new-privileges');
    assert.equal(args[args.indexOf('--memory') + 1], DEFAULTS.memory);
    assert.equal(args[args.indexOf('--memory-swap') + 1], DEFAULTS.memory);
    assert.equal(args[args.indexOf('--pull') + 1], 'never');
    assert.equal(args[args.indexOf('--user') + 1], '123:456');
    assert.match(args[args.indexOf('--tmpfs') + 1], /uid=123,gid=456,mode=0700/);
    assert.ok(args.includes(IMAGE_ID));
    assert.ok(!args.includes(OPAQUE_IMAGE_REF));
    assert.ok(!JSON.stringify(args).includes(OPAQUE_PRIVATE_REF));
    assert.deepEqual(ownership, OWNERSHIP);
    assert.equal(args[args.indexOf('--name') + 1], CONTAINER_NAME);
    assert.ok(args.includes(`${CALIBRATION_RUN_LABEL}=${RUN_ID}`));
    assert.ok(args.includes(`${CALIBRATION_PURPOSE_LABEL}=${CALIBRATION_PURPOSE}`));
});

function dockerResult(overrides = {}) {
    return { status: 0, signal: null, error: null, stdout: '', stderr: '', ...overrides };
}

function ownedInspection(overrides = {}) {
    return [{
        Id: 'e'.repeat(64),
        Name: `/${CONTAINER_NAME}`,
        Image: IMAGE_ID,
        Config: {
            Labels: {
                [CALIBRATION_RUN_LABEL]: RUN_ID,
                [CALIBRATION_PURPOSE_LABEL]: CALIBRATION_PURPOSE
            }
        },
        ...overrides
    }];
}

test('container cleanup removes only exact owned identity and proves absence', () => {
    const calls = [];
    const runner = (_command, args) => {
        calls.push(args);
        if (args[1] === 'inspect') {
            return dockerResult({ stdout: JSON.stringify(ownedInspection()) });
        }
        if (args[1] === 'rm') return dockerResult({ stdout: `${CONTAINER_NAME}\n` });
        if (args[1] === 'ls') return dockerResult();
        throw new Error('unexpected docker control');
    };

    assert.equal(cleanupCalibrationContainer(OWNERSHIP, IMAGE_ID, runner), true);
    assert.equal(calls.filter((args) => args[1] === 'rm').length, 1);
    assert.deepEqual(calls.find((args) => args[1] === 'rm'), [
        'container', 'rm', '--force', CONTAINER_NAME
    ]);
});

test('container cleanup refuses every foreign identity without removal', async (t) => {
    const foreignCases = [
        ['image', { Image: `sha256:${'f'.repeat(64)}` }],
        ['name', { Name: '/r3d-calibration-123-' + 'a'.repeat(32) }],
        ['run label', { Config: { Labels: {
            [CALIBRATION_RUN_LABEL]: 'a'.repeat(32),
            [CALIBRATION_PURPOSE_LABEL]: CALIBRATION_PURPOSE
        } } }],
        ['purpose label', { Config: { Labels: {
            [CALIBRATION_RUN_LABEL]: RUN_ID,
            [CALIBRATION_PURPOSE_LABEL]: 'foreign-purpose'
        } } }]
    ];

    for (const [label, mutation] of foreignCases) {
        await t.test(label, () => {
            let removals = 0;
            const runner = (_command, args) => {
                if (args[1] === 'inspect') {
                    return dockerResult({ stdout: JSON.stringify(ownedInspection(mutation)) });
                }
                if (args[1] === 'rm') removals += 1;
                return dockerResult();
            };
            assert.equal(cleanupCalibrationContainer(OWNERSHIP, IMAGE_ID, runner), false);
            assert.equal(removals, 0);
        });
    }
});

test('container cleanup accepts proven absence and fails closed on control errors', () => {
    const absentRunner = (_command, args) => args[1] === 'inspect'
        ? dockerResult({ status: 1, stderr: 'not present' })
        : dockerResult();
    assert.equal(cleanupCalibrationContainer(OWNERSHIP, IMAGE_ID, absentRunner), true);

    const malformedRunner = () => dockerResult({ stdout: '{' });
    assert.equal(cleanupCalibrationContainer(OWNERSHIP, IMAGE_ID, malformedRunner), false);

    const listFailure = (_command, args) => args[1] === 'inspect'
        ? dockerResult({ status: 1, stderr: 'not present' })
        : dockerResult({ status: 1, stderr: 'daemon unavailable' });
    assert.equal(cleanupCalibrationContainer(OWNERSHIP, IMAGE_ID, listFailure), false);

    const removeFailure = (_command, args) => {
        if (args[1] === 'inspect') {
            return dockerResult({ stdout: JSON.stringify(ownedInspection()) });
        }
        return dockerResult({ status: 1, stderr: 'remove failed' });
    };
    assert.equal(cleanupCalibrationContainer(OWNERSHIP, IMAGE_ID, removeFailure), false);
});

test('successful container records require exact runtime/profile identity and code-only failures', () => {
    const redact = createPathRedactor(OPAQUE_PRIVATE_REF);
    const success = normalizeContainerRecord({
        ok: true,
        engine_version: '2.3.1',
        effective_profile_sha256: HASH_A,
        filament_profile: null,
        filament_diameter_mm: null,
        filament_density_g_cm3: null,
        wall_ms: 100,
        gcode_bytes: 200,
        print_time_seconds: 300,
        print_time_source: 'm73_p0_r_minutes',
        filament_used_g: 4.5,
        filament_used_g_source: 'filament_used_g',
        filament_used_mm: null
    }, redact);
    assert.equal(success.effective_profile_sha256, HASH_A);
    assert.equal(success.filament_profile, null);

    assert.equal(normalizeContainerRecord({ ...success, engine_version: 'unverified' }, redact), null);
    const failure = normalizeContainerRecord({
        ok: false,
        phase: 'slice',
        code: 'ORCA_EXIT_NONZERO',
        stderr_tail: OPAQUE_PRIVATE_REF,
        object_name: OPAQUE_SECOND_REF
    }, redact);
    assert.deepEqual(failure, { ok: false, phase: 'slice', code: 'ORCA_EXIT_NONZERO' });
    assert.equal(normalizeContainerRecord({
        ok: false,
        phase: 'slice',
        code: 'ORCA_EXIT_NONZERO',
        status: OPAQUE_PRIVATE_REF,
        signal: OPAQUE_SECOND_REF
    }, redact), null);
});
