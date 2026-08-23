'use strict';

const { ZipArchive } = require('archiver');
const { emitEvent } = require('../services/observability/events');
const {
    BULK_DOWNLOAD_ALL_TOKEN,
    getValidatedOutputFile,
    getValidatedOutputFiles,
    listOutputFileSummaries,
    validateBulkDownloadLimits
} = require('../services/admin-output.service');
const { acquireArtifactLease } = require('../services/artifact-leases');

function outputFilesHandler(req, res) {
    const outputFiles = listOutputFileSummaries();
    if (!outputFiles.success) {
        emitEvent('resource.rejected', {
            request_id: req.requestId,
            audience: 'artifact',
            outcome: 'rejected',
            error_code: outputFiles.errorCode
        });
        return res.status(outputFiles.status).json({
            success: false,
            error: outputFiles.error,
            errorCode: outputFiles.errorCode
        });
    }
    if (outputFiles.files.length === 0) {
        return res.status(200).json({
            success: true,
            message: 'Output directory is empty.',
            total: 0,
            files: []
        });
    }
    return res.status(200).json(outputFiles);
}

function artifactBusy(res) {
    return res.status(409).json({
        success: false,
        error: 'Output artifact is temporarily unavailable.',
        errorCode: 'OUTPUT_ARTIFACT_BUSY'
    });
}

function emitDownload(event, outcome, errorCode) {
    emitEvent('artifact.downloaded', {
        request_id: event?.requestId,
        job_id: event?.jobId,
        artifact_id: event?.artifactId,
        audience: 'artifact',
        outcome,
        error_code: errorCode
    });
}

function emitBulkDownloads(files, requestId, outcome, errorCode) {
    const managed = files.filter((file) => file.artifactId && file.jobId);
    if (!managed.length) {
        emitDownload({ requestId }, outcome, errorCode);
        return;
    }
    for (const file of managed) {
        emitDownload({ requestId, jobId: file.jobId, artifactId: file.artifactId }, outcome, errorCode);
    }
}

function sendBulkDownloadFailure(res, error) {
    if (res.headersSent) {
        res.destroy(error);
        return;
    }
    res.status(500).json({
        success: false,
        error: 'Failed to download output files.',
        errorCode: 'BULK_DOWNLOAD_FAILED'
    });
}

function bulkDownloadHandler(req, res, requestContext) {
    const validatedFiles = getValidatedOutputFiles();
    if (!validatedFiles.success) {
        emitDownload(requestContext, 'failure', validatedFiles.errorCode);
        return res.status(validatedFiles.status).json({
            success: false,
            error: validatedFiles.error,
            errorCode: validatedFiles.errorCode
        });
    }
    if (validatedFiles.files.length === 0) {
        emitDownload(requestContext, 'failure', 'OUTPUT_FILES_NOT_FOUND');
        return res.status(404).json({
            success: false,
            error: 'Output files not found.',
            errorCode: 'OUTPUT_FILES_NOT_FOUND'
        });
    }
    const limits = validateBulkDownloadLimits(validatedFiles.files);
    if (!limits.success) {
        emitBulkDownloads(validatedFiles.files, requestContext.requestId, 'failure', limits.errorCode);
        return res.status(limits.status).json({
            success: false,
            error: limits.error,
            errorCode: limits.errorCode
        });
    }

    const archiveFileName = `output-files-${Date.now()}.zip`;
    let lease;
    try {
        lease = acquireArtifactLease(
            validatedFiles.files.map((file) => file.realPath),
            validatedFiles.files.map((file) => ({
                requestId: requestContext.requestId,
                jobId: file.jobId,
                artifactId: file.artifactId
            }))
        );
    } catch {
        emitBulkDownloads(
            validatedFiles.files,
            requestContext.requestId,
            'failure',
            'OUTPUT_ARTIFACT_BUSY'
        );
        return artifactBusy(res);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName}"`);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('warning', () => {});
    let downloadSettled = false;
    const settleDownload = (outcome, errorCode) => {
        if (downloadSettled) return;
        downloadSettled = true;
        lease.release();
        emitBulkDownloads(validatedFiles.files, requestContext.requestId, outcome, errorCode);
    };
    archive.on('error', (error) => {
        settleDownload('failure', 'BULK_DOWNLOAD_FAILED');
        sendBulkDownloadFailure(res, error);
    });
    res.once('close', () => {
        if (!res.writableFinished) {
            settleDownload('failure', 'DOWNLOAD_ABORTED');
            archive.abort();
        }
    });
    res.once('finish', () => {
        settleDownload('success');
    });
    archive.pipe(res);
    for (const file of validatedFiles.files) {
        archive.file(file.realPath, { name: file.fileName });
    }
    const finalizeResult = archive.finalize();
    if (finalizeResult && typeof finalizeResult.catch === 'function') {
        finalizeResult.catch((error) => {
            settleDownload('failure', 'BULK_DOWNLOAD_FAILED');
            sendBulkDownloadFailure(res, error);
        });
    }
    return undefined;
}

function singleDownloadHandler(res, fileName, requestContext) {
    const validatedFile = getValidatedOutputFile(fileName);
    if (!validatedFile.success) {
        emitDownload(requestContext, 'failure', validatedFile.errorCode);
        return res.status(validatedFile.status).json({
            success: false,
            error: validatedFile.error,
            errorCode: validatedFile.errorCode
        });
    }
    let lease;
    try {
        lease = acquireArtifactLease([validatedFile.realPath], [{
            requestId: requestContext.requestId,
            jobId: validatedFile.jobId,
            artifactId: validatedFile.artifactId
        }]);
    } catch {
        emitDownload({
            requestId: requestContext.requestId,
            jobId: validatedFile.jobId,
            artifactId: validatedFile.artifactId
        }, 'failure', 'OUTPUT_ARTIFACT_BUSY');
        return artifactBusy(res);
    }
    let downloadSettled = false;
    const settleDownload = (outcome, errorCode) => {
        if (downloadSettled) return;
        downloadSettled = true;
        emitDownload({
            requestId: requestContext.requestId,
            jobId: validatedFile.jobId,
            artifactId: validatedFile.artifactId
        }, outcome, errorCode);
        lease.release();
    };
    res.once('close', () => {
        if (!res.writableEnded) settleDownload('failure', 'DOWNLOAD_ABORTED');
    });
    return res.download(validatedFile.realPath, validatedFile.fileName, (error) => {
        settleDownload(error ? 'failure' : 'success', error ? 'DOWNLOAD_FAILED' : undefined);
        if (error && !res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Failed to download output file.',
                errorCode: 'DOWNLOAD_FAILED'
            });
        }
    });
}

function downloadHandler(req, res) {
    const fileName = String(req.params.fileName || '').trim();
    const requestContext = {
        requestId: req.requestId || 'n/a'
    };
    if (fileName.toUpperCase() === BULK_DOWNLOAD_ALL_TOKEN) {
        return bulkDownloadHandler(req, res, requestContext);
    }
    return singleDownloadHandler(res, fileName, requestContext);
}

module.exports = {
    outputFilesHandler,
    downloadHandler
};
