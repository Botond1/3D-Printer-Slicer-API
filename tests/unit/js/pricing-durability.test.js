'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveResourcePolicy } = require('../../../app/config/resource-policy');
const { PricingRepository } = require('../../../app/services/pricing/repository');
const { PricingCatalog } = require('../../../app/services/pricing/catalog');
const { createPricingMutationCoordinator } = require('../../../app/services/pricing.service');

const DEFAULT_PRICING = { FDM: { PLA: 800 }, SLA: { Standard: 1800 } };

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pricing-durability-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return {
        root,
        stateRoot: path.join(root, 'pricing-state'),
        primaryFile: path.join(root, 'pricing-state', 'pricing.json')
    };
}

function repository(paths, injectedFs = fs, token = '11') {
    return new PricingRepository({
        primaryFile: paths.primaryFile,
        pricingStateRoot: paths.stateRoot,
        legacyFile: path.join(paths.root, 'pricing.json'),
        defaultPricing: DEFAULT_PRICING,
        fs: injectedFs,
        resourcePolicy: resolveResourcePolicy({}),
        randomBytes: () => Buffer.from(token.repeat(16), 'hex')
    });
}

function recordingFs(paths, behavior = {}) {
    const events = [];
    const handles = new Map();
    const fakeDirectoryHandle = 0x7ffffffe;
    const injected = Object.create(fs);
    injected.openSync = (target, flags, mode) => {
        events.push(['open', path.resolve(target), flags, mode]);
        if (path.resolve(target) === path.resolve(paths.stateRoot) && flags === 'r') {
            handles.set(fakeDirectoryHandle, path.resolve(target));
            return fakeDirectoryHandle;
        }
        if (behavior.openSync) return behavior.openSync(target, flags, mode);
        const handle = fs.openSync(target, flags, mode);
        handles.set(handle, path.resolve(target));
        return handle;
    };
    injected.writeSync = (handle, payload, offset, length, position) => {
        const requested = behavior.zeroWrite ? 0 : Math.min(length, behavior.shortWrite || length);
        events.push(['write', handles.get(handle), requested]);
        if (requested === 0) return 0;
        return fs.writeSync(handle, payload, offset, requested, position);
    };
    injected.fsyncSync = (handle) => {
        const target = handles.get(handle);
        events.push(['fsync', target]);
        if (target === path.resolve(paths.stateRoot)) {
            if (behavior.directorySyncError) throw behavior.directorySyncError;
            return;
        }
        if (behavior.fileSyncError) throw behavior.fileSyncError;
        fs.fsyncSync(handle);
    };
    injected.closeSync = (handle) => {
        events.push(['close', handles.get(handle)]);
        handles.delete(handle);
        if (handle !== fakeDirectoryHandle) fs.closeSync(handle);
    };
    injected.renameSync = (source, destination) => {
        events.push(['rename', path.resolve(source), path.resolve(destination)]);
        if (behavior.renameError) throw behavior.renameError;
        fs.renameSync(source, destination);
    };
    injected.rmSync = (target, options) => {
        events.push(['remove', path.resolve(target)]);
        fs.rmSync(target, options);
    };
    injected.events = events;
    return injected;
}

test('pricing write serializes before wx open and fully orders file/directory durability', async (t) => {
    const paths = await fixture(t);
    const injected = recordingFs(paths, { shortWrite: 7 });
    const target = repository(paths, injected);

    assert.throws(() => target.saveToPrimary({ FDM: { PLA: NaN }, SLA: { Standard: 1800 } }));
    assert.equal(injected.events.some(([event]) => event === 'open'), false);

    target.saveToPrimary({ FDM: { PLA: 900 }, SLA: { Standard: 1800 } });
    const tempOpen = injected.events.find((event) => event[0] === 'open' && event[2] === 'wx');
    assert.ok(tempOpen);
    assert.equal(tempOpen[3], 0o600);
    assert.ok(injected.events.filter(([event]) => event === 'write').length > 1);
    const fileSync = injected.events.findIndex((event) => event[0] === 'fsync' && event[1] !== path.resolve(paths.stateRoot));
    const rename = injected.events.findIndex((event) => event[0] === 'rename');
    const directorySync = injected.events.findIndex((event) => event[0] === 'fsync' && event[1] === path.resolve(paths.stateRoot));
    assert.ok(fileSync >= 0 && fileSync < rename && rename < directorySync);
    assert.deepEqual(JSON.parse(await fsp.readFile(paths.primaryFile, 'utf8')), {
        FDM: { PLA: 900 },
        SLA: { Standard: 1800 }
    });
    assert.deepEqual(await fsp.readdir(paths.stateRoot), ['pricing.json']);
});

test('zero write and file fsync failure preserve the exact prior catalog file and clean owned temps', async (t) => {
    const paths = await fixture(t);
    repository(paths).saveToPrimary(DEFAULT_PRICING);
    const original = await fsp.readFile(paths.primaryFile);

    for (const [token, behavior] of [
        ['22', { zeroWrite: true }],
        ['33', { fileSyncError: Object.assign(new Error('fsync failed'), { code: 'EIO' }) }]
    ]) {
        const injected = recordingFs(paths, behavior);
        assert.throws(
            () => repository(paths, injected, token).saveToPrimary({
                FDM: { PLA: 999 },
                SLA: { Standard: 1800 }
            })
        );
        assert.deepEqual(await fsp.readFile(paths.primaryFile), original);
        assert.deepEqual(await fsp.readdir(paths.stateRoot), ['pricing.json']);
        assert.ok(injected.events.some(([event]) => event === 'remove'));
    }
});

test('wx collision never overwrites or removes an unowned candidate temp', async (t) => {
    const paths = await fixture(t);
    await fsp.mkdir(paths.stateRoot);
    const collision = path.join(paths.stateRoot, `.pricing-owned-${'44'.repeat(16)}.tmp`);
    await fsp.writeFile(collision, 'not-owned');
    assert.throws(
        () => repository(paths, fs, '44').saveToPrimary(DEFAULT_PRICING),
        { code: 'EEXIST' }
    );
    assert.equal(await fsp.readFile(collision, 'utf8'), 'not-owned');
});

test('rename failure cleans the owned temp and leaves the primary byte-for-byte unchanged', async (t) => {
    const paths = await fixture(t);
    repository(paths).saveToPrimary(DEFAULT_PRICING);
    const original = await fsp.readFile(paths.primaryFile);
    const injected = recordingFs(paths, {
        renameError: Object.assign(new Error('rename failed'), { code: 'EIO' })
    });
    assert.throws(() => repository(paths, injected, '55').saveToPrimary({
        FDM: { PLA: 1000 },
        SLA: { Standard: 1800 }
    }), /rename failed/);
    assert.deepEqual(await fsp.readFile(paths.primaryFile), original);
    assert.deepEqual(await fsp.readdir(paths.stateRoot), ['pricing.json']);
});

test('unsupported directory fsync is tolerated only after atomic rename', async (t) => {
    const paths = await fixture(t);
    const injected = recordingFs(paths, {
        directorySyncError: Object.assign(new Error('unsupported'), { code: 'EINVAL' })
    });
    repository(paths, injected, '66').saveToPrimary(DEFAULT_PRICING);
    assert.deepEqual(JSON.parse(await fsp.readFile(paths.primaryFile, 'utf8')), DEFAULT_PRICING);
    const rename = injected.events.findIndex(([event]) => event === 'rename');
    const directorySync = injected.events.findIndex(
        (event) => event[0] === 'fsync' && event[1] === path.resolve(paths.stateRoot)
    );
    assert.ok(rename >= 0 && rename < directorySync);
});

test('pricing coordinator rolls back exactly and serializes concurrent candidates', async () => {
    const catalog = new PricingCatalog(DEFAULT_PRICING);
    const persisted = [];
    const coordinator = createPricingMutationCoordinator({
        saveToPrimary(candidate) {
            persisted.push(structuredClone(candidate));
            if (candidate.FDM.FAIL) throw new Error('failure');
        }
    }, catalog);
    await assert.rejects(coordinator((candidate) => {
        candidate.FDM.PLA = 999;
        candidate.FDM.FAIL = 1;
    }));
    assert.deepEqual(catalog.getPricing(), DEFAULT_PRICING);
    const first = coordinator((candidate) => { candidate.FDM.PLA = 900; return 1; });
    const second = coordinator((candidate) => { candidate.FDM.PLA += 100; return 2; });
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(persisted.slice(-2).map((value) => value.FDM.PLA), [900, 1000]);
    assert.equal(catalog.getPricing().FDM.PLA, 1000);
});
