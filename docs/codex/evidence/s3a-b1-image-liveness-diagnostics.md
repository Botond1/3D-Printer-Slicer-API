# S3a-B1 image liveness diagnostics and fail-closed aggregation evidence

Date: 2026-07-22

## Scope and identity

- Code baseline: `58dcf1065ff39b6da1ba72d0d9c910d788a843ab`.
- Work baseline: `1d374f752f6f46f07af640843203b3a01a86c24e`.
- The work baseline contains only this stage's prompt and has the code baseline
  as its direct parent.
- Branch: `codex/s3a-b1-image-liveness-diagnostics`; work started in a clean
  linked worktree.
- Runtime/Docker root cause: `UNVERIFIED`. No runtime or Docker source fix is
  included.

## Hosted baseline verification

The public GitHub Actions API confirms exact head SHA
`58dcf1065ff39b6da1ba72d0d9c910d788a843ab` for both baseline runs.

- Source Validation run `29683094252`, job `88182625416`: success. Exact
  resolution, checkout, identity, setup, install, syntax, workflow contracts,
  unit tests, audit, repository safety, and candidate-range whitespace steps
  all completed successfully.
- Image Validation run `29683094245`, job `88182625487`: failure. Candidate
  resolution, checkout, identity, Buildx, one local image build, image identity,
  and inert container start succeeded. The bounded liveness step failed;
  SBOM/SPDX/Grype steps were skipped; the evidence boundary then failed;
  cleanup succeeded.
- Public annotations contain the liveness `exit 1`, evidence-boundary `exit 2`,
  and a GitHub Actions Node.js 20 deprecation warning. Public job logs require
  authentication and returned HTTP 403, so no startup log was available.
  Action SHA maintenance is deferred to the separate S3a-B2 lane.

## Characterization

- `4f55062096d57a9245282b686fd8619c29c473e8` and the code baseline have
  byte-identical Dockerfile, Compose, image workflow, and Python-resolution
  blobs. The later integration delta does not itself identify a Docker change.
- Original S1a commit `e7a409566bb8795a22f38bbf9f514b42c51bda74`
  and integrated commit `a266526335f9e20bb5b447e97505feabbe653ca8`
  have the same stable patch identity for startup/path behavior.
- The image runs as `slicer`, uses `node server.js`, exposes port 3000, and
  carries an internal `127.0.0.1:3000/health` Docker healthcheck. The inert run
  preserves `--network none`, `--cap-drop ALL`, `no-new-privileges`, PID limit,
  exact input/output tmpfs mounts, no host port/bind, and an inert admin key.
- S1a creates and canonicalizes `/app/input/.slice-jobs`, audits it before
  listening, keeps stale recovery report-only, resolves configs below `/app`,
  and resolves Python from absolute trusted candidates including
  `/opt/venv/bin/python3`.
- A transient Graphify map of the three workflows produced 25 nodes, 36 edges,
  five communities, and no dangling, missing, self-loop, or collapsed edges.
  Generated Graphify output was removed after the query, so the retained,
  independently auditable map is the workflow/source characterization above.
  The single local image build is the bridge shared by runtime, SBOM, scanner,
  and evidence gates. Direct source inspection supplied the startup/path map.

Static inspection leaves several possible startup or mount failure points, but
none is dynamic proof. The missing local Docker daemon and unavailable public
job log do not justify a runtime modification.

## Implemented checkpoint-A contract

- The liveness smoke remains bounded and liveness-only. Its step outcome is
  observable and may return control, but the final `if: always()` enforcement
  gate fails every non-success smoke outcome as `runtime_liveness_failure`.
- SBOM generation, SPDX structural validation, Grype execution, and scanner
  enforcement use `if: always()` after a successful build. Runtime failure can
  no longer bypass them.
- SBOM and scanner failures remain distinct from verified HIGH/CRITICAL
  findings. Missing, empty, oversized, symlinked, escaped, malformed, or
  structurally invalid results remain fail-closed.
- Runtime diagnostics query only the exact run container and only allowlisted
  state/health fields. The one full-container existence probe discards all
  output; no full-inspect output is retained. Engine error, health output, and
  container logs have explicit byte/entry/line bounds. No container environment,
  container listing, Docker events/info, host data, or broad prune is used.
- `runtime-diagnostics.json` is created with exclusive-write semantics only in
  the exact run-scoped `runner.temp` evidence root. The boundary enforces the
  exact four-file upload list, regular-file/non-symlink status, realpath
  containment, size limits, JSON structure, and diagnostic field allowlist.
- Upload is possible only after the exact boundary succeeds. The final gate
  executes after upload and independently aggregates
  `runtime_liveness_failure`, `sbom_infrastructure_failure`,
  `scanner_infrastructure_failure`, `vulnerability_gate_failure`, and
  `evidence_boundary_failure` without first-failure masking.
- Cleanup still uses `if: always()` and targets only the exact container, exact
  image tag, and allowlisted regular evidence/config files. No deployment,
  registry publication, release, tag, SSH, VPS, or broad cleanup path exists.

## Local evidence and blocker

- Exact npm 10.9.8 clean install: success, 175 packages installed from lockfile.
- Focused S3a-B1/S3a/S3a.1: 212/212 JavaScript tests passed, including
  fail-closed smoke-classification and positive Docker-command allowlist
  mutation proofs.
- Focused S1a startup/workspace/path: 69/69 JavaScript tests passed.
- Full suite: 344/344 JavaScript and 22/22 Python tests passed with exact npm
  10.9.8 and bundled Python 3.12.13.
- Instruction mirrors: 2/2 passed.
- Final tracked syntax: 66 JavaScript and 25 Python files passed. Repository
  safety passed for 172 tracked indexed files and the exact four staged files;
  working-tree, staged, and work-baseline-range whitespace checks passed.
- Local Docker: `NOT_RUN_ENVIRONMENT`; client 29.6.1 is present, daemon is not.
- `actionlint`: `NOT_RUN_ENVIRONMENT`; executable is unavailable.
- The pre-existing static workflow-contract test remains oversized; a broader
  parser/validator decomposition is explicitly deferred because it is not
  required to close this stage's security contract and would widen the change.
- Production audit: **blocked**. Exact npm 10.9.8 reports one HIGH finding,
  `GHSA-3jxr-9vmj-r5cp`, in transitive `brace-expansion@2.1.0` through the
  production `archiver@7.0.1` graph. GitHub published the advisory on
  2026-07-20, after the 2026-07-19 hosted baseline run; the first patched 2.x
  version is 2.1.2.

The stage forbids manifest/lock changes and requires every mandatory local gate
to be green before checkpoint A. The advisory therefore requires a separate,
serialized dependency-maintenance stage. No checkpoint commit or push is
authorized while this audit remains red.
