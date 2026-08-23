/** Minimal environment supplied to converter and slicer child processes. */

const path = require('node:path');

const POSIX_KEYS = Object.freeze([
    'PATH',
    'LANG',
    'LC_ALL',
    'LC_CTYPE'
]);
const WINDOWS_KEYS = Object.freeze([
    'PATH',
    'SystemRoot',
    'WINDIR',
    'PATHEXT',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE'
]);
const SAFE_PYTHON_ENV = Object.freeze({
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1'
});

function readEnvironmentValue(source, key, platform) {
    if (source[key] !== undefined) return source[key];
    if (platform !== 'win32') return undefined;
    const actualKey = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return actualKey ? source[actualKey] : undefined;
}

/**
 * Build a platform-aware environment without application configuration or secrets.
 * @param {NodeJS.ProcessEnv} [source=process.env] Parent environment.
 * @param {NodeJS.Platform} [platform=process.platform] Active platform.
 * @returns {Record<string, string>} Minimal child environment.
 */
function createChildEnvironment(source = process.env, platform = process.platform) {
    const environment = {};
    const keys = platform === 'win32' ? WINDOWS_KEYS : POSIX_KEYS;
    for (const key of keys) {
        const value = readEnvironmentValue(source, key, platform);
        if (value !== undefined && value !== '') environment[key] = String(value);
    }
    if (platform !== 'win32') {
        const configuredTmp = String(source.TMPDIR || '');
        const trustedTmp = configuredTmp === '/tmp' ? configuredTmp : '/tmp';
        Object.assign(environment, {
            TMPDIR: trustedTmp,
            TEMP: trustedTmp,
            TMP: trustedTmp,
            HOME: path.posix.join(trustedTmp, 'slicer-home'),
            XDG_CACHE_HOME: path.posix.join(trustedTmp, 'xdg-cache'),
            XDG_CONFIG_HOME: path.posix.join(trustedTmp, 'xdg-config'),
            XDG_RUNTIME_DIR: path.posix.join(trustedTmp, 'xdg-runtime')
        });
    }
    return { ...environment, ...SAFE_PYTHON_ENV };
}

module.exports = {
    createChildEnvironment,
    SAFE_PYTHON_ENV
};
