'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { auditWorkspacesThenListen } = require('../../../app/services/slice/workspace');

test('startup listener is not invoked until the audit promise settles', async () => {
    const events = [];
    let releaseAudit;
    const auditGate = new Promise((resolve) => { releaseAudit = resolve; });
    const startup = auditWorkspacesThenListen({
        audit: async () => {
            events.push('audit-start');
            await auditGate;
            events.push('audit-end');
            return { stale: 0 };
        },
        onAudit(summary) { events.push(`report-${summary.stale}`); },
        listen() { events.push('listen'); return 'listener'; }
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['audit-start']);
    releaseAudit();
    assert.equal(await startup, 'listener');
    assert.deepEqual(events, ['audit-start', 'audit-end', 'report-0', 'listen']);
});
test('server creates required directories before invoking the audit-before-listen sequence', async () => {
    const serverPath = path.resolve(__dirname, '../../../app/server.js');
    const source = await fs.readFile(serverPath, 'utf8');
    const ensureIndex = source.indexOf('ensureRequiredDirectories();');
    const startIndex = source.lastIndexOf('startServer().catch');
    assert.ok(ensureIndex >= 0);
    assert.ok(startIndex > ensureIndex);
    assert.match(source, /auditOptions:\s*\{[\s\S]*JOB_WORKSPACE_STALE_AGE_MS/);
    assert.doesNotMatch(source, /delete:\s*true/);
});
