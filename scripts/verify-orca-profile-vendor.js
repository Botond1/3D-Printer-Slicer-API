'use strict';

/** Build-time semantic identity gate for the vendored Orca v2.3.1 parents. */

const fs = require('node:fs');
const path = require('node:path');

const MAX_PROFILE_BYTES = 1024 * 1024;
const PROFILES = Object.freeze([
    Object.freeze({ role: 'machine', name: 'fdm_machine_common' }),
    Object.freeze({ role: 'process', name: 'fdm_process_common' }),
    Object.freeze({ role: 'process', name: 'fdm_process_marlin_common' })
]);

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
}

function readProfile(root, descriptor) {
    const canonicalRoot = path.resolve(root);
    const filePath = path.resolve(canonicalRoot, descriptor.role, `${descriptor.name}.json`);
    if (!filePath.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error('profile_path_escape');
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 ||
        stat.size > MAX_PROFILE_BYTES || path.resolve(fs.realpathSync(filePath)) !== filePath) {
        throw new Error('profile_file_invalid');
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || Array.isArray(parsed) || parsed.type !== descriptor.role ||
        parsed.name !== descriptor.name) throw new Error('profile_identity_invalid');
    return JSON.stringify(canonicalize(parsed));
}

function verifyOrcaProfileVendor(vendoredRoot, bundledRoot) {
    if (typeof vendoredRoot !== 'string' || typeof bundledRoot !== 'string') {
        throw new Error('profile_roots_invalid');
    }
    for (const descriptor of PROFILES) {
        if (readProfile(vendoredRoot, descriptor) !== readProfile(bundledRoot, descriptor)) {
            throw new Error('profile_semantic_mismatch');
        }
    }
    return 'ORCA_PROFILE_VENDOR_CONTRACT=PASS';
}

function main() {
    try {
        if (process.argv.length !== 4) throw new Error('arguments_invalid');
        process.stdout.write(`${verifyOrcaProfileVendor(process.argv[2], process.argv[3])}\n`);
    } catch {
        process.stderr.write('ORCA_PROFILE_VENDOR_CONTRACT=FAIL\n');
        process.exitCode = 2;
    }
}

module.exports = { MAX_PROFILE_BYTES, PROFILES, canonicalize, verifyOrcaProfileVendor };

if (require.main === module) main();
