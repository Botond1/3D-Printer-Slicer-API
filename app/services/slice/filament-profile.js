'use strict';

/** Orca filament-profile selection and exact used-property extraction. */

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

function readSinglePositiveSetting(profile, key) {
    const values = profile[key];
    if (!Array.isArray(values) || values.length !== 1) {
        throw new Error(`Orca filament ${key} must contain exactly one value.`);
    }
    const raw = String(values[0]).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
        throw new Error(`Orca filament ${key} must be a canonical decimal.`);
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Orca filament ${key} must be positive.`);
    }
    return parsed;
}

/**
 * Read the diameter and density from the exact profile snapshot passed to Orca.
 * @returns {{diameterMm:number,densityGcm3:number}|null} Null only when no profile was selected.
 */
function readOrcaFilamentProfileMetadata(profilePath, material) {
    if (profilePath === null || profilePath === undefined) return null;
    const profile = readProfileJson(profilePath);
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || profile.type !== 'filament') {
        throw new Error('Selected Orca filament profile has an invalid role.');
    }
    const expectedMaterial = normalizeMaterial(material);
    const filamentTypes = Array.isArray(profile.filament_type)
        ? profile.filament_type.map(normalizeMaterial)
        : [];
    if (!expectedMaterial || filamentTypes.length !== 1 || filamentTypes[0] !== expectedMaterial) {
        throw new Error('Selected Orca filament profile does not match the requested material.');
    }
    return Object.freeze({
        diameterMm: readSinglePositiveSetting(profile, 'filament_diameter'),
        densityGcm3: readSinglePositiveSetting(profile, 'filament_density')
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
    readOrcaFilamentProfileMetadata,
    resolveMaterialFilamentMetadata,
    resolveOrcaFilamentConfigPath
};
