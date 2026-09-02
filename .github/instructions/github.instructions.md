---
applyTo: ".github/**"
---

# GitHub Folder Instructions

Last synchronized: 2026-09-02

## Scope
- Keep Copilot instructions centralized in .github/copilot-instructions.md.
- Keep workflow files deterministic and minimal.
- Keep .github/skills aligned with .claude/skills.
- Image validation builds the three-engine image (PrusaSlicer 2.8.1,
  OrcaSlicer 2.3.1, Bambu Studio 02.08.02.61). The Dockerfile pin check covers
  the Bambu AppImage URL/SHA-256, the root-owned `bambu-studio` wrapper, the
  Xvfb/GL/GStreamer runtime packages, and `init: true` in both Compose
  manifests; candidate provenance evidence uses schema
  `i7-s3a-candidate-provenance-v2`. The exact-image runtime probe verifies all
  three executables.
- Any validation container that starts the API must receive distinct inert
  active slice, pricing, artifact, and operations keys; previous slots are
  included only when the rotation contract is under test. Every value must meet
  the 32-256 printable-ASCII/non-placeholder rules and be unique across slots.
  Do not source, print, or export credential values as hosted evidence.
- Topology validation must fail closed unless the exact candidate proves both
  intended private ingress and API/native DNS-TCP-UDP egress denial. A Docker
  Desktop internal bridge without a host listener is a capability blocker, not
  a pass or authority to invent a sidecar.
- I10 live policy is verified at main SHA
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`; Source `32662043454` and Image
  `32662043476` succeeded. Strict main protection binds both no-deploy contexts,
  requires a PR, includes administrators, forbids force-push/deletion, requires
  conversation resolution, and permits merge commits only. Required approvals
  are zero because the sole collaborator cannot self-approve; required
  signatures are not enabled.
- Normal Source/Image Validation remains read-only/no-push/no-deploy. I11
  Candidate Publication is manual `workflow_dispatch` only from exact current
  protected `main`; push/PR/merge-group/schedule/repository-dispatch paths fail.
- Preflight requires exact repository `Botond1/3D-Printer-Slicer-API`, actor
  `Botond1`, `refs/heads/main`, requested/event/checkout/remote SHA, post-I10
  ancestry and fixed registry `ghcr.io/botond1/3d-printer-slicer-api`.
- `publish_new` requires an empty digest input, exact
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and a proven-absent SHA-derived tag before the
  fully gated once-built image may be pushed.
- `recover_exact_digest` requires exact
  `RECOVER_SIGNED_MAIN_CANDIDATE` and one lowercase `sha256:<64 hex>` already
  matching the tag manifest and once-built image config. Recovery must not push,
  overwrite or delete registry content.
- Only the publication job may use packages/attestations/OIDC write permissions.
  Bind it to environment `candidate-publication` with `deployment: false`.
  Environment ID `20443404498` is `LIVE_CONFIG_VERIFIED` on 2026-08-23:
  protected branches true, custom branch policies false, exactly one
  `branch_policy` protection rule (ID `63481958`), and no reviewer/wait-timer
  rules, secrets, variables or deployments.
- Candidate publication uses exact digest-only identity and never creates
  mutable/release/staging/production tags. Evidence must distinguish
  `published_new` from `recovered_existing`; recovery cannot claim tag absence,
  image push or registry write.
- `I11_MAIN_SIGNED_CANDIDATE_COMPLETE` is reserved for final enforcement after
  digest identity, attestations, verification, bounded upload and exact
  publication/evidence cleanup. I11 completed at protected-main SHA
  `65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
  `32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
  `32669484893` succeeded.
- Successful protected-main publication automatically triggers only the
  completed/main `workflow_run` rehearsal. It validates one exact bounded
  publication artifact, creates the policy/provenance-derived previous/current
  digest-only manifest, verifies per-image SLSA/SPDX through API and OCI, and
  runs hardened I9 readiness, `STORAGE_UNSAFE`, automatic rollback, bounded
  evidence and exact cleanup with read permissions only. The exact I11 hosted
  result is the successful run above.
- Candidate publication is no-deploy. Hosted S4/S5/I9 evidence remains
  ephemeral repository proof. I12 separately verifies one historical exact
  dark N=1 API digest and corrected proxy topology on the authorized VPS.
- Protected main `bf5e712071e3174a67fdb22ff3794003fa3ab32b` passed the
  read-only/no-deploy Source and Image workflows and Candidate Publication run
  `33449382579`. The owner first reported that exact signed digest deployed dark
  with the later J2/J3/J3B operator pack: `/health` and `/ready` returned
  200, all four catalogue entries exposed their inclusive values alongside the
  declared values, the Orca 254.0 mm
  negative returned schema-2 `MODEL_OUT_OF_PRINTER_BOUNDS`, and the 253.9 mm
  boundary completed a real slice. The owner also reports an actual-host
  candidate-to-previous-to-candidate application rollback with each target
  healthy within 15 seconds and the recovery set retained.
- Automatic no-deploy rehearsal run `33450012850` remains correctly failed
  closed with `source_compatibility_verification_failure` for the intentional
  `configs/` change. The owner-host round trip is accepted only as the runbook's
  dark-route application rollback substitute; it does not make CI green or
  prove source compatibility. A later owner-supplied execution record reports
  exact `router_activation=PASS phase=leadpilot-only entries=1`, certificate
  issuance, allowed-source HTTP 200, external unlisted-source plain HTTP 403,
  and redirect-follow completion on public 443. A later owner-supplied record
  proves the separate IPv4 deny counters with caller-visible timeout, IPv6
  `INPUT` block, three-IPv4 plus one-IPv6 idempotency, and Docker-service restart
  survival. One owner-observed normal reboot then preserved the active/enabled
  perimeter service, same 3+1 rules, healthy current containers, allowed
  200/TLS, IPv6/443 block, port-80/ACME path, loopback 403, and the stopped old
  proxy's empty runtime port map. It closes the exact point-in-time perimeter-
  persistence exit but does not generalize to future reboots or crash/power-
  loss recovery. Successful
  HTTP-01 issuance does not prove the forced-renewal rehearsal. This repository
  change is documentation-only. Public router rollback/final-dark, monitoring,
  backup/recovery acceptance, customer traffic, and full production acceptance
  remain unverified and separately authorized.

- The historical I10/I11/I12 and route-activation facts below this line are
  preserved verbatim in `docs/codex/history-waves.md`; the 3.2.0 Bambu engine
  overhaul is integrated on `feat/bambu-engine-overhaul` and is not yet
  published, deployed, or routed. Publication remains the manual I11
  `workflow_dispatch` from exact protected `main`.

## Required Sync Targets
When changing rules here, synchronize:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
