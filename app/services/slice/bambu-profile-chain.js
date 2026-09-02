'use strict';

/**
 * Fail-closed flattening of the official Bambu Studio vendor profile chain.
 *
 * Bambu Studio ships its `BBL` vendor bundle as JSON files under
 * `<root>/{machine,process,filament}/<name>.json`. A file may name a parent in
 * the same role directory through `inherits`, and Bambu Studio 2.8 additionally
 * merges sibling template files listed in `include` (used for the H2D start and
 * end G-code templates). The effective profile is:
 *
 *     flatten(parent chain)  <-  include templates in order  <-  the file's own keys
 *
 * with `inherits` and `include` removed from the result. Names are validated
 * before any path is built, every read stays inside the role directory, is
 * bounded, and refuses cycles, wrong roles, name mismatches, and depth abuse.
 */

const path = require('node:path');
const { BAMBU_DEFAULT_PROFILES_ROOT } = require('../../config/constants');
const { readProfileJson } = require('./profile-readers');
const {
    BAMBU_PROFILE_NAME_PATTERN,
    getBambuPrinterRegistry,
    listBambuRegistryProfileReferences
} = require('./bambu-printer-registry');

const BAMBU_PROFILE_ROLES = Object.freeze(['machine', 'process', 'filament']);
const BAMBU_PROFILE_CHAIN_ERROR_CODE = 'STARTUP_BAMBU_PROFILE_CHAIN_FAILED';
const MAX_INHERITANCE_DEPTH = 8;
const MAX_INCLUDES = 16;
const STRUCTURAL_KEYS = Object.freeze(['inherits', 'include']);

/**
 * Resolve the vendor profile root, honouring `BAMBU_PROFILES_ROOT`.
 * @param {NodeJS.ProcessEnv|Record<string, unknown>} [env=process.env] Environment source.
 * @returns {string} Absolute root directory.
 */
function resolveBambuProfilesRoot(env = process.env) {
    const configured = String(env.BAMBU_PROFILES_ROOT || '').trim();
    if (!configured) return BAMBU_DEFAULT_PROFILES_ROOT;
    if (!path.isAbsolute(configured) || configured.includes('\0')) {
        throw new Error('BAMBU_PROFILES_ROOT must be an absolute path.');
    }
    return path.resolve(configured);
}

function assertRole(role) {
    if (!BAMBU_PROFILE_ROLES.includes(role)) {
        throw new Error('Unsupported Bambu profile role.');
    }
    return role;
}

function assertProfileName(name, label) {
    if (typeof name !== 'string' || !BAMBU_PROFILE_NAME_PATTERN.test(name) || name.trim() !== name) {
        throw new Error(`Bambu ${label} name is invalid.`);
    }
    return name;
}

/**
 * Build the contained file path for one role/name pair.
 * @param {'machine'|'process'|'filament'} role Profile role.
 * @param {string} name Vendor profile name.
 * @param {string} root Absolute profile root.
 * @returns {string} Absolute path inside `<root>/<role>/`.
 */
function resolveBambuProfilePath(role, name, root) {
    assertRole(role);
    assertProfileName(name, role);
    const roleDirectory = path.resolve(root, role);
    const fileName = `${name}.json`;
    const candidate = path.resolve(roleDirectory, fileName);
    const relative = path.relative(roleDirectory, candidate);
    if (
        relative !== fileName
        || relative.includes(path.sep)
        || relative.startsWith('..')
        || path.isAbsolute(relative)
    ) {
        throw new Error('Bambu profile path escaped its role directory.');
    }
    return candidate;
}

function assertProfileObject(value, role, expectedName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Bambu profile must be a JSON object.');
    }
    if (value.type !== role) {
        throw new Error('Bambu profile type does not match its role.');
    }
    if (value.name !== expectedName) {
        throw new Error('Bambu profile name does not match its file.');
    }
    return value;
}

function readIncludeTemplate(role, includeName, root) {
    const template = readProfileJson(resolveBambuProfilePath(role, includeName, root));
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
        throw new Error('Bambu include template must be a JSON object.');
    }
    if (Object.hasOwn(template, 'type') && template.type !== role) {
        throw new Error('Bambu include template role does not match.');
    }
    if (Object.hasOwn(template, 'name') && template.name !== includeName) {
        throw new Error('Bambu include template name does not match its file.');
    }
    if (Object.hasOwn(template, 'inherits') || Object.hasOwn(template, 'include')) {
        throw new Error('Bambu include templates cannot inherit or include.');
    }
    const merged = { ...template };
    delete merged.type;
    delete merged.name;
    return merged;
}

function flattenIncludes(profile, role, root) {
    if (!Object.hasOwn(profile, 'include')) return {};
    const includes = profile.include;
    if (!Array.isArray(includes) || includes.length > MAX_INCLUDES) {
        throw new Error('Bambu profile include list is invalid.');
    }
    let merged = {};
    for (const includeName of includes) {
        assertProfileName(includeName, `${role} include`);
        merged = { ...merged, ...readIncludeTemplate(role, includeName, root) };
    }
    return merged;
}

function flattenFile(role, name, state) {
    if (state.depth >= MAX_INHERITANCE_DEPTH) {
        throw new Error('Bambu profile inheritance exceeds the supported depth.');
    }
    if (state.visited.has(name)) {
        throw new Error('Bambu profile inheritance contains a cycle.');
    }
    state.visited.add(name);
    const profile = assertProfileObject(
        readProfileJson(resolveBambuProfilePath(role, name, state.root)),
        role,
        name
    );
    let parent = {};
    if (Object.hasOwn(profile, 'inherits') && profile.inherits !== '') {
        assertProfileName(profile.inherits, `${role} parent`);
        parent = flattenFile(role, profile.inherits, { ...state, depth: state.depth + 1 });
    }
    const includes = flattenIncludes(profile, role, state.root);
    state.visited.delete(name);
    const resolved = { ...parent, ...includes, ...profile };
    for (const key of STRUCTURAL_KEYS) delete resolved[key];
    return resolved;
}

/**
 * Flatten one vendor profile into the effective key set Bambu Studio applies.
 * @param {'machine'|'process'|'filament'} role Profile role.
 * @param {string} name Vendor profile name (the file basename without `.json`).
 * @param {{root?: string, env?: object}} [options] Root override or environment seam.
 * @returns {Record<string, unknown>} Fully flattened profile without `inherits`/`include`.
 */
function flattenBambuProfile(role, name, options = {}) {
    assertRole(role);
    assertProfileName(name, role);
    const root = options.root ? path.resolve(options.root) : resolveBambuProfilesRoot(options.env);
    const flattened = flattenFile(role, name, { depth: 0, visited: new Set(), root });
    if (flattened.name !== name || flattened.type !== role) {
        throw new Error('Bambu profile identity was lost during flattening.');
    }
    return flattened;
}

/**
 * Prove at startup that every registry-referenced vendor profile flattens.
 * @param {{registry?: object, root?: string, env?: object}} [options] Seams.
 * @returns {Readonly<{root: string, verified: number}>} Verification summary.
 */
function verifyBambuRegistryChains(options = {}) {
    const registry = options.registry || getBambuPrinterRegistry();
    const root = options.root ? path.resolve(options.root) : resolveBambuProfilesRoot(options.env);
    const references = listBambuRegistryProfileReferences(registry);
    for (const reference of references) {
        try {
            flattenBambuProfile(reference.role, reference.name, { root });
        } catch (cause) {
            const error = new Error(
                `Bambu ${reference.role} profile "${reference.name}" could not be flattened.`,
                { cause }
            );
            error.code = BAMBU_PROFILE_CHAIN_ERROR_CODE;
            throw error;
        }
    }
    return Object.freeze({ root, verified: references.length });
}

module.exports = {
    BAMBU_PROFILE_CHAIN_ERROR_CODE,
    BAMBU_PROFILE_ROLES,
    MAX_INHERITANCE_DEPTH,
    flattenBambuProfile,
    resolveBambuProfilePath,
    resolveBambuProfilesRoot,
    verifyBambuRegistryChains
};
