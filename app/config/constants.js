/**
 * Shared runtime constants for slicing limits, supported extensions, and API port.
 */

/**
 * Shared numeric/string defaults for environment-backed runtime behavior.
 */
const DEFAULTS = {
    PORT: 3000,
    JSON_BODY_LIMIT: '1mb',
    FORM_BODY_LIMIT: '1mb',
    MAX_UPLOAD_BYTES: 500 * 1024 * 1024,
    HTTP_HEADERS_TIMEOUT_MS: 60_000,
    HTTP_REQUEST_TIMEOUT_MS: 600_000,
    HTTP_KEEP_ALIVE_TIMEOUT_MS: 5_000,
    HTTP_MAX_HEADERS_COUNT: 2_000,
    HTTP_MAX_CONNECTIONS: 128,
    HTTP_MAX_REQUESTS_PER_SOCKET: 100,
    WORKSPACE_STALE_AGE_MS: 24 * 60 * 60 * 1000,
    MAX_LOG_OUTPUT: 4000,
    SLICE_COMMAND_TIMEOUT_MS: 600000,
    SLICE_TIMEOUT_MINUTES: 10,
    SLICE_RATE_LIMIT_WINDOW_MS: 60_000,
    SLICE_RATE_LIMIT_MAX_REQUESTS: 3,
    SLICE_RATE_LIMIT_BURST_CAPACITY: 5,
    ADMIN_RATE_LIMIT_WINDOW_MS: 60_000,
    ADMIN_RATE_LIMIT_MAX_REQUESTS: 30,
    MAX_SLICE_QUEUE_LENGTH: 100,
    MAX_SLICE_QUEUE_PER_IP: 5,
    MAX_SLICE_QUEUE_WAIT_MS: 300000,
    MAX_CONCURRENT_SLICES: 1,
    MAX_ZIP_ENTRIES: 500,
    MAX_ZIP_UNCOMPRESSED_BYTES: 500 * 1024 * 1024,
    MAX_OUTPUT_BYTES: 500 * 1024 * 1024,
    UPLOAD_TOTAL_TIMEOUT_MS: 600_000,
    DEFAULT_LAYER_HEIGHT: 0.2,
    DEFAULT_INFIL_PERCENT: 20,
    DEFAULT_FDM_MATERIAL: 'PLA',
    DEFAULT_SLA_MATERIAL: 'Standard',
    SLA_MIN_LAYER_HEIGHT_MM: 0.025,
    SLA_BASE_TIME_SECONDS: 120,
    SLA_SECONDS_PER_LAYER: 11,
    ORCA_DEFAULT_MACHINE_PROFILE: 'Bambu_P1S_0.4_nozzle.json'
};

/** Inclusive application safety range for parallel native slicer processes. */
const MAX_CONCURRENT_SLICES_RANGE = Object.freeze({ min: 1, max: 3 });

/**
 * Layer-height presets by engine/technology.
 */
const LAYER_HEIGHTS = {
    PRUSA: [0.025, 0.05, 0.1, 0.2, 0.3],
    ORCA: [0.1, 0.2, 0.3],
    BY_TECHNOLOGY: {
        SLA: [0.025, 0.05],
        FDM: [0.1, 0.2, 0.3]
    }
};

/**
 * Orca default process-profile mapping by layer height.
 * Keys are normalized to one decimal place.
 */
const ORCA_PROCESS_PROFILE_BY_LAYER = {
    '0.1': 'FDM_0.1mm.json',
    '0.2': 'FDM_0.2mm.json',
    '0.3': 'FDM_0.3mm.json'
};

/** Orca filament profiles selected by normalized FDM material key. */
const ORCA_FILAMENT_PROFILE_BY_MATERIAL = Object.freeze({
    PLA: 'PLA_generic.json',
    PETG: 'PETG_generic.json',
    ABS: 'ABS_generic.json',
    TPU: 'TPU_generic.json'
});

/**
 * Bambu Studio vendor-profile resources bundled inside the AppImage.
 * Overridable through `BAMBU_PROFILES_ROOT` for tests and alternative layouts.
 */
const BAMBU_DEFAULT_PROFILES_ROOT = '/opt/bambustudio/resources/profiles/BBL';

/**
 * Default fallback pricing matrix in HUF/hour.
 * @type {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
const DEFAULT_PRICING = {
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400 }
};

/**
 * Largest supported build envelopes in millimeters by technology.
 * Shipped printer profiles must override these values with their exact machine
 * metadata; the fallback must never silently be narrower than a supported
 * machine because that would reject printable customer models.
 * @type {{FDM: {x: number, y: number, z: number}, SLA: {x: number, y: number, z: number}}}
 */
const MAX_BUILD_VOLUMES = {
    FDM: { x: 350, y: 320, z: 325 },
    SLA: { x: 120, y: 120, z: 150 }
};

/**
 * Owner-accepted P1S validation ceilings. These values are admission-only and
 * never rewrite the physical dimensions stored in the slicer profile.
 */
const P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM = Object.freeze({
    prusa: Object.freeze({
        'FDM_0.1mm.ini': Object.freeze({ x: 256, y: 256, z: 249.9 }),
        'FDM_0.2mm.ini': Object.freeze({ x: 256, y: 256, z: 249.9 }),
        'FDM_0.3mm.ini': Object.freeze({ x: 256, y: 256, z: 249.9 })
    }),
    orca: Object.freeze({
        'Bambu_P1S_0.4_nozzle.json': Object.freeze({ x: 253.9, y: 253.9, z: 249.9 })
    })
});

/**
 * Exact-image measured H2D-sized quote ceilings, inclusive on every axis.
 *
 * The A measurement sweep reproduced every largest PASS and next 0.1 mm
 * rejection twice on both engines, plus each combined X/Y corner. Prusa's
 * planar values reach the declared profile boundary; its native edge beyond
 * that physical declaration remains unestablished. The single Z value is the
 * strictest ceiling across all offered layer heights.
 */
const H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM =
Object.freeze({
    prusa: Object.freeze({
        'FDM_P1S_H2D_SIZE_QUOTING_0.1mm.ini': Object.freeze({ x: 350, y: 320, z: 324.9 }),
        'FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini': Object.freeze({ x: 350, y: 320, z: 324.9 }),
        'FDM_P1S_H2D_SIZE_QUOTING_0.3mm.ini': Object.freeze({ x: 350, y: 320, z: 324.9 })
    }),
    orca: Object.freeze({
        'Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json': Object.freeze({
            x: 347.9,
            y: 317.9,
            z: 324.9
        })
    })
});

/**
 * PROVISIONAL Bambu Studio admission ceilings, inclusive on every axis and keyed
 * by the vendor machine profile name.
 *
 * These values are NOT yet the result of a full A/B envelope sweep on the
 * production image. They come from two orchestrator spot checks on the VPS:
 * a 238 x 228 mm plate passed on the P1S while 250 x 250 mm was rejected because
 * of the 18 x 28 mm `bed_exclude_area` corner, and the H2D-sized values reuse
 * the Orca-measured planar margin. The orchestrator will replace this table
 * after the sweep; treat it as a conservative placeholder, never as measured
 * proof.
 */
const BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM = Object.freeze({
    'Bambu Lab P1S 0.4 nozzle': Object.freeze({ x: 236, y: 226, z: 249.9 }),
    'Bambu Lab H2D 0.4 nozzle': Object.freeze({ x: 347.9, y: 317.9, z: 324.9 })
});

/**
 * Validation-only fallback derates for non-catalogued FDM profiles. Known
 * server-owned profiles always use one of the explicit tables above.
 */
const FDM_VALIDATION_ONLY_DERATE_MM_BY_ENGINE = Object.freeze({
    prusa: Object.freeze({ x: 0, y: 0, z: 0.1 }),
    orca: Object.freeze({ x: 2.1, y: 2.1, z: 0.1 }),
    bambu: Object.freeze({ x: 2.1, y: 2.1, z: 0.1 })
});

/**
 * Existing minimum accepted model dimensions in millimeters by technology.
 * J2 changes only the proven upper machine envelopes; changing this lower
 * compatibility boundary requires a separate owner semantics decision.
 * @type {{FDM: {x: number, y: number, z: number}, SLA: {x: number, y: number, z: number}}}
 */
const MIN_BUILD_VOLUMES = {
    FDM: { x: 1, y: 1, z: 1 },
    SLA: { x: 1, y: 1, z: 1 }
};

/**
 * Accepted file extensions grouped by processing pipeline.
 * @type {{direct: string[], cad: string[], archive: string[]}}
 */
const EXTENSIONS = {
    direct: ['.stl', '.obj', '.3mf'],
    cad: ['.stp', '.step', '.igs', '.iges', '.ply'],
    archive: ['.zip']
};

/**
 * Resolve HTTP port from environment with range validation.
 * @returns {number} Validated HTTP port.
 */
function resolvePort() {
    const parsed = Number.parseInt(process.env.PORT || `${DEFAULTS.PORT}`, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : DEFAULTS.PORT;
}

/**
 * HTTP port used by the Express API.
 * @type {number}
 */
const PORT = resolvePort();

module.exports = {
    DEFAULTS,
    MAX_CONCURRENT_SLICES_RANGE,
    LAYER_HEIGHTS,
    ORCA_FILAMENT_PROFILE_BY_MATERIAL,
    ORCA_PROCESS_PROFILE_BY_LAYER,
    BAMBU_DEFAULT_PROFILES_ROOT,
    BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    DEFAULT_PRICING,
    MAX_BUILD_VOLUMES,
    P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    FDM_VALIDATION_ONLY_DERATE_MM_BY_ENGINE,
    MIN_BUILD_VOLUMES,
    EXTENSIONS,
    PORT
};
