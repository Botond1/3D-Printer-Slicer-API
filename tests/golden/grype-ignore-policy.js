'use strict';

/**
 * Read `ops/security/grype-ignore.yaml` (a fixed, line-oriented subset of
 * YAML, parsed strictly without a YAML dependency), refuse an entry without a
 * reason, without an expiry, past its expiry or more than 180 days ahead, and
 * render the admitted entries into the run-local Grype configuration.
 *
 * An empty list renders nothing: the scanner configuration stays the empty
 * file the image gate creates, exactly as before 3.9.0.
 *
 * Usage: node tests/golden/grype-ignore-policy.js <grype-ignore.yaml> <grype.yaml>
 */

const fs = require('node:fs');

const MAX_DAYS_AHEAD = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const VULNERABILITY = /^(?:CVE-\d{4}-\d{4,}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})$/;
const PACKAGE = /^[A-Za-z0-9@][A-Za-z0-9@._/+-]{0,213}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

class PolicyError extends Error {}

function unquote(value) {
    const text = value.trim();
    if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
        return text.slice(1, -1);
    }
    if (/["']/.test(text)) throw new PolicyError(`unbalanced quotes in ${JSON.stringify(text)}`);
    return text;
}

function stripComment(line) {
    let quote = '';
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if ((character === '"' || character === "'") && (!quote || quote === character)) quote = quote ? '' : character;
        else if (character === '#' && !quote && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index).trimEnd();
    }
    return line.trimEnd();
}

/**
 * @param {string} text File contents.
 * @returns {{vulnerability: string, package?: string, reason?: string, expires?: string}[]} Raw entries.
 */
function parseIgnoreFile(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n').map(stripComment).filter((line) => line.trim() !== '');
    if (lines.length === 0) throw new PolicyError('the ignore file is empty; it must declare `ignore:`');
    if (lines[0] === 'ignore: []') {
        if (lines.length !== 1) throw new PolicyError('`ignore: []` must be the only declaration');
        return [];
    }
    if (lines[0] !== 'ignore:') throw new PolicyError('the ignore file must start with `ignore:`');
    const entries = [];
    for (const line of lines.slice(1)) {
        const start = /^ {2}- ([a-z]+): (.+)$/.exec(line);
        const continuation = /^ {4}([a-z]+): (.+)$/.exec(line);
        const match = start || continuation;
        if (!match) throw new PolicyError(`unsupported line ${JSON.stringify(line)}`);
        if (start) entries.push({});
        const entry = entries[entries.length - 1];
        if (!entry) throw new PolicyError('an entry continues before it starts');
        const [, key, value] = match;
        if (!['vulnerability', 'package', 'reason', 'expires'].includes(key)) throw new PolicyError(`unknown key ${key}`);
        if (Object.hasOwn(entry, key)) throw new PolicyError(`duplicate key ${key}`);
        entry[key] = unquote(value);
    }
    if (entries.length === 0) throw new PolicyError('`ignore:` lists no entry; write `ignore: []`');
    return entries;
}

function parseDate(text) {
    const match = DATE.exec(String(text));
    if (!match) return null;
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const date = new Date(time);
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1
        && date.getUTCDate() === Number(match[3]) ? time : null;
}

/**
 * Refusals of an entry list at `now`. An entry is valid through its expiry day (UTC).
 * @param {object[]} entries Parsed entries.
 * @param {Date} [now] Clock.
 * @returns {string[]} Problems (empty = admitted).
 */
function validateEntries(entries, now = new Date()) {
    const problems = [];
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const seen = new Set();
    entries.forEach((entry, index) => {
        const label = `entry ${index + 1} (${entry.vulnerability || 'no vulnerability'})`;
        if (!VULNERABILITY.test(String(entry.vulnerability || ''))) problems.push(`${label}: vulnerability must be a CVE or GHSA id`);
        if (entry.package !== undefined && !PACKAGE.test(entry.package)) problems.push(`${label}: package name is not plain`);
        if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) problems.push(`${label}: a reason of at least 20 characters is required`);
        const expires = parseDate(entry.expires);
        if (expires === null) problems.push(`${label}: expires must be a real YYYY-MM-DD date`);
        else if (expires < today) problems.push(`${label}: expired on ${entry.expires}`);
        else if (expires > today + MAX_DAYS_AHEAD * DAY_MS) problems.push(`${label}: expires more than ${MAX_DAYS_AHEAD} days ahead`);
        const key = `${entry.vulnerability}|${entry.package || ''}`;
        if (seen.has(key)) problems.push(`${label}: duplicate entry`);
        seen.add(key);
    });
    return problems;
}

/** The Grype configuration for admitted entries ('' for none: the gate's empty file). */
function renderGrypeConfig(entries) {
    if (entries.length === 0) return '';
    const lines = ['ignore:'];
    for (const entry of entries) {
        lines.push(`  - vulnerability: ${JSON.stringify(entry.vulnerability)}`);
        if (entry.package) lines.push('    package:', `      name: ${JSON.stringify(entry.package)}`);
    }
    return `${lines.join('\n')}\n`;
}

function main(argv) {
    const [source, target] = argv;
    if (!source || !target) throw new PolicyError('Usage: node tests/golden/grype-ignore-policy.js <grype-ignore.yaml> <grype.yaml>');
    const entries = parseIgnoreFile(fs.readFileSync(source, 'utf8'));
    const problems = validateEntries(entries);
    if (problems.length > 0) throw new PolicyError(`grype ignore list refused:\n  ${problems.join('\n  ')}`);
    const rendered = renderGrypeConfig(entries);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0) throw new PolicyError('the scanner configuration must be the gate\'s empty regular file');
    if (rendered) fs.writeFileSync(target, rendered, { flag: 'r+' });
    console.log(`grype ignore entries admitted: ${entries.length}${entries.map((entry) => ` ${entry.vulnerability} (until ${entry.expires})`).join(',')}`);
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof PolicyError ? error.message : error);
        process.exitCode = 1;
    }
}

module.exports = { MAX_DAYS_AHEAD, PolicyError, parseIgnoreFile, renderGrypeConfig, validateEntries };
