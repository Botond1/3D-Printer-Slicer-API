/**
 * Filesystem path configuration used by the API and converter scripts.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const APP_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = fs.existsSync(path.join(APP_ROOT, 'package.json'))
    ? APP_ROOT
    : path.resolve(APP_ROOT, '..');
const APP_CONFIG_DIR = path.join(APP_ROOT, 'config');
const HELP_FILES_DIR = path.join(WORKSPACE_ROOT, 'input');
const JOB_WORKSPACES_DIR = path.join(HELP_FILES_DIR, '.slice-jobs');
const JOB_SCRATCH_DIR = path.join(os.tmpdir(), 'slice-jobs');
const OUTPUT_DIR = path.join(WORKSPACE_ROOT, 'output');
const CONFIGS_DIR = path.join(WORKSPACE_ROOT, 'configs');
const PRUSA_CONFIGS_DIR = path.join(CONFIGS_DIR, 'prusa');
const ORCA_CONFIGS_DIR = path.join(CONFIGS_DIR, 'orca');
const BAMBU_CONFIGS_DIR = path.join(CONFIGS_DIR, 'bambu');
const PRICING_STATE_DIR = path.join(CONFIGS_DIR, 'pricing-state');
const PRICING_FILE = path.join(PRICING_STATE_DIR, 'pricing.json');
const LEGACY_PRICING_FILE = path.join(CONFIGS_DIR, 'pricing.json');

/**
 * Ensure all runtime directories exist before processing requests.
 * @returns {void}
 */
function ensureRequiredDirectories() {
    if (!fs.existsSync(APP_CONFIG_DIR)) fs.mkdirSync(APP_CONFIG_DIR, { recursive: true });
    ensureCanonicalRuntimeDirectory(HELP_FILES_DIR);
    ensureCanonicalRuntimeDirectory(JOB_WORKSPACES_DIR, 0o700);
    ensureCanonicalRuntimeDirectory(JOB_SCRATCH_DIR, 0o700);
    ensureCanonicalRuntimeDirectory(OUTPUT_DIR);
    if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });
    ensureCanonicalRuntimeDirectory(PRICING_STATE_DIR, 0o700);
    if (!fs.existsSync(PRUSA_CONFIGS_DIR)) fs.mkdirSync(PRUSA_CONFIGS_DIR, { recursive: true });
    if (!fs.existsSync(ORCA_CONFIGS_DIR)) fs.mkdirSync(ORCA_CONFIGS_DIR, { recursive: true });
    if (!fs.existsSync(BAMBU_CONFIGS_DIR)) fs.mkdirSync(BAMBU_CONFIGS_DIR, { recursive: true });
}

/**
 * Create or validate a root-scoped runtime directory without accepting a symlink/junction root.
 * Startup uses this synchronous check once, before the server listens.
 * @param {string} directory Absolute runtime directory.
 * @param {number | undefined} mode Restrictive creation mode where supported.
 */
function ensureCanonicalRuntimeDirectory(directory, mode) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode });
    const stats = fs.lstatSync(directory);
    const canonical = fs.realpathSync(directory);
    const normalize = (value) => process.platform === 'win32'
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    if (!stats.isDirectory() || stats.isSymbolicLink() || normalize(canonical) !== normalize(directory)) {
        throw new Error('Unsafe root-scoped runtime directory.');
    }
}

module.exports = {
    APP_ROOT,
    HELP_FILES_DIR,
    JOB_WORKSPACES_DIR,
    JOB_SCRATCH_DIR,
    OUTPUT_DIR,
    CONFIGS_DIR,
    PRICING_STATE_DIR,
    PRUSA_CONFIGS_DIR,
    ORCA_CONFIGS_DIR,
    BAMBU_CONFIGS_DIR,
    PRICING_FILE,
    LEGACY_PRICING_FILE,
    ensureRequiredDirectories
};
