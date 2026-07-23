'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJobWorkspace } = require('../../../app/services/slice/workspace');
const {
    createSliceHandlers,
    writeJsonAndWaitForFinish,
    setResponseSettlement,
    awaitResponseSettlement
} = require('../../../app/services/slice.service');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 's1a-output-'));
    const jobsRoot = path.join(root, 'input', '.slice-jobs');
    const outputRoot = path.join(root, 'output');
    await fs.mkdir(outputRoot, { recursive: true });
    const workspace = await createJobWorkspace({ jobsRoot, outputRoot });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, outputRoot, workspace };
}

class SyntheticResponse extends EventEmitter {
    constructor(outcome) {
        super();
        this.outcome = outcome;
        this.writableFinished = false;
        this.headersSent = false;
    }

    json(payload) {
        this.payload = payload;
        this.headersSent = true;
        queueMicrotask(() => {
            if (this.outcome === 'finish') {
                this.writableFinished = true;
                this.emit('finish');
            } else if (this.outcome === 'close') {
                this.emit('close');
            } else {
                this.emit('error', new Error('synthetic socket error'));
            }
        });
        return this;
    }
}

async function promote(workspace, name = 'model.stl') {
    const candidate = await workspace.registerOutputCandidate(name, 'FDM');
    const source = workspace.resolvePath('generated.gcode');
    await fs.writeFile(source, '; generated');
    await workspace.promoteOutputCandidate(candidate, source);
    return candidate;
}

test('finish releases exactly one final artifact while workspace cleanup preserves its neighbor', async (t) => {
    const { outputRoot, workspace } = await fixture(t);
    const neighbor = path.join(outputRoot, 'neighbor.gcode');
    await fs.writeFile(neighbor, 'foreign');
    const candidate = await promote(workspace);
    const req = {};
    const res = new SyntheticResponse('finish');
    setResponseSettlement(
        req,
        writeJsonAndWaitForFinish(res, { success: true })
            .then(() => workspace.releaseOutputCandidate(candidate))
    );

    await awaitResponseSettlement(req);
    await workspace.cleanup();
    const artifactId = /artifact-[a-f0-9]{32}/.exec(path.basename(candidate))[0];
    assert.deepEqual(
        (await fs.readdir(outputRoot)).sort(),
        [`.${artifactId}.json`, path.basename(candidate), 'neighbor.gcode'].sort()
    );
    assert.equal(await fs.readFile(candidate, 'utf8'), '; generated');
    await assert.rejects(fs.access(workspace.directory));
});

for (const outcome of ['close', 'error']) {
    test(`response ${outcome} keeps the promoted candidate owned until cleanup`, async (t) => {
        const { workspace } = await fixture(t);
        const candidate = await promote(workspace, `${outcome}.stl`);
        const req = {};
        const res = new SyntheticResponse(outcome);
        setResponseSettlement(
            req,
            writeJsonAndWaitForFinish(res, { success: true })
                .then(() => workspace.releaseOutputCandidate(candidate))
        );

        await assert.rejects(awaitResponseSettlement(req), /Response/);
        await workspace.cleanup();
        await assert.rejects(fs.access(candidate));
        await assert.rejects(fs.access(workspace.directory));
    });
}

test('response settlement is awaited outside the existing queue task', async () => {
    let queueTaskSettled = false;
    let releaseResponse;
    const responseSettlement = new Promise((resolve) => { releaseResponse = resolve; });
    const req = {};
    const res = {};
    const handlers = createSliceHandlers({
        getClientIpImpl: () => 'client',
        enqueueSliceJobImpl: async (task) => {
            const result = await task();
            queueTaskSettled = true;
            return result;
        },
        processSliceImpl: async (request) => {
            setResponseSettlement(request, responseSettlement);
            return res;
        }
    });

    const handlerSettlement = handlers.handleSlicePrusa(req, res);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queueTaskSettled, true, 'response flush must not occupy a slice queue execution slot');
    let handlerDone = false;
    handlerSettlement.then(() => { handlerDone = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(handlerDone, false, 'route owner must still await response settlement before cleanup');
    releaseResponse();
    assert.equal(await handlerSettlement, res);
});

test('release failure after finish preserves cleanup ownership and removes the candidate', async (t) => {
    const { workspace } = await fixture(t);
    const candidate = await promote(workspace, 'release-failure.stl');
    const req = {};
    const res = new SyntheticResponse('finish');
    setResponseSettlement(
        req,
        writeJsonAndWaitForFinish(res, { success: true })
            .then(() => { throw new Error('synthetic release failure'); })
    );

    await assert.rejects(awaitResponseSettlement(req), /release failure/);
    await workspace.cleanup();
    await assert.rejects(fs.access(candidate));
    await assert.rejects(fs.access(workspace.directory));
});

test('a response closed before listener attachment rejects immediately and cannot strand ownership', async (t) => {
    const { workspace } = await fixture(t);
    const candidate = await promote(workspace, 'already-closed.stl');
    const req = {};
    const res = new SyntheticResponse('finish');
    res.destroyed = true;
    setResponseSettlement(
        req,
        writeJsonAndWaitForFinish(res, { success: true })
            .then(() => workspace.releaseOutputCandidate(candidate))
    );

    await assert.rejects(awaitResponseSettlement(req), /closed before completion/);
    assert.equal(res.payload, undefined);
    await workspace.cleanup();
    await assert.rejects(fs.access(candidate));
    await assert.rejects(fs.access(workspace.directory));
});
