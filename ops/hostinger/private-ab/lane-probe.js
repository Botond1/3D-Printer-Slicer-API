'use strict';
// Fast-lane probe for the private A/B (MAX_CONCURRENT_SLICES=1 there): one large
// asynchronous job, then a small cube five seconds later. Records when each
// started to run and completed. The key is read from the environment and never printed.
const fs = require('node:fs');
const side = process.argv[2] || 'X';
const base = `http://${process.env.AB_HOST || 'r3d-s390-private'}:3000`;
const key = process.env.SLICE_SERVICE_WOOCOMMERCE_API_KEY || '';
const fields = { material: 'PLA', layerHeight: '0.2', infill: '20', printerProfile: 'P1S', orientationMode: 'preserve' };
const started = Date.now();
const at = () => Math.round((Date.now() - started) / 100) / 10;

async function submit(file, name) {
    const form = new FormData();
    form.append('choosenFile', new Blob([fs.readFileSync(`/corpus/${file}`)]), name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const response = await fetch(`${base}/bambu/slice`, { method: 'POST', headers: { 'x-slicer-api-key': key, Prefer: 'respond-async' }, body: form });
    const body = await response.json();
    return { status: response.status, job: body.job_id, submitted_s: at() };
}

async function watch(record) {
    for (;;) {
        await new Promise((ok) => setTimeout(ok, 500));
        const response = await fetch(`${base}/bambu/slice/jobs/${record.job}`, { headers: { 'x-slicer-api-key': key } });
        const body = await response.json();
        if (body.status === 'running' && record.running_s === undefined) record.running_s = at();
        if (['completed', 'failed', 'expired', 'cancelled'].includes(body.status)) {
            record.final = body.status;
            record.result_status = body.result_status;
            record.completed_s = at();
            record.print_time_seconds = body.result?.stats?.print_time_seconds;
            return record;
        }
        if (at() > 900) { record.final = 'probe_timeout'; return record; }
    }
}

(async () => {
    const big = await submit('pillars-900-open.stl', 'pillars.stl');
    await new Promise((ok) => setTimeout(ok, 5000));
    const small = await submit('cube-40.stl', 'cube.stl');
    const capabilities = await fetch(`${base}/capabilities`, { headers: { 'x-slicer-api-key': key } }).then((r) => r.json()).catch(() => ({}));
    const [bigDone, smallDone] = await Promise.all([watch(big), watch(small)]);
    const report = { side, fast_lane: capabilities.fast_lane || null, big: { ...bigDone, job: undefined }, small: { ...smallDone, job: undefined },
        small_finished_before_big: smallDone.completed_s < bigDone.completed_s };
    fs.writeFileSync(`/out/lane-${side}.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
})().catch((error) => { console.error(`FATAL ${error && error.message}`); process.exit(2); });
