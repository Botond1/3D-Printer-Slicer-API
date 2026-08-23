'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GIT_ENVIRONMENT = Object.freeze({
    ...process.env,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null'
});

function git(cwd, ...argumentsList) {
    const result = spawnSync('git', argumentsList, {
        cwd,
        env: GIT_ENVIRONMENT,
        encoding: 'utf8',
        timeout: 10000
    });
    if (result.error) throw result.error;
    return result;
}

function requireGit(cwd, ...argumentsList) {
    const result = git(cwd, ...argumentsList);
    if (result.status !== 0) {
        throw new Error(`git ${argumentsList.join(' ')} failed: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
}

function requireCandidateRangeCheck(repositoryRoot) {
    const candidateSha = requireGit(repositoryRoot, 'rev-parse', 'HEAD');
    const remoteMainSha = requireGit(repositoryRoot, 'rev-parse', 'refs/remotes/origin/main^{commit}');
    requireGit(repositoryRoot, 'cat-file', '-e', `${remoteMainSha}^{commit}`);
    const mergeBase = requireGit(repositoryRoot, 'merge-base', remoteMainSha, candidateSha);
    if (!mergeBase) throw new Error('Candidate range has no merge-base.');
    requireGit(repositoryRoot, 'merge-base', '--is-ancestor', mergeBase, candidateSha);
    return git(repositoryRoot, 'diff', '--check', mergeBase, candidateSha, '--');
}

function createFixture({ candidateWhitespace = false, unrelatedMain = false } = {}) {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 's3a1-candidate-whitespace-'));
    const sourceRoot = path.join(temporaryRoot, 'source');
    const remoteRoot = path.join(temporaryRoot, 'remote.git');
    const cloneRoot = path.join(temporaryRoot, 'clean candidate checkout');

    try {
        fs.mkdirSync(sourceRoot);
        requireGit(sourceRoot, 'init', '--quiet', '-b', 'main');
        requireGit(sourceRoot, 'config', 'user.name', 'S3a.1 Inert Test');
        requireGit(sourceRoot, 'config', 'user.email', 's3a1-inert@example.invalid');

        fs.writeFileSync(path.join(sourceRoot, 'pre-existing debt.txt'), 'main trailing whitespace   \n');
        requireGit(sourceRoot, 'add', '--', 'pre-existing debt.txt');
        requireGit(sourceRoot, 'commit', '--quiet', '-m', 'main whitespace debt');

        requireGit(sourceRoot, 'checkout', '--quiet', '-b', 'feature');
        fs.writeFileSync(path.join(sourceRoot, 'clean feature file.txt'), 'first feature commit\n');
        requireGit(sourceRoot, 'add', '--', 'clean feature file.txt');
        requireGit(sourceRoot, 'commit', '--quiet', '-m', 'clean feature commit');

        const candidatePath = candidateWhitespace ? 'candidate whitespace.txt' : 'candidate clean file.txt';
        const candidateContent = candidateWhitespace ? 'candidate trailing whitespace   \n' : 'second feature commit\n';
        fs.writeFileSync(path.join(sourceRoot, candidatePath), candidateContent);
        requireGit(sourceRoot, 'add', '--', candidatePath);
        requireGit(sourceRoot, 'commit', '--quiet', '-m', 'second feature commit');

        if (unrelatedMain) {
            requireGit(sourceRoot, 'checkout', '--quiet', '--orphan', 'unrelated');
            requireGit(sourceRoot, 'rm', '--quiet', '-rf', '.');
            fs.writeFileSync(path.join(sourceRoot, 'unrelated.txt'), 'unrelated history\n');
            requireGit(sourceRoot, 'add', '--', 'unrelated.txt');
            requireGit(sourceRoot, 'commit', '--quiet', '-m', 'unrelated root');
        }

        requireGit(temporaryRoot, 'clone', '--quiet', '--bare', sourceRoot, remoteRoot);
        requireGit(temporaryRoot, 'clone', '--quiet', remoteRoot, cloneRoot);
        requireGit(cloneRoot, 'checkout', '--quiet', 'feature');
        if (unrelatedMain) {
            const unrelatedSha = requireGit(cloneRoot, 'rev-parse', 'refs/remotes/origin/unrelated^{commit}');
            requireGit(cloneRoot, 'update-ref', 'refs/remotes/origin/main', unrelatedSha);
        }

        return {
            cloneRoot,
            temporaryRoot,
            cleanup() {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
                assert.equal(fs.existsSync(temporaryRoot), false, 'temporary Git fixture must be removed');
            }
        };
    } catch (error) {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
        throw error;
    }
}

function withFixture(options, callback) {
    const fixture = createFixture(options);
    try {
        return callback(fixture);
    } finally {
        fixture.cleanup();
    }
}

test('candidate-range gate passes a clean committed multi-commit candidate and ignores unchanged main debt', () => {
    withFixture({}, ({ cloneRoot }) => {
        assert.equal(requireGit(cloneRoot, 'status', '--porcelain'), '');
        assert.ok(Number(requireGit(cloneRoot, 'rev-list', '--count', '--all')) >= 3,
            'local clone must have complete diverged history');
        assert.equal(requireCandidateRangeCheck(cloneRoot).status, 0);
    });
});

test('candidate-range gate rejects committed trailing whitespace that the legacy clean-worktree gate misses', () => {
    withFixture({ candidateWhitespace: true }, ({ cloneRoot }) => {
        assert.equal(requireGit(cloneRoot, 'status', '--porcelain'), '');
        assert.equal(git(cloneRoot, 'diff', '--check').status, 0,
            'legacy clean-worktree check must demonstrate the former false green');
        const corrected = requireCandidateRangeCheck(cloneRoot);
        assert.notEqual(corrected.status, 0);
        assert.match(corrected.stdout + corrected.stderr, /candidate whitespace\.txt/);
    });
});

test('candidate-range gate does not treat an untracked whitespace file as candidate content', () => {
    withFixture({}, ({ cloneRoot }) => {
        fs.writeFileSync(path.join(cloneRoot, 'untracked whitespace.txt'), 'untracked trailing whitespace   \n');
        assert.notEqual(requireGit(cloneRoot, 'status', '--porcelain'), '');
        assert.equal(requireCandidateRangeCheck(cloneRoot).status, 0);
    });
});

test('candidate-range gate fails closed for missing origin/main and no merge-base without an empty fallback', () => {
    withFixture({}, ({ cloneRoot }) => {
        requireGit(cloneRoot, 'update-ref', '-d', 'refs/remotes/origin/main');
        assert.throws(() => requireCandidateRangeCheck(cloneRoot), /rev-parse/);
    });

    withFixture({ unrelatedMain: true }, ({ cloneRoot }) => {
        assert.throws(() => requireCandidateRangeCheck(cloneRoot), /merge-base/);
    });
});

test('temporary Git fixtures are removed after both successful and failing checks', () => {
    let successfulFixturePath = '';
    withFixture({}, ({ cloneRoot, temporaryRoot }) => {
        successfulFixturePath = temporaryRoot;
        assert.equal(requireCandidateRangeCheck(cloneRoot).status, 0);
    });
    assert.equal(fs.existsSync(successfulFixturePath), false);

    let failingFixturePath = '';
    assert.throws(() => withFixture({ candidateWhitespace: true }, ({ cloneRoot, temporaryRoot }) => {
        failingFixturePath = temporaryRoot;
        assert.notEqual(requireCandidateRangeCheck(cloneRoot).status, 0);
        throw new Error('intentional test callback failure');
    }), /intentional test callback failure/);
    assert.equal(fs.existsSync(failingFixturePath), false);
});
