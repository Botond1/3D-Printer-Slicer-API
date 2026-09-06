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
