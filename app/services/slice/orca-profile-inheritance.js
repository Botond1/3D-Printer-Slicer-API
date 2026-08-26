'use strict';

/** Fail-closed resolution of the exact Orca parent presets used by this API. */

const path = require('node:path');
const { ORCA_CONFIGS_DIR } = require('../../config/paths');
const { readProfileJson } = require('./profile-readers');

const REPOSITORY_CUSTOM_ROOT = path.join(ORCA_CONFIGS_DIR, 'upstream', 'Custom');
const DEFAULT_CUSTOM_ROOT = REPOSITORY_CUSTOM_ROOT;

const DEFAULT_PARENT_FILES = Object.freeze({
    machine: Object.freeze({
        fdm_machine_common: path.join(
            DEFAULT_CUSTOM_ROOT,
            'machine',
            'fdm_machine_common.json'
        )
    }),
    process: Object.freeze({
        fdm_process_common: path.join(
            DEFAULT_CUSTOM_ROOT,
            'process',
            'fdm_process_common.json'
        ),
        fdm_process_marlin_common: path.join(
            DEFAULT_CUSTOM_ROOT,
            'process',
            'fdm_process_marlin_common.json'
        )
    })
});

const MAX_INHERITANCE_DEPTH = 8;

function assertProfileObject(value, expectedType) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Orca profile must be a JSON object.');
    }
    if (value.type !== expectedType) {
        throw new Error('Orca profile type does not match its selected role.');
    }
    return value;
}

function resolveParentPath(parentName, profileType, parentFiles) {
    if (typeof parentName !== 'string' || !/^[A-Za-z0-9_. @+-]{1,128}$/.test(parentName)) {
        throw new Error('Orca profile inheritance name is invalid.');
    }
    const candidate = parentFiles?.[profileType]?.[parentName];
    if (typeof candidate !== 'string' || !candidate) {
        throw new Error(`Unsupported Orca ${profileType} parent profile.`);
    }
    return candidate;
}

function resolveProfileFile(profilePath, profileType, state) {
    if (state.depth >= MAX_INHERITANCE_DEPTH) {
        throw new Error('Orca profile inheritance exceeds the supported depth.');
    }
    const profile = assertProfileObject(readProfileJson(profilePath), profileType);
    if (state.expectedName !== null && profile.name !== state.expectedName) {
        throw new Error('Orca parent profile name does not match its inheritance key.');
    }
    if (!Object.hasOwn(profile, 'inherits') || profile.inherits === '') {
        const resolved = { ...profile };
        delete resolved.inherits;
        return resolved;
    }

    const parentName = profile.inherits;
    if (state.visited.has(parentName)) {
        throw new Error('Orca profile inheritance contains a cycle.');
    }
    state.visited.add(parentName);
    const parentPath = resolveParentPath(parentName, profileType, state.parentFiles);
    const parent = resolveProfileFile(parentPath, profileType, {
        ...state,
        depth: state.depth + 1,
        expectedName: parentName
    });
    state.visited.delete(parentName);

    const resolved = { ...parent, ...profile };
    delete resolved.inherits;
    return resolved;
}

/**
 * Resolve one selected Orca profile to the shallow override semantics used by
 * the bundled Custom parent chain, removing `inherits` before native use.
 * @param {string} profilePath Selected child profile path.
 * @param {'machine'|'process'} profileType Selected profile role.
 * @param {{parentFiles?: Record<string, Record<string, string>>}} [options] Test seam.
 * @returns {Record<string, unknown>} Fully resolved profile object.
 */
function resolveOrcaProfileInheritance(profilePath, profileType, options = {}) {
    if (profileType !== 'machine' && profileType !== 'process') {
        throw new Error('Unsupported Orca profile role.');
    }
    return resolveProfileFile(profilePath, profileType, {
        depth: 0,
        expectedName: null,
        visited: new Set(),
        parentFiles: options.parentFiles || DEFAULT_PARENT_FILES
    });
}

module.exports = {
    DEFAULT_PARENT_FILES,
    DEFAULT_CUSTOM_ROOT,
    MAX_INHERITANCE_DEPTH,
    resolveOrcaProfileInheritance
};
