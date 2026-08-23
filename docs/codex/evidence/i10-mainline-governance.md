# I10 mainline integration and repository governance

## Checkpoint boundary

- Baseline: exact I9 SHA
  `200e4174766bed2562402661afb2bc9efa7834e3`.
- Target branch: `codex/i10-mainline-governance`.
- Pre-integration `main`:
  `899f1916437620ab536e912bf404d8da261cc37f`.
- Status at commit time: `PENDING_PR_AND_EXACT_MAIN_HOSTED_GATES`.
- This checkpoint authorizes repository integration and governance only. It
  cannot deploy, contact the VPS, create a release or Git tag, or publish an
  image.

## Direct and Graphify source map

The disposable Graphify corpus contained 305 supported files. The combined
AST/semantic graph contained 3,013 nodes, 5,537 edges and 160 communities. Its
query path connected the validation workflows, exact image gate, publication,
production Compose contract, staging rehearsal, bounded evidence and cleanup.
Graph health was not perfect: 735 dangling endpoint edges, 11 duplicate edges,
11 edges without `source_file`, and one unverified semantic node were reported.
Therefore executable workflow and test sources, not semantic enrichment, are
authoritative for this change. The disposable graph is not a repository
artifact.

The direct path is:

```text
pull request / merge queue / exact main push
  -> exact event candidate SHA
  -> read-only Source and Image jobs
  -> stable required-check contexts
  -> branch protection
  -> merge commit preserving I1-I9 ancestry
  -> exact post-merge main Source and Image validation
```

## Implemented workflow contract

- `.github/workflows/ci.yml` and
  `.github/workflows/image-validation.yml` target only pull requests to
  `main`, exact pushes to `main`, and merge-queue `checks_requested` events.
- Manual and reusable exact-SHA inputs remain available.
- Both event adapters accept only pull-request, push, or merge-group event
  SHAs when no explicit input key exists.
- Source validation uses the exact nonzero `github.event.before` commit for a
  `main` push, proves that commit exists and is an ancestor of the candidate,
  and checks that exact range. PR, merge-queue, manual and reusable calls retain
  the remote-main merge-base contract.
- Job names remain exactly `Validate exact source candidate (NO DEPLOY)` and
  `Build once, inspect, scan, and discard (NO DEPLOY)` so repository policy can
  bind stable GitHub Actions contexts.
- Global/job permissions remain `contents: read`; no registry, attestation,
  environment, deployment, SSH or VPS authority was added.

## Repository-policy bootstrap

Before any integration push, the live `main` branch was found unprotected and
still contained the historical automatic SSH/VPS deployment workflow. The
repository owner therefore installed a bootstrap protection rule before
integration:

- pull request required, zero approvals during single-owner bootstrap;
- administrators included;
- force pushes and deletion forbidden;
- conversation resolution required;
- no required contexts yet, because the new mainline contexts had not run on a
  pull request within the active policy window.

Merge commits are the sole enabled merge strategy during integration; squash
and rebase are disabled to preserve the 83-commit I1-I9 evidence ancestry.
After the I10 PR produces both exact contexts, the rule must be updated to
strictly require them before merge. A one-review rule cannot yet be enabled:
`Botond1` is the sole collaborator and GitHub does not allow self-approval.
This is classified `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`, not passed.

## Commit-time validation

- Exact npm selector: `10.9.8`.
- Focused workflow/dependency contract and mutation lane: 242/242 passed
  (237 workflow plus five dependency-lock observations).
- The online production audit exposed `GHSA-rgw5-rvv9-x895` in transitive
  `brace-expansion` 5.0.8. The lock now selects reviewed 5.0.9 with exact
  registry URL and SHA-512 integrity; downgrade/source/integrity mutations are
  rejected and the production audit reports zero vulnerabilities.
- Full JavaScript suite: 1,576/1,576 passed.
- Full Python suite: 43 discovered/run, 42 passed and one expected Windows
  POSIX-permission skip.
- JavaScript syntax: 187 tracked files plus the new dependency contract passed;
  Python syntax: 32 tracked files passed.
- Repository safety: 324 tracked files passed.
- `git diff --check`: passed.
- Instruction mirrors: 2/2 passed.
- Checksum-verified actionlint 1.7.12: all workflows passed; the temporary
  binary/archive/checksum directory was removed.
- Local Docker: `NOT_RUN_ENVIRONMENT`; this delta does not change image or
  runtime inputs and the hosted Image workflow remains mandatory.

The existing S3a workflow-contract test is already above the repository's
decomposition threshold. This narrow change reuses its fail-closed parser so a
second, divergent YAML policy parser is not introduced. Behavior-neutral
parser extraction is explicitly deferred to a separate stage rather than
mixed into governance integration.

## Hosted and final-policy exits

The following fields are intentionally pending until the branch is pushed and
merged:

- PR number and merge-candidate Source/Image run IDs;
- exact merge commit on `main`;
- exact-main Source/Image run IDs and Image evidence artifact;
- required-check/app-ID readback and final branch-protection readback;
- proof that no publication or deployment workflow ran.

These results may be reported in the final execution handoff or a later
canonical reconciliation commit. They must not be pre-claimed in this file.
