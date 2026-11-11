#!/usr/bin/env node
'use strict';

/**
 * T-ARC-2 corpus scan (3.9.0 §7): run the 3MF package checks over a local
 * corpus of `.3mf` files and report
 *   - how many files the 3.8.3 Node checks admit and how many the 3.9.0
 *     checks (NUL refusal + build-expansion pre-scan) admit,
 *   - every file whose verdict changes (must be 0 before a release),
 *   - the expansion maxima (triangles, leaf instances, objects) against the
 *     configured limits, and whether a limit is below 4 × the corpus maximum
 *     (then it must be raised before the release, never lowered).
 *
 * Node only; nothing is uploaded, written or sliced. File names are printed
 * only with `--verbose` (the corpus may hold customer files).
 *
 * Usage:
 *   node scripts/scan-archive-corpus.js [--list FILE] [--max N] [--json] [--verbose] [PATH ...]
 * PATH may be a file or a directory (searched recursively for `*.3mf`);
 * `--list` reads one path per line.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectThreeMfPackage } = require('../app/services/slice/three-mf');
const { defaultExpansionLimits } = require('../app/services/slice/three-mf-expansion');

const UNBOUNDED_LIMITS = Object.freeze({
    maxTriangles: Number.MAX_SAFE_INTEGER,
    maxInstances: Number.MAX_SAFE_INTEGER,
    maxObjects: Number.MAX_SAFE_INTEGER
});

function parseArguments(argv) {
    const options = { list: null, max: Infinity, json: false, verbose: false, paths: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--list') options.list = argv[++index];
        else if (argument === '--max') options.max = Number.parseInt(argv[++index], 10);
        else if (argument === '--json') options.json = true;
        else if (argument === '--verbose') options.verbose = true;
        else if (argument === '--help' || argument === '-h') options.help = true;
        else options.paths.push(argument);
    }
    if (!Number.isFinite(options.max) && options.max !== Infinity) throw new Error('--max needs a number');
    return options;
}

async function collect(target, found) {
    let stats;
    try {
        stats = await fsp.lstat(target);
    } catch {
        return;
    }
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
        const entries = await fsp.readdir(target).catch(() => []);
        for (const entry of entries.sort()) await collect(path.join(target, entry), found);
    } else if (stats.isFile() && target.toLowerCase().endsWith('.3mf')) {
        found.add(path.resolve(target));
    }
}

async function verdictOf(file, options) {
    try {
        const result = await inspectThreeMfPackage(file, { ...options, ignoreVerdict: true });
        return { admitted: true, expansion: result.expansion };
    } catch (error) {
        return {
            admitted: false,
            code: error?.code || error?.name || 'Error',
            status: Number.isInteger(error?.status) ? error.status : null,
            rule: error?.archiveRule || null,
            expansion: error?.expansion || null
        };
    }
}

/**
 * Scan a list of files.
 * @param {string[]} files Absolute `.3mf` paths.
 * @param {{limits?: object, onFile?: (file: string, row: object) => void}} [options] Limits (default: release policy).
 * @returns {Promise<object>} Report.
 */
async function scanCorpus(files, options = {}) {
    const limits = options.limits || defaultExpansionLimits();
    const report = {
        files: files.length,
        admitted_3_8_3: 0,
        admitted_3_9_0: 0,
        changed: [],
        refused_by_both: {},
        maxima: { triangles: 0, instances: 0, objects: 0 },
        limits: { triangles: limits.maxTriangles, instances: limits.maxInstances, objects: limits.maxObjects },
        raise_needed: {}
    };
    for (const file of files) {
        const before = await verdictOf(file, { expansion: false });
        const measured = before.admitted ? await verdictOf(file, { expansionLimits: UNBOUNDED_LIMITS }) : before;
        const after = before.admitted ? await verdictOf(file, { expansionLimits: limits }) : before;
        if (before.admitted) report.admitted_3_8_3 += 1;
        if (after.admitted) report.admitted_3_9_0 += 1;
        if (!before.admitted) {
            const key = `${before.status ?? '-'} ${before.code}${before.rule ? ` ${before.rule}` : ''}`;
            report.refused_by_both[key] = (report.refused_by_both[key] || 0) + 1;
        }
        if (measured.admitted && measured.expansion) {
            for (const key of ['triangles', 'instances', 'objects']) {
                report.maxima[key] = Math.max(report.maxima[key], measured.expansion[key]);
            }
        }
        if (before.admitted !== after.admitted) {
            report.changed.push({
                file_sha256_prefix: crypto.createHash('sha256').update(file).digest('hex').slice(0, 12),
                rule: after.rule,
                code: after.code,
                expansion: measured.expansion
            });
        }
        options.onFile?.(file, { before, after, expansion: measured.expansion });
    }
    for (const [key, limit] of Object.entries(report.limits)) {
        const needed = 4 * report.maxima[key];
        if (limit < needed) report.raise_needed[key] = { limit, corpus_max: report.maxima[key], four_times_max: needed };
    }
    return report;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
        console.log('Usage: node scripts/scan-archive-corpus.js [--list FILE] [--max N] [--json] [--verbose] [PATH ...]');
        return 0;
    }
    const found = new Set();
    if (options.list) {
        for (const line of fs.readFileSync(options.list, 'utf8').split(/\r?\n/)) {
            if (line.trim()) await collect(line.trim(), found);
        }
    }
    for (const target of options.paths) await collect(target, found);
    const files = [...found].slice(0, options.max);
    if (files.length === 0) {
        console.error('No .3mf files found.');
        return 2;
    }
    const report = await scanCorpus(files, {
        onFile: options.verbose
            ? (file, row) => console.error(`${row.before.admitted ? 'A' : 'R'}${row.after.admitted ? 'A' : 'R'} `
                + `${JSON.stringify(row.expansion)} ${file}`)
            : undefined
    });
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log(`files scanned:            ${report.files}`);
        console.log(`admitted by 3.8.3 checks: ${report.admitted_3_8_3}`);
        console.log(`admitted by 3.9.0 checks: ${report.admitted_3_9_0}`);
        console.log(`verdict changed:          ${report.changed.length}`);
        console.log(`expansion maxima:         triangles ${report.maxima.triangles}, instances ${report.maxima.instances}, objects ${report.maxima.objects}`);
        console.log(`limits:                   triangles ${report.limits.triangles}, instances ${report.limits.instances}, objects ${report.limits.objects}`);
        console.log(`refused by both:          ${JSON.stringify(report.refused_by_both)}`);
        console.log(`raise needed (< 4 x max): ${JSON.stringify(report.raise_needed)}`);
    }
    return report.changed.length === 0 ? 0 : 1;
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (error) => {
        console.error(error?.message || String(error));
        process.exitCode = 2;
    });
}

module.exports = { scanCorpus, parseArguments };
