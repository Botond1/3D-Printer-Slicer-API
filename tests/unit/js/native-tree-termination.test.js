'use strict';

/**
 * Real process trees through the REAL command runner and the REAL tree
 * terminator (3.8.1). Before 3.8.1 the runner started natives through
 * child_process.execFile, which drops `detached`: on POSIX the native never led
 * its own process group, `kill(-pid)` reached nothing, `native.termination_settled`
 * reported success in ~1 ms and the tree kept running. Every test here spawns a
 * parent that ignores SIGTERM plus a grandchild in its group, and requires every
 * PID to be gone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const originalPythonExecutable = process.env.PYTHON_EXECUTABLE;
process.env.PYTHON_EXECUTABLE = process.execPath;
const { createAsyncHarness, SLICE_PARTS } = require('./helpers/async-slice-harness');
const { createCommandRunner } = require('../../../app/services/slice/command');
const { spawnFile } = require('../../../app/services/slice/spawn-file');
const { setEventWriter } = require('../../../app/services/observability/events');

const POSIX = process.platform !== 'win32';
// POSIX: SIGTERM grace before SIGKILL. Windows: also the taskkill.exe budget,
// which a loaded host can exceed at a few hundred milliseconds.
const GRACE_MS = POSIX ? 300 : 3_000;
const events = [];
const spawnedPids = new Set();
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'native-tree-'));
const TREE_SCRIPT = path.join(workRoot, 'tree.js');
fs.writeFileSync(TREE_SCRIPT, [
    "'use strict';",
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    '// Like a busy native slicer: the root does not stop on SIGTERM, and neither does its child.',
    "process.on('SIGTERM', () => {});",
    "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"],",
    "    { stdio: 'ignore', windowsHide: true });",
    "const record = JSON.stringify({ parent: process.pid, grandchild: grandchild.pid });",
    "fs.writeFileSync(process.argv[2] + '.tmp', record);",
    "fs.renameSync(process.argv[2] + '.tmp', process.argv[2]);",
    'setInterval(() => {}, 1000);'
].join('\n'));

setEventWriter((entry) => events.push(entry));
test.after(() => {
    setEventWriter((entry) => console.info(JSON.stringify(entry)));
    for (const pid of spawnedPids) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    fs.rmSync(workRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    if (originalPythonExecutable === undefined) delete process.env.PYTHON_EXECUTABLE;
    else process.env.PYTHON_EXECUTABLE = originalPythonExecutable;
});

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

async function waitFor(predicate, timeoutMs, message) {
    const started = Date.now();
    while (!(await predicate())) {
        if (Date.now() - started > timeoutMs) throw new Error(message);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

let treeCounter = 0;
function nextPidFile() {
    treeCounter += 1;
    return path.join(workRoot, `tree-${treeCounter}.json`);
}

async function readTree(pidFile) {
    await waitFor(() => fs.existsSync(pidFile), 10_000, 'the native tree never started');
    const tree = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    spawnedPids.add(tree.parent);
    spawnedPids.add(tree.grandchild);
    assert.equal(isAlive(tree.parent), true);
    assert.equal(isAlive(tree.grandchild), true);
    return tree;
}

/** Every PID gone; while any is alive the queue must still hold the slot. */
async function assertTreeGone(tree, queue) {
    await waitFor(() => {
        const alive = [tree.parent, tree.grandchild].filter(isAlive);
        if (alive.length && queue) {
            assert.equal(queue.getQueueStatus().activeJobs, 1, 'the slot was released while the tree lived');
        }
        return alive.length === 0;
    }, 30_000, `native tree survived: parent ${tree.parent} alive=${isAlive(tree.parent)}, grandchild ${tree.grandchild} alive=${isAlive(tree.grandchild)}`);
}

function nativeEvents(name, since) {
    return events.filter((entry) => entry.event === name && Date.parse(entry.timestamp) >= since);
}

function assertTerminationEvents(since) {
    const settled = nativeEvents('native.termination_settled', since);
    assert.equal(settled.length, 1, 'one termination settled');
    assert.equal(settled[0].outcome, 'success');
    // The root ignores SIGTERM: only the SIGKILL after the grace ends the
    // group, so a real termination cannot settle in ~1 ms.
    if (POSIX) assert.ok(settled[0].duration_ms >= GRACE_MS - 50, `settled in ${settled[0].duration_ms} ms`);
    const completed = nativeEvents('native.completed', since);
    assert.equal(completed.length, 1, 'native.completed was emitted');
    assert.equal(completed[0].outcome, 'aborted');
    assert.equal(completed[0].error_code, 'NATIVE_ABORTED');
}

function realNativePipeline() {
    const runner = createCommandRunner({ terminationDependencies: { graceMs: GRACE_MS, pollMs: 10 } });
    const state = { runs: [], pidFiles: [] };
    return {
        state,
        async processSlice(req, res, options) {
            const pidFile = nextPidFile();
            state.pidFiles.push(pidFile);
            state.runs.push(options);
            await runner(process.execPath, [TREE_SCRIPT, pidFile], { signal: options.signal });
            return res.status(200).json({ success: true });
        }
    };
}

test('spawnFile matches execFile and, on POSIX, makes the native lead its own process group', async () => {
    const run = (fn, args, options = {}) => new Promise((resolve) => {
        fn(process.execPath, args, { windowsHide: true, ...options }, (error, stdout, stderr) => resolve({
            error: error && { message: error.message, code: error.code, killed: error.killed, signal: error.signal, cmd: error.cmd },
            stdout, stderr
        }));
    });
    for (const [args, options] of [
        [['-e', "process.stdout.write('ok'); process.stderr.write('warn')"], {}],
        [['-e', "process.stderr.write('bad'); process.exit(3)"], {}],
        [['-e', "process.stdout.write('x'.repeat(4096)); setTimeout(() => {}, 5000)"], { maxBuffer: 64 }]
    ]) {
        assert.deepEqual(await run(spawnFile, args, options), await run(execFile, args, options));
    }
    if (!POSIX) return;
    const child = spawnFile(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { detached: true }, () => {});
    spawnedPids.add(child.pid);
    assert.doesNotThrow(() => process.kill(-child.pid, 0), 'the child leads process group -pid');
    process.kill(-child.pid, 'SIGKILL');
});

test('the runner never starts natives through child_process.execFile, which drops detached', () => {
    const root = path.resolve(__dirname, '../../..');
    const command = fs.readFileSync(path.join(root, 'app/services/slice/command.js'), 'utf8');
    const spawnSource = fs.readFileSync(path.join(root, 'app/services/slice/spawn-file.js'), 'utf8');
    assert.doesNotMatch(command, /require\('node:child_process'\)/);
    assert.match(command, /execute: overrides\.execFile \|\| spawnFile,/);
    assert.match(command, /detached: platform !== 'win32',/);
    assert.match(spawnSource, /detached: options\.detached === true,/);
    assert.match(spawnSource, /const child = spawn\(file, args, \{/);
});

test('the real runner terminates the whole native tree when its signal aborts', async () => {
    const runner = createCommandRunner({ terminationDependencies: { graceMs: GRACE_MS, pollMs: 10 } });
    const controller = new AbortController();
    const pidFile = nextPidFile();
    const since = Date.now();
    const running = runner(process.execPath, [TREE_SCRIPT, pidFile], { signal: controller.signal });
    const tree = await readTree(pidFile);
    const reason = Object.assign(new Error('stop'), { name: 'AbortError', code: 'ABORT_ERR' });
    controller.abort(reason);
    // Bounded: before 3.8.1 the command never settled because nothing was killed.
    let timer;
    const outcome = await Promise.race([
        running.then(() => 'resolved', (error) => error),
        new Promise((resolve) => { timer = setTimeout(() => resolve('timed out'), 30_000); })
    ]);
    clearTimeout(timer);
    assert.equal(outcome, reason, 'the command settled with the abort reason');
    await assertTreeGone(tree);
    assertTerminationEvents(since);
});

test('(a) the async deadline kills the running native tree before the slot is released', async (t) => {
    const harness = await createAsyncHarness(t, { pipeline: realNativePipeline(), store: { deadlineMs: 3_000 } });
    const since = Date.now();
    const accepted = await harness.submit();
    assert.equal(accepted.status, 202);
    const tree = await readTree(await waitPidFile(harness));
    const done = await harness.pollCompleted(accepted.headers.location);
    assert.equal(done.json.result.errorCode, 'SLICE_DEADLINE_EXCEEDED');
    await assertTreeGone(tree, harness.queue);
    await harness.assertDrained();
    assertTerminationEvents(since);
});

test('(b) DELETE of a running async job kills the native tree before the slot is released', async (t) => {
    const harness = await createAsyncHarness(t, { pipeline: realNativePipeline() });
    const since = Date.now();
    const accepted = await harness.submit();
    const tree = await readTree(await waitPidFile(harness));
    const cancelled = await harness.cancel(accepted.headers.location);
    assert.equal(cancelled.status, 204);
    await assertTreeGone(tree, harness.queue);
    await harness.assertDrained();
    assertTerminationEvents(since);
    assert.equal((await harness.status(accepted.headers.location)).status, 404);
});

test('(c) control: a synchronous client disconnect kills the native tree', async (t) => {
    const harness = await createAsyncHarness(t, { pipeline: realNativePipeline() });
    const since = Date.now();
    const boundary = `tree-${Date.now()}`;
    const body = Buffer.concat(SLICE_PARTS.map((part) => Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`
        + (part.filename ? `; filename="${part.filename}"\r\nContent-Type: application/octet-stream` : '')
        + `\r\n\r\n${part.value}\r\n`
    )).concat([Buffer.from(`--${boundary}--\r\n`)]));
    const request = http.request({
        hostname: '127.0.0.1', port: harness.port, path: '/bambu/slice', method: 'POST', agent: false,
        headers: {
            'x-test-principal': 'shared',
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': body.length
        }
    });
    request.on('error', () => {});
    request.end(body);
    const tree = await readTree(await waitPidFile(harness));
    request.destroy();
    await assertTreeGone(tree, harness.queue);
    await harness.assertDrained();
    assertTerminationEvents(since);
});

async function waitPidFile(harness) {
    await waitFor(() => harness.pipeline.state.pidFiles.length > 0, 10_000, 'the pipeline never started');
    return harness.pipeline.state.pidFiles.at(-1);
}
