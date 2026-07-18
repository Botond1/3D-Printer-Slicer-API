const Module = require('node:module');
const path = require('node:path');

/**
 * Compile a CommonJS module from an in-memory source variant while preserving
 * the original filename for relative dependency resolution.
 *
 * This helper intentionally does not populate require.cache or write a
 * temporary production copy. It is used only by controlled mutation tests.
 *
 * @param {string} filename Absolute filename whose module context is emulated.
 * @param {string} source CommonJS source to compile.
 * @returns {unknown} Compiled module exports.
 */
function loadCommonJsFromSource(filename, source) {
    const testModule = new Module(filename, module);
    testModule.filename = filename;
    testModule.paths = Module._nodeModulePaths(path.dirname(filename));
    testModule._compile(source, filename);
    return testModule.exports;
}

module.exports = {
    loadCommonJsFromSource
};
