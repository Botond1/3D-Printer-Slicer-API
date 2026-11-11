'use strict';

// 3.9.0 WP3: the 3MF build-expansion tokenizer (§4.4, T-ARC-1 tokenizer cases).

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
    ExpansionCounter,
    MAX_TAG_CARRY_BYTES,
    clearExpansionVerdictsForTests,
    consumeExpansionVerdict,
    decodeAttributeValue,
    readAttributes,
    registerExpansionVerdict,
    threeMfPartKey
} = require('../../../app/services/slice/three-mf-expansion');
const { inspectThreeMfArchive, inspectThreeMfPackage } = require('../../../app/services/slice/three-mf');
const {
    CONTENT_TYPES, RELS, cycleModel, fanOutModel, makeArchive, modelXml, tetrahedronObject, withModel
} = require('../../fixtures/archives/archive-cases');

const LIMITS = Object.freeze({ maxTriangles: 25_000_000, maxInstances: 100_000, maxObjects: 100_000 });
const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

async function tempDir(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wp3-expansion-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
}

/** Scan parts (name → xml) with the given chunk size picker; return totals or the error. */
function scan(parts, limits = LIMITS, chunkSize = () => Number.MAX_SAFE_INTEGER) {
    const counter = new ExpansionCounter(limits);
    for (const [name, xml] of Object.entries(parts)) {
        const bytes = Buffer.from(xml, 'utf8');
        const scanner = counter.createPartScanner(name);
        for (let offset = 0; offset < bytes.length;) {
            const size = Math.max(1, Math.min(chunkSize(), bytes.length - offset));
            scanner.write(bytes.subarray(offset, offset + size));
            offset += size;
        }
        scanner.end();
    }
    return counter.finish();
}

function meshObject(id, triangles, extra = '') {
    const tri = '<triangle v1="0" v2="1" v3="2"/>'.repeat(triangles);
    return `<object id="${id}" type="model"${extra}><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>`
        + `<vertex x="0" y="1" z="0"/></vertices><triangles>${tri}</triangles></mesh></object>`;
}

/** A Bambu Studio style project: root components with p:path into 3D/Objects parts. */
function bambuProjectParts() {
    const root = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" `
        + `xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="${PROD_NS}" requiredextensions="p">\n`
        + ' <metadata name="Application">BambuStudio-02.03.00.70</metadata>\n'
        + ' <resources>\n'
        + '  <object id="2" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n'
        + '   <components>\n'
        + '    <component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="00010000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n'
        + '   </components>\n'
        + '  </object>\n'
        + '  <object id="4" p:UUID="00000002-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n'
        + '   <components>\n'
        + '    <component p:path="/3D/Objects/object_2.model" objectid="3" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>\n'
        + '    <component p:path="/3D/Objects/object_2.model" objectid="3" transform="1 0 0 0 1 0 0 0 1 40 0 0"/>\n'
        + '   </components>\n'
        + '  </object>\n'
        + ' </resources>\n'
        + ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">\n'
        + '  <item objectid="2" p:UUID="00000002-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>\n'
        + '  <item objectid="4" p:UUID="00000004-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 60 60 0" printable="1"/>\n'
        + ' </build>\n'
        + '</model>\n';
    const objectPart = (id, triangles) => `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="${CORE_NS}" `
        + `xmlns:p="${PROD_NS}" requiredextensions="p">\n <resources>\n  ${meshObject(id, triangles, ' p:UUID="00010000-81cb-4c03-9d28-80fed5dfa1dc"')}\n`
        + ' </resources>\n <build/>\n</model>\n';
    return {
        '3D/3dmodel.model': root,
        '3D/Objects/object_1.model': objectPart(1, 4),
        '3D/Objects/object_2.model': objectPart(3, 12)
    };
}

/** Comments, CDATA, PIs, prefixes, quoted `>` and character references. */
function trickyParts() {
    const root = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + "<!-- don't count <triangle v1=\"0\"/> or <object id=\"99\"> in a comment -->\n"
        + `<m:model xmlns:m="${CORE_NS}" xmlns:p="${PROD_NS}">\n`
        + '<?pi <triangle/> ?>\n'
        + '<m:resources>\n'
        + `<m:object name="a>b 'q'" id='7' type="model"><m:mesh><m:vertices><m:vertex x="0" y="0" z="0"/></m:vertices>`
        + '<m:triangles><m:triangle v1="0" v2="1" v3="2"/><![CDATA[ <m:triangle/> ]]><m:triangle\n v1="0" v2="1" v3="2"/></m:triangles></m:mesh></m:object>\n'
        + '<m:object\tid="8" type="model"><m:components>'
        + '<m:component objectid="&#55;"/>'
        + '<m:component p:path="/3D/Objects/p&#46;model" objectid="&#x35;"/>'
        + '</m:components></m:object>\n'
        + '</m:resources>\n'
        + "<m:build><m:item objectid='8'/></m:build></m:model>\n";
    const other = `<model xmlns="${CORE_NS}"><resources>${meshObject(5, 3)}</resources><build/></model>`;
    return { '3D/3dmodel.model': root, '3D/Objects/p.model': other };
}

test('a Bambu Studio project expands through p:path components with exact counts', () => {
    assert.deepEqual(scan(bambuProjectParts()), { triangles: 4 + 12 + 12, instances: 3, objects: 4 });
});

test('comments, CDATA, processing instructions, prefixes and character references are honoured', () => {
    // object 8 → object 7 (2 triangles) + p.model object 5 (3 triangles).
    assert.deepEqual(scan(trickyParts()), { triangles: 5, instances: 2, objects: 3 });
});

test('chunk split fuzz from 1 B to 64 KiB gives identical counts', () => {
    let seed = 0x5eed;
    const random = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
    };
    for (const parts of [bambuProjectParts(), trickyParts(), { '3D/3dmodel.model': fanOutModel(3, 4) }]) {
        const expected = scan(parts);
        for (const fixed of [1, 2, 3, 7, 64, 1024, 65536]) {
            assert.deepEqual(scan(parts, LIMITS, () => fixed), expected, `chunk ${fixed}`);
        }
        for (let round = 0; round < 40; round += 1) {
            assert.deepEqual(scan(parts, LIMITS, () => 1 + (random() % 65536)), expected, `random round ${round}`);
            assert.deepEqual(scan(parts, LIMITS, () => 1 + (random() % 9)), expected, `small random round ${round}`);
        }
    }
});

test('the 10^16 fan-out is refused with the expansion rule, the counts and the limit', () => {
    assert.throws(() => scan({ '3D/3dmodel.model': fanOutModel() }), (error) => {
        assert.equal(error.code, 'INVALID_SOURCE_GEOMETRY');
        assert.equal(error.status, 400);
        assert.equal(error.archiveRule, 'ARCHIVE_EXPANSION_EXCEEDED');
        assert.equal(error.archiveLimit, LIMITS.maxInstances);
        assert.equal(error.expansion.objects, 17);
        assert.ok(error.expansion.instances > LIMITS.maxInstances);
        return true;
    });
});

test('a cycle with fan-out 10 is refused; fan-out 1 is left to Python', () => {
    assert.throws(() => scan({ '3D/3dmodel.model': cycleModel(10) }), { archiveRule: 'ARCHIVE_EXPANSION_EXCEEDED' });
    // Depth-bounded: 17 levels (0..16) of one triangle each.
    assert.deepEqual(scan({ '3D/3dmodel.model': cycleModel(1) }), { triangles: 17, instances: 17, objects: 1 });
});

test('4096 items of a 200 000-triangle object are refused; 125 items sit exactly on the limit', () => {
    const object = meshObject(1, 200_000);
    const build = (items) => modelXml(object, '<item objectid="1"/>'.repeat(items));
    assert.throws(() => scan({ '3D/3dmodel.model': build(4096) }), (error) => {
        assert.equal(error.archiveRule, 'ARCHIVE_EXPANSION_EXCEEDED');
        assert.equal(error.archiveLimit, LIMITS.maxTriangles);
        return true;
    });
    assert.deepEqual(scan({ '3D/3dmodel.model': build(125) }), { triangles: 25_000_000, instances: 125, objects: 1 });
    assert.throws(() => scan({ '3D/3dmodel.model': build(126) }), { archiveLimit: LIMITS.maxTriangles });
});

test('the object count across parts is capped', () => {
    const resources = Array.from({ length: 1001 }, (_, index) => `<object id="${index + 1}"/>`).join('');
    assert.throws(() => scan({ '3D/3dmodel.model': modelXml(resources, '') }, { ...LIMITS, maxObjects: 1000 }),
        { archiveRule: 'ARCHIVE_EXPANSION_EXCEEDED', archiveLimit: 1000 });
    assert.equal(scan({ '3D/3dmodel.model': modelXml(resources, '') }, { ...LIMITS, maxObjects: 1001 }).objects, 1001);
});

test('an unfinished tag carried past 64 KiB is refused', () => {
    const longName = 'x'.repeat(MAX_TAG_CARRY_BYTES + 10);
    assert.throws(() => scan({ '3D/3dmodel.model': `<model><resources><object name="${longName}" id="1"/></resources></model>` }),
        { archiveRule: 'ARCHIVE_EXPANSION_EXCEEDED', archiveLimit: MAX_TAG_CARRY_BYTES });
    // A long comment or a long skipped tag is not carried.
    const comment = `<!-- ${'y'.repeat(MAX_TAG_CARRY_BYTES * 2)} -->`;
    const metadata = `<metadata name="n" value="${'z'.repeat(MAX_TAG_CARRY_BYTES * 2)}"/>`;
    assert.deepEqual(scan({ '3D/3dmodel.model': modelXml(`${comment}${metadata}${tetrahedronObject(1)}`, '<item objectid="1"/>') }),
        { triangles: 4, instances: 1, objects: 1 });
});

test('build items come from the root part only and missing references count nothing', () => {
    const other = modelXml(tetrahedronObject(1), '<item objectid="1"/><item objectid="1"/>');
    assert.deepEqual(scan({
        '3D/3dmodel.model': modelXml('', '<item objectid="404"/>'),
        '3D/Objects/other.model': other
    }), { triangles: 0, instances: 0, objects: 1 });
    // An item without objectid reaches an object without id, as in Python's dict lookup.
    assert.deepEqual(scan({ '3D/3dmodel.model': modelXml(meshObject('', 2).replace(' id=""', ''), '<item/>') }),
        { triangles: 2, instances: 1, objects: 1 });
});

test('attribute helpers follow lxml: character references and whitespace normalisation', () => {
    assert.equal(decodeAttributeValue('/3D/a&#46;model'), '/3D/a.model');
    assert.equal(decodeAttributeValue('&lt;&amp;&gt;&quot;&apos;&#x41;'), '<&>"\'A');
    assert.equal(decodeAttributeValue('a\tb\nc'), 'a b c');
    assert.deepEqual(readAttributes(' p:path="/3D/x.model" objectid=\'3\' id="1" q:id="9"'),
        { path: '/3D/x.model', objectid: '3', id: '1' });
    assert.equal(threeMfPartKey('/3D/Objects/Object_1.model'), '3d/objects/object_1.model');
    assert.equal(threeMfPartKey('\\3D\\A.model'), '3d/a.model');
});

test('a verdict is consumed once, also after the upload gained its .3mf extension', async (t) => {
    clearExpansionVerdictsForTests();
    const stats = { dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n };
    registerExpansionVerdict({ realpath: '/w/upload-abc', ...stats, counts: { triangles: 4, instances: 1, objects: 1 } });
    assert.equal(consumeExpansionVerdict('/w/other', stats), null);
    assert.equal(consumeExpansionVerdict('/w/upload-abc.3mf', { ...stats, size: 9n }), null);
    assert.deepEqual(consumeExpansionVerdict('/w/upload-abc.3mf', stats), { triangles: 4, instances: 1, objects: 1 });
    assert.equal(consumeExpansionVerdict('/w/upload-abc.3mf', stats), null, 'consumed once');
    let clock = 0;
    registerExpansionVerdict({ realpath: '/w/u', ...stats, counts: {} }, () => clock);
    clock = 31 * 60 * 1000;
    assert.equal(consumeExpansionVerdict('/w/u', stats, () => clock), null, 'expired');
    t.after(clearExpansionVerdictsForTests);
});

test('inspectThreeMfArchive keeps its 3.8.3 return value and tokenizes a real archive', async (t) => {
    const root = await tempDir(t);
    const parts = bambuProjectParts();
    const file = path.join(root, 'project.3mf');
    await makeArchive(file, [
        { name: '[Content_Types].xml', data: CONTENT_TYPES },
        { name: '_rels/.rels', data: RELS },
        ...Object.entries(parts).map(([name, data]) => ({ name, data })),
        { name: 'Metadata/model_settings.config', data: '<config/>' },
        { name: 'Metadata/plate_1.png', data: Buffer.alloc(64, 1), store: true }
    ]);
    const summary = await inspectThreeMfArchive(file);
    assert.deepEqual(Object.keys(summary), ['entries', 'declaredBytes', 'actualBytes']);
    assert.equal(summary.entries, 7);
    const detailed = await inspectThreeMfPackage(file);
    assert.deepEqual(detailed.expansion, { triangles: 28, instances: 3, objects: 4 });
    assert.deepEqual(detailed.summary, summary);
    assert.equal((await inspectThreeMfPackage(file, { expansion: false })).expansion, null);

    const bomb = path.join(root, 'bomb.3mf');
    await makeArchive(bomb, withModel(fanOutModel()));
    assert.ok((await fsp.stat(bomb)).size < 2048, 'the 10^16 bomb is a file of about 2 KB');
    const started = process.hrtime.bigint();
    await assert.rejects(inspectThreeMfArchive(bomb), { code: 'INVALID_SOURCE_GEOMETRY', archiveRule: 'ARCHIVE_EXPANSION_EXCEEDED' });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 50, `fan-out refusal took ${elapsedMs} ms`);
    // The 3.8.3 checks alone admit it: the refusal is the new pre-scan's.
    assert.ok(await inspectThreeMfPackage(bomb, { expansion: false }));
});
