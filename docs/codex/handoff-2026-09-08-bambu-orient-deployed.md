# Bambu-orienter release 3.4.0 — deployed 2026-09-08 (Europe/Budapest)

Automatic orientation on `POST /bambu/slice` now follows Bambu Studio's own
orienter (PR #30, merge `00eecba550f7ed6037a8850dce52af1f54faacd7`). The owner
authorised the VPS change and the GitHub process on 2026-09-08 ("telepítsd a
slicer ágat a vps-re, mehet a github folyamat"). No other consumer, route,
allowlist, pricing or credential changed.

## Immutable identities

- Source: PR #30 head `06944dde7e010a9a1eb19e1b9034000f2a4e47ee`, merge
  `00eecba550f7ed6037a8850dce52af1f54faacd7` on protected main. Required PR
  checks: Source validation run 34273063222 PASS (48 s), Image validation run
  34273063329 PASS (6 m 46 s).
- Signed publication: run 34273830267 (`publish_new`,
  `PUBLISH_SIGNED_MAIN_CANDIDATE`), image
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:8362ca36ba7852941da1807a795358fa8ec7b71cb9d3915dbbd3f0e7cbbaf155`
  (discovery tag `candidate-00eecba550f7ed6037a8850dce52af1f54faacd7`), run
  completed `success` at 20:27 UTC. The run's own verification passed; an
  independent local `gh attestation verify` (repo, cert identity
  `…/candidate-publication.yml@refs/heads/main`, signer/source digest = merge
  SHA, GitHub OIDC issuer) returned one entry each for
  `https://slsa.dev/provenance/v1` and `https://spdx.dev/Document/v2.3`, both
  with subject `sha256:8362ca36…`.
- Previous production image (rollback):
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:b3b7a616daa34f2635a9df8040d4b26b13a4cdd32c341de7023565a26d3eab99`
  (source `8bf11c9661c4c6bab7ff2b8343db40a6134f15a0`), retained as
  `local/rocket3d-slicer-api:retained-8bf11c9661c4c6bab7ff2b8343db40a6134f15a0`.
  The candidate is retained as
  `local/rocket3d-slicer-api:retained-00eecba550f7ed6037a8850dce52af1f54faacd7`.
- Operator pack stays `4fb770d792eac932f02a6c9b3f407a7822a1996b`; operator
  values file `compose-n1-exact-configs.env` (only `SLICER_API_IMAGE` changed;
  the previous file is kept root-private under `/root/r3d-backup-20260908-orient/`).
  Compose project `slicer-api`, `--no-deps --pull never`. Traefik, perimeter,
  service env, pricing state and mounts unchanged.

## Cutover evidence (bounded)

Cutover 2026-09-08 ~20:28 UTC with `/root/r3d-orient-control-20260908/deploy-orient.sh`
(root-private; keys are read into the shell only for the control slice and never printed):

- before: `sha256:b3b7a616…`, 0 restarts, healthy;
- `docker pull` of the digest; `org.opencontainers.image.revision` =
  `00eecba550f7ed6037a8850dce52af1f54faacd7`; bounded `/usr/bin/id` → `999:999`;
- retention tags created for both roles (W0), no retarget;
- `scripts/i7-production-compose-contract.js` → `production_compose_contract=PASS`;
  `docker compose -p slicer-api … config --images` renders exactly the candidate;
- operator values file backed up, `SLICER_API_IMAGE` rewritten atomically;
- `docker compose -p slicer-api --env-file … -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api`:
  container recreated, **healthy after 6 s**, runtime identity
  `<candidate ref> <candidate id> running true 0 false`, project `slicer-api`;
- `/ready` 200 at once, `/health` OK; `GET /profiles?contract=material-v1` →
  `r3d-profile-catalogue-v3`, 88 rows, 52 Bambu rows, Bambu
  `measurement_generation` **`c4082079ad2a61ba7322abda491733cd5455872ac651a451431713e4026c92ec`**
  (was `dd08df79…` on 3.3.0 + receipt);
- `POST /bambu/slice` without a key → 401;
- control slice through the production container, tilted 60 x 24 x 8 mm box,
  `orientationMode=auto`: `orientation_outcome: applied`, final
  51.86 x 63.685 x 8 mm, 974 s, 6.27 g, 5.3 s wall — the Bambu pose, not the
  former 39.6 mm heuristic pose;
- events since start: 8 `native.started/completed`, 1 `startup.completed`,
  1 `readiness.changed`, 1 `profile_catalogue.changed`, 1 `auth.rejected`
  (the negative-auth probe), no `orientation.fallback` /
  `orientation.reference_fallback`.

The full dark qualification matrix (twice, with a private peer and egress
denial) from the runbook was NOT repeated: this cutover reused the qualified
pack, network, mounts and envelope and changed only the image digest. What was
proved: revision label equals the merge SHA; service identity 999:999 from a
bounded `/usr/bin/id` container; compose contract script and rendered image;
runtime identity (configured reference, image id, running, 0 restarts, no OOM);
compose project label; `/ready` 200 and `/health`; catalogue schema, row count
and the new Bambu `measurement_generation`; 401 without a slice key; one control
slice of the tilted 60 x 24 x 8 mm box through the production container with
the production key (never printed).

## What changed for consumers

- The WooCommerce plugin re-reads the catalogue's `measurement_generation`
  before pinning new requests; on the staging calculator a never-seen tilted
  box (58 x 22 x 7 mm) was priced 2026-09-08 20:30 UTC through the deployed
  image: fresh slice, locked in 9.3 s, `print_pose` present, the part shown
  lying flat (7 mm high) with the "Nyomtatási helyzet" chip — the Bambu pose
  (`docs/release/frontend-final-2026-09-08/screenshots/final17-orient/` in the
  plugin repository).
- LeadPilot receives the same contract; quotes for models that Bambu orients
  differently from the heuristic change (typically less height, fewer supports).

## Rollback

`sh /root/r3d-orient-control-20260908/deploy-orient.sh <candidate_ref> <candidate_sha> rollback`
restores the backed-up operator values file and brings `slicer-api` up from the
previous digest with the same compose invocation. Both images carry retention
tags, so the prune cron cannot remove either. Rollback was prepared, not
exercised.
