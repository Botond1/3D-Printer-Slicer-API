'use strict';

/**
 * The 3.9.0 image golden gate (§4.11, §7): inside the exact built image,
 *  1. recompute the 23-file processing digest from `/app/<name>` and compare
 *     it with `generation-inputs-3.8.3.json`;
 *  2. compare `python -m pip freeze --all` (without pip, setuptools, wheel)
 *     with `python-geometry-stack-3.8.3.txt`;
 *  3. require `choom` on the image PATH (§4.6);
 *  4. start the image with throwaway keys and no network, read `GET /profiles`
 *     and `GET /profiles?contract=material-v1` from inside, and compare both
 *     `catalogue_sha256` values and every row's identity with
 *     `catalogue-3.8.3.json`;
 *  5. when the image answers `GET /capabilities` with export enabled, export
 *     a synthetic 40 mm cube (`preserve`) and check the body's sha256 against
 *     `X-R3D-Export-Sha256` (3.8.x answers 404: not applicable).
 *
 * The comparison functions are pure and unit-tested
 * (`tests/unit/js/generation-golden.test.js`); the CLI drives Docker with
 * argument vectors only (no shell) and removes its own container.
 *
 * Usage: node tests/golden/image-golden-gate.js <image-ref>
 * Env: SERVICE_UID, SERVICE_GID (the image's resolved service identity),
 *      GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT (container name), GITHUB_STEP_SUMMARY.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const GOLDEN_DIR = __dirname;
const IDENTITY_KEYS = Object.freeze(['measurement_generation', 'engine_version', 'engine_build_sha256',
    'profile_bundle_sha256', 'effective_profile_sha256']);
const FREEZE_EXCLUDED = new Set(['pip', 'setuptools', 'wheel']);

function readGolden(name) {
    return fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function loadGoldens() {
    return {
        generation: JSON.parse(readGolden('generation-inputs-3.8.3.json')),
        freeze: readGolden('python-geometry-stack-3.8.3.txt'),
        catalogue: JSON.parse(readGolden('catalogue-3.8.3.json'))
    };
}

/**
 * The processing digest exactly as `bambu-generation.js:46` computes it.
 * @param {string[]} names `processingFiles` names (relative to `app/`).
 * @param {(name: string) => Buffer} readBytes Bytes of `app/<name>`.
 * @param {(value: unknown) => string} hashValue The service's `receipt-hash` hashValue.
 * @returns {{files: {name: string, sha256: string}[], processing_sha256: string}} Digest.
 */
function computeGenerationInputs(names, readBytes, hashValue) {
    const files = names.map((name) => ({ name, sha256: createHash('sha256').update(readBytes(name)).digest('hex') }));
    return { files, processing_sha256: hashValue(files) };
}

/** @returns {string[]} Differences between a computed digest and the golden. */
function compareGenerationInputs(actual, golden) {
    const reasons = [];
    if (actual.processing_schema !== undefined && actual.processing_schema !== golden.processing_schema) {
        reasons.push(`processing_schema ${actual.processing_schema} != ${golden.processing_schema}`);
    }
    const expected = new Map(golden.files.map((file) => [file.name, file.sha256]));
    if (actual.files.length !== golden.files.length
        || actual.files.some((file, index) => file.name !== golden.files[index].name)) {
        reasons.push('the processing file list differs from the 3.8.3 golden');
    }
    for (const file of actual.files) {
        if (expected.get(file.name) !== file.sha256) reasons.push(`${file.name} ${file.sha256} != ${expected.get(file.name)}`);
    }
    if (actual.processing_sha256 !== golden.processing_sha256) {
        reasons.push(`processing_sha256 ${actual.processing_sha256} != ${golden.processing_sha256}`);
    }
    return reasons;
}

/** `pip freeze` lines without pip/setuptools/wheel, sorted by normalized name. */
function normalizeFreeze(text) {
    return String(text).replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
        .filter((line) => !FREEZE_EXCLUDED.has(line.split(/[=<>!~ @]/)[0].toLowerCase().replace(/_/g, '-')))
        .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

/** @returns {string[]} Differences between an image freeze and the golden. */
function compareFreeze(actualText, goldenText) {
    const actual = normalizeFreeze(actualText);
    const golden = normalizeFreeze(goldenText);
    const reasons = [];
    for (const line of golden) if (!actual.includes(line)) reasons.push(`missing or moved: ${line}`);
    for (const line of actual) if (!golden.includes(line)) reasons.push(`not in the 3.8.3 freeze: ${line}`);
    return reasons;
}

/**
 * The comparable view of one catalogue answer.
 * @param {string} route Request path.
 * @param {number} status HTTP status.
 * @param {string} bodyText Exact body.
 */
function catalogueView(route, status, bodyText) {
    const body = JSON.parse(bodyText);
    const rows = Array.isArray(body.profiles) ? body.profiles : [];
    return {
        path: route,
        status,
        schema: body.schema,
        catalogue_sha256: body.catalogue_sha256,
        body_sha256: createHash('sha256').update(bodyText, 'utf8').digest('hex'),
        row_count: rows.length,
        rows: rows.map((row) => {
            const view = { id: row.id };
            for (const key of IDENTITY_KEYS) if (Object.hasOwn(row, key)) view[key] = row[key];
            return view;
        })
    };
}

/**
 * Compare the image's two catalogue views with the 3.8.3 golden: status,
 * schema, `catalogue_sha256`, the row set and every row's identity keys
 * (a key absent at 3.8.3 must stay absent). `body_sha256` is not compared
 * here: a 3.9.0 catalogue may legitimately differ in non-identity text; the
 * byte equality of the bodies is §8's private-container check.
 * @returns {string[]} Differences.
 */
function compareCatalogue(actual, golden) {
    const reasons = [];
    for (const key of ['v2', 'v3']) {
        const have = actual[key];
        const want = golden[key];
        if (!have) { reasons.push(`${key}: no answer`); continue; }
        for (const field of ['status', 'schema', 'catalogue_sha256', 'row_count']) {
            if (have[field] !== want[field]) reasons.push(`${key}.${field} ${have[field]} != ${want[field]}`);
        }
        const rows = new Map(have.rows.map((row) => [row.id, row]));
        for (const expected of want.rows) {
            const row = rows.get(expected.id);
            if (!row) { reasons.push(`${key}: row ${expected.id} missing`); continue; }
            for (const field of IDENTITY_KEYS) {
                if (Object.hasOwn(expected, field) !== Object.hasOwn(row, field) || row[field] !== expected[field]) {
                    reasons.push(`${key}: ${expected.id} ${field} ${row[field]} != ${expected[field]}`);
                }
            }
        }
        const known = new Set(want.rows.map((row) => row.id));
        for (const row of have.rows) if (!known.has(row.id)) reasons.push(`${key}: unexpected row ${row.id}`);
    }
    return reasons;
}

/** A 40 mm binary STL cube (12 triangles), the synthetic control of the export smoke. */
function cubeStl(size = 40) {
    const v = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0], [0, 0, size], [size, 0, size], [size, size, size], [0, size, size]];
    const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const buffer = Buffer.alloc(84 + faces.length * 50);
    buffer.write('r3d synthetic export control cube', 0, 'ascii');
    buffer.writeUInt32LE(faces.length, 80);
    faces.forEach((face, index) => {
        const offset = 84 + index * 50;
        face.forEach((vertex, corner) => v[vertex].forEach((value, axis) => buffer.writeFloatLE(value, offset + 12 + corner * 12 + axis * 4)));
    });
    return buffer;
}

// ---------------------------------------------------------------- Docker CLI

const IN_IMAGE_GENERATION = `
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { hashValue } = require('/app/services/slice/receipt-hash');
const source = fs.readFileSync('/app/services/slice/bambu-generation.js', 'utf8');
const list = /const processingFiles = \\[([\\s\\S]*?)\\];/.exec(source);
const schema = /const PROCESSING_SCHEMA = '([^']+)';/.exec(source);
const names = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const files = names.map((name) => ({ name, sha256: createHash('sha256').update(fs.readFileSync('/app/' + name)).digest('hex') }));
process.stdout.write(JSON.stringify({ processing_schema: schema[1], files, processing_sha256: hashValue(files) }));
`;

const IN_CONTAINER_HTTP = `
const http = require('node:http');
const [method, target, key, bodyBase64, headersJson] = process.argv.slice(1);
const body = bodyBase64 ? Buffer.from(bodyBase64, 'base64') : null;
const headers = { ...(headersJson ? JSON.parse(headersJson) : {}) };
if (key) headers['x-slicer-api-key'] = key;
if (body) headers['content-length'] = body.length;
const req = http.request({ host: '127.0.0.1', port: 3000, path: target, method, headers, timeout: 120000 }, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => process.stdout.write(JSON.stringify({ status: res.statusCode, headers: res.headers,
    body: Buffer.concat(chunks).toString('base64') })));
});
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', (e) => { process.stdout.write(JSON.stringify({ status: 0, error: e.message })); });
req.end(body || undefined);
`;

const THROWAWAY_SLICE_KEY = 'i5-validation-slice-active-260723-a1';

function docker(args, { input, timeout = 120_000 } = {}) {
    const result = spawnSync('docker', args, { encoding: 'utf8', input, timeout, maxBuffer: 64 * 1024 * 1024, shell: false });
    if (result.error) throw new Error(`docker ${args[0]} failed to start: ${result.error.message}`);
    return result;
}

function inImage(imageRef, entrypoint, args) {
    const result = docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--entrypoint', entrypoint, imageRef, ...args]);
    if (result.status !== 0) throw new Error(`in-image ${entrypoint} exited ${result.status}: ${String(result.stderr).slice(0, 400)}`);
    return result.stdout;
}

function containerHttp(name, method, target, { key = '', body = null, headers = null } = {}) {
    const result = docker(['exec', name, 'node', '-e', IN_CONTAINER_HTTP, method, target, key,
        body ? body.toString('base64') : '', headers ? JSON.stringify(headers) : '']);
    if (result.status !== 0) return { status: 0, error: String(result.stderr).slice(0, 400) };
    const parsed = JSON.parse(result.stdout);
    if (parsed.body !== undefined) parsed.body = Buffer.from(parsed.body, 'base64');
    return parsed;
}

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function startGoldenContainer(imageRef, name) {
    const uid = process.env.SERVICE_UID;
    const gid = process.env.SERVICE_GID;
    if (!/^[1-9][0-9]*$/.test(String(uid)) || !/^[1-9][0-9]*$/.test(String(gid))) throw new Error('SERVICE_UID/SERVICE_GID are required.');
    const tmpfs = (target) => `${target}:rw,nosuid,nodev,noexec,size=64m,uid=${uid},gid=${gid},mode=0700`;
    const result = docker(['run', '--detach', '--name', name, '--pull', 'never', '--restart', 'no', '--network', 'none',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--pids-limit', '512',
        '--memory', '4g', '--memory-swap', '4g', '--cpus', '2', '--stop-timeout', '30',
        '--log-driver', 'json-file', '--log-opt', 'max-size=20m', '--log-opt', 'max-file=5',
        '--tmpfs', tmpfs('/app/input'), '--tmpfs', tmpfs('/app/output'), '--tmpfs', tmpfs('/app/configs/pricing-state'),
        '--tmpfs', tmpfs('/tmp'),
        '--env', `SLICE_SERVICE_API_KEY=${THROWAWAY_SLICE_KEY}`,
        '--env', 'SLICE_SERVICE_API_KEY_PREVIOUS=i5-validation-slice-previous-260723-a2',
        '--env', 'PRICING_API_KEY=i5-validation-pricing-active-260723-b1',
        '--env', 'PRICING_API_KEY_PREVIOUS=i5-validation-pricing-previous-260723-b2',
        '--env', 'ARTIFACT_API_KEY=i5-validation-artifact-active-260723-c1',
        '--env', 'ARTIFACT_API_KEY_PREVIOUS=i5-validation-artifact-previous-260723-c2',
        '--env', 'OPERATIONS_API_KEY=i5-validation-operations-active-260723-d1',
        '--env', 'OPERATIONS_API_KEY_PREVIOUS=i5-validation-operations-previous-260723-d2',
        '--env', `EXPECTED_SERVICE_UID=${uid}`, '--env', `EXPECTED_SERVICE_GID=${gid}`,
        '--env', 'EXPECTED_PIDS_LIMIT=512', '--env', 'EXPECTED_MEMORY_BYTES=4294967296', '--env', 'EXPECTED_CPU_LIMIT=2.0',
        '--env', 'EXPECTED_LOG_MAX_SIZE=20m', '--env', 'EXPECTED_LOG_MAX_FILES=5', '--env', 'EXPECTED_STOP_GRACE_PERIOD=30s',
        '--env', 'EXPORT_ROUTE_ENABLED=true',
        '--label', 'io.s3a.validation-only=true', imageRef]);
    if (result.status !== 0) throw new Error(`golden container did not start: ${String(result.stderr).slice(0, 400)}`);
}

function waitForHealth(name, timeoutMs = 240_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const running = docker(['inspect', '--format', '{{.State.Running}}', name]);
        if (running.stdout.trim() !== 'true') throw new Error('golden container exited before it became healthy.');
        if (containerHttp(name, 'GET', '/health').status === 200) return;
        sleep(2_000);
    }
    throw new Error('golden container did not answer /health 200 in time.');
}

function exportSmoke(name, capabilities, catalogue) {
    const generation = capabilities?.measurement_generation?.bambu;
    const row = catalogue.rows.find((candidate) => /^bambu:FDM:P1S:0\.2:PLA:/.test(candidate.id)) || null;
    if (!/^[a-f0-9]{64}$/.test(String(generation)) || !row) return ['export smoke: no generation or P1S 0.2 PLA row to export with'];
    const stl = cubeStl();
    const boundary = `r3dgate${createHash('sha256').update(stl).digest('hex').slice(0, 24)}`;
    const fields = [['material', 'PLA'], ['layerHeight', '0.200'], ['infill', '20%'], ['supports', 'false'],
        ['orientationMode', 'preserve'], ['printerProfile', 'P1S'], ['sizeUnit', 'mm'], ['rotationX', '0'], ['rotationY', '0'],
        ['rotationZ', '0'], ['expectedProfileSha256', row.effective_profile_sha256], ['expectedMeasurementGeneration', generation],
        ['exportFormat', 'stl'], ['expectedSourceSha256', createHash('sha256').update(stl).digest('hex')]];
    const parts = fields.map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="choosenFile"; filename="control-cube.stl"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(stl, Buffer.from(`\r\n--${boundary}--\r\n`));
    const answer = containerHttp(name, 'POST', '/bambu/export', {
        key: THROWAWAY_SLICE_KEY, body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
    });
    const reasons = [];
    if (answer.status !== 200) return [`export smoke: status ${answer.status} ${answer.body ? answer.body.toString('utf8').slice(0, 300) : answer.error}`];
    const sha = createHash('sha256').update(answer.body).digest('hex');
    if (answer.headers['x-r3d-export-sha256'] !== sha) reasons.push('export smoke: X-R3D-Export-Sha256 differs from the body');
    if (answer.headers['x-r3d-export-fidelity'] !== 'unverified') reasons.push('export smoke: fidelity without a geometry hash must be unverified');
    if (answer.body.length !== 84 + answer.body.readUInt32LE(80) * 50) reasons.push('export smoke: the body is not one binary STL');
    return reasons;
}

function runImageGate(imageRef, { log = console.log } = {}) {
    const goldens = loadGoldens();
    const failures = [];

    const generation = JSON.parse(inImage(imageRef, 'node', ['-e', IN_IMAGE_GENERATION]));
    failures.push(...compareGenerationInputs(generation, goldens.generation).map((reason) => `generation: ${reason}`));
    log(`In-image processing_sha256 ${generation.processing_sha256} (golden ${goldens.generation.processing_sha256})`);

    failures.push(...compareFreeze(inImage(imageRef, 'python', ['-m', 'pip', 'freeze', '--all']), goldens.freeze)
        .map((reason) => `pip freeze: ${reason}`));
    try {
        log(`choom: ${inImage(imageRef, 'sh', ['-c', 'command -v choom']).trim()}`);
    } catch (error) {
        failures.push(`choom is not on the image PATH (${error.message})`);
    }

    const name = `golden-gate-${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || '0'}`;
    try {
        startGoldenContainer(imageRef, name);
        waitForHealth(name);
        let views = null;
        let catalogueReasons = ['catalogue not read'];
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
            const v2 = containerHttp(name, 'GET', '/profiles');
            const v3 = containerHttp(name, 'GET', '/profiles?contract=material-v1');
            if (v2.status === 200 && v3.status === 200) {
                views = { v2: catalogueView('/profiles', 200, v2.body.toString('utf8')),
                    v3: catalogueView('/profiles?contract=material-v1', 200, v3.body.toString('utf8')) };
                catalogueReasons = compareCatalogue(views, goldens.catalogue);
                if (catalogueReasons.length === 0) break;
            }
            sleep(3_000);
        }
        failures.push(...catalogueReasons.map((reason) => `catalogue: ${reason}`));
        if (views) log(`Catalogue v2 ${views.v2.catalogue_sha256}, v3 ${views.v3.catalogue_sha256}`);

        const capabilities = containerHttp(name, 'GET', '/capabilities', { key: THROWAWAY_SLICE_KEY });
        if (capabilities.status === 404) {
            log('Export smoke: not applicable (GET /capabilities 404 = 3.8.x, no export route).');
        } else if (capabilities.status === 200) {
            const document = JSON.parse(capabilities.body.toString('utf8'));
            if (document?.export?.enabled !== true) failures.push('export smoke: EXPORT_ROUTE_ENABLED=true but /capabilities says export is off');
            else if (views) failures.push(...exportSmoke(name, document, views.v3));
        } else {
            failures.push(`capabilities: unexpected status ${capabilities.status}`);
        }
    } catch (error) {
        failures.push(error.message);
    } finally {
        docker(['rm', '--force', '--volumes', name]);
    }
    return failures;
}

if (require.main === module) {
    const imageRef = process.argv[2];
    if (!imageRef) {
        console.error('Usage: node tests/golden/image-golden-gate.js <image-ref>');
        process.exitCode = 2;
    } else {
        let failures;
        try {
            failures = runImageGate(imageRef);
        } catch (error) {
            failures = [error.message];
        }
        const summary = failures.length === 0
            ? '\n### Generation, Python stack and catalogue goldens\n\nThe image equals the 3.8.3 goldens (processing digest, pip freeze, catalogue identities); choom present.\n'
            : `\n### Generation, Python stack and catalogue goldens\n\nFAILED:\n${failures.map((reason) => `- ${reason.replace(/[`|<>]/g, '?')}`).join('\n')}\n`;
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
        for (const reason of failures) console.error(reason);
        process.exitCode = failures.length === 0 ? 0 : 1;
    }
}

module.exports = {
    IDENTITY_KEYS,
    IN_CONTAINER_HTTP,
    IN_IMAGE_GENERATION,
    catalogueView,
    compareCatalogue,
    compareFreeze,
    compareGenerationInputs,
    computeGenerationInputs,
    cubeStl,
    loadGoldens,
    normalizeFreeze,
    runImageGate
};
