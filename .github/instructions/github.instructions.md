---
applyTo: ".github/**"
---

# GitHub Folder Instructions

Last synchronized: 2026-07-26

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
- Normal Source/Image Validation must remain read-only/no-push. Candidate
  Publication retains exact-input `workflow_dispatch` and adds `push` only for
  `codex/i8-s3a-ghcr-signed-candidate`. Only its publication job may use
  packages/attestations/OIDC write permissions, and only after the complete
  shared gate succeeds on the same once-built image.
- The push adapter derives `github.sha` and requires repository
  `Botond1/3D-Printer-Slicer-API`, ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  `ghcr.io/botond1/3d-printer-slicer-api`, and exact final non-empty trailer
  `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`. Every other event,
  branch, actor, trailer, or registry fails closed.
- Both paths emit canonical `candidate_sha`, `image_ref`, `discovery_tag`, and
  `registry_repository` outputs.
- Candidate publication is fixed to
  `ghcr.io/botond1/3d-printer-slicer-api`; refuse existing discovery tags,
  mutable tags, alternate repositories, and deploy. Downstream identity is
  exact digest only.
- Pre-correction HEAD is
  `c49bfc698d4d41041e6216c76a11144ffb386183`; Source `30163991878`
  and Image `30163991870` are green. Exactly one normal non-force corrective
  push to the existing I8 branch is authorized; corrective Source/Image/
  Publication results remain pending and no registry side effect exists.
- Preserve no-`main`, no-PR/merge/force-push, no-release/Git-tag, no-mutable-
  tag, no-deploy, and no-repository-setting-change boundaries.

## Required Sync Targets
When changing rules here, synchronize:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
