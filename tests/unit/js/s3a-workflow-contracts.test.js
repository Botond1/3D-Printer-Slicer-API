'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATHS = Object.freeze({
    ci: '.github/workflows/ci.yml',
    deploy: '.github/workflows/deploy.yml',
    image: '.github/workflows/image-validation.yml'
});

function readWorkflow(relativePath) {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8').replace(/\r\n?/g, '\n');
}

const WORKFLOWS = Object.freeze(Object.fromEntries(
    Object.entries(WORKFLOW_PATHS).map(([name, relativePath]) => [name, readWorkflow(relativePath)])
));

const AUDITED_USES = Object.freeze({
    ci: Object.freeze([
        'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
        'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065'
    ]),
    deploy: Object.freeze([
        './.github/workflows/ci.yml',
        './.github/workflows/image-validation.yml'
    ]),
    image: Object.freeze([
        'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        'anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610',
        'anchore/scan-action@e1165082ffb1fe366ebaf02d8526e7c4989ea9d2',
        'docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c83',
        'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f'
    ])
});

const CI_REQUIRED_COMMANDS = Object.freeze([
    ['npm install --global npm@10.9.8 --ignore-scripts --no-audit --no-fund', 'exact npm selector gate'],
    ['npm ci --ignore-scripts --no-audit --no-fund', 'lockfile install gate'],
    ['npm run check:syntax', 'tracked JS/Python syntax gate'],
    ['node --test tests/unit/js/s3a-workflow-contracts.test.js', 'focused fail-closed S3a contract gate'],
    ['npm test', 'aggregate JavaScript/Python test gate'],
    ['npm audit --omit=dev --audit-level=moderate', 'moderate production audit gate'],
    ['npm run check:repository-safety', 'tracked repository-safety gate'],
    ['git diff --check "$base_sha" "$CANDIDATE_SHA" --', 'candidate-range whitespace gate']
]);

function stripInlineComment(value) {
    let quote = '';
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if ((character === '"' || character === "'") && (!quote || quote === character)) {
            quote = quote ? '' : character;
        } else if (character === '#' && !quote && (index === 0 || /\s/.test(value[index - 1]))) {
            return value.slice(0, index).trimEnd();
        }
    }
    return value.trimEnd();
}

function scalarValue(line) {
    const separator = line.trimmed.indexOf(':');
    if (separator === -1) return '';
    let value = stripInlineComment(line.trimmed.slice(separator + 1).trim());
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'"))
        || (value.startsWith('"') && value.endsWith('"')))) {
        value = value.slice(1, -1);
    }
    return value;
}

function mappingKey(line) {
    if (!line.structural) return null;
    const match = line.trimmed.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
    return match ? match[1] : null;
}

function sequenceMappingKey(line) {
    if (!line.structural) return null;
    const match = line.trimmed.match(/^-\s+([A-Za-z0-9_.-]+):(?:\s|$)/);
    return match ? match[1] : null;
}

function parseWorkflow(source, name) {
    const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    let literalParentIndent = null;

    for (let index = 0; index < rawLines.length; index += 1) {
        const raw = rawLines[index];
        const leading = raw.match(/^[ \t]*/)[0];
        const indent = leading.replace(/\t/g, '    ').length;
        const trimmed = raw.slice(leading.length);
        const meaningful = trimmed.length > 0 && !trimmed.startsWith('#');

        if (literalParentIndent !== null && meaningful && indent <= literalParentIndent) {
            literalParentIndent = null;
        }

        const literal = literalParentIndent !== null && (indent > literalParentIndent || !meaningful);
        const line = {
            raw,
            index,
            indent,
            trimmed,
            meaningful,
            structural: meaningful && !literal,
            hasIndentTab: leading.includes('\t')
        };
        lines.push(line);

        if (line.structural && /:\s*[|>][+-]?\s*(?:#.*)?$/.test(trimmed)) {
            literalParentIndent = indent;
        }
    }

    return { source, name, lines };
}

function blockAt(document, lineIndex) {
    const parent = document.lines[lineIndex];
    let end = document.lines.length;
    for (let index = lineIndex + 1; index < document.lines.length; index += 1) {
        const line = document.lines[index];
        if (line.structural && line.indent <= parent.indent) {
            end = index;
            break;
        }
    }
    return { document, start: lineIndex, end, indent: parent.indent };
}

function rootBlock(document) {
    return { document, start: -1, end: document.lines.length, indent: -1 };
}

function directChildren(block) {
    const candidates = block.document.lines.slice(block.start + 1, block.end)
        .filter((line) => line.structural && line.indent > block.indent);
    if (candidates.length === 0) return [];
    const childIndent = Math.min(...candidates.map((line) => line.indent));
    return candidates.filter((line) => line.indent === childIndent);
}

function directKey(block, key) {
    const matches = directChildren(block).filter((line) => mappingKey(line) === key);
    return matches.length === 1 ? blockAt(block.document, matches[0].index) : null;
}

function directKeys(block) {
    return directChildren(block).map(mappingKey).filter(Boolean);
}

function directListValues(block) {
    return directChildren(block)
        .map((line) => line.trimmed.match(/^-\s+([^#]+?)(?:\s+#.*)?$/))
        .filter(Boolean)
        .map((match) => match[1].trim());
}

function directScalar(block, key) {
    const child = directKey(block, key);
    return child ? scalarValue(child.document.lines[child.start]) : null;
}

function blockText(block) {
    return block.document.lines.slice(block.start, block.end).map((line) => line.raw).join('\n');
}

function topLevelBlock(document, key) {
    return directKey(rootBlock(document), key);
}

function stepBlocks(document) {
    return document.lines
        .filter((line) => line.structural && mappingKey(line) === 'steps')
        .flatMap((line) => directChildren(blockAt(document, line.index)))
        .filter((line) => sequenceMappingKey(line) !== null)
        .map((line) => blockAt(document, line.index));
}

function stepKeyBlock(step, key) {
    const firstLine = step.document.lines[step.start];
    if (sequenceMappingKey(firstLine) === key) return step;
    return directKey(step, key);
}

function stepScalar(step, key) {
    const keyBlock = stepKeyBlock(step, key);
    return keyBlock ? scalarValue(keyBlock.document.lines[keyBlock.start]) : null;
}

function actionReference(line) {
    const value = scalarValue(line);
    return value.split(/\s+/)[0];
}

function usesLines(document) {
    return document.lines.filter((line) => line.structural
        && (mappingKey(line) === 'uses' || sequenceMappingKey(line) === 'uses'));
}

function actionSteps(document, actionPrefix) {
    return stepBlocks(document).filter((step) => (stepScalar(step, 'uses') || '').startsWith(actionPrefix));
}

function stepById(document, stepId) {
    const matches = stepBlocks(document).filter((step) => stepScalar(step, 'id') === stepId);
    return matches.length === 1 ? matches[0] : null;
}

function runCommands(step) {
    const run = stepKeyBlock(step, 'run');
    if (!run) return [];
    const inlineCommand = scalarValue(run.document.lines[run.start]);
    if (inlineCommand && !/^[|>][+-]?$/.test(inlineCommand)) return [inlineCommand];
    const commands = [];
    let continued = '';
    for (const line of run.document.lines.slice(run.start + 1, run.end)) {
        const trimmed = line.raw.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const hasContinuation = trimmed.endsWith('\\');
        const fragment = hasContinuation ? trimmed.slice(0, -1).trimEnd() : trimmed;
        continued = continued ? `${continued} ${fragment}` : fragment;
        if (!hasContinuation) {
            commands.push(continued);
            continued = '';
        }
    }
    if (continued) commands.push(continued);
    return commands;
}

function allRunCommands(document) {
    return stepBlocks(document).flatMap(runCommands);
}

function stepsWithExactCommand(document, command) {
    return stepBlocks(document).filter((step) => runCommands(step).includes(command));
}

function addError(errors, condition, message) {
    if (!condition) errors.push(message);
}

function validateInputContract(document, eventName, errors) {
    const on = topLevelBlock(document, 'on');
    const event = on && directKey(on, eventName);
    const inputs = event && directKey(event, 'inputs');
    const candidate = inputs && directKey(inputs, 'candidate_sha');
    addError(errors, Boolean(candidate), `${document.name}: ${eventName}.inputs.candidate_sha is required`);
    if (!candidate) return;
    addError(errors, directScalar(candidate, 'required') === 'true',
        `${document.name}: ${eventName} candidate_sha must be required`);
    addError(errors, directScalar(candidate, 'type') === 'string',
        `${document.name}: ${eventName} candidate_sha must have string type`);
}

function validateTriggerSet(document, expectedEvents, errors) {
    const on = topLevelBlock(document, 'on');
    addError(errors, Boolean(on), `${document.name}: missing on mapping`);
    if (!on) return;
    const actual = directKeys(on).sort();
    const expected = [...expectedEvents].sort();
    addError(errors, JSON.stringify(actual) === JSON.stringify(expected),
        `${document.name}: unexpected trigger set (${actual.join(', ')})`);
}

function validateNonMainPush(document, errors) {
    const on = topLevelBlock(document, 'on');
    const push = on && directKey(on, 'push');
    const ignored = push && directKey(push, 'branches-ignore');
    addError(errors, Boolean(ignored) && directListValues(ignored).includes('main'),
        `${document.name}: push must ignore main`);
}

function validatePermissions(document, errors) {
    const permissionLines = document.lines.filter((line) => line.structural && mappingKey(line) === 'permissions');
    addError(errors, permissionLines.length > 0, `${document.name}: missing permissions`);
    for (const line of permissionLines) {
        const value = scalarValue(line);
        const block = blockAt(document, line.index);
        const entries = directChildren(block)
            .map((child) => [mappingKey(child), scalarValue(child)])
            .filter(([key]) => key);
        addError(errors, value === '', `${document.name}: scalar permissions are forbidden at line ${line.index + 1}`);
        addError(errors, entries.length === 1 && entries[0][0] === 'contents' && entries[0][1] === 'read',
            `${document.name}: permissions must be exactly contents: read at line ${line.index + 1}`);
    }
}

function validateSupportedYamlSubset(document, errors) {
    for (const line of document.lines.filter((candidate) => candidate.structural)) {
        const mapping = line.trimmed.match(/^[A-Za-z0-9_.-]+:(?:\s+(.*))?$/);
        const sequenceMapping = line.trimmed.match(/^-\s+[A-Za-z0-9_.-]+:(?:\s+(.*))?$/);
        const scalarList = line.trimmed.match(/^-\s+(.+)$/);
        const scalar = mapping ? mapping[1] : sequenceMapping ? sequenceMapping[1] : scalarList ? scalarList[1] : null;
        let supported = Boolean(mapping || sequenceMapping || scalarList);
        if (supported && scalar !== undefined && scalar !== null) {
            const unquoted = stripInlineComment(scalar).trim();
            const flowValue = unquoted.startsWith('{') || unquoted.startsWith('[');
            const yamlDirective = /(?:^|\s)(?:[&*][A-Za-z0-9_.-]+|!(?:!|[A-Za-z])[^\s]*)(?:\s|$)/.test(unquoted);
            supported = !flowValue && !yamlDirective;
        }
        addError(errors, supported,
            `${document.name}: unsupported YAML syntax at line ${line.index + 1}; parser is fail-closed`);
    }
}

function validateActionPins(document, errors) {
    for (const line of usesLines(document)) {
        const reference = actionReference(line);
        if (reference.startsWith('./')) {
            addError(errors, /^\.\/\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/.test(reference),
                `${document.name}: only local reusable workflows may omit an Action SHA (${reference})`);
            continue;
        }
        addError(errors,
            /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9._/-]+)?@[0-9a-f]{40}$/i.test(reference),
            `${document.name}: external uses must end in a full 40-hex SHA (${reference})`);
    }
}

function validateAuditedActionAllowlist(document, errors) {
    const actual = usesLines(document).map(actionReference).sort();
    const expected = [...AUDITED_USES[document.name]].sort();
    addError(errors, JSON.stringify(actual) === JSON.stringify(expected),
        `${document.name}: uses multiset differs from the audited action/reusable-workflow allowlist`);
}

function validateCheckoutCredentials(document, errors) {
    const checkouts = actionSteps(document, 'actions/checkout@');
    for (const step of checkouts) {
        const withBlock = directKey(step, 'with');
        addError(errors, Boolean(withBlock), `${document.name}: checkout is missing with inputs`);
        if (withBlock) {
            addError(errors, directScalar(withBlock, 'persist-credentials') === 'false',
                `${document.name}: checkout must set persist-credentials: false`);
        }
    }
}

function validateGlobalWorkflowSet(workflows) {
    const errors = [];
    for (const [name, source] of Object.entries(workflows)) {
        const document = parseWorkflow(source, name);
        addError(errors, !document.lines.some((line) => line.hasIndentTab), `${name}: tab indentation is forbidden`);
        addError(errors, !/\bpull_request_target\b/.test(source), `${name}: pull_request_target is forbidden`);
        validateSupportedYamlSubset(document, errors);
        validatePermissions(document, errors);
        validateActionPins(document, errors);
        validateAuditedActionAllowlist(document, errors);
        validateCheckoutCredentials(document, errors);
    }
    return errors;
}

function validateExactCandidate(document, errors) {
    const source = document.source;
    addError(errors, !source.includes('inputs.candidate_sha || github.sha'),
        `${document.name}: fail-open candidate fallback with || is forbidden`);
    addError(errors, source.includes(`contains(toJSON(inputs), '"candidate_sha"')`),
        `${document.name}: resolver must distinguish an absent input key from an explicitly empty input`);
    addError(errors, /REQUESTED_CANDIDATE_SHA:\s*\$\{\{\s*inputs\.candidate_sha\s*\}\}/.test(source)
        && /EVENT_CANDIDATE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/.test(source),
    `${document.name}: requested and event candidates must enter shell only through env`);
    addError(errors, /if \[ "\$HAS_REQUESTED_CANDIDATE" = "true" \]; then[\s\S]{0,200}?candidate_sha="\$REQUESTED_CANDIDATE_SHA"/.test(source),
        `${document.name}: present candidate input, including empty input, must remain authoritative`);
    addError(errors, /elif \[ "\$EVENT_NAME" = "pull_request" \] \|\| \[ "\$EVENT_NAME" = "push" \]; then[\s\S]{0,120}?candidate_sha="\$EVENT_CANDIDATE_SHA"/.test(source),
        `${document.name}: event SHA fallback is allowed only for direct PR/push triggers`);
    addError(errors, source.includes('echo "sha=$candidate_sha" >> "$GITHUB_OUTPUT"')
        && source.includes('echo "CANDIDATE_SHA=$candidate_sha" >> "$GITHUB_ENV"'),
    `${document.name}: validated candidate must be recorded as an output and environment value`);
    addError(errors, source.includes('^[0-9a-f]{40}$'),
        `${document.name}: candidate must be validated as exactly 40 lowercase hex characters`);

    const checkouts = actionSteps(document, 'actions/checkout@');
    addError(errors, checkouts.length === 1, `${document.name}: expected one exact checkout`);
    if (checkouts.length === 1) {
        const withBlock = directKey(checkouts[0], 'with');
        addError(errors, withBlock && directScalar(withBlock, 'ref') === '${{ steps.candidate.outputs.sha }}',
            `${document.name}: checkout ref must be the validated candidate output`);
    }

    addError(errors, source.includes('git rev-parse HEAD'), `${document.name}: missing HEAD resolution proof`);
    addError(errors, /\[\s*"\$actual_sha"\s*!=\s*"\$CANDIDATE_SHA"\s*\]/.test(source),
        `${document.name}: resolved HEAD must be compared with the requested candidate`);
    addError(errors, source.includes('git cat-file -e "$CANDIDATE_SHA^{commit}"'),
        `${document.name}: candidate commit object must be proven`);
}

function validateCi(source) {
    const document = parseWorkflow(source, 'ci');
    const errors = [];
    validateTriggerSet(document, ['pull_request', 'push', 'workflow_dispatch', 'workflow_call'], errors);
    validateNonMainPush(document, errors);
    validateInputContract(document, 'workflow_dispatch', errors);
    validateInputContract(document, 'workflow_call', errors);
    validateExactCandidate(document, errors);
    validateCandidateRangeWhitespaceGate(document, errors);
    addError(errors, /^name:\s*.*NO DEPLOY.*$/mi.test(source), 'ci: workflow name must state NO DEPLOY');

    for (const [command, label] of CI_REQUIRED_COMMANDS) {
        const matches = stepsWithExactCommand(document, command);
        addError(errors, matches.length === 1, `ci: ${label} must be one unique exact-command step`);
        if (matches.length === 1) {
            addError(errors, stepKeyBlock(matches[0], 'if') === null,
                `ci: ${label} must not have a skippable if condition`);
            addError(errors, stepKeyBlock(matches[0], 'continue-on-error') === null,
                `ci: ${label} must not continue on error`);
        }
    }
    const npmSelector = stepsWithExactCommand(document,
        'npm install --global npm@10.9.8 --ignore-scripts --no-audit --no-fund')[0];
    const npmSelectorText = npmSelector ? blockText(npmSelector) : '';
    addError(errors, npmSelectorText.includes('actual_npm_version="$(npm --version)"')
        && /\[ "\$actual_npm_version" != "10\.9\.8" \]/.test(npmSelectorText),
    'ci: exact npm selector must prove npm --version equals 10.9.8');
    return errors;
}

function validateCandidateRangeWhitespaceGate(document, errors) {
    const checkouts = actionSteps(document, 'actions/checkout@');
    addError(errors, checkouts.length === 1, 'ci: candidate-range gate requires one exact checkout');
    if (checkouts.length === 1) {
        const withBlock = directKey(checkouts[0], 'with');
        addError(errors, withBlock && directScalar(withBlock, 'fetch-depth') === '0',
            'ci: candidate-range gate requires full checkout history');
    }

    const command = 'git diff --check "$base_sha" "$CANDIDATE_SHA" --';
    const gateSteps = stepsWithExactCommand(document, command);
    addError(errors, gateSteps.length === 1,
        'ci: candidate-range whitespace gate must use the derived merge-base and exact candidate');
    if (gateSteps.length === 1) {
        const gateText = blockText(gateSteps[0]);
        addError(errors, stepScalar(gateSteps[0], 'shell') === 'bash',
            'ci: candidate-range whitespace gate must run under Bash');
        addError(errors, gateText.includes('set -euo pipefail'),
            'ci: candidate-range whitespace gate must enable set -euo pipefail');
        addError(errors, gateText.includes("git rev-parse 'refs/remotes/origin/main^{commit}'"),
            'ci: candidate-range whitespace gate must resolve origin/main as a commit');
        addError(errors, gateText.includes('git cat-file -e "$remote_main_sha^{commit}"'),
            'ci: candidate-range whitespace gate must prove the origin/main commit exists');
        addError(errors, gateText.includes('base_sha="$(git merge-base "$remote_main_sha" "$CANDIDATE_SHA")"'),
            'ci: candidate-range whitespace gate must derive its merge-base from origin/main and CANDIDATE_SHA');
        addError(errors, gateText.includes('if [ -z "$base_sha" ]; then'),
            'ci: candidate-range whitespace gate must fail if merge-base resolution is empty');
        addError(errors, gateText.includes('git merge-base --is-ancestor "$base_sha" "$CANDIDATE_SHA"'),
            'ci: candidate-range whitespace gate must prove merge-base ancestry');
        addError(errors, stepKeyBlock(gateSteps[0], 'if') === null,
            'ci: candidate-range whitespace gate must not have a skippable if condition');
        addError(errors, stepKeyBlock(gateSteps[0], 'continue-on-error') === null,
            'ci: candidate-range whitespace gate must not continue on error');
    }

    const commands = allRunCommands(document);
    addError(errors, !commands.includes('git diff --check'),
        'ci: bare clean-worktree git diff --check is forbidden');
    addError(errors, !/\bgit\s+diff\s+--check\s+(?:HEAD\^|[0-9a-f]{40})/i.test(document.source)
        && !document.source.includes('github.event.before')
        && !document.source.includes('github.event.pull_request.base'),
        'ci: candidate-range whitespace gate must not use HEAD^, event bases, or a hard-coded baseline');
    addError(errors, !/4b825dc642cb6eb9a060e54bf8d69288fbee4904|--root/.test(document.source),
        'ci: candidate-range whitespace gate must not compare against an empty tree');
    addError(errors, !/git merge-base[^\n]*(?:\|\|\s*true|\|\|\s*echo)|base_sha=.*:-/.test(document.source),
        'ci: candidate-range whitespace gate must not use an empty-range fallback');
}

function findJob(document, jobName) {
    const jobs = topLevelBlock(document, 'jobs');
    return jobs && directKey(jobs, jobName);
}

function validateReusableCaller(job, expectedPath, errors, label) {
    addError(errors, Boolean(job), `deploy: missing ${label} job`);
    if (!job) return;
    addError(errors, directScalar(job, 'uses') === expectedPath,
        `deploy: ${label} must call ${expectedPath}`);
    const withBlock = directKey(job, 'with');
    addError(errors, withBlock && directScalar(withBlock, 'candidate_sha') === '${{ inputs.candidate_sha }}',
        `deploy: ${label} must pass the explicit candidate_sha input`);
}

function validateDeploy(source) {
    const document = parseWorkflow(source, 'deploy');
    const errors = [];
    validateTriggerSet(document, ['workflow_dispatch'], errors);
    validateInputContract(document, 'workflow_dispatch', errors);

    const jobs = topLevelBlock(document, 'jobs');
    const jobNames = jobs ? directKeys(jobs).sort() : [];
    const expectedJobs = ['image-validation', 'no-deploy-boundary', 'source-validation'].sort();
    addError(errors, JSON.stringify(jobNames) === JSON.stringify(expectedJobs),
        `deploy: only the two reusable gates and no-deploy boundary job are allowed (${jobNames.join(', ')})`);

    validateReusableCaller(findJob(document, 'source-validation'), './.github/workflows/ci.yml',
        errors, 'source-validation');
    validateReusableCaller(findJob(document, 'image-validation'), './.github/workflows/image-validation.yml',
        errors, 'image-validation');

    const boundary = findJob(document, 'no-deploy-boundary');
    const needs = boundary && directKey(boundary, 'needs');
    const neededJobs = needs ? directListValues(needs).sort() : [];
    addError(errors, JSON.stringify(neededJobs) === JSON.stringify(['image-validation', 'source-validation']),
        'deploy: boundary summary must depend on both reusable gates');
    addError(errors, boundary && /^\$\{\{\s*always\(\)\s*\}\}$/.test(directScalar(boundary, 'if') || ''),
        'deploy: boundary summary must always run');

    addError(errors, /^name:\s*.*Candidate Preflight.*NO DEPLOY.*$/mi.test(source),
        'deploy: name must unambiguously say candidate preflight and NO DEPLOY');
    addError(errors,
        source.includes('This run did not publish, promote, approve, deploy, or prove rollback/readiness.'),
        'deploy: missing explicit non-approval/non-readiness/non-rollback/no-deploy boundary');
    addError(errors,
        /Production promotion remains intentionally unavailable pending S4, then S3b\./.test(source),
        'deploy: missing S4 then S3b promotion prerequisite');
    addError(errors, /cancel-in-progress:\s*false/.test(source),
        'deploy: candidate preflight must not model production cancellation');

    addError(errors, !document.lines.some((line) => line.structural && mappingKey(line) === 'environment'),
        'deploy: GitHub deployment environments are forbidden in this preflight');
    addError(errors, !/\$\{\{\s*secrets\.|\bsecrets:\s*inherit\b/i.test(source),
        'deploy: secrets are forbidden');
    addError(errors, !/(?:ssh-action|scp-action|\bVPS\b|HOSTINGER|SERVER_(?:IP|USER|PORT)|SSH_PRIVATE_KEY)/i.test(source),
        'deploy: SSH/VPS transport material is forbidden');

    const commands = allRunCommands(document).join('\n');
    const forbiddenCommands = [
        [/\bgit\s+pull\b/i, 'mutable git pull'],
        [/\bdocker\s+compose\b/i, 'Docker Compose remote operation'],
        [/\bdocker\s+login\b|docker\/login-action/i, 'registry login'],
        [/\b(?:ssh|scp|rsync)\b/i, 'remote shell/file transport'],
        [/\b(?:curl|wget)\s+https?:\/\//i, 'remote HTTP call'],
        [/\b(?:kubectl|helm)\b|\bdocker\s+stack\s+deploy\b/i, 'orchestrator deployment'],
        [/(?:^|\s)(?:\.\/)?deploy(?:\.sh)?(?:\s|$)/im, 'deployment script']
    ];
    for (const [pattern, label] of forbiddenCommands) {
        addError(errors, !pattern.test(commands), `deploy: forbidden ${label}`);
    }
    return errors;
}

function validateBuildInputs(step, errors) {
    const withBlock = directKey(step, 'with');
    addError(errors, Boolean(withBlock), 'image: build action is missing inputs');
    if (!withBlock) return;
    const required = {
        context: '.',
        file: './Dockerfile',
        platforms: 'linux/amd64',
        load: 'true',
        push: 'false',
        pull: 'true',
        'no-cache': 'true',
        provenance: 'false',
        sbom: 'false',
        tags: '${{ steps.candidate.outputs.image_ref }}',
        'github-token': ''
    };
    for (const [key, expected] of Object.entries(required)) {
        addError(errors, directScalar(withBlock, key) === expected,
            `image: build input ${key} must equal ${JSON.stringify(expected)}`);
    }
    const allowedKeys = [
        'context', 'file', 'platforms', 'load', 'push', 'pull', 'no-cache',
        'provenance', 'sbom', 'tags', 'labels', 'github-token'
    ].sort();
    const actualKeys = directKeys(withBlock).sort();
    addError(errors, JSON.stringify(actualKeys) === JSON.stringify(allowedKeys),
        'image: build with mapping must contain only the exact audited input-key allowlist');
    for (const key of ['secrets', 'secret-envs', 'secret-files', 'ssh']) {
        addError(errors, directKey(withBlock, key) === null, `image: build input ${key} is forbidden`);
    }
}

function validateExactImageAction(step, label, errors) {
    const withBlock = directKey(step, 'with');
    addError(errors, Boolean(withBlock), `image: ${label} action is missing inputs`);
    if (withBlock) {
        addError(errors, directScalar(withBlock, 'image') === '${{ steps.candidate.outputs.image_ref }}',
            `image: ${label} must inspect the exact validated local image output`);
    }
}

function validateImage(source) {
    const document = parseWorkflow(source, 'image');
    const errors = [];
    validateTriggerSet(document, ['pull_request', 'push', 'workflow_dispatch', 'workflow_call'], errors);
    validateNonMainPush(document, errors);
    validateInputContract(document, 'workflow_dispatch', errors);
    validateInputContract(document, 'workflow_call', errors);
    validateExactCandidate(document, errors);
    addError(errors, /^name:\s*.*Build Once.*NO PUSH.*NO DEPLOY.*$/mi.test(source),
        'image: workflow name must state build once, NO PUSH, and NO DEPLOY');

    const jobs = topLevelBlock(document, 'jobs');
    addError(errors, jobs && directKeys(jobs).length === 1, 'image: exactly one image-validation job is required');

    const setupSteps = actionSteps(document, 'docker/setup-buildx-action@');
    addError(errors, setupSteps.length === 1, 'image: exactly one setup-buildx action is required');
    if (setupSteps.length === 1) {
        const withBlock = directKey(setupSteps[0], 'with');
        addError(errors, withBlock && directScalar(withBlock, 'version') === 'v0.35.0'
            && directScalar(withBlock, 'cache-binary') === 'false'
            && directScalar(withBlock, 'cleanup') === 'true',
        'image: setup-buildx must use exact version, disabled binary cache, and cleanup');
    }

    const buildSteps = actionSteps(document, 'docker/build-push-action@');
    addError(errors, buildSteps.length === 1, 'image: exactly one build-push action is required');
    if (buildSteps.length === 1) validateBuildInputs(buildSteps[0], errors);

    const commands = allRunCommands(document);
    const commandText = commands.join('\n');
    addError(errors, !/\bdocker\s+(?:build\b|buildx\s+build\b|compose\s+build\b)/i.test(commandText),
        'image: shell-based second image build is forbidden');
    addError(errors, !/\bdocker\s+(?:system|image|container|builder|volume)\s+prune\b/i.test(commandText),
        'image: broad Docker prune is forbidden');
    addError(errors, !/\bdocker\s+(?:image\s+)?push\b|\bdocker\s+buildx\s+imagetools\s+create\b|\bdocker\s+compose\s+push\b|\bdocker\s+manifest\s+push\b/i.test(commandText),
        'image: shell-based registry publication is forbidden');
    addError(errors, !/\bdocker\s+login\b/i.test(commandText)
        && actionSteps(document, 'docker/login-action@').length === 0,
    'image: registry login is forbidden');
    addError(errors, !/\$\{\{\s*secrets\./i.test(source), 'image: repository/registry secret references are forbidden');
    addError(errors, !document.lines.some((line) => line.structural
        && ['username', 'password', 'registry-username', 'registry-password'].includes(mappingKey(line))),
    'image: registry credential inputs are forbidden');

    addError(errors, source.includes('image_ref="local/slicer-api-validation:$candidate_sha"')
        && source.includes('echo "image_ref=$image_ref" >> "$GITHUB_OUTPUT"')
        && source.includes('echo "IMAGE_REF=$image_ref" >> "$GITHUB_ENV"'),
    'image: exact candidate-scoped local image ref must be recorded as output and environment value');
    addError(errors, !document.lines.some((line) => line.structural && mappingKey(line) === 'EVIDENCE_DIR'),
        'image: evidence directory must not be a workspace-relative workflow env value');
    addError(errors, /EVIDENCE_SUBDIR:.*github\.run_id.*github\.run_attempt/.test(source)
        && /^\s*evidence_dir="\$RUNNER_TEMP\/\$EVIDENCE_SUBDIR"\s*$/m.test(source),
    'image: evidence must use a unique runner.temp subdirectory');
    addError(errors, /\[\s*-e\s+"\$evidence_dir"\s*\][\s\S]{0,80}?\[\s*-L\s+"\$evidence_dir"\s*\]/.test(source),
        'image: pre-existing or symlinked evidence directory must be rejected');
    addError(errors, /:\s*>\s*"\$evidence_dir\/syft\.yaml"/.test(source)
        && /:\s*>\s*"\$evidence_dir\/grype\.yaml"/.test(source),
    'image: workflow-created empty Syft and Grype configs are required');
    const candidateStep = stepById(document, 'candidate');
    const candidateText = candidateStep ? blockText(candidateStep) : '';
    const evidenceMkdirIndex = candidateText.indexOf('mkdir -m 0700 -- "$evidence_dir"');
    const evidenceExportIndex = candidateText.indexOf('echo "EVIDENCE_DIR=$evidence_dir" >> "$GITHUB_ENV"');
    const syftConfigIndex = candidateText.indexOf(': > "$evidence_dir/syft.yaml"');
    addError(errors, evidenceMkdirIndex >= 0 && evidenceMkdirIndex < evidenceExportIndex
        && evidenceExportIndex < syftConfigIndex,
    'image: evidence directory must be exported immediately after trusted creation and before scanner config writes');

    const dockerRuns = commands.filter((command) => /\bdocker\s+run\b/.test(command));
    addError(errors, dockerRuns.length === 1, 'image: exactly one disposable docker run is required');
    if (dockerRuns.length === 1) {
        const dockerRun = dockerRuns[0];
        addError(errors, dockerRun.includes('"$IMAGE_REF"'), 'image: smoke container must use exact IMAGE_REF');
        const forbiddenFlags = [
            [/(?:^|\s)--privileged(?:\s|=|$)/, 'privileged'],
            [/(?:^|\s)--cap-add(?:\s|=|$)/, 'cap-add'],
            [/(?:^|\s)--publish(?:\s|=|$)|(?:^|\s)-p(?:\s|=)/, 'host port'],
            [/(?:^|\s)--volume(?:\s|=|$)|(?:^|\s)-v(?:\s|=)/, 'host volume'],
            [/(?:^|\s)--mount(?:\s|=|$)/, 'host mount'],
            [/(?:^|\s)--network(?:\s+|=)host(?:\s|$)/, 'host network']
        ];
        for (const [pattern, label] of forbiddenFlags) {
            addError(errors, !pattern.test(dockerRun), `image: docker run ${label} access is forbidden`);
        }
        const requiredIsolation = [
            '--pull never',
            '--restart no',
            '--network none',
            '--cap-drop ALL',
            '--security-opt no-new-privileges',
            '--pids-limit 512',
            '--tmpfs /app/input:rw,nosuid,nodev,noexec,size=64m',
            '--tmpfs /app/output:rw,nosuid,nodev,noexec,size=64m'
        ];
        for (const requiredFlag of requiredIsolation) {
            addError(errors, dockerRun.includes(requiredFlag),
                `image: docker run must retain isolation flag ${requiredFlag}`);
        }
    }

    const smokeGate = stepById(document, 'smoke_gate');
    addError(errors, Boolean(smokeGate), 'image: missing explicit smoke_gate step');
    if (smokeGate) {
        const smokeText = blockText(smokeGate);
        addError(errors, /for\s+attempt\s+in\s+\$\(seq\s+1\s+120\)/.test(smokeText)
            && /\.State\.Health\.Status/.test(smokeText) && /sleep\s+2/.test(smokeText),
        'image: smoke_gate must retain the bounded liveness-only health loop');
        addError(errors, stepKeyBlock(smokeGate, 'if') === null,
            'image: smoke_gate must not have a skippable if condition');
        addError(errors, stepKeyBlock(smokeGate, 'continue-on-error') === null,
            'image: smoke_gate must not continue on error');
        const dockerRunStep = stepBlocks(document).find((step) => runCommands(step)
            .some((command) => /\bdocker\s+run\b/.test(command)));
        addError(errors, dockerRunStep && smokeGate.start > dockerRunStep.start,
            'image: smoke_gate must execute after the disposable container starts');
    }
    addError(errors, source.includes('not production readiness'),
        'image: health evidence must be labelled liveness-only, not readiness');

    const sbomSteps = actionSteps(document, 'anchore/sbom-action@');
    addError(errors, sbomSteps.length === 1, 'image: exactly one SBOM action is required');
    if (sbomSteps.length === 1) {
        validateExactImageAction(sbomSteps[0], 'SBOM', errors);
        const withBlock = directKey(sbomSteps[0], 'with');
        addError(errors, withBlock && directScalar(withBlock, 'format') === 'spdx-json',
            'image: SBOM must be SPDX JSON');
        addError(errors, withBlock && directScalar(withBlock, 'upload-artifact') === 'false',
            'image: SBOM action must not independently upload artifacts');
        addError(errors, withBlock && directScalar(withBlock, 'output-file')
            === '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/sbom.spdx.json',
        'image: SBOM output must use the exact runner.temp evidence path');
        addError(errors, withBlock && directScalar(withBlock, 'github-token') === ''
            && directScalar(withBlock, 'dependency-snapshot') === 'false'
            && directScalar(withBlock, 'upload-release-assets') === 'false',
        'image: SBOM token, dependency snapshot, and release upload boundaries must remain disabled');
        addError(errors, withBlock && directScalar(withBlock, 'config')
            === '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/syft.yaml',
        'image: SBOM action must use the exact runner.temp Syft config');
    }

    const scanSteps = actionSteps(document, 'anchore/scan-action@');
    addError(errors, scanSteps.length === 1, 'image: exactly one scan action is required');
    if (scanSteps.length === 1) {
        validateExactImageAction(scanSteps[0], 'scan', errors);
        const withBlock = directKey(scanSteps[0], 'with');
        addError(errors, withBlock && directScalar(withBlock, 'output-format') === 'json',
            'image: scanner result must be machine-readable JSON');
        addError(errors, withBlock && directScalar(withBlock, 'severity-cutoff') === 'high',
            'image: scanner cutoff must include high and critical findings');
        addError(errors, withBlock && directScalar(withBlock, 'output-file')
            === '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.json'
            && directScalar(withBlock, 'cache-db') === 'false',
        'image: scanner output must use exact runner.temp path with database cache disabled');
        addError(errors, withBlock && directScalar(withBlock, 'config')
            === '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.yaml',
        'image: scanner must use the exact runner.temp Grype config');
        if (withBlock) {
            const expectedScanInputs = {
                image: '${{ steps.candidate.outputs.image_ref }}',
                'fail-build': 'false',
                'output-format': 'json',
                'output-file': '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.json',
                'severity-cutoff': 'high',
                'only-fixed': 'false',
                'grype-version': 'v0.110.0',
                'cache-db': 'false',
                config: '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.yaml'
            };
            for (const [key, expected] of Object.entries(expectedScanInputs)) {
                addError(errors, directScalar(withBlock, key) === expected,
                    `image: scanner input ${key} must equal ${JSON.stringify(expected)}`);
            }
            addError(errors,
                JSON.stringify(directKeys(withBlock).sort())
                    === JSON.stringify(Object.keys(expectedScanInputs).sort()),
                'image: scanner with mapping must contain only the exact audited input-key allowlist');
        }
    }
    const scanGate = stepById(document, 'scan_gate');
    addError(errors, Boolean(scanGate), 'image: missing explicit scan_gate step');
    if (scanGate) {
        const gateText = blockText(scanGate);
        addError(errors, stepScalar(scanGate, 'if')
            === "${{ always() && steps.scan.outcome != 'skipped' }}",
        'image: scan_gate must have the exact always/non-skipped condition');
        addError(errors, stepKeyBlock(scanGate, 'continue-on-error') === null,
            'image: scan_gate must not continue on error');
        addError(errors, scanSteps.length === 1 && scanGate.start > scanSteps[0].start,
            'image: scan_gate must execute after the scan action');
        addError(errors, /counts\.high\s*>\s*0\s*\|\|\s*counts\.critical\s*>\s*0/.test(gateText)
            && /process\.exit\(1\)/.test(gateText),
        'image: scan_gate must fail verified high/critical findings');
        addError(errors, gateText.includes('Scanner infrastructure failure') && /process\.exit\(2\)/.test(gateText),
            'image: scan_gate must distinguish and fail scanner infrastructure errors');
    }

    const uploads = actionSteps(document, 'actions/upload-artifact@');
    addError(errors, uploads.length === 1, 'image: exactly one bounded evidence upload is required');
    if (uploads.length === 1) {
        const withBlock = directKey(uploads[0], 'with');
        const retention = Number(withBlock && directScalar(withBlock, 'retention-days'));
        const pathBlock = withBlock && directKey(withBlock, 'path');
        const artifactPaths = pathBlock ? blockText(pathBlock) : '';
        const uploadedPathLines = pathBlock ? pathBlock.document.lines.slice(pathBlock.start + 1, pathBlock.end)
            .map((line) => line.raw.trim()).filter(Boolean) : [];
        addError(errors, Number.isInteger(retention) && retention >= 1 && retention <= 7,
            'image: evidence artifact retention must be between 1 and 7 days');
        addError(errors, directScalar(withBlock, 'name')
            === 's3a-image-evidence-${{ steps.candidate.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
        'image: artifact name must be unique across candidate, run, and rerun attempt');
        for (const fileName of ['image-identity.txt', 'sbom.spdx.json', 'grype.json']) {
            addError(errors, artifactPaths.includes(fileName), `image: bounded artifact must include ${fileName}`);
        }
        const expectedUploadPaths = [
            '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/image-identity.txt',
            '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/sbom.spdx.json',
            '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.json'
        ].sort();
        addError(errors, JSON.stringify(uploadedPathLines.sort()) === JSON.stringify(expectedUploadPaths),
            'image: artifact upload must use the exact three runner.temp evidence paths');
        addError(errors, !/(?:\.tar\b|\.oci\b|\*\*|^\s*\.\s*$)/im.test(artifactPaths),
            'image: full image or broad directory artifact upload is forbidden');
    }

    const artifactBoundary = stepById(document, 'artifact_boundary');
    addError(errors, Boolean(artifactBoundary), 'image: missing fail-closed artifact boundary step');
    if (artifactBoundary) {
        const boundaryCondition = directScalar(artifactBoundary, 'if') || '';
        const boundaryText = blockText(artifactBoundary);
        addError(errors, boundaryCondition === "${{ always() && steps.build.outcome == 'success' }}",
            'image: artifact boundary must use the exact always/build-success condition');
        addError(errors, stepKeyBlock(artifactBoundary, 'continue-on-error') === null,
            'image: artifact boundary must not continue on error');
        for (const fileName of ['image-identity.txt', 'sbom.spdx.json', 'grype.json']) {
            addError(errors, boundaryText.includes(fileName),
                `image: artifact boundary must enumerate ${fileName}`);
        }
        addError(errors, /(?:\s-f\s+"?\$[A-Za-z_][A-Za-z0-9_]*"?|!stat\.isFile\(\))/.test(boundaryText),
            'image: artifact boundary must require regular files');
        addError(errors, /(?:\s-L\s+"?\$[A-Za-z_][A-Za-z0-9_]*"?|!stat\.isFile\(\)\s*\|\|\s*stat\.isSymbolicLink\(\))/.test(boundaryText),
            'image: artifact boundary must reject symlink files');
        addError(errors, /path\.dirname\(fs\.realpathSync\(filePath\)\)\s*!==\s*actualRoot/.test(boundaryText),
            'image: artifact boundary must prove realpath containment');
        addError(errors, /stat\.size\s*<=\s*0\s*\|\|\s*stat\.size\s*>\s*limit/.test(boundaryText),
            'image: artifact boundary must enforce file-size bounds');
        addError(errors, (boundaryText.match(/JSON\.parse/g) || []).length >= 2,
            'image: artifact boundary must parse machine-readable JSON before upload');
    }
    if (uploads.length === 1) {
        const uploadCondition = directScalar(uploads[0], 'if') || '';
        addError(errors, /steps\.artifact_boundary\.outcome\s*==\s*'success'/.test(uploadCondition),
            'image: artifact upload must be gated by successful artifact boundary outcome');
        addError(errors, artifactBoundary && artifactBoundary.start < uploads[0].start,
            'image: artifact boundary must run before artifact upload');
    }

    addError(errors, source.includes('candidate_sha=$CANDIDATE_SHA')
        && source.includes('local_image_id=$actual_image_id')
        && source.includes('identity_scope=local-loaded-image-only')
        && source.includes('registry_digest=not_applicable_no_push')
        && source.includes('signature=not_created')
        && source.includes('attestation=not_created'),
    'image: local image identity evidence and non-provenance disclaimer are required');

    const cleanupSteps = stepBlocks(document).filter((step) => {
        const text = blockText(step);
        return text.includes('docker container rm') && text.includes('docker image rm');
    });
    addError(errors, cleanupSteps.length === 1, 'image: one exact-resource cleanup step is required');
    if (cleanupSteps.length === 1) {
        const cleanup = cleanupSteps[0];
        addError(errors, /^\$\{\{\s*always\(\)\s*\}\}$/.test(directScalar(cleanup, 'if') || ''),
            'image: exact-resource cleanup must use if: always()');
        const cleanupText = blockText(cleanup);
        addError(errors, /docker container rm --force "\$CONTAINER_NAME"/.test(cleanupText),
            'image: cleanup must target exact CONTAINER_NAME');
        addError(errors, /docker image rm --force "\$IMAGE_REF"/.test(cleanupText),
            'image: cleanup must target exact IMAGE_REF');
        addError(errors, /if \[ -n "\$\{IMAGE_REF:-\}" \] && docker image inspect/.test(cleanupText),
            'image: cleanup must guard an unset IMAGE_REF before image inspection');
        addError(errors, /if \[ -n "\$\{EVIDENCE_DIR:-\}" \]; then/.test(cleanupText),
            'image: cleanup must guard an unset EVIDENCE_DIR before evidence inspection');
    }
    return errors;
}

function assertValid(errors) {
    assert.deepEqual(errors, []);
}

function mutateOnce(source, search, replacement, expectedMarker) {
    const matches = typeof search === 'string' ? source.split(search).length - 1 : [...source.matchAll(new RegExp(
        search.source,
        search.flags.includes('g') ? search.flags : `${search.flags}g`
    ))].length;
    assert.ok(matches >= 1, `Mutation seam was not found: ${String(search)}`);
    const mutated = source.replace(search, replacement);
    assert.notEqual(mutated, source, `Mutation did not change source: ${String(search)}`);
    if (expectedMarker instanceof RegExp) {
        assert.match(mutated, expectedMarker, 'Mutation marker is absent');
    } else if (expectedMarker) {
        assert.ok(mutated.includes(expectedMarker), `Mutation marker is absent: ${expectedMarker}`);
    }
    return mutated;
}

function mutateStringOccurrence(source, search, occurrence, replacement, expectedMarker) {
    assert.ok(Number.isInteger(occurrence) && occurrence >= 1, 'Mutation occurrence must be positive');
    const parts = source.split(search);
    assert.ok(parts.length > occurrence, `Mutation occurrence ${occurrence} was not found: ${search}`);
    const mutated = parts.slice(0, occurrence).join(search)
        + replacement
        + parts.slice(occurrence).join(search);
    assert.notEqual(mutated, source, `Mutation did not change occurrence ${occurrence}: ${search}`);
    if (expectedMarker instanceof RegExp) {
        assert.match(mutated, expectedMarker, 'Mutation marker is absent');
    } else if (expectedMarker) {
        assert.ok(mutated.includes(expectedMarker), `Mutation marker is absent: ${expectedMarker}`);
    }
    return mutated;
}

function injectStepControlForCommand(source, command, controlLine) {
    const document = parseWorkflow(source, 'mutation');
    const matches = stepsWithExactCommand(document, command);
    assert.equal(matches.length, 1, `Expected one mutation step for command: ${command}`);
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const insertion = `${' '.repeat(matches[0].indent + 2)}${controlLine}`;
    lines.splice(matches[0].start + 1, 0, insertion);
    const mutated = lines.join('\n');
    assert.notEqual(mutated, source, `Step-control mutation did not change: ${command}`);
    assert.ok(mutated.includes(insertion), `Step-control mutation marker is absent: ${insertion}`);
    return mutated;
}

function assertRejected(errors, expectedError) {
    assert.ok(errors.length > 0, 'Controlled mutation unexpectedly passed the contract');
    if (expectedError) assert.match(errors.join('\n'), expectedError);
}

test('current workflows preserve read-only permissions, pinned actions, and credential-free checkout', () => {
    assertValid(validateGlobalWorkflowSet(WORKFLOWS));
    const deployDocument = parseWorkflow(WORKFLOWS.deploy, 'deploy');
    const localCalls = usesLines(deployDocument).map(actionReference).filter((reference) => reference.startsWith('./'));
    assert.deepEqual(localCalls.sort(), [
        './.github/workflows/ci.yml',
        './.github/workflows/image-validation.yml'
    ]);
});

test('reusable source validation is fail-closed for the exact candidate and all repository gates', () => {
    assertValid(validateCi(WORKFLOWS.ci));
});

test('production candidate preflight has an explicit non-deploy boundary', () => {
    assertValid(validateDeploy(WORKFLOWS.deploy));
});

test('image validation builds once and reuses one local image for smoke, SBOM, scan, evidence, and cleanup', () => {
    assertValid(validateImage(WORKFLOWS.image));
});

test('global workflow safety mutations are rejected in memory', async (t) => {
    const cases = [
        {
            name: 'pull_request_target trigger',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, 'on:\n', 'on:\n  pull_request_target:\n', 'pull_request_target:'),
            expected: /pull_request_target/
        },
        {
            name: 'write permission',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, '  contents: read', '  contents: write', 'contents: write'),
            expected: /permissions must be exactly contents: read/
        },
        {
            name: 'persisted checkout credentials',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, 'persist-credentials: false', 'persist-credentials: true',
                'persist-credentials: true'),
            expected: /persist-credentials: false/
        },
        {
            name: 'unpinned external action tag',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, /actions\/checkout@[0-9a-f]{40}/,
                'actions/checkout@v4', 'actions/checkout@v4'),
            expected: /full 40-hex SHA/
        },
        {
            name: 'non-workflow local uses bypass',
            workflow: 'deploy',
            mutate: (source) => mutateOnce(source, './.github/workflows/ci.yml', './scripts/local-action',
                './scripts/local-action'),
            expected: /only local reusable workflows/
        },
        {
            name: 'unnamed unpinned action step',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, '    steps:\n',
                '    steps:\n      - uses: actions/setup-node@v4\n', '- uses: actions/setup-node@v4'),
            expected: /full 40-hex SHA/
        },
        {
            name: 'unnamed checkout persists credentials',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, '    steps:\n',
                '    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n'
                + '        with:\n          persist-credentials: true\n',
                '- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'),
            expected: /persist-credentials: false/
        },
        {
            name: 'extra pinned but unaudited action',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, '    steps:\n',
                `    steps:\n      - uses: actions/cache@${'c'.repeat(40)}\n`,
                `- uses: actions/cache@${'c'.repeat(40)}`),
            expected: /audited action\/reusable-workflow allowlist/
        },
        {
            name: 'flow-style unnamed action step bypass',
            workflow: 'ci',
            mutate: (source) => mutateOnce(source, '    steps:\n',
                `    steps:\n      - { uses: actions/cache@${'d'.repeat(40)} }\n`,
                '- { uses:'),
            expected: /unsupported YAML syntax/
        },
        {
            name: 'anchor and alias permission indirection',
            workflow: 'ci',
            mutate: (source) => {
                const anchored = mutateOnce(source, 'permissions:\n  contents: read',
                    'permissions: &read_permissions\n  contents: read', '&read_permissions');
                return mutateOnce(anchored, '    permissions:\n      contents: read',
                    '    permissions: *read_permissions', '*read_permissions');
            },
            expected: /unsupported YAML syntax/
        }
    ];

    for (const mutation of cases) {
        await t.test(mutation.name, () => {
            const mutatedSource = mutation.mutate(WORKFLOWS[mutation.workflow]);
            const mutatedSet = { ...WORKFLOWS, [mutation.workflow]: mutatedSource };
            assertRejected(validateGlobalWorkflowSet(mutatedSet), mutation.expected);
        });
    }
});

test('source validation candidate and gate omissions are rejected in memory', async (t) => {
    const cases = [
        {
            name: 'workflow_call candidate is no longer required',
            mutate: (source) => mutateOnce(source,
                '  workflow_call:\n    inputs:\n      candidate_sha:\n        description: Full 40-character commit SHA to validate\n        required: true',
                '  workflow_call:\n    inputs:\n      candidate_sha:\n        description: Full 40-character commit SHA to validate\n        required: false',
                'required: false'),
            expected: /workflow_call candidate_sha must be required/
        },
        {
            name: 'candidate input loses string type',
            mutate: (source) => mutateOnce(source,
                '  workflow_call:\n    inputs:\n      candidate_sha:\n        description: Full 40-character commit SHA to validate\n        required: true\n        type: string',
                '  workflow_call:\n    inputs:\n      candidate_sha:\n        description: Full 40-character commit SHA to validate\n        required: true\n        type: boolean',
                'type: boolean'),
            expected: /candidate_sha must have string type/
        },
        {
            name: 'abbreviated candidate SHA accepted',
            mutate: (source) => mutateOnce(source, '^[0-9a-f]{40}$', '^[0-9a-f]{7,40}$', '^[0-9a-f]{7,40}$'),
            expected: /exactly 40 lowercase hex/
        },
        {
            name: 'checkout silently follows event SHA',
            mutate: (source) => mutateOnce(source, 'ref: ${{ steps.candidate.outputs.sha }}', 'ref: ${{ github.sha }}',
                'ref: ${{ github.sha }}'),
            expected: /checkout ref must be the validated candidate/
        },
        {
            name: 'empty explicit input falls back with boolean OR',
            mutate: (source) => mutateOnce(source,
                'REQUESTED_CANDIDATE_SHA: ${{ inputs.candidate_sha }}',
                'REQUESTED_CANDIDATE_SHA: ${{ inputs.candidate_sha || github.sha }}',
                'inputs.candidate_sha || github.sha'),
            expected: /fail-open candidate fallback/
        },
        {
            name: 'resolver tests input value instead of input-key presence',
            mutate: (source) => mutateOnce(source,
                `contains(toJSON(inputs), '"candidate_sha"')`,
                "inputs.candidate_sha != ''",
                "inputs.candidate_sha != ''"),
            expected: /distinguish an absent input key/
        },
        {
            name: 'resolved HEAD proof removed',
            mutate: (source) => mutateOnce(source, 'actual_sha="$(git rev-parse HEAD)"',
                'actual_sha="$CANDIDATE_SHA"', 'actual_sha="$CANDIDATE_SHA"'),
            expected: /missing HEAD resolution proof/
        },
        {
            name: 'candidate checkout history is shallow',
            mutate: (source) => mutateOnce(source, 'fetch-depth: 0', 'fetch-depth: 1', 'fetch-depth: 1'),
            expected: /requires full checkout history/
        },
        {
            name: 'remote main tracking ref is replaced',
            mutate: (source) => mutateOnce(source, "refs/remotes/origin/main^{commit}",
                'refs/heads/main^{commit}', 'refs/heads/main^{commit}'),
            expected: /resolve origin\/main as a commit/
        },
        {
            name: 'remote main commit proof is removed',
            mutate: (source) => mutateOnce(source, 'git cat-file -e "$remote_main_sha^{commit}"',
                ':', 'remote_main_sha="$(git rev-parse'),
            expected: /prove the origin\/main commit exists/
        },
        {
            name: 'merge-base is replaced with a parent shortcut',
            mutate: (source) => mutateOnce(source,
                'base_sha="$(git merge-base "$remote_main_sha" "$CANDIDATE_SHA")"',
                'base_sha="$(git rev-parse "$CANDIDATE_SHA^")"', 'rev-parse "$CANDIDATE_SHA^"'),
            expected: /derive its merge-base/
        },
        {
            name: 'merge-base ancestry proof is removed',
            mutate: (source) => mutateOnce(source,
                'git merge-base --is-ancestor "$base_sha" "$CANDIDATE_SHA"', ':', 'if [ -z "$base_sha"'),
            expected: /prove merge-base ancestry/
        },
        {
            name: 'candidate-range command falls back to clean worktree',
            mutate: (source) => mutateOnce(source,
                'git diff --check "$base_sha" "$CANDIDATE_SHA" --', 'git diff --check', 'git diff --check'),
            expected: /candidate-range whitespace gate must use the derived merge-base/
        },
        {
            name: 'event before is used as a whitespace base',
            mutate: (source) => mutateOnce(source,
                'git diff --check "$base_sha" "$CANDIDATE_SHA" --',
                'git diff --check "${{ github.event.before }}" "$CANDIDATE_SHA" --', 'github.event.before'),
            expected: /must not use HEAD\^, event bases, or a hard-coded baseline/
        },
        {
            name: 'hard-coded whitespace baseline is used',
            mutate: (source) => mutateOnce(source,
                'git diff --check "$base_sha" "$CANDIDATE_SHA" --',
                `git diff --check ${'a'.repeat(40)} "$CANDIDATE_SHA" --`, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
            expected: /must not use HEAD\^, event bases, or a hard-coded baseline/
        },
        {
            name: 'empty tree is used as a whitespace base',
            mutate: (source) => mutateOnce(source,
                'git diff --check "$base_sha" "$CANDIDATE_SHA" --',
                'git diff --check 4b825dc642cb6eb9a060e54bf8d69288fbee4904 "$CANDIDATE_SHA" --',
                '4b825dc642cb6eb9a060e54bf8d69288fbee4904'),
            expected: /must not compare against an empty tree/
        },
        {
            name: 'merge-base allows an empty fallback',
            mutate: (source) => mutateOnce(source,
                'base_sha="$(git merge-base "$remote_main_sha" "$CANDIDATE_SHA")"',
                'base_sha="$(git merge-base "$remote_main_sha" "$CANDIDATE_SHA" || true)"', '|| true'),
            expected: /must not use an empty-range fallback/
        },
        ...[
            ['exact npm selector', 'npm install --global npm@10.9.8 --ignore-scripts --no-audit --no-fund',
                'npm --version', /exact npm selector gate/],
            ['lockfile install gate', 'npm ci --ignore-scripts --no-audit --no-fund',
                'npm --version', /lockfile install gate/],
            ['syntax gate', 'npm run check:syntax', 'node --version', /syntax gate/],
            ['focused fail-closed gate', 'node --test tests/unit/js/s3a-workflow-contracts.test.js',
                'node --test tests/unit/js/validation-gates.test.js', /focused fail-closed/],
            ['aggregate test gate', 'npm test', 'npm --version', /aggregate JavaScript\/Python test gate/],
            ['production audit gate', 'npm audit --omit=dev --audit-level=moderate', 'npm --version', /production audit gate/],
            ['repository safety gate', 'npm run check:repository-safety', 'npm --version', /repository-safety gate/],
            ['whitespace gate', 'git diff --check', 'git status --short', /whitespace gate/]
        ].map(([name, command, replacement, expected]) => ({
            name,
            mutate: (source) => mutateOnce(source, command, replacement, replacement),
            expected
        })),
        ...CI_REQUIRED_COMMANDS.flatMap(([command, label]) => [
            {
                name: `${label} is skipped with if false`,
                mutate: (source) => injectStepControlForCommand(source, command, 'if: ${{ false }}'),
                expected: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} must not have a skippable if`)
            },
            {
                name: `${label} continues on error`,
                mutate: (source) => injectStepControlForCommand(source, command, 'continue-on-error: true'),
                expected: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} must not continue on error`)
            }
        ])
    ];

    for (const mutation of cases) {
        await t.test(mutation.name, () => {
            assertRejected(validateCi(mutation.mutate(WORKFLOWS.ci)), mutation.expected);
        });
    }
});

test('deploy trigger, transport, credential, command, and boundary mutations are rejected in memory', async (t) => {
    const pinnedSyntheticRef = `appleboy/ssh-action@${'a'.repeat(40)}`;
    const cases = [
        {
            name: 'push trigger',
            mutate: (source) => mutateOnce(source, 'on:\n', 'on:\n  push:\n    branches: [main]\n', 'branches: [main]'),
            expected: /unexpected trigger set/
        },
        {
            name: 'scheduled trigger',
            mutate: (source) => mutateOnce(source, 'on:\n', 'on:\n  schedule:\n    - cron: synthetic\n', 'cron: synthetic'),
            expected: /unexpected trigger set/
        },
        {
            name: 'SSH action',
            mutate: (source) => mutateOnce(source, '    steps:\n',
                `    steps:\n      - name: Synthetic transport\n        uses: ${pinnedSyntheticRef}\n`, pinnedSyntheticRef),
            expected: /SSH\/VPS transport/
        },
        {
            name: 'VPS secret reference',
            mutate: (source) => mutateOnce(source, '    env:\n',
                '    env:\n      TARGET_HOST: ${{ secrets.SERVER_IP }}\n', 'secrets.SERVER_IP'),
            expected: /secrets are forbidden/
        },
        ...[
            ['remote HTTP command', 'curl https://example.invalid/status', /remote HTTP call/],
            ['mutable git pull command', 'git pull origin main', /mutable git pull/],
            ['Docker Compose command', 'docker compose up -d', /Docker Compose remote operation/],
            ['registry login command', 'docker login example.invalid', /registry login/],
            ['remote shell command', 'ssh synthetic-host true', /remote shell\/file transport/],
            ['deployment script', './deploy.sh', /deployment script/]
        ].map(([name, command, expected]) => ({
            name,
            mutate: (source) => mutateOnce(source, '        run: |\n',
                `        run: |\n          ${command}\n`, command),
            expected
        })),
        {
            name: 'production environment binding',
            mutate: (source) => mutateOnce(source, '    runs-on: ubuntu-latest\n',
                '    runs-on: ubuntu-latest\n    environment: production\n', 'environment: production'),
            expected: /deployment environments are forbidden/
        },
        {
            name: 'actual deploy job',
            mutate: (source) => mutateOnce(source, 'jobs:\n',
                'jobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./release-candidate\n',
                '  deploy:'),
            expected: /only the two reusable gates/
        },
        {
            name: 'candidate is not passed to reusable source gate',
            mutate: (source) => mutateOnce(source, 'candidate_sha: ${{ inputs.candidate_sha }}',
                'candidate_sha: ${{ github.sha }}', 'candidate_sha: ${{ github.sha }}'),
            expected: /must pass the explicit candidate_sha input/
        },
        {
            name: 'no-deploy operator boundary removed',
            mutate: (source) => mutateOnce(source, 'Production Candidate Preflight (NO DEPLOY)',
                'Production Release Ready', 'Production Release Ready'),
            expected: /name must unambiguously say/
        },
        {
            name: 'unnamed remote command step',
            mutate: (source) => mutateOnce(source, '    steps:\n',
                '    steps:\n      - run: ssh synthetic-host true\n', '- run: ssh synthetic-host true'),
            expected: /remote shell\/file transport/
        }
    ];

    for (const mutation of cases) {
        await t.test(mutation.name, () => {
            assertRejected(validateDeploy(mutation.mutate(WORKFLOWS.deploy)), mutation.expected);
        });
    }
});

test('image build, credential, isolation, scan, artifact, and cleanup mutations are rejected in memory', async (t) => {
    const buildAction = WORKFLOWS.image.match(/docker\/build-push-action@[0-9a-f]{40}/)[0];
    const loginAction = `docker/login-action@${'b'.repeat(40)}`;
    const cases = [
        ['push enabled', (source) => mutateOnce(source, '          push: false', '          push: true', 'push: true'),
            /build input push/],
        ['local load disabled', (source) => mutateOnce(source, '          load: true', '          load: false', 'load: false'),
            /build input load/],
        ['repository context widened', (source) => mutateOnce(source, '          context: .', '          context: ..', 'context: ..'),
            /build input context/],
        ...[
            ['Dockerfile path changed', 'file', './Dockerfile', './Containerfile'],
            ['target platform changed', 'platforms', 'linux/amd64', 'linux/arm64'],
            ['base refresh disabled', 'pull', 'true', 'false'],
            ['build cache enabled', 'no-cache', 'true', 'false'],
            ['implicit provenance enabled', 'provenance', 'false', 'true'],
            ['implicit SBOM enabled', 'sbom', 'false', 'true']
        ].map(([name, key, before, after]) => [name, (source) => mutateOnce(source,
            `          ${key}: ${before}`, `          ${key}: ${after}`, `${key}: ${after}`),
        new RegExp(`build input ${key}`)]),
        ...[
            ['Buildx version floats', 'version: v0.35.0', 'version: latest'],
            ['Buildx binary cache enabled', 'cache-binary: false', 'cache-binary: true'],
            ['Buildx cleanup disabled', 'cleanup: true', 'cleanup: false']
        ].map(([name, before, after]) => [name, (source) => mutateOnce(source, before, after, after),
            /setup-buildx must use exact version/]),
        ['build receives GitHub token', (source) => mutateOnce(source,
            "          github-token: ''", '          github-token: ${{ github.token }}', 'github-token: ${{ github.token }}'),
        /github-token/],
        ['second build action', (source) => mutateOnce(source, '      - name: Record and verify local image identity',
            `      - name: Synthetic second build\n        uses: ${buildAction}\n\n      - name: Record and verify local image identity`,
            'Synthetic second build'), /exactly one build-push action/],
        ['unnamed second build action', (source) => mutateOnce(source,
            '      - name: Record and verify local image identity',
            `      - uses: ${buildAction}\n\n      - name: Record and verify local image identity`,
            `- uses: ${buildAction}`), /exactly one build-push action/],
        ...[
            ['build secret input', 'secrets', 'synthetic=${{ env.SYNTHETIC_VALUE }}'],
            ['build secret-env input', 'secret-envs', 'SYNTHETIC_VALUE'],
            ['build secret-file input', 'secret-files', 'synthetic=/tmp/nonexistent'],
            ['build SSH forwarding input', 'ssh', 'default']
        ].map(([name, key, value]) => [name, (source) => mutateOnce(source, '          context: .\n',
            `          context: .\n          ${key}: ${value}\n`, `${key}: ${value}`),
        new RegExp(`build input ${key}`)]),
        ...[
            ['registry output exporter', 'outputs', 'type=registry,name=example.invalid/synthetic:local'],
            ['registry cache exporter', 'cache-to', 'type=registry,ref=example.invalid/synthetic:cache'],
            ['unreviewed build arguments', 'build-args', 'SYNTHETIC=true'],
            ['unreviewed attestation input', 'attests', 'type=provenance']
        ].map(([name, key, value]) => [name, (source) => mutateOnce(source, '          context: .\n',
            `          context: .\n          ${key}: ${value}\n`, `${key}: ${value}`),
        /exact audited input-key allowlist/]),
        ['registry login action', (source) => mutateOnce(source, '      - name: Record and verify local image identity',
            `      - name: Synthetic registry login\n        uses: ${loginAction}\n\n      - name: Record and verify local image identity`,
            'Synthetic registry login'), /registry login is forbidden/],
        ['unnamed registry login action', (source) => mutateOnce(source,
            '      - name: Record and verify local image identity',
            `      - uses: ${loginAction}\n\n      - name: Record and verify local image identity`,
            `- uses: ${loginAction}`), /registry login is forbidden/],
        ['registry credential input', (source) => mutateOnce(source, '          context: .\n',
            '          context: .\n          username: ${{ vars.SYNTHETIC_USER }}\n', 'username: ${{ vars.SYNTHETIC_USER }}'),
        /registry credential inputs/],
        ...[
            ['privileged container', '--privileged', /privileged access/],
            ['added capability', '--cap-add NET_ADMIN', /cap-add access/],
            ['host port publication', '--publish 3000:3000', /host port access/],
            ['host bind mount', '--mount type=bind,source=/tmp,target=/app/input', /host mount access/],
            ['host network', '--network host', /host network access/]
        ].map(([name, flag, expected]) => [name, (source) => mutateOnce(source, '          docker run --detach \\\n',
            `          docker run --detach \\\n            ${flag} \\\n`, flag), expected]),
        ...[
            ['local-only pull policy removed', '--pull never', '--pull always'],
            ['network isolation removed', '--network none', '--network bridge'],
            ['capability drop removed', '--cap-drop ALL', '--cap-drop NET_RAW'],
            ['no-new-privileges removed', '--security-opt no-new-privileges', '--security-opt label=disable'],
            ['PID limit removed', '--pids-limit 512', '--pids-limit -1'],
            ['input tmpfs boundary changed', '--tmpfs /app/input:rw,nosuid,nodev,noexec,size=64m',
                '--tmpfs /app/input:rw,size=1g'],
            ['output tmpfs boundary changed', '--tmpfs /app/output:rw,nosuid,nodev,noexec,size=64m',
                '--tmpfs /app/output:rw,size=1g']
        ].map(([name, before, after]) => [name, (source) => mutateOnce(source, before, after, after),
            /docker run must retain isolation flag/]),
        ['smoke gate is skipped', (source) => mutateOnce(source,
            '        id: smoke_gate\n        shell: bash',
            '        id: smoke_gate\n        if: ${{ false }}\n        shell: bash',
            'id: smoke_gate\n        if: ${{ false }}'), /smoke_gate must not have a skippable if/],
        ['smoke gate continues on error', (source) => mutateOnce(source,
            '        id: smoke_gate\n        shell: bash',
            '        id: smoke_gate\n        continue-on-error: true\n        shell: bash',
            'id: smoke_gate\n        continue-on-error: true'), /smoke_gate must not continue on error/],
        ['broad Docker prune', (source) => mutateOnce(source, '          set -u\n',
            '          set -u\n          docker system prune --force\n', 'docker system prune --force'),
        /broad Docker prune/],
        ['unnamed broad prune step', (source) => mutateOnce(source,
            '      - name: Remove only this run\'s container and local image',
            '      - run: docker image prune --force\n\n      - name: Remove only this run\'s container and local image',
            '- run: docker image prune --force'), /broad Docker prune/],
        ['unnamed docker login step', (source) => mutateOnce(source,
            '      - name: Record and verify local image identity',
            '      - run: docker login example.invalid\n\n      - name: Record and verify local image identity',
            '- run: docker login example.invalid'), /registry login is forbidden/],
        ...[
            ['shell docker push', 'docker push local/synthetic:test'],
            ['shell imagetools publication', 'docker buildx imagetools create local/synthetic:test'],
            ['shell compose push', 'docker compose push']
        ].map(([name, command]) => [name, (source) => mutateOnce(source,
            '      - name: Record and verify local image identity',
            `      - run: ${command}\n\n      - name: Record and verify local image identity`,
            `- run: ${command}`), /shell-based registry publication/]),
        ['workspace-relative evidence directory', (source) => mutateOnce(source,
            'evidence_dir="$RUNNER_TEMP/$EVIDENCE_SUBDIR"',
            'evidence_dir="$GITHUB_WORKSPACE/$EVIDENCE_SUBDIR"',
            'evidence_dir="$GITHUB_WORKSPACE/$EVIDENCE_SUBDIR"'), /unique runner\.temp subdirectory/],
        ['pre-existing evidence path accepted', (source) => mutateOnce(source,
            '[ -e "$evidence_dir" ] || [ -L "$evidence_dir" ]',
            '[ -z "$evidence_dir" ]', '[ -z "$evidence_dir" ]'), /pre-existing or symlinked evidence/],
        ['trusted Syft config is not workflow-created empty', (source) => mutateOnce(source,
            ': > "$evidence_dir/syft.yaml"', 'touch "$evidence_dir/syft.yaml"',
            'touch "$evidence_dir/syft.yaml"'), /workflow-created empty Syft and Grype/],
        ['evidence export happens after config writes', (source) => mutateOnce(source,
            '          echo "EVIDENCE_DIR=$evidence_dir" >> "$GITHUB_ENV"\n          : > "$evidence_dir/syft.yaml"',
            '          : > "$evidence_dir/syft.yaml"\n          echo "EVIDENCE_DIR=$evidence_dir" >> "$GITHUB_ENV"',
            ': > "$evidence_dir/syft.yaml"\n          echo "EVIDENCE_DIR='),
        /exported immediately after trusted creation/],
        ['SBOM action falls back to implicit config discovery', (source) => mutateOnce(source,
            '          config: ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/syft.yaml\n', '',
            '          syft-version:'), /runner\.temp Syft config/],
        ['scanner falls back to implicit config discovery', (source) => mutateOnce(source,
            '          config: ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.yaml\n', '',
            '          severity-cutoff:'), /runner\.temp Grype config/],
        ['SBOM action receives GitHub token', (source) => mutateStringOccurrence(source,
            "          github-token: ''", 2, '          github-token: ${{ github.token }}',
            'github-token: ${{ github.token }}'), /SBOM token/],
        ['SBOM dependency snapshot enabled', (source) => mutateOnce(source,
            'dependency-snapshot: false', 'dependency-snapshot: true', 'dependency-snapshot: true'), /SBOM token/],
        ['SBOM release upload enabled', (source) => mutateOnce(source,
            'upload-release-assets: false', 'upload-release-assets: true', 'upload-release-assets: true'), /SBOM token/],
        ['scanner database cache enabled', (source) => mutateOnce(source,
            'cache-db: false', 'cache-db: true', 'cache-db: true'), /database cache disabled/],
        ['scanner hides unfixed vulnerabilities', (source) => mutateOnce(source,
            'only-fixed: false', 'only-fixed: true', 'only-fixed: true'), /scanner input only-fixed/],
        ['scanner accepts unreviewed VEX input', (source) => mutateOnce(source,
            '          image: ${{ steps.candidate.outputs.image_ref }}\n          fail-build: false',
            '          image: ${{ steps.candidate.outputs.image_ref }}\n          vex: synthetic-vex.json\n          fail-build: false',
            'vex: synthetic-vex.json'), /scanner with mapping must contain only the exact audited input-key allowlist/],
        ['scanner output leaves runner temp', (source) => mutateOnce(source,
            '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/grype.json',
            '${{ github.workspace }}/grype.json', '${{ github.workspace }}/grype.json'),
        /scanner output must use exact runner\.temp/],
        ['SBOM scans a different image', (source) => mutateStringOccurrence(source,
            '${{ steps.candidate.outputs.image_ref }}', 2, 'local/synthetic:sbom', 'local/synthetic:sbom'),
        /SBOM must inspect/],
        ['scan action targets a different image', (source) => mutateStringOccurrence(source,
            '${{ steps.candidate.outputs.image_ref }}', 3, 'local/synthetic:scan', 'local/synthetic:scan'),
        /scan must inspect/],
        ['high and critical gate bypassed', (source) => mutateOnce(source,
            'counts.high > 0 || counts.critical > 0', 'false', 'if (false)'),
        /scan_gate must fail verified high\/critical/],
        ['scan gate is skipped', (source) => mutateOnce(source,
            "        if: ${{ always() && steps.scan.outcome != 'skipped' }}",
            '        if: ${{ false }}', 'id: scan_gate\n        if: ${{ false }}'),
        /scan_gate must have the exact always\/non-skipped condition/],
        ['scan gate continues on error', (source) => mutateOnce(source,
            '        id: scan_gate\n        if:',
            '        id: scan_gate\n        continue-on-error: true\n        if:',
            'id: scan_gate\n        continue-on-error: true'), /scan_gate must not continue on error/],
        ['artifact retained too long', (source) => mutateOnce(source, 'retention-days: 7',
            'retention-days: 90', 'retention-days: 90'), /retention must be between/],
        ['artifact uploads broad directory', (source) => mutateOnce(source,
            '          path: |\n            ${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/image-identity.txt',
            '          path: |\n            .', '\n            .\n'), /broad directory artifact/],
        ['artifact upload reads from workspace', (source) => mutateOnce(source,
            '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/image-identity.txt',
            '${{ github.workspace }}/image-identity.txt', '${{ github.workspace }}/image-identity.txt'),
        /exact three runner\.temp evidence paths/],
        ['artifact upload permits parent-path exfil', (source) => mutateStringOccurrence(source,
            '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/sbom.spdx.json',
            2, '${{ runner.temp }}/${{ env.EVIDENCE_SUBDIR }}/../synthetic-link',
            '../synthetic-link'), /exact three runner\.temp evidence paths/],
        ['artifact name collides across reruns', (source) => mutateOnce(source,
            's3a-image-evidence-${{ steps.candidate.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
            's3a-image-evidence-${{ steps.candidate.outputs.sha }}',
            'name: s3a-image-evidence-${{ steps.candidate.outputs.sha }}'), /unique across candidate, run, and rerun/],
        ['artifact boundary loses always condition', (source) => mutateOnce(source,
            "        if: ${{ always() && steps.build.outcome == 'success' }}",
            "        if: ${{ steps.build.outcome == 'success' }}",
            "if: ${{ steps.build.outcome == 'success' }}"), /artifact boundary must use the exact always\/build-success/],
        ['artifact boundary is skipped with false', (source) => mutateOnce(source,
            "        if: ${{ always() && steps.build.outcome == 'success' }}",
            '        if: ${{ false }}', 'id: artifact_boundary\n        if: ${{ false }}'),
        /artifact boundary must use the exact always\/build-success/],
        ['artifact boundary continues on error', (source) => mutateOnce(source,
            '        id: artifact_boundary\n        if:',
            '        id: artifact_boundary\n        continue-on-error: true\n        if:',
            'id: artifact_boundary\n        continue-on-error: true'), /artifact boundary must not continue on error/],
        ['artifact boundary accepts a directory', (source) => mutateOnce(source,
            '!stat.isFile() || stat.isSymbolicLink()',
            '!stat.isDirectory() || stat.isSymbolicLink()', '!stat.isDirectory()'),
        /artifact boundary must require regular files/],
        ['artifact boundary accepts symlink files', (source) => mutateOnce(source,
            '!stat.isFile() || stat.isSymbolicLink()', '!stat.isFile()',
            'if (!stat.isFile() || stat.size'), /artifact boundary must reject symlink/],
        ['artifact boundary skips file realpath containment', (source) => mutateOnce(source,
            'path.dirname(fs.realpathSync(filePath)) !== actualRoot',
            'path.dirname(filePath) !== actualRoot', 'path.dirname(filePath) !== actualRoot'),
        /prove realpath containment/],
        ['artifact boundary drops upper size limit', (source) => mutateOnce(source,
            'stat.size <= 0 || stat.size > limit', 'stat.size <= 0',
            'stat.size <= 0) {'), /enforce file-size bounds/],
        ['artifact boundary parses only one JSON document', (source) => mutateOnce(source,
            "scan = JSON.parse(fs.readFileSync(path.join(actualRoot, 'grype.json'), 'utf8'));",
            "scan = fs.readFileSync(path.join(actualRoot, 'grype.json'), 'utf8');",
            "scan = fs.readFileSync(path.join(actualRoot, 'grype.json')"), /parse machine-readable JSON/],
        ['artifact upload bypasses boundary outcome', (source) => mutateOnce(source,
            "steps.artifact_boundary.outcome == 'success'", "steps.build.outcome == 'success'",
            "steps.build.outcome == 'success'"), /upload must be gated by successful artifact boundary/],
        ['cleanup loses always condition', (source) => mutateOnce(source,
            '      - name: Remove only this run\'s container and local image\n        if: ${{ always() }}',
            '      - name: Remove only this run\'s container and local image\n        if: ${{ success() }}',
            'if: ${{ success() }}'), /cleanup must use if: always/],
        ['cleanup targets another image', (source) => mutateOnce(source,
            'docker image rm --force "$IMAGE_REF"', 'docker image rm --force "$OTHER_IMAGE_REF"',
            'docker image rm --force "$OTHER_IMAGE_REF"'), /cleanup must target exact IMAGE_REF/],
        ['cleanup dereferences unset image ref', (source) => mutateOnce(source,
            '${IMAGE_REF:-}', '$IMAGE_REF', 'if [ -n "$IMAGE_REF" ]'),
        /guard an unset IMAGE_REF/],
        ['cleanup dereferences unset evidence directory', (source) => mutateOnce(source,
            '${EVIDENCE_DIR:-}', '$EVIDENCE_DIR', 'if [ -n "$EVIDENCE_DIR" ]'),
        /guard an unset EVIDENCE_DIR/]
    ];

    for (const [name, mutate, expected] of cases) {
        await t.test(name, () => {
            assertRejected(validateImage(mutate(WORKFLOWS.image)), expected);
        });
    }
});
