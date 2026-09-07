# VPS finalization continuation — 2026-09-07

## Scope and baselines

The owner requests committed, merged and deployed Bambu-based Slicer service,
and separate Claude Opus 5 execution prompts for R3DPlugin V2 and LeadPilot.
The owner also explicitly permits confidential use of the single local operator
access file and read-only verification of LeadPilot. No consumer repository or
production business data is changed by this continuation.

The original checkout remains on `codex/calculator-profile-parity-20260906` at
`714193bea52e4a6413e318e69f0b4b56916370b6`, preserving its 11 dirty tracked files
and unrelated untracked work. Fresh remote `main` is
`fc968206b426a6ca0b099decd8d09c23f61623d3`; its PR25 already incorporates the old
material catalogue repair and Bambu receipt implementation. Work proceeds in the
isolated `codex/slicer-vps-finalization-20260907` linked worktree, based on that SHA.

Live preflight confirms the previous signed image
`ghcr.io/botond1/3d-printer-slicer-api@sha256:1c784b627fc5783b633b9a0b7c2b086588fbe149c00770d7f0cac5594860efb9`,
with image revision `4539c539d15dacb19cde7e246aab690cc11170e7`, healthy,
non-root `999:999`, read-only, zero published API ports and zero restarts.
GitHub independently confirms PR25 merged and publication run34063787067 PASS.
That is the rollback baseline, not the image of the correction below.

## Reproduced defect and correction

The real `parseSliceOptions` accepts `PLA`, `pla`, `PlA` and ` PLA `, but
`validateAppliedConfig` compared raw spelling to the native canonical `PLA`.
Three accepted requests consequently failed `BAMBU_RESULT_UNVERIFIED` after
slicing. The correction applies the same request-side trim/uppercase convention
as the existing registry. Native cross-material mismatch still fails closed.

`node --test tests/unit/js/bambu-receipt.test.js` with the new regressions and
old source: exit1, 25 tests /22 pass /3 fail. With the correction: exit0,
25/25 pass, no skips. The checked-in real native fixture supplies the config and
independent JSON/G-code totals; this local fixture proof is not live slicing.
No module crosses a decomposition threshold; the existing receipt constructor's
prior split/defer decision is unchanged. No new responsibility is added to it.

The time/rate formula, direct native grams, command flags, vendor registry,
profile digest, receipt schema and all security controls stay unchanged.
`measurement_generation` changes because `bambu-generation.js` hashes the
receipt processing source. New consumer requests must refresh their catalogue
pins; old accepted business facts must not be relabelled.

## Current validation and live baseline

- `npm ci --ignore-scripts --no-audit --no-fund`: exit0,132 packages.
- `git diff --check`: exit0.
- `npm run check:syntax`: exit0;311 JS and64 Python tracked files.
- `npm run test:js`: exit0;2753/2753,0 skips.
- `npm run test:python`: exit0;226 discovered,218 passed,8 environment skips.
  Skips are not native-image proof; the production-image gate remains separate.
- `npm test`: exit0;2753 JavaScript pass and218 Python pass/8 skips.
- `node --test tests/unit/js/instruction-mirrors.test.js`: exit0;2/2 pass.
- `npm run check:repository-safety`: exit0;603 indexed paths before staging
  the new handoff/prompts. Final staged scope is checked again before commit.
- Live `/health` and `/ready`:200; protected readiness200, all probes true,
  queue empty, concurrency1. Catalogue v2 has88 rows.
- Missing/wrong slice credentials:401 `SLICE_SERVICE_AUTH_REQUIRED`.
  Both named principals:400 `NO_FILE_UPLOADED` on the same empty request,
  proving authentication only, with no native model submission.
- Live FDM rates, unchanged: PLA/ABS800, PETG/TPU900 HUF/hour. The public
  Slicer price has a900-second minimum and rounds upward to10 HUF. It is not
  automatically either consumer's commercial selling price.

Exact hosted checks, new publication, isolated native
acceptance and corrected-image deployment are release gates, not asserted by
this pre-promotion record. Record their exact identities in the completion
evidence; never replace the older release's source SHA with the new one.

## Consumer readiness and boundaries

R3DPlugin V2 already has a historically tested Bambu ZIP. Its current source,
package and live WordPress activation require the plugin lane's verification.
Use `claude-opus-5-r3dplugin-bambu-finalization-20260907.md`; do not recreate
existing implementation or infer public WordPress connectivity from a private
Slicer principal test.

LeadPilot read-only runtime inspection confirms host checkout
`9aa0c80be461c4cbaed20453a56e28bc7d615932` and running image
`sha256:2a2c0ca89fc8730d7b3c2919ed5d5a50b9495601a5d3cd7ccf262cf83a88c610`.
OCI revision is absent, so the checkout SHA alone is not image attribution.
Its slicer URL/token are present, never printed. Targeted settings reads show
slice/automatic/render/manufacturing-demand flags enabled, supports=true, and
no explicit engine or printer override. The installed runtime's pure
`resolveSettingValue` helper independently resolves the absent settings to
`bambu`, `P1S` and `elrendezes_szukseges` (exit0). LeadPilot therefore already
uses Bambu/P1S configuration; its gap is receipt/generation validation.
This reads configuration; it
does not create an actual LeadPilot quote or send business messages.

Use `claude-opus-5-leadpilot-bambu-catchup-20260907.md` for actual receipt,
generation, persistent-fact and real-queue catch-up. Preserve the existing
commercial pricing and human-approval safeguards.

The Slicer currently uses finite slice-auth migration until
`2026-11-30T00:00:00Z`. Both named principal keys work. Closing shared-key
migration requires proving both callers use their own keys before revocation;
this release does not change keys or authentication mode. Existing route and
allowlist stay unchanged. A correction in Slicer alone does not activate the
WordPress site or complete LeadPilot business acceptance.
