# Verified project map

## Current I12 Wave 3 Hostinger qualification map

Observed status:
`I12_CORRECTIVE_LOCALLY_VERIFIED; VPS_DARK_BASELINE_N1_VERIFIED; CORRECTIVE_HOSTED_AND_N2_N3_PENDING`.
Exact baseline is protected main
`65706e381b907c6ba09a8eba504af3adaacac86b`; its Source `32668796239`, Image
`32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
`32669484893` are green. The immutable baseline candidate is
`ghcr.io/botond1/3d-printer-slicer-api@sha256:5d209de83d8ddd601fbda8232e6e40f9a641af6d31aa94e99e7c313715a6216c`.
This corrected I11 state supersedes the older corrective-pending prose below.
The first I12 exact-SHA Source run `32746427481` passed. Image run
`32746430314` failed closed at the active-abort contract because public and
operations readiness had bypassed the normal cache. The corrective direct
source below restores those cached routes, preserves fresh detailed health and
adds a live native-quarantine overlay on cache hits. Corrective exact-SHA hosted
evidence is pending.

Direct executable-source map:

```text
MAX_CONCURRENT_SLICES canonical policy (default 1, allowed 1..3)
  -> queue scheduler bounded active slots
  -> native quarantine subscription
  -> synchronous admission close / queued rejection / active abort
  -> active settlement retains slot -> terminal unsubscribe
  -> serialized post-promotion artifact-retention passes
  -> fresh detailed health + cached public/operations readiness
  -> cache-hit live native-quarantine fail-closed overlay
  -> authenticated empty artifact inventory
  -> root0600 credential files -> no-follow credential-exec -> exact four-entry env
  -> full privilege drop -> absolute Python producer, with no secret argv
  -> max-three synthetic Prusa/Orca load
  -> postflight queue + artifact reconciliation
  -> bounded curl/subprocess/future-drain deadlines
  -> create-new 0600 report and cleanup manifest
  -> graceful API stop -> exact exited/exit-0/OOM-false proof
  -> exact candidate image, network-none, non-root cleanup consumer
  -> exact artifact/marker absence and API same-digest restart
  -> repeat dark readiness/auth/private-peer/egress matrix
  -> socketless digest-pinned Traefik, route directory initially empty
  -> exact-zero qualification + cleanup exits
  -> approved DNS/caller/firewall only -> no-clobber route activation
  -> post-link failure -> exact dark rollback or bounded uncertainty
```

On the authorized Ubuntu 24.04 Hostinger KVM 4 host, the baseline candidate is
running dark at N=1 on internal `slicer-api-private`, with no host API port or
default route. Dynamic service identity resolved to 999:999. Health/readiness,
wrong/missing authentication, API and Node/Python native egress denial,
private-peer access, and synthetic Prusa/Orca slicing passed; generated
artifacts and workspaces were exactly removed. Docker 29.7.2, Compose 5.5.0,
four vCPU, about 16 GiB RAM, no swap, and about 205 GiB free disk were observed.
These facts characterize the current host; they do not yet validate N=2/N=3 or
arbitrary customer-model capacity.

The pre-existing Traefik 3.7.11 container owns ports 80/443 and is retained
unchanged. An isolated exact-image socketless CLI/file-provider smoke passed,
but dark cutover remains pending. Public route activation is blocked until an
approved hostname/DNS result, intended caller identity/CIDR, firewall policy,
certificate continuity and synthetic authenticated route proof exist.

No new graph output is retained. Existing graph knowledge was consulted first;
the queue, artifact, Compose and operator direct sources above are authoritative.
See
[`evidence/i12-wave3-hostinger-production-qualification.md`](evidence/i12-wave3-hostinger-production-qualification.md).

## Current I11 protected-main signed-candidate checkpoint

Observed status: `SIGNED_MAIN_CANDIDATE_VERIFIED; AUTOMATIC_REHEARSAL_CORRECTIVE_PENDING`.
I11 merged from baseline `8253160eef1c3e00c1e40826ec61fd97563ddd9b`
through PR `#2` at main SHA
`48afd39b26a6c6ca18ec7bbd18a719c846751e26`. Direct source map:

```text
manual workflow_dispatch on exact protected main HEAD
  -> exact repository / actor / ref / remote-HEAD / ancestry preflight
  -> publish_new OR recover_exact_digest mode contract
  -> one linux/amd64 build and complete no-deploy image gate
  -> candidate-publication environment (deployment: false)
  -> registry authentication
  -> absent-tag new push OR exact existing-digest adoption without write
  -> digest round trip / runtime / Compose identity
  -> SLSA + SPDX attestations and positive/negative verification
  -> bounded mode-aware provenance
  -> exact cleanup and fail-closed aggregation
  -> successful Candidate Publication workflow_run on main
  -> exact single publication artifact and dynamic digest-only pair manifest
  -> previous/current per-image API + OCI attestation verification
  -> I9 private-peer readiness / STORAGE_UNSAFE / automatic rollback runtime
  -> bounded rehearsal evidence / exact cleanup / no deploy
```

- `publish_new` requires an empty existing-digest input, exact
  `PUBLISH_SIGNED_MAIN_CANDIDATE` confirmation and a proven-absent
  `candidate-<main SHA>` tag. It may push only the once-built fully gated image.
- `recover_exact_digest` requires exact
  `RECOVER_SIGNED_MAIN_CANDIDATE` confirmation and a lowercase
  `sha256:<64 hex>` digest. The existing SHA-derived tag, digest and config ID
  must match the once-built image; recovery cannot push, overwrite or delete.
- Environment `candidate-publication` is `LIVE_CONFIG_VERIFIED` on 2026-08-23,
  ID `20443404498`: protected branches true, custom branch policies false,
  exactly one `branch_policy` protection rule (ID `63481958`), and no reviewer
  or wait-timer rules, secrets, variables or deployments. Workflow
  `deployment: false` prevents a deployment record.
- A successful main Candidate Publication triggers only the completed/main
  `workflow_run` rehearsal. The preflight re-proves workflow/run/repository/
  branch/SHA identity and accepts exactly one bounded six-file publication
  artifact with its GitHub artifact digest.
- `.github/release-rehearsal-policy.json` pins the previous signed candidate;
  the publication provenance supplies the current signed main candidate. The
  generated manifest requires distinct digest/config/source identities, source
  ancestry, unchanged `configs` and production Compose, digest-only runtime,
  per-image SLSA/SPDX verification and no registry write/deploy.
- The runtime reuses the hardened I9 private-peer path: shared dynamic non-root
  identity, previous/candidate readiness and Orca proof, controlled
  `STORAGE_UNSAFE`, automatic exact-previous rollback, bounded evidence and
  exact cleanup. Its job has contents/actions/packages/attestations read only.
- Exact-main Source `32666929393`, Image `32666929394`, and Candidate
  Publication `32667219964` succeeded. Candidate digest
  `sha256:3cea88b5009e5bd65b634865608681fccbb9fb721308ada2f6e8844e172541ea`,
  SLSA/SPDX attestations `42460061`/`42460068`, and artifact `9500456840` are
  verified with publication cleanup.
- Automatic rehearsal `32667607266` failed before registry read/runtime. The
  full checkout was made shallow by `git fetch --depth=1`, invalidating the
  otherwise-true `1fffab8… -> 48afd39…` ancestry proof; the always-run cleanup
  independently dereferenced unset image refs. The corrective workflow removes
  the shallow fetch and validates an all-empty/all-valid cleanup identity tuple.
  Corrective exact-SHA hosted evidence is `PENDING` at this commit boundary.
- No mode authorizes deployment, VPS/SSH, promotion tag, release/Git tag,
  mutable tag, overwrite or registry deletion. Hosted S4/S5/I9 evidence remains
  ephemeral repository validation, not production proof.

See
[`evidence/i11-mainline-signed-candidate.md`](evidence/i11-mainline-signed-candidate.md).

## Verified I10 mainline-governance checkpoint

- Final protected-main SHA:
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`.
- Exact-main Source run `32662043454` and Image run `32662043476` succeeded.
- Source and Image validation cover PRs targeting `main`, merge-group
  `checks_requested`, and exact `main` pushes while retaining read-only,
  no-deploy exact-SHA calls.
- Live branch policy protects exactly `main`, requires a PR, includes
  administrators, forbids force-push/deletion, requires conversation
  resolution, and strictly requires the two GitHub Actions contexts
  `Validate exact source candidate (NO DEPLOY)` and
  `Build once, inspect, scan, and discard (NO DEPLOY)`, both app ID `15368`.
- Merge commits alone are enabled; squash and rebase are disabled. Required
  approvals are zero because the sole collaborator cannot self-approve:
  `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`.
- Rulesets are empty; Actions default permission is read and Actions cannot
  approve pull requests. Required signatures are not enabled. No deploy,
  publication, VPS or production workflow ran as part of I10.

See the unchanged commit-time record in
[`evidence/i10-mainline-governance.md`](evidence/i10-mainline-governance.md);
the verified live exits above supersede only that file's intentionally pending
fields.

## Current I9/S3b ephemeral staging and rollback foundation

Status: `I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE` for code-bearing SHA
`c632a75fcb83f2dbcde93d31ef0170de095c4abd`. Hosted Source
`30623957952`, Image `30623957930`, and I9 rehearsal `30623957946`
succeeded without deployment or registry mutation.

Direct source map:

`i9-staging-rehearsal.json` -> read-only tag/digest and SLSA/SPDX verification
-> two digest-only pulls -> dynamic non-root UID/GID -> production Compose
previous -> private-peer readiness and Orca smoke -> production Compose
candidate -> `0700` to `0500` pricing-state readiness fault -> exact previous
digest rollback -> repeated readiness/Orca proof -> bounded evidence -> exact
cleanup.

- The exact branch is `codex/i9-s3b-staging-rollback-foundation`, based on
  completed I8 SHA `1fffab87960c675a053ae814d374cab331fbb14d`.
- `.github/i9-staging-rehearsal.json` binds two distinct immutable GHCR
  manifest/config/source identities. The previous C6 digest is a
  rehearsal-only fixture and must be freshly requalified under the same I8
  signer/source/predicate policy.
- At the I9 checkpoint, `.github/workflows/staging-rollback-rehearsal.yml` was
  serialized and push-authorized only for the exact I9 branch/trailer. I11 now
  productizes the same runtime as a successful protected-main Candidate
  Publication `workflow_run`; the workflow is no longer I9 branch-triggered.
  Both forms are registry-read-only/no-deploy.
- `scripts/i9-staging-docker.js` and
  `scripts/i9-staging-rollback-rehearsal.js` use the unchanged digest-only
  production Compose file. They require exact config/image/kernel identity,
  non-root UID/GID compatibility, the internal bridge, no API host port or
  default route, two consecutive private-peer readiness passes, Python,
  idle queue, auth rejection, and Orca smoke.
- The controlled failure changes only the run-owned pricing-state mode from
  `0700` to `0500`; liveness remains 200 while fresh/cached readiness converges
  to exactly `STORAGE_UNSAFE`. The mode is restored before automatic rollback.
- `scripts/i9-staging-evidence.js` accepts only the exact phase order, three
  distinct container generations, candidate-failure observation, exact
  previous-digest restoration, complete cleanup, and
  `not_applicable_ephemeral_no_deploy`.
- The verified workflow is a hosted-ephemeral rehearsal. It does not prove a real
  operator, proxy/firewall, production secret source, deployed digest, VPS
  change window, production readiness, or production rollback.

See
[`evidence/i9-s3b-staging-rollback-foundation.md`](evidence/i9-s3b-staging-rollback-foundation.md).

## Historical I8/S3a signed-candidate publication implementation

I8-C7 completed at exact SHA
`1fffab87960c675a053ae814d374cab331fbb14d`. Source `30592235730`, Image
`30592235708`, and Candidate Publication `30592235740` succeeded. The signed
candidate manifest/config identities are respectively
`sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5`
and
`sha256:b16f951a9701335b35b4ef248c2b1764d06c17f5e90ee6c2c2245bedc3026d42`.
The remainder of this section preserves the correction history; any C7
`PENDING` statement below is superseded by these exact hosted results.

- Exact baseline:
  `c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6`; target branch:
  `codex/i8-s3a-ghcr-signed-candidate`.
- `.github/actions/exact-image-gate/action.yml` is the common build-once gate
  used by normal Image Validation and Candidate Publication.
  Normal validation passes `retain-image: false`, `publish-mode: false` and
  remains read-only/no-push. Publication passes `retain-image: true`,
  `publish-mode: true` so the same local image survives the complete gate for
  same-job retag and push.
- `.github/workflows/candidate-publication.yml` retains exact-input
  `workflow_dispatch` for future default-branch integration and adds `push`
  only for `codex/i8-s3a-ghcr-signed-candidate`. On push, its fail-closed event
  adapter derives `candidate_sha` from `github.sha` and requires repository
  `Botond1/3D-Printer-Slicer-API`, ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  registry `ghcr.io/botond1/3d-printer-slicer-api`, and exact last non-empty
  commit line
  `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`.
- Manual and push paths produce the same canonical `candidate_sha`,
  `image_ref`, `discovery_tag`, and `registry_repository` outputs. Both prove
  target-branch HEAD and baseline ancestry and check out the exact SHA without
  credentials; every other event or identity fails closed.
- The publication sequence is:
  exact source -> one local `linux/amd64` build -> full runtime/Orca/browser/
  abort/private-topology/SBOM/Grype gate -> GHCR login -> absent discovery tag
  -> push the same image -> resolve registry manifest digest -> digest-pinned
  pull -> prove the pulled image ID equals the gated image ID -> create one
  candidate-scoped local publication alias -> prove the alias image ID is the
  pulled/gated image ID -> alias-bound helper/container and exact-image-ID Orca
  smoke -> digest-pinned Compose validation -> SLSA and SPDX attestations ->
  GitHub API/OCI/local-bundle verification -> bounded v2 evidence -> exact
  cleanup and fail-closed aggregation.
- Only the publication job requests `packages: write`, `attestations: write`,
  and `id-token: write`; its other permission is `contents: read`. The
  preflight and normal Image Validation have only `contents: read`.
- `scripts/i8-publication-evidence.js` and
  `scripts/i8-write-publication-evidence.js` define the exact-key bounded
  `i8-s3a-signed-candidate-provenance-v2` correlation contract.
- I8-C5 is exact commit
  `5aef62386992f0dcab48b82e87c275e7dff1f291`. Hosted Source run
  `30590102069` and Image run `30590102077` succeeded. Candidate Publication
  run `30590102061` published its discovery tag, passed the fixed digest
  runtime, and created both attestations before the JSON policy failed on an
  unbound `REGISTRY_DIGEST`.
- The C5 quarantined tag
  `candidate-5aef62386992f0dcab48b82e87c275e7dff1f291` is preserved at digest
  `sha256:fe546f2cd382089a167c4dff721a69bab1e5737b4da31bd0a37558f1f930f639`
  and config identity
  `sha256:ae6ffe01c345219e9be3859d9019b3648a81ab22de30615f75a807e683377ecd`.
  Attestations exist, but full verification and the Candidate artifact are
  incomplete. The cleanup step reported success, but a direct-source audit
  proved that the action-created empty bundle parent directories were not
  removed, so exact temporary cleanup was incomplete. Classification is
  `I8_CANDIDATE_ATTESTATION_UNVERIFIED`. Older candidates remain unchanged.
- C6 binds the existing exact registry digest to the verification step and
  removes each action-created attestation bundle plus its canonical,
  direct-child runner-temp parent with fail-closed type, containment, and
  absence checks. Source run `30591301132` and Image run `30591301127`
  succeeded. Candidate run `30591301158` proved publication, digest runtime,
  both attestations, positive API/OCI/offline verification, and exact cleanup,
  then failed only because two nonzero negative calls were followed by an
  obsolete exact diagnostic-text check.
- C7 reuses the full positive certificate/signer/source/predicate policy in both
  negative calls. It re-proves the unchanged provenance bundle and exact signed
  offline subject, changes only the artifact bytes or repository, requires each
  nonzero result independently, and sends unused stderr to `/dev/null`.
  Exact-SHA hosted results remain `PENDING`.
- C7 local evidence is 312/312 focused tests, 1352/1352 complete JavaScript
  tests, 43 Python tests with 42 pass and one expected Windows POSIX-permission
  skip, 173 JavaScript plus 32 Python syntax files, 307 tracked safety files,
  and zero production dependency findings. Docker and actionlint are
  `NOT_RUN_ENVIRONMENT`.
- C2A preserves the exact local publication alias only after
  digest-pulled/gated image-ID equality and keeps Compose plus registry,
  signature, attestation, verification, and evidence digest-bound.
- The C3 namespace audit found I4's main-container validator to be the sole
  validation-only drift. It is corrected to the exact full-string,
  128-byte-bounded validation/publication contract. I2 aliases are exact dual
  namespace; I2 probes and I6 container/network names remain generic, strict,
  bounded, and distinct; evidence/temp directories remain per-run and bounded;
  cleanup remains bound to exact environment references, ownership labels, and
  exact image/container/network identities. No other executable
  validation-only regex exists in the Candidate helper chain.
- `scripts/i8-runtime-state-proof.js` is the shared C4 state seam for both
  prepublication and post-push digest runtime validation. It binds exact
  container/image identity and allowlisted state, requires the same positive
  PID in consecutive healthy observations before host `ps`, matches positive
  kernel UID/GID, and confirms the same state after `ps`. Status must be exactly
  `running`; paused, restarting, dead, exited, unhealthy or missing health, OOM,
  state error, malformed state/PID/identity, timeout, and post-`ps` state change
  fail closed.
- Failed upload storage callbacks wait for the owned output stream to close
  before workspace cleanup. The live partial-request proof uses matching HTTP
  receive and application upload deadlines, reflecting their shared production
  default across Node and host filesystem variants.
- Evidence generation may emit only `I8_CANDIDATE_EVIDENCE_READY`. The final
  workflow step alone may emit `I8_SIGNED_CANDIDATE_COMPLETE`, after evidence
  upload, publication cleanup, and evidence cleanup; every dependency has
  one-by-one mutation coverage and both cleanup outcomes are independently
  visible in the final summary.
- Post-correction affected tests are green at 734/734, full JavaScript at
  1296/1296, and Python at 42/43 pass with one expected Windows
  POSIX-permission skip. Local Docker is `NOT_RUN_ENVIRONMENT`.
- C5 restores exact parity between the shared prepublication container start
  and the digest-roundtrip container start: dynamic expected UID/GID, matching
  PID/memory/CPU/log/stop values, and bounded `json-file` rotation. The C4
  runtime exited `78` because those entrypoint-required variables were omitted.
  C5 contract and removal mutations protect every added value. Its wrong-digest
  negative proof uses a bounded local wrong-content artifact plus the already
  verified offline bundle, rather than a nonexistent OCI digest that would fail
  during registry lookup before digest-policy evaluation. C5 hosted evidence
  confirms this runtime and attestation path.
- C6 binds the exact registry-push digest into the positive verification step
  before its Node subject-policy check. The C5 verifier had `DIGEST_REF` but not
  `REGISTRY_DIGEST`, so `process.env.REGISTRY_DIGEST.slice(7)` was guaranteed to
  throw after the verifier commands. A step-local mutation protects the binding;
  all other heredoc inputs were audited as present. Hosted C6 proved the
  correction and exact bundle-parent cleanup, then failed at the independent
  version-specific negative diagnostic-text assertion. C7 removes that prose
  coupling while retaining semantic signed-subject and verifier rejection
  proofs.
- `main`, PR, merge, force-push, release/Git tag, mutable registry tag, old-tag
  mutation, deploy, and repository-setting changes remain forbidden. Current
  user authority covers normal target-branch corrective progression only.
- The exact-SHA candidate workflow is the reviewed trust assumption because
  build, gate, and push must share one job without a multi-GiB image-tar
  transfer. No deploy, promotion, mutable tag, VPS, proxy, firewall, secret,
  environment, ruleset, or package-setting mutation is part of I8.
- See
  [`evidence/i8-s3a-ghcr-signed-candidate.md`](evidence/i8-s3a-ghcr-signed-candidate.md).

## Historical I7/S3a immutable-candidate foundation

- `docker-compose.production.yml` is the only production manifest. It has one
  `slicer-api` service and one internal `slicer-api-private` bridge, no build,
  no host port, and no in-stack proxy. It requires an external environment
  file, numeric runtime UID/GID, and a digest-only image reference.
- `scripts/i7-production-compose-contract.js` is the mandatory preflight that
  enforces the lowercase `registry/repository@sha256:<64 hex>` reference and
  exact Compose envelope. Compose interpolation alone only enforces presence.
- `.github/workflows/image-validation.yml` still builds one local
  `linux/amd64` image and performs runtime, Orca, browser, topology, SBOM,
  Grype, artifact-boundary, and exact-cleanup gates against that identity. It
  then generates and revalidates one bounded allowlisted provenance object and
  uploads six explicit files. It does not push, sign, attest, or deploy.
- I7 hosted Source run `30160486802` and Image run `30160486750` succeeded for
  the exact baseline; evidence artifact `8620145030` preserves the no-push
  checkpoint. See
  [`evidence/i7-s3a-immutable-candidate-foundation.md`](evidence/i7-s3a-immutable-candidate-foundation.md).
- The external reverse-proxy peer is intentionally outside this manifest. It
  may join the named private bridge from its own stack, but must not provide
  generic forwarding, NAT, or DNS tunnelling. Deployed proxy/firewall/secret/
  digest/VPS state is `UNVERIFIED`; S3b is `NOT_STARTED`.

## Current I6/S5 private-peer topology decision

- Atomic delta: `549fa4258c60b2971855e7a202e488d74427ccd4`
  followed by `7dd6d73632856967824570c6e38c54b905d032b1`.
- Decision: `PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`.
- Protected `/health/detailed` evaluates fresh readiness probes. Public
  `/ready` and protected `/operations/readiness` retain the bounded cache.
- Repository validation places the API and authenticated reverse-proxy peer on
  one internal-only bridge. The API has no host-published port or external
  default route. The peer proves liveness, minimal readiness,
  operations-authenticated readiness, and missing/wrong-key rejection.
- An owned sentinel is calibrated while reachable, detached, and then used to
  require API and spawned-native DNS/TCP/UDP denial. The proxy must not provide
  generic forward-proxy, NAT, or DNS tunnelling for the API.
- Deployed intended/denied callers, proxy hop/CIDR, secret mode, immutable
  digest, and Hostinger/proxy/firewall/egress facts remain `UNVERIFIED`. See
  [`evidence/i6-s5-private-peer-topology.md`](evidence/i6-s5-private-peer-topology.md)
  and
  [`i6-s5-private-peer-operator-validation.md`](i6-s5-private-peer-operator-validation.md).

## Historical I5/S4 scoped-trust candidate

- Exact baseline: `5be7b19d13616f06504c18217e25bf95c97c6e96`;
  branch: `codex/i5-s4-trust-topology-observability`.
- Protected routes are method-aware and audience-scoped:
  slice (`x-slicer-api-key`), pricing/artifact/operations (`x-api-key`).
  Each audience has one mandatory active and optional previous key. Startup
  rejects missing, malformed, placeholder-like, duplicate, or cross-audience
  reuse. Rotation accepts old+new after restart 1 and revokes old after previous
  removal plus restart 2.
- `ADMIN_API_KEY` is only a finite compatibility migration for one named
  non-slice audience, with a future ISO timestamp no more than 90 days away.
  Normal operation requires all scoped active keys and is fail closed.
- Browser Origin is exact and isolated per audience. No-Origin service requests
  remain allowed. Proxy trust defaults false and true requires explicit unique
  validated IP/CIDR peers or loopback. Express stops identity at the nearest
  untrusted hop; invalid request IDs are replaced and the safe value is echoed.
- Public `/health` is liveness and `/ready` returns only READY/NOT_READY.
  Operations scope protects detailed health, full readiness reasons, and
  fixed-cardinality Prometheus metrics. Versioned events correlate bounded
  request/job/artifact IDs and exclude credentials, paths, filenames, customer
  data, arbitrary event names, and unbounded labels.
- Hosted baseline Source `30022045664` and Image `30022045578` passed. The exact
  local A/B image was
  `sha256:5f159e1051233811ad663175311059829aecdbff16706e39aceba4aac77f9aa3`.
  Docker Desktop 29.6.1 ordinary bridge preserved loopback ingress but allowed
  API/native DNS/TCP/UDP sentinel egress. Internal bridge denied egress but
  exposed no loopback listener. Exact resources were removed.
- Exact candidate `510e6110ef5c49cd03962627210d6db114554618`
  passed hosted Source run `30037842766`. Hosted Image run `30037842526`
  failed closed on independent semantic-abort and monolithic private-inspect
  assertions while image identity, health, authenticated Prusa/Orca slicing,
  egress sentinel, SBOM/Grype, evidence upload, and cleanup succeeded.
- The corrective repository contract accepts only bounded abort termination
  representations after active admission, explicit abort, native settlement,
  queue-zero, and unchanged API/filesystem inventories. Private topology is a
  pure allowlisted validator: canonical `HostConfig.PortBindings` proves the
  requested fixed loopback publish; a bounded runtime projection separately
  proves no external default route. Docker API 1.48 and Desktop 29 fixtures
  cover the inspect-shape portability seam.
- At I5, Compose remained unchanged and no sidecar was invented. Status was
  `IN_PROGRESS` pending final exact-SHA hosted Source and Image success.
  Deployed caller/proxy/firewall/secret/digest/VPS state and S3b remain
  `UNVERIFIED`.

## Current I4/S2 resource-state candidate

- Exact baseline: `780d64dd786440cb80ddd4df38cb489c16070a07`;
  branch: `codex/i4-s2-resource-state-envelope`.
- A central strict-integer resource policy now bounds upload lifetime and actual
  bytes, ZIP/3MF/SL1 expansion, model/profile/output/pricing reads, successful
  statistics, and managed-artifact retention. Successful slice responses add
  backward-compatible `job_id` and `artifact_id` correlation.
- Managed outputs use ownership metadata, active-download leases, deterministic
  TTL/count/byte eviction, and bounded partial/startup cleanup. Pricing commits
  use serialized candidate snapshots and same-directory exclusive temporary
  files with full writes, file flush, atomic rename, and directory-sync where
  supported. Primary state is `configs/pricing-state/pricing.json`; the legacy
  `configs/pricing.json` is migration input only.
- Production Compose uses a read-only root, root-owned code/profiles, only
  input/output/pricing-state persistent writable binds, restrictive 64 MiB
  `/tmp`, non-root identity, and bounded PID/memory/CPU/log/stop settings.
- This is `PENDING_LOCAL_VALIDATION` until final aggregate, Docker, commit, and
  exact-SHA hosted gates finish. VPS capacity, proxy/private topology, egress,
  S4/S3b, deployment, and production readiness remain `UNVERIFIED`.

## Snapshot and authority

- Historical S0 audit date: **2026-07-18**.
- Historical code baseline: `899f1916437620ab536e912bf404d8da261cc37f`.
- Historical work baseline: `02afc555509f00d432c24520601f4c7034becd81`.
- The only code-to-work-baseline addition is the
  [S0 execution prompt](../../prompts/codex/S0-characterization-and-ci-baseline.md).
- The original topology and capability matrices below are historical S0
  snapshots. The current repository delta is anchored separately; historical
  `ABSENT`/`UNTESTED` labels must not be read as current results.
- This document records repository evidence, not production health. GitHub
  settings, secrets, branch protection, the VPS state, and the deployed version
  are `UNVERIFIED`.

## Current S0.1 verification delta

The current local checkpoint is anchored by
`b1411be8cfd68101eb2a3a909b0e1a428e8c111f` (fail-closed validation and
characterization) and `f9ed1ee6791e531670d5d7703f994bfb51986ebb`
(dependency remediation). The later documentation commit intentionally does not
name itself.

| Surface | Historical S0 snapshot | Current local evidence |
| --- | --- | --- |
| Unit discovery | JS/Python suites absent | 63/63 JavaScript tests pass; Python reports 22 discovered, 22 run, 22 pass, 0 failures/errors/skips; empty discovery fails closed. |
| Tracked syntax | partial named-file checks | Dynamic gates validate 48 JavaScript and 25 Python files and fail on an empty applicable set without creating bytecode. |
| Repository safety | absent | Scanner selects and inspects 146 tracked paths; staged commit gates inspected 20 paths for the characterization commit and 3 for the dependency commit; empty staged scope is allowed only outside required-nonempty mode. |
| Auth/queue/error characterization | untested or source-only | Live timing-safe admin calls, rejected-callback non-execution, and adjacent processing-error status/code ownership have deterministic tests. |
| Production dependency audit | one high plus three moderate findings | Exact npm 10.9.8 locks Express 4.22.2, Multer 2.2.0, body-parser 1.20.6, and qs 6.15.3; full production audit reports zero findings at every severity and the three named S0 registry findings are absent. This did not by itself supply `GHSA-72gw-mp4g-v24j`'s application-level nesting-depth mitigation; S1a adds that separately. |
| Conditional/external gates | unverified | Clean lockfile installation and all local gates pass. Docker image/health smoke is `NOT_RUN_ENVIRONMENT` because no daemon was available; hosted CI, branch protection, required checks, deployment, and production topology remain `UNVERIFIED`. |

This delta verifies a local repository baseline only. A `main` push still had an
independent deployment path in the historical S0/S0.1 snapshot. S3a later
removed that path; neither checkpoint authorizes production promotion.

## Current S1a verification checkpoint

S1a is `VERIFIED` for the local repository checkpoint at implementation commit
`e7a409566bb8795a22f38bbf9f514b42c51bda74`; the later canonical documentation
commit intentionally does not name itself. Exact npm 10.9.8 clean installation,
zero-finding production audit, full deterministic suites, tracked syntax,
tracked and staged safety, whitespace, instruction-mirror, and forbidden-surface
gates passed. Docker image/startup smoke is `NOT_RUN_ENVIRONMENT` because the
client found no daemon and created no Docker resource. This does not verify S3a,
S4, S3b, hosted CI, deployed topology, or promotion readiness.

Current repository evidence:

- [`workspace.js`](../../app/services/slice/workspace.js) creates an unguessable
  marked directory under root-scoped `input/.slice-jobs`, rejects path-segment
  and symlink/junction escapes, owns cleanup idempotently, and may own a final
  output candidate only through exclusive creation and explicit release.
- [`slice.routes.js`](../../app/routes/slice.routes.js) applies the IP limiter
  before allocation, then owns allocation, `upload.single('choosenFile')`, the
  awaited queue-aware handler, and cleanup in one `try`/`finally` lifecycle.
- The multipart envelope is finite: `fileSize` retains the 500 MB safe default
  and hard maximum, `files: 1`, `fields: 40`, `parts: 42`,
  `fieldNameSize: 64`, `fieldSize: 65536`, and fixed, non-configurable
  `fieldNestingDepth: 0`. Bounded environment overrides exist only for the
  configurable values. Busboy 1.6.0 keeps its internal fixed
  `MAX_HEADER_PAIRS = 2000`; no lower application override is claimed.
- Live synthetic multipart tests in
  [`slice-route-lifecycle.test.js`](../../tests/unit/js/slice-route-lifecycle.test.js)
  and
  [`slice-route-multipart-live.test.js`](../../tests/unit/js/slice-route-multipart-live.test.js)
  send a file before `a[b]`, observe HTTP 400 /
  `UPLOAD_FIELD_NESTING_TOO_DEEP` through Multer's `LIMIT_FIELD_NESTING` path,
  and wait for zero request-owned residue. The same focused evidence covers the
  normal flat alias inventory and other parser/admission/failure/success cleanup
  paths without using a real slicer or customer fixture.
- [`server.js`](../../app/server.js) awaits a startup audit before listening.
  Production startup is report-only: destructive stale-workspace recovery is
  not enabled while total lifetime and rolling/shared-volume exclusivity remain
  unproven.
- Final local counts are 132/132 JavaScript tests, 22/22 Python tests, syntax
  over 63 JavaScript and 25 Python files, and safety inspection of 163 tracked
  paths plus the 30-file implementation stage. Node was v24.11.1 and bundled
  Python was 3.12.13. The exact production audit reported zero findings.

## Current I0 S1a/S3a integration checkpoint

The integrated tree retains all S1a upload/workspace/multipart behavior above
and includes the S3a/S3a.1 repository workflow controls. `deploy.yml` is now a
manual exact-candidate preflight only; it calls reusable source and image gates
and has no deployment, registry publication, SSH, VPS, or production-secret
path. Source validation resolves and checks out the exact candidate with
credentials disabled, and its final whitespace gate derives a dynamic
merge-base from `refs/remotes/origin/main`, proves ancestry, and checks that
candidate range without an empty fallback. Image validation builds once, loads
one run-local SHA-tagged image, and reuses it for smoke, SBOM, and fail-closed
HIGH/CRITICAL scanning without pushing it.

Hosted evidence applies to exact original S3a.1 implementation commit
`4f55062096d57a9245282b686fd8619c29c473e8`: Source Validation run
`29680527745` passed; Image Validation run `29680527711` failed closed. The
image failure cause is `UNVERIFIED` and the scan gate must remain fail closed.
Branch protection, required checks, immutable registry digest, signature,
attestation, promotion, production readiness, VPS topology, deployed identity,
and the integrated cherry-pick SHA's hosted results remain `UNVERIFIED`. I0 did
not change `main` or the running VPS.

## Current I1 S1c/S3a integration checkpoint

The canonical current checkpoint is `I1_CHECKPOINT_BLOCKED_IMAGE`, anchored by
runtime commit `995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`. Historical checkpoint
records above and under [`evidence/`](evidence/) remain historical; this section
supersedes their pre-integration stage status without rewriting them.

The integrated cherry-pick equivalents, in exact order, are `a862e2c` (source
`78693fe`, dependency patch), `4c7df9e` (source `b91401e`, S3a-B1), `7bc7946`
(source `edbe81c`, S3a-V1), `6921f7a` (source `fd93c0b`, S3a-B2), `d1db7df`
(source `67a2922`, S1b), `89369d1` (source `fd6f4f3`, S1c), `2fee995`
(source `d1bc413`, S1c evidence), `896f3bf` (source `d0d7dc3`, settlement
polling), followed by `995bb9d`. Dependency patch ID
`5b593dee0baaa1437aedfd4892654bd90c971a4e` occurs once; duplicate `306b799`
was not picked.

Runtime and queue behavior now verified locally:

- `SIGTERM` and `SIGINT` enter one single-flight lifecycle. Queue shutdown
  starts synchronously, HTTP admission closes, and shutdown awaits both drains.
- Queue shutdown rejects new admission with typed HTTP 503
  `SLICE_QUEUE_SHUTDOWN`, aborts queued and active jobs, and does not release an
  active slot/counter until the task promise settles.
- Real queued-job timers enforce wait deadlines independently of worker
  availability. Abort, activation, expiry, shutdown, and settlement clean
  timers/listeners/counters exactly once.
- The effective signal reaches every converter/slicer phase. Native cancellation
  terminates exact process trees with bounded TERM-to-KILL escalation, and an
  unverified tree retains the command and queue slot fail closed.
- Child commands receive an explicit minimal environment. Pre-abort and phase
  guards prevent later work; abort cannot produce a success response or release
  a final artifact. Route/workspace/response cleanup remains awaited.

Local evidence: clean install 175 packages; focused runtime/queue/native 48/48;
focused quality 58/58; aggregate 457/457 JavaScript and 22/22 Python; syntax 86
tracked JavaScript and 25 Python files; repository
safety at the runtime stage over 192 tracked and six staged files, plus final
tracked safety over 196 files and documentation-stage safety over five files;
offline production audit zero. Online
audit is `BLOCKED_POLICY`; `actionlint` and Docker are unavailable. The
transient Graphify service map covered 30 code files, 411 nodes, 767 edges, 15
communities, 659 extracted and 108 inferred relations, with no missing,
dangling, self-loop, or duplicate relation edges; its output was removed.

Hosted exact-source S3a-B2 evidence is mixed. Source run `29957927228`, job
`89051575423`, passed with no annotations or Node 20 warnings. Image run
`29957927370`, job `89051576245`, failed and retained artifact `8545008995`,
digest `sha256:c0c80f843cbea086eb4a8e6a293cd467254b8da67ae1c09b4e84d832a21d3bcc`.
Annotations record liveness exit 1, Grype HIGH, scanner-classifier exit 1, and
final-gate exit 1. Swiper 7.2.0 `GHSA-hmx5-qpq5-p643` /
`CVE-2026-27212` is a known allowed advisory, but the unresolved persistent
runtime liveness failure means it cannot be called the sole image failure.
S3a-V2C is not integrated and its surfaces remain untouched.

Branch protection, required checks, registry digest/signature/attestation,
promotion, S4, S3b, production readiness, VPS topology, and deployed state
remain `UNVERIFIED`. I1 made no `main`, PR/merge, tag/release, registry, VPS,
SSH, or deployment change and authorizes none.

## Current I2 V2C and image-liveness checkpoint

I2 is anchored from exact I1 baseline
`c6110e197ebe7e95d15ba597954108297251fb7b`. It integrates V2C equivalents
`cf45524` and `9f8ae6b` in source order, preserves the I1 queue, native-process,
and graceful-shutdown behavior, installs Swiper 12.1.2 into both Orca resource
trees, and leaves Orca v2.3.1 plus its pinned SHA-256 unchanged.

Hosted A/B/C evidence proved the old tmpfs roots were `0:0`/`0755` and failed
service-user writes while image directories and dynamic `uid/gid/mode=0700`
tmpfs mounts passed. The main container failed at the same
`/app/input/.slice-jobs` path with `EACCES`. The final workflow resolves nonzero
UID/GID from the immutable image, verifies the running process credentials from
host-kernel state, retains both restrictive 64 MiB tmpfs mounts, and requires
both running and healthy. Exact evidence, tests, hosted runs, and remaining
boundaries are recorded in
[`evidence/i2-v2c-liveness-integration.md`](evidence/i2-v2c-liveness-integration.md).

The exact candidate image also runs an offline, non-root Orca 2.3.1 help and
customer-free manifold-cube slice smoke with bounded resources and output. The
gate requires the expected Orca version, one bounded regular G-code file, its
Orca 2.3.1 generator signature, and real extrusion. Smoke and final cleanup
remove only a captured container ID whose immutable image ID and two run-owned
labels match; a reused container name is reported but never removed.

Branch protection and required-check settings, signature/attestation,
immutable registry promotion, S4, S3b, VPS/deployed state, and production
readiness remain `UNVERIFIED`. I2 did not deploy or promote.

## Historical I3 service-auth and HTTP-envelope checkpoint

I5 supersedes this checkpoint's S4 credential, Origin, proxy, readiness, and
observability status. The section remains as historical evidence.

I3 is based on exact commit
`6241685f1af0c0a1d4be6f1c229d66ca922fbb88` on
`codex/i3-s4a-service-auth-http-envelope`. It implements only the slice-service
authentication/browser-Origin subset of S4 and the Node HTTP-server subset of
S2. The worktree has no exact implementation commit yet.

At I3, startup required `SLICE_SERVICE_API_KEY` to contain 32-256
printable-ASCII bytes and differ from the then-broad credential. Both slice endpoints required
`x-slicer-api-key` after the IP limiter and before root-scoped workspace
allocation. Missing or wrong credentials return exact HTTP 401
`{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
The middleware hashes supplied and configured values to fixed-length SHA-256
digests before `crypto.timingSafeEqual`; its rejection event contains only
sanitized request ID and resolved client IP.

Requests without `Origin` remained allowed. Browser-origin slice calls used
only `SLICE_CORS_ALLOWED_ORIGINS`. I5 later completed exact protected-audience
Origin isolation. The Node server applied these defaults/inclusive bounds:
headers timeout 60000 `[1000,60000]`, request timeout 600000
`[60000,600000]`, keep-alive timeout 5000 `[1000,60000]`, header count 2000
`[16,2000]`, connections 128 `[1,1024]`, and requests/socket 100
`[1,1000]`. Empty, non-decimal, unsafe, zero/negative, or out-of-range
overrides use defaults; effective headers timeout is capped at request timeout.

Focused results currently report 469/469 integrated tests, 6/6 focused
Python-runner tests, 5/5 I3 mutation tests, and passing HTTP assertions/repeats.
Final aggregate and hosted exact-SHA results are pending. Root-scoped
`input/`, `output/`, and `configs/` are preserved. No Docker local build,
deployment, or production proof is claimed; actual VPS capacity, proxy
timeouts, private ingress/egress, the remaining S2/S4 exits, and production
state are `UNVERIFIED`. Detailed evidence is in
[`evidence/i3-service-auth-and-http-envelope.md`](evidence/i3-service-auth-and-http-envelope.md).

## Current I4 S2 resource/state checkpoint

I4 starts from exact I3 baseline
`780d64dd786440cb80ddd4df38cb489c16070a07` on
`codex/i4-s2-resource-state-envelope`; the candidate is an uncommitted worktree
delta.

- [`resource-policy.js`](../../app/config/resource-policy.js) centrally bounds
  body/upload lifetime, multipart, ZIP/3MF/SL1, model/output/profile/pricing,
  successful stats/pricing, retention, and cleanup work. Omitted values use
  defaults; an invalid explicit value refuses startup. Multipart expiry maps to
  HTTP 408 `UPLOAD_TOTAL_TIMEOUT`.
- Generated archives validate declared and actual bytes, entry count,
  per-entry bytes, compression ratio, path depth/type/encryption, canonical 3MF
  parts, and archive identity. Success requires bounded contained regular
  outputs and finite positive required stats.
- Workspaces and artifacts use collision-resistant `job-<32 hex>` and
  `artifact-<32 hex>` identifiers. Responses expose `job_id`/`artifact_id`;
  private metadata, download leases, and TTL/count/byte/partial cleanup
  coordinate managed output without exposing metadata in admin downloads.
- Primary pricing state is `configs/pricing-state/pricing.json`. Safe legacy
  `configs/pricing.json` is migration/fallback input. Persistence uses an
  exclusive `0600` temp file, complete write, file fsync, atomic rename, and
  directory fsync where supported, then publishes in-memory state.
- The non-root container keeps code/profiles root-owned and read-only. Compose
  uses a read-only root filesystem, separate `0700` UID/GID-owned writable
  input/output/pricing-state binds, restrictive tmpfs, dropped capabilities,
  no-new-privileges, and bounded PID/memory/CPU/log/stop settings.

Supplied local evidence is green for multipart 24/24, generated archives 5/5,
focused S2/state/container 107/107, container/workflow 382/382, quality focused
73/73, archive 6/6, OpenAPI 5/5, syntax 15/15, exact npm 10.9.8 install, zero
audit vulnerabilities, and diff whitespace. Python integration is
`NOT_RUN_ENVIRONMENT`; active-job container stop orchestration is
`NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`. Hosted exact-candidate
validation, VPS/proxy/topology, egress, S4, S3b, and deployment remain pending
or unverified. See
[`evidence/i4-s2-resource-state-envelope.md`](evidence/i4-s2-resource-state-envelope.md).

## System context

The service is a synchronous HTTP API that accepts model/CAD input, invokes
Python and native slicers, stores generated artifacts, and calculates a price.
The authorized target is a private Hostinger sidecar; making it a public slicer
or changing LeadPilot is out of scope
([S0 prompt](../../prompts/codex/S0-characterization-and-ci-baseline.md)).

Actual request-to-artifact sequence:

1. Express applies security headers, CORS, request ID, and body parsers
   ([`app/server.js`](../../app/server.js), middleware registration).
2. A slicing route applies the IP limiter, authenticates `x-slicer-api-key`,
   allocates a marked job directory under root `input/.slice-jobs`, and then
   Multer writes one `choosenFile` into that request-owned workspace
   ([`app/routes/slice.routes.js`](../../app/routes/slice.routes.js),
   `createSliceRouter`;
   [`requireSliceService.js`](../../app/middleware/requireSliceService.js);
   [`workspace.js`](../../app/services/slice/workspace.js),
   `createJobWorkspace`). Authentication rejection allocates no workspace and
   cannot reach Multer, queue admission, or native work.
3. The awaited handler binds request/response disconnects to one abort signal,
   then enqueues the already-uploaded request by resolved client IP
   ([`app/services/slice.service.js`](../../app/services/slice.service.js),
   `handleSlicePrusa` / `handleSliceOrca`).
4. Only after a worker slot opens does `processSlice` receive the queue-owned
   effective signal, parse request options,
   rename/inspect input, convert/orient, transform, and validate build bounds;
   upload, extraction, conversion, orientation, transform, engine staging, and
   request-time profile paths remain inside the owning workspace
   ([`pipeline.js`](../../app/services/slice/pipeline.js), `processSlice`).
5. A runtime profile and argument array are built; `execFile` invokes Python or
   Prusa/Orca with a minimal environment, timeout, and exact-tree cancellation
   ([`app/services/slice/command.js`](../../app/services/slice/command.js),
   `runCommand`).
6. The slicer first writes inside the workspace. A validated regular output is
   exclusively copied to a registered direct child of root `output/`; ownership
   is released only after the success response finishes, otherwise cleanup
   removes the candidate
   ([`output-lifecycle.js`](../../app/services/slice/output-lifecycle.js),
   `runSlicerAndParseStats`; [`response-lifecycle.js`](../../app/services/slice/response-lifecycle.js)).
7. The route-level `finally` runs idempotent workspace cleanup after parser,
   queue, validation, processing, response, or success settlement. The released
   successful `.gcode`/`.sl1` remains in root `output/`.

This order differs from prose that places option validation before queueing; the
code order is authoritative.

## Repository and module map

| Surface | Canonical responsibility and evidence |
| --- | --- |
| Bootstrap | [`app/server.js`](../../app/server.js): admin/service-key startup guards, middleware order, docs/routes, bounded listener. |
| Runtime configuration | [`app/config/constants.js`](../../app/config/constants.js), [`service-auth.js`](../../app/config/service-auth.js), [`paths.js`](../../app/config/paths.js), [`python.js`](../../app/config/python.js). |
| HTTP contract | [`app/routes`](../../app/routes), [`app/middleware`](../../app/middleware), and [`swagger-docs.js`](../../app/docs/swagger-docs.js). |
| HTTP server envelope | [`http-server.js`](../../app/services/http-server.js) validates and applies header/request/keep-alive timeouts, header/connection counts, and requests/socket before listen. |
| Slice orchestration | [`app/services/slice.service.js`](../../app/services/slice.service.js) owns queue settlement and delegates to [`pipeline.js`](../../app/services/slice/pipeline.js), [`output-lifecycle.js`](../../app/services/slice/output-lifecycle.js), and [`response-lifecycle.js`](../../app/services/slice/response-lifecycle.js). |
| Request workspace ownership | [`workspace.js`](../../app/services/slice/workspace.js) owns marked job allocation, containment, output-candidate custody, idempotent cleanup, and audit-only stale classification. |
| Pricing | [`pricing.service.js`](../../app/services/pricing.service.js) facade plus [`pricing/repository.js`](../../app/services/pricing/repository.js) and [`pricing/catalog.js`](../../app/services/pricing/catalog.js). |
| Admin artifacts | [`admin-output.service.js`](../../app/services/admin-output.service.js) validates extension, containment, lstat, and realpath. Its existing filesystem-checking `resolveValidatedOutputFile` helper is exported for tests; it is not a pure helper. |
| Python/native preprocessing | [`app/cad2stl.py`](../../app/cad2stl.py), [`mesh2stl.py`](../../app/mesh2stl.py), [`orient.py`](../../app/orient.py), [`scale_model.py`](../../app/scale_model.py). |
| Profiles/state | Immutable [`configs/prusa`](../../configs/prusa) and [`configs/orca`](../../configs/orca) profiles plus writable primary pricing state `configs/pricing-state/pricing.json`; legacy `configs/pricing.json` is migration/fallback input only. |
| Integration runners | [`tests/testing-scripts`](../../tests/testing-scripts) with shared helpers in `common/`; reports are generated in ignored `results/`. |
| Runtime/container | [`Dockerfile`](../../Dockerfile), [`docker-compose.yml`](../../docker-compose.yml), and [`docker-compose.dev.yml`](../../docker-compose.dev.yml). |
| Automation | [`ci.yml`](../../.github/workflows/ci.yml) and [`image-validation.yml`](../../.github/workflows/image-validation.yml) validate PR, merge-queue and exact-main candidates without deployment; [`candidate-publication.yml`](../../.github/workflows/candidate-publication.yml) is being productized in I11 as a protected-main, manual-only, mode-aware signed-candidate publisher with no-deploy authority; a successful main publication automatically triggers [`staging-rollback-rehearsal.yml`](../../.github/workflows/staging-rollback-rehearsal.yml), which validates the exact publication artifact, two digest-only signed images, hardened I9 failure/rollback and bounded cleanup with read-only permissions; [`deploy.yml`](../../.github/workflows/deploy.yml) remains a manual no-deploy preflight. |

## Runtime state and artifact lifecycle

- `app/config/paths.js` selects the repository root locally and `/app` in the
  flattened image, preserving root-scoped `input/`, `output/`, and `configs/`;
  S1a adds only the internal `input/.slice-jobs` ownership root.
- Slice authentication now precedes allocation. Multer persists input before
  queue admission, but allocation and persistence occur inside one route-owned
  lifecycle. Full/client-limit rejection and dequeue-time expiry settle before
  its `finally`, so they no longer bypass request-owned workspace cleanup
  ([`slice.routes.js`](../../app/routes/slice.routes.js), `lifecycle`;
  [`queue.js`](../../app/services/slice/queue.js), `enqueueSliceJob`).
- Multer configures finite file/field/part/name/value limits and fixed
  `fieldNestingDepth: 0`; live synthetic evidence exercises the real parser and
  global error mapping. Busboy's header-pair boundary remains its internal fixed
  value 2000. I3 separately bounds the Node server's header/request/keep-alive
  timeouts, header count, connections, and requests/socket. Actual proxy/VPS
  behavior, total streamed upload duration, and measured memory/disk/CPU
  envelopes remain S2 work.
- Queue expiry has an immediate per-job timer and a dequeue-time defense in
  depth. Shutdown and client disconnect use the same effective abort contract;
  active capacity remains occupied until the active task actually settles
  ([`queue-scheduler.js`](../../app/services/slice/queue-scheduler.js),
  `createQueueScheduler`).
- Temporary renamed/extracted/converted/oriented/transformed/profile and native
  staging paths resolve inside the marked workspace. Cleanup validates marker,
  containment, and symlink state before recursive removal; it never recursively
  removes the input or output root.
- Output names contain a sanitized source base plus collision-resistant
  `artifact-<32 hex>` identity. Responses expose `job_id` and `artifact_id`.
  Private metadata and leases support TTL/count/byte/partial cleanup without
  deleting active downloads ([`common.js`](../../app/services/slice/common.js),
  [`artifact-store.js`](../../app/services/artifact-store.js),
  [`response.js`](../../app/services/slice/response.js)).
- Startup classifies only immediate, correctly named and marked stale workspace
  children. It reports but does not delete them. The programmatic deletion mode
  additionally requires a verified exclusive lease and a stale threshold beyond
  a proven bounded lifetime plus safety margin; `server.js` never enables it in
  S1a.
- Pricing is in-memory plus bounded atomic persistence at
  `configs/pricing-state/pricing.json`. Safe legacy state is migrated;
  exclusive temp ownership, file fsync, atomic rename, supported directory
  fsync, and publish-after-persist sequencing prevent failed mutations from
  changing memory ([`pricing.service.js`](../../app/services/pricing.service.js),
  [`pricing/repository.js`](../../app/services/pricing/repository.js)).

## API and compatibility boundaries

Runtime route registration, not README lists, is canonical:

- public liveness/pricing/slicing/docs routes are registered by
  [`server.js`](../../app/server.js), [`slice.routes.js`](../../app/routes/slice.routes.js),
  [`pricing.routes.js`](../../app/routes/pricing.routes.js), and
  [`system.routes.js`](../../app/routes/system.routes.js);
- protected pricing mutations apply `adminRateLimiter` then pricing audience
  authentication; `/admin/**` uses artifact audience; `/health/detailed` and
  `/operations/**` use operations audience;
- `/health/detailed` runs fresh readiness probes; `/ready` and
  `/operations/readiness` use the bounded cache;
- `/prusa/slice` and `/orca/slice` apply rate limiting then mandatory
  `x-slicer-api-key` authentication before workspace/Multer/queue/native work;
  active/previous rotation and revocation are repository-tested; deployed
  private binding, proxy/firewall, and egress remain `UNVERIFIED`;
- `choosenFile`, stable status/error mappings, Prusa FDM/SLA, Orca FDM-only,
  profile pairing, pricing behavior, and argument semantics are compatibility
  invariants for behavior-preserving stages;
- OpenAPI is generated structurally by
  [`swagger-docs.js`](../../app/docs/swagger-docs.js); it is not a complete
  inventory of registered routes or runtime error responses.

## External executable and dependency boundaries

- `PYTHON_EXECUTABLE` must be absolute and exist, but regular-file, executable,
  ownership, and symlink provenance are not verified
  ([`app/config/python.js`](../../app/config/python.js)).
- Python helpers load untrusted geometry through `trimesh`/`gmsh`; native
  Prusa/Orca parse the resulting model and profiles. They run in the API process
  container's security domain, not an isolated worker.
- `runCommand` uses `execFile` and exact argument arrays, supplies a tested
  minimal environment, and coordinates timeout/abort cancellation across the
  exact child tree ([`command.js`](../../app/services/slice/command.js),
  [`process-tree.js`](../../app/services/slice/process-tree.js)). POSIX uses a
  detached process group; Windows uses trusted absolute `taskkill.exe` exact-PID
  tree requests. Failed termination proof retains the active slot fail closed.
- Native children no longer inherit arbitrary API environment values. I6
  repository validation denies API/native egress on its selected internal
  private-peer topology; deployed enforcement remains `UNVERIFIED`.
- Docker verifies versioned Prusa/Orca AppImage SHA-256 values, while Ubuntu
  tags, NodeSource/Apt inputs, unversioned Python requirements, action tags, and
  Compose image tags remain floating
  ([`Dockerfile`](../../Dockerfile), [`requirements.txt`](../../requirements.txt),
  [`image-validation.yml`](../../.github/workflows/image-validation.yml)).

The remaining delivery cycle is formally separated: S3a repository-only
build-once/no-deploy controls are integrated. I4 implements the local S2
resource/state and container-envelope candidate; exact active-job container
stop orchestration and live host/proxy evidence remain unproven. I5 implements
and deterministic-tests the repository credential lifecycle, protected Origin
policy, proxy/request identity, readiness, events, and metrics. Private ingress
plus denied API/native egress is blocked by the locally available Docker
capability and remains unverified on the target host. S3b owns
staging, promotion, readiness, and rollback only after complete S4 evidence and
separate explicit user/owner authorization. No repository result verifies
production topology or authorizes promotion.

## Historical S0 test and CI capability matrix

This table records the pre-implementation work baseline. Use the current S0.1
delta above for present test and audit status.

| Capability at work baseline | Evidence | Result |
| --- | --- | --- |
| JS unit/characterization suite | [`package.json`](../../package.json) has only `start`/`dev` | `ABSENT` |
| Python unit suite | Only network/native integration runners exist under [`tests/testing-scripts`](../../tests/testing-scripts) | `ABSENT` |
| Runner exit truth | Combined and three engine wrappers ignore returned `failed_count` | `PARTIAL` |
| Runtime JS syntax | [`deploy.yml`](../../.github/workflows/deploy.yml) names 11 of 32 tracked runtime JS files | `PARTIAL` |
| Runtime Python syntax | All four `app/*.py` are named, using bytecode-writing `py_compile` | `PARTIAL` |
| Validation-only CI | Only combined validation/deploy workflow exists | `ABSENT` |
| Private fixtures | [`tests/testing-files/.gitkeep`](../../tests/testing-files/.gitkeep) is the only tracked fixture | external prerequisite |
| Mirror consistency | `.github/agents` vs `.claude/agents` and `.github/skills` vs `.claude/skills` are byte-equal at this baseline | verified read-only audit |

## Change-impact map

| Change | Recheck at minimum |
| --- | --- |
| Route/middleware/auth/CORS | route order, error mapping, admin auth, OpenAPI, public contract tests |
| Queue/upload lifecycle | FIFO/concurrency/caps, real deadlines, abort cleanup, per-client counters, disk residue |
| Python/converter/transform | syntax, synthetic geometry fixtures, native arguments, timeout/tree cancellation, bounds |
| Profile selection | filename traversal, existence/compatibility, build volume parsing, Prusa/Orca matrices |
| Pricing | catalog edges, atomic persistence/rollback, protected route policy, lifecycle runner |
| Output/admin download | filename/extension, path/realpath/symlink/race, ZIP caps, retention/quota |
| Docker/dependencies | Compose config, image build, non-root/read-only state, health, SBOM/scan; S3a repository evidence first |
| Workflow/deploy | S3a permissions/triggers/immutable artifact identity and automatic-deploy separation; S3b approval/readiness/rollback after S4 topology evidence |

## Verified documentation/code discrepancies

1. `/health` is liveness only. `/ready` is intentionally minimal.
   `/health/detailed` runs fresh queue/native/storage/retention/pricing/config
   probes and additionally checks Python; `/operations/readiness` uses the
   bounded cache. This is not a real synthetic native slice.
2. OpenAPI omits docs/root routes and several 413/429/503 responses. It
   also claims default pricing entries cannot be deleted, but route/catalog code
   contains no such guard.
3. Historically, README's “zero-downtime” and broad supply-chain claims exceeded
   the in-place, floating-input deployment then implemented by
   `deploy.yml`/`Dockerfile`. S3a removed that automatic deploy path, but did not
   verify production readiness or the remaining supply-chain claims.
4. `docker-compose.dev.yml` live-mounts three Python helpers but not
   `scale_model.py`.
5. README/config example pricing differs from the code fallback in
   [`app/config/constants.js`](../../app/config/constants.js), `DEFAULT_PRICING`.

## Open unknowns

- `VERIFIED` at I10 SHA `8253160eef1c3e00c1e40826ec61fd97563ddd9b`:
  strict protected-main Source/Image required checks, PR/admin/force-push/
  deletion/conversation policy, merge-commit-only settings, empty rulesets,
  disabled required signatures, read-default Actions permission, and disabled
  Actions PR approval.
- `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`: the sole collaborator cannot
  self-approve; required approvals are zero and are not represented as review.
- `LIVE_CONFIG_VERIFIED`: `candidate-publication` environment ID `20443404498`,
  protected branches true/custom false, with exactly one `branch_policy` rule
  (ID `63481958`) and zero reviewer/wait-timer rules, secrets, variables and
  deployments as of 2026-08-23.
- `VERIFIED_I11_SIGNED_MAIN_CANDIDATE`: Candidate Publication `32667219964`
  produced digest `sha256:3cea88b5…2541ea`, attestations `42460061`/`42460068`
  and bounded artifact `9500456840` with exact cleanup.
- `PENDING_I11_REHEARSAL_CORRECTIVE`: automatic run `32667607266` failed before
  registry read/runtime on shallow-history ancestry plus an independent unset-
  identity cleanup bug. Corrective exact-SHA hosted success is required.
- Production secret delivery remains `UNVERIFIED`.
- `UNVERIFIED`: deployed commit/image and digest, intended/denied callers, VPS
  checkout cleanliness, exact reverse-proxy CIDRs/hops/timeouts, actual host
  capacity, firewall/egress, quotas, backups, monitoring, and rollback readiness.
- `UNVERIFIED`: production secret source, ownership, filesystem mode, and
  current/previous/revoked key state.
- Locally tested process-tree cancellation does not verify hostile
  archive/model parser behavior, exact Prusa/Orca metadata variants, or the
  production/container egress boundary.
- Product/browser policy now has separate protected-audience Origin controls;
  the actual deployed allowlists remain `UNVERIFIED`.

The S1a/S3a manifest freeze was wave-scoped and is closed. The serialized
dependency-maintenance patch is integrated exactly once. Future advisory work
still requires explicit serialized manifest/lock ownership and fresh
install/audit evidence.
