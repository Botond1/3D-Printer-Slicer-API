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
    if receipt.get('scope') != dict(kind='single_part', object_count=1,
                                   instance_count=1, plate_count=1, filament_count=1, quantity=1):
        return False, 'unverified manufacturing scope'
    estimates = receipt.get('estimates', {})
    stats = body.get('stats', {})
    if (estimates.get('print_time_seconds') != stats.get('print_time_seconds')
            or estimates.get('material_used_g') != stats.get('material_used_g')
            or estimates.get('time_basis') != 'including_start_sequence'
            or estimates.get('support_material_g') is not None):
        return False, 'estimate provenance mismatch'
    return True, 'native receipt binds exact source, applied config, geometry, scope and estimates'


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
    cases = []
    for name, file, status, code in [
        ('open', opened, 400, 'INVALID_SOURCE_GEOMETRY'),
        ('empty', empty, 400, 'INVALID_SOURCE_GEOMETRY'),
        ('degenerate', degenerate, 400, 'INVALID_SOURCE_GEOMETRY'),
        ('compound', compound, 422, 'AMBIGUOUS_MANUFACTURING_SCOPE'),
    ]:
        cases.append(case_type(name=f'{name} source rejected', kind='negative', fixture_path=file,
            fixture_label=name, printer='P1S', layer_height='0.2', material='PLA', supports='true',
            expected_status=status, expected_error_codes=(code,)))
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
