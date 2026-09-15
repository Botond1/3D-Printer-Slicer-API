'use strict';

/** Versioned native Bambu evidence. Hashes bind content, never authorization. */
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = { type: 'string', minLength: 1, maxLength: 256 };
const positive = { type: 'number', minimum: 0, exclusiveMinimum: true };
const one = { type: 'integer', enum: [1] };
const count = { type: 'integer', minimum: 0 };
const atLeastOne = { type: 'integer', minimum: 1 };
const yes = { type: 'boolean', enum: [true] };
const literal = (value) => ({ type: 'string', enum: [value] });
const object = (properties) => ({ type: 'object', additionalProperties: false,
    required: Object.keys(properties), properties });
const partial = { type: 'number', minimum: 0, nullable: true };

function technicalReceiptSchema(modelTransform) {
    return object({
        schema: literal('r3d-technical-receipt-v1'), request_id: text, job_id: text,
        measurement_generation: hash,
        source: object({ sha256: hash, format: text, normalized_geometry_sha256: hash,
            sliced_geometry_sha256: hash, units: literal('mm'), unit_source: text }),
        engine: object({ name: literal('bambu'), version: text, platform: text, build_sha256: hash }),
        profiles: object({ printer: { type: 'string', enum: ['P1S', 'H2D'] }, machine: text,
            process: text, filament: text, effective_profile_sha256: hash, bundle_sha256: hash,
            machine_sha256: hash, process_sha256: hash, filament_sha256: hash,
            nozzle_diameter_mm: positive, extruder_mode: literal('single_filament_first_extruder'), bed_type: text }),
        applied: object({ layer_height_mm: positive, infill_percent: { type: 'integer', minimum: 0, maximum: 100 },
            supports: { type: 'boolean' }, material: text, evidence: literal('bambu_gcode_config'), configuration_sha256: hash }),
        // Since 3.6.0 the geometry block describes the sliced mesh instead of
        // asserting one closed shell: an open mesh or several shells are
        // admitted and named here (and an open mesh adds a warning).
        geometry: object({ valid: yes, watertight: { type: 'boolean' }, winding_consistent: { type: 'boolean' },
            component_count: atLeastOne, closed_component_count: count, open_edge_count: count,
            dropped_degenerate_faces: count, dropped_duplicate_faces: count,
            volume_mm3: positive, volume_source: { type: 'string', enum: ['validated_triangle_mesh', 'signed_volume_estimate'] },
            model_transform: modelTransform }),
        scope: object({ kind: literal('single_part'), object_count: atLeastOne, instance_count: atLeastOne,
            plate_count: one, filament_count: one, quantity: one }),
        estimates: object({ print_time_seconds: { type: 'integer', minimum: 1 },
            print_time_source: literal('total_estimated_time'), time_basis: literal('including_start_sequence'),
            material_used_g: positive, material_used_g_source: literal('total_filament_weight_g'),
            model_time_seconds: partial, preparation_time_seconds: partial, support_material_g: partial,
            calibration: literal('raw_slicer_estimate') }),
        artifact: object({ id: text, sha256: hash, size_bytes: { type: 'integer', minimum: 1 },
            media_type: literal('model/3mf'), extension: literal('.gcode.3mf'), gcode_sha256: hash,
            access: literal('artifact_audience'), retention_seconds: positive }),
        warnings: { type: 'array', maxItems: 3, items: object({
            code: { type: 'string', enum: ['GEOMETRY_NOT_WATERTIGHT', 'NATIVE_WARNING_UNCLASSIFIED', 'ORIENTATION_FALLBACK'] },
            severity: literal('warning'), source: { type: 'string', enum: ['native', 'geometry', 'orientation'] } }) },
        identity: object({ schema: literal('r3d-slice-identity-v1'), job_sha256: hash,
            processing_schema: literal('r3d-bambu-processing-v1') }), receipt_sha256: hash
    });
}

module.exports = { technicalReceiptSchema };
