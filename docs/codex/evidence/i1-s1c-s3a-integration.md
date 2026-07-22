# I1 S1c/S3a integration evidence

Date: 2026-07-22

## Checkpoint identity

- Status: `I1_CHECKPOINT_BLOCKED_IMAGE`.
- Branch: `codex/i1-s1c-s3a-integration`.
- Runtime checkpoint: `995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`.
- This is a repository-only integration checkpoint. It is not production
  readiness, deployment permission, or evidence about the running VPS.

## Exact integration sequence

The cherry-pick equivalents are present in this exact order:

| Integrated commit | Exact source | Scope |
| --- | --- | --- |
| `a862e2c` | `78693fe` | serialized dependency patch |
| `4c7df9e` | `b91401e` | S3a-B1 liveness diagnostics and fail-closed aggregation |
| `7bc7946` | `edbe81c` | S3a-V1 bounded vulnerability triage |
| `6921f7a` | `fd93c0b` | S3a-B2 action runtime maintenance |
| `d1db7df` | `67a2922` | S1b queue deadline and abort contract |
| `89369d1` | `fd6f4f3` | S1c native lifecycle implementation |
| `2fee995` | `d1bc413` | S1c evidence |
| `896f3bf` | `d0d7dc3` | process settlement polling liveness fix |
| `995bb9d` | integration runtime commit | graceful runtime lifecycle wiring |

Dependency patch ID `5b593dee0baaa1437aedfd4892654bd90c971a4e`
occurs exactly once. Duplicate integration candidate `306b799` was not picked.

## Integrated lifecycle contract

- `SIGTERM` and `SIGINT` use one single-flight runtime shutdown promise.
  Repeated signals cannot start overlapping drains.
- Queue shutdown starts synchronously. It rejects later admission with typed
  HTTP 503 `SLICE_QUEUE_SHUTDOWN`, removes/rejects queued work, and aborts the
  effective signals of active work.
- HTTP admission closes and the lifecycle awaits both HTTP close and the queue
  drain. A failure in either drain is retained; signal listeners are removed at
  terminal settlement.
- Queued jobs have real deadline timers independent of worker availability.
  Dequeue-time expiry remains defense in depth.
- Active abort never releases its queue slot or per-client active counter before
  the task promise actually settles. Abort wins over a later task success.
- Request disconnect, queue deadline, queue shutdown, and command cancellation
  converge on one effective AbortSignal contract. Pre-abort and phase-boundary
  guards prevent new converter/slicer work after cancellation.
- Python and slicer commands retain exact executable/argument arrays and receive
  a tested minimal environment instead of the full API environment.
- Native cancellation targets the complete exact process tree. POSIX uses a
  detached process group with TERM, bounded grace, then KILL when still alive.
  Windows uses trusted absolute `System32\taskkill.exe` exact-PID tree requests,
  bounded verification, and forced escalation.
- An unverifiable process tree is fail-closed: command settlement and the queue
  slot remain retained rather than allowing overlapping native work.
- Cancellation cannot become a later success response or released artifact.
  Response listeners, request listeners, deadline/command timers, counters,
  workspace ownership, output custody, and process polling have deterministic
  cleanup/settlement coverage.

## Local validation

| Gate | Result |
| --- | --- |
| Clean lockfile install | `PASS`: 175 packages |
| Focused runtime + queue + native | `PASS`: 48/48 |
| Focused quality | `PASS`: 58/58 |
| Aggregate deterministic suite | `PASS`: JavaScript 457/457; Python 22/22 |
| Tracked syntax | `PASS`: 86 JavaScript; 25 Python |
| Repository safety | `PASS`: runtime stage 192 tracked / six staged; final 196 tracked; documentation stage five staged |
| Offline production audit | `PASS`: zero findings |
| Online production audit | `BLOCKED_POLICY` |
| `actionlint` | `NOT_RUN_ENVIRONMENT`: unavailable |
| Docker image/runtime | `NOT_RUN_ENVIRONMENT`: unavailable |

The transient Graphify service map covered 30 code files, 411 nodes, 767 edges,
and 15 communities. It contained 659 extracted and 108 inferred relations, with
no missing, dangling, self-loop, or duplicate relation edges. Transient output
was removed after inspection.

## Hosted exact-source evidence

Hosted S3a-B2 is bound to exact source commit `fd93c0b`:

- Source Validation run `29957927228`, job `89051575423`: `success`, with no
  annotations and no Node 20 warnings.
- Image Validation run `29957927370`, job `89051576245`: `failure`.
- Retained artifact ID: `8545008995`.
- Artifact digest:
  `sha256:c0c80f843cbea086eb4a8e6a293cd467254b8da67ae1c09b4e84d832a21d3bcc`.
- Image annotations: bounded liveness step exit 1, Grype HIGH, scanner
  classifier exit 1, and final enforcement gate exit 1.

Swiper 7.2.0 advisory `GHSA-hmx5-qpq5-p643` / `CVE-2026-27212` is the known
allowed advisory for bounded triage. It is not asserted to be the sole failure:
the persistent runtime liveness failure remains independently unresolved.
S3a-V2C's deterministic Swiper vendor upgrade is not integrated, and its
worktree and owned surfaces were untouched by I1.

## Remaining gates and forbidden side effects

Branch protection, required checks, immutable registry digest, signature,
attestation, promotion, S4, S3b, production readiness, VPS topology, deployed
identity, and running state are `UNVERIFIED`.

I1 performed no production deployment and grants none. It made no `main`
change, PR, merge, tag, release, VPS/SSH action, registry push, image promotion,
or production/customer call. Historical evidence files remain historical; this
record and the canonical current sections supersede their stage status without
rewriting them.
