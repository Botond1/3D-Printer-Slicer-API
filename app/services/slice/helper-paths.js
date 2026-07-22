/** Module-anchored absolute paths for the four Python processing helpers. */

const path = require('node:path');

const APPLICATION_ROOT = path.resolve(__dirname, '..', '..');
const HELPER_NAMES = new Set(['mesh2stl.py', 'cad2stl.py', 'orient.py', 'scale_model.py']);

/**
 * Resolve an approved helper in both local `app/` and flattened `/app` layouts.
 * @param {string} helperName Approved helper basename.
 * @returns {string} Absolute module-anchored helper path.
 */
function resolvePythonHelper(helperName) {
    if (!HELPER_NAMES.has(helperName)) throw new Error('Unknown Python processing helper.');
    return path.join(APPLICATION_ROOT, helperName);
}

module.exports = {
    APPLICATION_ROOT,
    resolvePythonHelper
};
