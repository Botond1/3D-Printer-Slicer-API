'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const { multipart, request, createHarness } = require('./helpers/s1a-live-http');
const { createSliceHandlers } = require('../../../app/services/slice.service');
const {
    SliceQueueFullError,
    SliceQueueClientLimitError,
    SliceQueueTimeoutError
} = require('../../../app/services/slice/queue');

const file = (name = 'tiny.stl', value = 'solid synthetic') => ({ name: 'choosenFile', filename: name, value });
const limits = (overrides = {}) => ({ fileSize: 1024, files: 1, fields: 40, parts: 42,
    fieldNameSize: 64, fieldSize: 64, fieldNestingDepth: 0, ...overrides });

async function expectCase(t, parts, expected, options = {}, payloadOptions = {}) {
    const harness = await createHarness(t, options);
    const response = await request(harness.port, multipart(parts, undefined, payloadOptions.close !== false));
    assert.equal(response.status, expected.status);
    if (expected.code) assert.equal(response.body.errorCode, expected.code);
    await harness.waitSettled();
    await harness.assertClean();
    return response;
}

function actualQueueAwareHandler() {
    return createSliceHandlers({
        enqueueSliceJobImpl: (task) => task(),
        getClientIpImpl: () => 'synthetic-client'
    }).handleSlicePrusa;
}

test('accepts tiny file with complete concurrent legitimate flat field and alias inventory', async (t) => {
    const names = [
        'layerHeight', 'material', 'infill', 'printerProfile', 'prusaProfile', 'profile',
        'orcaMachineProfile', 'processProfile', 'orcaProcessProfile', 'sizeUnit', 'unit', 'dimensionUnit',
        'keepProportions', 'lockProportions', 'unlockProportions', 'allowNonProportional',
        'targetSizeX', 'sizeX', 'dimensionX', 'targetX', 'targetSizeY', 'sizeY', 'dimensionY', 'targetY',
        'targetSizeZ', 'sizeZ', 'dimensionZ', 'targetZ', 'scalePercent',
        'rotationX', 'rotateX', 'rotationY', 'rotateY', 'rotationZ', 'rotateZ'
    ];
    const fields = names.map((name) => ({ name, value: name.includes('Profile') || name === 'profile' ? 'profile.ini' : '1' }));
    const response = await expectCase(t, [file(), ...fields], { status: 200 });
    assert.equal(response.body.fields.length, names.length);
    assert.equal(response.body.file, true);
});

test('rejects too many fields', (t) => expectCase(t, [file(), ...Array.from({ length: 41 }, (_, i) => ({ name: `f${i}`, value: 'x' }))],
    { status: 413, code: 'TOO_MANY_UPLOAD_FIELDS' }, { multipartLimits: limits() }));
test('rejects a field name above the configured maximum', (t) => expectCase(t, [file(), { name: 'x'.repeat(65), value: 'x' }],
    { status: 400, code: 'UPLOAD_FIELD_NAME_TOO_LONG' }, { multipartLimits: limits() }));
test('rejects an oversized field value', (t) => expectCase(t, [file(), { name: 'material', value: 'x'.repeat(65) }],
    { status: 413, code: 'UPLOAD_FIELD_TOO_LARGE' }, { multipartLimits: limits() }));
test('rejects too many multipart parts', (t) => expectCase(t, [file(), ...Array.from({ length: 3 }, (_, i) => ({ name: `f${i}`, value: 'x' }))],
    { status: 413, code: 'TOO_MANY_MULTIPART_PARTS' }, { multipartLimits: limits({ fields: 10, parts: 3 }) }));
test('rejects two choosenFile files', (t) => expectCase(t, [file(), file('second.stl')],
    { status: 400, code: 'TOO_MANY_UPLOAD_FILES' }, { multipartLimits: limits() }));
test('rejects oversized file under injected small limit', (t) => expectCase(t, [file('large.stl', Buffer.alloc(33))],
    { status: 413, code: 'UPLOADED_FILE_TOO_LARGE' }, { multipartLimits: limits({ fileSize: 32 }) }));
test('rejects unexpected file field', (t) => expectCase(t, [{ name: 'file', filename: 'tiny.stl', value: 'solid x' }],
    { status: 400, code: 'UNEXPECTED_FILE_FIELD' }, { multipartLimits: limits() }));
test('rejects unsupported extension', (t) => expectCase(t, [file('tiny.exe')],
    { status: 400, code: 'UNSUPPORTED_FILE_FORMAT' }, { multipartLimits: limits() }));

test('missing file reaches the real queue-aware service contract and cleans', (t) => expectCase(t, [{ name: 'material', value: 'PLA' }],
    { status: 400, code: 'NO_FILE_UPLOADED' }, { multipartLimits: limits(), handler: actualQueueAwareHandler() }));

test('normalizes malformed/truncated multipart and cleans file-first residue', (t) => expectCase(t, [file()],
    { status: 400, code: 'INVALID_MULTIPART_REQUEST' }, { multipartLimits: limits() }, { close: false }));

test('partial file upload abort settles cleanup after persisted-byte event without a response contract', async (t) => {
    let persistedResolve;
    const persisted = new Promise((resolve) => { persistedResolve = resolve; });
    let watcher;
    const harness = await createHarness(t, {
        multipartLimits: limits({ fileSize: 256 * 1024 }),
        async createWorkspace(paths) {
            const workspace = await require('../../../app/services/slice/workspace').createJobWorkspace(paths);
            watcher = fsSync.watch(workspace.directory, (_event, filename) => {
                if (filename && filename !== '.workspace-owner.json') {
                    watcher.close();
                    persistedResolve();
                }
            });
            return workspace;
        }
    });
    t.after(() => watcher?.close());
    const boundary = 's1a-partial-abort';
    const prefix = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="choosenFile"; filename="partial.stl"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        Buffer.alloc(16 * 1024, 0x61)
    ]);
    const clientDone = new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1', port: harness.port, path: '/prusa/slice', method: 'POST',
            headers: {
                'content-type': `multipart/form-data; boundary=${boundary}`,
                'content-length': prefix.length + 64 * 1024
            }
        });
        req.on('error', resolve);
        req.on('close', resolve);
        req.write(prefix);
        persisted.then(() => req.destroy());
    });
    await persisted;
    await clientDone;
    await harness.waitSettled();
    await harness.assertClean();
});

test('live slow multipart upload returns stable 408, closes the connection, and leaves no residue', async (t) => {
    const policy = {
        ...require('../../../app/config/resource-policy').resolveResourcePolicy({}),
        UPLOAD_TOTAL_TIMEOUT_MS: 30
    };
    const harness = await createHarness(t, {
        multipartLimits: limits({ fileSize: 256 * 1024 }),
        resourcePolicy: policy
    });
    const boundary = 'i4-live-upload-timeout';
    const prefix = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="choosenFile"; filename="slow.stl"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        Buffer.alloc(1024, 0x61)
    ]);
    const response = await new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: harness.port,
            path: '/prusa/slice',
            method: 'POST',
            headers: {
                'content-type': `multipart/form-data; boundary=${boundary}`,
                'content-length': prefix.length + 64 * 1024
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                req.destroy();
                resolve({
                    status: res.statusCode,
                    connection: res.headers.connection,
                    body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
                });
            });
        });
        req.on('error', reject);
        req.write(prefix);
    });
    assert.equal(response.status, 408);
    assert.equal(response.connection, 'close');
    assert.equal(response.body.errorCode, 'UPLOAD_TOTAL_TIMEOUT');
    await harness.waitSettled();
    await harness.assertClean();
});

test('real downstream option validation response settles before cleanup', (t) => expectCase(t, [
    file(),
    { name: 'sizeUnit', value: 'parsecs' }
],
    { status: 400, code: 'INVALID_SIZE_UNIT' }, { multipartLimits: limits(), handler: actualQueueAwareHandler() }));
test('downstream throw is safely mapped after cleanup', (t) => expectCase(t, [file()],
    { status: 500, code: 'INTERNAL_SERVER_ERROR' }, { multipartLimits: limits(), handler() { throw new Error('synthetic queue rejection'); } }));
test('successful fake downstream response cleans workspace', (t) => expectCase(t, [file()], { status: 200 }, { multipartLimits: limits() }));

for (const [QueueError, status, code] of [
    [SliceQueueFullError, 503, 'SLICE_QUEUE_FULL'],
    [SliceQueueClientLimitError, 429, 'SLICE_QUEUE_CLIENT_LIMIT'],
    [SliceQueueTimeoutError, 503, 'SLICE_QUEUE_TIMEOUT']
]) {
    test(`existing queue ${code} mapping settles before workspace cleanup`, (t) => {
        const handlers = createSliceHandlers({
            enqueueSliceJobImpl: async () => { throw new QueueError(); },
            getClientIpImpl: () => 'synthetic-client'
        });
        return expectCase(
            t,
            [file()],
            { status, code },
            { multipartLimits: limits(), handler: handlers.handleSlicePrusa }
        );
    });
}

for (const variant of [undefined, Infinity, 1]) {
    test(`mutation proof: nesting depth ${String(variant)} admits nested field while secure default rejects it`, async (t) => {
        const mutated = limits();
        if (variant === undefined) delete mutated.fieldNestingDepth;
        else mutated.fieldNestingDepth = variant;
        const response = await expectCase(t, [file(), { name: 'a[b]', value: 'x' }], { status: 200 }, { multipartLimits: mutated });
        assert.ok(response.body.fields.includes('a'));
    });
}

for (const scenario of ['multer error', 'handler rejection']) {
    test(`mutation proof: skipped cleanup leaves residue after ${scenario}`, async (t) => {
        const options = { multipartLimits: limits(), cleanupWorkspace: async () => {} };
        const parts = scenario === 'multer error' ? [file(), { name: 'a[b]', value: 'x' }] : [file()];
        if (scenario === 'handler rejection') options.handler = () => { throw new Error('queue rejected'); };
        const harness = await createHarness(t, options);
        await request(harness.port, multipart(parts));
        await harness.waitSettled();
        assert.notDeepEqual(await fs.readdir(harness.jobsRoot), []);
    });
}
