const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function listRelativeFiles(rootDir, relativeDir = '') {
    const currentDir = path.join(rootDir, relativeDir);
    const files = [];

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const relativePath = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listRelativeFiles(rootDir, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }

    return files.sort((left, right) => left.localeCompare(right));
}

function assertMirrorBytesEqual(githubRelativeDir, claudeRelativeDir) {
    const githubDir = path.join(REPO_ROOT, githubRelativeDir);
    const claudeDir = path.join(REPO_ROOT, claudeRelativeDir);
    const githubFiles = listRelativeFiles(githubDir);
    const claudeFiles = listRelativeFiles(claudeDir);
    assert.deepEqual(claudeFiles, githubFiles, `${githubRelativeDir} mirror file set`);

    for (const relativeFile of githubFiles) {
        const githubBytes = fs.readFileSync(path.join(githubDir, relativeFile));
        const claudeBytes = fs.readFileSync(path.join(claudeDir, relativeFile));
        assert.equal(
            githubBytes.equals(claudeBytes),
            true,
            `${githubRelativeDir}/${relativeFile} differs from ${claudeRelativeDir}/${relativeFile}`
        );
    }
}

test('.github and .claude agent definitions are byte-identical mirrors', () => {
    assertMirrorBytesEqual('.github/agents', '.claude/agents');
});

test('.github and .claude skill definitions are byte-identical mirrors', () => {
    assertMirrorBytesEqual('.github/skills', '.claude/skills');
});
