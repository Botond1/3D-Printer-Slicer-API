'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { PEER_HTTP_PROBE } = require('../../../scripts/i6-topology-probes');
const exec = promisify(execFile);
const KEY = 'inert-i6-readiness-schema-key';

function readiness() {
    return {
        checkedAt: '2026-09-06T18:00:00.000Z', ready: true, admissionOpen: true,
        probes: { queue: true, native: true, storage: true, retention: true,
            pricing: true, config: true, bambu: true, commonDependencies: true },
        reasonCodes: [], queue: { queueLength: 0, activeJobs: 0, maxConcurrent: 1,
            maxQueueLength: 10, maxQueuePerClient: 3, acceptingJobs: true },
        legacyMigration: { enabled: false, audience: null, expiresAt: null },
        slicerRuntime: {
            bambuReady: true, commonDependenciesReady: true,
            dependencyEvidence: 'startup_import_and_fresh_file_presence',
            engines: {
                bambu: { available: true, version: '02.08.02.61', required_for_bambu: true },
                prusa: { available: true, version: '2.8.1+linux-x64-GTK3', required_for_bambu: false },
                orca: { available: true, version: '2.3.1', required_for_bambu: false }
            }
        }
    };
}

test('actual private-peer HTTP probe strictly validates the extended readiness contract', async t => {
    let body = readiness();
    let authenticatedStatus = 200;
    let rejectionStatus = 401;
    const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/health') return res.end(JSON.stringify({ status: 'OK', uptime: 1 }));
        if (req.url === '/ready') return res.end(JSON.stringify({ status: 'READY' }));
        if (req.headers['x-api-key'] === KEY) {
            res.statusCode = authenticatedStatus;
            return res.end(JSON.stringify(body));
        }
        res.statusCode = rejectionStatus;
        res.end(JSON.stringify({ success: false, error: 'Operations authentication is required.',
            errorCode: 'OPERATIONS_AUTH_REQUIRED' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const probe = async () => JSON.parse((await exec(process.execPath,
        ['-e', PEER_HTTP_PROBE, '127.0.0.1', String(server.address().port)],
        { env: { ...process.env, OPERATIONS_API_KEY: KEY }, timeout: 5000 })).stdout);
    assert.deepEqual(await probe(), { privatePeerIngress: true,
        authenticatedReadiness: true, authRejectionProof: true });
    await t.test('optional absent engine remains an explicit valid status', async () => {
        body = readiness();
        body.slicerRuntime.engines.orca = { available: false, version: null, required_for_bambu: false };
        assert.equal((await probe()).authenticatedReadiness, true);
    });
    const mutations = {
        'missing runtime': value => { delete value.slicerRuntime; },
        'missing Bambu probe': value => { delete value.probes.bambu; },
        'false Bambu probe': value => { value.probes.bambu = false; },
        'unknown top-level field': value => { value.privatePath = '/private'; },
        'unknown runtime field': value => { value.slicerRuntime.privatePath = '/private'; },
        'unavailable Bambu': value => { value.slicerRuntime.engines.bambu.available = false; },
        'false native identity': value => { value.slicerRuntime.bambuReady = false; },
        'missing common dependencies': value => { value.slicerRuntime.commonDependenciesReady = false; },
        'wrong dependency evidence': value => { value.slicerRuntime.dependencyEvidence = 'assumed'; },
        'unbounded version': value => { value.slicerRuntime.engines.bambu.version = 'x'.repeat(100); },
        'oversized numeric version': value => { value.slicerRuntime.engines.bambu.version = '1'.repeat(65) + '.2.3'; },
        'untrusted version suffix': value => { value.slicerRuntime.engines.prusa.version = '2.8.1+/private'; },
        'Bambu suffix not emitted by parser': value => { value.slicerRuntime.engines.bambu.version = '02.08.02.61+other'; },
        'invalid optional version': value => { value.slicerRuntime.engines.orca.version = null; },
        'wrong engine requirement': value => { value.slicerRuntime.engines.prusa.required_for_bambu = true; },
        'readiness reason present': value => { value.reasonCodes = ['BAMBU_RUNTIME_UNAVAILABLE']; }
    };
    for (const [name, mutate] of Object.entries(mutations)) {
        await t.test(name, async () => {
            body = readiness();
            mutate(body);
            const result = await probe();
            assert.equal(result.privatePeerIngress, true);
            assert.equal(result.authenticatedReadiness, false);
            assert.equal(result.authRejectionProof, true);
        });
    }
    body = readiness();
    authenticatedStatus = 503;
    assert.equal((await probe()).authenticatedReadiness, false);
    authenticatedStatus = 200;
    rejectionStatus = 200;
    assert.equal((await probe()).authRejectionProof, false);
});
