'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SOURCE_PATH = path.resolve(__dirname, '../../../scripts/i12-capacity-artifact-cleanup.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const REQUIRED_CONTRACTS = Object.freeze([
    ["const MANIFEST_PATH = '/run/i12-cleanup.json';", 'fixed manifest path'],
    ["const OUTPUT_ROOT = '/app/output';", 'fixed output root'],
    ["const ARTIFACT_METADATA_MODULE = '/app/services/artifact-metadata.js';", 'image metadata module'],
    ["const RESOURCE_POLICY_MODULE = '/app/config/resource-policy.js';", 'image resource policy module'],
    ["const CLEANUP_SCHEMA = 'i12-queue-cleanup-v1';", 'schema'],
    ['const MAX_MANIFEST_BYTES = 8 * 1024;', '8 KiB boundary'],
    ['const MAX_RECORDS = 3;', 'three-record boundary'],
    ["const MANIFEST_KEYS = Object.freeze(['artifacts', 'schema_version']);", 'manifest exact keys'],
    ["const RECORD_KEYS = Object.freeze(['artifact_id', 'job_id']);", 'record exact keys'],
    ["'artifactId', 'createdAt', 'fileIdentity', 'fileName',", 'metadata exact keys A'],
    ["'jobId', 'sizeBytes', 'state', 'version'", 'metadata exact keys B'],
    ['argv.length !== 2', 'no CLI arguments'],
    ['uid <= 0', 'non-root only'],
    ['return uid;', 'validated UID propagation'],
    ["typeof runtime.platform !== 'string'", 'explicit platform seam'],
    ["runtime.platform === 'win32'", 'Windows-only POSIX bypass'],
    ['owner !== uid', 'POSIX owner correlation'],
    ['stat.mode & 0o7777n', 'POSIX special-bit rejection'],
    ['statMode(stat) !== expectedMode', 'POSIX exact mode'],
    ['!before.isFile()', 'manifest regular file'],
    ['before.isSymbolicLink()', 'manifest nonlink'],
    ['Number(before.size) > MAX_MANIFEST_BYTES', 'manifest size boundary'],
    ['runtime.fsSync.realpathSync(resolved) !== resolved', 'manifest canonical path'],
    ['!sameIdentity(runtime.artifactMetadata, before, after)', 'manifest replacement identity'],
    ["assertPosixOwnerMode(runtime, before, uid, 0o600, 'cleanup_manifest_permissions_invalid');", 'manifest initial 0600'],
    ["assertPosixOwnerMode(runtime, after, uid, 0o600, 'cleanup_manifest_permissions_invalid');", 'manifest final 0600'],
    ['!hasExactKeys(manifest, MANIFEST_KEYS)', 'manifest key enforcement'],
    ['manifest.schema_version !== CLEANUP_SCHEMA', 'manifest schema enforcement'],
    ['manifest.artifacts.length > MAX_RECORDS', 'record count enforcement'],
    ['!hasExactKeys(record, RECORD_KEYS)', 'record key enforcement'],
    ['!JOB_ID.test(record.job_id)', 'job ID shape'],
    ['!ARTIFACT_ID.test(record.artifact_id)', 'artifact ID shape'],
    ['jobs.has(record.job_id)', 'job collision rejection'],
    ['artifacts.has(record.artifact_id)', 'artifact collision rejection'],
    ['runtime.artifactMetadata.assertCanonicalOutputRoot(runtime.outputRoot)', 'image root validator'],
    ['!details.isDirectory()', 'output directory'],
    ['details.isSymbolicLink()', 'output nonlink'],
    ['!runtime.artifactMetadata.samePath(real, root)', 'output canonical realpath'],
    ["assertPosixOwnerMode(runtime, details, uid, 0o700, 'cleanup_output_root_permissions_invalid');", 'output root 0700'],
    ['runtime.artifactMetadata.inspectMarker(', 'image marker inspector'],
    ['inspected.partial !== false', 'partial rejection'],
    ['inspected.missing !== false', 'missing rejection'],
    ['!hasExactKeys(metadata, METADATA_KEYS)', 'metadata exact keys'],
    ["metadata.state !== 'complete'", 'complete-only metadata'],
    ['metadata.jobId !== record.job_id', 'job correlation'],
    ['metadata.artifactId !== record.artifact_id', 'artifact correlation'],
    ['metadata.sizeBytes > policy.MAX_OUTPUT_BYTES', 'policy size boundary'],
    ['const markerPath = directChild(root,', 'marker direct child'],
    ['const artifactPath = directChild(root, metadata.fileName);', 'artifact direct child'],
    ['!runtime.artifactMetadata.samePath(inspected.realPath, artifactPath)', 'inspected realpath'],
    ['runtime.artifactMetadata.fileIdentity(snapshot.artifactStat) !== metadata.fileIdentity', 'artifact metadata identity'],
    ['inspected.metadataIdentity !== runtime.artifactMetadata.fileIdentity(snapshot.markerStat)', 'marker identity'],
    ['artifact.isSymbolicLink()', 'artifact re-stat nonlink'],
    ['marker.isSymbolicLink()', 'marker re-stat nonlink'],
    ['runtime.artifactMetadata.fileIdentity(artifact) !== plan.artifactIdentity', 'artifact re-stat identity'],
    ['runtime.artifactMetadata.fileIdentity(marker) !== plan.markerIdentity', 'marker re-stat identity'],
    ['await assertAbsent(runtime.fsPromises, plan.artifactPath);', 'artifact post-absence'],
    ['await assertAbsent(runtime.fsPromises, plan.markerPath);', 'marker post-absence'],
    ["if (error?.code === 'ENOENT') return;", 'absence reason'],
    ["return `${JSON.stringify({ classification, deleted_count: deletedCount })}\\n`;", 'bounded output schema'],
    ["stderr.write(boundedOutput('cleanup_failed', deletedCount));", 'sanitized failure output'],
    ['const artifactMetadata = require(ARTIFACT_METADATA_MODULE);', 'fixed metadata require'],
    ['const { resolveResourcePolicy } = require(RESOURCE_POLICY_MODULE);', 'fixed policy require'],
    ['platform: process.platform,', 'production platform seam']
]);
const FORBIDDEN_SURFACES = Object.freeze([
    "require('node:http')", "require('node:https')", "require('node:net')",
    "require('node:dgram')", "require('node:child_process')", 'fetch(', 'console.',
    'stderr.write(String(error', 'stdout.write(String(error'
]);

function requireText(source, text, label = text) {
    assert.ok(source.includes(text), `missing cleanup contract: ${label}`);
}

function requireOrder(source, labels) {
    let cursor = -1;
    for (const [label, text] of labels) {
        const next = source.indexOf(text, cursor + 1);
        assert.ok(next > cursor, `cleanup ordering drift: ${label}`);
        cursor = next;
    }
}

function requireOccurrences(source, text, count, label) {
    assert.equal(source.split(text).length - 1, count, `cleanup occurrence drift: ${label}`);
}

function validateCleanupSource(source) {
    for (const [text, label] of REQUIRED_CONTRACTS) requireText(source, text, label);

    requireText(source, "Object.keys(value).sort().join('\\0') === expected.join('\\0')", 'exact key comparison');
    requireOccurrences(source, 'marker.isSymbolicLink()', 2, 'marker nonlink at both re-stat boundaries');
    requireOccurrences(
        source,
        "0o600, 'cleanup_manifest_permissions_invalid'",
        2,
        'manifest owner and mode before and after read'
    );
    requireOccurrences(
        source,
        'runtime.artifactMetadata.fileIdentity(marker) !== plan.markerIdentity',
        2,
        'marker identity at both re-stat boundaries'
    );
    requireText(source, 'const plans = await Promise.all(records.map(', 'all-record preflight');
    requireText(source, 'await Promise.all(plans.map((plan) => assertPlanUnchanged(runtime, root, plan)));', 'global pre-delete re-stat');
    requireOrder(source, [
        ['all-record preflight', 'const plans = await Promise.all(records.map('],
        ['global re-stat', 'await Promise.all(plans.map((plan) => assertPlanUnchanged(runtime, root, plan)));'],
        ['per-record re-stat', 'await assertPlanUnchanged(runtime, root, plan);'],
        ['artifact unlink', 'await runtime.fsPromises.unlink(plan.artifactPath);'],
        ['marker re-stat', 'await assertMarkerUnchanged(runtime, root, plan);'],
        ['marker unlink', 'await runtime.fsPromises.unlink(plan.markerPath);'],
        ['artifact absence', 'await assertAbsent(runtime.fsPromises, plan.artifactPath);'],
        ['marker absence', 'await assertAbsent(runtime.fsPromises, plan.markerPath);']
    ]);
    for (const forbidden of FORBIDDEN_SURFACES) {
        assert.equal(source.includes(forbidden), false, `forbidden cleanup surface: ${forbidden}`);
    }
    return true;
}

function replaceRequired(source, pattern, replacement) {
    if (typeof pattern === 'string') assert.ok(source.includes(pattern), `missing mutation seam: ${pattern}`);
    else assert.match(source, pattern, `missing mutation seam: ${pattern}`);
    const mutated = source.replace(pattern, replacement);
    assert.notEqual(mutated, source, 'mutation did not change source');
    return mutated;
}

function replaceAllRequired(source, pattern, replacement) {
    assert.ok(source.includes(pattern), `missing mutation seam: ${pattern}`);
    const mutated = source.replaceAll(pattern, replacement);
    assert.notEqual(mutated, source, 'mutation did not change source');
    return mutated;
}

test('committed cleanup helper satisfies the static mutation contract', () => {
    assert.equal(validateCleanupSource(SOURCE), true);
});

test('cleanup weakening mutations are rejected', async (context) => {
    const cases = [
        ['manifest path drift', replaceRequired(SOURCE, '/run/i12-cleanup.json', '/tmp/cleanup.json')],
        ['output root drift', replaceRequired(SOURCE, '/app/output', '/tmp/output')],
        ['metadata module drift', replaceRequired(SOURCE, '/app/services/artifact-metadata.js', './artifact-metadata.js')],
        ['policy module drift', replaceRequired(SOURCE, '/app/config/resource-policy.js', './resource-policy.js')],
        ['root allowed', replaceRequired(SOURCE, 'uid <= 0', 'uid < 0')],
        ['CLI arguments allowed', replaceRequired(SOURCE, 'argv.length !== 2', 'argv.length < 2')],
        ['validated UID discarded', replaceRequired(SOURCE, 'return uid;', 'return undefined;')],
        ['platform seam omitted', replaceRequired(SOURCE, "typeof runtime.platform !== 'string'", 'false')],
        ['all platforms bypass POSIX checks', replaceRequired(SOURCE, "runtime.platform === 'win32'", 'true')],
        ['owner correlation removed', replaceRequired(SOURCE, 'owner !== uid', 'false')],
        ['special mode bits ignored', replaceRequired(SOURCE, 'stat.mode & 0o7777n', 'stat.mode & 0o777n')],
        ['mode correlation removed', replaceRequired(SOURCE, 'statMode(stat) !== expectedMode', 'false')],
        ['manifest initial mode widened', replaceRequired(
            SOURCE,
            "assertPosixOwnerMode(runtime, before, uid, 0o600, 'cleanup_manifest_permissions_invalid');",
            "assertPosixOwnerMode(runtime, before, uid, 0o640, 'cleanup_manifest_permissions_invalid');"
        )],
        ['manifest final permission recheck removed', replaceRequired(
            SOURCE,
            "assertPosixOwnerMode(runtime, after, uid, 0o600, 'cleanup_manifest_permissions_invalid');",
            ''
        )],
        ['output root mode widened', replaceRequired(
            SOURCE,
            "assertPosixOwnerMode(runtime, details, uid, 0o700, 'cleanup_output_root_permissions_invalid');",
            "assertPosixOwnerMode(runtime, details, uid, 0o750, 'cleanup_output_root_permissions_invalid');"
        )],
        ['production platform hardcoded', replaceRequired(SOURCE, 'platform: process.platform,', "platform: 'win32',")],
        ['manifest widened', replaceRequired(SOURCE, '8 * 1024', '9 * 1024')],
        ['record count widened', replaceRequired(SOURCE, 'MAX_RECORDS = 3', 'MAX_RECORDS = 4')],
        ['manifest symlink allowed', replaceRequired(SOURCE, 'before.isSymbolicLink()', 'false')],
        ['manifest replacement ignored', replaceRequired(SOURCE, '!sameIdentity(runtime.artifactMetadata, before, after)', 'false')],
        ['manifest extra keys allowed', replaceRequired(SOURCE, '!hasExactKeys(manifest, MANIFEST_KEYS)', '!manifest')],
        ['schema drift allowed', replaceRequired(SOURCE, 'manifest.schema_version !== CLEANUP_SCHEMA', 'false')],
        ['record missing keys allowed', replaceRequired(SOURCE, '!hasExactKeys(record, RECORD_KEYS)', '!record')],
        ['job collision allowed', replaceRequired(SOURCE, 'jobs.has(record.job_id)', 'false')],
        ['artifact collision allowed', replaceRequired(SOURCE, 'artifacts.has(record.artifact_id)', 'false')],
        ['partial allowed', replaceRequired(SOURCE, 'inspected.partial !== false', 'false')],
        ['missing allowed', replaceRequired(SOURCE, 'inspected.missing !== false', 'false')],
        ['metadata extra keys allowed', replaceRequired(SOURCE, '!hasExactKeys(metadata, METADATA_KEYS)', '!metadata')],
        ['incomplete metadata allowed', replaceRequired(SOURCE, "metadata.state !== 'complete'", 'false')],
        ['job mismatch allowed', replaceRequired(SOURCE, 'metadata.jobId !== record.job_id', 'false')],
        ['artifact mismatch allowed', replaceRequired(SOURCE, 'metadata.artifactId !== record.artifact_id', 'false')],
        ['size policy removed', replaceRequired(SOURCE, 'metadata.sizeBytes > policy.MAX_OUTPUT_BYTES', 'false')],
        ['artifact direct-child proof removed', replaceRequired(SOURCE, 'const artifactPath = directChild(root, metadata.fileName);', 'const artifactPath = path.join(root, metadata.fileName);')],
        ['artifact symlink allowed', replaceRequired(SOURCE, 'artifact.isSymbolicLink()', 'false')],
        ['marker symlink allowed', replaceAllRequired(SOURCE, 'marker.isSymbolicLink()', 'false')],
        ['artifact identity ignored', replaceRequired(SOURCE, 'runtime.artifactMetadata.fileIdentity(artifact) !== plan.artifactIdentity', 'false')],
        ['marker identity ignored', replaceAllRequired(
            SOURCE,
            'runtime.artifactMetadata.fileIdentity(marker) !== plan.markerIdentity',
            'false'
        )],
        ['partial preflight can delete', replaceRequired(SOURCE, 'const plans = await Promise.all(records.map(', 'const plans = records.map(')],
        ['global race re-stat removed', replaceRequired(SOURCE, 'await Promise.all(plans.map((plan) => assertPlanUnchanged(runtime, root, plan)));', '')],
        ['per-record race re-stat removed', replaceRequired(SOURCE, '            await assertPlanUnchanged(runtime, root, plan);', '')],
        ['artifact residue ignored', replaceRequired(SOURCE, 'await assertAbsent(runtime.fsPromises, plan.artifactPath);', '')],
        ['marker residue ignored', replaceRequired(SOURCE, 'await assertAbsent(runtime.fsPromises, plan.markerPath);', '')],
        ['marker deleted first', replaceRequired(
            SOURCE,
            'await runtime.fsPromises.unlink(plan.artifactPath);',
            'await runtime.fsPromises.unlink(plan.markerPath);'
        )],
        ['raw error emitted', replaceRequired(
            SOURCE,
            "stderr.write(boundedOutput('cleanup_failed', deletedCount));",
            "stderr.write(String(error));"
        )],
        ['network client added', `${SOURCE}\nrequire('node:https');\n`]
    ];
    for (const [label, mutated] of cases) {
        await context.test(label, () => assert.throws(
            () => validateCleanupSource(mutated),
            undefined,
            `${label} must fail closed`
        ));
    }
});
