'use strict';

const archiver = require('archiver');
const { getClientIp } = require('../utils/client-ip');
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
        console.error('[ADMIN OUTPUT FILES ERROR]', outputFiles.error);
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

function sendBulkDownloadFailure(res, error, requestId) {
    console.error(`[ADMIN DOWNLOAD ERROR] ${error.message} (requestId=${requestId})`);
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
        return res.status(validatedFiles.status).json({
            success: false,
            error: validatedFiles.error,
            errorCode: validatedFiles.errorCode
        });
    }
    if (validatedFiles.files.length === 0) {
        return res.status(404).json({
            success: false,
            error: 'Output files not found.',
            errorCode: 'OUTPUT_FILES_NOT_FOUND'
        });
    }
    const limits = validateBulkDownloadLimits(validatedFiles.files);
    if (!limits.success) {
        return res.status(limits.status).json({
            success: false,
            error: limits.error,
            errorCode: limits.errorCode
        });
    }

    const archiveFileName = `output-files-${Date.now()}.zip`;
    console.log(
        `[ADMIN DOWNLOAD] ${BULK_DOWNLOAD_ALL_TOKEN} requested by ${requestContext.clientIp} (requestId=${requestContext.requestId}) -> ${validatedFiles.files.length} files, ${limits.totalBytes} bytes`
    );
    let lease;
    try {
        lease = acquireArtifactLease(validatedFiles.files.map((file) => file.realPath));
    } catch {
        return artifactBusy(res);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName}"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', (warning) => {
        console.warn(`[ADMIN DOWNLOAD WARN] ${warning.message}`);
    });
    archive.on('error', (error) => {
        lease.release();
        sendBulkDownloadFailure(res, error, requestContext.requestId);
    });
    res.on('close', () => {
        lease.release();
        if (!res.writableEnded) archive.abort();
    });
    archive.on('end', () => lease.release());
    archive.pipe(res);
    for (const file of validatedFiles.files) {
        archive.file(file.realPath, { name: file.fileName });
    }
    const finalizeResult = archive.finalize();
    if (finalizeResult && typeof finalizeResult.catch === 'function') {
        finalizeResult.catch((error) => {
            sendBulkDownloadFailure(res, error, requestContext.requestId);
        });
    }
    return undefined;
}

function singleDownloadHandler(res, fileName, requestContext) {
    const validatedFile = getValidatedOutputFile(fileName);
    if (!validatedFile.success) {
        return res.status(validatedFile.status).json({
            success: false,
            error: validatedFile.error,
            errorCode: validatedFile.errorCode
        });
    }
    console.log(
        `[ADMIN DOWNLOAD] ${validatedFile.fileName} requested by ${requestContext.clientIp} (requestId=${requestContext.requestId})`
    );
    let lease;
    try {
        lease = acquireArtifactLease([validatedFile.realPath]);
    } catch {
        return artifactBusy(res);
    }
    res.once('close', () => lease.release());
    return res.download(validatedFile.realPath, validatedFile.fileName, (error) => {
        lease.release();
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
        clientIp: getClientIp(req),
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
