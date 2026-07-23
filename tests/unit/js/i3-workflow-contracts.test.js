'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/image-validation.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n?/g, '\n');
const SCOPED_KEYS = Object.freeze([
    ['SLICE_SERVICE_API_KEY', 'slice'],
    ['SLICE_SERVICE_API_KEY_PREVIOUS', 'slice'],
    ['PRICING_API_KEY', 'pricing'],
    ['PRICING_API_KEY_PREVIOUS', 'pricing'],
    ['ARTIFACT_API_KEY', 'artifact'],
    ['ARTIFACT_API_KEY_PREVIOUS', 'artifact'],
    ['OPERATIONS_API_KEY', 'operations'],
    ['OPERATIONS_API_KEY_PREVIOUS', 'operations']
]);

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

function commandEnvironment(command, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...command.matchAll(new RegExp(`--env "${escaped}=([^"\\r\\n]*)"`, 'g'))];
    assert.equal(matches.length, 1, `expected one container environment entry for ${name}`);
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
    const assignments = new Map([
        ['inert_slice_service_key', quotedAssignment(start, 'inert_slice_service_key')]
    ]);
    const values = SCOPED_KEYS.map(([name, audience]) => {
        const commandValue = commandEnvironment(command, name);
        const value = commandValue.startsWith('$')
            ? assignments.get(commandValue.slice(1))
            : commandValue;
        assert.equal(typeof value, 'string', `${name} must resolve from an inert local assignment`);
        assert.match(value, new RegExp(`^i5-validation-${audience}-`), name);
        assert.match(value, /^[\x20-\x7e]+$/, name);
        assert.ok(Buffer.byteLength(value, 'utf8') >= 32
            && Buffer.byteLength(value, 'utf8') <= 256, name);
        assert.doesNotMatch(value, /\$\{|\$\{\{/, name);
        return value;
    });
    assert.equal(new Set(values).size, SCOPED_KEYS.length,
        'every active and previous scoped credential must be distinct');
    assert.doesNotMatch(command, /--env "ADMIN_API_KEY=/,
        'legacy ADMIN_API_KEY is not a normal image-validation startup dependency');
    assert.doesNotMatch(source, /\$\{\{\s*secrets\./,
        'image validation must not use the GitHub secrets context');

    const variableReferences = [...start.matchAll(/\$inert_slice_service_key\b/g)];
    assert.equal(variableReferences.length, 1,
        'the inert slice credential may only flow into the container environment');
    assert.equal((source.match(new RegExp(values[0], 'g')) || []).length, 1,
        'the inert slice credential value must not be exposed outside its assignment');
    assert.doesNotMatch(start, new RegExp(
        '(?:echo|printf|notice|warning|error|summary|output|log)[^\\n]*\\$inert_slice_service_key',
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

function replaceEnvironmentValue(name, value) {
    return (lines) => lines.map((line) => line.includes(`--env "${name}=`)
        ? line.replace(new RegExp(`${name}=[^"]*`), `${name}=${value}`)
        : line);
}

test('hosted Image Validation supplies distinct bounded scoped rotation credentials', () => {
    validateWorkflow(WORKFLOW);
});

test('workflow contract rejects scoped service-credential weakening mutations', async (t) => {
    const cases = [
        ...SCOPED_KEYS.map(([name]) => [
            `missing ${name}`,
            withoutLineContaining(`--env "${name}=`)
        ]),
        ['cross-audience credential reused',
            replaceAssignment('inert_slice_service_key', 'i5-validation-pricing-active-260723-b1')],
        ['slice credential too short',
            replaceAssignment('inert_slice_service_key', 'i5-short')],
        ['slice credential contains non-printable bytes',
            replaceAssignment('inert_slice_service_key', `i5-validation-slice-${'\u007f'.repeat(20)}`)],
        ['legacy admin credential restored',
            replaceEnvironmentValue('OPERATIONS_API_KEY_PREVIOUS',
                'i5-validation-operations-previous-260723-d2" --env "ADMIN_API_KEY=legacy')],
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
