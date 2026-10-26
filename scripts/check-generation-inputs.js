'use strict';

/**
 * Prove that a change leaves the Bambu `measurement_generation` inputs
 * untouched, so no consumer's pinned slice facts go stale.
 *
 * `app/services/slice/bambu-generation.js` hashes the native build, the
 * resolved vendor profile bundle (the registry plus the flattened profiles),
 * `PROCESSING_SCHEMA` and the bytes of every file in its `processingFiles`
 * list. This check reads that list from the source at both revisions and
 * requires every listed file, the generation recipe itself, the modules and
 * configuration that build the bundle, and the image recipe that pins the
 * native build to be the same Git blobs at the base revision and at the
 * compared revision (default: the working tree, tracked and untracked).
 * With `--ref <rev>` it also recomputes the `processing_sha256` component
 * exactly as the service does (sha256 of each file's bytes, `hashValue` of the
 * list) at both revisions.
 *
 * Usage: node scripts/check-generation-inputs.js <base-rev> [--ref <rev>]
 */

const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const GENERATION_MODULE = 'app/services/slice/bambu-generation.js';
const CONSTANTS_MODULE = 'app/config/constants.js';

/**
 * Generation inputs that are not themselves in `processingFiles`: the hash
 * recipe, the bundle's registry, readers and paths, the registry file, and
 * the image recipe that pins the native build and its vendor profiles.
 */
const BUNDLE_AND_BUILD_INPUTS = Object.freeze([
    GENERATION_MODULE,
    'app/services/slice/bambu-printer-registry.js',
    'app/services/slice/profile-readers.js',
    'app/config/paths.js',
    'configs/bambu',
    'Dockerfile'
]);

class CheckError extends Error {}

function git(args, { encoding = 'utf8', allowFailure = false } = {}) {
    const result = spawnSync('git', args, { cwd: REPOSITORY_ROOT, encoding, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new CheckError(`Unable to run git: ${result.error.message}`);
    if (result.status !== 0 && !allowFailure) {
        const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
        throw new CheckError(`git ${args.join(' ')} failed: ${String(stderr).trim()}`);
    }
    return result;
}

/**
 * Read the `processingFiles` list and `PROCESSING_SCHEMA` from the source of
 * `bambu-generation.js` without executing it.
 * @param {string} source Module source.
 * @returns {{schema: string, files: string[]}} Parsed generation recipe.
 */
function parseGenerationRecipe(source) {
    const list = /const processingFiles = \[([\s\S]*?)\];/.exec(source);
    const schema = /const PROCESSING_SCHEMA = '([^']+)';/.exec(source);
    if (!list || !schema) throw new CheckError('bambu-generation.js no longer declares processingFiles and PROCESSING_SCHEMA.');
    const files = [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    if (files.length === 0 || new Set(files).size !== files.length) {
        throw new CheckError('processingFiles is empty or holds a duplicate.');
    }
    return { schema: schema[1], files };
}

function readAt(revision, repositoryPath) {
    if (revision === null) {
        return require('node:fs').readFileSync(path.join(REPOSITORY_ROOT, repositoryPath), 'utf8');
    }
    return git(['show', `${revision}:${repositoryPath}`]).stdout;
}

function profilesRootOf(source) {
    const match = /const BAMBU_DEFAULT_PROFILES_ROOT = '([^']+)';/.exec(source);
    if (!match) throw new CheckError('constants.js no longer declares BAMBU_DEFAULT_PROFILES_ROOT.');
    return match[1];
}

function blobAt(revision, repositoryPath) {
    if (revision === null) {
        // hash-object applies the path's clean filter and line-ending rules, so
        // the id equals the blob Git would store for the working-tree file.
        const result = git(['hash-object', `--path=${repositoryPath}`, '--', repositoryPath], { allowFailure: true });
        return result.status === 0 ? result.stdout.trim() : null;
    }
    const result = git(['rev-parse', '--verify', '--quiet', `${revision}:${repositoryPath}`], { allowFailure: true });
    return result.status === 0 ? result.stdout.trim() : null;
}

function sha256At(revision, repositoryPath) {
    const bytes = git(['cat-file', 'blob', `${revision}:${repositoryPath}`], { encoding: 'buffer' }).stdout;
    return createHash('sha256').update(bytes).digest('hex');
}

function changedPaths(base, revision, paths) {
    const range = revision === null ? [base] : [base, revision];
    const changed = git(['diff', '--name-only', ...range, '--', ...paths]).stdout.split('\n').filter(Boolean);
    if (revision === null) {
        const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...paths]).stdout.split('\n').filter(Boolean);
        changed.push(...untracked);
    }
    return [...new Set(changed)].sort();
}

function parseArguments(argv) {
    const args = [...argv];
    let ref = null;
    const refIndex = args.indexOf('--ref');
    if (refIndex !== -1) {
        ref = args[refIndex + 1];
        if (!ref) throw new CheckError('--ref needs a revision.');
        args.splice(refIndex, 2);
    }
    if (args.length !== 1) throw new CheckError('Usage: node scripts/check-generation-inputs.js <base-rev> [--ref <rev>]');
    return { base: args[0], ref };
}

function main(argv) {
    const { base, ref } = parseArguments(argv);
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    if (ref !== null) git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const label = ref === null ? 'working tree' : ref;

    const baseRecipe = parseGenerationRecipe(readAt(base, GENERATION_MODULE));
    const currentRecipe = parseGenerationRecipe(readAt(ref, GENERATION_MODULE));
    const failures = [];
    if (baseRecipe.schema !== currentRecipe.schema) failures.push(`PROCESSING_SCHEMA ${baseRecipe.schema} -> ${currentRecipe.schema}`);
    if (JSON.stringify(baseRecipe.files) !== JSON.stringify(currentRecipe.files)) failures.push('the processingFiles list itself changed');

    const processingPaths = baseRecipe.files.map((name) => `app/${name}`);
    console.log(`Bambu measurement_generation inputs: ${base} vs ${label}`);
    console.log(`PROCESSING_SCHEMA ${baseRecipe.schema}; ${processingPaths.length} processing files`);
    for (const repositoryPath of processingPaths) {
        const before = blobAt(base, repositoryPath);
        const after = blobAt(ref, repositoryPath);
        const same = before !== null && before === after;
        if (!same) failures.push(`${repositoryPath} ${before} -> ${after}`);
        console.log(`  ${same ? 'same   ' : 'CHANGED'} ${before} ${repositoryPath}`);
    }

    const bundleChanges = changedPaths(base, ref, BUNDLE_AND_BUILD_INPUTS);
    for (const repositoryPath of bundleChanges) failures.push(`${repositoryPath} changed`);
    console.log(`Bundle and build inputs (${BUNDLE_AND_BUILD_INPUTS.join(', ')}): ${bundleChanges.length === 0 ? 'unchanged' : bundleChanges.join(', ')}`);

    const rootBefore = profilesRootOf(readAt(base, CONSTANTS_MODULE));
    const rootAfter = profilesRootOf(readAt(ref, CONSTANTS_MODULE));
    if (rootBefore !== rootAfter) failures.push(`BAMBU_DEFAULT_PROFILES_ROOT ${rootBefore} -> ${rootAfter}`);
    console.log(`BAMBU_DEFAULT_PROFILES_ROOT (read by bambu-profile-chain.js): ${rootBefore === rootAfter ? 'unchanged' : 'CHANGED'} (${rootAfter})`);

    if (ref !== null && failures.length === 0) {
        const { hashValue } = require(path.join(REPOSITORY_ROOT, 'app/services/slice/receipt-hash'));
        const digest = (revision) => hashValue(baseRecipe.files.map((name) => ({ name, sha256: sha256At(revision, `app/${name}`) })));
        const before = digest(base);
        const after = digest(ref);
        if (before !== after) failures.push(`processing_sha256 ${before} -> ${after}`);
        console.log(`processing_sha256 ${before} (${base}) ${after} (${ref})`);
    }

    const guarded = [...processingPaths, ...BUNDLE_AND_BUILD_INPUTS];
    const isGuarded = (file) => guarded.some((entry) => file === entry || file.startsWith(`${entry}/`));
    const others = changedPaths(base, ref, ['.']).filter((file) => !isGuarded(file));
    console.log(`Changed files outside the generation inputs (${others.length}): ${others.join(', ') || 'none'}`);

    if (failures.length > 0) {
        console.error(`GENERATION INPUTS CHANGED (${failures.length}):`);
        for (const failure of failures) console.error(`  ${failure}`);
        return 1;
    }
    console.log('OK: measurement_generation inputs are byte-identical; the generation does not move.');
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof CheckError ? error.message : error);
        process.exitCode = 2;
    }
}

module.exports = { BUNDLE_AND_BUILD_INPUTS, parseGenerationRecipe };
