'use strict';

const fs = require('node:fs');
const path = require('node:path');

function identity(stats) {
    return `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`;
}

function readFileSyncBounded(filePath, maximumBytes, encoding = 'utf8') {
    const resolved = path.resolve(filePath);
    const before = fs.lstatSync(resolved);
    if (!before.isFile() || before.isSymbolicLink() || path.resolve(fs.realpathSync(resolved)) !== resolved) {
        throw new Error('Unsafe bounded-read file.');
    }
    const handle = fs.openSync(filePath, 'r');
    try {
        const stat = fs.fstatSync(handle);
        if (!stat.isFile() || identity(stat) !== identity(before) || stat.size < 0 || stat.size > maximumBytes) {
            const error = new Error('File exceeds the configured read limit.');
            error.code = 'SLICE_RESOURCE_LIMIT_EXCEEDED';
            error.status = 413;
            throw error;
        }
        const buffer = Buffer.alloc(stat.size + 1);
        const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
        if (bytesRead !== stat.size) {
            const error = new Error('File changed during bounded read.');
            error.code = 'SLICE_RESOURCE_LIMIT_EXCEEDED';
            error.status = 413;
            throw error;
        }
        return encoding ? buffer.subarray(0, bytesRead).toString(encoding) : buffer.subarray(0, bytesRead);
    } finally {
        fs.closeSync(handle);
    }
}

module.exports = {
    readFileSyncBounded
};
