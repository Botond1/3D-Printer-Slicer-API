'use strict';

/**
 * The readiness config probe must treat `configs/bambu` exactly like
 * `configs/prusa` and `configs/orca`: a missing, non-directory, or symlinked
 * registry directory flips `CONFIG_UNSAFE`, and the startup directory
 * bootstrap creates it alongside the other engine directories.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const PATHS_PATH = path.join(ROOT, 'app/config/paths.js');
const READINESS_PATH = path.join(ROOT, 'app/services/readiness.service.js');

const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
test.after(() => {
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

const metrics = require('../../../app/services/observability/metrics');

function healthyQueue() {
    return { queueLength: 0, activeJobs: 0, maxConcurrent: 1, maxQueueLength: 100, acceptingJobs: true };
}

/**
 * Load a fresh readiness service bound to a temporary directory layout.
 * @param {Record<string, string>} layout Path overrides for `app/config/paths`.
 * @returns {{module: object, restore: () => void}} Module and cache restorer.
 */
function loadReadinessWithPaths(layout) {
    const originalPaths = require.cache[PATHS_PATH];
    const originalReadiness = require.cache[READINESS_PATH];
    const paths = require(PATHS_PATH);
    require.cache[PATHS_PATH] = {
        id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
        exports: { ...paths, ...layout }
    };
    delete require.cache[READINESS_PATH];
    const module = require(READINESS_PATH);
    return {
        module,
        restore() {
            if (originalPaths) require.cache[PATHS_PATH] = originalPaths;
            else delete require.cache[PATHS_PATH];
            if (originalReadiness) require.cache[READINESS_PATH] = originalReadiness;
            else delete require.cache[READINESS_PATH];
        }
    };
}

async function layoutWithoutBambu(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'b2-readiness-bambu-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const layout = {
        APP_ROOT: path.join(root, 'app'),
        CONFIGS_DIR: path.join(root, 'configs'),
        PRUSA_CONFIGS_DIR: path.join(root, 'configs', 'prusa'),
        ORCA_CONFIGS_DIR: path.join(root, 'configs', 'orca'),
        BAMBU_CONFIGS_DIR: path.join(root, 'configs', 'bambu'),
        OUTPUT_DIR: path.join(root, 'output'),
        PRICING_STATE_DIR: path.join(root, 'configs', 'pricing-state')
    };
    for (const key of ['APP_ROOT', 'CONFIGS_DIR', 'PRUSA_CONFIGS_DIR', 'ORCA_CONFIGS_DIR', 'OUTPUT_DIR', 'PRICING_STATE_DIR']) {
        await fsp.mkdir(layout[key], { recursive: true });
    }
    return { root, layout };
}

test.beforeEach(() => metrics.resetMetricsForTests());

test('readiness flips CONFIG_UNSAFE without configs/bambu and clears it once the directory exists', async (t) => {
    const { root, layout } = await layoutWithoutBambu(t);
    const { module, restore } = loadReadinessWithPaths(layout);
    t.after(restore);
    const createService = () => module.createReadinessService({
        clock: () => 1000,
        cacheMs: 0,
        getQueueStatus: healthyQueue,
        getNativeRuntimeStatus: () => ({ available: true, quarantined: false }),
        getPricing: () => ({ FDM: { PLA: 1 }, SLA: { RESIN: 1 } }),
        production: false
    });

    const missing = createService().getStatus();
    assert.equal(missing.ready, false);
    assert.deepEqual(missing.reasonCodes, ['CONFIG_UNSAFE']);

    await fsp.mkdir(layout.BAMBU_CONFIGS_DIR);
    const healthy = createService().getStatus();
    assert.equal(healthy.ready, true);
    assert.deepEqual(healthy.reasonCodes, []);

    // A regular file where the registry directory should be is unsafe too.
    await fsp.rm(layout.BAMBU_CONFIGS_DIR, { recursive: true, force: true });
    await fsp.writeFile(layout.BAMBU_CONFIGS_DIR, 'not a directory');
    assert.deepEqual(createService().getStatus().reasonCodes, ['CONFIG_UNSAFE']);
    await fsp.rm(layout.BAMBU_CONFIGS_DIR, { force: true });

    // A symlinked registry directory is rejected like the Prusa/Orca directories.
    const outside = path.join(root, 'outside-bambu');
    await fsp.mkdir(outside);
    try {
        await fsp.symlink(outside, layout.BAMBU_CONFIGS_DIR, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
        return;
    }
    assert.deepEqual(createService().getStatus().reasonCodes, ['CONFIG_UNSAFE']);
});

test('paths and readiness sources bind configs/bambu exactly like the other engine directories', () => {
    const paths = require(PATHS_PATH);
    assert.equal(paths.BAMBU_CONFIGS_DIR, path.join(paths.CONFIGS_DIR, 'bambu'));
    assert.equal(paths.PRUSA_CONFIGS_DIR, path.join(paths.CONFIGS_DIR, 'prusa'));
    assert.equal(paths.ORCA_CONFIGS_DIR, path.join(paths.CONFIGS_DIR, 'orca'));
    const pathsSource = fs.readFileSync(PATHS_PATH, 'utf8');
    assert.match(pathsSource, /if \(!fs\.existsSync\(BAMBU_CONFIGS_DIR\)\) fs\.mkdirSync\(BAMBU_CONFIGS_DIR, \{ recursive: true \}\);/);
    const readinessSource = fs.readFileSync(READINESS_PATH, 'utf8');
    for (const directory of ['PRUSA_CONFIGS_DIR', 'ORCA_CONFIGS_DIR', 'BAMBU_CONFIGS_DIR']) {
        assert.match(readinessSource, new RegExp(`&& directoryHealthy\\(${directory}\\)`), directory);
        assert.match(readinessSource, new RegExp(`&& directoryImmutable\\(${directory}, enforceImmutable\\)`), directory);
    }
    // The repository ships the Bambu printer registry in that directory.
    assert.ok(fs.existsSync(path.join(ROOT, 'configs', 'bambu', 'printers.json')));
});
