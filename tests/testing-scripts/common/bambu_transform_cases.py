"""Synthetic unit, transform and 3MF scope cases for the existing HTTP runner."""
import struct
import zipfile
from common.synthetic_fixtures import write_cuboid_stl


def write_three_mf(source, target, unit='millimeter', instances=1, doctype=False):
    data = source.read_bytes()
    vertices, triangles = [], []
    divisor = 25.4 if unit == 'inch' else 1
    for offset in range(84, len(data), 50):
        triangle = []
        for start in (12, 24, 36):
            vertex = tuple(value / divisor for value in struct.unpack_from('<3f', data, offset + start))
            if vertex not in vertices:
                vertices.append(vertex)
            triangle.append(vertices.index(vertex))
        triangles.append(triangle)
    vertex_xml = ''.join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in vertices)
    triangle_xml = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in triangles)
    model = (f'<model unit="{unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             f'<resources><object id="1" type="model"><mesh><vertices>{vertex_xml}</vertices>'
             f'<triangles>{triangle_xml}</triangles></mesh></object></resources><build>'
             + '<item objectid="1"/>' * instances + '</build></model>')
    if doctype:
        model = '<!DOCTYPE model [<!ENTITY harmless "test">]>' + model
    with zipfile.ZipFile(target, 'w') as archive:
        archive.writestr('3D/3dmodel.model', model)
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    return target


def transform_cases(case_type, fixtures):
    root = fixtures['cuboid'].parent
    cases = []
    for name, fields, dimensions in [
        ('preserved mm control', {'orientationMode': 'preserve'}, (40, 30, 20)),
        ('half scale then manual Z rotation', {'orientationMode': 'preserve', 'scalePercent': '50', 'rotationZ': '90'}, (15, 20, 10)),
        ('inch target dimensions applied once', {'orientationMode': 'preserve', 'sizeUnit': 'inch', 'sizeX': '1', 'scalePercent': ''}, (25.4, 19.05, 12.7)),
    ]:
        cases.append(case_type(name=name, kind='transform', fixture_path=fixtures['cuboid'], fixture_label='cuboid',
            printer='P1S', layer_height='0.2', material='PLA', supports='true', field_overrides=fields,
            expected_dimensions_mm=dict(zip('xyz', dimensions))))
    for unit in ('millimeter', 'inch'):
        file = write_three_mf(fixtures['cuboid'], root / f'unit-{unit}.3mf', unit)
        cases.append(case_type(name=f'3MF declared {unit}', kind='transform', fixture_path=file, fixture_label=f'3mf-{unit}',
            printer='P1S', layer_height='0.2', material='PLA', supports='true',
            field_overrides={'orientationMode': 'preserve'}, expected_dimensions_mm=dict(x=40, y=30, z=20)))
    for name, options in [('two-build-instances', {'instances': 2}), ('doctype-entity', {'doctype': True})]:
        file = write_three_mf(fixtures['cuboid'], root / f'{name}.3mf', **options)
        cases.append(case_type(name=name, kind='negative', fixture_path=file, fixture_label=name,
            printer='P1S', layer_height='0.2', material='PLA', supports='true', expected_status=400,
            expected_error_codes=('INVALID_SOURCE_GEOMETRY',)))
    oversized = write_cuboid_stl(root / 'oversized', dimensions_mm=(270, 270, 10))
    cases.append(case_type(name='post-transform printer boundary', kind='negative', fixture_path=oversized,
        fixture_label='oversized', printer='P1S', layer_height='0.2', material='PLA', supports='true',
        field_overrides={'orientationMode': 'preserve'}, expected_status=422,
        expected_error_codes=('MODEL_OUT_OF_PRINTER_BOUNDS',)))
    return cases
