'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { resolveResourcePolicy } = require('../../config/resource-policy');
const { readFileSyncBounded } = require('../../utils/bounded-file');
const { isSafeMaterialName } = require('./validation');

function samePath(left, right) {
    const normalize = (value) => process.platform === 'win32'
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    return normalize(left) === normalize(right);
}

function validatePricingSnapshot(pricing, maxHourlyPriceHuf = resolveResourcePolicy().MAX_HOURLY_PRICE_HUF) {
    if (!pricing || typeof pricing !== 'object') throw new Error('Invalid pricing payload.');
    for (const technology of ['FDM', 'SLA']) {
        const entries = pricing[technology];
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
            throw new Error('Invalid pricing technology map.');
        }
        for (const [material, price] of Object.entries(entries)) {
            if (
                !isSafeMaterialName(material)
                || !Number.isFinite(price)
                || price <= 0
                || price > maxHourlyPriceHuf
            ) {
                throw new Error('Invalid pricing entry.');
            }
        }
    }
    return structuredClone(pricing);
}

class PricingRepository {
    constructor(options) {
        this.primaryFile = path.resolve(options.primaryFile);
        this.stateRoot = path.resolve(options.pricingStateRoot);
        this.legacyFiles = [options.legacyFile, ...(options.legacyFiles || [])]
            .filter(Boolean)
            .map((item) => path.resolve(item));
        this.defaultPricing = structuredClone(options.defaultPricing);
        this.fs = options.fs || fs;
        this.policy = options.resourcePolicy || resolveResourcePolicy(options.env || process.env);
        this.randomBytes = options.randomBytes || randomBytes;
    }

    readPricingFile(filePath) {
        const target = path.resolve(filePath);
        const stat = this.fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe pricing file.');
        const pricingRaw = this.fs === fs
            ? readFileSyncBounded(target, this.policy.MAX_PRICING_BYTES)
            : this.readWithInjectedFs(target);
        const parsed = JSON.parse(pricingRaw);
        const fdmSource = parsed?.FDM && typeof parsed.FDM === 'object' ? parsed.FDM : undefined;
        const slaSource = parsed?.SLA && typeof parsed.SLA === 'object' ? parsed.SLA : undefined;
        return validatePricingSnapshot({
            FDM: { ...this.defaultPricing.FDM, ...fdmSource },
            SLA: { ...this.defaultPricing.SLA, ...slaSource }
        }, this.policy.MAX_HOURLY_PRICE_HUF);
    }

    readWithInjectedFs(target) {
        const content = this.fs.readFileSync(target, 'utf8');
        if (Buffer.byteLength(content) > this.policy.MAX_PRICING_BYTES) {
            throw new Error('Pricing payload exceeds its byte limit.');
        }
        return content;
    }

    assertPrimaryLocation() {
        if (
            path.basename(this.primaryFile) !== 'pricing.json'
            || !samePath(path.dirname(this.primaryFile), this.stateRoot)
        ) {
            throw new Error('Pricing primary path is outside the authorized state root.');
        }
        this.fs.mkdirSync(this.stateRoot, { recursive: true, mode: 0o700 });
        const parentStat = this.fs.lstatSync(this.stateRoot);
        const parentReal = this.fs.realpathSync(this.stateRoot);
        if (
            !parentStat.isDirectory()
            || parentStat.isSymbolicLink()
            || !samePath(parentReal, this.stateRoot)
        ) {
            throw new Error('Unsafe pricing state directory.');
        }
        if (this.fs.existsSync(this.primaryFile)) {
            const primaryStat = this.fs.lstatSync(this.primaryFile);
            if (!primaryStat.isFile() || primaryStat.isSymbolicLink()) throw new Error('Unsafe pricing primary file.');
            if (!samePath(this.fs.realpathSync(this.primaryFile), this.primaryFile)) {
                throw new Error('Unsafe pricing primary file.');
            }
        }
        return this.stateRoot;
    }

    serialize(pricing) {
        const payload = `${JSON.stringify(
            validatePricingSnapshot(pricing, this.policy.MAX_HOURLY_PRICE_HUF),
            null,
            2
        )}\n`;
        if (Buffer.byteLength(payload) > this.policy.MAX_PRICING_BYTES) {
            throw new Error('Pricing payload exceeds its byte limit.');
        }
        return Buffer.from(payload);
    }

    writeAll(handle, payload) {
        let offset = 0;
        while (offset < payload.length) {
            const written = this.fs.writeSync(handle, payload, offset, payload.length - offset, offset);
            if (!Number.isSafeInteger(written) || written <= 0) throw new Error('Pricing write made no progress.');
            offset += written;
        }
    }

    syncDirectory(parent) {
        let handle;
        try {
            handle = this.fs.openSync(parent, 'r');
            this.fs.fsyncSync(handle);
        } catch (error) {
            const unsupported = ['EINVAL', 'ENOTSUP'].includes(error.code)
                || (process.platform === 'win32' && ['EISDIR', 'EPERM'].includes(error.code));
            if (!unsupported) throw error;
        } finally {
            if (handle !== undefined) this.fs.closeSync(handle);
        }
    }

    saveToPrimary(pricing) {
        const parent = this.assertPrimaryLocation();
        const payload = this.serialize(pricing);
        const temporarySuffix = this.randomBytes(16).toString('hex');
        if (!/^[a-f0-9]{32}$/.test(temporarySuffix)) throw new Error('Invalid pricing temp suffix.');
        const temporary = path.join(parent, `.pricing-owned-${temporarySuffix}.tmp`);
        let handle;
        let ownsTemporary = false;
        try {
            handle = this.fs.openSync(temporary, 'wx', 0o600);
            ownsTemporary = true;
            this.writeAll(handle, payload);
            this.fs.fsyncSync(handle);
            this.fs.closeSync(handle);
            handle = undefined;
            const tempStat = this.fs.lstatSync(temporary);
            if (!tempStat.isFile() || tempStat.isSymbolicLink()) throw new Error('Unsafe pricing temp file.');
            this.fs.renameSync(temporary, this.primaryFile);
            this.syncDirectory(parent);
            return this.primaryFile;
        } finally {
            if (handle !== undefined) {
                try { this.fs.closeSync(handle); } catch {}
            }
            if (ownsTemporary) {
                try { this.fs.rmSync(temporary, { force: true }); } catch {}
            }
        }
    }

    getExistingCandidates() {
        const primaryExists = this.isSafeCandidate(this.primaryFile);
        if (primaryExists) return [this.primaryFile];
        return this.legacyFiles.filter((filePath) => this.isSafeCandidate(filePath));
    }

    isSafeCandidate(filePath) {
        try {
            if (!this.fs.existsSync(filePath)) return false;
            const stat = this.fs.lstatSync(filePath);
            return stat.isFile() && !stat.isSymbolicLink();
        } catch {
            return false;
        }
    }
}

module.exports = {
    PricingRepository,
    validatePricingSnapshot
};
