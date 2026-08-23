'use strict';

const { resolveResourcePolicy } = require('../../config/resource-policy');
const { readFileSyncBounded } = require('../../utils/bounded-file');

function readProfileText(filePath) {
    return readFileSyncBounded(filePath, resolveResourcePolicy().MAX_PROFILE_BYTES);
}

function readProfileJson(filePath) {
    return JSON.parse(readProfileText(filePath));
}

function readIniKeyValues(filePath) {
    const map = {};
    for (const line of readProfileText(filePath).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex < 0) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        if (key) map[key.toLowerCase()] = trimmed.slice(separatorIndex + 1).trim();
    }
    return map;
}

module.exports = {
    readProfileText,
    readProfileJson,
    readIniKeyValues
};
