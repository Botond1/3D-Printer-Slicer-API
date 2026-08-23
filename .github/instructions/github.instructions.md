---
applyTo: ".github/**"
---

# GitHub Folder Instructions

Last synchronized: 2026-07-30

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
- Pre-C4 HEAD is `81872eda8d7c594ce3a12d79d4c02ecf9e26c6f3`; Source
  `30545194526` and Image `30545194494` are green, with Image artifact
  `8760548898`. Candidate `30545194754` published the quarantined discovery
  tag, then failed at `digest_roundtrip` when host `ps` reported `process ID
  out of range` after detach/immediate PID handling. The exact inspected PID is
  `UNVERIFIED`. Its digest
  `sha256:362149192fec548f546cd0a9744b7e9e3cb6d487fa4a825034c26c98aa1fc736`
  and config identity
  `sha256:b0217aaaf15bac65f2db565e306ded40fa611e26ea3535dfe52a1d2483ae0657`
  must remain unchanged. Attestations and candidate artifact are absent;
  cleanup succeeded; classification is
  `I8_CANDIDATE_PUBLISHED_UNATTESTED`.
- C4 applies one bounded exact-ID/image, allowlisted-state proof before both
  shared and digest runtime consumers. It requires a stable repeated positive
  PID before host `ps`, matching positive UID/GID, and post-`ps` same-state
  confirmation. Exact `running` status and false paused/restarting/dead flags
  are required; non-ready, malformed, timeout, and state-change paths fail
  closed. Failed upload storage callbacks wait for output close before
  workspace cleanup. Evidence may report `I8_CANDIDATE_EVIDENCE_READY`; only final
  enforcement after upload and both cleanup steps may report
  `I8_SIGNED_CANDIDATE_COMPLETE`, with both cleanup outcomes visible.
- Exactly one C4 commit and one normal non-force corrective push to the
  existing I8 branch are authorized. Replacement Source/Image/Publication
  results remain `PENDING`. Post-correction evidence is 734/734 affected tests,
  full JavaScript 1296/1296, and Python 42/43 pass with one expected Windows
  POSIX-permission skip. Local Docker is `NOT_RUN_ENVIRONMENT`.
- Preserve no-`main`, no-PR/merge/force-push, no-release/Git-tag, no-mutable-
  tag, no-deploy, and no-repository-setting-change boundaries.

## Required Sync Targets
When changing rules here, synchronize:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
