'use strict';

/** Orca/Bambu filament-profile selection and exact used-property extraction. */

const fs = require('node:fs');
const path = require('node:path');
const { ORCA_FILAMENT_PROFILE_BY_MATERIAL } = require('../../config/constants');
const { ORCA_CONFIGS_DIR } = require('../../config/paths');
const { readProfileJson } = require('./profile-readers');

function normalizeMaterial(material) {
    return String(material || '').trim().toUpperCase();
}

/**
 * Resolve the repository filament profile for one Orca material.
 * An unmapped or absent profile returns null deliberately; callers expose that
 * state and the effective digest binds it so pricing can remain manual.
 */
function resolveOrcaFilamentConfigPath(material, profileOverrides = {}) {
    const requested = String(profileOverrides.orcaFilamentProfile || '').trim();
    const mapped = ORCA_FILAMENT_PROFILE_BY_MATERIAL[normalizeMaterial(material)];
    const profileName = requested || mapped;
    if (!profileName) return null;
    if (path.basename(profileName) !== profileName || path.extname(profileName).toLowerCase() !== '.json') {
        return null;
    }
    const candidate = path.join(ORCA_CONFIGS_DIR, 'filament', profileName);
    return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Read one positive numeric filament setting from its per-extruder array.
 * Orca repository profiles must carry exactly one value. Bambu vendor profiles
 * for dual-nozzle machines (H2D) carry one entry per extruder, so identical
 * repeated entries are accepted only when `allowIdenticalEntries` is set;
 * differing entries are ambiguous and always fail closed.
 */
function readSinglePositiveSetting(profile, key, options = {}) {
    const values = profile[key];
    const label = options.label || 'Orca';
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`${label} filament ${key} must contain exactly one value.`);
    }
    const distinct = new Set(values.map((value) => String(value).trim()));
    if (distinct.size !== 1 || (values.length !== 1 && options.allowIdenticalEntries !== true)) {
        throw new Error(`${label} filament ${key} must contain exactly one value.`);
    }
    const [raw] = distinct;
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
        throw new Error(`${label} filament ${key} must be a canonical decimal.`);
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} filament ${key} must be positive.`);
    }
    return parsed;
}

function readFilamentProfileMetadata(profilePath, material, options) {
    if (profilePath === null || profilePath === undefined) return null;
    const label = options.label;
    const profile = readProfileJson(profilePath);
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || profile.type !== 'filament') {
        throw new Error(`Selected ${label} filament profile has an invalid role.`);
    }
    const expectedMaterial = normalizeMaterial(material);
    const filamentTypes = Array.isArray(profile.filament_type)
        ? [...new Set(profile.filament_type.map(normalizeMaterial))]
        : [];
    const typeCountValid = Array.isArray(profile.filament_type)
        && (profile.filament_type.length === 1 || options.allowIdenticalEntries === true);
    if (!expectedMaterial || !typeCountValid || filamentTypes.length !== 1 || filamentTypes[0] !== expectedMaterial) {
        throw new Error(`Selected ${label} filament profile does not match the requested material.`);
    }
    return Object.freeze({
        diameterMm: readSinglePositiveSetting(profile, 'filament_diameter', options),
        densityGcm3: readSinglePositiveSetting(profile, 'filament_density', options)
    });
}

/**
 * Read the diameter and density from the exact profile snapshot passed to Orca.
 * @returns {{diameterMm:number,densityGcm3:number}|null} Null only when no profile was selected.
 */
function readOrcaFilamentProfileMetadata(profilePath, material) {
    return readFilamentProfileMetadata(profilePath, material, {
        label: 'Orca',
        allowIdenticalEntries: false
    });
}

/**
 * Read the diameter and density from the flattened Bambu filament snapshot.
 * Dual-extruder vendor profiles repeat identical per-extruder values; those
 * are accepted, while differing entries still fail closed.
 * @param {string|null} profilePath Flattened filament snapshot path.
 * @param {string} material Requested material key.
 * @returns {{diameterMm:number,densityGcm3:number}|null} Null only when no profile was selected.
 */
function readBambuFilamentProfileMetadata(profilePath, material) {
    return readFilamentProfileMetadata(profilePath, material, {
        label: 'Bambu',
        allowIdenticalEntries: true
    });
}

/**
 * Resolve diameter and density for one material, independently of the engine.
 *
 * The per-material files live under the Orca configs directory because Orca is
 * the engine that consumes them directly, but their contents are the material
 * catalogue for the whole service. PrusaSlicer has no per-material profile of
 * its own and cannot report mass without a density, so it reads the same source
 * rather than carrying a second copy that could drift.
 *
 * @param {string} material Requested material key.
 * @param {{orcaFilamentProfile?: string | null}} [profileOverrides] Profile overrides.
 * @returns {{diameterMm:number,densityGcm3:number}|null} Null when the material has no catalogue entry.
 */
function resolveMaterialFilamentMetadata(material, profileOverrides = {}) {
    const profilePath = resolveOrcaFilamentConfigPath(material, profileOverrides);
    if (profilePath === null) return null;
    return readOrcaFilamentProfileMetadata(profilePath, material);
}

module.exports = {
    normalizeMaterial,
    readBambuFilamentProfileMetadata,
    readOrcaFilamentProfileMetadata,
    resolveMaterialFilamentMetadata,
    resolveOrcaFilamentConfigPath
};
