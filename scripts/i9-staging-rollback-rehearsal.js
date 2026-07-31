'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    positiveDecimal,
    validateCandidatePair
} = require('./i9-staging-contract');
const { runSmoke } = require('./i2-orca-runtime-smoke');
const {
    ALLOWED_DOCKER,
    API_NAME,
    NETWORK_NAME,
    PROJECT,
    boundedRun,
    fail,
    observeStorageFailure,
    removeImages,
    requireAbsent,
    sleep,
    startStage,
    stopStage,
    sudoChmod
} = require('./i9-staging-docker');
const {
    EXACT_GHCR_REPOSITORY,
    loadStagingManifest
} = require('./i9-staging-manifest');

const DRAFT_FILE = 'i9-staging-runtime-draft.json';

function loadJsonFile(target, maxBytes, failure) {
    const resolved = path.resolve(target);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maxBytes
        || fs.realpathSync(resolved) !== resolved) fail(failure);
    try {
        return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch {
        fail(failure);
    }
}

function candidateFromManifest(repository, value) {
    return {
        reference: `${repository}@${value.digest}`,
        config_id: value.config_digest,
        source_sha: value.source_sha,
        configured_user: 'slicer'
    };
}

function loadManifest(env) {
    void env;
    const loaded = loadStagingManifest(path.resolve(__dirname, '..'));
    const raw = loaded.value;
    const previous = candidateFromManifest(raw.repository, raw.previous);
    const candidate = candidateFromManifest(raw.repository, raw.candidate);
    const error = validateCandidatePair(previous, candidate);
    if (error) fail(error);
    return { raw, path: loaded.path, previous, candidate };
}

function canonicalDirectory(target, parent, mode, uid, gid) {
    const resolved = path.resolve(target);
    const parentResolved = path.resolve(parent);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved
        || path.dirname(resolved) !== parentResolved) fail('runtime_directory_boundary_failure');
    if (process.platform !== 'win32') {
        if ((stat.mode & 0o777) !== mode || stat.uid !== uid || stat.gid !== gid) {
            fail('runtime_directory_ownership_failure');
        }
    }
    return resolved;
}

function runOrcaSmoke(label, imageId, uid, gid, evidenceDir) {
    const output = path.join(evidenceDir, `.i9-orca-${label}.out`);
    fs.writeFileSync(output, '', { flag: 'wx', mode: 0o600 });
    try {
        runSmoke({
            I2_ORCA_PROBE_NAME: `i9-orca-${label}`,
            EXPECTED_IMAGE_ID: imageId,
            SERVICE_UID: uid,
            SERVICE_GID: gid,
            GITHUB_OUTPUT: output
        });
        if (!fs.readFileSync(output, 'utf8').includes('classification=success')) {
            fail('orca_smoke_classification_failure');
        }
    } finally {
        fs.rmSync(output, { force: false });
    }
}

function appendOutputs(env, classification, rollback, cleanup) {
    if (!env.GITHUB_OUTPUT) return;
    fs.appendFileSync(env.GITHUB_OUTPUT,
        `classification=${classification}\nrollback_classification=${rollback}\n` +
        `cleanup_classification=${cleanup}\n`,
        { encoding: 'utf8' });
}

function writeDraft(env, manifest, state) {
    const target = path.join(env.evidenceDir, DRAFT_FILE);
    const image = (candidate, role) => ({
        role,
        source_sha: candidate.source_sha,
        digest: candidate.reference.slice(candidate.reference.indexOf('@') + 1),
        config_digest: candidate.config_id,
        configured_user: 'slicer',
        service_uid: env.uid,
        service_gid: env.gid
    });
    const readiness = (runtime, candidate, smoke) => ({
        container_id: runtime.container_id,
        pid: runtime.pid,
        image_id: candidate.config_id,
        kernel_uid: runtime.kernel_uid,
        kernel_gid: runtime.kernel_gid,
        consecutive_passes: 2,
        docker_healthy: true,
        liveness: true,
        minimal_readiness: true,
        operations_readiness: true,
        detailed_readiness: true,
        python_available: true,
        queue_idle: true,
        auth_rejection: true,
        orca_smoke: smoke,
        result: 'success'
    });
    const previousImage = image(
        manifest.previous, 'ephemeral_previous_fixture_requalified'
    );
    const candidateImage = image(manifest.candidate, 'signed_candidate_verified');
    const draft = {
        schema_version: 'i9-s3b-ephemeral-staging-rollback-evidence-v1',
        source: {
            repository: 'https://github.com/Botond1/3D-Printer-Slicer-API',
            repository_slug: 'Botond1/3D-Printer-Slicer-API',
            sha: env.CANDIDATE_SHA,
            ref: 'refs/heads/codex/i9-s3b-staging-rollback-foundation'
        },
        workflow: {
            name: 'S3b Ephemeral Staging and Rollback Rehearsal (NO DEPLOY)',
            path: '.github/workflows/staging-rollback-rehearsal.yml',
            run_id: env.runId,
            run_attempt: env.runAttempt,
            job: 'staging-rollback-rehearsal'
        },
        manifest: {
            sha256: crypto.createHash('sha256').update(fs.readFileSync(manifest.path)).digest('hex'),
            platform: 'linux/amd64',
            previous_requalified: true,
            candidate_verified: true,
            distinct_digests: true
        },
        images: {
            repository: EXACT_GHCR_REPOSITORY,
            previous: previousImage,
            candidate: candidateImage
        },
        phase_order: [
            'previous_initial_ready',
            'candidate_promoted_ready',
            'candidate_storage_failure_observed',
            'automatic_rollback_started',
            'previous_restored_ready',
            'runtime_cleanup_complete'
        ],
        previous_initial: readiness(
            state.previousInitial, manifest.previous, state.synthetic.previous
        ),
        candidate_promoted: readiness(
            state.candidateRuntime, manifest.candidate, state.synthetic.candidate
        ),
        failure_injection: {
            target: 'pricing_state_writability',
            mode_before: '0700',
            mode_injected: '0500',
            mode_restored: '0700',
            liveness_preserved: true,
            fresh_detailed_503: true,
            storage_probe_failed: state.readiness.storageFailureObserved,
            minimal_readiness_503: true,
            operations_readiness_503: true,
            reason_code: 'STORAGE_UNSAFE',
            cache_expiry_bounded: true,
            automatic_rollback_triggered: true,
            result: 'expected_readiness_failure_observed'
        },
        rollback: {
            transition: {
                automatic: true,
                triggered_by: 'candidate_storage_failure_observed',
                restored_digest: previousImage.digest,
                candidate_removed: true,
                previous_restarted: true,
                state_mode_restored: true,
                shared_synthetic_state_preserved: true,
                result: 'success'
            },
            readiness: readiness(
                state.previousRollback, manifest.previous, state.synthetic.rollback
            )
        },
        cleanup: {
            containers_removed: state.cleanup,
            network_removed: state.cleanup,
            local_digest_refs_removed: state.cleanup,
            temporary_state_removed: state.temporaryStateRemoved,
            remote_digests_preserved: true,
            result: state.cleanup && state.temporaryStateRemoved ? 'success' : 'failure'
        },
        aggregator: {
            evidence_boundary: 'bounded_allowlist_only',
            result: 'I9_STAGING_REHEARSAL_EVIDENCE_READY'
        },
        deployed_digest: 'not_applicable_ephemeral_no_deploy'
    };
    const payload = `${JSON.stringify(draft, null, 2)}\n`;
    if (Buffer.byteLength(payload) > 48 * 1024) fail('runtime_draft_boundary_failure');
    fs.writeFileSync(target, payload, { flag: 'wx', mode: 0o600 });
}

function removeStageRoot(env) {
    const target = path.resolve(env.stageRoot);
    const runnerTemp = path.resolve(process.env.RUNNER_TEMP);
    const stat = fs.lstatSync(target);
    if (path.dirname(target) !== runnerTemp || fs.realpathSync(target) !== target
        || !stat.isDirectory() || stat.isSymbolicLink()) fail('stage_cleanup_boundary_failure');
    boundedRun('sudo', [
        '--non-interactive', 'rm', '--recursive', '--force', '--one-file-system', '--', target
    ], { timeout: 30_000, failure: 'temporary_state_cleanup_failure' });
    if (fs.existsSync(target)) fail('temporary_state_cleanup_incomplete');
}

function resolveEnvironment(env) {
    if (!positiveDecimal(env.SLICER_UID) || !positiveDecimal(env.SLICER_GID)
        || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
        || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '')
        || !/^[0-9a-f]{40}$/.test(env.CANDIDATE_SHA || '')
        || typeof env.OPERATIONS_API_KEY !== 'string' || env.OPERATIONS_API_KEY.length < 32) {
        fail('runtime_environment_invalid');
    }
    const repositoryRoot = path.resolve(__dirname, '..');
    const evidenceDir = path.resolve(env.EVIDENCE_DIR);
    const stageRoot = path.resolve(env.I9_STAGE_ROOT);
    canonicalDirectory(evidenceDir, path.dirname(evidenceDir), 0o700,
        process.getuid?.() ?? 0, process.getgid?.() ?? 0);
    canonicalDirectory(stageRoot, path.dirname(stageRoot), 0o700,
        process.getuid?.() ?? 0, process.getgid?.() ?? 0);
    return {
        ...env,
        repositoryRoot,
        evidenceDir,
        stageRoot,
        pricingState: canonicalDirectory(
            env.SLICER_PRICING_STATE_DIR, stageRoot, 0o700,
            Number(env.SLICER_UID), Number(env.SLICER_GID)
        ),
        uid: env.SLICER_UID,
        gid: env.SLICER_GID,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        operationsKey: env.OPERATIONS_API_KEY
    };
}

function main() {
    let values;
    let manifest;
    let active;
    let rollback = 'not_attempted';
    let cleanup = 'not_attempted';
    let failure;
    const state = {
        phases: [],
        previousInitial: null,
        candidateRuntime: null,
        previousRollback: null,
        readiness: {
            previous: false, candidate: false, storageFailureObserved: false, rollback: false
        },
        synthetic: { previous: false, candidate: false, rollback: false },
        cleanup: false,
        temporaryStateRemoved: false,
        classification: 'runtime_failure'
    };
    try {
        values = resolveEnvironment(process.env);
        manifest = loadManifest(process.env);
        requireAbsent();
        state.phases.push('previous_qualified');
        runOrcaSmoke('previous', manifest.previous.config_id, values.uid, values.gid, values.evidenceDir);
        let stage = startStage(manifest.previous, values, 'previous');
        active = { candidate: manifest.previous, peerId: stage.peerId };
        state.previousInitial = {
            container_id: stage.inspect.id, pid: stage.inspect.pid,
            kernel_uid: stage.kernel.uid, kernel_gid: stage.kernel.gid
        };
        state.readiness.previous = true;
        state.phases.push('previous_ready');
        state.synthetic.previous = true;
        state.phases.push('previous_synthetic_slice');
        stopStage(active.candidate, values, active.peerId);
        active = null;

        runOrcaSmoke('candidate', manifest.candidate.config_id, values.uid, values.gid, values.evidenceDir);
        stage = startStage(manifest.candidate, values, 'candidate');
        active = { candidate: manifest.candidate, peerId: stage.peerId };
        state.candidateRuntime = {
            container_id: stage.inspect.id, pid: stage.inspect.pid,
            kernel_uid: stage.kernel.uid, kernel_gid: stage.kernel.gid
        };
        state.readiness.candidate = true;
        state.phases.push('candidate_ready');
        state.synthetic.candidate = true;
        state.phases.push('candidate_synthetic_slice');

        sudoChmod('0500', values.pricingState);
        state.phases.push('readiness_failure_injected');
        sleep(6500);
        observeStorageFailure(stage.peerId, values.operationsKey);
        state.readiness.storageFailureObserved = true;
        state.phases.push('readiness_failure_observed');
        sudoChmod('0700', values.pricingState);
        stopStage(active.candidate, values, active.peerId);
        active = null;

        stage = startStage(manifest.previous, values, 'rollback');
        active = { candidate: manifest.previous, peerId: stage.peerId };
        if (stage.inspect.id === state.previousInitial.container_id
            || stage.inspect.pid === state.previousInitial.pid) fail('rollback_process_identity_reused');
        state.previousRollback = {
            container_id: stage.inspect.id, pid: stage.inspect.pid,
            kernel_uid: stage.kernel.uid, kernel_gid: stage.kernel.gid
        };
        state.readiness.rollback = true;
        state.phases.push('previous_rollback_ready');
        runOrcaSmoke('rollback', manifest.previous.config_id, values.uid, values.gid, values.evidenceDir);
        state.synthetic.rollback = true;
        state.phases.push('previous_rollback_synthetic_slice');
        rollback = 'success';
        state.classification = 'success';
    } catch (error) {
        failure = error;
    } finally {
        if (values) {
            try { sudoChmod('0700', values.pricingState); } catch (error) { failure ||= error; }
            if (active) {
                try { stopStage(active.candidate, values, active.peerId); active = null; }
                catch (error) { failure ||= error; }
            }
            if (manifest && rollback !== 'success' && state.readiness.previous) {
                try {
                    const stage = startStage(manifest.previous, values, 'failure-rollback');
                    stopStage(manifest.previous, values, stage.peerId);
                    rollback = 'success_after_failure';
                } catch (error) {
                    rollback = 'failure';
                    failure ||= error;
                }
            }
            if (manifest) {
                try { removeImages([manifest.candidate, manifest.previous]); }
                catch (error) { failure ||= error; }
            }
            try {
                requireAbsent();
                state.cleanup = true;
                cleanup = 'success';
                if (!failure && state.classification === 'success') {
                    state.phases.push('runtime_cleanup_complete');
                }
            } catch (error) {
                cleanup = 'failure';
                failure ||= error;
            }
            try {
                removeStageRoot(values);
                state.temporaryStateRemoved = true;
            } catch (error) {
                cleanup = 'failure';
                failure ||= error;
            }
            if (!failure && state.classification === 'success') {
                const phaseError = require('./i9-staging-contract').validatePhaseOrder(state.phases);
                if (phaseError) failure = new Error(phaseError);
            }
            if (!failure) {
                try { writeDraft(values, manifest, state); } catch (error) { failure = error; }
            }
        }
        appendOutputs(process.env, failure ? 'failure' : state.classification, rollback, cleanup);
    }
    if (failure) {
        const code = /^[a-z0-9_]{1,96}$/.test(failure.code || failure.message)
            ? (failure.code || failure.message) : 'unclassified_runtime_failure';
        process.stderr.write(`::error title=I9 staging rollback rehearsal::${code}\n`);
        process.exitCode = 2;
    }
}

module.exports = Object.freeze({
    ALLOWED_DOCKER,
    API_NAME,
    DRAFT_FILE,
    NETWORK_NAME,
    PROJECT,
    candidateFromManifest,
    loadManifest,
    writeDraft
});

if (require.main === module) main();
