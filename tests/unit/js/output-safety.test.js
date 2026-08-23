const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const { buildOutputFilename } = require(path.join(REPO_ROOT, 'app/services/slice/common'));
const {
    resolveValidatedOutputFile
} = require(path.join(REPO_ROOT, 'app/services/admin-output.service'));

function withFixedNow(timestamp, callback) {
    const originalNow = Date.now;
    Date.now = () => timestamp;
    try {
        return callback();
    } finally {
        Date.now = originalNow;
    }
}

function createTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'slicer-output-unit-'));
}

function removeTempRoot(tempRoot) {
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    assert.notEqual(resolvedTempRoot, resolvedOsTemp);
    assert.equal(
        resolvedTempRoot.startsWith(`${resolvedOsTemp}${path.sep}`),
        true,
        `Refusing to remove non-temporary path: ${resolvedTempRoot}`
    );
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
}

test('output filenames sanitize the source basename and select FDM/SLA extensions', () => {
    const artifactId = 'artifact-0123456789abcdef0123456789abcdef';
    withFixedNow(1735689600000, () => {
        assert.equal(
            buildOutputFilename('../../My unsafe ! model.stl', 'FDM', artifactId),
            `My-unsafe-model-output-${artifactId}.gcode`
        );
        assert.equal(
            buildOutputFilename('resin.part.stl', 'SLA', artifactId),
            `resin-part-output-${artifactId}.sl1`
        );
        assert.equal(
            buildOutputFilename('   .stl', 'FDM', artifactId),
            `output-output-${artifactId}.gcode`
        );

        const crossPlatformUnsafe = buildOutputFilename('..\\private\\part (copy).stl', 'FDM', artifactId);
        assert.match(crossPlatformUnsafe, /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*-output-artifact-[a-f0-9]{32}\.gcode$/);
        assert.doesNotMatch(crossPlatformUnsafe, /[\\/]/);
        assert.doesNotMatch(crossPlatformUnsafe, /\.\./);
    });
});

test('validated output helper accepts regular files with allowed case-insensitive extensions', () => {
    const tempRoot = createTempRoot();
    try {
        const outputDir = path.join(tempRoot, 'output');
        fs.mkdirSync(outputDir);
        fs.writeFileSync(path.join(outputDir, 'part.gcode'), 'G1 X0 Y0\n');
        fs.writeFileSync(path.join(outputDir, 'resin.SL1'), 'resin-data');
        const resolvedOutputDir = path.resolve(outputDir);
        const resolvedOutputDirRealPath = fs.realpathSync(outputDir);

        for (const fileName of ['part.gcode', 'resin.SL1']) {
            const result = resolveValidatedOutputFile(
                fileName,
                resolvedOutputDir,
                resolvedOutputDirRealPath
            );
            assert.equal(result.success, true, fileName);
            assert.equal(result.fileName, fileName);
            assert.equal(result.realPath, fs.realpathSync(path.join(outputDir, fileName)));
            assert.equal(result.sizeBytes, fs.statSync(path.join(outputDir, fileName)).size);
            assert.doesNotThrow(() => new Date(result.createdAt).toISOString());
            assert.doesNotThrow(() => new Date(result.modifiedAt).toISOString());
        }
    } finally {
        removeTempRoot(tempRoot);
    }
});

test('validated output helper rejects extensions, traversal, missing files, and directories', () => {
    const tempRoot = createTempRoot();
    try {
        const outputDir = path.join(tempRoot, 'output');
        fs.mkdirSync(outputDir);
        fs.writeFileSync(path.join(outputDir, 'notes.txt'), 'not an output');
        fs.mkdirSync(path.join(outputDir, 'folder.gcode'));
        const resolvedOutputDir = path.resolve(outputDir);
        const resolvedOutputDirRealPath = fs.realpathSync(outputDir);

        assert.equal(
            resolveValidatedOutputFile('notes.txt', resolvedOutputDir, resolvedOutputDirRealPath).errorCode,
            'INVALID_OUTPUT_FILE'
        );
        assert.equal(
            resolveValidatedOutputFile('../escape.gcode', resolvedOutputDir, resolvedOutputDirRealPath).errorCode,
            'INVALID_OUTPUT_FILE'
        );
        assert.equal(
            resolveValidatedOutputFile('..\\escape.gcode', resolvedOutputDir, resolvedOutputDirRealPath).errorCode,
            'INVALID_OUTPUT_FILE'
        );
        assert.equal(
            resolveValidatedOutputFile('missing.gcode', resolvedOutputDir, resolvedOutputDirRealPath).errorCode,
            'OUTPUT_FILE_NOT_FOUND'
        );
        assert.equal(
            resolveValidatedOutputFile('folder.gcode', resolvedOutputDir, resolvedOutputDirRealPath).errorCode,
            'INVALID_OUTPUT_FILE_TARGET'
        );
    } finally {
        removeTempRoot(tempRoot);
    }
});

test('validated output helper enforces the supplied trusted realpath boundary', () => {
    const tempRoot = createTempRoot();
    try {
        const outputDir = path.join(tempRoot, 'output');
        const differentTrustedRoot = path.join(tempRoot, 'different-trusted-root');
        fs.mkdirSync(outputDir);
        fs.mkdirSync(differentTrustedRoot);
        fs.writeFileSync(path.join(outputDir, 'part.gcode'), 'G1 X0 Y0\n');

        const result = resolveValidatedOutputFile(
            'part.gcode',
            path.resolve(outputDir),
            fs.realpathSync(differentTrustedRoot)
        );

        assert.equal(result.success, false);
        assert.equal(result.status, 400);
        assert.equal(result.errorCode, 'INVALID_OUTPUT_FILE_PATH');
    } finally {
        removeTempRoot(tempRoot);
    }
});

test('validated output helper rejects symbolic-link output targets when supported', (t) => {
    const tempRoot = createTempRoot();
    try {
        const outputDir = path.join(tempRoot, 'output');
        const outsideDir = path.join(tempRoot, 'outside');
        fs.mkdirSync(outputDir);
        fs.mkdirSync(outsideDir);
        const outsideFile = path.join(outsideDir, 'outside.gcode');
        const linkPath = path.join(outputDir, 'linked.gcode');
        fs.writeFileSync(outsideFile, 'outside-data');

        try {
            fs.symlinkSync(outsideFile, linkPath, 'file');
        } catch (error) {
            const unsupportedCodes = new Set([
                'EACCES',
                'EPERM',
                'ENOSYS',
                'ENOTSUP',
                'EOPNOTSUPP',
                'UNKNOWN'
            ]);
            if (unsupportedCodes.has(error.code)) {
                t.skip(`Symbolic-link creation is unavailable on this OS: ${error.code}`);
                return;
            }
            throw error;
        }

        const result = resolveValidatedOutputFile(
            'linked.gcode',
            path.resolve(outputDir),
            fs.realpathSync(outputDir)
        );
        assert.equal(result.success, false);
        assert.equal(result.status, 400);
        assert.equal(result.errorCode, 'INVALID_OUTPUT_FILE_TARGET');
    } finally {
        removeTempRoot(tempRoot);
    }
});
