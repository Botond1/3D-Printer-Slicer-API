# I9/S3b ephemeral staging and rollback foundation

## Status

`I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE`

This checkpoint is a hosted-ephemeral rehearsal only. It does not deploy,
promote, contact the VPS, mutate a registry object, or establish production
readiness.

## Baseline and immutable inputs

- I8 baseline: `1fffab87960c675a053ae814d374cab331fbb14d`
- Branch: `codex/i9-s3b-staging-rollback-foundation`
- Candidate source: `1fffab87960c675a053ae814d374cab331fbb14d`
- Candidate manifest:
  `sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5`
- Candidate config:
  `sha256:b16f951a9701335b35b4ef248c2b1764d06c17f5e90ee6c2c2245bedc3026d42`
- Rehearsal-only previous source:
  `71e3a7df1972b78a7c8cc2cc03508558186027ce`
- Previous manifest:
  `sha256:26df5afe5ad48062c8e1d5213b305282d9386688e1666e2ef0a56487de5e8b6c`
- Previous config:
  `sha256:8d4de3647161d5688688191c9eb7af301d43216ab22ce0142d0a244e00c72c82`

The previous digest is not retroactively called production-approved. I9 must
freshly verify its provenance and SPDX attestations before using it as an
ephemeral rollback fixture.

## Graphify and direct source map

Graphify produced 2,838 nodes, 5,111 edges, and 177 communities from AST plus
Gemini semantic extraction. Health reported no missing endpoints or self-loops,
with 666 dangling endpoint edges, 380 collapsed same-endpoint undirected edges,
and 11 exact duplicates. The disposable graph output was removed.

Direct source confirmation:

`manifest -> read-only registry/attestation verification -> digest pulls ->
dynamic UID/GID -> production Compose previous -> private-peer readiness/Orca
-> candidate -> pricing-state readiness fault -> exact previous rollback ->
bounded evidence -> exact cleanup`.

## Implemented controls

- Exact branch push, actor, repository, remote SHA, I8 ancestry, and exact final
  `I9-Rehearsal: RUN_I9_EPHEMERAL_STAGING_ROLLBACK` trailer.
- Global non-cancelling concurrency because production Compose has fixed
  container and network names.
- Global `contents: none`; preflight `contents: read`; rehearsal only
  `contents: read`, `packages: read`, and `attestations: read`.
- Both discovery tags must still resolve to the committed immutable manifests.
  Both SLSA provenance and SPDX attestations are verified through GitHub API
  and OCI against exact I8 workflow/ref/source/OIDC identity. The temporary
  signed-verification JSON has an evidence-backed 32 MiB per-file cap because
  the exact C7 SPDX DSSE statement decodes to about 11.9 MiB; the final uploaded
  I9 evidence remains separately capped at 64 KiB.
- Both images must be `linux/amd64`, `User=slicer`, distinct, and compatible
  with one dynamically resolved positive non-root UID/GID.
- Run-owned input, output, pricing state, environment file, and evidence
  directories are bounded, canonical, non-link, mode-restricted, and excluded
  from uploaded evidence.
- Production Compose remains digest-only, non-root, read-only, internal-only,
  cap-drop/no-new-privileges, resource-bounded, and without a host API port.
- Two consecutive private-peer passes require `/health`, `/ready`,
  `/operations/readiness`, fresh `/health/detailed`, Python, all readiness
  probes, idle queue, and exact missing/wrong operations-key rejection.
- Orca 2.3.1 help plus a synthetic manifold cube slice runs against previous,
  candidate, and restored-previous config identities.
- The controlled fault changes only pricing-state mode
  `0700 -> 0500 -> 0700`. Liveness must remain 200 while readiness becomes 503
  with exactly `STORAGE_UNSAFE`.
- Rollback restores the exact previous digest under a new container ID and PID,
  then repeats the complete readiness and Orca gates.
- Bounded exact-key evidence is uploaded only after exact runtime cleanup.
  Remote immutable candidates are preserved; no prune is used.

## Local verification

- Focused manifest/evidence/runtime/workflow/final-aggregation lane:
  201/201 pass.
- Actionlint 1.7.7: pass after correcting job-level context use.
- Docker Compose config: pass on Docker Desktop 29.6.1.
- Full JavaScript: 1553/1553 pass. Python: 43 run, 42 pass, one expected
  Windows/POSIX permission skip. Syntax: 187 JavaScript and 32 Python files.
- Exact npm 10.9.8 production dependency audit: zero findings. Instruction
  mirrors: 2/2 pass. Repository safety covered 324 tracked files and each
  staged commit; worktree and exact baseline-to-candidate whitespace gates
  passed. Hosted Source/Image/I9 results remain pending at this commit-time
  checkpoint.
- Local Linux ownership/readiness rollback execution is
  `NOT_RUN_ENVIRONMENT`; Windows bind ownership cannot represent the hosted
  Linux UID/GID contract.
- Quality review split Docker operations, readiness/schema validation, peer
  probes, orchestration, and evidence into separate modules below 500 lines.
  The 353-line evidence test remains one cohesive schema/writer mutation lane;
  `writeDraft` and the unwind state machine remain pure mapping/orchestration
  functions. Further splitting is deferred until a new responsibility appears,
  because it would divide the single automatic-rollback cleanup boundary.
- The 729-line workflow is one explicit least-privilege hosted transaction.
  Factoring it into another reusable workflow/action is deferred until that can
  preserve the same job token, pulled image identities, run-owned state, and
  always-running cleanup without duplicating pulls or broadening permissions.

## Hosted correction history

Initial exact SHA `f17e4c71dbdb89958066b3c7dec9bc2a9d9c704b` passed Source run
`30623476966` and Image run `30623476931`. I9 run `30623476962` verified both
immutable identities and all four API/OCI provenance/SPDX paths, then completed
the full previous/candidate/storage-failure/rollback/Orca/runtime-cleanup
rehearsal. It failed closed after the rehearsal for two independent workflow
adapter defects:

- the always-running post-cleanup inherited Bash `-e`, so the expected
  already-absent network probe exited before its status could be classified;
- the second evidence validation call used stale expected-identity field names
  rather than the canonical evidence schema names.

The corrective delta captures absent-container/network probe status inside
explicit conditional commands, passes only canonical expected-identity keys,
removes one unsupported Buildx input, and adds one-by-one mutations. Final
code-bearing SHA `c632a75fcb83f2dbcde93d31ef0170de095c4abd`
then passed Source `30623957952`, Image `30623957930`, and I9 rehearsal
`30623957946`.

## Final hosted evidence

- I9 artifact `8790622022`: one allowlisted file, 5,033 bytes after
  extraction, SHA-256
  `ec5426bb7ca5a111eb67c241fa5b9409fc83822d5847c7345705a79b1230abab`.
  Independent local revalidation passed the exact repository/SHA/run/job and
  previous/current source/manifest/config identity contract.
- The I9 record classified itself only
  `I9_STAGING_REHEARSAL_EVIDENCE_READY`; the workflow's later final
  aggregation alone emitted `I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE`.
- Image artifact `8790673435`: six allowlisted files, 1,563,579 bytes
  compressed, upload SHA-256
  `41842232028f2aa97ddc9666bd16aafb8bdb457c7aaeacbfbf04a0fa4ccbbf05`.
- SPDX 2.3 contained 506 packages and 14,232 files. Grype 0.110.0 reported
  396 total matches, `HIGH=0`, `CRITICAL=0`, and known Swiper advisory count
  `0`.
- Exact run-local Image identity was
  `sha256:f9fc4f65c8426d07f6d78ad0c39852279ce061a3737f7202384c77a95b2efce4`
  with configured/kernel identity `999:999`; no registry object was created by
  Image Validation or I9.
- Hosted verification, runtime, evidence, action post-step, and exact cleanup
  passed. Local downloaded evidence directories were independently removed.

## Honest remaining boundary

The following remain `UNVERIFIED_NOT_AUTHORIZED`: deployed caller identity,
reverse proxy, firewall, production secret source/owner/mode/rotation state,
deployed digest, VPS state, external API/native egress, human approval/change
window, production promotion, and production rollback. No repository result or
hosted-ephemeral success may claim otherwise.

Pinned Docker login and Buildx actions own their own post-step teardown rather
than contributing an explicit I9 evidence field. Digest-reference removal
assumes the fresh hosted runner did not pre-contain the same pull, and Compose
API ownership combines exact preexisting absence with project/service labels
rather than an additional run-id label. These are retained, non-blocking
ephemeral-runner trust assumptions, not production cleanup claims.
