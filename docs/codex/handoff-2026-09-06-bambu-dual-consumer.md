# Local Bambu dual-consumer candidate — 2026-09-06

Local, uncommitted implementation; no release or deployment. The copied Prusa
material-v1/v3 compatibility fix remains. Historical wave/audit files are unchanged.
Common evidence root: `C:/tmp/r3d-bambu-integration-20260906/`; start at
`REPORT.md`, then `TEST_REPORT.md`, `CONTRACT.md`, `EXAMPLES.md`,
`MIGRATION_ROLLBACK.md`, `EVIDENCE_INDEX.json` and `original-state-closure.json`.

## Baselines

- Slicer HEAD `714193bea52e4a6413e318e69f0b4b56916370b6`,
  `C:/tmp/r3d-bambu-slicer-20260906`.
- Plugin HEAD `334345d20c6a41540e121a7843ed8a045a22f397`,
  `C:/tmp/r3d-bambu-plugin-20260906`.
- LeadPilot HEAD `51d479209db7bf1e8f1b1d9906148261a44b3c54`,
  `C:/tmp/r3d-bambu-leadpilot-20260906`.

All use branch `codex/bambu-dual-consumer-20260906` without new commits.
Manifests and task deltas separate copied owner changes from this work.

## Verified design

`bambu-source.js`/`inspect_mesh.py` require a closed, consistently wound,
positive-volume, single connected solid without repairing source geometry.
Bambu measures it independently of Prusa. Strict3MF admission allows one
object/build instance and rejects external/component references before conversion.

`bambu-generation.js` binds startup native components, frozen registry/resolved
vendor chain and processing-source hashes. Native components are checked again
before/after execution. `bambu-receipt.js` checks actual G-code configuration
against selected snapshots and compares independent result.json totals at native
output precision. `bambu-artifact.js` requires the project's sole plate G-code
to match the parsed standalone G-code. The typed receipt preserves exact source,
normalized/final hashes, schema2 transform, scope, raw estimates and private
artifact identity. Unknown subtotals remain null; total time includes startup.

Optional expected profile/generation pins reject malformed input400 before queue
and stale input409 before native execution. Updated consumers require them for
new automatic Bambu work. Effective-profile hash meaning, `choosenFile`, integer
pricing, route controls and optional-engine wire formats are preserved.

Startup requires Bambu/common Python dependencies. Optional engines retain
separate status and unavailable routes return typed503 after authentication,
before workspace allocation. Public readiness stays minimal. Protected readiness
checks native files and dependency presence after a startup import check; it does
not claim a fresh Python import on every request.

## Review and evidence limits

Normal Windows API/native and actual Woo/WordPress/MariaDB/ActionScheduler
order creation were exercised. LeadPilot uses native HTTP, PostgreSQL and real
business services, with an explicit Redis transport seam. Exact Linux image is
BLOCKED (Docker daemon absent); full Redis queue E2E is BLOCKED (Redis7 absent).
Final counts, failures, hashes and cleanup are in the common ledger.

Split/defer: new domains are separate source/generation/receipt/artifact/hash
modules. The receipt constructor remains slightly over60 lines to preserve its
ordered trust checks and single construction. Existing large bootstrap/pipeline
modules get wiring only. The existing >250-line native runner is extended through
common helpers, with no second overlapping test system.

R3D-SLICER-104 remains partial: source/code/mesh identity is retained, but public
receipt normalization is generic, without a full typed CAD tool-version,
tessellation and original-unit record. Physical tolerance is not approved here.
Windows GUI stdout warning capture is incomplete; available warnings are bounded
and retained, but no warning does not prove absence of native uncertainty.
`/render` keeps its existing Prusa measurement dependency and separate tests;
render failure does not invalidate completed Bambu slicing.

The plugin180s HTTP deadline can expire before producer600s budgets. Bounded
tests do not establish worst-case latency, response-loss exactly-once execution,
production proxy deadlines or p95/p99. No external AI/SMTP/Telegram/payment,
SSH, shared database, registry or production mutation was performed. Further
environment gates and rollout require separately authorized work.
