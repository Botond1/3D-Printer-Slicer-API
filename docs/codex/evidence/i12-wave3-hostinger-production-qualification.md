# I12 Wave 3 Hostinger production qualification

## Checkpoint boundary

- Status at this commit boundary:
  `I12_API_F710_DARK_N1_VERIFIED;
  OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
  CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
- Exact deployed API image source checkpoint on protected main:
  `f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`.
- Protected operator main:
  `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8`, merged through PR `#5`.
- Operator-pack commits, separate from the API source:
  `7a490c150bb8c4c1ec6c22561421202152070fbc` then
  `1fe89d7508f5bbd59a75256ec43722f3f19ae1c2`.
- API Source `32749722709`, Image `32749722715`, Candidate Publication
  `32750334897`, and automatic signed-main rehearsal `32751148223`: `SUCCESS`.
- Operator-main Source `32804297840` and Image `32804297658`: `SUCCESS`.
- Exact signed API image:
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`.
- The operator-pack and evidence commits are not API-image sources. The live
  cutover retained the exact `f71069c` image without rebuild, relabel or registry
  publication.
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
  -> fresh detailed health without normal-cache replacement
  -> cached public/operations surfaces with live native-quarantine overlay
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
- Protected detailed health uses fresh probes without replacing the normal
  readiness cache. Public and authenticated operations surfaces retain the
  bounded cache but check live native status on every hit; quarantine overlays
  fail closed while an ordinary active job remains cached.
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
`.gitkeep`; the router template remains outside the mounted directory. The
corrective source additionally requires Compose `2.33.1+`, exact service
attachments with `traefik-ingress` `gw_priority: 1` and
`slicer-api-private` `gw_priority: 0`, and top-level ingress
`internal: false`. Runtime proof must observe priorities 1/0 and Traefik's
default route through ingress; ordinary `priority`, list order, missing, tied,
reversed, or extra network configuration fails closed.

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

### Historical first cutover failure

The first live socketless cutover failed closed. The pre-correction Compose
source omitted gateway priority, runtime inspect reported equal priority for
both attachments, and the private network became Traefik's default route. The
old dedicated Traefik was restored, the slicer route remained absent, and ACME
content remained byte-identical. The failed candidate stopped with exit zero
and the empty ingress network was retained for exact residual reconciliation.
These historical identities were later reconciled into the resumed successful
cutover described below; they were never authority for broad cleanup.

An independent validator predicate also rejected the correct configs bind:
Docker reported exact source/destination with `RW=false` and empty `Mode`.
That is effectively read-only, not a writable-mount defect. Corrective runtime
validation accepts only exact paths plus `RW=false`, with `Mode` either empty
or explicitly read-only; `RW=true`, missing, duplicate, or wrong-path mounts
remain rejected. Protected-main integration and the corrected dark cutover later
closed this checkpoint as described below.

Bounded post-failure host inventory on 2026-08-25:

- restored old proxy full ID:
  `673a657b0b240c1fa467e7358c956723cab29ad0bd2200c6f5903fdb0dad9d25`;
- stopped failed candidate full ID:
  `8568cf3722e5291c03cf76916f362fc056ffcfe769b3fcd85d3b9fc8f73e3fa6`,
  exit zero;
- retained empty ingress network full ID:
  `1bdeaaa7e84ba2fb2370cd7a3df964c8014dcb564524e2e69046c9c70af618f3`;
- public slicer route: absent; ACME file: root-owned mode 0600 and unchanged,
  with empty-file SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

The historical exact API identity was held in private run-owned evidence and
was re-read directly from the engine before later mutation. Cleanup required a
fresh exact-ID/label/image/state check; descriptive inventory was not deletion
authority.

### Corrected dark cutover and exact reconciliation

The corrected, resumable cutover completed on 2026-08-25 with these bounded
identities and observations:

- API container identity prefix
  `4f393b…` remained healthy at retained N=1 on only the internal private
  network, with the exact signed `f71069c` image, no host port and no default
  route;
- corrected Traefik full ID
  `91e043fbc05a55cac7f7b826a121581fc905975159a070c806a76c426bde7b57`
  is running and healthy, restart count zero and OOM false, on pinned engine
  digest `sha256:5203c3f39ca70de6790d964624e042463ffbd57715bc82be155cf224c0dd5144`;
- ingress network identity prefix
  `d612f324…` is an external, IPv6-disabled bridge; private network identity
  prefix `f7018efd…` is internal and IPv6-disabled. Traefik's exact runtime
  ingress/private `GwPriority` values are `1/0`, its sole IPv4 default route is
  through ingress, and it has no container IPv6 default route;
- Docker owns exactly one host listener for each port 80 and 443 on IPv4 and
  exactly one on IPv6. Host listener families do not imply container-network
  IPv6 or an active slicer router;
- the configs bind has exact source/destination and `RW=false`; the Docker socket
  is absent, the Docker provider is disabled, the file provider is the only
  provider, and the dynamic directory contains exactly `.gitkeep`;
- unknown-host HTTP redirects and unknown-host HTTPS returns 404 over both IPv4
  and IPv6. The public slicer route remains absent;
- old dedicated proxy full ID
  `673a657b0b240c1fa467e7358c956723cab29ad0bd2200c6f5903fdb0dad9d25`
  is intentionally retained stopped, with restart count zero and OOM false;
- the prior failed residual set was reconciled by exact identity; the corrected
  resumable cutover then established the current candidate/network identities.
  The root-private recovery directory is
  mode 0700 and retains only its bounded ACME snapshot, old-proxy ledger and
  `cutover-success.json`; broad cleanup and Docker prune did not occur.

The success record uses schema `i12-traefik-corrected-dark-cutover-v2`, is mode
0600, and has SHA-256
`15d491cab3465916b01cbc24a292cae9f3601ad8fdb48f7665a4334e61133057`.
The old-proxy ledger SHA-256 is
`95f3522258f5bea6ce7690d65138221d43bec62a151e7662f45caf5275056d6b`.
The exact empty ACME SHA-256 remains
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
A separate final read-only `i12-final-live-audit-v1` passed 30/30 checks. The
cutover helper, uploaded helper, audit temp and task-owned remote temp paths were
proved absent after use.

## Local validation ledger

At corrective operator-pack commit
`7a490c150bb8c4c1ec6c22561421202152070fbc` before hosted execution:

- focused operator contract/mutation suites: `166/166 PASS`;
- full JavaScript suite after documentation reconciliation: `2087/2087 PASS`;
- full Python suite: `85` run, `84` pass and one expected Windows/POSIX
  permission skip;
- syntax: `216` JavaScript and `39` Python tracked files;
- repository safety: `368` tracked indexed files and the exact staged source
  set;
- instruction mirrors: `2/2 PASS`; exact npm `10.9.8`; production dependency
  audit: `0` vulnerabilities; Traefik Compose source/render validation,
  operator/version CLI, and working-tree whitespace: `PASS`.

The local Docker daemon was unavailable. Runtime gateway/default-route and bind
representation proof was therefore not reported as locally green; protected
hosted validation and the bounded live VPS proof above supplied those exits.

Quality/decomposition review found no P0/P1 defect. The operator contract and
mutation suite remain above repository size guidance, but this correction adds
only same-domain gateway, version, mount and identity invariants. A behavior-
neutral split is explicitly deferred until after the live cutover to avoid
expanding an already mutation-locked correction. No unrelated responsibility
may be added before that decision is revisited.

## Protected operator integration closure

Corrective commit `7a490c150bb8c4c1ec6c22561421202152070fbc` and evidence
commit `1fe89d7508f5bbd59a75256ec43722f3f19ae1c2` reached protected main
`7c8aee0728fc8462c67b4c6d85636bffb7afcdf8` through PR `#5` without a
direct main push. Exact-main Source run `32804297840` and Image run
`32804297658` succeeded. The operator change did not trigger Candidate
Publication, registry mutation, deployment, or replacement of the running
`f71069c` API image.

## First hosted diagnostic and API corrective closure

The first target-branch checkpoint was exact SHA
`47253e4d90797049dc6be322d9525fbcbe1a1ecf`:

- Source run `32746427481`: `SUCCESS`;
- Image run `32746430314`: fail-closed with exact root classification
  `runtime_resource_contract_failure:abort_readiness_cache_replaced`;
- runtime identity, Orca smoke, private topology, SPDX SBOM, Grype, known Swiper
  advisory, bounded diagnostics and exact cleanup all passed;
- final liveness/evidence aggregation failed, so provenance and evidence upload
  were correctly skipped rather than reported as successful.

The failure was deterministic source behavior, not a runner retry condition.
The active-abort gate deliberately warms the normal readiness cache while idle,
observes active work through fresh detailed health, and requires the cached
public/operations state not to be replaced by that observation. I12 had routed
all readiness surfaces through fresh probes, violating that established
contract. The minimal corrective restores `getStatus()` on `/ready`,
`/operations/readiness`, and `/operations/metrics`; `/health/detailed` remains
fresh and cache-independent. Each cache hit still checks live native state and
returns a fail-closed quarantine overlay without replacing the cached ordinary
queue snapshot. Focused mutation/regression and full local suites are green;
the API corrective later merged at protected main
`f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`. Source `32749722709`, Image
`32749722715`, Candidate Publication `32750334897`, and automatic no-deploy
rehearsal `32751148223` succeeded. The signed `d50c72…` digest is the exact API
identity used for the dark host state described above.

## Completed operator exits and remaining public prerequisites

Completed exits are exact-SHA hosted Source/Image validation, protected-PR
integration, immutable operator checkout, identity-bound failed-cutover
reconciliation, corrected dark cutover, read-only config/topology/listener
proof, ACME continuity, bounded evidence, and exact task-owned cleanup.

The following remain pending and must not be inferred from this checkpoint:

1. firewall acceptance, approved hostname/DNS, intended caller identity/CIDR and
   certificate/route acceptance;
2. authenticated synthetic proof through the intended public hostname before
   any customer traffic;
3. monitoring, alerting, backup/recovery acceptance and a separately approved
   route-activation window;
4. real customer-workload capacity evidence and N=2/N=3 qualification before
   increasing retained concurrency above one.

No public route is enabled by this document. Production completeness remains
`UNVERIFIED` until every applicable external exit is evidenced.
