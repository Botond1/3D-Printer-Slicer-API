# GPT-5.6-sol execution prompt — S1a upload workspace and multipart limits

You are the implementation agent for the standalone `3D-Printer-Slicer-API` repository. Work as a senior Node.js security engineer, filesystem-lifecycle designer, multipart specialist, and test architect. This is one lane of a deliberately parallel wave. A separate S3a agent may work from the same baseline on workflows and build provenance; respect the ownership boundary below.

## Objective

Implement S1a as one coherent runtime ownership boundary:

1. create a unique, contained job workspace before Multer persists any byte;
2. keep all request-owned upload and transient preprocessing artifacts inside that workspace wherever compatible;
3. guarantee idempotent cleanup after upload/parser failure, missing file, validation failure, queue rejection/expiry, processing failure, and successful completion;
4. configure explicit, evidence-based multipart limits, including `fieldNestingDepth: 0` for this API's verified flat field contract;
5. add narrowly contained startup stale-workspace audit plus a deletion primitive that remains disabled unless exclusive-lease and bounded-lifetime preconditions are proven;
6. preserve current public endpoints, the legacy `choosenFile` spelling, normal flat request options, response/status/error contracts, slicer arguments, queue scheduling, pricing, profiles, and final output behavior.

Do not implement real queue timers, client AbortSignal propagation, process-tree cancellation, subprocess environment minimization, artifact TTL/quota, service authentication, Docker/build changes, or deployment. Those belong to later stages.

## Baseline and parallel isolation

- Expected code baseline: `aaf7e1db295e74498ce7efdd990343d741c6d635`.
- Start from the clean architect prompt commit on top of that baseline. Record its exact `WORK_BASELINE`.
- The only allowed paths in `CODE_BASELINE..WORK_BASELINE` are:
  - `prompts/codex/S1a-upload-workspace-and-multipart-limits.md`
  - `prompts/codex/S3a-build-provenance-and-deploy-separation.md`
- Treat the architect prompt checkout as read-only. Create a new, verified-absent linked worktree on branch `codex/s1a-upload-workspace-lifecycle`, based exactly on `WORK_BASELINE`.
- Require an empty `git status --porcelain=v1 -uall`, exact branch/HEAD/root/remote, and the exact two-path baseline diff before audit or editing.
- If any preflight condition fails, stop. Never stash, clean, reset, overwrite, absorb, or delete unrelated work.
- Do not fetch, pull, push, open a PR, tag, release, deploy, contact the VPS, call a remote API/slicer, or modify the LeadPilot repository.

## Mandatory reading and fresh audit

Read completely before editing:

- root `AGENTS.md`, all three `docs/codex/**` knowledge files, and this prompt;
- applicable root/folder-local `CLAUDE.md` and `.github/instructions/**` files;
- `app/server.js`, `app/config/paths.js`, `app/config/constants.js`;
- `app/routes/slice.routes.js`, the global error handler and rate limiter;
- all of `app/services/slice.service.js` and `app/services/slice/**`;
- OpenAPI multipart definitions and `.env.example`;
- all current JavaScript/Python tests and validation runners;
- Multer 2.2.0's installed README and implementation for its storage cleanup and `fieldNestingDepth` semantics.

Verify actual field aliases, artifact paths, cleanup calls, middleware order, queue settlement, and output promotion from code. Do not assume the current roadmap is complete.

The dependency audit is green, but the application mitigation for `GHSA-72gw-mp4g-v24j` is not complete: the vendor advisory requires both Multer 2.2.0 and an explicit minimum `limits.fieldNestingDepth`. The current API consumes flat form keys only, so the expected limit is `0`; prove that from the parser/OpenAPI before setting it. The internal Multer rejection is `LIMIT_FIELD_NESTING`.

## Exclusive file ownership

This lane may edit only:

- `app/routes/slice.routes.js`;
- `app/services/slice.service.js` and narrowly affected `app/services/slice/**` modules;
- narrowly affected `app/config/**`, `app/middleware/errorHandler.js`, and `app/server.js` when required for limits, recovery, or stable error mapping;
- `.env.example` for new bounded settings;
- focused `tests/unit/js/**` files and tiny synthetic fixtures generated at runtime, except the S3a-owned `tests/unit/js/s3a-workflow-contracts.test.js`;
- `AGENTS.md` and exactly the three canonical files `docs/codex/project-map.md`, `docs/codex/security-model.md`, and `docs/codex/hardening-plan.md` for the architect corrections and S1a evidence described below.

Do not edit `.github/workflows/**`, `Dockerfile`, Compose, `.dockerignore`, `requirements.txt`, `package.json`, `package-lock.json`, profiles, pricing data, Python/native scripts, or deployment files. Do not add dependencies. The parallel S3a lane owns build/workflow surfaces.

If a necessary change crosses this boundary, stop and report the exact need instead of taking ownership.

## Workstream A — owned job-workspace primitive

Create a small, testable workspace module rather than spreading path logic across routes and services. Its design must satisfy all of the following:

- derive one fixed job-workspace root under the existing root-scoped `input/` runtime boundary;
- create each job directory with an unguessable server-generated identifier using `node:crypto`, never a user filename, IP address, timestamp alone, or request field;
- create a versioned ownership marker atomically inside the workspace before it is considered managed;
- use restrictive permissions where the platform supports them without breaking Windows tests;
- return an explicit workspace object/context and attach it to the request through a single internal seam;
- provide containment checks based on resolved paths and path-segment boundaries, not string-prefix folklore;
- reject or ignore symlink/reparse-point surprises without following them outside the root;
- provide exactly-once/idempotent cleanup. Cleanup may remove only a positively identified owned workspace and explicitly registered external candidate paths. An external candidate may receive deletion ownership only when registration proves it does not yet exist and it is a direct, server-generated child of `OUTPUT_DIR`; reject any existing path, nested path, symlink/reparse target, directory, or user-derived arbitrary path. After creation, delete only the exact owned regular non-symlink candidate. Never adopt or delete a pre-existing/foreign output;
- never recursively remove the input root, output root, an unresolved path, an unmarked directory, or a path supplied by the request;
- sanitize logs: job identifier and stable reason are sufficient; do not log original filenames, form values, secrets, or full host paths unnecessarily.

Prefer async filesystem operations on request paths. If a synchronous operation is retained for compatibility, justify it and prove it cannot broaden deletion scope.

All uploaded files, extracted archive content, converted/oriented/transformed models, and request-time profile copies should live under the job workspace after this stage. If a native engine requires a transient output directory, place it under the workspace when behavior permits. A final output candidate outside the workspace must be registered for removal before creation and released from cleanup ownership only after the successful response artifact is valid. Do not redesign the final artifact naming/correlation contract; S2 owns collision-resistant public artifact identity and retention.

## Workstream B — one route-level lifecycle owner

Refactor the two slice routes through one default-preserving upload/lifecycle controller or factory so there is exactly one `try/finally` ownership boundary around:

1. workspace allocation;
2. Multer parsing/persistence;
3. the existing Prusa/Orca queue-aware handler;
4. final workspace cleanup.

Requirements:

- rate-limit rejection must occur before workspace allocation;
- `upload.single('choosenFile')` and both endpoint paths remain unchanged externally;
- Multer/file-filter errors must pass into the existing global error contract only after cleanup has completed;
- the service handler must be awaited so queue full/per-client rejection, dequeue-time expiry, processing success, and processing error all settle before final cleanup;
- missing file, unsupported extension, option/profile/geometry errors, thrown errors, and response-writing failures cannot strand the workspace;
- cleanup is idempotent even if a lower layer already removed a transient file;
- do not add pre-upload queue reservations or change FIFO/cap/counter/dequeue behavior in S1a;
- do not clean a workspace early merely because the client disconnected; S1b will introduce the single AbortSignal and disconnect semantics. The job still owns cleanup when its current promise settles.

Remove scattered cleanup responsibility only when the new owner proves equivalent or stronger behavior. Avoid double responses and never hide the original API error with a cleanup exception.

## Workstream C — explicit multipart envelope

Build one validated limits resolver with conservative defaults and bounded environment overrides only for policy values that may safely vary. Inventory all legitimate concurrently usable flat fields before choosing values. Configure at least:

- existing `fileSize` behavior;
- fixed, non-configurable `files: 1`;
- finite `fields` and `parts` values sufficient for every documented normal request but not arbitrary extras;
- finite `fieldNameSize` and `fieldSize`;
- fixed, non-configurable `fieldNestingDepth: 0`, after proving no supported option requires bracket nesting.

Inspect the installed Multer 2.2.0 and Busboy 1.6.0 implementation before claiming a limit is enforced. In this baseline Busboy uses a fixed `MAX_HEADER_PAIRS = 2000` and does not consume Multer's `limits.headerPairs` as an application override. Document that actual fixed boundary; do not add a fake environment control or claim a lower value is enforced. A stronger header limit belongs to the later measured HTTP/parser envelope unless implementation evidence supports it.

Reject invalid/non-integer/non-positive environment values to safe defaults and impose hard upper bounds so configuration cannot silently restore `Infinity`. Document each setting in `.env.example` without placing secrets there.

Preserve successful flat-field behavior and current default options. Do not start rejecting unknown flat option names as a new API contract unless existing code already does so. Count/size/nesting limits are the security boundary.

Add these deterministic public API mappings for relevant Multer limit failures, while preserving existing mappings:

- `LIMIT_FIELD_NESTING` -> HTTP `400`, `UPLOAD_FIELD_NESTING_TOO_DEEP`;
- `LIMIT_FIELD_KEY` -> HTTP `400`, `UPLOAD_FIELD_NAME_TOO_LONG`;
- `LIMIT_FIELD_COUNT` -> HTTP `413`, `TOO_MANY_UPLOAD_FIELDS`;
- `LIMIT_FIELD_VALUE` -> HTTP `413`, `UPLOAD_FIELD_TOO_LARGE`;
- `LIMIT_PART_COUNT` -> HTTP `413`, `TOO_MANY_MULTIPART_PARTS`;
- `LIMIT_FILE_COUNT` -> HTTP `400`, `TOO_MANY_UPLOAD_FILES` when that Multer path is reachable;
- existing file-size `413` and unexpected-field behavior remain unchanged;
- no raw parser stack/message or attacker-controlled field content reaches the client/log.

## Workstream D — contained stale-workspace recovery

Add a recovery/audit function invoked after required directories exist and before the server listens. Automatic deletion is unsafe while upload duration is unbounded and rolling/parallel instances could share the same volume, so startup must default to audit/report-only. It must:

- inspect only immediate children of the dedicated job-workspace root;
- recognize ownership by both constrained directory naming and the versioned marker;
- use an injectable clock and configurable, bounded stale age;
- classify positively identified workspaces older than the threshold, but not delete them in the default startup mode;
- never follow symlinks/junctions or recurse into an unverified target;
- leave fresh, unmarked, malformed-marker, foreign, and out-of-root paths untouched;
- tolerate a per-entry inspection/cleanup failure with a sanitized warning and deterministic summary, without claiming the entry was removed;
- never scan/delete final `output/` artifacts or legacy root input files.

Expose deletion only behind an explicit programmatic mode that requires a verified exclusive single-writer lease for the shared workspace root and a hard minimum stale threshold greater than every bounded upload/queue/process lifetime plus safety margin. Because this stage does not yet bound total upload time and an older rolling instance would not participate in a new lease, do not enable destructive recovery from `server.js` in S1a. Unit tests may inject a synthetic exclusive lease and bounded lifetime to prove the deletion algorithm; production startup remains audit-only until the later lifecycle/resource gates make deletion safe.

Use temporary directories in tests. Do not run recovery against the repository's real runtime folders during validation.

## Workstream E — durable planning corrections

This lane owns the shared knowledge update for the parallel wave. Correct the current documents with precise wording:

1. State that S0.1 remediated the registry/audit findings, but application mitigation for deeply nested multipart fields remained pending until S1a configured and tested `fieldNestingDepth`. Update D-011 accordingly.
2. Add `fieldNestingDepth` to the multipart threat row and S1a exit criteria. After implementation, record the actual value and live test evidence.
3. Formally split the former S3/S4 cycle:
   - S3a: repository-only build/provenance and automatic-deploy separation;
   - S4: service auth, proxy/private ingress, and egress topology;
   - S3b: staging/promotion/readiness/rollback drill only after S4 evidence and separate explicit user/owner authorization.
4. Replace every `architect-approved risk decision` production bypass with `explicit human owner/user-approved, documented risk acceptance`. An agent cannot grant itself a production exception.
5. State that the manifest/lock freeze applies only to this S1a/S3a parallel wave. A newly discovered advisory gets a separate serialized `dependency-maintenance` checkpoint as sole owner.
6. State that parallel lanes return evidence, while the integrator owns canonical shared knowledge reconciliation after integration. S3a must not edit the same canonical files in parallel.

Do not mark S1a verified until every mandatory S1a gate is green. Do not mark S3a, S4, S3b, production topology, or promotion verified from this lane.

## Required test architecture

Use Node's built-in test runner and built-in HTTP/stream primitives; add no dependency. Production defaults must remain unchanged when test seams are unused.

### Pure/unit tests

Prove:

- workspace creation uniqueness, marker/version, containment, and path rejection;
- idempotent cleanup and no deletion of input root, output root, foreign/unmarked/fresh/symlink targets;
- external output registration rejects pre-existing, nested, foreign, symlink/reparse, and non-direct-child targets, while an exact newly owned candidate can be cleaned without affecting its neighbors;
- stale audit boundary, age threshold, injected clock, malformed marker, default non-deletion, exclusive-lease requirement, and conditional partial cleanup failure;
- bounded multipart config parsing, invalid override fallback, and hard caps;
- every transient path-producing helper resolves inside the supplied workspace.

### Live synthetic multipart tests

Run a minimal ephemeral local Express app using the real route upload middleware and real global error handler, with a fake downstream slicer handler. Generate multipart bytes yourself or with Node built-ins; do not call the real slicer and do not use private/customer fixtures.

At minimum cover:

- one tiny accepted file plus the full normal flat option set;
- `fieldNestingDepth: 0` rejecting `a[b]` through Multer's `LIMIT_FIELD_NESTING` path. Put a tiny file part before the nested field in at least one raw multipart case so the test proves already-persisted bytes are removed;
- too many fields, oversized field value, too many parts/files, oversized file, unexpected file field, unsupported extension, missing file, malformed/truncated multipart, and simulated aborted upload;
- queue full and per-client-cap rejections through an isolated/injected existing queue seam without changing queue semantics;
- downstream validation error, downstream throw, and successful fake completion.

For every request that can receive a response, assert the HTTP status/error code and then assert zero request-owned files/directories remain. A deliberately client-aborted socket has no response contract: assert the expected connection termination plus deterministic cleanup completion instead. Tests must wait on an explicit cleanup/event seam rather than sleeping and hoping. Prove that a successful fake request preserves only the explicitly released final artifact when that path is exercised.

### Adversarial mutation evidence

Using source variants or injected test seams—not edits left in the worktree—prove tests fail when:

- `fieldNestingDepth` is omitted or changed to `Infinity`/a positive nesting allowance;
- cleanup is skipped on one Multer error and on one queue rejection;
- cleanup target containment is weakened to a naive prefix;
- stale recovery accepts an unmarked or fresh directory;
- a transient profile/extraction path escapes the workspace.

Restore the clean implementation and rerun all gates.

## Validation gates

Run and report exact commands, exit codes, counts, and temporary-path cleanup:

1. clean exact preflight and allowed two-prompt baseline diff;
2. focused workspace, multipart, route-lifecycle, error-mapping, and recovery tests;
3. all adversarial mutation checks;
4. `git diff --check`;
5. complete tracked JS/Python syntax gates with non-zero counts;
6. full JavaScript and Python suites, then aggregate `npm test`;
7. tracked and non-empty staged repository-safety gates;
8. instruction-mirror consistency;
9. `npm ci --ignore-scripts --no-audit --no-fund` using npm 10.9.8, followed by the full test/syntax/safety gates again;
10. `npm audit --omit=dev --audit-level=moderate` remains green;
11. proof that repository `input/`, `output/`, profiles, pricing, and generated reports were not mutated;
12. final diff/stat/status review and clean post-commit worktree.

Because application code copied into the image changes, run a disposable local Docker build and synthetic health/startup smoke if a daemon is available. Use inert configuration and no real slicer/model. If unavailable, report `NOT_RUN_ENVIRONMENT` and keep the result as a local checkpoint, not promotion evidence. Hosted CI, branch protection, VPS, and production remain unverified.

## Commit and stop policy

Use at most three atomic local commits, each with a staged diff/safety review:

1. `feat: add contained slicer job workspaces`
2. `fix: enforce multipart limits and lifecycle cleanup`
3. `docs: record S1a lifecycle security evidence`

You may combine the first two only if their tests and ownership are inseparable. Do not commit a runtime change while a mandatory local gate is red. Never amend, rebase, squash, push, or open a PR.

Status meanings:

- `COMPLETED`: all mandatory gates plus available Docker build/startup smoke are green; commits exist and the worktree is clean. This still is not deploy authorization.
- `CHECKPOINT_COMMITTED`: all mandatory non-Docker local gates are green and safe commits exist, but the local Docker daemon, image build, or startup smoke is unavailable; report exact skips. Hosted CI remaining `UNVERIFIED` by itself does not prevent `COMPLETED`.
- `BLOCKED`: preflight unsafe or a mandatory code/local gate is red; do not make an unsafe commit.

## Required final report

Return exactly this structure in Hungarian:

```text
STATUS: COMPLETED | CHECKPOINT_COMMITTED | BLOCKED
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
COMMITS:
MODIFIED_FILES:
WORKSPACE_OWNERSHIP_DESIGN:
MULTIPART_LIMITS_AND_ERROR_MAPPING:
LIFECYCLE_CLEANUP_EVIDENCE:
STALE_RECOVERY_EVIDENCE:
ADVERSARIAL_MUTATION_EVIDENCE:
TESTS_AND_COUNTS:
DEPENDENCY_AUDIT:
DOCKER_EVIDENCE:
KNOWLEDGE_CORRECTIONS:
CONTRACT_PRESERVATION_PROOF:
UNRUN_OR_BLOCKED_GATES:
KNOWN_REMAINING_RISKS:
INTEGRATION_NOTES_FOR_S3A:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

The final forbidden-side-effects line must explicitly confirm: no push/PR/tag/release, no VPS/SSH/deploy, no remote/production API or slicer call, no customer/private model, no real secret, no LeadPilot change, no pricing/profile/final runtime artifact mutation, no workflow/Docker/manifest change, and no unrelated worktree damage. Report any disposable local server/container and exact cleanup separately.
