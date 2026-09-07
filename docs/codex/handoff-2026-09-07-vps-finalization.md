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

## Release qualification follow-up

PR27 merged correction `619022e6d32e19d749c275d8bb91ee472496478b` as
main `4f7af888d45a0fa1def59db9c85edd82addcb5e9`. PR Source34140238075 and
Image34140238074 passed; main Source34140940180 and Image34140940266 passed.
Signed publication34141512440 passed and produced
`ghcr.io/botond1/3d-printer-slicer-api@sha256:51462e6d4e3622c766bd074c4c1da5fa604c3898367ec687134027f6fbe65638`.
Both provenance and SPDX attestations passed GitHub, OCI and offline checks in
publication. Exact-source local verification also passed both predicates; the
first local SPDX verifier initialization failed and its bounded exact-digest
retry passed. Grype 0.110.0 reported 0 High/0 Critical on its September7 database.

This digest was tested in an owned, non-root, read-only, network-none container
on the authorized VPS with separate synthetic credentials and storage. The first
pull failed before container creation; one exact-digest retry succeeded. Four
native Bambu controls passed, including lowercase/whitespace material aliases,
both named consumers and supports on/off. A closed 20 mm cube yielded 1262 s,
3.96 g and 290 HUF at 800 HUF/hour; a 40 mm cube yielded 2453 s,24 g and 550 HUF.
Independent archive reads verified inner G-code/artifact hashes, material,
G-code time/mass and the integer price formula. Previous `4539c539` and candidate
both restarted ready in that isolated state. Owned containers were removed;
production and Traefik container IDs stayed unchanged. Generation was
`4b2ee8ea76405cc7a999fff5c7fc30c0f25c844e3d9574fe32054b1d44a08544`.
This is exact-image isolated evidence, not production promotion.
The bounded machine-readable record is
`evidence/vps-finalization-20260907-prepromotion.json`.

Automatic rehearsal34142373328 correctly stopped at
`source_compatibility_verification_failure`: the committed previous policy still
named the old I8 release `1fffab8796`. Both configs and production Compose differ
from that obsolete baseline. The active-route VPS cannot use the dark-route
operator substitute, and an isolated image restart is not its replacement.
Consequently this candidate was not deployed.

The corrective policy pins the actually deployed, signed `4539c539` release,
verified from publication34063787067 and the live image. Its manifest digest is
the rollback baseline above; config digest is
`sha256:7b77f8a495abb13d78d8714afc863728a435bcbdd21720d11fd9b4eccfd8bd6e`;
both attestation source ref and digest bind protected main and `4539c539`.
`verifySourceCompatibility()` freshly passes ancestor, identical configs and
identical production Compose for `4539c539` → `4f7af888`. No compatibility predicate
or policy control is weakened. Related policy/materializer/publication tests
are updated to the actual previous identity.

The I9 rehearsal also used an obsolete exact readiness schema. Its validator
is updated to require the actual Bambu/common-dependency probes and typed
`slicerRuntime` evidence, while accepting unavailable optional engines and
preserving storage-only failure injection. API response behavior is unchanged.
The release needs new exact-main checks, signed publication and a successful
automatic rollback rehearsal before promotion. The earlier failed rehearsal
remains failed; rerunning its old source would not load this corrected policy.

Qualification correction checks: the updated policy expectations first failed
against the old policy (22 tests:17 pass/5 fail, exit1). The final three policy,
materializer and publication-integration files pass 23/23 (exit0). Modern I9
readiness positives first reproduced four failures (58 pass/4 fail); the final
all-I9 suite passes 279/279, including 60 malformed-readiness subcases. Final
syntax passes 311 JavaScript/64 Python files. Full JavaScript passes 2817/2817;
Python discovers 226 with 218 pass/8 environment skips. Instruction mirrors
pass 2/2, tracked repository safety passes 606 files. Independent quality and
security review found no blocking issue; contract218 lines/test248 lines and
new helpers under60 lines need no decomposition. These local results do not
replace the new hosted/native release gates.
The final aggregate `npm test` also exits0:2817 JavaScript pass and 218 Python
pass/8 environment skips; no failed tests. Lockfile/dependencies are unchanged.
