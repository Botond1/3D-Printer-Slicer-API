'use strict';

const net = require('node:net');

const TRUST_PROXY_CONFIGURATION_ERROR = 'Trust proxy configuration is invalid.';
const SAFE_PROXY_NAMES = Object.freeze(['loopback']);

function parseCsvValues(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function validateCidr(value) {
    if (SAFE_PROXY_NAMES.includes(value.toLowerCase())) return true;
    if (/^(?:\*|all|linklocal|uniquelocal)$/i.test(value)) return false;
    const parts = value.split('/');
    if (parts.length > 2 || !net.isIP(parts[0])) return false;
    const version = net.isIP(parts[0]);
    const maximum = version === 4 ? 32 : 128;
    const minimum = version === 4 ? 8 : 32;
    if (version === 4 && parts[0].split('.').some((part) => (
        !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255
    ))) {
        return false;
    }
    if (parts.length === 1) return true;
    if (!/^(?:0|[1-9]\d{0,2})$/.test(parts[1])) return false;
    const prefix = Number(parts[1]);
    return prefix >= minimum && prefix <= maximum;
}

function resolveTrustProxySetting(env = process.env) {
    const enabled = String(env.TRUST_PROXY || '').toLowerCase();
    if (!enabled || enabled === 'false') return false;
    if (enabled !== 'true') throw new Error(TRUST_PROXY_CONFIGURATION_ERROR);
    const entries = parseCsvValues(env.TRUST_PROXY_CIDRS);
    if (!entries.length || entries.some((entry) => !validateCidr(entry))) {
        throw new Error(TRUST_PROXY_CONFIGURATION_ERROR);
    }
    const normalized = entries.map((entry) => entry.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
        throw new Error(TRUST_PROXY_CONFIGURATION_ERROR);
    }
    const trusted = new net.BlockList();
    try {
        for (const entry of entries) {
            if (entry.toLowerCase() === 'loopback') {
                trusted.addSubnet('127.0.0.0', 8, 'ipv4');
                trusted.addAddress('::1', 'ipv6');
                continue;
            }
            const [address, prefixValue] = entry.split('/');
            const family = net.isIP(address) === 4 ? 'ipv4' : 'ipv6';
            if (prefixValue === undefined) trusted.addAddress(address, family);
            else trusted.addSubnet(address, Number(prefixValue), family);
        }
    } catch {
        throw new Error(TRUST_PROXY_CONFIGURATION_ERROR);
    }
    return function trustConfiguredProxy(address) {
        try {
            const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
            const family = net.isIP(normalized) === 4 ? 'ipv4' : 'ipv6';
            return Boolean(net.isIP(normalized) && trusted.check(normalized, family));
        } catch {
            return false;
        }
    };
}

module.exports = {
    TRUST_PROXY_CONFIGURATION_ERROR,
    parseCsvValues,
    resolveTrustProxySetting,
    validateCidr
};
