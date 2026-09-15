"""Native receipt checks used by the existing Bambu HTTP matrix runner."""
import hashlib
import json
from pathlib import Path
import struct


def validate_receipt(body, case):
    receipt = body.get('technical_receipt')
    if not isinstance(receipt, dict) or receipt.get('schema') != 'r3d-technical-receipt-v1':
        return False, 'technical receipt missing'
    source = receipt.get('source', {})
    applied = receipt.get('applied', {})
    if source.get('sha256') != hashlib.sha256(case.fixture_path.read_bytes()).hexdigest():
        return False, 'receipt source differs from uploaded bytes'
    if (applied.get('layer_height_mm') != float(case.layer_height)
            or body.get('applied_layer_height_mm') != float(case.layer_height)
            or applied.get('infill_percent') != int(case.infill.rstrip('%'))
            or applied.get('supports') is not (case.supports == 'true')
            or applied.get('material') != case.material):
        return False, 'applied native configuration differs'
    scope = receipt.get('scope', {})
    if (scope.get('kind') != 'single_part' or scope.get('plate_count') != 1 or scope.get('filament_count') != 1
            or scope.get('quantity') != 1 or not isinstance(scope.get('object_count'), int) or scope['object_count'] < 1
            or not isinstance(scope.get('instance_count'), int) or scope['instance_count'] < 1):
        return False, 'unverified manufacturing scope'
    ok, reason = validate_geometry_description(receipt, case)
    if not ok:
        return False, reason
    estimates = receipt.get('estimates', {})
    stats = body.get('stats', {})
    if (estimates.get('print_time_seconds') != stats.get('print_time_seconds')
            or estimates.get('material_used_g') != stats.get('material_used_g')
            or estimates.get('time_basis') != 'including_start_sequence'
            or estimates.get('support_material_g') is not None):
        return False, 'estimate provenance mismatch'
    return True, 'native receipt binds exact source, applied config, geometry, scope and estimates'


def validate_geometry_description(receipt, case):
    """3.6.0: the receipt describes the sliced mesh; the synthetic defects must be named, not hidden."""
    geometry = receipt.get('geometry', {})
    counts = ('component_count', 'closed_component_count', 'open_edge_count', 'dropped_degenerate_faces', 'dropped_duplicate_faces')
    if (not isinstance(geometry.get('watertight'), bool) or not isinstance(geometry.get('winding_consistent'), bool)
            or any(not isinstance(geometry.get(key), int) or geometry[key] < 0 for key in counts)
            or geometry['component_count'] < 1 or geometry['closed_component_count'] > geometry['component_count']
            or geometry.get('volume_source') not in ('validated_triangle_mesh', 'signed_volume_estimate')
            or not (isinstance(geometry.get('volume_mm3'), (int, float)) and geometry['volume_mm3'] > 0)):
        return False, 'geometry description missing or malformed'
    warned = any(w.get('code') == 'GEOMETRY_NOT_WATERTIGHT' for w in receipt.get('warnings', []))
    if geometry['watertight'] is warned or (geometry['watertight'] and geometry['open_edge_count'] != 0):
        return False, 'open-mesh warning disagrees with the geometry description'
    expectations = {
        'open': lambda g: g['watertight'] is False and g['open_edge_count'] > 0,
        'degenerate': lambda g: g['dropped_degenerate_faces'] >= 1,
        'compound': lambda g: g['component_count'] == 2 and g['closed_component_count'] == 2 and g['watertight'] is True,
        'cuboid': lambda g: g['watertight'] is True and g['component_count'] == 1 and g['volume_source'] == 'validated_triangle_mesh',
    }
    check = expectations.get(getattr(case, 'fixture_label', None))
    if check is not None and not check(geometry):
        return False, f'geometry description does not name the {case.fixture_label} fixture'
    return True, 'geometry described'


def additional_receipt_cases(case_type, fixtures):
    """Own harmless mutations plus restored native positives; never private corpus."""
    root = fixtures['cuboid'].parent
    data = fixtures['cuboid'].read_bytes()
    opened = root / 'open-negative.stl'
    opened.write_bytes(data[:80] + struct.pack('<I', 11) + data[84:84 + 11 * 50])
    empty = root / 'empty-negative.stl'
    empty.write_bytes(data[:80] + struct.pack('<I', 0))
    degenerate = root / 'degenerate-negative.stl'
    changed = bytearray(data)
    changed[84 + 24:84 + 36] = changed[84 + 12:84 + 24]
    degenerate.write_bytes(changed)
    compound = root / 'compound-negative.stl'
    second = bytearray(data[84:])
    for offset in range(0, len(second), 50):
        for vertex in (12, 24, 36):
            x = struct.unpack_from('<f', second, offset + vertex)[0]
            struct.pack_into('<f', second, offset + vertex, x + 100)
    compound.write_bytes(data[:80] + struct.pack('<I', 24) + data[84:] + second)
    cases = [case_type(name='empty source rejected', kind='negative', fixture_path=empty,
        fixture_label='empty', printer='P1S', layer_height='0.2', material='PLA', supports='true',
        expected_status=400, expected_error_codes=('INVALID_SOURCE_GEOMETRY',))]
    # 3.6.0: an open box, a box with one degenerate triangle and two separate boxes are
    # admitted and DESCRIBED (validate_geometry_description pins what each must name).
    for name, file in [('open', opened), ('degenerate', degenerate), ('compound', compound)]:
        cases.append(case_type(name=f'{name} source admitted and described', kind='receipt', fixture_path=file,
            fixture_label=name, printer='P1S', layer_height='0.2', material='PLA', supports='true'))
    for name, fields in [
        ('0.1 mm native layer', {'layer_height': '0.1'}),
        ('30 percent native infill', {'infill': '30'}),
        ('restored closed control', {}),
    ]:
        cases.append(case_type(name=name, kind='receipt', fixture_path=fixtures['cuboid'], fixture_label='cuboid',
            printer='P1S', layer_height=fields.get('layer_height', '0.2'), material='PLA', supports='true',
            infill=fields.get('infill', '15')))
    return cases


def retain_response(body, index, results_dir, source):
    # These matrix inputs are generated synthetic models, never customer payloads.
    target = Path(results_dir) / 'bambu-receipts'
    target.mkdir(parents=True, exist_ok=True)
    (target / f'{index:03d}.json').write_text(json.dumps(body, indent=2, allow_nan=False), encoding='utf-8')
    inputs = target / 'inputs'
    inputs.mkdir(exist_ok=True)
    (inputs / f'{index:03d}{source.suffix}').write_bytes(source.read_bytes())
