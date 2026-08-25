'use strict';

const BASE_SYNTHETIC_TRIANGLES = Object.freeze([
    { normal: [0, 0, -1], vertices: [[0, 0, 0], [10, 20, 0], [10, 0, 0]] },
    { normal: [0, 0, -1], vertices: [[0, 0, 0], [0, 20, 0], [10, 20, 0]] },
    { normal: [0, 0, 1], vertices: [[0, 0, 30], [10, 0, 30], [10, 20, 30]] },
    { normal: [0, 0, 1], vertices: [[0, 0, 30], [10, 20, 30], [0, 20, 30]] },
    { normal: [0, -1, 0], vertices: [[0, 0, 0], [10, 0, 0], [10, 0, 30]] },
    { normal: [0, -1, 0], vertices: [[0, 0, 0], [10, 0, 30], [0, 0, 30]] },
    { normal: [1, 0, 0], vertices: [[10, 0, 0], [10, 20, 0], [10, 20, 30]] },
    { normal: [1, 0, 0], vertices: [[10, 0, 0], [10, 20, 30], [10, 0, 30]] },
    { normal: [0, 1, 0], vertices: [[10, 20, 0], [0, 20, 0], [0, 20, 30]] },
    { normal: [0, 1, 0], vertices: [[10, 20, 0], [0, 20, 30], [10, 20, 30]] },
    { normal: [-1, 0, 0], vertices: [[0, 20, 0], [0, 0, 0], [0, 0, 30]] },
    { normal: [-1, 0, 0], vertices: [[0, 20, 0], [0, 0, 30], [0, 20, 30]] }
]);

function rotateTrianglesX90(triangles) {
    const maximumZ = Math.max(...triangles.flatMap(({ vertices }) =>
        vertices.map((vertex) => vertex[2])));
    return triangles.map(({ normal, vertices }) => ({
        normal: [normal[0], -normal[2], normal[1]],
        vertices: vertices.map(([x, y, z]) => [x, maximumZ - z, y])
    }));
}

function buildSyntheticStl(triangles = SYNTHETIC_TRIANGLES) {
    if (!Array.isArray(triangles) || triangles.length !== 12) throw new Error('stl_triangle_count');
    const lines = ['solid synthetic-pre-rotated-asymmetric-prism'];
    for (const triangle of triangles) {
        if (!triangle || !Array.isArray(triangle.normal) || triangle.normal.length !== 3 ||
            !Array.isArray(triangle.vertices) || triangle.vertices.length !== 3) {
            throw new Error('stl_triangle_shape');
        }
        const values = [...triangle.normal, ...triangle.vertices.flat()];
        if (values.length !== 12 || values.some((value) => !Number.isFinite(value))) {
            throw new Error('stl_coordinate_shape');
        }
        lines.push(`  facet normal ${triangle.normal.join(' ')}`, '    outer loop');
        for (const vertex of triangle.vertices) {
            if (!Array.isArray(vertex) || vertex.length !== 3) throw new Error('stl_vertex_shape');
            lines.push(`      vertex ${vertex.join(' ')}`);
        }
        lines.push('    endloop', '  endfacet');
    }
    lines.push('endsolid synthetic-pre-rotated-asymmetric-prism', '');
    return lines.join('\n');
}

function hasPositiveExtrusionMove(gcodePrefix) {
    if (typeof gcodePrefix !== 'string') return false;
    const layerMarker = /(?:^|\r?\n);BEFORE_LAYER_CHANGE(?:\r?\n|$)/.exec(gcodePrefix);
    if (!layerMarker) return false;
    const modelLayer = gcodePrefix.slice(layerMarker.index + layerMarker[0].length);
    return modelLayer.split(/\r?\n/).some((line) => {
        if (!/^G1(?:\s|$)/.test(line)) return false;
        const extrusion = /(?:^|\s)E(-?(?:\d+(?:\.\d*)?|\.\d+))(?=\s|;|$)/.exec(line);
        return extrusion !== null && Number(extrusion[1]) > 0;
    });
}

// Simulates the request-owned rotation already baked into the STL before Orca.
const SYNTHETIC_TRIANGLES = Object.freeze(rotateTrianglesX90(BASE_SYNTHETIC_TRIANGLES));
const SYNTHETIC_STL = buildSyntheticStl();

module.exports = Object.freeze({
    BASE_SYNTHETIC_TRIANGLES,
    SYNTHETIC_STL,
    SYNTHETIC_TRIANGLES,
    buildSyntheticStl,
    hasPositiveExtrusionMove,
    rotateTrianglesX90
});
