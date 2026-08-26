'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const RUNBOOK_PATH = path.join(ROOT, 'ops', 'hostinger', 'RUNBOOK.md');
const CRON_PATH = path.join(ROOT, 'ops', 'hostinger', 'templates', 'docker-image-prune.cron');
const SAFE_CRON = '# J0 retention policy: prune only dangling images; retained runtime images use immutable local tags.\n'
    + '0 0 * * * root sleep $(shuf -i 0-21600 -n 1) && '
    + 'docker image prune -f --filter "until=24h" > /dev/null 2>&1\n';

function readText(target) {
    return fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
}

function section(source, heading, nextHeading) {
    const start = source.indexOf(heading);
    if (start === -1) return '';
    const end = nextHeading ? source.indexOf(nextHeading, start + heading.length) : -1;
    return source.slice(start, end === -1 ? source.length : end);
}

function collectRetentionSections(runbook) {
    return {
        tagPolicy: section(
            runbook,
            '### Immutable local retention tags',
            '### Active legacy sleeper preflight'
        ),
        sleeperPolicy: section(
            runbook,
            '### Active legacy sleeper preflight',
            '### Exact cron backup and atomic replacement'
        ),
        replacementPolicy: section(
            runbook,
            '### Exact cron backup and atomic replacement',
            '### Automation audit'
        ),
        auditPolicy: section(runbook, '### Automation audit', '## Required immutable inputs')
    };
}

function validatePruneCron(cron, errors) {
    if (cron !== SAFE_CRON) errors.push('image_prune_cron_not_exact');
    if (/\bdocker image prune\b[^\n]*(?:\s-a(?:\s|$)|\s--all(?:=|\s|$)|\s-[a-z]*a[a-z]*(?:\s|$))/m.test(cron)) {
        errors.push('image_prune_all_forbidden');
    }
    if (/\bdocker system prune\b/.test(cron)) errors.push('system_prune_forbidden');
}

function validateTagPolicy(runbook, tagPolicy, errors) {
    if (!/local\/rocket3d-slicer-api:retained-<full-lowercase-source-sha>/.test(tagPolicy)
        || !/signed current API image[\s\S]+signed rollback API image/.test(runbook)
        || !/never\s+retargeted/.test(tagPolicy)
        || !/STOP_RETENTION_TAG_RETARGET/.test(tagPolicy)
        || !/dangling\s+images only/.test(tagPolicy)) {
        errors.push('retention_tag_policy_missing');
    }
}

function validateSleeperPolicy(sleeperPolicy, errors) {
    if (!/active legacy sleeper/.test(sleeperPolicy)
        || !/STOP_ACTIVE_LEGACY_PRUNE/.test(sleeperPolicy)
        || !/Replacing a cron file does not cancel/.test(sleeperPolicy)) {
        errors.push('legacy_sleeper_preflight_missing');
    }
}

function validateReplacementPolicy(replacementPolicy, errors) {
    if (!/operator_private_backup_dir/.test(replacementPolicy)
        || !/cmp --silent -- "\$cron_target" "\$cron_backup"/.test(replacementPolicy)
        || !/mktemp -p \/etc\/cron\.d/.test(replacementPolicy)
        || !/mv -T -- "\$cron_staged" "\$cron_target"/.test(replacementPolicy)
        || !/atomic replacement boundary/.test(replacementPolicy)) {
        errors.push('cron_backup_atomic_replacement_missing');
    }

    if (!/weekly/.test(replacementPolicy)
        || !/default dangling-build-cache mode/.test(replacementPolicy)
        || !/docker builder prune -f/.test(replacementPolicy)) {
        errors.push('builder_prune_policy_missing');
    }
}

function validateAuditPolicy(auditPolicy, errors) {
    if (!/system cron directories/.test(auditPolicy)
        || !/systemd timers/.test(auditPolicy)
        || !/Hostinger template/.test(auditPolicy)
        || !/STOP_AUTOMATION_AUDIT_DRIFT/.test(auditPolicy)
        || !/one daily image-prune entry/.test(auditPolicy)
        || !/one weekly default dangling builder-prune entry/.test(auditPolicy)) {
        errors.push('automation_audit_policy_missing');
    }

    if (!/Docker `system prune` subcommand in every form/.test(auditPolicy)
        || !/image-prune all-image modes \(`-a` and `--all`\)/.test(auditPolicy)
        || !/registry push/.test(auditPolicy)
        || !/registry prune or deletion/.test(auditPolicy)) {
        errors.push('forbidden_maintenance_policy_missing');
    }
}

function validateRetentionContract({ runbook, cron }) {
    const errors = [];
    const policies = collectRetentionSections(runbook);
    validatePruneCron(cron, errors);
    validateTagPolicy(runbook, policies.tagPolicy, errors);
    validateSleeperPolicy(policies.sleeperPolicy, errors);
    validateReplacementPolicy(policies.replacementPolicy, errors);
    validateAuditPolicy(policies.auditPolicy, errors);
    return errors;
}

function replaceRequired(source, from, to) {
    assert.ok(source.includes(from), `missing mutation seam: ${from}`);
    return source.replace(from, to);
}

const ORIGINAL = {
    runbook: readText(RUNBOOK_PATH),
    cron: readText(CRON_PATH)
};

test('committed Hostinger image-retention policy and cron satisfy the W0 contract', () => {
    assert.deepEqual(validateRetentionContract(ORIGINAL), []);
});

test('broad prune and missing retention controls fail closed', async (t) => {
    const mutations = [
        ['image prune gains short all flag', {
            ...ORIGINAL,
            cron: replaceRequired(ORIGINAL.cron, 'image prune -f', 'image prune -af')
        }, 'image_prune_all_forbidden'],
        ['image prune gains long all flag', {
            ...ORIGINAL,
            cron: replaceRequired(ORIGINAL.cron, 'image prune -f', 'image prune -f --all')
        }, 'image_prune_all_forbidden'],
        ['image prune becomes system prune', {
            ...ORIGINAL,
            cron: replaceRequired(ORIGINAL.cron, 'docker image prune', 'docker system prune')
        }, 'system_prune_forbidden'],
        ['source-SHA retention tag policy is removed', {
            ...ORIGINAL,
            runbook: replaceRequired(
                ORIGINAL.runbook,
                'local/rocket3d-slicer-api:retained-<full-lowercase-source-sha>',
                'local/rocket3d-slicer-api:retained-current'
            )
        }, 'retention_tag_policy_missing'],
        ['exact cron backup proof is removed', {
            ...ORIGINAL,
            runbook: replaceRequired(
                ORIGINAL.runbook,
                'cmp --silent -- "$cron_target" "$cron_backup"',
                'true # backup comparison omitted'
            )
        }, 'cron_backup_atomic_replacement_missing'],
        ['automation audit stop policy is removed', {
            ...ORIGINAL,
            runbook: replaceRequired(
                ORIGINAL.runbook,
                'STOP_AUTOMATION_AUDIT_DRIFT',
                'AUTOMATION_AUDIT_IGNORED'
            )
        }, 'automation_audit_policy_missing']
    ];

    for (const [name, candidate, expectedError] of mutations) await t.test(name, () => {
        const errors = validateRetentionContract(candidate);
        assert.ok(errors.includes(expectedError), `${name}: ${errors.join(', ')}`);
    });
});
