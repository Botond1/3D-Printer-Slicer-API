'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
    optionsFromEnvironment
} = require('../../../scripts/release-rehearsal-input');

const RUNNER_TEMP = path.resolve('runner-temp-rehearsal-fixture');

function environment() {
    const publicationArtifact = path.resolve(RUNNER_TEMP, 'publication-artifact');
    const rehearsalInput = path.resolve(RUNNER_TEMP, 'rehearsal-input');
    return {
        RUNNER_TEMP,
        PUBLICATION_ARTIFACT_SUBDIR: 'publication-artifact',
        PUBLICATION_ARTIFACT_DIR: publicationArtifact,
        REHEARSAL_INPUT_SUBDIR: 'rehearsal-input',
        REHEARSAL_INPUT_DIR: rehearsalInput,
        GITHUB_REPOSITORY: 'Botond1/3D-Printer-Slicer-API',
        PUBLICATION_WORKFLOW_NAME: 'Candidate Publication - Signed GHCR (NO DEPLOY)',
        PUBLICATION_WORKFLOW_PATH: '.github/workflows/candidate-publication.yml',
        PUBLICATION_WORKFLOW_ID: '24681012',
        PUBLICATION_EVENT: 'workflow_dispatch',
        PUBLICATION_CONCLUSION: 'success',
        PUBLICATION_HEAD_BRANCH: 'main',
        PUBLICATION_HEAD_SHA: '0123456789abcdef0123456789abcdef01234567',
        PUBLICATION_RUN_ID: '32670000001',
        PUBLICATION_RUN_ATTEMPT: '1',
        PUBLICATION_ARTIFACT_ID: '1357911',
        PUBLICATION_ARTIFACT_NAME:
            'i11-main-signed-candidate-0123456789abcdef0123456789abcdef01234567-32670000001-1',
        PUBLICATION_ARTIFACT_DIGEST: `sha256:${'c'.repeat(64)}`
    };
}

test('environment adapter preserves exact publication and path metadata', () => {
    const env = environment();
    const options = optionsFromEnvironment(env);
    assert.equal(options.runnerTemp, RUNNER_TEMP);
    assert.equal(options.artifactRoot, env.PUBLICATION_ARTIFACT_DIR);
    assert.equal(options.outputRoot, env.REHEARSAL_INPUT_DIR);
    assert.deepEqual(options.metadata, {
        repository_slug: env.GITHUB_REPOSITORY,
        workflow_name: env.PUBLICATION_WORKFLOW_NAME,
        workflow_path: env.PUBLICATION_WORKFLOW_PATH,
        workflow_id: env.PUBLICATION_WORKFLOW_ID,
        event: env.PUBLICATION_EVENT,
        conclusion: env.PUBLICATION_CONCLUSION,
        head_branch: env.PUBLICATION_HEAD_BRANCH,
        head_sha: env.PUBLICATION_HEAD_SHA,
        run_id: env.PUBLICATION_RUN_ID,
        run_attempt: env.PUBLICATION_RUN_ATTEMPT,
        artifact_id: env.PUBLICATION_ARTIFACT_ID,
        artifact_name: env.PUBLICATION_ARTIFACT_NAME,
        artifact_digest: env.PUBLICATION_ARTIFACT_DIGEST
    });
});

test('environment adapter rejects divergent absolute and relative roots', () => {
    for (const key of ['PUBLICATION_ARTIFACT_DIR', 'REHEARSAL_INPUT_DIR']) {
        const env = environment();
        env[key] = path.resolve(RUNNER_TEMP, 'different-root');
        assert.throws(
            () => optionsFromEnvironment(env),
            (error) => error.code === 'rehearsal_environment_path_mismatch'
        );
    }
});
