'use strict';

/**
 * Prove that a change leaves the Bambu `measurement_generation` inputs
 * untouched, so no consumer's pinned slice facts go stale.
 *
 * `app/services/slice/bambu-generation.js` hashes the native build, the
 * resolved vendor profile bundle (the registry plus the flattened profiles),
 * `PROCESSING_SCHEMA` and the bytes of every file in its `processingFiles`
 * list. This check reads that list from the source at both revisions and
 * requires every listed file, the modules and configuration that build the
 * bundle, the measurement configuration the hashed code reads
 * (`constants.js`, `resource-policy.js`) and the image recipe that pins the
 * native build to be the same Git blobs at the base revision and at the
 * compared revision (default: the working tree, tracked and untracked).
 *
 * `bambu-generation.js` itself is checked by an allowlisted-hunk rule
 * (3.9.0 specification §4.11): only the body of `assertBambuBuildCurrent`
 * and ONE marked block after the `module.exports = …;` line may differ; every
 * require, binding, `PROCESSING_SCHEMA`, `hashNativeFile`,
 * `initializeBambuGeneration`, `getBambuGeneration`,
 * `catalogueGenerationFields` and the exports line stay byte-identical.
 *
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

/**
 * Generation inputs that are not themselves in `processingFiles`: the hash
 * recipe, the bundle's registry, readers and paths, the registry file, and
 * the image recipe that pins the native build and its vendor profiles.
 * `bambu-generation.js` is listed here but checked by the hunk rule.
 */
const BUNDLE_AND_BUILD_INPUTS = Object.freeze([
    GENERATION_MODULE,
    'app/services/slice/bambu-printer-registry.js',
    'app/services/slice/profile-readers.js',
    'app/config/paths.js',
    'configs/bambu',
    'Dockerfile'
]);

/**
 * Measurement configuration read by hashed code (`EXTENSIONS`, `DEFAULTS`,
 * `LAYER_HEIGHTS`, `BAMBU_ALTERNATIVE_FOOTPRINTS_INCLUSIVE_MM`,
 * `resolveResourcePolicy`, `MAX_MODEL_FILE_BYTES`, the profiles root): frozen
 * whole-file in 3.9.0, no override (§4.11).
 */
const MEASUREMENT_CONFIG_INPUTS = Object.freeze([
    'app/config/constants.js',
    'app/config/resource-policy.js'
]);

/** Inputs that must be the same Git blob at both revisions. */
const BLOB_IDENTICAL_INPUTS = Object.freeze([
    ...BUNDLE_AND_BUILD_INPUTS.filter((entry) => entry !== GENERATION_MODULE),
    ...MEASUREMENT_CONFIG_INPUTS
]);

const MONITOR_BLOCK_BEGIN = '// BEGIN r3d-native-identity-monitor (3.9.0)';
const MONITOR_BLOCK_END = '// END r3d-native-identity-monitor (3.9.0)';
const ASSERT_SIGNATURE = 'function assertBambuBuildCurrent() {';
const ALLOWED_BODY_PLACEHOLDER = '{ /* r3d-allowed-hunk: assertBambuBuildCurrent body */ }';
/** The 3.8.3 legacy check; the new body keeps it verbatim (the `off` path). */
const LEGACY_LOOP_EXPRESSION = 'nativeIdentity.some(({ file, sha256 }) => hashNativeFile(file) !== sha256)';
const ALLOWED_EDIT_LABEL = 'bambu-generation.js CHANGED (allowed hunks only)';
/** The only names the monitor block may add to `module.exports`, each once. */
const ALLOWED_BLOCK_EXPORTS = Object.freeze(['startNativeIdentityMonitor', 'getNativeIdentityStatus', 'IDENTITY_FAILURE_REASONS']);
/** The one module the monitor block may require, once, at top level. */
const ALLOWED_BLOCK_REQUIRE = './native-identity-monitor';
/**
 * sha256 of the approved new `assertBambuBuildCurrent` body (LF endings,
 * braces included). Any later edit of the body needs an explicit re-pin here,
 * reviewed like a change to the generation recipe itself.
 */
const APPROVED_ASSERT_BODY_SHA256 = Object.freeze([
    '0ede04fd53753b7cd5a3d095b80be4b6f975a6815558f4ffb044d31cbb92dc83'
]);

class CheckError extends Error {}

function git(args, { encoding = 'utf8', allowFailure = false, root = REPOSITORY_ROOT } = {}) {
    const result = spawnSync('git', args, { cwd: root, encoding, maxBuffer: 64 * 1024 * 1024 });
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

/**
 * Index just past the brace that closes the one opened at `open`, skipping
 * strings, template literals and comments. A source the scanner cannot
 * balance is refused (fail closed).
 * @param {string} source Module source.
 * @param {number} open Index of the opening `{`.
 * @returns {number} Index after the matching `}`.
 */
function matchBrace(source, open) {
    if (source[open] !== '{') throw new CheckError('assertBambuBuildCurrent has no body to match.');
    const stack = ['{'];
    let index = open + 1;
    while (index < source.length) {
        const character = source[index];
        const next = source[index + 1];
        const top = stack[stack.length - 1];
        if (top === '`') {
            if (character === '\\') { index += 2; continue; }
            if (character === '`') { stack.pop(); index += 1; continue; }
            if (character === '$' && next === '{') { stack.push('${'); index += 2; continue; }
            index += 1;
            continue;
        }
        if (character === '/' && next === '/') {
            const end = source.indexOf('\n', index);
            index = end === -1 ? source.length : end + 1;
            continue;
        }
        if (character === '/' && next === '*') {
            const end = source.indexOf('*/', index + 2);
            if (end === -1) throw new CheckError('assertBambuBuildCurrent holds an unterminated comment.');
            index = end + 2;
            continue;
        }
        if (character === '\'' || character === '"') {
            let cursor = index + 1;
            while (cursor < source.length && source[cursor] !== character) {
                if (source[cursor] === '\\') cursor += 1;
                if (source[cursor] === '\n') throw new CheckError('assertBambuBuildCurrent holds an unterminated string.');
                cursor += 1;
            }
            index = cursor + 1;
            continue;
        }
        if (character === '`') { stack.push('`'); index += 1; continue; }
        if (character === '{') { stack.push('{'); index += 1; continue; }
        if (character === '}') {
            stack.pop();
            index += 1;
            if (stack.length === 0) return index;
            continue;
        }
        index += 1;
    }
    throw new CheckError('assertBambuBuildCurrent has an unbalanced body.');
}

/**
 * Blank out comments and the text of string and template literals (keeping
 * every `${…}` expression of a template, and every line break), so that
 * token checks see code only and positions still match the raw source.
 * @param {string} code Source text.
 * @returns {string} Same-length text with comments and literal text blanked.
 */
function blankCommentsAndStrings(code) {
    const out = code.split('');
    const blank = (from, to) => {
        for (let index = from; index < to; index += 1) if (out[index] !== '\n') out[index] = ' ';
    };
    // Stack of contexts: 'code' (with its brace depth) or a template literal.
    const stack = [{ kind: 'code', depth: 0 }];
    let index = 0;
    while (index < code.length) {
        const top = stack[stack.length - 1];
        const character = code[index];
        const next = code[index + 1];
        if (top.kind === 'template') {
            if (character === '\\') { blank(index, index + 2); index += 2; continue; }
            if (character === '`') { stack.pop(); index += 1; continue; }
            if (character === '$' && next === '{') { stack.push({ kind: 'code', depth: 0, inTemplate: true }); index += 2; continue; }
            blank(index, index + 1);
            index += 1;
            continue;
        }
        if (character === '/' && next === '/') {
            const end = code.indexOf('\n', index);
            const stop = end === -1 ? code.length : end;
            blank(index, stop);
            index = stop;
            continue;
        }
        if (character === '/' && next === '*') {
            const end = code.indexOf('*/', index + 2);
            if (end === -1) throw new CheckError('an allowed hunk holds an unterminated comment.');
            blank(index, end + 2);
            index = end + 2;
            continue;
        }
        if (character === '\'' || character === '"') {
            let cursor = index + 1;
            while (cursor < code.length && code[cursor] !== character) {
                if (code[cursor] === '\\') cursor += 1;
                if (code[cursor] === '\n') throw new CheckError('an allowed hunk holds an unterminated string.');
                cursor += 1;
            }
            blank(index + 1, cursor);
            index = cursor + 1;
            continue;
        }
        if (character === '`') { stack.push({ kind: 'template' }); index += 1; continue; }
        if (character === '{') { top.depth += 1; index += 1; continue; }
        if (character === '}') {
            if (top.depth === 0 && top.inTemplate) { stack.pop(); index += 1; continue; }
            top.depth -= 1;
            index += 1;
            continue;
        }
        index += 1;
    }
    if (stack.length !== 1) throw new CheckError('an allowed hunk holds an unterminated template literal.');
    return out.join('');
}

/**
 * Refusals for module-system access inside code that is not one of the
 * block's exact allowed statements: no `module`, `exports`, `require`
 * (`require.cache` included) and no reflective escape hatch. The member and
 * call forms are also checked on the raw text, so a literal the blanking
 * misreads can never hide them.
 * @param {string} raw Raw code.
 * @param {string} blanked Same code with comments and literal text blanked.
 * @param {string} where Label for the refusal.
 * @returns {string[]} Refusal reasons.
 */
function refuseModuleAccess(raw, blanked, where) {
    const reasons = [];
    if (/(?<![\w$])(?:module|exports|require)(?![\w$])/.test(blanked)
        || /(?<![\w$])module\s*[.[)]|(?<![\w$])exports\s*[.[=]|(?<![\w$])require\s*[.([]/.test(raw)) {
        reasons.push(`${where} touches module, exports or require`);
    }
    if (/(?<![\w$])(?:globalThis|global|Reflect|Proxy|eval|Function|__proto__|mainModule)(?![\w$])/.test(blanked)) {
        reasons.push(`${where} uses a reflective or global escape hatch`);
    }
    return reasons;
}

/** Index just past the bracket that closes the one opened at `open` (blanked text). */
function matchBracket(blanked, open, opener, closer) {
    let depth = 0;
    for (let index = open; index < blanked.length; index += 1) {
        if (blanked[index] === opener) depth += 1;
        else if (blanked[index] === closer) {
            depth -= 1;
            if (depth === 0) return index + 1;
        }
    }
    throw new CheckError('the monitor block holds an unbalanced statement.');
}

/** Index just past the `;` that ends the statement starting at `from` (blanked text, depth 0). */
function statementEnd(blanked, from) {
    let depth = 0;
    for (let index = from; index < blanked.length; index += 1) {
        const character = blanked[index];
        if (character === '(' || character === '[' || character === '{') depth += 1;
        else if (character === ')' || character === ']' || character === '}') depth -= 1;
        else if (character === ';' && depth === 0) return index + 1;
        if (depth < 0) break;
    }
    throw new CheckError('the monitor block holds a statement without its closing semicolon.');
}

/**
 * Allowlist of the monitor block's top-level statements (3.9.0 §4.11): only
 * `let nativeMonitor = null;`, ONE `const <name> = require('./native-identity-monitor');`,
 * function declarations, and `module.exports.<name> = <expr>;` for the
 * three allowed names, each once. Function bodies and export values may not
 * touch `module`, `exports` or `require`. Anything else is refused.
 * @param {string} block Block text between the markers.
 * @returns {string[]} Refusal reasons.
 */
function refuseBlockStatements(block) {
    const reasons = [];
    let blanked;
    try {
        blanked = blankCommentsAndStrings(block);
    } catch (error) {
        if (error instanceof CheckError) return [`the monitor block: ${error.message}`];
        throw error;
    }
    const seenExports = new Set();
    let requires = 0;
    let index = 0;
    try {
        while (index < blanked.length) {
            const rest = blanked.slice(index);
            const space = /^\s+/.exec(rest);
            if (space) { index += space[0].length; continue; }
            const fn = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rest);
            if (fn) {
                const paramsOpen = index + fn[0].length - 1;
                const paramsClose = matchBracket(blanked, paramsOpen, '(', ')');
                const braceMatch = /^\s*\{/.exec(blanked.slice(paramsClose));
                if (!braceMatch) throw new CheckError(`function ${fn[1]} has no body.`);
                const bodyOpen = paramsClose + braceMatch[0].length - 1;
                const bodyClose = matchBracket(blanked, bodyOpen, '{', '}');
                reasons.push(...refuseModuleAccess(block.slice(paramsOpen, bodyClose), blanked.slice(paramsOpen, bodyClose),
                    `the monitor block function ${fn[1]}`));
                index = bodyClose;
                continue;
            }
            const end = statementEnd(blanked, index);
            const raw = block.slice(index, end).replace(/\s+/g, ' ').trim();
            const statementBlanked = blanked.slice(index, end);
            index = end;
            if (raw === 'let nativeMonitor = null;') continue;
            const required = /^const ([A-Za-z_$][\w$]*) = require\('([^'\\]+)'\);$/.exec(raw);
            if (required) {
                requires += 1;
                if (required[2] !== ALLOWED_BLOCK_REQUIRE || requires > 1) {
                    reasons.push(`the monitor block may require only ${ALLOWED_BLOCK_REQUIRE}, once`);
                }
                continue;
            }
            const exported = /^module\.exports\.([A-Za-z_$][\w$]*) = ([\s\S]+);$/.exec(raw);
            if (exported && /^\s*module\.exports\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(statementBlanked)) {
                const name = exported[1];
                if (!ALLOWED_BLOCK_EXPORTS.includes(name) || seenExports.has(name)) {
                    reasons.push(`the monitor block may add only ${ALLOWED_BLOCK_EXPORTS.join(', ')} to module.exports, each once (not ${name})`);
                }
                seenExports.add(name);
                const valueAt = statementBlanked.indexOf('=') + 1;
                reasons.push(...refuseModuleAccess(raw.slice(raw.indexOf('=') + 1), statementBlanked.slice(valueAt),
                    `the monitor block export ${name}`));
                continue;
            }
            reasons.push(`the monitor block holds a statement outside its allowlist: ${raw.slice(0, 80)}`);
        }
    } catch (error) {
        if (error instanceof CheckError) return [...reasons, `the monitor block: ${error.message}`];
        throw error;
    }
    return reasons;
}

/**
 * Whether a body (comments and literal text blanked) still runs the 3.8.3
 * check as code: the loop expression inside an `if (…)` that throws.
 * @param {string} body Body text, braces included.
 * @returns {boolean} True when the check is live code.
 */
function keepsLegacyCheck(body) {
    let blanked;
    try {
        blanked = blankCommentsAndStrings(body);
    } catch (error) {
        if (error instanceof CheckError) return false;
        throw error;
    }
    const pattern = new RegExp(`(?<![\\w$])if\\s*\\([^{};]*?${escapeRegExp(LEGACY_LOOP_EXPRESSION)}\\s*\\)\\s*\\{?\\s*throw\\s+new\\s+Error\\s*\\(`);
    return pattern.test(blanked);
}

function sha256Text(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Top-level names the frozen part of `bambu-generation.js` binds. */
function frozenBindings(frozenSource) {
    const names = new Set(['module', 'exports', 'require']);
    for (const line of frozenSource.split('\n')) {
        let match = /^(?:const|let|var)\s+\{([^}]*)\}\s*=/.exec(line);
        if (match) {
            for (const part of match[1].split(',')) {
                const name = part.split(':').pop().trim();
                if (name) names.add(name);
            }
            continue;
        }
        match = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (match) names.add(match[1]);
    }
    return names;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Refusals for code that runs inside the allowed hunks: it may read the
 * frozen bindings but never rebind, mutate or redeclare them, never replace
 * an existing export and never evaluate generated code.
 * @param {string} code Allowed hunk text.
 * @param {Set<string>} bindings Frozen top-level names.
 * @param {string[]} exportNames Names on the frozen `module.exports` line.
 * @param {string} where Label for the refusal.
 * @returns {string[]} Refusal reasons (empty = admitted).
 */
function refuseUnsafeHunk(code, bindings, exportNames, where) {
    const reasons = [];
    const assignment = '(?:\\*\\*|<<|>>>|>>|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?!=)';
    for (const name of bindings) {
        if (name === 'module' || name === 'exports' || name === 'require') continue;
        const quoted = escapeRegExp(name);
        if (new RegExp(`(?<![\\w$.])${quoted}\\s*${assignment}`).test(code)
            || new RegExp(`(?:\\+\\+|--)\\s*${quoted}(?![\\w$])|(?<![\\w$.])${quoted}\\s*(?:\\+\\+|--)`).test(code)) {
            reasons.push(`${where} assigns the frozen binding ${name}`);
        }
        if (new RegExp(`(?<![\\w$.])${quoted}(?:\\s*\\.\\s*[\\w$]+|\\s*\\[[^\\]]*\\])+\\s*${assignment}`).test(code)) {
            reasons.push(`${where} assigns a member of the frozen binding ${name}`);
        }
        if (new RegExp(`(?:^|[^\\w$.])(?:function\\s*\\*?\\s*|class\\s+|(?:var|let|const)\\s+)${quoted}(?![\\w$])`).test(code)) {
            reasons.push(`${where} redeclares the frozen binding ${name}`);
        }
        if (new RegExp(`Object\\s*\\.\\s*(?:assign|defineProperty|defineProperties|setPrototypeOf|freeze)\\s*\\(\\s*${quoted}(?![\\w$])`).test(code)) {
            reasons.push(`${where} redefines the frozen binding ${name}`);
        }
    }
    for (const name of ['generation', 'nativeIdentity']) {
        if (new RegExp(`(?<![\\w$.])${name}\\s*\\.\\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|length\\s*=)`).test(code)) {
            reasons.push(`${where} mutates ${name}`);
        }
    }
    if (/(?<![\w$.])(?:module\s*\.\s*)?exports\s*=(?!=)/.test(code)) {
        reasons.push(`${where} assigns module.exports as a whole`);
    }
    for (const name of exportNames) {
        const quoted = escapeRegExp(name);
        if (new RegExp(`(?:module\\s*\\.\\s*)?exports\\s*(?:\\.\\s*${quoted}(?![\\w$])|\\[\\s*['"\`]${quoted}['"\`]\\s*\\])\\s*${assignment}`).test(code)) {
            reasons.push(`${where} replaces the existing export ${name}`);
        }
    }
    if (/Object\s*\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)\s*\(\s*(?:module\s*\.\s*)?exports(?![\w$])/.test(code)) {
        reasons.push(`${where} redefines module.exports`);
    }
    if (/(?<![\w$.])eval\s*\(|(?<![\w$.])Function\s*\(|new\s+Function\b|require\s*\(\s*['"`]vm['"`]|require\s*\(\s*['"`]node:vm['"`]/.test(code)) {
        reasons.push(`${where} evaluates generated code`);
    }
    return reasons;
}

/**
 * Normalize `bambu-generation.js` to its frozen part: (a) cut the one marked
 * block that must start on the line right after `module.exports = …;` and run
 * to the end of the file, (b) replace the brace-matched body of
 * `assertBambuBuildCurrent` with a fixed token. Throws a CheckError naming
 * the rule a source breaks.
 * @param {string} source Module source (LF line endings).
 * @returns {{normalized: string, block: string, body: string, exportNames: string[]}} Frozen text and the allowed hunks.
 */
function normalizeAllowedEdit(source) {
    const text = String(source).replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const exportIndexes = lines.map((line, index) => (/^module\.exports\s*=/.test(line) ? index : -1)).filter((index) => index >= 0);
    if (exportIndexes.length !== 1) throw new CheckError('bambu-generation.js must hold exactly one top-level module.exports = line.');
    const exportsIndex = exportIndexes[0];
    const exportsLine = lines[exportsIndex];
    const exportsMatch = /^module\.exports = \{([^}]*)\};$/.exec(exportsLine);
    if (!exportsMatch) throw new CheckError('the module.exports line must be one `module.exports = { … };` line.');
    const exportNames = exportsMatch[1].split(',').map((name) => name.split(':')[0].trim()).filter(Boolean);

    const begins = lines.map((line, index) => (line === MONITOR_BLOCK_BEGIN ? index : -1)).filter((index) => index >= 0);
    const ends = lines.map((line, index) => (line === MONITOR_BLOCK_END ? index : -1)).filter((index) => index >= 0);
    const strayMarker = lines.some((line, index) => line.includes('r3d-native-identity-monitor')
        && !begins.includes(index) && !ends.includes(index));
    if (begins.length > 1 || ends.length > 1 || begins.length !== ends.length || strayMarker) {
        throw new CheckError('bambu-generation.js may hold at most one exact monitor block marker pair.');
    }
    let frozenLines = lines;
    let block = '';
    if (begins.length === 1) {
        const begin = begins[0];
        const end = ends[0];
        const trailing = lines.slice(end + 1);
        if (begin !== exportsIndex + 1) throw new CheckError('the monitor block must start on the line right after module.exports.');
        if (end <= begin || trailing.some((line) => line !== '')) {
            throw new CheckError('the monitor block must run to the end of the file.');
        }
        block = lines.slice(begin + 1, end).join('\n');
        frozenLines = [...lines.slice(0, begin), ...trailing];
    }
    const frozen = frozenLines.join('\n');
    const signatures = frozen.split(ASSERT_SIGNATURE).length - 1;
    if (signatures !== 1 || !frozen.split('\n').some((line) => line === ASSERT_SIGNATURE)) {
        throw new CheckError('bambu-generation.js must declare `function assertBambuBuildCurrent() {` exactly once at top level.');
    }
    const open = frozen.indexOf(ASSERT_SIGNATURE) + ASSERT_SIGNATURE.length - 1;
    const close = matchBrace(frozen, open);
    const body = frozen.slice(open, close);
    const normalized = `${frozen.slice(0, open)}${ALLOWED_BODY_PLACEHOLDER}${frozen.slice(close)}`;
    return { normalized, block, body, exportNames };
}

/**
 * Compare `bambu-generation.js` at two revisions under the allowlisted-hunk
 * rule.
 * @param {string} baseSource Source at the base revision.
 * @param {string} currentSource Source at the compared revision.
 * @param {string[]} [approvedBodies] sha256 values of approved new bodies (test seam).
 * @returns {{status: 'unchanged'|'allowed'|'refused', reasons: string[]}} Verdict.
 */
function blankCommentsAndStringsSafe(code) {
    try {
        return blankCommentsAndStrings(code);
    } catch (error) {
        if (error instanceof CheckError) return code;
        throw error;
    }
}

function checkGenerationModule(baseSource, currentSource, approvedBodies = APPROVED_ASSERT_BODY_SHA256) {
    const base = String(baseSource).replace(/\r\n/g, '\n');
    const current = String(currentSource).replace(/\r\n/g, '\n');
    if (base === current) return { status: 'unchanged', reasons: [] };
    let before;
    let after;
    try {
        before = normalizeAllowedEdit(base);
        after = normalizeAllowedEdit(current);
    } catch (error) {
        if (error instanceof CheckError) return { status: 'refused', reasons: [error.message] };
        throw error;
    }
    const reasons = [];
    if (before.normalized !== after.normalized) {
        reasons.push('bambu-generation.js changed outside the assertBambuBuildCurrent body and the monitor block');
    }
    if (!keepsLegacyCheck(before.body)) {
        reasons.push('the base assertBambuBuildCurrent no longer holds the 3.8.3 loop expression');
    }
    if (!keepsLegacyCheck(after.body)) {
        // Comments and strings do not count: the expression must be live code
        // inside an `if (…)` that throws.
        reasons.push('the new assertBambuBuildCurrent body must keep the 3.8.3 loop expression verbatim, as code inside an if that throws');
    }
    if (after.body !== before.body && !approvedBodies.includes(sha256Text(after.body))) {
        reasons.push(`the new assertBambuBuildCurrent body (sha256 ${sha256Text(after.body)}) is not the pinned approved body; re-pin APPROVED_ASSERT_BODY_SHA256 after review`);
    }
    const bindings = frozenBindings(after.normalized);
    reasons.push(...refuseUnsafeHunk(after.block, bindings, after.exportNames, 'the monitor block'));
    reasons.push(...refuseBlockStatements(after.block));
    reasons.push(...refuseUnsafeHunk(after.body.slice(1, -1), bindings, after.exportNames, 'the assertBambuBuildCurrent body'));
    reasons.push(...refuseModuleAccess(after.body, blankCommentsAndStringsSafe(after.body), 'the assertBambuBuildCurrent body'));
    return { status: reasons.length === 0 ? 'allowed' : 'refused', reasons: [...new Set(reasons)] };
}

/**
 * Git-backed reader. `revision === null` reads the working tree, as Git
 * would store it (line endings normalized like the clean filter).
 * @param {string} root Repository root.
 */
function createGitReader(root = REPOSITORY_ROOT) {
    const run = (args, options = {}) => git(args, { ...options, root });
    return {
        verify(revision) {
            run(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
        },
        read(revision, repositoryPath) {
            if (revision === null) {
                return require('node:fs').readFileSync(path.join(root, repositoryPath), 'utf8').replace(/\r\n/g, '\n');
            }
            return run(['show', `${revision}:${repositoryPath}`]).stdout;
        },
        blob(revision, repositoryPath) {
            if (revision === null) {
                // hash-object applies the path's clean filter and line-ending rules, so
                // the id equals the blob Git would store for the working-tree file.
                const result = run(['hash-object', `--path=${repositoryPath}`, '--', repositoryPath], { allowFailure: true });
                return result.status === 0 ? result.stdout.trim() : null;
            }
            const result = run(['rev-parse', '--verify', '--quiet', `${revision}:${repositoryPath}`], { allowFailure: true });
            return result.status === 0 ? result.stdout.trim() : null;
        },
        sha256(revision, repositoryPath) {
            const bytes = run(['cat-file', 'blob', `${revision}:${repositoryPath}`], { encoding: 'buffer' }).stdout;
            return createHash('sha256').update(bytes).digest('hex');
        },
        changedPaths(base, revision, paths) {
            const range = revision === null ? [base] : [base, revision];
            const changed = run(['diff', '--name-only', ...range, '--', ...paths]).stdout.split('\n').filter(Boolean);
            if (revision === null) {
                const untracked = run(['ls-files', '--others', '--exclude-standard', '--', ...paths]).stdout.split('\n').filter(Boolean);
                changed.push(...untracked);
            }
            return [...new Set(changed)].sort();
        }
    };
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

/**
 * Run the check.
 * @param {{base: string, ref: string|null, reader?: object, log?: Function, error?: Function}} options Revisions and I/O.
 * @returns {number} 0 when the generation cannot move, 1 when it can.
 */
function runCheck({ base, ref = null, reader = createGitReader(), log = console.log, error = console.error }) {
    reader.verify(base);
    if (ref !== null) reader.verify(ref);
    const label = ref === null ? 'working tree' : ref;

    const baseGenerationSource = reader.read(base, GENERATION_MODULE);
    const currentGenerationSource = reader.read(ref, GENERATION_MODULE);
    const baseRecipe = parseGenerationRecipe(baseGenerationSource);
    const currentRecipe = parseGenerationRecipe(currentGenerationSource);
    const failures = [];
    if (baseRecipe.schema !== currentRecipe.schema) failures.push(`PROCESSING_SCHEMA ${baseRecipe.schema} -> ${currentRecipe.schema}`);
    if (JSON.stringify(baseRecipe.files) !== JSON.stringify(currentRecipe.files)) failures.push('the processingFiles list itself changed');

    const processingPaths = baseRecipe.files.map((name) => `app/${name}`);
    log(`Bambu measurement_generation inputs: ${base} vs ${label}`);
    log(`PROCESSING_SCHEMA ${baseRecipe.schema}; ${processingPaths.length} processing files`);
    for (const repositoryPath of processingPaths) {
        const before = reader.blob(base, repositoryPath);
        const after = reader.blob(ref, repositoryPath);
        const same = before !== null && before === after;
        if (!same) failures.push(`${repositoryPath} ${before} -> ${after}`);
        log(`  ${same ? 'same   ' : 'CHANGED'} ${before} ${repositoryPath}`);
    }

    const generationVerdict = checkGenerationModule(baseGenerationSource, currentGenerationSource);
    if (generationVerdict.status === 'refused') {
        failures.push(...generationVerdict.reasons.map((reason) => `${GENERATION_MODULE}: ${reason}`));
        log(`${GENERATION_MODULE}: CHANGED (refused)`);
    } else if (generationVerdict.status === 'allowed') {
        log(ALLOWED_EDIT_LABEL);
    } else {
        log(`${GENERATION_MODULE}: unchanged`);
    }

    const blobChanges = reader.changedPaths(base, ref, BLOB_IDENTICAL_INPUTS);
    for (const repositoryPath of blobChanges) failures.push(`${repositoryPath} changed`);
    log(`Bundle, build and measurement-configuration inputs (${BLOB_IDENTICAL_INPUTS.join(', ')}): ${blobChanges.length === 0 ? 'unchanged' : blobChanges.join(', ')}`);

    if (ref !== null && failures.length === 0) {
        const { hashValue } = require(path.join(REPOSITORY_ROOT, 'app/services/slice/receipt-hash'));
        const digest = (revision) => hashValue(baseRecipe.files.map((name) => ({ name, sha256: reader.sha256(revision, `app/${name}`) })));
        const before = digest(base);
        const after = digest(ref);
        if (before !== after) failures.push(`processing_sha256 ${before} -> ${after}`);
        log(`processing_sha256 ${before} (${base}) ${after} (${ref})`);
    }

    const guarded = [...processingPaths, ...BUNDLE_AND_BUILD_INPUTS, ...MEASUREMENT_CONFIG_INPUTS];
    const isGuarded = (file) => guarded.some((entry) => file === entry || file.startsWith(`${entry}/`));
    const others = reader.changedPaths(base, ref, ['.']).filter((file) => !isGuarded(file));
    log(`Changed files outside the generation inputs (${others.length}): ${others.join(', ') || 'none'}`);

    if (failures.length > 0) {
        error(`GENERATION INPUTS CHANGED (${failures.length}):`);
        for (const failure of failures) error(`  ${failure}`);
        return 1;
    }
    log('OK: measurement_generation inputs are byte-identical (or allowed hunks only); the generation does not move.');
    return 0;
}

function main(argv) {
    return runCheck(parseArguments(argv));
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof CheckError ? error.message : error);
        process.exitCode = 2;
    }
}

module.exports = {
    ALLOWED_BLOCK_EXPORTS,
    ALLOWED_EDIT_LABEL,
    APPROVED_ASSERT_BODY_SHA256,
    BLOB_IDENTICAL_INPUTS,
    BUNDLE_AND_BUILD_INPUTS,
    CheckError,
    GENERATION_MODULE,
    LEGACY_LOOP_EXPRESSION,
    MEASUREMENT_CONFIG_INPUTS,
    MONITOR_BLOCK_BEGIN,
    MONITOR_BLOCK_END,
    blankCommentsAndStrings,
    checkGenerationModule,
    createGitReader,
    normalizeAllowedEdit,
    parseGenerationRecipe,
    runCheck
};
