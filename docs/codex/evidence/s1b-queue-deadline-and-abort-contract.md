# S1b queue deadline and abort contract evidence

## Status and scope

- Status: `BLOCKED` at the mandatory production dependency audit gate.
- Code baseline: `58dcf1065ff39b6da1ba72d0d9c910d788a843ab`.
- Work baseline: `1c90f9fb999a4e899a21da7caa2887666ab592d2`.
- Branch: `codex/s1b-queue-deadline-abort` in a clean linked worktree created from the exact work baseline.
- Origin: `https://github.com/Botond1/3D-Printer-Slicer-API.git`.
- The work baseline is exactly one direct prompt-only descendant of the code baseline.
- No commit or push was made because the prompt requires `STATUS: BLOCKED` and forbids push when a mandatory local gate fails.

The implementation remains inside the authorized S1b files. It does not change
`app/server.js`, native command execution, process-tree termination, subprocess
environment, workspace implementation, canonical knowledge, workflows,
containers, manifests, lockfiles, profiles, pricing, or Graphify repository
outputs.

## Graphify and direct source map

The baseline had no repository `graphify-out/graph.json`. A code-only Graphify
index was therefore generated outside the repository at
`C:\tmp\s1b-graphify-1c90f9f`: 98 code files, 1,161 nodes, and 2,465 edges.
The repository remained clean during this preflight step.

Direct source inspection established this ownership chain:

1. `app/routes/slice.routes.js` owns workspace allocation, upload, awaited
   handler settlement, and exactly-once cleanup in `finally`.
2. `app/services/slice.service.js` binds client disconnect state, admits the
   job by client key, and waits for queue plus response settlement.
3. `app/services/slice/queue.js` is the compatibility facade and typed mapping
   owner.
4. `app/services/slice/queue-scheduler.js` owns queued/active/settled state,
   deadlines, counters, the effective signal, and shutdown drain.
5. `processSlice` receives the exact effective signal as `options.signal` for
   S1c while the current pipeline remains otherwise unchanged.
6. `app/services/slice/response-lifecycle.js` prevents success/release after
   abort and cleans response/signal listeners.
7. The route cleanup runs only after the handler has safely settled.

## Old dequeue-only failure proof

An unchanged-baseline dynamic probe used one blocked active job, a 20 ms queue
wait limit, and an 80 ms observation point. It produced:

```text
{"afterDeadline":"pending","status":{"queueLength":1,"activeJobs":1,"maxConcurrent":1,"maxQueueLength":10,"maxQueuePerClient":10}}
{"afterDequeue":"SLICE_QUEUE_TIMEOUT","status":{"queueLength":0,"activeJobs":0,"maxConcurrent":1,"maxQueueLength":10,"maxQueuePerClient":10}}
```

This proves that the baseline timeout depended on a later dequeue attempt.

## Queue job state model

Each accepted job has one internal `AbortController` and one state:

- `queued`: exact array membership, queued counter ownership, deadline timer,
  and external abort listener;
- `active`: timer cleared, queued counter transferred once to active, task
  invoked with the internal effective signal;
- `settled`: timer/listeners removed and exactly one outer promise outcome.

Dequeue, deadline, and abort transitions mutate the state synchronously in one
JavaScript turn. A queued job is either removed/rejected or transferred to
active, never both. Survivor ordering remains FIFO.

## Deadline and counter contract

- Every accepted job creates its deadline timer immediately; immediate
  activation clears it.
- The timer aborts/removes the exact queued job independently of worker state.
- Timeout rejection remains typed `SliceQueueTimeoutError`, HTTP 503, and
  `SLICE_QUEUE_TIMEOUT`.
- Timers use optional `unref()` and are cleared on activation, timeout, abort,
  shutdown, and settlement.
- Queued and active per-client counters transfer or decrement exactly once.
- The dequeue elapsed-time check remains defense in depth.

## Abort, response, and workspace contract

`enqueueSliceJob(task, { queueKey, signal })` is backward compatible. The task
is invoked as `task(effectiveSignal)`. A pre-aborted external signal creates no
timer, listener, queue membership, or counter state. Queued abort removes and
rejects the job once. Active abort reaches the task immediately but keeps the
slot and active counter until the task promise actually settles. Abort wins over
a later task success; a post-settlement abort cannot rewrite the result.

`bindRequestAbort(req, res)` converts request `aborted`, relevant request/socket
errors, and unfinished response `close` into one idempotent signal. Normal
`finish` and a successfully finished `close` are not aborts. A normally
completed uploaded request may have `destroyed === true`; `complete === true`
plus a live socket distinguishes that parser lifecycle from a disconnect.
Every terminal path removes all installed listeners and the cached binding.

The service writes queue JSON only while the response is writable and the
request signal is not aborted. Response settlement is abort-aware, removes all
listeners, and prevents successful response/artifact release after abort. The
route-owned workspace cleanup remains exactly once and only after safe handler
settlement.

## Shutdown seam

`beginSliceQueueShutdown()` and its `shutdownSliceQueue()` alias are idempotent
and return the shared drain outcome. Shutdown rejects queued and later admitted
jobs with typed HTTP 503 `SLICE_QUEUE_SHUTDOWN`, aborts active effective
signals, and waits for actual active task settlement before resolving. No
`app/server.js` signal wiring is included in S1b.

## Dynamic and mutation evidence

Focused queue/request/route/output/source-contract execution passed 77/77.
It covers independent deadlines, exact queued removal, survivor FIFO,
timeout/dequeue and abort/dequeue outcomes, pre-abort, active-slot retention,
ignored-abort task success, late abort, request/socket/response events,
zero listener/timer residue, disconnected no-write, exactly-once delayed
workspace cleanup, shutdown admission/queued/active/drain behavior, legacy
mapping, and existing multipart/output contracts.

Twelve in-memory source mutations were rejected:

1. deadline timer removal;
2. timeout leaving the exact job queued;
3. terminal timer/listener cleanup removal;
4. queued-counter double decrement;
5. active abort forcing early settlement;
6. omission of the task `AbortSignal`;
7. accepting task success after abort;
8. disconnected response write;
9. reopening admission after shutdown;
10. starting queued work during shutdown;
11. route cleanup no longer awaiting safe settlement;
12. duplicated route cleanup.

The existing reject-then-run mutations for queue overflow and per-client cap
also remain detected.

## Local gates

- Exact npm: `10.9.8`.
- Clean install: `npm ci --ignore-scripts --no-audit --no-fund`, 175 packages,
  exit 0.
- Focused deterministic suites: 77/77, exit 0.
- Aggregate `npm test`: JavaScript 325/325 and Python 22/22, exit 0.
- Bundled Python: absolute `python.exe`, version 3.12.13.
- Changed JavaScript syntax: 10/10, exit 0.
- Complete tracked syntax after staging: JavaScript 69/69 and Python 25/25,
  exit 0.
- Instruction mirrors: 2/2, exit 0.
- Repository safety: 175 tracked indexed files and 11 non-empty staged files,
  exit 0.
- `git diff --check`: exit 0.
- Manifest and lockfile diff: empty.
- Production audit: **failed**, one HIGH finding.

The read-only 23-point quality/decomposition review improved the touched-area
score from 17/23 to 21/23 and found no blocking race, settlement, counter,
listener, public-contract, or decomposition defect. No service exceeds 300
lines, no source exceeds 500 lines, and no test exceeds 250 lines. The sole
over-60 enclosure is the 172-line `createQueueScheduler` factory; its
operational nested transition functions are each at most 52 lines. This is an
explicit accepted guardrail exception because the closure is the single mutable
state owner; a later responsibility must trigger lifecycle/state extraction
rather than extending the enclosure. The 236-, 245-, and 240-line tests must
also receive no further scenarios without a new focused file.

The failing audit is exact npm 10.9.8 with
`npm audit --omit=dev --audit-level=moderate`. The registry reports
`GHSA-3jxr-9vmj-r5cp` for locked `brace-expansion@2.1.0`. The production chain
is root `archiver@7.0.1` through `archiver-utils`/`zip-stream`, `glob` or
`readdir-glob`, and `minimatch`. The audit reports a fix, but manifest/lockfile
or dependency updates are explicitly forbidden in S1b. This must move to a
separate serialized `dependency-maintenance` checkpoint.

## Integration handoff

No new shared S1b/S3a-B1 baseline exists because the mandatory audit blocked
commit and push. The retained common code baseline is
`58dcf1065ff39b6da1ba72d0d9c910d788a843ab`; this uncommitted S1b tree must not
be treated as an integration checkpoint.

After dependency maintenance unblocks a validated S1b commit, I1 must:

- combine that exact S1b commit with the exact S3a-B1 checkpoint to create and
  name the new common baseline;
- wire `SIGTERM`/`SIGINT` in `app/server.js` to the idempotent queue shutdown
  seam and await drain without releasing active slots early;
- reconcile `AGENTS.md`, `docs/codex/project-map.md`,
  `docs/codex/security-model.md`, and `docs/codex/hardening-plan.md`;
- hand S1c the exact API `enqueueSliceJob(task, { queueKey, signal })`, where
  `task(effectiveSignal)` receives the sole queue-owned signal, active abort
  never releases capacity before task settlement, and abort beats later task
  success. S1c owns native TERM/KILL process-tree handling and child environment
  minimization.

## Forbidden side effects

No main push, target push, PR, merge, deploy, registry push, image promotion,
VPS/SSH, tag, release, production call, remote slicer call, customer model,
secret, Docker resource, native slicer, or foreign worktree mutation occurred.

## Architect override closure — dependency unblock

- Authorized dependency source checkpoint:
  `78693fe2902b033c0e6633dde8e09e568202743c`.
- Exact npm `10.9.8` production audit runs 1, 2, and 3 each reported
  `found 0 vulnerabilities` after the exact lockfile patch.
- Final S1b checkpoint disposition: `CHECKPOINT_PUSHED` upon the authorized
  single non-force target-branch push and exact remote-SHA verification.
