'use strict';

/**
 * Worker thread of the archive preflight (3.9.0 §4.4). It inspects one 3MF
 * at a time with the same `inspectThreeMfPackage` the job uses (the 3.8.3
 * envelope checks plus the expansion pre-scan) and posts a plain verdict.
 * It never registers a verdict itself: verdicts live on the main thread,
 * where the job's own inspection reads them.
 */

const { parentPort } = require('node:worker_threads');
const { inspectThreeMfPackage } = require('./three-mf');
const { SliceResourceError } = require('./resource-errors');

/**
 * Plain, cloneable description of a refusal. Only a `SliceResourceError`
 * is a refusal; anything else is reported as `raw` so the caller can leave
 * the file to the job, which then answers exactly as 3.8.3 did.
 * @param {unknown} error Inspection error.
 * @returns {object} Serialisable error.
 */
function describeError(error) {
    if (!(error instanceof SliceResourceError)) {
        return { raw: true, message: 'archive inspection failed' };
    }
    return {
        raw: false,
        code: error.code,
        status: error.status,
        message: error.message,
        archiveRule: error.archiveRule ?? null,
        archiveLimit: Number.isFinite(error.archiveLimit) ? error.archiveLimit : null,
        expansion: error.expansion ? { ...error.expansion } : null
    };
}

/**
 * Run one task.
 * @param {{id: number, file: string, resourcePolicy?: object, expansionLimits?: object}} task Task.
 * @returns {Promise<object>} Message for the main thread.
 */
async function runTask(task) {
    const started = Date.now();
    try {
        const result = await inspectThreeMfPackage(task.file, {
            resourcePolicy: task.resourcePolicy || undefined,
            expansionLimits: task.expansionLimits || undefined,
            ignoreVerdict: true
        });
        return { id: task.id, ok: true, counts: result.expansion, summary: result.summary, durationMs: Date.now() - started };
    } catch (error) {
        return { id: task.id, ok: false, error: describeError(error), durationMs: Date.now() - started };
    }
}

if (parentPort) {
    parentPort.on('message', (task) => {
        runTask(task).then((message) => parentPort.postMessage(message));
    });
}

module.exports = { describeError, runTask };
