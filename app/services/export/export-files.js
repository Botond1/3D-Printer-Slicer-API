'use strict';

/**
 * Private storage of asynchronous export results (3.9.0 §4.7).
 *
 * One directory per job, `/app/input/.export-results/ex_<32 hex>/` (0700),
 * holding exactly one result file (0600). A result lives until its job's
 * `DELETE`, 15 minutes after completion, or a restart (the integrator purges
 * the whole directory at startup). The path constant lives here, not in the
 * guarded `config/paths.js`.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { HELP_FILES_DIR } = require('../../config/paths');

const EXPORT_RESULTS_DIR = path.join(HELP_FILES_DIR, '.export-results');
const EXPORT_JOB_ID = /^ex_[a-f0-9]{32}$/;
const RESULT_FILE_NAMES = Object.freeze({ stl: 'r3d-export.stl', '3mf': 'r3d-export.3mf' });

function assertJobId(jobId) {
    if (typeof jobId !== 'string' || !EXPORT_JOB_ID.test(jobId)) throw new Error('Invalid export job id.');
    return jobId;
}

function assertFormat(format) {
    if (!Object.hasOwn(RESULT_FILE_NAMES, format)) throw new Error('Invalid export format.');
    return format;
}

/**
 * Create the export file store over one root directory.
 * @param {{root?: string}} [options] Root override (tests).
 * @returns {{root: string, resultDirectory: Function, storeResultFile: Function, removeResult: Function, purgeAll: Function}}
 */
function createExportFiles(options = {}) {
    const root = path.resolve(options.root || EXPORT_RESULTS_DIR);

    function resultDirectory(jobId) {
        return path.join(root, assertJobId(jobId));
    }

    async function ensureRoot() {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        const stats = await fs.lstat(root);
        if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Export result root is not a directory.');
        await fs.chmod(root, 0o700).catch(() => {});
    }

    /**
     * Move (or copy, across devices) a finished export file into the job's
     * result directory. The source is removed in every outcome.
     * @param {string} jobId `ex_<32 hex>`.
     * @param {string} format `stl` or `3mf`.
     * @param {string} sourcePath Finished file inside a job workspace.
     * @returns {Promise<string>} Stored file path.
     */
    async function storeResultFile(jobId, format, sourcePath) {
        const directory = resultDirectory(jobId);
        const target = path.join(directory, RESULT_FILE_NAMES[assertFormat(format)]);
        await ensureRoot();
        // A run re-queued after a pre-emption may have stored once already.
        await fs.rm(directory, { recursive: true, force: true });
        await fs.mkdir(directory, { mode: 0o700 });
        try {
            try {
                await fs.rename(sourcePath, target);
            } catch (error) {
                if (error?.code !== 'EXDEV') throw error;
                await fs.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
                await fs.rm(sourcePath, { force: true });
            }
            await fs.chmod(target, 0o600).catch(() => {});
            return target;
        } catch (error) {
            await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    /** Remove a job's result directory; absent is success. */
    async function removeResult(jobId) {
        await fs.rm(resultDirectory(jobId), { recursive: true, force: true });
    }

    /** Remove every stored result (startup purge: no job survives a restart). */
    async function purgeAll() {
        await fs.rm(root, { recursive: true, force: true });
    }

    return { root, resultDirectory, storeResultFile, removeResult, purgeAll };
}

const defaultExportFiles = createExportFiles();

module.exports = {
    EXPORT_JOB_ID,
    EXPORT_RESULTS_DIR,
    RESULT_FILE_NAMES,
    createExportFiles,
    defaultExportFiles,
    purgeExportResults: () => defaultExportFiles.purgeAll()
};
