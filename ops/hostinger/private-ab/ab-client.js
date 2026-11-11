#!/usr/bin/env node
'use strict';

/**
 * Private A/B measurement client for slicer 3.9.0 (spec §8 step 1, §7 T-EXP,
 * T-AUTH, /ready latency, corpus A/B). Runs as a second container on the
 * internal network r3d-s390-internal, from the SAME slicer image, with
 * `--entrypoint node`. It talks only to r3d-s390-private:3000.
 *
 * Dependency-free: Node core only (http, fs, path, crypto, zlib; zlib is used
 * only to inflate the export's 3MF for the round-trip check).
 *
 * Keys come from process.env (the 0600 env file passed with --env-file) and
 * are NEVER printed or written: every line and file goes through redact().
 *
 * Subcommands (see README-ab.md for the operator sequence):
 *   corpus <A|B> <run> [--only id,id] [--skip id,id]
 *   catalogue <A|B>
 *   capabilities <A|B>
 *   auth <A|B>
 *   ready <seconds> [A|B]
 *   export <run>                    (side B)
 *   delete-artifact                 (side B)
 *   compare
 *
 * Exit codes: 0 ok · 1 identity difference (compare) · 2 usage / config / IO ·
 * 3 network error, timeout or unexpected status recorded · 4 a threshold or
 * expectation of the subcommand failed · 5 compare: status / errorCode / facts
 * difference without an identity difference.
 *
 * Environment (all optional except the key):
 *   AB_HOST (r3d-s390-private) AB_PORT (3000) AB_CORPUS (/corpus) AB_OUT (/out)
 *   AB_KEY_NAME (SLICE_SERVICE_WOOCOMMERCE_API_KEY)  the slice key's variable NAME
 *   AB_ARTIFACT_KEY_NAME (ARTIFACT_API_KEY)          optional, for /admin/output-files
 *   AB_CASE_TIMEOUT_SEC (600) AB_WAIT_SEC (1800) AB_FORCE (unset)
 *   AB_EXPORT_NEGATIVE_CASES (tiltbar-preserve-0-0-0,block-preserve-37-0-0)
 *   AB_SYNC_EXPORT_CASE (cube-p1s-pla-l02)  AB_DELETE_CASE (cube-p1s-pla-l02)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const CFG = Object.freeze({
    host: process.env.AB_HOST || 'r3d-s390-private',
    port: Number(process.env.AB_PORT || 3000),
    corpus: process.env.AB_CORPUS || '/corpus',
    out: process.env.AB_OUT || '/out',
    keyName: process.env.AB_KEY_NAME || 'SLICE_SERVICE_WOOCOMMERCE_API_KEY',
    artifactKeyName: process.env.AB_ARTIFACT_KEY_NAME || 'ARTIFACT_API_KEY',
    caseTimeoutSec: Number(process.env.AB_CASE_TIMEOUT_SEC || 600),
    waitSec: Number(process.env.AB_WAIT_SEC || 1800),
    force: Boolean(process.env.AB_FORCE),
    negativeCases: (process.env.AB_EXPORT_NEGATIVE_CASES || 'tiltbar-preserve-0-0-0,block-preserve-37-0-0')
        .split(',').map((s) => s.trim()).filter(Boolean),
    syncExportCase: process.env.AB_SYNC_EXPORT_CASE || 'cube-p1s-pla-l02',
    deleteCase: process.env.AB_DELETE_CASE || 'cube-p1s-pla-l02'
});

const EXIT = Object.freeze({ OK: 0, IDENTITY: 1, USAGE: 2, NETWORK: 3, EXPECTATION: 4, FACTS: 5 });

// ------------------------------------------------------------------ secrets

/** Every env value that looks like a credential, longest first. */
const SECRET_VALUES = Object.entries(process.env)
    .filter(([name, value]) => /(API_KEY|_KEY|_SECRET|_TOKEN|PASSWORD)/i.test(name) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);

function redact(text) {
    let s = String(text);
    for (const secret of SECRET_VALUES) if (s.includes(secret)) s = s.split(secret).join('[redacted]');
    return s;
}

function say(...parts) { process.stdout.write(`${redact(parts.join(' '))}\n`); }
function warn(...parts) { process.stderr.write(`${redact(parts.join(' '))}\n`); }

function sliceKey() {
    const value = process.env[CFG.keyName];
    if (!value) {
        warn(`STOP the slice key variable ${CFG.keyName} is not set (pass the env file with --env-file)`);
        process.exit(EXIT.USAGE);
    }
    return value;
}

/** A 64-hex key that is certainly not any configured key. */
function wrongKey() {
    for (;;) {
        const candidate = crypto.randomBytes(32).toString('hex');
        if (!SECRET_VALUES.includes(candidate)) return candidate;
    }
}

// ------------------------------------------------------------------ files

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${redact(JSON.stringify(value, null, 2))}\n`);
}

function appendLine(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${redact(JSON.stringify(value))}\n`);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function nowIso() { return new Date().toISOString(); }

function stamp() { return nowIso().replace(/[:.]/g, '-'); }

function loadCorpus() {
    const file = path.join(CFG.corpus, 'cases.json');
    try {
        const body = readJson(file);
        if (!Array.isArray(body.cases)) throw new Error('cases.json has no cases array');
        return body;
    } catch (error) {
        warn(`STOP cannot read ${file}: ${error.message}`);
        process.exit(EXIT.USAGE);
    }
    return null;
}

// ------------------------------------------------------------------ HTTP

const KEPT_HEADERS = /^(content-type|content-length|content-disposition|cache-control|retry-after|location|preference-applied|etag|x-request-id|x-content-type-options|x-r3d-.*)$/i;

function keptHeaders(headers) {
    const kept = {};
    for (const [name, value] of Object.entries(headers || {})) if (KEPT_HEADERS.test(name)) kept[name.toLowerCase()] = value;
    return kept;
}

/**
 * One request. Never throws: a network error comes back as {status: null, error}.
 * @returns {Promise<{status: number|null, headers: object, body: Buffer, elapsedMs: number, error?: string}>}
 */
function request({ method, urlPath, headers = {}, body = null, timeoutMs = 120000 }) {
    return new Promise((resolve) => {
        const started = process.hrtime.bigint();
        const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve({ ...value, elapsedMs: Math.round(elapsed() * 1000) / 1000 });
        };
        const options = { host: CFG.host, port: CFG.port, method, path: urlPath, headers: { ...headers }, agent: false };
        if (body) options.headers['Content-Length'] = body.length;
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on('error', (error) => finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), error: `response: ${error.code || error.message}` }));
        });
        req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('client timeout'), { code: 'CLIENT_TIMEOUT' })));
        req.on('error', (error) => finish({ status: null, headers: {}, body: Buffer.alloc(0), error: error.code || error.message }));
        if (body) req.write(body);
        req.end();
    });
}

function parseBody(res) {
    if (!res.body || res.body.length === 0) return null;
    try { return JSON.parse(res.body.toString('utf8')); } catch { return { unparsed_text: res.body.toString('utf8').slice(0, 2000) }; }
}

function requestId(side, label) { return `ab-${side}-${label}-${crypto.randomBytes(6).toString('hex')}`.slice(0, 120); }

function multipart(fields, file) {
    const boundary = `----R3DAB${crypto.randomBytes(12).toString('hex')}`;
    const parts = [];
    for (const [name, value] of fields) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
    }
    if (file) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="choosenFile"; filename="${file.name}"\r\n`
            + 'Content-Type: application/octet-stream\r\n\r\n', 'utf8'), file.data, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** The private-store-like multipart filename: a UUID basename + the file's own extension. */
function uploadName(file) {
    const lower = file.toLowerCase();
    const ext = lower.endsWith('.gcode.3mf') ? '.gcode.3mf' : path.extname(lower);
    return `${crypto.randomUUID()}${ext}`;
}

function errorCodeOf(body) {
    return body && typeof body === 'object' ? (body.errorCode ?? body.code ?? body.error?.code ?? null) : null;
}

// ------------------------------------------------------------------ request fields

/** Field list in the live plugin's order (HttpSlicerClient.php buildMultipart). */
function sliceFields(c, pin) {
    const fields = [
        ['material', c.material],
        ['layerHeight', Number(c.layerHeight).toFixed(3)],
        ['infill', `${c.infill}%`],
        ['supports', c.supports ? 'true' : 'false'],
        ['orientationMode', c.orientationMode],
        ['printerProfile', c.printerProfile],
        ['sizeUnit', c.sizeUnit || 'mm'],
        ['rotationX', String(c.rotationX ?? 0)],
        ['rotationY', String(c.rotationY ?? 0)],
        ['rotationZ', String(c.rotationZ ?? 0)]
    ];
    if (pin) {
        fields.push(['processProfile', pin.processProfile],
            ['expectedProfileSha256', pin.expectedProfileSha256],
            ['expectedMeasurementGeneration', pin.expectedMeasurementGeneration]);
    }
    if (c.scalePercent !== undefined && c.scalePercent !== null) fields.push(['scalePercent', String(c.scalePercent)]);
    return fields;
}

function setField(fields, name, value) {
    const copy = fields.map(([n, v]) => [n, v]);
    const index = copy.findIndex(([n]) => n === name);
    if (index >= 0) copy[index][1] = value; else copy.push([name, value]);
    return copy;
}

function removeField(fields, name) { return fields.filter(([n]) => n !== name); }

/** Catalogue v3 pins: the plugin sends processProfile + both expected hashes from its verified row. */
async function loadPins(log) {
    const res = await request({ method: 'GET', urlPath: '/profiles?contract=material-v1' });
    log({ at: nowIso(), what: 'catalogue_v3_for_pins', status: res.status, error: res.error, elapsed_ms: res.elapsedMs });
    if (res.status !== 200) return { error: `catalogue v3 answered ${res.status ?? res.error}`, find: () => null };
    const body = parseBody(res);
    const rows = Array.isArray(body?.profiles) ? body.profiles : [];
    return {
        error: null,
        find(c) {
            const row = rows.find((r) => r.engine === 'bambu' && r.printer?.id === c.printerProfile && r.material === c.material
                && (r.slice_selector?.parameters || []).some((p) => p.name === 'layerHeight' && Number(p.value) === Number(c.layerHeight)));
            if (!row) return null;
            const proc = (row.slice_selector.parameters || []).find((p) => p.name === 'processProfile');
            if (!proc || !row.effective_profile_sha256 || !row.measurement_generation) return null;
            return { rowId: row.id, processProfile: proc.value, expectedProfileSha256: row.effective_profile_sha256,
                expectedMeasurementGeneration: row.measurement_generation };
        }
    };
}

// ------------------------------------------------------------------ async job runner

/**
 * Submit with Prefer: respond-async, poll to completion or timeout, DELETE.
 * Returns the full record. A non-202 submission is the (synchronous) result.
 */
async function runSliceJob({ side, label, fields, fileName, data, timeoutSec, keepJob = false, log }) {
    const key = sliceKey();
    const rid = requestId(side, label);
    const rec = { request_id: rid, upload_name: fileName, submitted_at: nowIso(), submit: null, polls: 0,
        poll_errors: [], final: null, result_status: null, result: null, job_id: null, delete: null, outcome: null };
    const started = Date.now();
    let res;
    for (let attempt = 1; ; attempt += 1) {
        const mp = multipart(fields, { name: fileName, data });
        res = await request({ method: 'POST', urlPath: '/bambu/slice', body: mp.body, timeoutMs: 180000,
            headers: { 'Content-Type': mp.contentType, 'x-slicer-api-key': key, 'X-Request-Id': rid, Prefer: 'respond-async' } });
        const body = parseBody(res);
        rec.submit = { attempt, status: res.status, error: res.error, elapsed_ms: res.elapsedMs, headers: keptHeaders(res.headers), body };
        log({ at: nowIso(), what: 'slice_submit', label, attempt, status: res.status, error: res.error, errorCode: errorCodeOf(body), elapsed_ms: res.elapsedMs });
        if (res.status === 429 && attempt <= 3) {
            const wait = Math.min(70, Math.max(1, Number(res.headers['retry-after']) || 10));
            rec.poll_errors.push({ at: nowIso(), submit_429_retry_after_s: wait });
            await sleep(wait * 1000);
            continue;
        }
        break;
    }
    if (res.status === null) {
        rec.outcome = 'network_error';
        rec.elapsed_ms = Date.now() - started;
        return rec;
    }
    const accepted = parseBody(res);
    if (res.status !== 202) {
        rec.outcome = 'sync_answer';
        rec.result_status = res.status;
        rec.result = accepted;
        rec.elapsed_ms = Date.now() - started;
        return rec;
    }
    rec.job_id = accepted?.job_id;
    if (!/^sj_[a-f0-9]{32}$/.test(String(rec.job_id))) {
        rec.outcome = 'unexpected_202_body';
        rec.elapsed_ms = Date.now() - started;
        return rec;
    }
    let pollAfter = Number(accepted.poll_after_ms) || 2000;
    const deadline = started + timeoutSec * 1000;
    for (;;) {
        if (Date.now() >= deadline) {
            rec.outcome = 'client_timeout';
            break;
        }
        await sleep(Math.min(10000, Math.max(500, pollAfter)));
        const poll = await request({ method: 'GET', urlPath: `/bambu/slice/jobs/${rec.job_id}`, headers: { 'x-slicer-api-key': key, 'X-Request-Id': rid } });
        rec.polls += 1;
        const body = parseBody(poll);
        if (poll.status !== 200) {
            rec.poll_errors.push({ at: nowIso(), status: poll.status, error: poll.error, errorCode: errorCodeOf(body), retry_after: poll.headers['retry-after'] });
            log({ at: nowIso(), what: 'slice_poll_unexpected', label, status: poll.status, error: poll.error, errorCode: errorCodeOf(body) });
            if (poll.status === 404) { rec.outcome = 'job_lost_404'; break; }
            if (poll.status === 429) pollAfter = Math.max(pollAfter, (Number(poll.headers['retry-after']) || 5) * 1000);
            continue;
        }
        if (body?.status === 'completed') {
            rec.final = body;
            rec.result_status = body.result_status;
            rec.result = body.result;
            rec.outcome = 'completed';
            break;
        }
        pollAfter = Number(body?.poll_after_ms) || pollAfter;
    }
    rec.elapsed_ms = Date.now() - started;
    if (!keepJob || rec.outcome !== 'completed') rec.delete = await deleteJob(`/bambu/slice/jobs/${rec.job_id}`, key, rid, log, label);
    return rec;
}

async function deleteJob(urlPath, key, rid, log, label) {
    const res = await request({ method: 'DELETE', urlPath, headers: { 'x-slicer-api-key': key, 'X-Request-Id': rid } });
    const body = parseBody(res);
    log({ at: nowIso(), what: 'job_delete', label, path: urlPath, status: res.status, error: res.error, errorCode: errorCodeOf(body) });
    return { status: res.status, error: res.error, errorCode: errorCodeOf(body), at: nowIso() };
}

function receiptOf(result) { return result && typeof result === 'object' ? result.technical_receipt || null : null; }

function summaryOf(c, rec) {
    const receipt = receiptOf(rec.result);
    return {
        case: c.id,
        status: rec.submit?.status ?? null,
        outcome: rec.outcome,
        result_status: rec.result_status,
        errorCode: errorCodeOf(rec.result),
        archive_rule: rec.result?.archive_rule ?? null,
        elapsed_ms: rec.elapsed_ms,
        print_time_seconds: rec.result?.stats?.print_time_seconds ?? null,
        material_used_g: rec.result?.stats?.material_used_g ?? null,
        measurement_generation: receipt?.measurement_generation ?? null,
        sliced_geometry_sha256: receipt?.source?.sliced_geometry_sha256 ?? null,
        delete_status: rec.delete?.status ?? null
    };
}

/** A completed case or a synchronous refusal is an answer; anything else is recorded as a run error. */
function isAnswered(rec) { return rec.outcome === 'completed' || rec.outcome === 'sync_answer'; }

function expectationMet(c, side, rec) {
    const expect = c.expect && (c.expect[side] || (c.expect.status !== undefined ? c.expect : null));
    if (!expect) return null;
    const checks = [];
    if (expect.status !== undefined) checks.push(rec.result_status === expect.status);
    if (expect.errorCode !== undefined) checks.push(errorCodeOf(rec.result) === expect.errorCode);
    if (expect.archive_rule !== undefined) checks.push(rec.result?.archive_rule === expect.archive_rule);
    return checks.every(Boolean);
}

// ------------------------------------------------------------------ corpus

function parseListFlag(args, flag) {
    const index = args.indexOf(flag);
    if (index < 0) return null;
    return String(args[index + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function requireSide(value) {
    if (value !== 'A' && value !== 'B') {
        warn('STOP side must be A or B');
        process.exit(EXIT.USAGE);
    }
    return value;
}

function requireRun(value) {
    if (!/^[1-9][0-9]?$/.test(String(value || ''))) {
        warn('STOP run must be a number 1..99');
        process.exit(EXIT.USAGE);
    }
    return Number(value);
}

async function cmdCorpus(args) {
    const side = requireSide(args[0]);
    const run = requireRun(args[1]);
    const only = parseListFlag(args, '--only');
    const skip = parseListFlag(args, '--skip') || [];
    sliceKey();
    const corpus = loadCorpus();
    const dir = path.join(CFG.out, side, `run${run}`);
    const summaryFile = path.join(dir, 'summary.jsonl');
    if (fs.existsSync(summaryFile) && !CFG.force && !only) {
        warn(`STOP ${summaryFile} exists; set AB_FORCE=1 to append, or use --only`);
        process.exit(EXIT.USAGE);
    }
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'requests.jsonl');
    const log = (entry) => appendLine(logFile, entry);
    const pins = await loadPins(log);
    if (pins.error) warn(`WARN ${pins.error}: cases are sent without processProfile / expected hashes`);
    let problems = 0;
    const cases = corpus.cases.filter((c) => (!only || only.includes(c.id)) && !skip.includes(c.id));
    say(`corpus side ${side} run ${run}: ${cases.length} cases, strictly one job at a time`);
    for (const c of cases) {
        const filePath = path.join(CFG.corpus, c.file);
        let data;
        try { data = fs.readFileSync(filePath); } catch (error) {
            problems += 1;
            appendLine(summaryFile, { case: c.id, outcome: 'corpus_file_unreadable', error: error.message });
            continue;
        }
        const pin = c.pinProfile === false ? null : pins.find(c);
        const fields = sliceFields(c, pin);
        const fileName = uploadName(c.file);
        const rec = await runSliceJob({ side, label: `r${run}-${c.id}`, fields, fileName, data,
            timeoutSec: Number(c.timeoutSec) || CFG.caseTimeoutSec, log });
        const full = { schema: 'r3d-s390-ab-case-v1', side, run, case: c, recorded_at: nowIso(),
            request: { fields, upload_name: fileName, source_sha256: sha256(data), pin: pin ? pin.rowId : null },
            ...rec, expectation_met: expectationMet(c, side, rec) };
        writeJson(path.join(dir, `${c.id}.json`), full);
        const line = { ...summaryOf(c, rec), expectation_met: full.expectation_met };
        appendLine(summaryFile, line);
        say(JSON.stringify(line));
        const deleteOk = rec.delete === null || rec.delete.status === 204 || (rec.outcome !== 'completed' && rec.delete.status === 404);
        if (!isAnswered(rec) || !deleteOk) problems += 1;
    }
    say(`corpus side ${side} run ${run} done: ${problems} case(s) with a run error (see ${summaryFile})`);
    return problems ? EXIT.NETWORK : EXIT.OK;
}

// ------------------------------------------------------------------ catalogue / capabilities

async function cmdCatalogue(args) {
    const side = requireSide(args[0]);
    const dir = path.join(CFG.out, side);
    let bad = 0;
    for (const [label, urlPath] of [['v2', '/profiles'], ['v3', '/profiles?contract=material-v1']]) {
        const res = await request({ method: 'GET', urlPath });
        const body = parseBody(res);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `catalogue-${label}.body`), res.body);
        const meta = { label, path: urlPath, at: nowIso(), status: res.status, error: res.error, elapsed_ms: res.elapsedMs,
            headers: keptHeaders(res.headers), body_bytes: res.body.length, body_sha256: sha256(res.body),
            catalogue_sha256: body?.catalogue_sha256 ?? null, schema: body?.schema ?? null,
            rows: Array.isArray(body?.profiles) ? body.profiles.length : null };
        writeJson(path.join(dir, `catalogue-${label}.meta.json`), meta);
        say(JSON.stringify(meta));
        if (res.status !== 200) bad += 1;
    }
    return bad ? EXIT.NETWORK : EXIT.OK;
}

async function cmdCapabilities(args) {
    const side = requireSide(args[0] || process.env.AB_SIDE);
    const res = await request({ method: 'GET', urlPath: '/capabilities', headers: { 'x-slicer-api-key': sliceKey(), 'X-Request-Id': requestId(side, 'cap') } });
    const body = parseBody(res);
    const expected = side === 'A' ? 404 : 200;
    const record = { side, at: nowIso(), status: res.status, expected_status: expected, error: res.error, elapsed_ms: res.elapsedMs,
        headers: keptHeaders(res.headers), body };
    writeJson(path.join(CFG.out, side, 'capabilities.json'), record);
    say(JSON.stringify({ side, status: res.status, expected_status: expected, errorCode: errorCodeOf(body),
        service_version: body?.service_version ?? null, export_enabled: body?.export?.enabled ?? null,
        authenticated_as: body?.authenticated_as ?? null }));
    if (res.status === null) return EXIT.NETWORK;
    return res.status === expected ? EXIT.OK : EXIT.EXPECTATION;
}

// ------------------------------------------------------------------ auth

async function cmdAuth(args) {
    const side = requireSide(args[0] || process.env.AB_SIDE);
    const key = sliceKey();
    const results = { side, at: nowIso(), wrong_key_slice: [], wrong_key_job: [], checks: {} };
    const brief = (res) => {
        const body = parseBody(res);
        return { status: res.status, error: res.error, errorCode: errorCodeOf(body), retry_after: res.headers['retry-after'] ?? null,
            body_sha256: sha256(res.body), elapsed_ms: res.elapsedMs };
    };
    const noFile = () => multipart([['material', 'PLA'], ['layerHeight', '0.200']], null);
    for (let i = 0; i < 40; i += 1) {
        const mp = noFile();
        results.wrong_key_slice.push(brief(await request({ method: 'POST', urlPath: '/bambu/slice', body: mp.body,
            headers: { 'Content-Type': mp.contentType, 'x-slicer-api-key': wrongKey(), 'X-Request-Id': requestId(side, `auth-s${i}`) } })));
    }
    for (let i = 0; i < 40; i += 1) {
        results.wrong_key_job.push(brief(await request({ method: 'GET', urlPath: `/bambu/slice/jobs/sj_${crypto.randomBytes(16).toString('hex')}`,
            headers: { 'x-slicer-api-key': wrongKey(), 'X-Request-Id': requestId(side, `auth-j${i}`) } })));
    }
    // An empty header still carries a key (spec §2.0): 401, never 429.
    {
        const mp = noFile();
        results.empty_key_slice = brief(await request({ method: 'POST', urlPath: '/bambu/slice', body: mp.body,
            headers: { 'Content-Type': mp.contentType, 'x-slicer-api-key': '', 'X-Request-Id': requestId(side, 'auth-empty') } }));
    }
    // The valid key from the same IP right after the flood is still admitted.
    results.valid_capabilities = brief(await request({ method: 'GET', urlPath: '/capabilities',
        headers: { 'x-slicer-api-key': key, 'X-Request-Id': requestId(side, 'auth-cap') } }));
    {
        const mp = noFile(); // no file: a validation answer (400), never 401/429, and no job is started
        results.valid_key_slice_no_file = brief(await request({ method: 'POST', urlPath: '/bambu/slice', body: mp.body,
            headers: { 'Content-Type': mp.contentType, 'x-slicer-api-key': key, 'X-Request-Id': requestId(side, 'auth-valid') } }));
    }
    {
        const mp = noFile();
        results.no_key_slice = brief(await request({ method: 'POST', urlPath: '/bambu/slice', body: mp.body,
            headers: { 'Content-Type': mp.contentType, 'X-Request-Id': requestId(side, 'auth-nokey') } }));
    }
    results.no_key_job = brief(await request({ method: 'GET', urlPath: `/bambu/slice/jobs/sj_${'0'.repeat(32)}`,
        headers: { 'X-Request-Id': requestId(side, 'auth-nokey-job') } }));

    const all = [...results.wrong_key_slice, ...results.wrong_key_job, results.empty_key_slice];
    const count = (list, status) => list.filter((r) => r.status === status).length;
    results.checks = {
        wrong_key_401: count(all, 401),
        wrong_key_429: count(all, 429),
        wrong_key_other: all.filter((r) => r.status !== 401 && r.status !== 429).map((r) => r.status),
        wrong_key_with_retry_after: all.filter((r) => r.retry_after !== null).length,
        wrong_key_distinct_401_bodies: new Set(all.filter((r) => r.status === 401).map((r) => r.body_sha256)).size,
        valid_capabilities_status: results.valid_capabilities.status,
        valid_key_slice_no_file_status: results.valid_key_slice_no_file.status,
        valid_key_slice_no_file_errorCode: results.valid_key_slice_no_file.errorCode,
        no_key_slice_status: results.no_key_slice.status,
        no_key_job_status: results.no_key_job.status
    };
    if (side === 'B') {
        results.checks.verdict = results.checks.wrong_key_401 === all.length
            && results.checks.wrong_key_distinct_401_bodies === 1
            && results.checks.valid_capabilities_status === 200
            && ![401, 429].includes(results.checks.valid_key_slice_no_file_status) ? 'pass' : 'fail';
    } else {
        results.checks.verdict = 'recorded (3.8.3 behaviour)';
    }
    writeJson(path.join(CFG.out, side, `auth-${stamp()}.json`), results);
    say(JSON.stringify(results.checks));
    if (all.some((r) => r.status === null)) return EXIT.NETWORK;
    return results.checks.verdict === 'fail' ? EXIT.EXPECTATION : EXIT.OK;
}

// ------------------------------------------------------------------ ready

function percentile(sorted, p) {
    if (!sorted.length) return null;
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

async function cmdReady(args) {
    const seconds = Number(args[0]);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7200) {
        warn('STOP usage: ready <seconds 1..7200> [A|B]');
        return EXIT.USAGE;
    }
    const side = args[1] ? requireSide(args[1]) : (process.env.AB_SIDE || 'unknown');
    const probes = [];
    const start = Date.now();
    for (let i = 0; i < seconds; i += 1) {
        const tick = start + i * 1000;
        if (Date.now() < tick) await sleep(tick - Date.now());
        for (const urlPath of ['/ready', '/health']) {
            const res = await request({ method: 'GET', urlPath, timeoutMs: 10000 });
            probes.push({ at: nowIso(), path: urlPath, status: res.status, error: res.error, ms: res.elapsedMs });
        }
    }
    const stats = {};
    for (const urlPath of ['/ready', '/health']) {
        const list = probes.filter((p) => p.path === urlPath);
        const ms = list.filter((p) => p.status !== null).map((p) => p.ms).sort((a, b) => a - b);
        stats[urlPath] = { probes: list.length, non_200: list.filter((p) => p.status !== 200).map((p) => p.status), network_errors: list.filter((p) => p.status === null).length,
            p50_ms: percentile(ms, 50), p99_ms: percentile(ms, 99), max_ms: ms.length ? ms[ms.length - 1] : null };
    }
    const r = stats['/ready'];
    const verdict = r.network_errors === 0 && r.non_200.length === 0 && r.p99_ms < 100 && r.max_ms < 1000 ? 'pass' : 'fail';
    writeJson(path.join(CFG.out, side, `ready-${stamp()}.json`), { side, seconds, stats, verdict, thresholds: { p99_ms: 100, max_ms: 1000 }, probes });
    for (const [p, s] of Object.entries(stats)) say(`${p}: n=${s.probes} p50=${s.p50_ms} ms p99=${s.p99_ms} ms max=${s.max_ms} ms non200=${JSON.stringify(s.non_200)} neterr=${s.network_errors}`);
    say(`ready verdict (p99 < 100 ms, max < 1 s, all 200): ${verdict}`);
    if (r.network_errors) return EXIT.NETWORK;
    return verdict === 'pass' ? EXIT.OK : EXIT.EXPECTATION;
}

// ------------------------------------------------------------------ export helpers

const SYNC_EXPORT_HEADERS = Object.freeze(['content-type', 'content-disposition', 'cache-control', 'x-content-type-options',
    'x-r3d-export-contract', 'x-r3d-export-fidelity', 'x-r3d-export-sha256', 'x-r3d-sliced-geometry-sha256',
    'x-r3d-measurement-generation', 'x-r3d-final-dimensions-mm', 'x-r3d-placement-mm', 'x-r3d-orientation-outcome',
    'x-r3d-rotation-matrix', 'x-r3d-oriented-dimensions-mm', 'x-r3d-volume-mm3', 'x-request-id']);

/** Client-side pacing of export POSTs: 6/min, burst 3 (spec §2.2). */
const exportPacer = { sent: [] };
async function paceExport() {
    for (;;) {
        const now = Date.now();
        exportPacer.sent = exportPacer.sent.filter((t) => now - t < 60000);
        const recent = exportPacer.sent.length;
        const last = exportPacer.sent[exportPacer.sent.length - 1] || 0;
        if (recent < 3 || (recent < 6 && now - last >= 10500)) break;
        await sleep(500);
    }
    exportPacer.sent.push(Date.now());
}

function readStlTriangles(buffer) {
    if (buffer.length < 84) return null;
    const n = buffer.readUInt32LE(80);
    if (buffer.length !== 84 + n * 50) return null;
    const tris = [];
    for (let i = 0; i < n; i += 1) {
        const o = 84 + i * 50 + 12;
        const t = [];
        for (let k = 0; k < 9; k += 1) t.push(buffer.readFloatLE(o + k * 4));
        tris.push(t);
    }
    return tris;
}

/** Minimal ZIP reader (central directory; stored or deflated entries). */
function unzipEntries(buffer) {
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('no end of central directory');
    const count = buffer.readUInt16LE(eocd + 10);
    let p = buffer.readUInt32LE(eocd + 16);
    const entries = new Map();
    for (let i = 0; i < count; i += 1) {
        if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
        const method = buffer.readUInt16LE(p + 10);
        const csize = buffer.readUInt32LE(p + 20);
        const nlen = buffer.readUInt16LE(p + 28);
        const elen = buffer.readUInt16LE(p + 30);
        const clen = buffer.readUInt16LE(p + 32);
        const local = buffer.readUInt32LE(p + 42);
        const name = buffer.slice(p + 46, p + 46 + nlen).toString('utf8');
        const lnlen = buffer.readUInt16LE(local + 26);
        const lelen = buffer.readUInt16LE(local + 28);
        const start = local + 30 + lnlen + lelen;
        const raw = buffer.slice(start, start + csize);
        entries.set(name, { method, read: () => (method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null) });
        p += 46 + nlen + elen + clen;
    }
    return entries;
}

function attr(text, name) {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(text);
    return m ? (m[2] ?? m[3]) : undefined;
}

/** 3MF round trip: the export's 3MF holds the STL's triangles as float32, bitwise. */
function threeMfRoundTrip(threeMfBody, stlBody) {
    const out = { ok: false };
    try {
        const entries = unzipEntries(threeMfBody);
        out.entries = [...entries.keys()];
        const modelName = out.entries.find((n) => n.toLowerCase() === '3d/3dmodel.model');
        if (!modelName) { out.error = 'no 3D/3dmodel.model'; return out; }
        const xml = entries.get(modelName).read().toString('utf8');
        out.gcode_in_package = out.entries.some((n) => /\.gcode$/i.test(n));
        const vertices = [];
        for (const m of xml.matchAll(/<(?:\w+:)?vertex\b([^>]*)\/?>/g)) {
            vertices.push(['x', 'y', 'z'].map((k) => Math.fround(Number(attr(m[1], k)))));
        }
        const tris = [];
        for (const m of xml.matchAll(/<(?:\w+:)?triangle\b([^>]*)\/?>/g)) {
            const idx = ['v1', 'v2', 'v3'].map((k) => Number(attr(m[1], k)));
            tris.push(idx.flatMap((i) => vertices[i] || [NaN, NaN, NaN]));
        }
        out.metadata = {};
        for (const m of xml.matchAll(/<(?:\w+:)?metadata\b([^>]*)>([^<]*)<\/(?:\w+:)?metadata>/g)) {
            const name = attr(m[1], 'name');
            if (name) out.metadata[name] = m[2];
        }
        out.objects = (xml.match(/<(?:\w+:)?object\b/g) || []).length;
        out.items = (xml.match(/<(?:\w+:)?item\b/g) || []).length;
        out.item_has_transform = /<(?:\w+:)?item\b[^>]*\btransform\s*=/.test(xml);
        out.unit = attr(/<(?:\w+:)?model\b([^>]*)>/.exec(xml)?.[1] || '', 'unit') || null;
        const stl = readStlTriangles(stlBody);
        out.stl_triangles = stl ? stl.length : null;
        out.threemf_triangles = tris.length;
        if (!stl) { out.error = 'the STL body is not a binary STL'; return out; }
        const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
        out.in_order = stl.length === tris.length && stl.every((t, i) => same(t, tris[i]));
        if (!out.in_order) {
            const key = (t) => {
                const corners = [t.slice(0, 3), t.slice(3, 6), t.slice(6, 9)].map((c) => c.join(','));
                const r = corners.indexOf([...corners].sort()[0]);
                return [0, 1, 2].map((k) => corners[(r + k) % 3]).join('|');
            };
            const a = stl.map(key).sort();
            const b = tris.map(key).sort();
            out.as_multiset = a.length === b.length && a.every((v, i) => v === b[i]);
        }
        out.ok = out.in_order || out.as_multiset === true;
    } catch (error) {
        out.error = error.message;
    }
    return out;
}

function parseCsvNumbers(value) { return String(value || '').split(',').map(Number); }

/** §2.2 step-2 acceptance checks against the stored receipt. */
function fallbackChecks(headers, receipt) {
    const mt = receipt?.geometry?.model_transform || {};
    const matrix = parseCsvNumbers(headers['x-r3d-rotation-matrix']);
    const expectedMatrix = Array.isArray(mt.rotation_matrix) ? mt.rotation_matrix.flat() : [];
    const a = matrix.length === 9 && expectedMatrix.length === 9 && matrix.every((v, i) => Math.abs(v - expectedMatrix[i]) <= 1e-6);
    const dims = parseCsvNumbers(headers['x-r3d-final-dimensions-mm']);
    const fd = mt.final_dimensions_mm || {};
    const b = dims.length === 3 && ['x', 'y', 'z'].every((k, i) => Number.isFinite(fd[k]) && Math.abs(dims[i] - fd[k]) <= 0.01);
    const volume = Number(headers['x-r3d-volume-mm3']);
    const expectedVolume = receipt?.geometry?.volume_mm3;
    const c = Number.isFinite(volume) && Number.isFinite(expectedVolume) && expectedVolume !== 0
        && Math.abs(volume - expectedVolume) / Math.abs(expectedVolume) <= 0.0001;
    return { a_rotation_matrix_1e6: a, b_final_dimensions_001mm: b, c_volume_001pct: c, all: a && b && c,
        observed: { matrix, final_dimensions_mm: dims, volume_mm3: volume },
        receipt: { rotation_matrix: expectedMatrix, final_dimensions_mm: fd, volume_mm3: expectedVolume } };
}

/** POST /bambu/export (async unless sync) → poll → GET file → DELETE → GET (404). */
async function runExport({ label, fields, fileName, data, sync = false, log }) {
    const key = sliceKey();
    const rid = requestId('B', label);
    const rec = { label, request_id: rid, sync, fields: fields.filter(([n]) => n !== 'choosenFile'), submit: null, polls: 0,
        poll_errors: [], final: null, file: null, delete: null, get_after_delete: null, outcome: null };
    let res;
    for (let attempt = 1; ; attempt += 1) {
        await paceExport();
        const mp = multipart(fields, { name: fileName, data });
        const headers = { 'Content-Type': mp.contentType, 'x-slicer-api-key': key, 'X-Request-Id': rid };
        if (!sync) headers.Prefer = 'respond-async';
        res = await request({ method: 'POST', urlPath: '/bambu/export', body: mp.body, headers, timeoutMs: sync ? 150000 : 120000 });
        const body = res.headers['content-type'] && /json/.test(res.headers['content-type']) ? parseBody(res) : null;
        rec.submit = { attempt, status: res.status, error: res.error, elapsed_ms: res.elapsedMs, headers: keptHeaders(res.headers),
            body, body_bytes: res.body.length };
        log({ at: nowIso(), what: 'export_submit', label, attempt, status: res.status, error: res.error, errorCode: errorCodeOf(body), elapsed_ms: res.elapsedMs });
        if (res.status === 429 && attempt <= 10) {
            const wait = Math.min(70, Math.max(1, Number(res.headers['retry-after']) || 10));
            rec.poll_errors.push({ at: nowIso(), submit_429_retry_after_s: wait, errorCode: errorCodeOf(body) });
            await sleep(wait * 1000);
            continue;
        }
        break;
    }
    if (res.status === null) { rec.outcome = 'network_error'; return rec; }
    if (sync || res.status !== 202) {
        rec.outcome = res.status === 200 ? 'sync_file' : 'sync_answer';
        rec.result_status = res.status;
        if (res.status === 200) {
            rec.file = { status: 200, headers: keptHeaders(res.headers), bytes: res.body.length, sha256: sha256(res.body) };
            rec.fileBody = res.body;
        } else {
            rec.result = rec.submit.body;
        }
        return rec;
    }
    const accepted = rec.submit.body;
    rec.job_id = accepted?.job_id;
    rec.accept_headers_ok = Boolean(res.headers.location === `/bambu/export/jobs/${rec.job_id}`
        && res.headers['preference-applied'] === 'respond-async' && /no-store/.test(res.headers['cache-control'] || ''));
    if (!/^ex_[a-f0-9]{32}$/.test(String(rec.job_id))) { rec.outcome = 'unexpected_202_body'; return rec; }
    const jobPath = `/bambu/export/jobs/${rec.job_id}`;
    let pollAfter = Number(accepted.poll_after_ms) || 2000;
    const deadline = Date.now() + 960 * 1000;
    for (;;) {
        if (Date.now() >= deadline) { rec.outcome = 'client_timeout'; break; }
        await sleep(Math.min(10000, Math.max(500, pollAfter)));
        const poll = await request({ method: 'GET', urlPath: jobPath, headers: { 'x-slicer-api-key': key, 'X-Request-Id': rid } });
        rec.polls += 1;
        const body = parseBody(poll);
        if (poll.status !== 200) {
            rec.poll_errors.push({ at: nowIso(), status: poll.status, error: poll.error, errorCode: errorCodeOf(body) });
            log({ at: nowIso(), what: 'export_poll_unexpected', label, status: poll.status, error: poll.error, errorCode: errorCodeOf(body) });
            if (poll.status === 404) { rec.outcome = 'job_lost_404'; break; }
            continue;
        }
        if (body?.status === 'completed') {
            rec.final = body;
            rec.result_status = body.result_status;
            rec.result = body.result;
            rec.outcome = 'completed';
            break;
        }
        pollAfter = Number(body?.poll_after_ms) || pollAfter;
    }
    if (rec.outcome === 'completed' && rec.result_status === 200) {
        const fileRes = await request({ method: 'GET', urlPath: rec.result.file_url || `${jobPath}/file`, headers: { 'x-slicer-api-key': key, 'X-Request-Id': rid } });
        rec.file = { status: fileRes.status, error: fileRes.error, headers: keptHeaders(fileRes.headers), bytes: fileRes.body.length, sha256: sha256(fileRes.body) };
        if (fileRes.status === 200) rec.fileBody = fileRes.body; else rec.file.body = parseBody(fileRes);
        log({ at: nowIso(), what: 'export_file', label, status: fileRes.status, error: fileRes.error, bytes: fileRes.body.length });
    }
    if (rec.job_id) {
        rec.delete = await deleteJob(jobPath, key, rid, log, label);
        const after = await request({ method: 'GET', urlPath: jobPath, headers: { 'x-slicer-api-key': key, 'X-Request-Id': rid } });
        rec.get_after_delete = { status: after.status, error: after.error, errorCode: errorCodeOf(parseBody(after)) };
    }
    return rec;
}

function stripBody(rec) {
    const { fileBody, ...rest } = rec;
    return rest;
}

/** Verify one export record against the stored slice receipt. */
function verifyExport(rec, receipt, { format, expectExact, sourceSha }) {
    const v = { ok: false, notes: [] };
    if (rec.result_status !== 200 || !rec.file || rec.file.status !== 200) {
        v.notes.push(`no file (result_status ${rec.result_status}, errorCode ${errorCodeOf(rec.result)})`);
        return v;
    }
    const h = rec.file.headers;
    const sliced = receipt?.source?.sliced_geometry_sha256;
    v.fidelity = h['x-r3d-export-fidelity'];
    v.body_sha_eq_header = rec.file.sha256 === h['x-r3d-export-sha256'];
    v.body_sha_eq_result = rec.result ? rec.file.sha256 === rec.result.sha256 : null;
    v.sliced_header_eq_receipt = h['x-r3d-sliced-geometry-sha256'] === sliced;
    v.generation_header_eq_receipt = h['x-r3d-measurement-generation'] === receipt?.measurement_generation;
    v.media_type = h['content-type'];
    v.no_store = /no-store/.test(h['cache-control'] || '');
    if (format === 'stl') {
        v.body_sha_eq_receipt_sliced = rec.file.sha256 === sliced;
        v.body_sha_eq_sliced_header = rec.file.sha256 === h['x-r3d-sliced-geometry-sha256'];
        v.binary_stl = Boolean(rec.fileBody && readStlTriangles(rec.fileBody));
    }
    if (format === '3mf' && rec.threeMf) {
        const md = rec.threeMf.metadata || {};
        v.threemf_round_trip = rec.threeMf.ok;
        v.threemf_metadata_ok = md['r3d:sliced_geometry_sha256'] === sliced && md['r3d:source_sha256'] === sourceSha
            && md['r3d:measurement_generation'] === receipt?.measurement_generation && md['r3d:fidelity'] === v.fidelity;
        v.threemf_shape_ok = rec.threeMf.objects === 1 && rec.threeMf.items === 1 && !rec.threeMf.item_has_transform
            && rec.threeMf.unit === 'millimeter' && !rec.threeMf.gcode_in_package;
    }
    // A fallback (unverified) export re-prepares a different placed STL, so its
    // sliced-geometry header is not the receipt's; only an exact one must match.
    const required = [v.body_sha_eq_header, v.generation_header_eq_receipt, v.no_store];
    if (v.body_sha_eq_result !== null) required.push(v.body_sha_eq_result);
    if (expectExact) required.push(v.sliced_header_eq_receipt);
    if (format === 'stl') required.push(v.body_sha_eq_sliced_header, v.binary_stl);
    if (format === 'stl' && expectExact) required.push(v.body_sha_eq_receipt_sliced);
    if (format === '3mf') required.push(v.threemf_round_trip === true, v.threemf_metadata_ok === true, v.threemf_shape_ok === true);
    if (expectExact) required.push(v.fidelity === 'exact');
    v.ok = required.every(Boolean);
    return v;
}

function loadRunCases(side, run) {
    const dir = path.join(CFG.out, side, `run${run}`);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
        .map((f) => { try { return readJson(path.join(dir, f)); } catch { return null; } })
        .filter((r) => r && r.schema === 'r3d-s390-ab-case-v1');
}

function wrapRotation(value) {
    let v = Number(value) + 180;
    while (v > 180) v -= 360;
    while (v <= -180) v += 360;
    return Number(v.toFixed(6));
}

// ------------------------------------------------------------------ export

async function cmdExport(args) {
    const run = requireRun(args[0]);
    sliceKey();
    const records = loadRunCases('B', run);
    if (!records.length) { warn(`STOP no side-B run${run} case records under ${CFG.out}/B`); return EXIT.USAGE; }
    const outFile = path.join(CFG.out, 'B', `export-run${run}.json`);
    const logFile = path.join(CFG.out, 'B', `export-run${run}-requests.jsonl`);
    const log = (entry) => appendLine(logFile, entry);
    const report = { schema: 'r3d-s390-ab-export-v1', run, started_at: nowIso(), cases: [], controls: [], summary: {} };
    let failures = 0;
    let networkErrors = 0;
    const save = () => writeJson(outFile, report);
    const done = records.filter((r) => r.result_status === 200 && r.result?.success === true && receiptOf(r.result));

    for (const r of done) {
        const c = r.case;
        const receipt = receiptOf(r.result);
        let data;
        try { data = fs.readFileSync(path.join(CFG.corpus, c.file)); } catch (error) {
            report.cases.push({ case: c.id, error: `corpus file unreadable: ${error.message}` });
            failures += 1;
            continue;
        }
        const sourceSha = sha256(data);
        const entry = { case: c.id, orientationMode: c.orientationMode, source_sha256: sourceSha,
            receipt_source_sha256: receipt.source?.sha256, source_matches_receipt: sourceSha === receipt.source?.sha256 };
        let base = setField(r.request.fields, 'expectedMeasurementGeneration', receipt.measurement_generation);
        base = setField(base, 'expectedSourceSha256', sourceSha);
        const exact = setField(base, 'expectedSlicedGeometrySha256', receipt.source.sliced_geometry_sha256);
        // STL, exact
        const stl = await runExport({ label: `${c.id}-stl`, fields: setField(exact, 'exportFormat', 'stl'), fileName: uploadName(c.file), data, log });
        entry.stl = { ...stripBody(stl), verify: verifyExport(stl, receipt, { format: 'stl', expectExact: true, sourceSha }) };
        if (stl.outcome === 'network_error') networkErrors += 1;
        const mismatch = stl.result_status === 409 && errorCodeOf(stl.result) === 'EXPORT_GEOMETRY_MISMATCH';
        if (entry.stl.verify.ok) {
            entry.fidelity = 'exact';
            // 3MF of the same exact export
            const tmf = await runExport({ label: `${c.id}-3mf`, fields: setField(exact, 'exportFormat', '3mf'), fileName: uploadName(c.file), data, log });
            if (tmf.fileBody) tmf.threeMf = threeMfRoundTrip(tmf.fileBody, stl.fileBody);
            entry['3mf'] = { ...stripBody(tmf), verify: verifyExport(tmf, receipt, { format: '3mf', expectExact: true, sourceSha }) };
            if (!entry['3mf'].verify.ok) {
                // A degenerate triangle makes 3MF core impossible (spec §2.2): 500 EXPORT_WRITE_FAILED is then the contract.
                const writeFailed = tmf.result_status === 500 && errorCodeOf(tmf.result) === 'EXPORT_WRITE_FAILED';
                entry['3mf'].verdict = writeFailed ? 'export_write_failed (allowed only for a degenerate placed mesh: check)' : 'fail';
                failures += 1;
            }
        } else if (mismatch && c.orientationMode === 'auto') {
            // §2.2 step 2: preserve + the receipt's total rotation, no expected sliced hash.
            const rot = receipt.geometry?.model_transform?.rotation_deg || {};
            let fb = removeField(base, 'expectedSlicedGeometrySha256');
            fb = setField(fb, 'orientationMode', 'preserve');
            fb = setField(fb, 'rotationX', String(rot.x));
            fb = setField(fb, 'rotationY', String(rot.y));
            fb = setField(fb, 'rotationZ', String(rot.z));
            const fbRec = await runExport({ label: `${c.id}-fallback`, fields: setField(fb, 'exportFormat', 'stl'), fileName: uploadName(c.file), data, log });
            const verify = verifyExport(fbRec, receipt, { format: 'stl', expectExact: false, sourceSha });
            const checks = fbRec.file?.status === 200 ? fallbackChecks(fbRec.file.headers, receipt) : null;
            entry.fallback = { ...stripBody(fbRec), verify, checks };
            entry.fidelity = verify.ok && checks?.all && verify.fidelity === 'unverified' ? 'unverified' : 'fallback_failed';
            if (entry.fidelity !== 'unverified') failures += 1;
        } else {
            entry.fidelity = 'missing';
            failures += 1; // preserve must be exact (T-EXP); any other refusal is reported
        }
        report.cases.push(entry);
        say(JSON.stringify({ case: c.id, mode: c.orientationMode, stl_status: stl.result_status, stl_errorCode: errorCodeOf(stl.result),
            fidelity: entry.fidelity, '3mf_ok': entry['3mf']?.verify?.ok ?? null, delete: stl.delete?.status ?? null,
            get_after_delete: stl.get_after_delete?.status ?? null }));
        if (stl.job_id && (stl.delete?.status !== 204 || stl.get_after_delete?.status !== 404)) failures += 1;
        save();
    }

    const byId = new Map(records.map((r) => [r.case.id, r]));
    // Negative controls (two preserve cases): +180 deg on X, then on Z.
    for (const id of CFG.negativeCases) {
        const r = byId.get(id);
        if (!r || r.result_status !== 200 || !receiptOf(r.result)) {
            report.controls.push({ case: id, error: 'no completed side-B slice for this control case' });
            failures += 1;
            continue;
        }
        const c = r.case;
        const receipt = receiptOf(r.result);
        const data = fs.readFileSync(path.join(CFG.corpus, c.file));
        let base = setField(r.request.fields, 'expectedMeasurementGeneration', receipt.measurement_generation);
        base = setField(base, 'expectedSourceSha256', sha256(data));
        base = setField(base, 'exportFormat', 'stl');
        for (const axis of ['X', 'Z']) {
            const field = `rotation${axis}`;
            const original = Number((base.find(([n]) => n === field) || [null, '0'])[1]);
            const turned = setField(base, field, String(wrapRotation(original)));
            const withHash = await runExport({ label: `${id}-neg${axis}-hash`, fields: setField(turned, 'expectedSlicedGeometrySha256', receipt.source.sliced_geometry_sha256), fileName: uploadName(c.file), data, log });
            const hashVerdict = withHash.result_status === 409 && errorCodeOf(withHash.result) === 'EXPORT_GEOMETRY_MISMATCH';
            const noHash = await runExport({ label: `${id}-neg${axis}-nohash`, fields: removeField(turned, 'expectedSlicedGeometrySha256'), fileName: uploadName(c.file), data, log });
            const checks = noHash.file?.status === 200 ? fallbackChecks(noHash.file.headers, receipt) : null;
            const noHashVerdict = checks ? checks.a_rotation_matrix_1e6 === false && checks.all === false : false;
            report.controls.push({ case: id, kind: `negative_${axis}_plus_180`, pass: hashVerdict && noHashVerdict, axis, sent: { [field]: wrapRotation(original) },
                with_expected_hash: { ...stripBody(withHash), expect: '409 EXPORT_GEOMETRY_MISMATCH', pass: hashVerdict },
                without_expected_hash: { ...stripBody(noHash), checks, expect: 'check (a) fails', pass: noHashVerdict } });
            say(JSON.stringify({ control: id, axis, with_hash: `${withHash.result_status} ${errorCodeOf(withHash.result)}`, with_hash_pass: hashVerdict,
                no_hash_check_a: checks?.a_rotation_matrix_1e6 ?? null, no_hash_check_b: checks?.b_final_dimensions_001mm ?? null, no_hash_pass: noHashVerdict }));
            if (!hashVerdict || !noHashVerdict) failures += 1;
            save();
        }
    }

    // One sync export (no Prefer) of the cube, and a wrong expectedSourceSha256.
    const cube = byId.get(CFG.syncExportCase);
    if (cube && cube.result_status === 200 && receiptOf(cube.result)) {
        const receipt = receiptOf(cube.result);
        const data = fs.readFileSync(path.join(CFG.corpus, cube.case.file));
        let base = setField(cube.request.fields, 'expectedMeasurementGeneration', receipt.measurement_generation);
        base = setField(base, 'expectedSourceSha256', sha256(data));
        base = setField(base, 'expectedSlicedGeometrySha256', receipt.source.sliced_geometry_sha256);
        base = setField(base, 'exportFormat', 'stl');
        const sync = await runExport({ label: `${cube.case.id}-sync`, fields: base, fileName: uploadName(cube.case.file), data, sync: true, log });
        const present = sync.file ? SYNC_EXPORT_HEADERS.filter((h) => sync.file.headers[h] !== undefined) : [];
        const missing = SYNC_EXPORT_HEADERS.filter((h) => !present.includes(h));
        const verify = verifyExport(sync, receipt, { format: 'stl', expectExact: true, sourceSha: sha256(data) });
        const echo = sync.file?.headers['x-request-id'] === sync.request_id;
        const pass = sync.result_status === 200 && missing.length === 0 && verify.ok && echo;
        report.controls.push({ case: cube.case.id, kind: 'sync_export', ...stripBody(sync), headers_missing: missing, request_id_echoed: echo, verify, pass });
        say(JSON.stringify({ control: 'sync_export', status: sync.result_status, errorCode: errorCodeOf(sync.result), headers_missing: missing, request_id_echoed: echo, pass }));
        if (!pass) failures += 1;

        const wrongSource = setField(base, 'expectedSourceSha256', sha256(Buffer.concat([data, Buffer.from('x')])));
        const ws = await runExport({ label: `${cube.case.id}-wrong-source`, fields: wrongSource, fileName: uploadName(cube.case.file), data, log });
        const wsPass = ws.result_status === 409 && errorCodeOf(ws.result) === 'EXPORT_SOURCE_MISMATCH' && !ws.job_id;
        report.controls.push({ case: cube.case.id, kind: 'wrong_expected_source', ...stripBody(ws), expect: 'synchronous 409 EXPORT_SOURCE_MISMATCH (even with Prefer)', pass: wsPass });
        say(JSON.stringify({ control: 'wrong_expected_source', status: ws.result_status, errorCode: errorCodeOf(ws.result), pass: wsPass }));
        if (!wsPass) failures += 1;
    } else {
        report.controls.push({ case: CFG.syncExportCase, error: 'no completed side-B slice for the sync export control' });
        failures += 1;
    }

    const preserve = report.cases.filter((e) => e.orientationMode === 'preserve');
    const auto = report.cases.filter((e) => e.orientationMode === 'auto');
    report.summary = {
        exported_cases: report.cases.length,
        preserve_exact: `${preserve.filter((e) => e.fidelity === 'exact').length}/${preserve.length}`,
        auto_exact: `${auto.filter((e) => e.fidelity === 'exact').length}/${auto.length}`,
        auto_unverified_fallback_passed: auto.filter((e) => e.fidelity === 'unverified').length,
        missing_or_failed: report.cases.filter((e) => !['exact', 'unverified'].includes(e.fidelity)).map((e) => e.case),
        controls_passed: `${report.controls.filter((x) => x.pass).length}/${report.controls.length}`,
        failures,
        network_errors: networkErrors
    };
    report.finished_at = nowIso();
    save();
    say(JSON.stringify(report.summary));
    if (networkErrors) return EXIT.NETWORK;
    return failures ? EXIT.EXPECTATION : EXIT.OK;
}

// ------------------------------------------------------------------ delete-artifact

async function listOutputFiles(log) {
    const key = process.env[CFG.artifactKeyName];
    if (!key) return { skipped: `${CFG.artifactKeyName} not set` };
    const res = await request({ method: 'GET', urlPath: '/admin/output-files', headers: { 'x-api-key': key } });
    log({ at: nowIso(), what: 'admin_output_files', status: res.status, error: res.error });
    return { status: res.status, error: res.error, text: res.body.toString('utf8') };
}

function listedIn(listing, artifactId) {
    if (listing.skipped) return listing;
    return listing.status === 200 ? listing.text.includes(artifactId) : { status: listing.status, error: listing.error };
}

async function cmdDeleteArtifact() {
    const key = sliceKey();
    const corpus = loadCorpus();
    const c = corpus.cases.find((x) => x.id === CFG.deleteCase);
    if (!c) { warn(`STOP case ${CFG.deleteCase} not in cases.json`); return EXIT.USAGE; }
    const dir = path.join(CFG.out, 'B');
    const logFile = path.join(dir, 'delete-artifact-requests.jsonl');
    const log = (entry) => appendLine(logFile, entry);
    const marker = path.join(CFG.out, 'go-delete');
    if (fs.existsSync(marker)) { warn(`STOP ${marker} already exists; remove it first`); return EXIT.USAGE; }
    const pins = await loadPins(log);
    const fileName = uploadName(c.file);
    const data = fs.readFileSync(path.join(CFG.corpus, c.file));
    const rec = await runSliceJob({ side: 'B', label: 'delete-artifact', fields: sliceFields(c, pins.find(c)), fileName, data,
        timeoutSec: CFG.caseTimeoutSec, keepJob: true, log });
    const report = { schema: 'r3d-s390-ab-delete-artifact-v1', case: c.id, at: nowIso(), job_id: rec.job_id, outcome: rec.outcome,
        result_status: rec.result_status };
    if (rec.outcome !== 'completed' || rec.result_status !== 200) {
        report.error = 'the control slice did not complete with 200';
        writeJson(path.join(dir, 'delete-artifact.json'), { ...report, record: rec });
        say(JSON.stringify(report));
        return rec.outcome === 'network_error' ? EXIT.NETWORK : EXIT.EXPECTATION;
    }
    const artifactId = rec.result.artifact_id || receiptOf(rec.result)?.artifact?.id;
    const base = path.parse(fileName.replace(/\.gcode\.3mf$/i, '')).name.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/(^-+)|(-+$)/g, '') || 'output';
    report.artifact_id = artifactId;
    report.artifact_file = `${base}-output-${artifactId}.gcode.3mf`;
    report.sidecar_file = `.${artifactId}.json`;
    report.receipt_artifact = receiptOf(rec.result)?.artifact || null;
    const before = await listOutputFiles(log);
    report.listed_before = listedIn(before, artifactId);
    say(`job ${rec.job_id}`);
    say(`artifact ${artifactId}`);
    say(`host file (expected): /srv/r3d-s390-private/output/${report.artifact_file}`);
    say(`host sidecar (expected): /srv/r3d-s390-private/output/${report.sidecar_file}`);
    say(`listed by /admin/output-files before DELETE: ${JSON.stringify(report.listed_before)}`);
    say(`NOW on the host: ls -la the two paths above (and copy the .gcode.3mf for T-RET-4), then: touch <out dir>/go-delete`);
    writeJson(path.join(dir, 'delete-artifact.json'), report);
    const waitUntil = Date.now() + CFG.waitSec * 1000;
    while (!fs.existsSync(marker)) {
        if (Date.now() > waitUntil) {
            report.error = `no ${marker} within ${CFG.waitSec}s; the job is deleted now anyway`;
            break;
        }
        await sleep(1000);
    }
    report.delete = await deleteJob(`/bambu/slice/jobs/${rec.job_id}`, key, rec.request_id, log, 'delete-artifact');
    const after = await request({ method: 'GET', urlPath: `/bambu/slice/jobs/${rec.job_id}`, headers: { 'x-slicer-api-key': key } });
    report.get_after_delete = { status: after.status, error: after.error, errorCode: errorCodeOf(parseBody(after)) };
    const afterList = await listOutputFiles(log);
    report.listed_after = listedIn(afterList, artifactId);
    try { fs.unlinkSync(marker); } catch { /* the operator may remove it */ }
    report.finished_at = nowIso();
    writeJson(path.join(dir, 'delete-artifact.json'), report);
    say(`DELETE ${rec.job_id}: ${report.delete.status} (expect 204); GET after: ${report.get_after_delete.status} (expect 404); listed after: ${JSON.stringify(report.listed_after)}`);
    say('NOW on the host: ls -la the two paths again; both must be gone.');
    if (report.delete.status === null || after.status === null) return EXIT.NETWORK;
    const pass = report.delete.status === 204 && report.get_after_delete.status === 404 && report.listed_after !== true && !report.error;
    return pass ? EXIT.OK : EXIT.EXPECTATION;
}

// ------------------------------------------------------------------ compare

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}

/** Identity fields per spec §7 corpus A/B and §8 step 4 (receipt key names from bambu-receipt.js). */
function identityOf(rec) {
    const result = rec.result && typeof rec.result === 'object' ? rec.result : null;
    const receipt = receiptOf(result);
    const fields = {
        measurement_generation: receipt?.measurement_generation,
        'profiles.effective_profile_sha256': receipt?.profiles?.effective_profile_sha256,
        'engine.build_sha256': receipt?.engine?.build_sha256,
        'engine.version': receipt?.engine?.version,
        'profiles.bundle_sha256': receipt?.profiles?.bundle_sha256,
        'applied.configuration_sha256': receipt?.applied?.configuration_sha256,
        'geometry.model_transform': receipt?.geometry?.model_transform,
        model_transform: result?.model_transform,
        'response.profiles.effective_profile_sha256': result?.profiles?.effective_profile_sha256
    };
    for (const [k, v] of Object.entries(receipt?.source || {})) if (/sha256$/.test(k)) fields[`source.${k}`] = v;
    return fields;
}

function outcomeOf(rec) {
    return { result_status: rec.result_status ?? null, errorCode: errorCodeOf(rec.result), archive_rule: rec.result?.archive_rule ?? null };
}

function loadSide(side) {
    const sideDir = path.join(CFG.out, side);
    const byCase = new Map();
    if (!fs.existsSync(sideDir)) return byCase;
    for (const runDir of fs.readdirSync(sideDir).filter((d) => /^run\d+$/.test(d)).sort()) {
        for (const rec of loadRunCases(side, Number(runDir.slice(3)))) {
            if (!byCase.has(rec.case.id)) byCase.set(rec.case.id, []);
            byCase.get(rec.case.id).push(rec);
        }
    }
    return byCase;
}

function factBand(aValues, w = 0.01) {
    const values = aValues.filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = min > 0 ? (max - min) / min : 0;
    const widen = Math.max(spread, w);
    return { min, max, spread, widen, low: min * (1 - widen), high: max * (1 + widen) };
}

function cmdCompare() {
    const A = loadSide('A');
    const B = loadSide('B');
    if (!A.size || !B.size) { warn(`STOP need case records under ${CFG.out}/A/run*/ and ${CFG.out}/B/run*/`); return EXIT.USAGE; }
    const ids = [...new Set([...A.keys(), ...B.keys()])].sort();
    const rows = [];
    let identityDiffs = 0;
    let factDiffs = 0;
    for (const id of ids) {
        const a = A.get(id) || [];
        const b = B.get(id) || [];
        const c = (a[0] || b[0]).case;
        const row = { case: id, expectDiffers: Boolean(c.expectDiffers), runs: { A: a.map((r) => r.run), B: b.map((r) => r.run) },
            identity_diffs: [], outcome_equal: null, facts: {}, problems: [] };
        if (!a.length || !b.length) row.problems.push(`missing runs (A ${a.length}, B ${b.length})`);
        const runErrors = [...a, ...b].filter((r) => !isAnswered(r));
        if (runErrors.length) row.problems.push(`run errors: ${runErrors.map((r) => `${r.side}${r.run}:${r.outcome}`).join(' ')}`);
        const all = [...a, ...b];
        const identities = all.map(identityOf);
        const keys = [...new Set(identities.flatMap((x) => Object.keys(x)))].sort();
        for (const k of keys) {
            const values = new Set(identities.map((x) => canonical(x[k])));
            if (values.size > 1) {
                row.identity_diffs.push({ field: k, by_run: all.map((r, i) => ({ run: `${r.side}${r.run}`, value: identities[i][k] ?? null })) });
            }
        }
        const outcomes = all.map((r) => canonical(outcomeOf(r)));
        row.outcome_equal = new Set(outcomes).size === 1;
        row.outcome = outcomeOf(all[0]);
        row.outcomes_by_run = all.map((r) => ({ run: `${r.side}${r.run}`, ...outcomeOf(r) }));
        for (const fact of ['print_time_seconds', 'material_used_g']) {
            const aVals = a.map((r) => r.result?.stats?.[fact]).filter((v) => v !== undefined && v !== null);
            const bVals = b.map((r) => r.result?.stats?.[fact]).filter((v) => v !== undefined && v !== null);
            if (!aVals.length && !bVals.length) continue;
            const band = factBand(aVals);
            const inside = band ? bVals.every((v) => v >= band.low && v <= band.high) : false;
            const byteEqual = new Set([...aVals, ...bVals].map(String)).size === 1;
            row.facts[fact] = { A: aVals, B: bVals, band, B_inside: inside && bVals.length === b.length, byte_equal: byteEqual };
            if (!row.facts[fact].B_inside) row.problems.push(`${fact} B outside A band`);
        }
        if (!row.outcome_equal) row.problems.push('result_status / errorCode / archive_rule differ');
        if (row.expectDiffers) {
            const exp = c.expect?.B;
            row.expectation_B_met = exp ? b.every((r) => r.result_status === exp.status && errorCodeOf(r.result) === exp.errorCode
                && (exp.archive_rule === undefined || r.result?.archive_rule === exp.archive_rule)) : null;
            row.verdict = row.expectation_B_met === false || runErrors.some((r) => r.side === 'B') ? 'expected-difference: B NOT as expected' : 'expected-difference (reported, not gated)';
            if (row.expectation_B_met === false) factDiffs += 1;
        } else if (row.identity_diffs.length) {
            row.verdict = 'IDENTITY DIFFERENCE';
            identityDiffs += 1;
        } else if (row.problems.length) {
            row.verdict = 'DIFFERENCE';
            factDiffs += 1;
        } else {
            row.verdict = 'equal';
        }
        rows.push(row);
    }
    const catalogue = {};
    for (const label of ['v2', 'v3']) {
        const metaA = path.join(CFG.out, 'A', `catalogue-${label}.meta.json`);
        const metaB = path.join(CFG.out, 'B', `catalogue-${label}.meta.json`);
        if (fs.existsSync(metaA) && fs.existsSync(metaB)) {
            const ma = readJson(metaA);
            const mb = readJson(metaB);
            catalogue[label] = { A: ma.body_sha256, B: mb.body_sha256, equal: ma.body_sha256 === mb.body_sha256 && ma.status === 200 && mb.status === 200,
                catalogue_sha256_equal: ma.catalogue_sha256 === mb.catalogue_sha256 };
            if (!catalogue[label].equal) identityDiffs += 1;
        } else {
            catalogue[label] = { missing: true };
        }
    }
    const summary = { cases: rows.length, equal: rows.filter((r) => r.verdict === 'equal').length, identity_differences: identityDiffs,
        other_differences: factDiffs, expected_differences: rows.filter((r) => r.expectDiffers).map((r) => `${r.case}: ${r.verdict}`), catalogue };
    writeJson(path.join(CFG.out, 'compare.json'), { schema: 'r3d-s390-ab-compare-v1', at: nowIso(), summary, rows });
    const pad = (s, n) => String(s).padEnd(n).slice(0, n);
    say(`${pad('case', 28)} ${pad('runs A/B', 9)} ${pad('status/code', 34)} ${pad('time A[min,max] B', 30)} ${pad('grams A[min,max] B', 30)} verdict`);
    for (const r of rows) {
        const f = (k) => (r.facts[k] ? `[${r.facts[k].band?.min},${r.facts[k].band?.max}] ${r.facts[k].B.join('/')}` : '-');
        say(`${pad(r.case, 28)} ${pad(`${r.runs.A.length}/${r.runs.B.length}`, 9)} ${pad(`${r.outcome.result_status} ${r.outcome.errorCode || ''}${r.outcome_equal ? '' : ' (differs)'}`, 34)} ${pad(f('print_time_seconds'), 30)} ${pad(f('material_used_g'), 30)} ${r.verdict}${r.identity_diffs.length ? ` [${r.identity_diffs.map((d) => d.field).join(', ')}]` : ''}${r.problems.length ? ` {${r.problems.join('; ')}}` : ''}`);
    }
    say(`catalogue: ${JSON.stringify(catalogue)}`);
    say(JSON.stringify({ cases: summary.cases, equal: summary.equal, identity_differences: identityDiffs, other_differences: factDiffs }));
    if (identityDiffs) return EXIT.IDENTITY;
    return factDiffs ? EXIT.FACTS : EXIT.OK;
}

// ------------------------------------------------------------------ main

const USAGE = `usage: ab-client.js <subcommand>
  corpus <A|B> <run> [--only id,id] [--skip id,id]
  catalogue <A|B>
  capabilities <A|B>
  auth <A|B>
  ready <seconds> [A|B]
  export <run>
  delete-artifact
  compare`;

async function main() {
    const [cmd, ...args] = process.argv.slice(2);
    switch (cmd) {
        case 'corpus': return cmdCorpus(args);
        case 'catalogue': return cmdCatalogue(args);
        case 'capabilities': return cmdCapabilities(args);
        case 'auth': return cmdAuth(args);
        case 'ready': return cmdReady(args);
        case 'export': return cmdExport(args);
        case 'delete-artifact': return cmdDeleteArtifact(args);
        case 'compare': return cmdCompare(args);
        default:
            warn(USAGE);
            return EXIT.USAGE;
    }
}

if (require.main === module) {
    main().then((code) => process.exit(code ?? EXIT.OK), (error) => {
        warn(`FATAL ${error && error.stack ? error.stack : error}`);
        process.exit(EXIT.USAGE);
    });
}

module.exports = { redact, sliceFields, setField, removeField, fallbackChecks, threeMfRoundTrip, unzipEntries, factBand, identityOf, wrapRotation, canonical };
