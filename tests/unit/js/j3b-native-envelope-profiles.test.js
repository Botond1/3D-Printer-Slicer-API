'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM,
    H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM
} = require('../../../app/config/constants');
const { PRUSA_CONFIGS_DIR, ORCA_CONFIGS_DIR } = require('../../../app/config/paths');
const { readIniKeyValues } = require('../../../app/services/slice/profile-readers');
const {
    resolveBuildVolumeLimits,
    resolveProfileSelection,
    validateModelDimensionsAgainstLimits
} = require('../../../app/services/slice/profiles');

const PRUSA_LAYERS = Object.freeze(['0.1', '0.2', '0.3']);
const PRUSA_QUOTE_PREFIX = 'FDM_P1S_H2D_SIZE_QUOTING_';
const ORCA_P1S = 'Bambu_P1S_0.4_nozzle.json';
const ORCA_QUOTE = 'Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json';

function resolvePrusaLimits(profileName) {
    const selection = resolveProfileSelection(
        'prusa',
        'FDM',
        Number.parseFloat(/(0\.[123])mm/.exec(profileName)[1]),
        { prusaProfile: profileName },
        null
    );
    assert.equal(selection.isValid, true, profileName);
    return resolveBuildVolumeLimits(
        'prusa', 'FDM', selection.baseConfigFile, null, selection.baseConfigFile
    );
}

function resolveOrcaLimits(profileName) {
    const selection = resolveProfileSelection(
        'orca',
        'FDM',
        0.2,
        { orcaMachineProfile: profileName, orcaProcessProfile: 'FDM_0.2mm.json' },
        'PLA'
    );
    assert.equal(selection.isValid, true, profileName);
    return resolveBuildVolumeLimits(
        'orca',
        'FDM',
        selection.baseConfigFile,
        selection.orcaMachineConfigFile,
        selection.orcaMachineConfigFile
    );
}

test('all three Prusa quote profiles change only declared envelope and warning comments', () => {
    for (const layer of PRUSA_LAYERS) {
        const p1sName = `FDM_${layer}mm.ini`;
        const quoteName = `${PRUSA_QUOTE_PREFIX}${layer}mm.ini`;
        const p1s = readIniKeyValues(path.join(PRUSA_CONFIGS_DIR, p1sName));
        const quote = readIniKeyValues(path.join(PRUSA_CONFIGS_DIR, quoteName));

        assert.equal(quote.bed_shape, '0x0,350x0,350x320,0x320');
        assert.equal(quote.max_print_height, '325');
        delete p1s.bed_shape;
        delete p1s.max_print_height;
        delete quote.bed_shape;
        delete quote.max_print_height;
        assert.deepEqual(quote, p1s, quoteName);

        const source = fs.readFileSync(path.join(PRUSA_CONFIGS_DIR, quoteName), 'utf8');
        assert.match(source, /QUOTING ONLY: H2D-size envelope with P1S-derived physics/);
        assert.match(source, /NOT a production H2D G-code profile/);
    }
});

test('Orca quote profile preserves the working P1S compatibility identity and physics', () => {
    const p1s = JSON.parse(fs.readFileSync(path.join(ORCA_CONFIGS_DIR, ORCA_P1S), 'utf8'));
    const quote = JSON.parse(fs.readFileSync(path.join(ORCA_CONFIGS_DIR, ORCA_QUOTE), 'utf8'));
    assert.equal(quote.setting_id, p1s.setting_id);
    assert.equal(quote.name, p1s.name);
    assert.equal(quote.name, 'MyMarlin 0.4 nozzle');
    assert.deepEqual(quote.printable_area, ['0x0', '350x0', '350x320', '0x320']);
    assert.equal(quote.printable_height, '325');
    assert.equal(
        quote.machine_start_gcode,
        `; QUOTING ONLY - P1S PHYSICS ON H2D-SIZE BED - NOT PRODUCTION H2D G-CODE\n${p1s.machine_start_gcode}`
    );

    delete p1s.printable_area;
    delete p1s.printable_height;
    delete p1s.machine_start_gcode;
    delete quote.printable_area;
    delete quote.printable_height;
    delete quote.machine_start_gcode;
    assert.deepEqual(quote, p1s);

    for (const layer of PRUSA_LAYERS) {
        const process = JSON.parse(fs.readFileSync(
            path.join(ORCA_CONFIGS_DIR, `FDM_${layer}mm.json`),
            'utf8'
        ));
        assert.deepEqual(process.compatible_printers, [quote.name]);
    }
});

test('P1S physical dimensions stay declared while runtime max is exact native ceiling', () => {
    for (const layer of PRUSA_LAYERS) {
        const profile = `FDM_${layer}mm.ini`;
        const limits = resolvePrusaLimits(profile);
        assert.deepEqual(limits.declaredMax, { x: 256, y: 256, z: 250 });
        assert.deepEqual(
            limits.largestPassingDimensionsInclusive,
            P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM.prusa[profile]
        );
        assert.deepEqual(limits.max, limits.largestPassingDimensionsInclusive);
    }
    const orca = resolveOrcaLimits(ORCA_P1S);
    assert.deepEqual(orca.declaredMax, { x: 256, y: 256, z: 250 });
    assert.deepEqual(
        orca.largestPassingDimensionsInclusive,
        P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM.orca[ORCA_P1S]
    );
    assert.deepEqual(orca.max, orca.largestPassingDimensionsInclusive);
});

test('measured H2D quote ceilings remain separate from declared profile dimensions', () => {
    const constantsSource = fs.readFileSync(
        path.join(__dirname, '../../../app/config/constants.js'),
        'utf8'
    );
    assert.match(constantsSource, /Exact-image measured H2D-sized quote ceilings/);
    assert.match(constantsSource, /reproduced every largest PASS and next 0\.1 mm/);

    for (const layer of PRUSA_LAYERS) {
        const profile = `${PRUSA_QUOTE_PREFIX}${layer}mm.ini`;
        const limits = resolvePrusaLimits(profile);
        assert.deepEqual(limits.declaredMax, { x: 350, y: 320, z: 325 });
        assert.deepEqual(
            limits.largestPassingDimensionsInclusive,
            H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM.prusa[profile]
        );
        assert.deepEqual(limits.max, { x: 350, y: 320, z: 324.9 });
    }
    const orca = resolveOrcaLimits(ORCA_QUOTE);
    assert.deepEqual(orca.declaredMax, { x: 350, y: 320, z: 325 });
    assert.deepEqual(
        orca.largestPassingDimensionsInclusive,
        H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM.orca[ORCA_QUOTE]
    );
    assert.deepEqual(orca.max, { x: 347.9, y: 317.9, z: 324.9 });
});

test('runtime max is inclusive and rejects the first value above each native ceiling', () => {
    for (const limits of [
        resolvePrusaLimits('FDM_0.2mm.ini'),
        resolveOrcaLimits(ORCA_P1S),
        resolvePrusaLimits(`${PRUSA_QUOTE_PREFIX}0.2mm.ini`),
        resolveOrcaLimits(ORCA_QUOTE)
    ]) {
        assert.equal(
            validateModelDimensionsAgainstLimits({ ...limits.max }, limits).isValid,
            true
        );
        for (const axis of ['x', 'y', 'z']) {
            const above = { ...limits.max, [axis]: limits.max[axis] + 0.001 };
            const validation = validateModelDimensionsAgainstLimits(above, limits);
            assert.equal(validation.isValid, false, `${limits.sourceProfile}:${axis}`);
            assert.equal(validation.tooLarge.length, 1, `${limits.sourceProfile}:${axis}`);
        }
    }
});
