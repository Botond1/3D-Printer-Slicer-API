'use strict';

/** Exact selected-profile byte continuity inside one slice job. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { readFileSyncBounded } = require('../../utils/bounded-file');
const { resolveRuntimeProfilePath } = require('./profiles');
const { resolveOrcaProfileInheritance } = require('./orca-profile-inheritance');

/**
 * Copy one selected immutable profile into job-owned scratch storage.
 * The shared bounded reader rejects non-canonical/symlink paths and reads at
 * most the validated byte length plus one drift-detection byte. Downstream
 * consumers use only the resulting snapshot, so a later operator replacement
 * cannot create old-hash/new-slice drift.
 * @param {string} sourcePath Selected source profile.
 * @param {string} prefix Stable snapshot prefix.
 * @param {'.ini'|'.json'} extension Snapshot extension.
 * @param {{resolveScratchPath(...segments: string[]): string, assertScratchContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<string>} Job-owned exact-byte snapshot path.
 */
async function snapshotProfileFile(sourcePath, prefix, extension, workspace) {
    const source = path.resolve(sourcePath);
    const content = readFileSyncBounded(
        source,
        resolveResourcePolicy().MAX_PROFILE_BYTES,
        null
    );
    if (content.length === 0) {
        throw new Error('Selected slicer profile must be a non-empty bounded regular file.');
    }

    const snapshotPath = resolveRuntimeProfilePath(workspace, prefix, extension);
    await fs.writeFile(snapshotPath, content, { flag: 'wx', mode: 0o600 });
    return snapshotPath;
}

async function snapshotResolvedOrcaProfile(sourcePath, profileType, prefix, workspace) {
    const resolved = resolveOrcaProfileInheritance(sourcePath, profileType);
    const content = Buffer.from(`${JSON.stringify(resolved, null, 4)}\n`, 'utf8');
    if (content.length > resolveResourcePolicy().MAX_PROFILE_BYTES) {
        throw new Error('Resolved Orca profile exceeds the configured byte limit.');
    }
    const snapshotPath = resolveRuntimeProfilePath(workspace, prefix, '.json');
    await fs.writeFile(snapshotPath, content, { flag: 'wx', mode: 0o600 });
    return snapshotPath;
}

/**
 * Snapshot every selected profile before bounds parsing or runtime derivation.
 * Public response metadata continues to use the original selection paths.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {{baseConfigFile: string, orcaMachineConfigFile: string|null, orcaFilamentConfigFile?: string|null}} selection Original selection.
 * @param {{resolveScratchPath(...segments: string[]): string, assertScratchContainedPath(candidatePath: string): string}} workspace Owning workspace.
 * @returns {Promise<{baseConfigFile: string, orcaMachineConfigFile: string|null, orcaFilamentConfigFile: string|null}>} Exact job-owned inputs.
 */
async function snapshotProfileSelection(engine, selection, workspace) {
    if (engine !== 'prusa' && engine !== 'orca') {
        throw new Error('Unsupported slicer engine for profile snapshot.');
    }
    const baseConfigFile = engine === 'orca'
        ? await snapshotResolvedOrcaProfile(
            selection.baseConfigFile,
            'process',
            'orca-base-profile',
            workspace
        )
        : await snapshotProfileFile(
            selection.baseConfigFile,
            'prusa-base-profile',
            '.ini',
            workspace
        );
    const orcaMachineConfigFile = engine === 'orca'
        ? await snapshotResolvedOrcaProfile(
            selection.orcaMachineConfigFile,
            'machine',
            'orca-machine-profile',
            workspace
        )
        : null;
    const orcaFilamentConfigFile = engine === 'orca' && selection.orcaFilamentConfigFile
        ? await snapshotProfileFile(
            selection.orcaFilamentConfigFile,
            'orca-filament-profile',
            '.json',
            workspace
        )
        : null;
    return { baseConfigFile, orcaMachineConfigFile, orcaFilamentConfigFile };
}

module.exports = { snapshotProfileFile, snapshotProfileSelection, snapshotResolvedOrcaProfile };
