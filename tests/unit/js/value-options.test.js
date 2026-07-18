const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const {
    pickFirstNonEmptyValue,
    parseNumberLike,
    parseOptionalPositiveField,
    parseOptionalFiniteField,
    parseBooleanLike,
    normalizeSizeUnit,
    normalizeAxisDimensions,
    sanitizeProfileFileName
} = require(path.join(REPO_ROOT, 'app/services/slice/value-parsers'));
const {
    parseSliceOptions,
    validateMaterialForTechnology
} = require(path.join(REPO_ROOT, 'app/services/slice/options'));

test('value parsers preserve priority and normalize primitive input', () => {
    const source = {
        first: '   ',
        second: 0,
        third: 12
    };

    assert.equal(pickFirstNonEmptyValue(source, ['missing', 'first', 'second', 'third']), 0);
    assert.equal(parseNumberLike(' 12,5 '), 12.5);
    assert.equal(parseNumberLike(true), Number.NaN);
    assert.equal(parseNumberLike(''), null);
    assert.equal(parseNumberLike(null), null);
    assert.ok(Number.isNaN(parseNumberLike({ value: 2 })));
});

test('optional number parsers distinguish absent, invalid, positive, and finite values', () => {
    assert.deepEqual(
        parseOptionalPositiveField({}, ['size'], 'size'),
        { provided: false, value: null }
    );
    assert.deepEqual(
        parseOptionalPositiveField({ size: '2,5' }, ['size'], 'size'),
        { provided: true, value: 2.5 }
    );
    assert.deepEqual(
        parseOptionalPositiveField({ size: 0 }, ['size'], 'size'),
        { provided: true, value: null, error: 'size must be a positive number.' }
    );
    assert.deepEqual(
        parseOptionalFiniteField({ rotation: '-45.25' }, ['rotation'], 'rotation'),
        { provided: true, value: -45.25 }
    );
    assert.deepEqual(
        parseOptionalFiniteField({ rotation: 'invalid' }, ['rotation'], 'rotation'),
        { provided: true, value: null, error: 'rotation must be a finite number.' }
    );
});

test('boolean, unit, and dimension parsers normalize supported aliases', () => {
    for (const value of [true, 1, 'YES', ' on ']) {
        assert.equal(parseBooleanLike(value), true);
    }
    for (const value of [false, 0, 'No', ' off ']) {
        assert.equal(parseBooleanLike(value), false);
    }
    assert.equal(parseBooleanLike('sometimes'), null);
    assert.deepEqual(normalizeSizeUnit(undefined), { isValid: true, value: 'mm' });
    assert.deepEqual(normalizeSizeUnit('millimetres'), { isValid: true, value: 'mm' });
    assert.deepEqual(normalizeSizeUnit('IN'), { isValid: true, value: 'inch' });
    assert.equal(normalizeSizeUnit('cm').isValid, false);
    assert.deepEqual(
        normalizeAxisDimensions({ x: 2, y: null, z: 0.5 }, 'inch'),
        { x: 50.8, y: null, z: 12.7 }
    );
});

test('profile filename sanitization accepts basenames and rejects traversal or wrong types', () => {
    assert.deepEqual(
        sanitizeProfileFileName(' FDM_0.2mm.INI ', '.ini'),
        { provided: true, value: 'FDM_0.2mm.INI' }
    );
    assert.deepEqual(
        sanitizeProfileFileName('', '.ini'),
        { provided: false, value: null }
    );

    for (const candidate of [
        '../FDM_0.2mm.ini',
        '..\\FDM_0.2mm.ini',
        'nested/profile.ini',
        'nested\\profile.ini',
        '/absolute/profile.ini'
    ]) {
        const result = sanitizeProfileFileName(candidate, '.ini');
        assert.equal(result.provided, true, candidate);
        assert.equal(result.value, null, candidate);
        assert.equal(typeof result.error, 'string', candidate);
    }

    assert.match(sanitizeProfileFileName('profile.json', '.ini').error, /must end with \.ini/);
    assert.match(sanitizeProfileFileName({ name: 'profile.ini' }, '.ini').error, /must be a string/);
    assert.match(sanitizeProfileFileName('profile name.ini', '.ini').error, /unsupported characters/);
});

test('slice option defaults retain the Prusa FDM contract', () => {
    const result = parseSliceOptions({}, null, 'prusa');

    assert.equal(result.isValid, true);
    assert.deepEqual(result.options, {
        layerHeight: 0.2,
        material: 'PLA',
        infillPercentage: '20%',
        technology: 'FDM',
        transformOptions: {
            unit: 'mm',
            keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            targetSizeMm: { x: null, y: null, z: null },
            scalePercent: null,
            rotationDeg: { x: 0, y: 0, z: 0 }
        },
        profileOverrides: {
            prusaProfile: null,
            orcaMachineProfile: null,
            orcaProcessProfile: null
        }
    });
});

test('slice options normalize transforms, infill, and a valid Prusa profile', () => {
    const result = parseSliceOptions({
        layerHeight: '0.2',
        material: 'PLA',
        infill: '140',
        sizeUnit: 'inch',
        targetSizeX: '2',
        keepProportions: 'false',
        rotationX: '-90',
        rotationY: '1,5',
        printerProfile: 'FDM_0.2mm.ini'
    }, null, 'prusa');

    assert.equal(result.isValid, true);
    assert.equal(result.options.infillPercentage, '100%');
    assert.deepEqual(result.options.transformOptions, {
        unit: 'inch',
        keepProportions: false,
        requestedTargetSize: { x: 2, y: null, z: null },
        targetSizeMm: { x: 50.8, y: null, z: null },
        scalePercent: null,
        rotationDeg: { x: -90, y: 1.5, z: 0 }
    });
    assert.deepEqual(result.options.profileOverrides, {
        prusaProfile: 'FDM_0.2mm.ini',
        orcaMachineProfile: null,
        orcaProcessProfile: null
    });
});

test('slice options preserve engine and technology layer-height boundaries', () => {
    const prusaSla = parseSliceOptions({ layerHeight: '0.05' }, null, 'prusa');
    assert.equal(prusaSla.isValid, true);
    assert.equal(prusaSla.options.technology, 'SLA');
    assert.equal(prusaSla.options.material, 'Standard');

    const invalidOrca = parseSliceOptions({ layerHeight: '0.05', material: 'PLA' }, 'FDM', 'orca');
    assert.equal(invalidOrca.isValid, false);
    assert.equal(invalidOrca.response.errorCode, 'INVALID_LAYER_HEIGHT_FOR_ENGINE');

    const invalidForcedSla = parseSliceOptions({ layerHeight: '0.2', material: 'Standard' }, 'SLA', 'prusa');
    assert.equal(invalidForcedSla.isValid, false);
    assert.equal(invalidForcedSla.response.errorCode, 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY');
});

test('slice options accept compatible Orca profiles and reject profile traversal', () => {
    const valid = parseSliceOptions({
        layerHeight: '0.2',
        material: 'PLA',
        printerProfile: 'Bambu_P1S_0.4_nozzle.json',
        processProfile: 'FDM_0.2mm.json'
    }, 'FDM', 'orca');

    assert.equal(valid.isValid, true);
    assert.deepEqual(valid.options.profileOverrides, {
        prusaProfile: null,
        orcaMachineProfile: 'Bambu_P1S_0.4_nozzle.json',
        orcaProcessProfile: 'FDM_0.2mm.json'
    });

    for (const field of ['printerProfile', 'processProfile']) {
        const invalid = parseSliceOptions({
            layerHeight: '0.2',
            material: 'PLA',
            [field]: '../outside.json'
        }, 'FDM', 'orca');
        assert.equal(invalid.isValid, false, field);
        assert.equal(invalid.response.errorCode, 'INVALID_PROFILE_NAME', field);
    }
});

test('slice options return stable validation codes for material and transform errors', async (t) => {
    const cases = [
        {
            name: 'cross-technology material',
            body: { layerHeight: '0.2', material: 'Standard' },
            code: 'MATERIAL_TECHNOLOGY_MISMATCH'
        },
        {
            name: 'unknown material',
            body: { layerHeight: '0.2', material: 'Unknown-Material' },
            code: 'INVALID_MATERIAL_FOR_TECHNOLOGY'
        },
        {
            name: 'invalid unit',
            body: { layerHeight: '0.2', material: 'PLA', sizeUnit: 'cm' },
            code: 'INVALID_SIZE_UNIT'
        },
        {
            name: 'invalid proportional flag',
            body: { layerHeight: '0.2', material: 'PLA', keepProportions: 'maybe' },
            code: 'INVALID_KEEP_PROPORTIONS'
        },
        {
            name: 'conflicting scale modes',
            body: { layerHeight: '0.2', material: 'PLA', scalePercent: 120, targetSizeX: 20 },
            code: 'CONFLICTING_SIZE_OPTIONS'
        },
        {
            name: 'invalid rotation',
            body: { layerHeight: '0.2', material: 'PLA', rotationZ: 'spin' },
            code: 'INVALID_ROTATION_OPTIONS'
        }
    ];

    for (const item of cases) {
        await t.test(item.name, () => {
            const result = parseSliceOptions(item.body, null, 'prusa');
            assert.equal(result.isValid, false);
            assert.equal(result.response.errorCode, item.code);
        });
    }

    assert.deepEqual(validateMaterialForTechnology('FDM', 'PLA'), { isValid: true });
});
