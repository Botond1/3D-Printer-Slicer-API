'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');
const SLICE_KEY_NAME = 'inert_slice_service_key';
const SLICE_KEY_ENV = 'SLICE_SERVICE_API_KEY';

function stepRange(lines, id) {
    const idIndex = lines.findIndex((line) => line === `        id: ${id}`);
    assert.notEqual(idIndex, -1, `missing workflow step: ${id}`);

    let start = idIndex;
    while (start >= 0 && !lines[start].startsWith('      - name:')) start -= 1;
    let end = idIndex + 1;
    while (end < lines.length && !lines[end].startsWith('      - name:')) end += 1;
    assert.notEqual(start, -1, `missing workflow step boundary: ${id}`);
    return { start, end };
}

function stepText(source, id) {
    const lines = source.split('\n');
    const { start, end } = stepRange(lines, id);
    return lines.slice(start, end).join('\n');
}

function continuedCommands(step) {
    const commands = [];
    let command = '';
    for (const line of step.split('\n')) {
        const trimmed = line.trim();
        if (!command && !/^docker\s+run(?:\s|$)/.test(trimmed)) continue;
        command += `${command ? ' ' : ''}${trimmed.replace(/\\$/, '').trimEnd()}`;
        if (!trimmed.endsWith('\\')) {
            commands.push(command);
            command = '';
        }
    }
    assert.equal(command, '', 'unterminated docker run command');
    return commands;
}

function quotedAssignment(step, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...step.matchAll(new RegExp(`^\\s*${escaped}="([^"\\r\\n]*)"\\s*$`, 'gm'))];
    assert.equal(matches.length, 1, `expected one quoted assignment for ${name}`);
    return matches[0][1];
}

function validateWorkflow(source) {
    const start = stepText(source, 'container_start');
    const serverStarts = continuedCommands(source)
        .filter((command) => command.includes('--detach') && !command.includes('--entrypoint'));
    assert.equal(serverStarts.length, 1, 'every hosted API startup must be identified exactly once');

    const command = serverStarts[0];
    assert.ok(continuedCommands(start).includes(command),
        'the hosted API startup must remain owned by container_start');
    const sliceValue = quotedAssignment(start, SLICE_KEY_NAME);
    const adminValue = quotedAssignment(start, 'inert_admin_key');

    assert.match(sliceValue, /^i3-image-validation-inert-slice-key-/,
        'slice startup credential must be an explicit inert validation value');
    assert.match(sliceValue, /^[\x20-\x7e]+$/,
        'slice startup credential must contain printable ASCII only');
    assert.ok(Buffer.byteLength(sliceValue, 'utf8') >= 32
        && Buffer.byteLength(sliceValue, 'utf8') <= 256,
    'slice startup credential must contain 32-256 bytes');
    assert.notEqual(sliceValue, adminValue, 'slice and admin startup credentials must be separate');
    assert.doesNotMatch(sliceValue, /\$\{|\$\{\{/,
        'slice startup credential must not resolve from an external context');

    assert.match(command, /--env "ADMIN_API_KEY=\$inert_admin_key"(?:\s|$)/);
    assert.match(command,
        /--env "SLICE_SERVICE_API_KEY=\$inert_slice_service_key"(?:\s|$)/);
    assert.doesNotMatch(source, /\$\{\{\s*secrets\./,
        'image validation must not use the GitHub secrets context');

    const variableReferences = [...start.matchAll(/\$inert_slice_service_key\b/g)];
    assert.equal(variableReferences.length, 1,
        'the inert slice credential may only flow into the container environment');
    assert.equal((source.match(new RegExp(sliceValue, 'g')) || []).length, 1,
        'the inert slice credential value must not be exposed outside its assignment');
    assert.doesNotMatch(start, new RegExp(
        `(?:echo|printf|notice|warning|error|summary|output|log)[^\\n]*\\$${SLICE_KEY_NAME}`,
        'i'
    ), 'the inert slice credential must never be logged or exported as evidence');
}

function mutateStep(source, id, transform) {
    const lines = source.split('\n');
    const { start, end } = stepRange(lines, id);
    const original = lines.slice(start, end);
    const changed = transform([...original]);
    assert.notDeepEqual(changed, original, `mutation made no change: ${id}`);
    return [...lines.slice(0, start), ...changed, ...lines.slice(end)].join('\n');
}

function withoutLineContaining(token) {
    return (lines) => lines.filter((line) => !line.includes(token));
}

function replaceAssignment(name, value) {
    return (lines) => lines.map((line) => line.trimStart().startsWith(`${name}=`)
        ? `${line.slice(0, line.length - line.trimStart().length)}${name}="${value}"`
        : line);
}

test('hosted Image Validation supplies one separate inert bounded slice credential', () => {
    validateWorkflow(WORKFLOW);
});

test('workflow contract rejects meaningful service-credential mutations', async (t) => {
    const cases = [
        ['missing slice credential',
            withoutLineContaining(`--env "${SLICE_KEY_ENV}=`)],
        ['admin credential reused',
            replaceAssignment(SLICE_KEY_NAME, 's3a-inert-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}')],
        ['slice credential too short',
            replaceAssignment(SLICE_KEY_NAME, 'i3-inert-short')],
        ['slice credential contains non-printable bytes',
            replaceAssignment(SLICE_KEY_NAME, 'i3-image-validation-inert-slice-key-\u007f0000000000000000')],
        ['slice credential value is exposed',
            (lines) => {
                const command = lines.findIndex((line) => line.trimStart().startsWith('docker run --detach'));
                assert.notEqual(command, -1);
                lines.splice(command, 0, '          echo "$inert_slice_service_key"');
                return lines;
            }]
    ];

    for (const [name, transform] of cases) {
        await t.test(name, () => {
            const mutated = mutateStep(WORKFLOW, 'container_start', transform);
            assert.throws(() => validateWorkflow(mutated));
        });
    }
});
