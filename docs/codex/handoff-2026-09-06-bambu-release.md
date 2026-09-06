# Bambu release continuation — 2026-09-06

The owner authorized using Docker on the existing VPS, then merging and
deploying after the required checks complete. This continuation supersedes
the earlier task-specific no-commit/no-publication/no-deploy boundary. It does
not weaken protected-main checks, permit bypassing failed gates, authorize
unrelated dirty-source changes, or expand public routes and caller allowlists.
The WordPress consumer is delivered as an installable ZIP; no live WordPress
installation is requested.

The previous local evidence package remains unchanged at
`C:/tmp/r3d-bambu-integration-20260906`. It includes 235 indexed artifacts,
the full task patch including its untouched native binary fixture, and
source manifests for all three consumers/producers. Native Windows results
and their limits are recorded in `handoff-2026-09-06-bambu-dual-consumer.md`.
New release evidence is under `C:/tmp/r3d-bambu-release-20260906`.

## Baseline and release order

Slicer source starts at `714193bea52e4a6413e318e69f0b4b56916370b6` on
`codex/bambu-dual-consumer-20260906`, including the preserved prior Prusa
material-profile compatibility change. The delivered 598-file manifest was
rechecked before this continuation; no file had changed. Remote `main` still
matched that HEAD and had no open PR. Both required Source and Image checks
are enforced for administrators, with strict current-main ancestry.

1. Freeze and commit the explicitly enumerated implementation and dependency
   changes, preserving the original dirty checkout and previous evidence.
2. Build and test the actual Linux image on an isolated VPS namespace with
   synthetic inputs and dedicated credentials/storage. Preserve the read-only,
   non-root, bounded native runtime and its cleanup behavior.
3. Test the actual WordPress consumer adapter/order flow against that image.
   Following the owner's clarification, further LeadPilot work is stopped;
   its previous local proof and open full-Redis gate remain separately recorded.
4. Require the exact candidate Source/Image checks, normal protected merge,
   resulting-main checks and signed manual candidate publication.
5. Qualify the immutable published digest and preserve the verified previous
   image/configuration before deployment. Keep image and operator-pack
   identities distinct. Verify readiness and a synthetic native control.
6. Deliver the compatible WordPress ZIP with source/digest/manifest evidence.
   Do not modify or deploy LeadPilot or claim physical calibration.

The owner clarified that the Slicer has a separate VPS and prohibited touching
LeadPilot. Further LeadPilot repository/deployment work is paused, and the
LeadPilot VPS must not be used for validation. The two mistakenly created
isolated test containers, their volume/network and task directory were removed;
the ten previously running service container IDs remained running, with zero
production service mutations. See `wrong-vps-cleanup.log` in the release evidence.
Resolve only the previously used Slicer VPS before any further remote action.
No VPS build, merge, publication or deployment is claimed by this document;
the release evidence ledger records their actual results.

## Linux CI correction

PR #22 head `e2df706955212cf69513537132bfb326379691ff` failed Source run
`34051652599` (one of 2728 JavaScript tests) and Image run `34051652627`.
It is not eligible for merge. The corrective branch preserves its ancestry.
`child-environment.js` now uses Windows path semantics explicitly when the
requested child platform is Windows, including during a Linux unit run.
The actual Windows child paths and Linux runtime paths stay unchanged.

The Image failure was `authenticated_readiness_unavailable`: the private-peer
validator still required the old exact readiness field set. Its strict schema
now covers the new Bambu/common dependency probes and `slicerRuntime` evidence,
including typed optional-engine absence. Unknown fields, false probes, missing
native identity and invalid versions still fail. An actual HTTP peer-probe
test exercises positive and one-field negative responses plus auth rejection.
Public readiness, network, credentials, egress and resource controls are unchanged.
The bounded probe module retains its existing scope; no decomposition threshold
is crossed. Corrective gate and native-image evidence is recorded in the ledger.

PR #23 head `2562e92b9943a2bb415f5a08dbc6dabf10b0286b` passed Source
`34057002932`, but Image `34057003005` still rejected authenticated readiness.
The peer's numeric-only optional engine version check was narrower than the
existing `engine-version.js` contract, which retains Prusa/Orca build suffixes.
The next correction matches those engine-specific grammars with the same
64-character bound; Bambu stays numeric-only. This changes qualification scripts
and tests only. Application, Dockerfile, dependencies and profile bytes remain
identical to the independently built `2562e92` native test candidate.

On the isolated VPS image, native Prusa reports
`2.8.1+linux-x64-GTK3-202409181416`. The unchanged prior peer probe rejects
the live authenticated response; the corrected probe accepts it and still proves
missing/wrong-key rejection. All four readiness/catalogue endpoints return200.
The direct Linux Bambu control exits0 with three fresh output files; its source
SHA matches the prior synthetic control. These are isolated image results,
not a production deployment claim.

## Linux integration runner closure

PR #24 head4504cf198ef32ceb146041c1afd3b486e48bc688 passed both required
checks (Source34057796091, Image34057796049); the hosted merge tree equals
its source tree. The isolated Linux native matrix passed39/39, operations7/7,
and rendering8/8. The original catalogue runner then exposed two stale test
expectations: its exact v2 row shape omitted the documented Bambu identity
additions, and its Prusa slice parity compared a material-specific result
against a request-independent generic digest.

The next test-only correction accepts exactly the three bounded Bambu hashes
and rejects missing/unknown/foreign-engine fields. Prusa parity now verifies
the material-v1 catalogue digest, exact generic-row continuity, and one valid
PLA/supports=true variant before comparing the native response. The corrected
live catalogue/Prusa gate passes11/11;18 focused Python tests cover missing,
malformed, stale and duplicate identity data. Full local gates pass2746JS and
225Python with one Windows POSIX skip. Production application and image inputs
remain byte-identical to the2562e92 native test candidate.

The existing catalogue runner exceeds the decomposition threshold. Its broad
historical refactor is deferred: new validation responsibility lives in the
small common/profile_generation_checks.py helper, with a separate unit file;
the orchestration change only selects the proper existing contract. No runtime
or public-contract changes were needed for this correction. The failed report
and corrected report are retained separately in the release evidence ledger.
