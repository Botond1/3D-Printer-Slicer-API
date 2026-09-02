# J3B — pre-orientation measurement regression, and the native acceptance envelope

Date: 2026-08-31
Owner classification: `J3_CONTAINER_VPS_MATRIX_OWNER_VERIFIED; J3B_CORRECTIVE_AUTHORIZED`
Base: `codex/j3-orientation-visibility` @ `58c0ccb4614c6f5dc25212403ecdb23f3c3a985c`

## 0. What this brief settles first

The owner ran the container/VPS matrix that J3 left as `PENDING_OWNER`. It is now
`VERIFIED`, with the results below. **The J3 orientation contract itself passed.** This
brief does not reopen it. It exists because the same run surfaced one regression that J3
introduced and two defects that J3 only made visible.

### J3 orientation contract — owner-verified PASS

Production-identical container on the VPS: image built from the exact `58c0ccb` tree
(435 tracked files, matching your count), `--read-only`, `--user 999:999`,
`--cap-drop ALL`, `--security-opt no-new-privileges`, tmpfs `/tmp` at
`uid=999,gid=999,mode=0700,size=64m`, `--memory 4294967296 --cpus 2.0 --pids-limit 512`,
log `20m`/`5`, stop-timeout 30. Container reached `healthy` on first start.

| Check | Result |
| --- | --- |
| `transform_schema: 1` on every response, success and error (K1) | PASS |
| `20x255x255` `preserve` -> 422 with full `model_transform` (K2), both engines | PASS |
| `20x255x255` `auto` -> Prusa 200, `automatic_rotation_deg [-90,-90,0]`, matrix `[[0,1,0],[0,0,1],[1,0,0]]` | PASS |
| `20x240x245` `preserve` / `auto`, both engines | PASS |
| `18x130x240` (all axes distinct): `original [18,130,240]` -> `oriented [130,240,18]` | PASS |
| requested `rotationX=90` -> `final [18,240,130]`, matrix exactly `Rx(90)` | PASS |
| `stats.object_height_mm == final_dimensions_mm.z` on every 200 row | PASS |
| default mode `auto`; `orientationMode=sideways` -> 400 `INVALID_ORIENTATION_MODE` | PASS |
| J2 regressions z230 / z260 / x300, both engines | PASS (200 / 422 / 422) |
| Your own runner, 18 cases | 14 PASS, 4 FAIL — all four are the defects in section 2 and 3, none in the orientation contract |

Two things were verified beyond the accepted matrix:

**The Euler convention matches the code that actually applies the rotation.**
[`scale_model.py`](../../app/scale_model.py) `_apply_rotations` applies X, then Y, then Z
as successive world-frame rotations, which composes to `Rz*Ry*Rx` — identical to
`rotationMatrixFromEulerDegrees` in
[`orientation-contract.js`](../../app/services/slice/orientation-contract.js). The
documented convention is not merely asserted, it is the implemented one.

**`--allow-rotations=0` was proven at the artifact level, not just the schema level.**
A `249 x 100 x 20` body was sliced in `preserve` mode and the produced G-code was
measured directly (extrusion moves above Z=2mm): **X span 248.60, Y span 99.60**. The
long axis stayed on X, and arrange translated only (object at X 3.70..252.30,
Y 78.20..177.80). The reported identity `rotation_matrix` matches the physical G-code.
Neither your runner nor the local suite inspects G-code; this closes K3 at the output.

## 1. Regression introduced by J3 — a metadata read can now 500 the request

This is the one item in this brief that J3 caused, and it is customer-facing.

### Evidence

Same request, same body, same container envelope, two images:

| Image | HTTP | Body |
| --- | --- | --- |
| `r3d-j2:local` (pre-J3) | **200** | quoted normally, `final_dimensions_mm {x:60,y:240,z:60}` |
| `r3d-j3:local` (`58c0ccb`) | **500** | `INTERNAL_PROCESSING_ERROR` |

The input was a valid, manifold, 12-facet binary STL whose facet normals are stored as
`(0,0,0)` — legal per the format, and repaired by every slicer. `prusa-slicer --info`
refuses that particular file (`Loading of a model file failed`); trimesh reads it fine,
so the post-orientation measurement succeeds.

### Mechanism

1. J3 added a `getModelInfo` call **before** orientation
   ([`pipeline.js`](../../app/services/slice/pipeline.js), `prepareProcessableModel`),
   to populate the new `original_dimensions_mm`.
2. [`model-stats.js:74-84`](../../app/services/slice/model-stats.js) swallows **every**
   `prusa-slicer --info` failure and returns `{x:0, y:0, z:0, height_mm:0}`.
3. `roundModelDimensions` in
   [`orientation-contract.js`](../../app/services/slice/orientation-contract.js) rejects
   non-positive dimensions and throws `Transform contract model dimensions are unavailable.`
4. The throw escapes as a bare 500.

The container log shows it exactly: the **first** native step completes as
`failure NATIVE_PROCESSING_FAILED` in 55 ms, the pipeline continues, orient.py and the
second measurement both succeed, and the request still ends `HTTP_5XX` — the native
slicer is never even invoked.

This is the same defect class J1C fixed for G-code metrics: **a silent zero swallowed at
the read, exploding at a consumer far away.** J1C made the metric parser loud. The model
measurement was left silent, and J3 put a hard requirement on top of it.

### Required correction

`original_dimensions_mm` is provenance metadata. It must never be able to fail a slice
that would otherwise succeed. Two parts:

1. **Make the pre-orientation measurement non-fatal.** When it is unavailable, the
   request must still complete. Do not paper over it by substituting the oriented
   dimensions silently — that would report a false `original`.
2. **Make `getModelInfo` stop returning silent zeros.** A failed measurement and a
   genuinely zero-sized model must be distinguishable at the call site. Callers that
   need a hard failure keep getting one; callers that need metadata get an explicit
   "unavailable".

**Owner decision required before you implement the wire shape.** The J3 schema, which
the owner approved on 2026-08-31, makes `original_dimensions_mm` mandatory. Relaxing it
is a consumer-visible change. Propose exactly one of:

- **(a)** `original_dimensions_mm: null` plus an explicit
  `original_dimensions_available: false`, with `transform_schema` bumped to `2`; or
- **(b)** keep it non-null by falling back to the oriented dimensions, but add a
  required `original_dimensions_source: "measured" | "fallback_oriented"` so no consumer
  can mistake a fallback for a measurement, with `transform_schema` bumped to `2`.

Recommend one, with reasons, and **stop for owner approval before writing the schema**,
exactly as you did for J3. Do not choose silently. Whichever is chosen, the height
invariant `stats.object_height_mm == final_dimensions_mm.z` stays unconditional.

**Consumer input already collected — it is evidence for the owner, not the decision.**
The LeadPilot side reports that it does not read `model_transform`,
`original_dimensions_mm` or `transform_schema` today (its shared schemas are
`.passthrough()`), so the version bump does not break it. It nonetheless argues for **(a)**,
on the ground that `(b)`'s `fallback_oriented` label reintroduces exactly the ambiguity
class J3 removed: a consumer that ignores the source field would read an oriented
dimension as the submitted one — the original defect, one layer deeper and harder to
see. A missing value fails loud; a labelled substitute fails quiet. Carry this argument
into your proposal and engage with it rather than restating it.

The plugin consumer has not answered yet. Do not record its position as known.

Also state, from code, whether any other J3 field can throw on a degraded input the way
`roundModelDimensions` does, and close those the same way.

## 2. Orca rejects models the API accepts — measured, pre-existing

Not caused by J3. The identical boundary reproduces on `r3d-j2:local`, which contains no
J3 code and no `--allow-rotations=0`. At 253 both images return the same
`material_used_g = 456.33`, so J3 changed nothing about slicing output.

All fixtures below carry correct facet normals.

| Footprint (h=20) | Orca | Prusa |
| --- | --- | --- |
| `253 x 253` | **200** | 200 |
| `254 x 254` | **500** `INTERNAL_PROCESSING_ERROR` | 200 |
| `256 x 256` | **500** | **200** |
| `254 x 100` | **500** | — |
| `100 x 254` | **500** | — |
| `253 x 100` / `100 x 253` | 200 / 200 | — |

The limit is a **clean per-axis cap at 253 mm on X and on Y, independent of the other
axis**. Native cause: `plate 1: Nothing to be sliced, ... no object is fully inside the
print volume`. The declared bound is 256, taken from `printable_area` in
`Bambu_P1S_0.4_nozzle.json` via `resolveBuildVolumeLimits`
([`profiles.js:259`](../../app/services/slice/profiles.js)). **254-256 mm is a dead zone
on both axes where validation says yes and the engine dies.**

### The same defect exists on Z, on BOTH engines, exactly at the advertised maximum

Measured after the above, with correct-normal `60 x 60 x Z` fixtures in `preserve` mode:

| Height | Orca | Prusa |
| --- | --- | --- |
| `245` | 200 | 200 |
| `248` | 200 | 200 |
| `249` | 200 | 200 |
| **`250`** | **500** | **500** |

`printable_height` is `250`, and validation accepts it because the comparison is
`dimensions[axis] > buildVolumeLimits.max[axis]`
([`profiles.js:306`](../../app/services/slice/profiles.js)) — `250 > 250` is false.

### RESOLVED — the Z ceiling depends on the requested layer height

Your J3B pre-measurement reported `250` PASSING on both engines, contradicting the FAIL
above. **Both measurements were correct.** The missing variable is the layer height. You
were right to refuse to overwrite the FAIL evidence with one local PASS; the resolution is
that the two runs used different layer heights.

Measured on the candidate image, `60 x 60 x Z`, `preserve`, both engines identical:

| Height | Layer | Layers | Result |
| --- | --- | --- | --- |
| `250` | `0.1` | 2500 exact | 200 |
| `250` | `0.2` | 1250 exact | 200 |
| **`250`** | **`0.3`** | **833.33 — not exact** | **500** |
| `249.9` | `0.3` | 833 exact | 200 |
| `245` | `0.3` | 816.67 — not exact | 200 |

The rule: **at the ceiling, the model height must be an exact multiple of the layer
height.** Non-divisibility on its own is harmless — `245` at `0.3` slices fine — because
the overshoot only matters when the top layer would cross `max_print_height`. So the
usable Z is the largest multiple of the layer height that is `<= 250`:

| Layer height | Usable Z |
| --- | --- |
| `0.1` | `250.0` |
| `0.2` | `250.0` |
| `0.3` | **`249.9`** |

**Owner decision 2026-08-31:** the catalogue publishes **one conservative number,
`249.9`** — the strictest across the offered layer heights — not a per-layer-height Z.
The 0.1 mm given up at `0.1` and `0.2` is worth nothing; what it buys is that the accepted
envelope does not move under the customer when they change quality. A verdict that flips
on a quality toggle is the same confusion class the plugin consumer just reported against
our layer-height-dependent bed shape, and we are not going to ship a second instance of it
while fixing the first.

Do not implement a per-layer-height Z. If you find a layer height offered anywhere that
makes the strictest value lower than `249.9`, report it rather than silently lowering the
published number.

This is reachable by ordinary customer models, and auto-orientation walks straight into
it: laying a tall model flat is exactly the operation that maximises footprint. Your own
runner's `orca-p1s-primary-default-auto` and `orca-p1s-primary-explicit-auto` failures
are this, and nothing else — `20x255x255` auto-orients to a `255x255` footprint.

### Required correction

Two separable things; do not merge them.

1. **No native placement or volume rejection may surface as a bare 500.** A model the
   engine refuses to place is a bounds outcome, not an internal error. Map it onto the
   existing `MODEL_OUT_OF_PRINTER_BOUNDS` 422 contract, carrying the full
   `model_transform` exactly as K2 requires, so the consumer can write the right customer
   sentence. This is the safety net and it must hold even when the number in (2) is
   wrong.
2. **The validation bound must be the engine's proven capability, per engine.** The
   vendor profile must keep the true 256 bed — it is also handed to Orca at slice time,
   so do not falsify it. Introduce an explicit, configurable, per-engine usable-envelope
   derate applied at validation only, seeded from measurement, and surface the effective
   number in the profile catalogue so consumers read one authoritative value.
3. **Whatever the catalogue publishes must be the largest value that PASSES, not the
   declared maximum.** This is a consumer requirement and it is well founded. The plugin's
   `PricingEngine::evaluateEnvelope()` tests `$dims[$axis] > $limit` — the same comparison
   shape as our own `profiles.js:306`. So if we publish `250` as the maximum, the consumer
   admits a 250 mm model and we then reject it: the exact off-by-one this brief exists to
   close, reproduced one system away, because the field is named "max" while its semantics
   are "this value still works". If the sweep says 249 passes and 250 fails, the published
   number is **249**. Name the field so its inclusivity is unambiguous, and state the
   semantics in the catalogue's own documentation rather than leaving it to convention.

Measure the derate yourself rather than copying 253 from this brief — a number I measured
on one profile is a seed, not a contract. Sweep both axes on both engines, on the exact
candidate image, and record the method. Prusa's own edge is not established: it slices
`256 x 256`, but nobody has found where it stops.

## 3. H2D through Orca does not work at all

Your runner's other two failures: `orca-h2d-primary-auto` and `orca-h2d-primary-preserve`
both return **422 `ORCA_PROFILE_INCOMPATIBLE`**, in `auto` and in `preserve` alike. The
machine profile is a generic Marlin placeholder — `configs/orca/H2D-PROFIL-TODO.md`
already records this as unfinished.

The consequence reaches beyond this repo: the plugin quotes a `350 x 320 x 325`
guarantee ceiling derived from the H2D. **That ceiling is not servable today.** A listed
printer whose every slice is a 422 is worse than an unlisted one.

### OWNER DECISION 2026-08-31 — this stop point is resolved, implement it

The owner has decided, and this replaces the "propose and stop" instruction that stood
here:

> Keep the `350 x 320 x 325` limit. Do not deliver it with an H2D profile. Instead take
> the **P1S profile and enlarge its bed to the H2D size**, and keep that size. We must be
> able to quote at that size in any case.

That is the right shape technically: the incompatibility is in the placeholder machine
preset's pairing with the process preset, not in the bed dimensions. The P1S machine
profile is proven to slice. Deriving from it and raising `printable_area` and
`printable_height` keeps the working preset chain and removes the 422.

Four constraints on the implementation, all of which must be visible in the result:

1. **The Prusa path matters more than the Orca one here.** The plugin consumer calls
   **only** `POST /prusa/slice` — it has confirmed there is no `/orca/slice` call
   anywhere in its source. The `350 x 320 x 325` promise is served through Prusa, so
   enlarging only the Orca machine profile would leave the owner's decision unimplemented
   for the consumer that actually depends on it. Enlarge the envelope on **both** engines,
   and say explicitly in your report which files you changed for each.
2. **Measure the enlarged envelope; do not declare it.** Section 2 shows a per-axis derate
   on Orca and a hard failure at exactly the declared Z maximum on both engines. Assume
   the same classes of defect reappear at the new size until a sweep says otherwise. The
   declared bound must be what you measured, on the candidate image, per engine, per axis.
   If the real ceiling comes out below `350 x 320 x 325`, report the number — do not round
   it up to match the promise.
3. **Record what this quote actually is.** A P1S machine preset on an H2D-sized bed
   estimates time and material with P1S physics. The H2D is a different machine, so the
   estimate is an approximation, and it will most likely be conservative — a slower
   machine's numbers mean the price errs high rather than low, which is the safe direction
   commercially but is not accuracy. Document this in the evidence file so nobody later
   reads the estimate as machine-accurate.
4. **The artifact is not production G-code for the H2D.** Quoting is the authorized use.
   State this where the profile is defined, so a future reader cannot mistake the output
   for something shippable to that printer.

Do not author a physically accurate H2D profile — that still needs hardware measurement
and is still out of scope.

## 4. Correction to the owner's own measurements — read this before trusting section 2

While measuring, the owner generated STL fixtures with facet normals written as
`(0,0,0)`. `prusa-slicer --info` rejects some of those files depending on geometry. That
produced a false finding — an apparent height-dependent failure at `60 x 60 x 240` — which
**is retracted**: with correct normals that body slices fine (200, `final [60,60,240]`).

Every number in section 2 was re-measured with correct-normal fixtures and stands. The
zero-normal fixture was retained deliberately, because it is what exposed section 1.

**Apply this to your own harness.** `orientation_visibility_test_runner.py` synthesises
ASCII STL cuboids and remeasures their vertices, which is good, but vertex remeasurement
does not prove the file is loadable by the native binary. Add a fixture precondition that
asserts each generated file is accepted by `prusa-slicer --info` before it is used in a
matrix row, so a fixture defect can never again be reported as a service defect. Then add
a deliberate unreadable-mesh row for section 1.

## 5. Acceptance matrix

Local gates as usual, plus:

| Case | Expected |
| --- | --- |
| unreadable-but-sliceable mesh (zero-normal STL), both engines | **200**, with the approved `original_dimensions_mm` degradation shape, never 500 |
| same input on `r3d-j2:local` | still 200 — proves the regression is closed, not moved |
| `253 x 253 x 20` Orca preserve | 200, `material_used_g` unchanged at `456.33` |
| `254 x 254 x 20` Orca preserve | **422 `MODEL_OUT_OF_PRINTER_BOUNDS`** with full `model_transform`, not 500 |
| `254 x 100 x 20` and `100 x 254 x 20` Orca preserve | 422, per-axis |
| `20 x 255 x 255` Orca **auto** | 422 with `orientation_outcome: applied` — "does not fit even laid down" |
| `20 x 255 x 255` Prusa auto / preserve | unchanged: 200 / 422 |
| `256 x 256 x 20` Prusa preserve | unchanged 200 — the derate is Orca's, not global |
| every J3 row in section 0 | unchanged |
| G-code footprint of `249 x 100 x 20` Orca preserve | unchanged X≈248.6 / Y≈99.6 |

The owner will re-run the container matrix on the VPS. Report the derate you measured,
the sweep that produced it, and the argv the candidate image actually used.

## 6. Boundaries

Unchanged from J3, and none of them are relaxed:

- No push of `claude/sz-b2-orca-headless`. It contains real customer names, lead IDs and
  order numbers, and this repository is **public**.
- No registry publication, no deployment, no image promotion.
- No route activation, no Traefik mutation, no DNS change, no allowlist change. Route
  activation requires direct owner confirmation and is not in scope here.
- No consumer repository is touched.
- API key values stay out of chat, commits, evidence files and reports.
- `bambu-leolvasas/` (since 2026-09-02: `input/bambu-leolvasas/`, gitignored) access stays limited to `vendor-profilok/`.
- Work on a branch off `codex/j3-orientation-visibility`; leave the worktree clean; keep
  this prompt out of the commit.

## 7. Sequencing note

`origin/main` is at `0dedbe1` (the J1C merge). **J2 (`9b28b95`) is not in main**, and J3
sits on top of J2. Whatever lands must preserve that order. Do not merge anything as part
of J3B; the owner decides the merge.

**This is more urgent than it looks, and J2 is the fix.** The plugin consumer reported
that our Prusa build volume changes with the requested layer height. Verified against
`origin/main`:

| Profile | `origin/main` (what production runs) | J2/J3 branch |
| --- | --- | --- |
| `FDM_0.1mm.ini` | `bed_shape` **220x220**, no `max_print_height` | 256x256, `max_print_height = 250` |
| `FDM_0.2mm.ini` | `bed_shape` 256x256, no `max_print_height` | 256x256, `max_print_height = 250` |
| `FDM_0.3mm.ini` | `bed_shape` **220x220**, no `max_print_height` | 256x256, `max_print_height = 250` |

The consumer exposes all three layer heights and the layer height selects the profile, so
today **the same model is accepted at 0.2 mm and rejected at 0.1 mm** with nothing to
explain it to the customer. J2 already unifies all three and adds the missing
`max_print_height`. The fix exists and is sitting unmerged and undeployed. Do not re-fix
it in J3B; just do not regress it, and keep it in view when the merge is sequenced.

**Correction to an earlier version of this brief.** This section previously said the
defect "is live in production right now" and used that to raise the bar on J3B. That was
overstated and is withdrawn. The defective code is deployed, but **no consumer is live**:
the plugin has no production deployment, no traffic and no customers, and LeadPilot's
slicing path is not switched on either. Customer exposure today is **zero**, not
"bounded". The defect is real and must be fixed; it is not urgent, and nothing in this
brief should be rushed on the strength of it.

**Owner decision 2026-08-31 on sequencing:** J2, J3 and J3B ship together, in one merge
and one deploy, after J3B is verified. There will be no interim J2-only release, because
J3B changes the envelope numbers and the profile files themselves, so an intermediate
deploy would have to be redone. That decision stands unchanged on the corrected facts —
with zero live exposure it is better supported than when it was made. Keep the profile
files consistent across all three layer heights in whatever you change.

## 8. Stop points

Stop and report, without implementing, at exactly one point:

1. the `original_dimensions_mm` degradation shape (section 1) — owner schema decision.

The H2D question that stood here as a second stop point **has been decided by the owner**
(section 3) and is now authorized work, not a proposal. Everything else in this brief is
authorized to implement.

Note on the remaining stop point: **neither consumer reads these fields today.** Both the
plugin and LeadPilot have now confirmed, from their own source, that they consume only
`final_dimensions_mm` out of `model_transform`; there is no read of `transform_schema`,
`original_dimensions_mm`, `orientation_mode`, `orientation_outcome` or `rotation_matrix`
in either codebase. So `transform_schema -> 2` breaks nobody, and the decision is a design
decision rather than a migration. Both nonetheless argue for **(a)**, independently and
for the same reason. Weigh that as engineering judgement from non-dependent parties, which
is what it is — not as a migration constraint.
