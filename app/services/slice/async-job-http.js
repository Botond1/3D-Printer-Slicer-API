'use strict';

/** HTTP answers of the asynchronous slice job routes (status and cancellation). */

const { retryAfterSeconds } = require('./async-jobs');
const { resolveJobPrincipal } = require('./async-slice');

/** JSON without Express's ETag, so a status read can never become a 304. */
function sendNoStoreJson(res, status, body) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(status).end(JSON.stringify(body));
}

function sendJobNotFound(res) {
    return sendNoStoreJson(res, 404, {
        success: false,
        error: 'Slice job not found.',
        errorCode: 'SLICE_JOB_NOT_FOUND'
    });
}

/** `GET /bambu/slice/jobs/:job_id` */
function handleJobStatus(req, res, store) {
    const job = store.lookup(req.params?.job_id, resolveJobPrincipal(req));
    if (!job) return sendJobNotFound(res);
    const body = store.view(job);
    if (body.status !== 'completed') res.setHeader('Retry-After', String(retryAfterSeconds(body.poll_after_ms)));
    return sendNoStoreJson(res, 200, body);
}

/** `DELETE /bambu/slice/jobs/:job_id` */
function handleJobCancel(req, res, store) {
    if (!store.cancel(req.params?.job_id, resolveJobPrincipal(req))) return sendJobNotFound(res);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
}

/** Route-level `Cache-Control: no-store` ahead of the limiter and authentication. */
function noStore(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    next();
}

module.exports = {
    handleJobCancel,
    handleJobStatus,
    noStore
};
