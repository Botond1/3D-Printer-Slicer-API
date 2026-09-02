"""Owner-run comparison of ``POST /bambu/slice`` against a Bambu Studio reading.

Usage::

    python tests/testing-scripts/calibration/bambu_reference_comparison_runner.py \
        --models-dir PRIVATE_DIR --reference PRIVATE_DIR/meres.json --printer P1S --supports false

``meres.json`` is the LeadPilot reading file::

    {"modellek": [{"fajl": "model.stl", "ido_perc": 42.5, "anyag_g": 12.3}, ...]}

Every listed model is sliced with layer height 0.2 mm, PLA, 15% infill and
``orientationMode=preserve``. The markdown table reports each model only by
index and SHA-256 prefix together with reference/API seconds and grams, the
percentage deviations, and PASS when ``max(|dt%|, |dg%|) <= tolerance``
(default 10%). Model file names, the models directory, and the reference path
never appear in the report or in the console output.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
DEFAULT_REPORT_PATH = RESULTS_DIR / "bambu_reference_comparison_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.runner_support import (
    error_code_of,
    is_positive_number,
    post_slice_with_retry,
    report_target_class,
)
from common.synthetic_fixtures import sha256_of_file

BAMBU_SLICE_ENDPOINT = "/bambu/slice"
SUPPORTED_MODEL_EXTENSIONS = frozenset({".stl", ".obj", ".3mf", ".ply", ".zip", ".stp", ".step", ".igs", ".iges"})
MAX_REFERENCE_ENTRIES = 500
MAX_REFERENCE_FILE_BYTES = 4 * 1024 * 1024
DEFAULT_TOLERANCE_PERCENT = 10.0


@dataclass(frozen=True)
class ReferenceEntry:
    index: int
    model_path: Path
    reference_seconds: float
    reference_grams: float


@dataclass
class ComparisonRow:
    index: int
    sha256_prefix: str
    reference_seconds: float
    reference_grams: float
    api_seconds: float | None
    api_grams: float | None
    time_deviation_percent: float | None
    mass_deviation_percent: float | None
    passed: bool
    observation: str


class ReferenceFileError(ValueError):
    """The reading file or one of its entries is unusable."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare /bambu/slice against a Bambu Studio reading.")
    parser.add_argument("--models-dir", required=True, type=Path, help="Private directory holding the models.")
    parser.add_argument("--reference", required=True, type=Path, help="Reading file (meres.json).")
    parser.add_argument("--printer", default="P1S", choices=("P1S", "H2D"))
    parser.add_argument("--supports", default="false", choices=("true", "false"))
    parser.add_argument("--layer-height", default="0.2")
    parser.add_argument("--material", default="PLA")
    parser.add_argument("--infill", default="15")
    parser.add_argument("--tolerance-percent", type=float, default=DEFAULT_TOLERANCE_PERCENT)
    parser.add_argument(
        "--sleep-seconds", type=float, default=20.0,
        help="Pause between models; the slice limiter admits 3 requests/min sustained.",
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    return parser.parse_args(argv)


def _positive_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) and number > 0 else None


def resolve_model_path(models_dir: Path, file_name: object) -> Path:
    """Resolve one reading entry to a contained, existing, supported model file."""
    if not isinstance(file_name, str) or not file_name.strip():
        raise ReferenceFileError("entry file name is empty")
    candidate = Path(file_name)
    if candidate.is_absolute() or any(part in {"..", ""} for part in candidate.parts):
        raise ReferenceFileError("entry file name must be a relative path without traversal")
    # Every filesystem probe is wrapped: an OSError message carries the private
    # absolute path, so it is replaced by a fixed, path-free reason.
    try:
        root = models_dir.resolve(strict=True)
    except OSError as error:
        raise ReferenceFileError("models directory is missing or unreadable") from error
    try:
        resolved = (root / candidate).resolve()
    except OSError as error:
        raise ReferenceFileError("entry could not be resolved inside the models directory") from error
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ReferenceFileError("entry escapes the models directory") from error
    try:
        if not resolved.is_file() or resolved.is_symlink():
            raise ReferenceFileError("entry is not a regular file")
    except OSError as error:
        raise ReferenceFileError("entry is not a regular file") from error
    if resolved.suffix.lower() not in SUPPORTED_MODEL_EXTENSIONS:
        raise ReferenceFileError("entry has an unsupported model extension")
    return resolved


def load_reference(reference_path: Path, models_dir: Path) -> list[ReferenceEntry]:
    """Parse and validate the reading file into ordered entries."""
    try:
        if not reference_path.is_file() or reference_path.stat().st_size > MAX_REFERENCE_FILE_BYTES:
            raise ReferenceFileError("reference file is missing or too large")
    except OSError as error:
        raise ReferenceFileError("reference file is missing or too large") from error
    try:
        document = json.loads(reference_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise ReferenceFileError("reference file is not valid UTF-8 JSON") from error
    entries = document.get("modellek") if isinstance(document, dict) else None
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_REFERENCE_ENTRIES:
        raise ReferenceFileError("reference file must contain a bounded non-empty 'modellek' array")
    parsed: list[ReferenceEntry] = []
    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, dict):
            raise ReferenceFileError(f"entry {index} is not an object")
        minutes = _positive_float(entry.get("ido_perc"))
        grams = _positive_float(entry.get("anyag_g"))
        if minutes is None or grams is None:
            # The owner's reading legitimately records unsliceable models (for
            # example a part taller than the printer) with null values; those
            # rows carry no reference and are skipped, never fabricated.
            print(f"[BAMBU REFERENCE] entry {index}: no numeric reference (skipped)", flush=True)
            continue
        try:
            model_path = resolve_model_path(models_dir, entry.get("fajl"))
        except ReferenceFileError as error:
            raise ReferenceFileError(f"entry {index}: {error}") from error
        parsed.append(ReferenceEntry(index, model_path, minutes * 60.0, grams))
    return parsed


def deviation_percent(observed: float, reference: float) -> float:
    return (observed - reference) / reference * 100.0


def build_request_fields(args: argparse.Namespace) -> dict[str, str]:
    return {
        "printerProfile": args.printer,
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
        "orientationMode": "preserve",
        "infill": str(args.infill),
        "supports": args.supports,
    }


def compare_entry(
    entry: ReferenceEntry, base_url: str, api_key: str, args: argparse.Namespace,
) -> ComparisonRow:
    prefix = sha256_of_file(entry.model_path)[:12]
    status, body, _duration = post_slice_with_retry(
        base_url=base_url, endpoint=BAMBU_SLICE_ENDPOINT, file_path=entry.model_path,
        layer_height=args.layer_height, material=args.material, slice_service_api_key=api_key,
        extra_fields=build_request_fields(args),
    )
    stats = body.get("stats") if isinstance(body, dict) and isinstance(body.get("stats"), dict) else {}
    api_seconds = stats.get("print_time_seconds")
    api_grams = stats.get("material_used_g")
    if status != 200 or not isinstance(body, dict) or body.get("success") is not True:
        return ComparisonRow(
            entry.index, prefix, entry.reference_seconds, entry.reference_grams, None, None, None, None,
            False, f"HTTP {status} {error_code_of(body) or ''}".strip(),
        )
    if not is_positive_number(api_seconds) or not is_positive_number(api_grams):
        return ComparisonRow(
            entry.index, prefix, entry.reference_seconds, entry.reference_grams, None, None, None, None,
            False, "success without positive time and mass",
        )
    dt = deviation_percent(float(api_seconds), entry.reference_seconds)
    dg = deviation_percent(float(api_grams), entry.reference_grams)
    passed = max(abs(dt), abs(dg)) <= args.tolerance_percent
    return ComparisonRow(
        entry.index, prefix, entry.reference_seconds, entry.reference_grams,
        float(api_seconds), float(api_grams), dt, dg, passed,
        "within tolerance" if passed else "deviation exceeds tolerance",
    )


def _percent_cell(value: float | None) -> str:
    return f"{value:+.1f}%" if value is not None else "-"


def _number_cell(value: float | None, digits: int = 1) -> str:
    return f"{value:.{digits}f}" if value is not None else "-"


def write_report(report_path: Path, base_url: str, args: argparse.Namespace, rows: list[ComparisonRow]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for row in rows if row.passed)
    time_deviations = [abs(row.time_deviation_percent) for row in rows if row.time_deviation_percent is not None]
    mass_deviations = [abs(row.mass_deviation_percent) for row in rows if row.mass_deviation_percent is not None]
    mean = lambda values: (sum(values) / len(values)) if values else None  # noqa: E731
    lines = [
        "# Bambu Reference Comparison Report", "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Printer: **{args.printer}**  Layer: **{args.layer_height} mm**  Material: **{args.material}**  "
        f"Infill: **{args.infill}%**  Supports: **{args.supports}**  Orientation: **preserve**",
        f"Tolerance: **max(|dt%|, |dg%|) <= {args.tolerance_percent:g}%**",
        f"Models: **{len(rows)}**  Passed: **{passed}**  Failed: **{len(rows) - passed}**",
        f"Mean |dt%|: **{_number_cell(mean(time_deviations))}**  Mean |dg%|: **{_number_cell(mean(mass_deviations))}**", "",
        "Models are identified only by index and SHA-256 prefix; no file name, directory, "
        "base URL, or credential is retained. Reference values come from the owner's Bambu "
        "Studio reading and are not repository evidence of production calibration.", "",
        "| # | SHA-256 | Ref s | Ref g | API s | API g | dt% | dg% | Result | Observation |",
        "|---:|:--------|------:|------:|------:|------:|----:|----:|:------:|:------------|",
    ]
    for row in rows:
        lines.append(
            f"| {row.index} | `{row.sha256_prefix}` | {_number_cell(row.reference_seconds, 0)} | "
            f"{_number_cell(row.reference_grams, 2)} | {_number_cell(row.api_seconds, 0)} | "
            f"{_number_cell(row.api_grams, 2)} | {_percent_cell(row.time_deviation_percent)} | "
            f"{_percent_cell(row.mass_deviation_percent)} | {'PASS' if row.passed else 'FAIL'} | {row.observation} |"
        )
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not math.isfinite(args.tolerance_percent) or args.tolerance_percent <= 0:
        print("[BAMBU REFERENCE] ERROR: --tolerance-percent must be a positive number.")
        return 2
    base_url = resolve_base_url(PROJECT_ROOT)
    api_key = resolve_slice_service_api_key(PROJECT_ROOT)
    print(f"[BAMBU REFERENCE] slice_service_api_key_found={bool(api_key)}")
    if not api_key:
        print("[BAMBU REFERENCE] ERROR: SLICE_SERVICE_API_KEY not found in .env or process environment.")
        return 1
    try:
        entries = load_reference(args.reference, args.models_dir)
    except ReferenceFileError as error:
        print(f"[BAMBU REFERENCE] ERROR: reading file unusable: {error}")
        return 1
    except OSError as error:
        # An OSError message embeds the private absolute path; print only the class.
        print(f"[BAMBU REFERENCE] ERROR: reading file unusable: {type(error).__name__}")
        return 1
    rows: list[ComparisonRow] = []
    for position, entry in enumerate(entries, 1):
        print(f"[BAMBU REFERENCE] #{entry.index} slicing (sha256 prefix pending)")
        row = compare_entry(entry, base_url, api_key, args)
        rows.append(row)
        print(
            f"[BAMBU REFERENCE] #{row.index} sha={row.sha256_prefix} dt={_percent_cell(row.time_deviation_percent)} "
            f"dg={_percent_cell(row.mass_deviation_percent)} result={'PASS' if row.passed else 'FAIL'} :: {row.observation}"
        )
        if position < len(entries) and args.sleep_seconds > 0:
            time.sleep(args.sleep_seconds)
    write_report(args.report, base_url, args, rows)
    failed = sum(1 for row in rows if not row.passed)
    print(f"[BAMBU REFERENCE] Completed. models={len(rows)} failed={failed}")
    print(f"[BAMBU REFERENCE] Report: {args.report}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
