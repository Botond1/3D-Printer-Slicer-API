---
applyTo: ".github/**"
---

# GitHub Folder Instructions

Last synchronized: 2026-07-25

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
- Normal Image Validation must remain read-only/no-push. Manual Candidate
  Publication alone may use packages/attestations/OIDC write permissions, and
  only after the complete shared gate succeeds on the same once-built image.
- Candidate publication is fixed to
  `ghcr.io/botond1/3d-printer-slicer-api`; refuse existing discovery tags,
  mutable tags, alternate repositories, and deploy. Downstream identity is
  exact digest only.
- Current I8 publication is `BLOCKED_PREFLIGHT`: a newly added
  `workflow_dispatch` workflow must be registered on the default branch, while
  changing `main` is outside the current authorization.

## Required Sync Targets
When changing rules here, synchronize:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
