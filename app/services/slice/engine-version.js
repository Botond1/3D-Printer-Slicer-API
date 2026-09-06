'use strict';

/** Bounded, cached resolution of the actual native slicer binary version. */

const { createStartupProbeRunner } = require('./command');
const { resolveSlicerExecutable } = require('./engine');

const VERSION_TIMEOUT_MS = 10_000;
const MAX_VERSION_OUTPUT_BYTES = 8_192;
const versionRunner = createStartupProbeRunner({
    timeoutMs: VERSION_TIMEOUT_MS,
    maxBuffer: MAX_VERSION_OUTPUT_BYTES
});
const versionCache = new Map();
const initializedVersions = new Map();

const SUPPORTED_ENGINES = Object.freeze(['prusa', 'orca', 'bambu']);
const VERSION_QUERY_ARGS = Object.freeze({
    prusa: Object.freeze(['--help']),
    orca: Object.freeze(['--help']),
    bambu: Object.freeze(['--help'])
});

const VERSION_PATTERNS = Object.freeze({
    prusa: /PrusaSlicer(?:-|\s+(?:Version\s+)?)([0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9._-]+)?)/i,
    orca: /OrcaSlicer(?:-|\s+(?:Version\s+)?)([0-9]+(?:\.[0-9]+){2,3}(?:[-+][A-Za-z0-9._-]+)?)/i,
    bambu: /BambuStudio(?:-|\s+(?:Version\s+)?)([0-9]+(?:\.[0-9]+){2,3})/i
});
const HELP_SENTINELS = Object.freeze({
    prusa: /Usage:\s+prusa-slicer[\s\S]*--help/i,
    orca: /Usage:\s+orca-slicer[\s\S]*OPTIONS:[\s\S]*--help/i,
    bambu: /Usage:\s+bambu-studio[\s\S]*OPTIONS:[\s\S]*--help/i
});

function parseEngineVersionOutput(engine, result) {
    const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
    if (Buffer.byteLength(output, 'utf8') > MAX_VERSION_OUTPUT_BYTES) {
        throw new Error('Slicer engine version output exceeds the bounded envelope.');
    }
    const pattern = VERSION_PATTERNS[engine];
    if (!pattern || !HELP_SENTINELS[engine]?.test(output)) {
        throw new Error('Slicer engine version could not be verified from native output.');
    }
    const versions = new Set(
        [...output.matchAll(new RegExp(pattern.source, 'gi'))].map((match) => match[1])
    );
    if (versions.size !== 1) {
        throw new Error('Slicer engine version could not be verified from native output.');
    }
    const [version] = versions;
    if (version.length > 64) {
        throw new Error('Slicer engine version could not be verified from native output.');
    }
    return version;
}

function queryEngineVersion(engine, runner) {
    const args = VERSION_QUERY_ARGS[engine];
    if (!args) {
        return Promise.reject(new Error('Unsupported slicer engine for version resolution.'));
    }
    if (process.platform === 'win32' && engine === 'bambu' && runner === versionRunner) {
        // The vendor GUI launcher reopens CONOUT$, discarding redirected help.
        // Read OS VERSIONINFO from that executable; every Bambu success also
        // requires the native G-code build header to match this startup value.
        const { PYTHON_EXECUTABLE } = require('../../config/python');
        const path = require('node:path');
        return runner(PYTHON_EXECUTABLE, [path.join(__dirname, '../../engine_version_windows.py'),
            resolveSlicerExecutable(engine)]).then(({ stdout }) => {
            const data = JSON.parse(stdout);
            if (data.source !== 'windows_versioninfo' || !/^[0-9]+(?:\.[0-9]+){2,3}$/.test(data.version)) {
                throw new Error('Native executable version is invalid.');
            }
            return data.version;
        });
    }
    return runner(resolveSlicerExecutable(engine), [...args])
        .then((result) => parseEngineVersionOutput(engine, result));
}

/**
 * Resolve and cache the version emitted by the actual native binary.
 * Rejections are evicted so a transient startup/runtime error cannot poison the
 * process for all later requests.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {{runner?: Function, cache?: Map<string, Promise<string>>}} [options] Test seams.
 * @returns {Promise<string>} Verified native engine version.
 */
function resolveSlicerEngineVersion(engine, options = {}) {
    const runner = options.runner || versionRunner;
    const cache = options.cache || versionCache;
    if (cache.has(engine)) return cache.get(engine);

    const pending = queryEngineVersion(engine, runner).catch((error) => {
        if (cache.get(engine) === pending) cache.delete(engine);
        throw error;
    });
    cache.set(engine, pending);
    return pending;
}

/**
 * Verify all three supported binaries before the HTTP listener can accept traffic.
 * The published map changes only after every native query has succeeded.
 * @param {{runner?: Function, cache?: Map, initialized?: Map}} [options] Test seams.
 * @returns {Promise<Readonly<{prusa: string, orca: string, bambu: string}>>} Atomic version snapshot.
 */
async function initializeSlicerEngineVersions(options = {}) {
    const cache = options.cache || versionCache;
    const initialized = options.initialized || initializedVersions;
    const versions = {};
    try {
        for (const engine of SUPPORTED_ENGINES) {
            try {
                versions[engine] = await resolveSlicerEngineVersion(engine, { runner: options.runner, cache });
            } catch (error) {
                if (!options.requiredEngines || options.requiredEngines.includes(engine)) throw error;
                versions[engine] = null;
            }
        }
    } catch (cause) {
        const error = new Error('Slicer engine startup version verification failed.', { cause });
        error.code = 'STARTUP_SLICER_VERSION_FAILED';
        throw error;
    }
    for (const engine of SUPPORTED_ENGINES) {
        if (versions[engine]) initialized.set(engine, versions[engine]);
        else initialized.delete(engine);
    }
    return Object.freeze({ ...versions });
}

/**
 * Read the startup-verified version without launching a request-owned process.
 * @param {'prusa'|'orca'|'bambu'} engine Slicer engine key.
 * @param {{initialized?: Map}} [options] Test seam.
 * @returns {string} Startup-verified native version.
 */
function getSlicerEngineVersion(engine, options = {}) {
    const initialized = options.initialized || initializedVersions;
    const version = initialized.get(engine);
    if (typeof version !== 'string') {
        throw new Error('Slicer engine versions were not verified during startup.');
    }
    return version;
}

module.exports = {
    MAX_VERSION_OUTPUT_BYTES,
    SUPPORTED_ENGINES,
    VERSION_QUERY_ARGS,
    VERSION_TIMEOUT_MS,
    getSlicerEngineVersion,
    initializeSlicerEngineVersions,
    parseEngineVersionOutput,
    resolveSlicerEngineVersion
};
