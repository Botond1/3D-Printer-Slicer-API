# I12 Wave 3 Hostinger production qualification

## Checkpoint boundary

- Status at this commit boundary:
  `I12_LOCAL_IMPLEMENTATION_VERIFIED; VPS_DARK_BASELINE_N1_VERIFIED; HOSTED_AND_N2_N3_PENDING`.
- Exact baseline and protected main:
  `65706e381b907c6ba09a8eba504af3adaacac86b`.
- Branch: `codex/i12-wave3-hostinger-production-qualification`.
- Baseline Source `32668796239`, Image `32668796232`, Candidate Publication
  `32669087688`, and automatic signed-main rehearsal `32669484893`: `SUCCESS`.
- Baseline signed candidate:
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:5d209de83d8ddd601fbda8232e6e40f9a641af6d31aa94e99e7c313715a6216c`.
- Baseline image config:
  `sha256:9aaffb89844a9d24b9d828811df0f778a665c099b8a687177d2543f11100966c`.
- Baseline SLSA/SPDX attestation IDs: `42462498` / `42462513`.
- No public router, customer request, LeadPilot change, registry mutation,
  production tag, release or main direct push is part of this checkpoint.

The older I11 corrective-pending prose in historical checkpoints is superseded
by the exact successful baseline above.

## Graphify-first and direct source map

Existing graph knowledge was consulted first. No new or unauthorized graph
output is retained. Direct executable sources were then used for the changed
paths:

```text
resource-policy.js / constants.js
  -> queue.js -> queue-scheduler.js
  -> native-runtime-status.js quarantine subscription
  -> artifact-store.js serialized post-promotion retention
  -> readiness.service.js queue invariant
  -> fresh /ready and operations readiness/metrics
  -> operations-authenticated /health/detailed samples
  -> queue_concurrency_test_runner.py
  -> exact-empty and postflight /admin/output-files inventory
  -> create-new queue report + cleanup manifest
  -> graceful production Compose stop and stopped-state proof
  -> i12-capacity-artifact-cleanup.js in the exact candidate image
  -> exact artifact/metadata absence
  -> same-digest API restart and repeated dark matrix
  -> socketless Traefik Compose/file-provider operator pack
  -> no-clobber router activation only after external approval proofs
```

## Authorized VPS characterization

The authorized host was reached only through SSH with the supplied dedicated
Ed25519 identity, strict task-owned `known_hosts`, and exact observed server
host key. No Hostinger account/hPanel login was required. No private key, API
credential, ACME content, service environment, full inspect or unbounded log is
recorded here.

Observed host metadata:

- Ubuntu 24.04, Linux 6.8, amd64;
- four AMD EPYC virtual CPUs;
- approximately 16 GiB RAM, no swap;
- approximately 205 GiB free ext4 storage at observation time;
- Docker 29.7.2, Compose 5.5.0, cgroup v2;
- `setpriv` 2.39.3, Python 3.12.3 and curl 8.5.0 available;
- host ports 22, 80 and 443 listening; UFW service present but enforcement
  observed inactive.

These are point-in-time host observations, not a capacity conclusion or
firewall acceptance.

## Dark baseline deployment proof

The baseline signed digest is dark-running as `3d-psa-backend-server` with:

- image reference equal to the immutable baseline digest;
- image and kernel service identity 999:999, resolved from the image rather
  than hardcoded into repository operation;
- non-root user, read-only root filesystem, capability drop and
  no-new-privileges;
- internal-only `slicer-api-private` attachment, no API host port and no default
  route;
- writable input/output/pricing-state surfaces owned 999:999 with mode 0700;
- read-only configs surface;
- healthy state, restart count zero and OOM false;
- four distinct external scoped credentials in a root-owned 0600 file, without
  content access or disclosure.

Bounded synthetic proof passed for liveness, public readiness, scoped
operations readiness, missing/wrong-key rejection, intended private peer and
denied peer. API and Node/Python native DNS/TCP/UDP egress were denied. One
synthetic Orca FDM slice and one synthetic Prusa FDM slice completed through
the production endpoints with valid job/artifact identities and outputs; their
artifacts, metadata and workspaces were exactly removed. Post-cleanup health,
readiness and managed-output count were clean. This proves only dark N=1
mechanics for small synthetic geometry.

## Queue and quarantine implementation

- `MAX_CONCURRENT_SLICES` remains default 1.
- Explicit startup values must be canonical positive decimals in inclusive
  range 1..3; empty, signed, zero-padded, fractional, exponent, unsafe or
  out-of-range values fail the startup resource policy.
- Pre-start module construction uses the safe default rather than accepting an
  invalid environment value.
- Factory-created schedulers cannot exceed three active native tasks.
- Native quarantine is synchronous and idempotent. It closes admission,
  rejects queued/new work with the existing shutdown contract, aborts active
  work, and retains active capacity until the task actually settles.
- Runtime availability is rechecked after potentially reentrant probes, so a
  quarantine callback cannot admit a job or report stale acceptance.
- A scheduler owns and releases its quarantine subscription exactly once only
  after terminal drain, including the already-quarantined synchronous-return
  case.
- Readiness requires nonnegative queue counters, max concurrency 1..3 and
  active jobs not above the configured maximum.
- Public readiness and authenticated operations readiness/metrics use fresh
  probes, so a warm five-second cache cannot mask native quarantine.
- Post-promotion retention requests execute as an ordered promise chain rather
  than sharing one stale single-flight result. Every concurrent promotion gets
  a later scan that includes it, and a rejected pass cannot poison the lane.

Public endpoints, response/error codes, FIFO behavior, per-client limits,
deadlines, graceful shutdown and native process-tree semantics are unchanged.

## Capacity producer and exact cleanup boundary

The black-box producer now requires:

- `--expected-max-concurrent` in 1..3;
- maximum three synthetic requests;
- required create-new `--cleanup-manifest` and `--report` paths;
- distinct slice, operations and artifact audience credentials;
- a root-started, `/usr/bin/env -i` credential-exec helper that reads four
  canonical root:root 0600 single-link files with `O_NOFOLLOW|O_CLOEXEC`,
  drops supplementary plus real/effective/saved UID/GID state, enables
  no-new-privileges, and directly execs absolute Python with exactly four
  environment entries while keeping every secret value out of argv and output;
- exact-empty authenticated managed-output inventory before load;
- fresh queue observations and the configured active peak;
- an observed queued peak whenever request count exceeds configured
  concurrency;
- all futures drained after worker failure; if the outer batch deadline leaves
  any worker unsettled, postflight inventory is not sampled and neither report
  nor cleanup manifest is published from the incomplete state;
- curl connect timeout 5 seconds, slice total timeout 180 seconds and Python
  subprocess timeout 185 seconds, with a retry-count-derived 190..570 second
  batch drain deadline and fixed nondisclosing timeout classifications;
- postflight artifact inventory reconciliation, including response transport
  loss;
- exact maximum-three unique job/artifact pairs in an 8 KiB versioned manifest;
- hardened parent, reparse/symlink, create-new, 0600 and no-clobber evidence
  publication, with committed-uncertain state preserved and reported nonzero.

The consumer:

- accepts no CLI arguments and refuses root;
- reads only `/run/i12-cleanup.json` and `/app/output`;
- requires POSIX manifest owner equal to runtime UID with exact mode 0600 and
  canonical output owner equal to runtime UID with exact mode 0700;
- loads artifact metadata and resource policy from the exact candidate image;
- preflights every pair before deletion and rechecks path, realpath, type,
  size, metadata and file identity at race boundaries;
- deletes only artifact then marker, and proves both absent;
- has no network, subprocess or generic cleanup surface;
- emits only `classification` and `deleted_count`.

Operational ordering is runner/postflight, graceful API stop, exact
`exited false 0 false` state, exact-image non-root/network-none cleanup,
absence proof, same-digest API restart and two repeated dark matrices. Cleanup
success never changes a failed qualification into a pass.

## Socketless Traefik operator pack

The pack pins
`traefik:v3.7.11@sha256:5203c3f39ca70de6790d964624e042463ffbd57715bc82be155cf224c0dd5144`.
It uses CLI static configuration plus the file provider only, with no Docker
provider or Docker Engine socket. It has a read-only root, no-new-privileges,
capability drop, bounded PID/RAM/CPU/logging, and a noexec 0700 tmpfs. The
dynamic directory is fail-closed unless it contains exactly the canonical
`.gitkeep`; the router template remains outside the mounted directory.

Before candidate proxy startup, the operator must inventory port ownership,
prove the existing proxy is dedicated, record exact restore metadata, stop it
with its grace period and prove both old listeners closed. The stopped old
container, exact image and external ACME volume remain intact. Router activation
requires approved DNS/caller/firewall/certificate proofs and uses a
same-filesystem no-clobber hard-link boundary. Disable preserves the live bytes
to a new private rollback path before atomically unlinking the dynamic route.
Any failure after the activation link is created attempts an exact inode-bound
unlink, directory fsync and dark-sentinel proof; an unprovable rollback has a
separate bounded uncertain classification. Capacity and cleanup exit codes
must both be exact zero after same-digest restart and two dark passes, before
Traefik can start.

The existing live Traefik is version 3.7.11 at the same exact digest, currently
host-networked with Docker discovery. It remains unchanged at this checkpoint.
An isolated exact-image, network-none, read-only, socketless CLI/file-provider
runtime smoke passed with no container/image/script residue. That smoke is not
the dark cutover.

## Local validation ledger

At the final implementation boundary before hosted execution:

- focused queue/retention/capacity/cleanup/operator suites: `340/340 PASS`;
- full JavaScript suite: `2064/2064 PASS`;
- full Python suite: `85` run, `84` pass and one expected Windows/POSIX
  permission skip;
- syntax: `216` JavaScript and `39` Python tracked files;
- repository safety: `368` final tracked indexed files, with staged batches of
  `15`, `10`, `9`, and `17` files;
- instruction mirrors: `2/2 PASS`; exact npm `10.9.8`; production dependency
  audit: `0` vulnerabilities; production and Traefik Compose normalization,
  operator CLI, and working-tree whitespace: `PASS`.

Quality/decomposition review found no remaining runtime blocker. The capacity
entrypoint is 281 lines after orchestration/reporting/manifest extraction;
`queue-scheduler.js` is 316 lines, `queue_concurrency_utils.py` is 563 lines,
and the static Hostinger operator validator is 797 lines. The latter two and
bounded scheduler/operator evaluators also exceed function-size guidance.
Further behavior-neutral splitting of these four surfaces is explicitly
deferred until after exact-SHA hosted proof: the current changes are
single-purpose and mutation-locked, while another pre-hosted decomposition
would change evidence anchors without reducing an observed runtime risk. No
new responsibility may be added to them before that split decision is revisited.

## Pending hosted and production exits

The following remain pending and must not be inferred from this checkpoint:

1. atomic local commits and target-branch non-force push;
2. exact-SHA hosted Source and Image validation, SBOM, Grype HIGH=0/CRITICAL=0,
   Swiper advisory zero, bounded evidence and cleanup;
3. protected PR/merge, new signed candidate publication, attestations,
   verification and automatic no-deploy rehearsal;
4. exact new-digest dark deployment with rollback identity retained;
5. N=1, N=2 and N=3 synthetic measurements with exact cleanup and resource
   evidence, followed by a conservative retained value;
6. dark socketless Traefik cutover with stopped-old and ACME continuity proof;
7. firewall policy, approved hostname/DNS, intended caller identity/CIDR and
   certificate/route acceptance;
8. monitoring, backup/recovery acceptance and real customer-workload capacity.

No public route is enabled by this document. Production completeness remains
`UNVERIFIED` until every applicable external exit is evidenced.
