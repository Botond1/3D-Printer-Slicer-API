# I4 S2 resource/state envelope evidence

## Identity, scope, and result

- Evidence date: `2026-07-23` (`Europe/Budapest`).
- Exact baseline: `780d64dd786440cb80ddd4df38cb489c16070a07`.
- Branch: `codex/i4-s2-resource-state-envelope`.
- Candidate identity: uncommitted integrated worktree delta; no candidate commit
  SHA exists yet.
- Overall local result: `PASS_WITH_LIMITATION`.
- Hosted prerequisites: I3 Source Validation and Image Validation are green for
  exact baseline `780d64dd786440cb80ddd4df38cb489c16070a07`.
  Exact run URLs/IDs are not present in the repository evidence available to
  this documentation lane and must be supplied by the final integrator; none
  are invented here.
- Hosted candidate result: `PENDING_AUTHORIZED_PUSH/HOSTED_VALIDATION`.
- Deployment authorization/result: none; no deployment was authorized or
  performed.

This checkpoint implements the S2 application resource/state envelope,
artifact/pricing lifecycle, and repository container-runtime envelope. It does
not prove the live VPS, reverse proxy, production topology, egress policy,
deployment, or the exact uncommitted candidate in hosted validation.

## Implementation and control matrix

| Control | Result | Evidence and boundary |
| --- | --- | --- |
| Strict central resource policy | `PASS` | [`resource-policy.js`](../../../app/config/resource-policy.js) accepts only canonical positive decimal integers within inclusive bounds. Any invalid explicit resource value fails startup through one sanitized configuration error; omission uses the documented default. |
| Body and multipart lifetime | `PASS` | JSON/form limits are numeric bytes. Multipart upload has one total lifetime and stable HTTP 408 `UPLOAD_TOTAL_TIMEOUT`; timeout aborts the active write, closes admission, and preserves route-owned cleanup. |
| ZIP/3MF/SL1 policy | `PASS` | Entry count, declared/actual expanded bytes, per-entry bytes, compression ratio, path depth, regular-entry type, encryption, canonical/duplicate package parts, and archive identity are bounded. Stable failures are HTTP 400 `INVALID_SOURCE_ARCHIVE` or HTTP 413 `SLICE_RESOURCE_LIMIT_EXCEEDED`. |
| Model/profile/pricing/output/stat bounds | `PASS` | Model/intermediate files, generated artifacts, bounded text reads, profiles, pricing payloads, dimensions, time, material use, hourly rate, and total calculated price fail closed. Successful output requires a contained regular non-symlink allowed-type file with positive bounded size and finite positive required stats. Stable output/stat failures are HTTP 422 `INVALID_SLICE_OUTPUT` and `INVALID_SLICE_STATS`. |
| Job/artifact correlation | `PASS` | Collision-resistant `job-<32 hex>` and `artifact-<32 hex>` identifiers replace timestamp-only artifact identity. Successful slice responses return `job_id` and `artifact_id`; admin listings return them for validated managed artifacts. |
| Private artifact metadata | `PASS` | Dot-prefixed versioned metadata binds job ID, artifact ID, file name, state, byte count, file identity, and creation time. Metadata is excluded from admin listing/download output and ordinary bulk ZIP contents. |
| Retention, cleanup, and leases | `PASS_WITH_LIMITATION` | TTL, count, byte, partial-age, scan-entry, and scan-time policies evict only validated owned records. Active download leases block deletion; deletion markers block new leases. Startup cleans bounded managed artifacts and the dedicated scratch root. A bounded or failed scan cannot claim quota satisfaction. Live production retention effectiveness still depends on operator-selected limits and writable-volume capacity. |
| Pricing state and migration | `PASS_WITH_LIMITATION` | Primary state is `configs/pricing-state/pricing.json`; safe legacy `configs/pricing.json` is a read fallback and is migrated to the primary path. Writes use an exclusively created `0600` `.pricing-owned-<token>.tmp`, complete writes, file fsync, atomic rename, directory fsync where supported, and in-memory publication only after persistence succeeds. |
| Directory fsync nuance | `PASS_WITH_LIMITATION` | Unsupported directory-fsync platforms tolerate only documented `EINVAL`/`ENOTSUP`, plus Windows `EISDIR`/`EPERM`, after atomic rename. Any other post-rename directory-fsync failure propagates fail-closed, but rename cannot be rolled back without a journal/backup. Directory-entry crash durability is not guaranteed where directory fsync is unsupported. |
| Container filesystem and identity | `PASS_WITH_LIMITATION` | Final image content and native trees are root-owned/read-only; Compose uses `read_only`, drops all capabilities, enables no-new-privileges, binds loopback only, mounts profiles/config root read-only, overlays only pricing state writable, and requires positive numeric service UID/GID. Entrypoint checks exact UID/GID, `0700` owned writable binds/tmp, and non-writable canonical profile directories before starting Node. Host ownership preparation remains an operator prerequisite. |
| Container resources and exact-image validation | `PASS_WITH_LIMITATION` | Compose bounds tmpfs, PIDs, memory/swap, CPU, JSON logs, and stop grace. Static and exact-image runtime harnesses validate identity, mounts, resources, service behavior, cleanup, and idle graceful stop. The container lane did not build, run, pull, or remove local images/containers; Docker client/daemon availability alone is not runtime proof. |
| Orca abort and shutdown settlement | `PASS_WITH_LIMITATION` | Active Orca client-abort/no-output/no-orphan behavior is locally proven by the static/unit/runtime-envelope harness. Idle graceful stop/no-old-PID is proven by that harness. Exact active-job container stop orchestration is `NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`; it is not a pass. |

## Validation evidence

The following commands/results were supplied by the implementation, quality,
test, and container lanes for this uncommitted candidate. This documentation
lane did not rerun or reinterpret them:

| Exact command or lane command set | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` using exact npm `10.9.8` | `PASS`; clean install completed |
| `npm audit --audit-level=high` | `PASS`; zero vulnerabilities |
| `node --test tests/unit/js/slice-route-multipart-live.test.js` | `PASS` 24/24 |
| Pre-quality generated archive contract command set | `PASS` 5/5 |
| Combined focused S2/state/container command set | `PASS` 107/107 |
| Container/workflow lane command set | `PASS` 382/382 |
| Quality post-refactor focused command set | `PASS` 73/73 |
| Quality archive suite command set | `PASS` 6/6 |
| `node --test tests/unit/js/openapi.test.js` | `PASS` 5/5 |
| `node --check` over all 15 quality-owned JavaScript files | `PASS` 15/15 |
| `git diff --check` | `PASS` |

Quality decomposition evidence:

- `app/docs/swagger-docs.js`: 696 -> 44 lines.
- `app/routes/pricing.routes.js`: 311 -> 230 lines.
- `app/routes/system.routes.js`: 334 -> 119 lines.
- `app/services/artifact-store.js`: 304 -> 151 lines.
- `app/routes/slice.routes.js`: 308 lines, intentionally retained to preserve
  the proved settlement contract.
- Quality checklist: 17/23 -> 21/23.

## Environment-limited and deferred evidence

- Python integration: `NOT_RUN_ENVIRONMENT`. `127.0.0.1:3000` belonged to the
  unrelated `C:\tmp\rocket3d-f3-quote-followup` checkout, and this worktree had
  no `.env` with the required admin/slice keys. No Python runner executed and
  no Markdown report was generated or read.
- Exact active-job container stop:
  `NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`.
- Hosted exact uncommitted candidate:
  `PENDING_AUTHORIZED_PUSH/HOSTED_VALIDATION`.
- S4 private ingress, proxy-hop/CIDR and reverse-proxy timeout proof, VPS/runtime
  topology and capacity, subprocess/container egress controls, production
  secret delivery/rotation, S3b promotion/readiness/rollback, deployment, and
  production state remain `UNVERIFIED`.

## Residual risks

- The default 500 MiB upload/archive/model/output envelopes may still exceed
  the live host's safe capacity; no VPS or reverse-proxy measurement is claimed.
- Retention is local filesystem state, not a durable object-store/database
  design. Bounded cleanup fails closed but can leave owned records for a later
  pass after partial filesystem failures.
- A hard directory-fsync failure after rename cannot undo the rename without a
  journal or backup, and unsupported directory fsync weakens crash-durability
  guarantees.
- Native slicers remain in the API container network boundary; egress control
  remains S4/S5 work.

## Forbidden-side-effect confirmation

This lane made no source, test, Dockerfile, Compose, workflow, dependency,
lockfile, package-version, changelog, tag, release, image, container, registry,
PR, push, pull, SSH/VPS, hosted-action, or deployment mutation. No customer
fixture or secret was read or created. No deployment was authorized.
