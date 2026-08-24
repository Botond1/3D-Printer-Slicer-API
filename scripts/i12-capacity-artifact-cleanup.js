'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const MANIFEST_PATH = '/run/i12-cleanup.json';
const OUTPUT_ROOT = '/app/output';
const ARTIFACT_METADATA_MODULE = '/app/services/artifact-metadata.js';
const RESOURCE_POLICY_MODULE = '/app/config/resource-policy.js';
const CLEANUP_SCHEMA = 'i12-queue-cleanup-v1';
const MAX_MANIFEST_BYTES = 8 * 1024;
const MAX_RECORDS = 3;
const MAX_MARKER_BYTES = 64 * 1024;
const JOB_ID = /^job-[a-f0-9]{32}$/;
const ARTIFACT_ID = /^artifact-[a-f0-9]{32}$/;
const MANIFEST_KEYS = Object.freeze(['artifacts', 'schema_version']);
const RECORD_KEYS = Object.freeze(['artifact_id', 'job_id']);
const METADATA_KEYS = Object.freeze([
    'artifactId', 'createdAt', 'fileIdentity', 'fileName',
    'jobId', 'sizeBytes', 'state', 'version'
]);

class CleanupContractError extends Error {
    constructor(code, deletedCount = 0) {
        super(code);
        this.name = 'CleanupContractError';
        this.code = code;
        this.deletedCount = deletedCount;
    }
}

function fail(code, deletedCount = 0) {
    throw new CleanupContractError(code, deletedCount);
}

function hasExactKeys(value, expected) {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.keys(value).sort().join('\0') === expected.join('\0')
    );
}

function sameIdentity(metadataModule, left, right) {
    return metadataModule.fileIdentity(left) === metadataModule.fileIdentity(right);
}

function directChild(root, name) {
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\')) return null;
    const candidate = path.join(root, name);
    return path.dirname(candidate) === root ? candidate : null;
}

function assertExecutionBoundary(argv, getuid) {
    if (!Array.isArray(argv) || argv.length !== 2) fail('cleanup_cli_arguments_forbidden');
    if (typeof getuid !== 'function') fail('cleanup_uid_unavailable');
    const uid = getuid();
    if (!Number.isSafeInteger(uid) || uid <= 0) fail('cleanup_root_forbidden');
    return uid;
}

function statMode(stat) {
    if (typeof stat.mode === 'bigint') return Number(stat.mode & 0o7777n);
    return Number.isSafeInteger(stat.mode) ? stat.mode & 0o7777 : null;
}

function assertPosixOwnerMode(runtime, stat, uid, expectedMode, code) {
    if (typeof runtime.platform !== 'string' || runtime.platform.length === 0) {
        fail('cleanup_platform_invalid');
    }
    if (runtime.platform === 'win32') return;
    const owner = typeof stat.uid === 'bigint' ? Number(stat.uid) : stat.uid;
    if (!Number.isSafeInteger(owner) || owner !== uid || statMode(stat) !== expectedMode) fail(code);
}

function assertRegularCanonicalManifest(runtime, uid) {
    const resolved = path.resolve(runtime.manifestPath);
    let before;
    try {
        before = runtime.fsSync.lstatSync(resolved, { bigint: true });
    } catch {
        fail('cleanup_manifest_unavailable');
    }
    if (
        !before.isFile()
        || before.isSymbolicLink()
        || Number(before.size) <= 0
        || Number(before.size) > MAX_MANIFEST_BYTES
        || runtime.fsSync.realpathSync(resolved) !== resolved
    ) fail('cleanup_manifest_unsafe');
    assertPosixOwnerMode(runtime, before, uid, 0o600, 'cleanup_manifest_permissions_invalid');
    let raw;
    try {
        raw = runtime.fsSync.readFileSync(resolved, 'utf8');
    } catch {
        fail('cleanup_manifest_unreadable');
    }
    const after = runtime.fsSync.lstatSync(resolved, { bigint: true });
    if (!sameIdentity(runtime.artifactMetadata, before, after) || Number(after.size) !== Number(before.size)) {
        fail('cleanup_manifest_replaced');
    }
    assertPosixOwnerMode(runtime, after, uid, 0o600, 'cleanup_manifest_permissions_invalid');
    return raw;
}

function parseManifest(raw) {
    let manifest;
    try {
        manifest = JSON.parse(raw);
    } catch {
        fail('cleanup_manifest_json_invalid');
    }
    if (!hasExactKeys(manifest, MANIFEST_KEYS) || manifest.schema_version !== CLEANUP_SCHEMA) {
        fail('cleanup_manifest_schema_invalid');
    }
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length > MAX_RECORDS) {
        fail('cleanup_manifest_records_invalid');
    }
    const jobs = new Set();
    const artifacts = new Set();
    for (const record of manifest.artifacts) {
        if (
            !hasExactKeys(record, RECORD_KEYS)
            || !JOB_ID.test(record.job_id)
            || !ARTIFACT_ID.test(record.artifact_id)
            || jobs.has(record.job_id)
            || artifacts.has(record.artifact_id)
        ) fail('cleanup_manifest_record_invalid');
        jobs.add(record.job_id);
        artifacts.add(record.artifact_id);
    }
    return manifest.artifacts;
}

async function canonicalOutputRoot(runtime, uid) {
    let root;
    try {
        root = await runtime.artifactMetadata.assertCanonicalOutputRoot(runtime.outputRoot);
        const details = await runtime.fsPromises.lstat(root, { bigint: true });
        const real = await runtime.fsPromises.realpath(root);
        if (
            !details.isDirectory()
            || details.isSymbolicLink()
            || !runtime.artifactMetadata.samePath(root, path.resolve(runtime.outputRoot))
            || !runtime.artifactMetadata.samePath(real, root)
        ) fail('cleanup_output_root_unsafe');
        assertPosixOwnerMode(runtime, details, uid, 0o700, 'cleanup_output_root_permissions_invalid');
    } catch (error) {
        if (error instanceof CleanupContractError) throw error;
        fail('cleanup_output_root_unsafe');
    }
    return root;
}

function markerEntry(artifactId) {
    return Object.freeze({
        name: `.${artifactId}.json`,
        isFile: () => true,
        isSymbolicLink: () => false
    });
}

async function snapshotPaths(runtime, root, metadata, markerPath, artifactPath) {
    const [markerStat, artifactStat, markerReal, artifactReal] = await Promise.all([
        runtime.fsPromises.lstat(markerPath, { bigint: true }),
        runtime.fsPromises.lstat(artifactPath, { bigint: true }),
        runtime.fsPromises.realpath(markerPath),
        runtime.fsPromises.realpath(artifactPath)
    ]);
    if (
        !markerStat.isFile()
        || markerStat.isSymbolicLink()
        || Number(markerStat.size) <= 0
        || Number(markerStat.size) > MAX_MARKER_BYTES
        || !artifactStat.isFile()
        || artifactStat.isSymbolicLink()
        || Number(artifactStat.size) !== metadata.sizeBytes
        || Number(artifactStat.size) <= 0
        || !runtime.artifactMetadata.samePath(markerReal, markerPath)
        || !runtime.artifactMetadata.samePath(artifactReal, artifactPath)
        || path.dirname(markerPath) !== root
        || path.dirname(artifactPath) !== root
    ) fail('cleanup_artifact_snapshot_unsafe');
    return { markerStat, artifactStat };
}

async function preflightRecord(runtime, root, policy, record) {
    let inspected;
    try {
        inspected = await runtime.artifactMetadata.inspectMarker(
            root,
            markerEntry(record.artifact_id),
            policy
        );
    } catch {
        fail('cleanup_metadata_inspection_failed');
    }
    const metadata = inspected?.metadata;
    if (
        !inspected
        || inspected.partial !== false
        || inspected.missing !== false
        || !hasExactKeys(metadata, METADATA_KEYS)
        || metadata.state !== 'complete'
        || metadata.jobId !== record.job_id
        || metadata.artifactId !== record.artifact_id
        || !Number.isSafeInteger(metadata.sizeBytes)
        || metadata.sizeBytes <= 0
        || metadata.sizeBytes > policy.MAX_OUTPUT_BYTES
    ) fail('cleanup_metadata_contract_invalid');
    const markerPath = directChild(root, `.${record.artifact_id}.json`);
    const artifactPath = directChild(root, metadata.fileName);
    if (
        !markerPath
        || !artifactPath
        || !runtime.artifactMetadata.samePath(inspected.metadataPath, markerPath)
        || !runtime.artifactMetadata.samePath(inspected.artifactPath, artifactPath)
        || !runtime.artifactMetadata.samePath(inspected.realPath, artifactPath)
    ) fail('cleanup_artifact_path_invalid');
    const snapshot = await snapshotPaths(runtime, root, metadata, markerPath, artifactPath);
    if (
        runtime.artifactMetadata.fileIdentity(snapshot.artifactStat) !== metadata.fileIdentity
        || inspected.artifactIdentity !== metadata.fileIdentity
        || inspected.metadataIdentity !== runtime.artifactMetadata.fileIdentity(snapshot.markerStat)
    ) fail('cleanup_artifact_identity_invalid');
    return Object.freeze({
        artifactPath,
        markerPath,
        artifactIdentity: metadata.fileIdentity,
        markerIdentity: inspected.metadataIdentity,
        sizeBytes: metadata.sizeBytes
    });
}

async function assertPlanUnchanged(runtime, root, plan) {
    const artifact = await runtime.fsPromises.lstat(plan.artifactPath, { bigint: true });
    const marker = await runtime.fsPromises.lstat(plan.markerPath, { bigint: true });
    if (
        !artifact.isFile()
        || artifact.isSymbolicLink()
        || Number(artifact.size) !== plan.sizeBytes
        || runtime.artifactMetadata.fileIdentity(artifact) !== plan.artifactIdentity
        || !marker.isFile()
        || marker.isSymbolicLink()
        || runtime.artifactMetadata.fileIdentity(marker) !== plan.markerIdentity
        || !runtime.artifactMetadata.samePath(await runtime.fsPromises.realpath(plan.artifactPath), plan.artifactPath)
        || !runtime.artifactMetadata.samePath(await runtime.fsPromises.realpath(plan.markerPath), plan.markerPath)
        || path.dirname(plan.artifactPath) !== root
        || path.dirname(plan.markerPath) !== root
    ) fail('cleanup_artifact_changed');
}

async function assertMarkerUnchanged(runtime, root, plan) {
    const marker = await runtime.fsPromises.lstat(plan.markerPath, { bigint: true });
    if (
        !marker.isFile()
        || marker.isSymbolicLink()
        || runtime.artifactMetadata.fileIdentity(marker) !== plan.markerIdentity
        || !runtime.artifactMetadata.samePath(await runtime.fsPromises.realpath(plan.markerPath), plan.markerPath)
        || path.dirname(plan.markerPath) !== root
    ) fail('cleanup_marker_changed');
}

async function assertAbsent(fsApi, target) {
    try {
        await fsApi.lstat(target);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    fail('cleanup_residue_detected');
}

async function executeCleanup(runtime) {
    const uid = assertExecutionBoundary(runtime.argv, runtime.getuid);
    const raw = assertRegularCanonicalManifest(runtime, uid);
    const records = parseManifest(raw);
    const root = await canonicalOutputRoot(runtime, uid);
    if (!Number.isSafeInteger(runtime.policy.MAX_OUTPUT_BYTES) || runtime.policy.MAX_OUTPUT_BYTES <= 0) {
        fail('cleanup_resource_policy_invalid');
    }
    let deletedCount = 0;
    try {
        const plans = await Promise.all(records.map(
            (record) => preflightRecord(runtime, root, runtime.policy, record)
        ));
        await Promise.all(plans.map((plan) => assertPlanUnchanged(runtime, root, plan)));
        for (const plan of plans) {
            await assertPlanUnchanged(runtime, root, plan);
            await runtime.fsPromises.unlink(plan.artifactPath);
            await assertMarkerUnchanged(runtime, root, plan);
            await runtime.fsPromises.unlink(plan.markerPath);
            await assertAbsent(runtime.fsPromises, plan.artifactPath);
            await assertAbsent(runtime.fsPromises, plan.markerPath);
            deletedCount += 1;
        }
        return Object.freeze({ classification: 'cleanup_complete', deleted_count: deletedCount });
    } catch (error) {
        if (error instanceof CleanupContractError) {
            error.deletedCount = deletedCount;
            throw error;
        }
        throw new CleanupContractError('cleanup_execution_failed', deletedCount);
    }
}

function loadProductionRuntime() {
    const artifactMetadata = require(ARTIFACT_METADATA_MODULE);
    const { resolveResourcePolicy } = require(RESOURCE_POLICY_MODULE);
    return {
        argv: process.argv,
        getuid: process.getuid,
        platform: process.platform,
        manifestPath: MANIFEST_PATH,
        outputRoot: OUTPUT_ROOT,
        fsSync: fs,
        fsPromises,
        artifactMetadata,
        policy: resolveResourcePolicy(process.env)
    };
}

function boundedOutput(classification, deletedCount) {
    return `${JSON.stringify({ classification, deleted_count: deletedCount })}\n`;
}

async function runCli(options = {}) {
    const stdout = options.stdout || process.stdout;
    const stderr = options.stderr || process.stderr;
    try {
        const runtime = options.loadRuntime ? options.loadRuntime() : loadProductionRuntime();
        const result = await executeCleanup(runtime);
        stdout.write(boundedOutput(result.classification, result.deleted_count));
        return 0;
    } catch (error) {
        const deletedCount = Number.isSafeInteger(error?.deletedCount) ? error.deletedCount : 0;
        stderr.write(boundedOutput('cleanup_failed', deletedCount));
        return 1;
    }
}

if (require.main === module) {
    runCli().then((exitCode) => { process.exitCode = exitCode; });
}

module.exports = {
    ARTIFACT_METADATA_MODULE,
    CLEANUP_SCHEMA,
    CleanupContractError,
    MANIFEST_PATH,
    MAX_MANIFEST_BYTES,
    MAX_RECORDS,
    OUTPUT_ROOT,
    RESOURCE_POLICY_MODULE,
    assertExecutionBoundary,
    boundedOutput,
    executeCleanup,
    hasExactKeys,
    parseManifest,
    runCli
};
