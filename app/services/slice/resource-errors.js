'use strict';

class SliceResourceError extends Error {
    constructor(code, message, status = 422) {
        super(message);
        this.name = 'SliceResourceError';
        this.code = code;
        this.status = status;
    }
}

function resourceLimit(message) {
    return new SliceResourceError('SLICE_RESOURCE_LIMIT_EXCEEDED', message, 413);
}

function invalidArchive(message) {
    return new SliceResourceError('INVALID_SOURCE_ARCHIVE', message, 400);
}

function invalidOutput(message) {
    return new SliceResourceError('INVALID_SLICE_OUTPUT', message, 422);
}

function invalidStats(message) {
    return new SliceResourceError('INVALID_SLICE_STATS', message, 422);
}

module.exports = {
    SliceResourceError,
    resourceLimit,
    invalidArchive,
    invalidOutput,
    invalidStats
};
