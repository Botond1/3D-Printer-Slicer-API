'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const { ROUTE_AUDIENCES, classifyRoute } = require('../../../app/config/route-policy');
const createSwaggerDocument = require('../../../app/docs/swagger-docs');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('POST /render is classified as slice audience for auth/CORS and nothing else widens', () => {
    assert.equal(classifyRoute('POST', '/render'), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('POST', '/render/'), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('POST', '/render?x=1'), ROUTE_AUDIENCES.SLICE);
    assert.equal(classifyRoute('GET', '/render'), ROUTE_AUDIENCES.PUBLIC);
    assert.equal(classifyRoute('POST', '/render/extra'), ROUTE_AUDIENCES.PUBLIC);
    assert.equal(classifyRoute('POST', '/renders'), ROUTE_AUDIENCES.PUBLIC);
});

test('server registers the render router with the slice-service authenticator after the slice router', () => {
    const source = read('app/server.js');
    assert.match(source, /const \{ createRenderRouter \} = require\('\.\/routes\/render\.routes'\);/);
    assert.match(source, /const renderRoutes = createRenderRouter\(\{\s*authenticate: createRequireSliceService\(/);
    const sliceIndex = source.indexOf('app.use(sliceRoutes);');
    const renderIndex = source.indexOf('app.use(renderRoutes);');
    const catchAllIndex = source.indexOf("app.all('*'");
    assert.ok(sliceIndex > 0 && renderIndex > sliceIndex && catchAllIndex > renderIndex);
});

test('OpenAPI documents POST /render as an image/png slice-authenticated multipart operation', () => {
    const document = createSwaggerDocument({ FDM: {}, SLA: {} });
    const operation = document.paths['/render'].post;
    assert.deepEqual(operation.security, [{ SliceServiceApiKey: [] }]);
    assert.deepEqual(operation.parameters, [{
        name: 'x-slicer-api-key', in: 'header', required: true,
        schema: { type: 'string' }, description: 'Scoped slice-service API credential.'
    }]);
    const body = operation.requestBody.content['multipart/form-data'].schema;
    assert.deepEqual(body.required, ['choosenFile']);
    for (const field of [
        'choosenFile', 'orientationMode', 'sizeUnit', 'keepProportions',
        'targetSizeX', 'targetSizeY', 'targetSizeZ', 'scalePercent',
        'rotationX', 'rotationY', 'rotationZ'
    ]) {
        assert.ok(Object.hasOwn(body.properties, field), field);
    }
    assert.deepEqual(body.properties.orientationMode.enum, ['auto', 'preserve']);
    assert.equal(body.properties.orientationMode.default, 'auto');
    const success = operation.responses[200];
    assert.deepEqual(Object.keys(success.content), ['image/png']);
    assert.deepEqual(success.content['image/png'].schema, { type: 'string', format: 'binary' });
    assert.deepEqual(success.headers['Content-Type'].schema.enum, ['image/png']);
    assert.match(success.description, /1024x768/);
    assert.match(success.description, /byte-identical/);
    assert.deepEqual(operation.responses[401], document.paths['/prusa/slice'].post.responses[401]);
    const validation = operation.responses[422].content['application/json'].schema.properties.errorCode.enum;
    assert.deepEqual(validation, ['MODEL_DIMENSIONS_UNAVAILABLE', 'MODEL_OUT_OF_PRINTER_BOUNDS', 'FILE_PROCESSING_TIMEOUT']);
    const badRequest = operation.responses[400].content['application/json'].schema.properties.errorCode.enum;
    for (const code of ['UNSUPPORTED_FILE_FORMAT', 'INVALID_ORIENTATION_MODE', 'INVALID_SOURCE_GEOMETRY']) {
        assert.ok(badRequest.includes(code), code);
    }
    assert.ok(document.tags.some((tag) => tag.name === 'Preview'));
});

test('renderer helper ships beside the other Python helpers and Pillow is pinned in requirements', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'app', 'render_preview.py')), true);
    const helper = read('app/render_preview.py');
    assert.match(helper, /from PIL import Image, ImageDraw, ImageFont/);
    assert.match(helper, /Image\.LANCZOS/);
    assert.match(helper, /ImageFont\.load_default/);
    assert.doesNotMatch(helper, /import random|np\.random|random\.|time\.time|datetime|truetype\(/);
    assert.match(helper, /BACKGROUND_RGB = \(245, 245, 245\)/);
    assert.match(helper, /O_EXCL/);
    const requirements = read('requirements.txt').split(/\r?\n/).filter(Boolean);
    assert.ok(requirements.includes('Pillow==12.3.0'), requirements.join(','));
    assert.ok(requirements.includes('trimesh==5.1.0'));
    assert.ok(requirements.includes('numpy==2.5.2'));
});

test('render service composes the slice pipeline instead of copying it and bounds its own renderer timeout', () => {
    const source = read('app/services/render.service.js');
    assert.match(source, /require\('\.\/slice\/pipeline'\)/);
    assert.match(source, /require\('\.\/slice\/transform'\)/);
    assert.match(source, /createSliceHandlers\(\{ \.\.\.options, processSliceImpl: processRender \}\)/);
    assert.match(source, /createCommandRunner\(\{ timeoutMs: RENDER_COMMAND_TIMEOUT_MS \}\)/);
    assert.match(source, /const RENDER_COMMAND_TIMEOUT_MS = 60_000;/);
    assert.doesNotMatch(source, /shell:\s*true|child_process|exec\(/);
    assert.match(source, /path\.join\(APPLICATION_ROOT, RENDER_HELPER_NAME\)/);
    const route = read('app/routes/render.routes.js');
    assert.match(route, /router\.post\(RENDER_ROUTE_PATH, rateLimiter, authenticate, lifecycle\(handler, 'render'\)\)/);
    const lifecycle = read('app/routes/upload-lifecycle.js');
    assert.match(lifecycle, /safeUploadError,\s*assertPersistedUpload\s*\} = require\('\.\/slice\.routes'\)/);
    assert.match(lifecycle, /flags: 'wx', mode: 0o600/);
});
