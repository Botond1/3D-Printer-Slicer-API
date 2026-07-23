---
applyTo: ".github/**"
---

# GitHub Folder Instructions

Last synchronized: 2026-07-23

## Scope
- Keep Copilot instructions centralized in .github/copilot-instructions.md.
- Keep workflow files deterministic and minimal.
- Keep .github/skills aligned with .claude/skills.
- Any validation container that starts the API must receive a separate inert
  SLICE_SERVICE_API_KEY containing 32-256 printable-ASCII bytes and different
  from its inert ADMIN_API_KEY. Do not source, print, or export that inert value
  as hosted evidence.

## Required Sync Targets
When changing rules here, synchronize:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
