---
applyTo: ".github/**"
---

# GitHub Folder Instructions

Last synchronized: 2026-08-23

## Scope
- Keep Copilot instructions centralized in .github/copilot-instructions.md.
- Keep workflow files deterministic and minimal.
- Keep .github/skills aligned with .claude/skills.
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
  publication/evidence cleanup. I11 implementation and hosted results remain
  `PENDING` until observed.
- Successful protected-main publication automatically triggers only the
  completed/main `workflow_run` rehearsal. It validates one exact bounded
  publication artifact, creates the policy/provenance-derived previous/current
  digest-only manifest, verifies per-image SLSA/SPDX through API and OCI, and
  runs hardened I9 readiness, `STORAGE_UNSAFE`, automatic rollback, bounded
  evidence and exact cleanup with read permissions only. Its result is
  `PENDING` until observed.
- Candidate publication is no-deploy. Hosted S4/S5/I9 evidence is ephemeral and
  does not verify production proxy/firewall/secrets/digest/VPS/readiness/
  rollback or grant production authority.

## Required Sync Targets
When changing rules here, synchronize:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
