"""Focused HTTP integration checks for the public profile catalogue v2.

The catalogue is validated generically (exact v2 entry shape, canonical digest,
strong ETag, conditional 304, independent engine-scoped derivation) and then
against the exact managed-preset tables below. The observed engine/printer/
layer/material set must equal one *named catalogue generation*; the retired
18-row J3B and 82-row FDM-only sets stay recognisable so a regression is
reported by name, while the required generation check accepts only the
current 88-row set (82 FDM rows on the ``bambu``, ``orca`` and ``prusa``
engines plus 6 Elegoo Saturn 4 Ultra SLA quoting rows on ``prusa``) with the
measured Bambu envelopes.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "profile_catalogue_test_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_json, curl_json_response, curl_multipart_slice

AXES = ("x", "y", "z")
CATALOGUE_ENDPOINT = "/profiles"
EXPECTED_SCHEMA = "r3d-profile-catalogue-v2"
EXPECTED_EFFECTIVE_PROFILE_SCHEMA = "r3d-effective-slice-profile-v2"
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
PROFILE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
ENGINE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
SLICE_ENDPOINT_PATTERN = re.compile(r"^/[a-z][a-z0-9-]{0,31}/slice$")
ROLE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
# Mirrors the API contract: repository basenames AND Bambu Studio vendor names
# such as `0.20mm Standard @BBL X1C` (spaces, `@`, `+`), never a path.
PROFILE_BASENAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 @._+-]{0,127}$")
SELECTOR_PARAMETER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
PRINTER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MINIMUM_DIMENSIONS = {"x": 1, "y": 1, "z": 1}
DECLARED_DIMENSIONS = {
    "P1S": {"x": 256, "y": 256, "z": 250},
    "H2D-QUOTE": {"x": 350, "y": 320, "z": 325},
    "H2D": {"x": 350, "y": 320, "z": 325},
    "SATURN4U": {"x": 218.88, "y": 122.88, "z": 220},
}
# Measured Bambu Studio admission envelopes (inclusive, exact). The P1S bed is
# L-shaped because of its 18 x 28 mm exclude corner: the catalogue publishes the
# primary 256 x 228 footprint; the alternative 238 x 256 footprint is provable
# only through the slice endpoint (see bambu_envelope_confirmation_runner).
MEASURED_BAMBU_ENVELOPES = {
    "P1S": {"x": 256, "y": 228, "z": 250},
    "H2D": {"x": 325, "y": 320, "z": 325},
}
# The Elegoo Saturn 4 Ultra admission ceiling mirrors its declared metadata and
# is PROVISIONAL until a dedicated native envelope sweep measures it, unlike
# the owner-measured Prusa/Orca/Bambu ceilings below.
SLA_PROVISIONAL_ENVELOPE = {"x": 218.88, "y": 122.88, "z": 220}
LARGEST_PASSING_DIMENSIONS = {
    ("prusa", "P1S"): {"x": 256, "y": 256, "z": 249.9},
    ("orca", "P1S"): {"x": 253.9, "y": 253.9, "z": 249.9},
    ("prusa", "H2D-QUOTE"): {"x": 350, "y": 320, "z": 324.9},
    ("orca", "H2D-QUOTE"): {"x": 347.9, "y": 317.9, "z": 324.9},
    ("bambu", "P1S"): MEASURED_BAMBU_ENVELOPES["P1S"],
    ("bambu", "H2D"): MEASURED_BAMBU_ENVELOPES["H2D"],
    ("prusa", "SATURN4U"): SLA_PROVISIONAL_ENVELOPE,
}
TOP_LEVEL_FIELDS = {
    "schema", "catalogue_sha256", "semantics", "profiles",
    "machine_resolutions", "fleet_resolutions",
}
SEMANTICS_FIELDS = {
    "authority", "enforcement", "availability", "freshness",
    "build_volume_dimensions", "fleet_derivation", "scope",
}
PROFILE_ENTRY_FIELDS = {
    "id", "engine", "technology", "layer_height_mm", "material",
    "material_scope", "printer", "slice_selector", "profile_components",
    "effective_profile_sha256", "effective_profile_identity_schema",
    "engine_version", "build_volume_limits_mm", "filament_diameter_mm",
    "filament_density_g_cm3",
}
BUILD_VOLUME_FIELDS = {
    "minimum_dimensions_inclusive_mm",
    "declared_build_volume_dimensions_mm",
    "largest_passing_dimensions_inclusive_mm",
    "source_profile", "declared_source_kind",
}
MACHINE_RESOLUTION_FIELDS = {
    "technology", "printer", "engine", "status", "reason",
    "minimum_dimensions_inclusive_mm",
    "largest_passing_dimensions_inclusive_mm",
}
FLEET_RESOLUTION_FIELDS = {
    "technology", "engine", "status", "reason", "printers",
    "minimum_dimensions_inclusive_mm",
    "largest_passing_dimensions_inclusive_mm", "excluded_printers",
}
QUOTE_PRINTER = {"id": "H2D-QUOTE", "name": "H2D-sized quote (P1S physics)"}
SATURN4U_PRINTER = {"id": "SATURN4U", "name": "Elegoo Saturn 4 Ultra"}
BAMBU_PRINTERS = {
    "P1S": {
        "name": "Bambu Lab P1S",
        "source_profile": "Bambu Lab P1S 0.4 nozzle",
        "layer_keys": ("0.08", "0.1", "0.12", "0.16", "0.2", "0.24", "0.28"),
    },
    "H2D": {
        "name": "Bambu Lab H2D",
        "source_profile": "Bambu Lab H2D 0.4 nozzle",
        "layer_keys": ("0.08", "0.1", "0.12", "0.16", "0.2", "0.24"),
    },
}
BAMBU_MATERIALS = ("ABS", "PETG", "PLA", "TPU")
ORCA_MATERIALS = ("ABS", "PETG", "PLA", "TPU")
# Elegoo Saturn 4 Ultra SLA quoting rows: registry id SATURN4U, engine prusa,
# 2 layer heights x 3 resins (configs/sla/printers.json, sorted resin keys).
SLA_PRINTER_ID = "SATURN4U"
SLA_LAYER_HEIGHTS = (0.025, 0.05)
SLA_MATERIALS = ("ABS-Like", "Flexible", "Standard")
PRUSA_PRESETS = frozenset(
    ("prusa", printer_id, layer_height, None)
    for printer_id in ("P1S", "H2D-QUOTE")
    for layer_height in (0.1, 0.2, 0.3)
)
LEGACY_J3B_PRESETS = PRUSA_PRESETS | frozenset(
    ("orca", printer_id, layer_height, material)
    for printer_id in ("P1S", "H2D-QUOTE")
    for layer_height in (0.1, 0.2, 0.3)
    for material in ("PETG", "PLA")
)
# The retired 82-row generation: FDM only, over the bambu, orca and prusa
# engines. Kept nameable (as "bambu-82") so a regression to it is reported
# by name even though only the current 88-row SLA-inclusive set now passes.
FDM_82_PRESETS = PRUSA_PRESETS | frozenset(
    ("orca", printer_id, layer_height, material)
    for printer_id in ("P1S", "H2D-QUOTE")
    for layer_height in (0.1, 0.2, 0.3)
    for material in ORCA_MATERIALS
) | frozenset(
    ("bambu", printer_id, float(layer_key), material)
    for printer_id, printer in BAMBU_PRINTERS.items()
    for layer_key in printer["layer_keys"]
    for material in BAMBU_MATERIALS
)
# Elegoo Saturn 4 Ultra SLA quoting presets: prusa/SATURN4U is a printer id
# disjoint from every FDM printer id, so (engine, printer_id, layer, material)
# stays unambiguous without carrying technology in the tuple.
SLA_PRESETS = frozenset(
    ("prusa", SLA_PRINTER_ID, layer_height, material)
    for layer_height in SLA_LAYER_HEIGHTS
    for material in SLA_MATERIALS
)
# The current 88-row generation: the retired 82 FDM rows plus the 6 new SLA
# quoting rows.
CURRENT_PRESETS = FDM_82_PRESETS | SLA_PRESETS
CURRENT_GENERATION = "saturn4u-88"
# Every generation the runner can name exactly. The retired J3B and FDM-only
# sets stay recognisable so a regression to either is reported by name; only
# the current generation satisfies the required generation check.
CATALOGUE_GENERATIONS = (
    (
        CURRENT_GENERATION, CURRENT_PRESETS,
        "Exactly 88 managed rows publish separate declared and inclusive ceilings: 82 FDM "
        "rows (6 Prusa, 24 Orca PLA/PETG/ABS/TPU, 28 Bambu Studio P1S and 24 Bambu Studio "
        "H2D) plus 6 Elegoo Saturn 4 Ultra SLA quoting rows on prusa (2 layer heights x 3 "
        "resins).",
    ),
    (
        "bambu-82", FDM_82_PRESETS,
        "Exactly 82 managed FDM rows publish separate declared and inclusive ceilings: "
        "6 Prusa, 24 Orca (PLA/PETG/ABS/TPU), 28 Bambu Studio P1S and 24 Bambu Studio H2D.",
    ),
    (
        "j3b-18", LEGACY_J3B_PRESETS,
        "Exactly 18 managed FDM rows publish separate declared and inclusive ceilings; "
        "H2D-sized quote selectors exist on both engines.",
    ),
)
EXPECTED_CURRENT_PRESETS = CURRENT_PRESETS
# Fleets are scoped by (technology, engine): prusa binds a separate FDM fleet
# (dominant H2D-QUOTE) and SLA fleet (dominant, and only, SATURN4U). Per
# fleet: the dominant printer(s) and every printer that (technology, engine)
# binds.
EXPECTED_FLEETS = {
    ("FDM", "bambu"): {
        "printers": [{"id": "H2D", "name": BAMBU_PRINTERS["H2D"]["name"]}],
        "engine_printers": ("H2D", "P1S"),
    },
    ("FDM", "orca"): {"printers": [QUOTE_PRINTER], "engine_printers": ("H2D-QUOTE", "P1S")},
    ("FDM", "prusa"): {"printers": [QUOTE_PRINTER], "engine_printers": ("H2D-QUOTE", "P1S")},
    ("SLA", "prusa"): {"printers": [SATURN4U_PRINTER], "engine_printers": (SLA_PRINTER_ID,)},
}


@dataclass(frozen=True)
class Check:
    name: str
    endpoint: str
    status: int | str
    success: bool
    observation: str


class CatalogueDerivationError(ValueError):
    """Profile rows cannot be engine-scoped without hiding inconsistent data."""


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")


def report_target_class(base_url: str) -> str:
    try:
        hostname = urlsplit(base_url).hostname
    except ValueError:
        return "invalid-redacted"
    if not hostname:
        return "invalid-redacted"
    if hostname.lower() == "localhost":
        return "local-loopback"
    try:
        return "local-loopback" if ipaddress.ip_address(hostname).is_loopback else "external-redacted"
    except ValueError:
        return "external-redacted"


def is_printable_ascii(value: object, *, maximum_length: int) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= maximum_length
        and all(0x20 <= ord(character) <= 0x7E for character in value)
    )


def is_axis_map(value: object, *, allow_zero: bool = False) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == set(AXES)
        and all(
            isinstance(value[axis], (int, float))
            and not isinstance(value[axis], bool)
            and math.isfinite(value[axis])
            and (value[axis] >= 0 if allow_zero else value[axis] > 0)
            for axis in AXES
        )
    )


def is_printer_identity(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"id", "name"}
        and isinstance(value.get("id"), str)
        and PRINTER_ID_PATTERN.fullmatch(value["id"]) is not None
        and is_printable_ascii(value.get("name"), maximum_length=128)
    )


def profile_envelope(profile: object) -> dict[str, dict[str, int | float]] | None:
    if not isinstance(profile, dict):
        return None
    limits = profile.get("build_volume_limits_mm")
    if not isinstance(limits, dict) or set(limits) != BUILD_VOLUME_FIELDS:
        return None
    minimum = limits.get("minimum_dimensions_inclusive_mm")
    declared = limits.get("declared_build_volume_dimensions_mm")
    largest_passing = limits.get("largest_passing_dimensions_inclusive_mm")
    if (
        not is_axis_map(minimum, allow_zero=True)
        or not is_axis_map(declared)
        or not is_axis_map(largest_passing)
        or any(
            minimum[axis] >= largest_passing[axis]
            or largest_passing[axis] > declared[axis]
            for axis in AXES
        )
    ):
        return None
    return {
        "minimum": {axis: minimum[axis] for axis in AXES},
        "declared": {axis: declared[axis] for axis in AXES},
        "largest_passing": {axis: largest_passing[axis] for axis in AXES},
    }


def envelope_contains(candidate: Mapping, other: Mapping) -> bool:
    return all(
        candidate["minimum"][axis] <= other["minimum"][axis]
        and candidate["largest_passing"][axis] >= other["largest_passing"][axis]
        for axis in AXES
    )


def derive_catalogue_resolutions(profiles: object) -> tuple[list[dict], list[dict]]:
    """Independently derive machine/fleet state in technology+engine scopes."""
    if not isinstance(profiles, list):
        raise CatalogueDerivationError("profiles_not_array")
    profile_ids: set[str] = set()
    grouped: dict[tuple[str, str, str], dict] = {}
    for profile in profiles:
        if not isinstance(profile, dict):
            raise CatalogueDerivationError("profile_not_object")
        profile_id = profile.get("id")
        if not isinstance(profile_id, str) or PROFILE_ID_PATTERN.fullmatch(profile_id) is None:
            raise CatalogueDerivationError("profile_id_invalid")
        if profile_id in profile_ids:
            raise CatalogueDerivationError(f"duplicate_profile_id:{profile_id}")
        profile_ids.add(profile_id)
        technology = profile.get("technology")
        engine = profile.get("engine")
        printer = profile.get("printer")
        envelope = profile_envelope(profile)
        if (
            technology not in {"FDM", "SLA"}
            or not isinstance(engine, str)
            or ENGINE_ID_PATTERN.fullmatch(engine) is None
            or not is_printer_identity(printer)
            or envelope is None
        ):
            raise CatalogueDerivationError("profile_resolution_input_invalid")
        key = (technology, engine, printer["id"])
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = {
                "technology": technology, "engine": engine,
                "printer": dict(printer), "envelope": envelope,
            }
        elif existing["printer"] != printer:
            raise CatalogueDerivationError(
                f"printer_identity_conflict:{technology}:{engine}:{printer['id']}"
            )
        elif existing["envelope"] != envelope:
            raise CatalogueDerivationError(
                f"intra_engine_profile_conflict:{technology}:{engine}:{printer['id']}"
            )
    machine_resolutions = [
        {
            "technology": machine["technology"],
            "printer": machine["printer"],
            "engine": machine["engine"],
            "status": "resolved", "reason": None,
            "minimum_dimensions_inclusive_mm": machine["envelope"]["minimum"],
            "largest_passing_dimensions_inclusive_mm": machine["envelope"]["largest_passing"],
        }
        for _, machine in sorted(grouped.items())
    ]
    fleet_groups: dict[tuple[str, str], list[dict]] = {}
    for machine in machine_resolutions:
        fleet_groups.setdefault(
            (machine["technology"], machine["engine"]), [],
        ).append(machine)
    fleet_resolutions: list[dict] = []
    for (technology, engine), machines in sorted(fleet_groups.items()):
        dominant = [
            candidate for candidate in machines
            if all(
                envelope_contains(
                    {
                        "minimum": candidate["minimum_dimensions_inclusive_mm"],
                        "largest_passing": candidate["largest_passing_dimensions_inclusive_mm"],
                    },
                    {
                        "minimum": other["minimum_dimensions_inclusive_mm"],
                        "largest_passing": other["largest_passing_dimensions_inclusive_mm"],
                    },
                )
                for other in machines
            )
        ]
        if not dominant:
            fleet_resolutions.append({
                "technology": technology, "engine": engine,
                "status": "unresolved", "reason": "no_dominant_machine",
                "printers": [], "minimum_dimensions_inclusive_mm": None,
                "largest_passing_dimensions_inclusive_mm": None,
                "excluded_printers": [],
            })
            continue
        first = dominant[0]
        if any(
            machine["minimum_dimensions_inclusive_mm"]
            != first["minimum_dimensions_inclusive_mm"]
            or machine["largest_passing_dimensions_inclusive_mm"]
            != first["largest_passing_dimensions_inclusive_mm"]
            for machine in dominant[1:]
        ):
            raise CatalogueDerivationError("inconsistent_dominant_envelopes")
        fleet_resolutions.append({
            "technology": technology, "engine": engine,
            "status": "resolved", "reason": None,
            "printers": [machine["printer"] for machine in dominant],
            "minimum_dimensions_inclusive_mm": first["minimum_dimensions_inclusive_mm"],
            "largest_passing_dimensions_inclusive_mm": first[
                "largest_passing_dimensions_inclusive_mm"
            ],
            "excluded_printers": [],
        })
    return machine_resolutions, fleet_resolutions


def leading_parameters_name_row_identity(
    profile: Mapping[str, object], leading_parameters: list[dict[str, str]],
) -> bool:
    """Leading (component-free) selector parameters may only restate the row identity.

    Registry-selected engines such as Bambu Studio choose the machine and
    filament through ``printerProfile``/``layerHeight``/``material`` instead of
    file basenames, so exactly those three parameters may precede the
    component-backed chain. The Elegoo Saturn 4 Ultra SLA rows have no
    component-linked ``printerProfile`` (their single combined component
    carries no selector parameter, since the default
    ``SLA_<layerHeight>mm.ini`` naming already resolves the exact file), so
    exactly ``layerHeight``/``material`` may precede that chain instead.
    Nothing else is admitted ahead of either chain.
    """
    names = [parameter["name"] for parameter in leading_parameters]
    values = {parameter["name"]: parameter["value"] for parameter in leading_parameters}
    try:
        layer_matches = float(values.get("layerHeight", "nan")) == float(
            profile.get("layer_height_mm")
        )
    except (TypeError, ValueError):
        return False
    if names == ["printerProfile", "layerHeight", "material"]:
        printer = profile.get("printer")
        return (
            isinstance(printer, dict)
            and values["printerProfile"] == printer.get("id")
            and layer_matches
            and values["material"] == profile.get("material")
        )
    if names == ["layerHeight", "material"]:
        return (
            profile.get("technology") == "SLA"
            and layer_matches
            and values["material"] == profile.get("material")
        )
    return False


def validate_profile_entry_schema(profile: object) -> tuple[bool, str]:
    """Validate one technology-agnostic v2 entry."""
    if not isinstance(profile, dict) or set(profile) != PROFILE_ENTRY_FIELDS:
        return False, "At least one profile does not have the exact v2 entry shape."
    engine = profile.get("engine")
    layer_height = profile.get("layer_height_mm")
    material = profile.get("material")
    if (
        not isinstance(profile.get("id"), str)
        or PROFILE_ID_PATTERN.fullmatch(profile["id"]) is None
        or not isinstance(engine, str)
        or ENGINE_ID_PATTERN.fullmatch(engine) is None
        or profile.get("technology") not in {"FDM", "SLA"}
        or not isinstance(layer_height, (int, float))
        or isinstance(layer_height, bool)
        or not math.isfinite(layer_height) or layer_height <= 0
        or (material is not None and not is_printable_ascii(material, maximum_length=64))
        or profile.get("material_scope") not in {"exact", "request-independent"}
        or not is_printer_identity(profile.get("printer"))
    ):
        return False, "At least one profile has invalid generic identity metadata."
    selector = profile.get("slice_selector")
    parameters = selector.get("parameters") if isinstance(selector, dict) else None
    if (
        not isinstance(selector, dict)
        or set(selector) != {"endpoint", "parameters"}
        or not isinstance(selector.get("endpoint"), str)
        or SLICE_ENDPOINT_PATTERN.fullmatch(selector["endpoint"]) is None
        or selector["endpoint"] != f"/{engine}/slice"
        or not isinstance(parameters, list) or not 1 <= len(parameters) <= 16
    ):
        return False, "At least one slice selector is invalid or non-deterministic."
    parameter_names: set[str] = set()
    for parameter in parameters:
        if (
            not isinstance(parameter, dict)
            or set(parameter) != {"name", "value"}
            or not isinstance(parameter.get("name"), str)
            or SELECTOR_PARAMETER_PATTERN.fullmatch(parameter["name"]) is None
            or parameter["name"] in parameter_names
            or not isinstance(parameter.get("value"), str)
            or PROFILE_BASENAME_PATTERN.fullmatch(parameter["value"]) is None
        ):
            return False, "At least one selector parameter is duplicate or path-bearing."
        parameter_names.add(parameter["name"])
    components = profile.get("profile_components")
    if not isinstance(components, list) or not 1 <= len(components) <= 16:
        return False, "At least one profile-component chain is missing or unbounded."
    identities: set[tuple[str, str, str | None]] = set()
    linked_parameters: list[dict[str, str]] = []
    for component in components:
        selector_parameter = component.get("selector_parameter") \
            if isinstance(component, dict) else None
        if (
            not isinstance(component, dict)
            or set(component) != {"role", "basename", "selector_parameter"}
            or not isinstance(component.get("role"), str)
            or ROLE_ID_PATTERN.fullmatch(component["role"]) is None
            or not isinstance(component.get("basename"), str)
            or PROFILE_BASENAME_PATTERN.fullmatch(component["basename"]) is None
            or (
                selector_parameter is not None
                and (
                    not isinstance(selector_parameter, str)
                    or SELECTOR_PARAMETER_PATTERN.fullmatch(selector_parameter) is None
                )
            )
        ):
            return False, "At least one profile component is invalid or path-bearing."
        identity = (component["role"], component["basename"], selector_parameter)
        if identity in identities:
            return False, "At least one profile-component chain contains a duplicate."
        identities.add(identity)
        if selector_parameter is not None:
            linked_parameters.append({
                "name": selector_parameter, "value": component["basename"],
            })
    chain_start = len(parameters) - len(linked_parameters)
    if chain_start < 0 or parameters[chain_start:] != linked_parameters:
        return False, "Selector parameters do not end with the ordered component chain."
    leading_parameters = parameters[:chain_start]
    if leading_parameters and not leading_parameters_name_row_identity(
        profile, leading_parameters,
    ):
        return False, "Leading selector parameters are not the row's own registry identity."
    digest = profile.get("effective_profile_sha256")
    if (
        not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None
        or profile.get("effective_profile_identity_schema")
        != EXPECTED_EFFECTIVE_PROFILE_SCHEMA
        or not is_printable_ascii(profile.get("engine_version"), maximum_length=128)
    ):
        return False, "At least one effective-profile identity is invalid."
    limits = profile.get("build_volume_limits_mm")
    if (
        profile_envelope(profile) is None
        or not isinstance(limits.get("source_profile"), str)
        or PROFILE_BASENAME_PATTERN.fullmatch(limits["source_profile"]) is None
        or limits.get("declared_source_kind") != "profile-explicit"
    ):
        return False, "At least one v2 build-volume contract is ambiguous or invalid."
    if not all(
        value is None or (
            isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0
        )
        for value in (
            profile.get("filament_diameter_mm"),
            profile.get("filament_density_g_cm3"),
        )
    ):
        return False, "At least one optional filament measurement is invalid."
    return True, "Generic v2 profile entry is valid."


def validate_machine_resolutions_schema(value: object) -> tuple[bool, str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 1024:
        return False, "machine_resolutions is not a bounded non-empty array."
    identities: list[tuple[str, str, str]] = []
    for machine in value:
        if not isinstance(machine, dict) or set(machine) != MACHINE_RESOLUTION_FIELDS:
            return False, "At least one machine resolution has a non-exact v2 shape."
        if (
            machine.get("technology") not in {"FDM", "SLA"}
            or not isinstance(machine.get("engine"), str)
            or ENGINE_ID_PATTERN.fullmatch(machine["engine"]) is None
            or not is_printer_identity(machine.get("printer"))
            or machine.get("status") != "resolved" or machine.get("reason") is not None
            or not is_axis_map(machine.get("minimum_dimensions_inclusive_mm"), allow_zero=True)
            or not is_axis_map(machine.get("largest_passing_dimensions_inclusive_mm"))
            or any(
                machine["minimum_dimensions_inclusive_mm"][axis]
                >= machine["largest_passing_dimensions_inclusive_mm"][axis]
                for axis in AXES
            )
        ):
            return False, "At least one engine-scoped machine resolution is invalid."
        identities.append((
            machine["technology"], machine["engine"], machine["printer"]["id"],
        ))
    if identities != sorted(set(identities)):
        return False, "Machine resolutions are duplicate or not engine-scoped sorted."
    return True, "Machine resolutions are exact, engine-scoped, and ordered."


def validate_fleet_resolutions_schema(value: object) -> tuple[bool, str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 64:
        return False, "fleet_resolutions is not a bounded non-empty array."
    identities: list[tuple[str, str]] = []
    for fleet in value:
        if not isinstance(fleet, dict) or set(fleet) != FLEET_RESOLUTION_FIELDS:
            return False, "At least one fleet resolution has a non-exact v2 shape."
        technology = fleet.get("technology")
        engine = fleet.get("engine")
        if (
            technology not in {"FDM", "SLA"}
            or not isinstance(engine, str)
            or ENGINE_ID_PATTERN.fullmatch(engine) is None
        ):
            return False, "At least one fleet identity is invalid."
        identities.append((technology, engine))
        excluded = fleet.get("excluded_printers")
        if not isinstance(excluded, list) or len(excluded) > 256:
            return False, "Fleet exclusions are not a bounded array."
        for exclusion in excluded:
            if (
                not isinstance(exclusion, dict)
                or set(exclusion) != {"printer", "reason"}
                or not is_printer_identity(exclusion.get("printer"))
                or not is_printable_ascii(exclusion.get("reason"), maximum_length=128)
            ):
                return False, "At least one fleet exclusion is invalid."
        if fleet.get("status") == "resolved":
            printers = fleet.get("printers")
            if (
                fleet.get("reason") is not None
                or not isinstance(printers, list) or not 1 <= len(printers) <= 256
                or any(not is_printer_identity(printer) for printer in printers)
                or [printer["id"] for printer in printers]
                != sorted({printer["id"] for printer in printers})
                or not is_axis_map(
                    fleet.get("minimum_dimensions_inclusive_mm"), allow_zero=True,
                )
                or not is_axis_map(fleet.get("largest_passing_dimensions_inclusive_mm"))
            ):
                return False, "At least one resolved fleet ceiling is invalid."
        elif fleet.get("status") == "unresolved":
            if (
                fleet.get("reason") not in {"no_resolved_machine", "no_dominant_machine"}
                or fleet.get("printers") != []
                or fleet.get("minimum_dimensions_inclusive_mm") is not None
                or fleet.get("largest_passing_dimensions_inclusive_mm") is not None
            ):
                return False, "At least one unresolved fleet state is ambiguous."
        else:
            return False, "At least one fleet status is invalid."
    if identities != sorted(set(identities)):
        return False, "Fleet resolutions are duplicate or not technology/engine sorted."
    return True, "Fleet resolutions are exact, engine-scoped, and ordered."


def validate_published_resolutions(body: object) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "Response body is unavailable."
    machine_ok, observation = validate_machine_resolutions_schema(
        body.get("machine_resolutions")
    )
    if not machine_ok:
        return False, observation
    fleet_ok, observation = validate_fleet_resolutions_schema(body.get("fleet_resolutions"))
    if not fleet_ok:
        return False, observation
    try:
        expected_machines, expected_fleets = derive_catalogue_resolutions(body.get("profiles"))
    except CatalogueDerivationError as error:
        return False, f"Profile rows are not safely derivable: {error}."
    if body.get("machine_resolutions") != expected_machines:
        return False, "Published machine resolutions do not match profile rows."
    if body.get("fleet_resolutions") != expected_fleets:
        return False, "Published fleet resolutions do not match engine-scoped machines."
    return True, "Published machine and fleet ceilings match independent engine-scoped derivation."


def validate_catalogue_shape(body: object) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "Response body is not a JSON object."
    if set(body) != TOP_LEVEL_FIELDS:
        return False, "Top-level v2 field set is not exact."
    digest = body.get("catalogue_sha256")
    semantics = body.get("semantics")
    profiles = body.get("profiles")
    if (
        body.get("schema") != EXPECTED_SCHEMA
        or not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None
        or not isinstance(semantics, dict) or set(semantics) != SEMANTICS_FIELDS
        or semantics.get("authority") != "informational"
        or not all(
            isinstance(semantics.get(field), str) and 1 <= len(semantics[field]) <= 2048
            for field in SEMANTICS_FIELDS - {"authority"}
        )
        or "not an admission limit" not in semantics["build_volume_dimensions"]
        or "exact boundary value" not in semantics["build_volume_dimensions"]
        or "engine-scoped" not in semantics["fleet_derivation"]
        or not isinstance(profiles, list) or not 1 <= len(profiles) <= 4096
    ):
        return False, "Catalogue v2 metadata or profile array is invalid."
    ids: set[str] = set()
    for profile in profiles:
        valid, observation = validate_profile_entry_schema(profile)
        if not valid:
            return False, observation
        if profile["id"] in ids:
            return False, "Profile IDs are not unique."
        ids.add(profile["id"])
    resolutions_ok, observation = validate_published_resolutions(body)
    if not resolutions_ok:
        return False, observation
    return True, "Generic v2 entries and exact engine-scoped resolutions are valid."


def validate_catalogue_digest(body: object) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "Response body is unavailable."
    content = {key: value for key, value in body.items() if key != "catalogue_sha256"}
    observed = hashlib.sha256(canonical_json_bytes(content)).hexdigest()
    return observed == body.get("catalogue_sha256"), "Body content hashes to catalogue_sha256."


def _selector_map(profile: Mapping[str, object]) -> dict[str, str]:
    selector = profile.get("slice_selector")
    parameters = selector.get("parameters") if isinstance(selector, dict) else []
    return {parameter["name"]: parameter["value"] for parameter in parameters}


def _prusa_row_valid(
    printer_id: str, layer: object, selectors: Mapping[str, str], limits: Mapping[str, object],
) -> bool:
    expected_profile = (
        f"FDM_{layer}mm.ini" if printer_id == "P1S"
        else f"FDM_P1S_H2D_SIZE_QUOTING_{layer}mm.ini"
    )
    return (
        selectors == {"printerProfile": expected_profile}
        and limits.get("source_profile") == expected_profile
    )


def _orca_row_valid(
    printer_id: str, layer: object, selectors: Mapping[str, str], limits: Mapping[str, object],
) -> bool:
    expected_machine = (
        "Bambu_P1S_0.4_nozzle.json" if printer_id == "P1S"
        else "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json"
    )
    return (
        selectors == {
            "printerProfile": expected_machine,
            "processProfile": f"FDM_{layer}mm.json",
        }
        and limits.get("source_profile") == expected_machine
    )


def _sla_row_valid(
    layer: object, material: object, selectors: Mapping[str, str], limits: Mapping[str, object],
) -> bool:
    """SLA rows select by leading layerHeight/material; the file naming resolves the rest."""
    expected_profile = f"SLA_{layer}mm.ini"
    return (
        selectors == {"layerHeight": f"{layer}", "material": material}
        and material in SLA_MATERIALS
        and limits.get("source_profile") == expected_profile
    )


def _bambu_row_valid(
    profile: Mapping[str, object], printer_id: str, layer: object, material: object,
    selectors: Mapping[str, str], limits: Mapping[str, object],
) -> bool:
    """Bambu rows select by registry id/layer/material and name the vendor chain."""
    printer = BAMBU_PRINTERS.get(printer_id)
    printer_identity = profile.get("printer")
    if (
        printer is None
        or not isinstance(printer_identity, dict)
        or printer_identity.get("name") != printer["name"]
    ):
        return False
    layer_key = selectors.get("layerHeight")
    process = selectors.get("processProfile")
    components = profile.get("profile_components")
    if not isinstance(components, list) or not all(isinstance(item, dict) for item in components):
        return False
    try:
        layer_key_matches = layer_key in printer["layer_keys"] and float(layer_key) == float(layer)
    except (TypeError, ValueError):
        return False
    return (
        set(selectors) == {"printerProfile", "layerHeight", "material", "processProfile"}
        and selectors.get("printerProfile") == printer_id
        and layer_key_matches
        and material in BAMBU_MATERIALS and selectors.get("material") == material
        and isinstance(process, str) and "@BBL" in process
        and [item.get("role") for item in components] == ["machine", "process", "filament"]
        and components[0].get("basename") == printer["source_profile"]
        and components[1].get("basename") == process
        and limits.get("source_profile") == printer["source_profile"]
    )


def classify_catalogue_generation(observed: set) -> str | None:
    """Name the generation whose preset set equals ``observed`` exactly, else None."""
    for name, presets, _message in CATALOGUE_GENERATIONS:
        if observed == presets:
            return name
    return None


def validate_current_v2_managed_rows(body: object) -> tuple[bool, str]:
    """Validate every managed row against its engine's exact selector/ceiling contract.

    Each row must match the declared and inclusive tables for its printer and
    select its exact managed chain, on its own technology's terms (FDM on
    prusa/orca/bambu, or SLA on prusa); the resulting engine/printer/layer/
    material set must equal one named catalogue generation. The observation
    names that generation; ``validate_current_generation`` separately
    requires it to be the current one.
    """
    profiles = body.get("profiles") if isinstance(body, dict) else None
    if not isinstance(profiles, list) or not profiles:
        return False, "Profiles are unavailable."
    observed: set[tuple[object, object, object, object]] = set()
    for profile in profiles:
        if not isinstance(profile, dict) or profile.get("technology") not in {"FDM", "SLA"}:
            return False, "The current v2 set contains a row with an unexpected technology."
        printer = profile.get("printer")
        if not isinstance(printer, dict):
            return False, "The current v2 set contains an invalid printer identity."
        engine = profile.get("engine")
        technology = profile.get("technology")
        printer_id = printer.get("id")
        limits = profile.get("build_volume_limits_mm")
        if (
            (engine, printer_id) not in LARGEST_PASSING_DIMENSIONS
            or printer_id not in DECLARED_DIMENSIONS
            or not isinstance(limits, dict)
            or limits.get("minimum_dimensions_inclusive_mm") != MINIMUM_DIMENSIONS
            or limits.get("declared_build_volume_dimensions_mm")
            != DECLARED_DIMENSIONS[printer_id]
            or limits.get("largest_passing_dimensions_inclusive_mm")
            != LARGEST_PASSING_DIMENSIONS[(engine, printer_id)]
            or limits.get("declared_source_kind") != "profile-explicit"
        ):
            return False, "A current row has an incorrect declared or inclusive ceiling."
        selectors = _selector_map(profile)
        layer = profile.get("layer_height_mm")
        material = profile.get("material")
        if engine == "prusa" and technology == "FDM":
            row_valid = _prusa_row_valid(printer_id, layer, selectors, limits)
        elif engine == "prusa" and technology == "SLA":
            row_valid = printer_id == SLA_PRINTER_ID and _sla_row_valid(
                layer, material, selectors, limits
            )
        elif engine == "orca" and technology == "FDM":
            row_valid = _orca_row_valid(printer_id, layer, selectors, limits)
        elif engine == "bambu" and technology == "FDM":
            row_valid = _bambu_row_valid(profile, printer_id, layer, material, selectors, limits)
        else:
            row_valid = False
        if not row_valid:
            return False, f"A {engine} {technology} selector does not select its exact managed chain."
        if "Bambu_H2D_0.4_nozzle.json" in selectors.values():
            return False, "The incompatible placeholder H2D profile is publicly selected."
        observed.add((engine, printer_id, layer, material))
    generation = classify_catalogue_generation(observed)
    if generation is None:
        return False, "The current engine/printer/layer/material set is incomplete."
    return True, next(
        message for name, _presets, message in CATALOGUE_GENERATIONS if name == generation
    )


def validate_current_generation(body: object) -> tuple[bool, str]:
    """Require the current 88-row generation over its four technology/engine fleets."""
    profiles = body.get("profiles") if isinstance(body, dict) else None
    fleets = body.get("fleet_resolutions") if isinstance(body, dict) else None
    if not isinstance(profiles, list) or not isinstance(fleets, list):
        return False, "Profiles or fleet resolutions are unavailable."
    observed: set[tuple[object, object, object, object]] = set()
    for profile in profiles:
        if not isinstance(profile, dict) or not isinstance(profile.get("printer"), dict):
            return False, "A profile row is malformed."
        observed.add((
            profile.get("engine"), profile["printer"].get("id"),
            profile.get("layer_height_mm"), profile.get("material"),
        ))
    generation = classify_catalogue_generation(observed)
    # Fleets are scoped by (technology, engine), not engine alone: prusa binds
    # both an FDM fleet and a separate SLA fleet, so "prusa" legitimately
    # appears twice among the published fleet identities.
    fleet_identities = sorted(
        (str(fleet.get("technology")), str(fleet.get("engine")))
        if isinstance(fleet, dict) else ("invalid", "invalid")
        for fleet in fleets
    )
    expected_fleet_identities = sorted(EXPECTED_FLEETS)
    if generation != CURRENT_GENERATION or fleet_identities != expected_fleet_identities:
        return False, (
            f"Observed generation {generation or 'unknown'} with {len(profiles)} rows and "
            f"fleet identities {fleet_identities}; expected {CURRENT_GENERATION} with "
            f"{len(CURRENT_PRESETS)} rows and the bambu FDM, orca FDM, prusa FDM and prusa "
            "SLA fleets."
        )
    return True, (
        f"{len(CURRENT_PRESETS)} rows over the bambu, orca and prusa engines (FDM and SLA) "
        "form the current generation."
    )


def validate_measured_bambu_envelopes(body: object) -> tuple[bool, str]:
    """Every bambu row and machine resolution publishes the measured inclusive triple."""
    if not isinstance(body, dict):
        return False, "Response body is unavailable."
    profiles = body.get("profiles") if isinstance(body.get("profiles"), list) else []
    rows = [
        profile for profile in profiles
        if isinstance(profile, dict) and profile.get("engine") == "bambu"
        and isinstance(profile.get("printer"), dict)
    ]
    if not rows:
        return False, "No bambu rows are published."
    for printer_id, expected in MEASURED_BAMBU_ENVELOPES.items():
        printer_rows = [row for row in rows if row["printer"].get("id") == printer_id]
        if not printer_rows:
            return False, f"No bambu rows are published for {printer_id}."
        if any(
            not isinstance(row.get("build_volume_limits_mm"), dict)
            or row["build_volume_limits_mm"].get("largest_passing_dimensions_inclusive_mm")
            != expected
            for row in printer_rows
        ):
            return False, f"A bambu {printer_id} row does not publish the measured envelope."
    machines = body.get("machine_resolutions")
    observed = {
        machine["printer"].get("id"): machine.get("largest_passing_dimensions_inclusive_mm")
        for machine in (machines if isinstance(machines, list) else [])
        if isinstance(machine, dict) and machine.get("engine") == "bambu"
        and isinstance(machine.get("printer"), dict)
    }
    if any(
        observed.get(printer_id) != expected
        for printer_id, expected in MEASURED_BAMBU_ENVELOPES.items()
    ):
        return False, "Bambu machine resolutions do not publish the measured envelopes."
    return True, (
        "Bambu P1S 256 x 228 x 250 mm and H2D 325 x 320 x 325 mm are published on every "
        "row and machine resolution."
    )


def validate_current_v2_resolutions(body: object) -> tuple[bool, str]:
    """Every published (technology, engine) fleet derives its own machine/fleet ceilings.

    Fleets are scoped by technology AND engine, never by engine alone: prusa
    binds one FDM fleet (dominant H2D-QUOTE) and a separate SLA fleet
    (dominant, and only, SATURN4U), so the same engine string legitimately
    resolves to two distinct fleets.
    """
    if not isinstance(body, dict):
        return False, "Response body is unavailable."
    machines = body.get("machine_resolutions")
    fleets = body.get("fleet_resolutions")
    if not isinstance(machines, list) or not isinstance(fleets, list):
        return False, "Engine-scoped resolutions are unavailable."
    observed_machines = {
        (machine.get("technology"), machine.get("engine"), machine.get("printer", {}).get("id")):
        machine.get("largest_passing_dimensions_inclusive_mm")
        for machine in machines if isinstance(machine, dict)
    }
    published_fleet_keys = {
        (technology, engine) for technology, engine, _printer_id in observed_machines
    }
    expected_machines = {
        (technology, engine, printer_id): LARGEST_PASSING_DIMENSIONS[(engine, printer_id)]
        for technology, engine in published_fleet_keys if (technology, engine) in EXPECTED_FLEETS
        for printer_id in EXPECTED_FLEETS[(technology, engine)]["engine_printers"]
    }
    if not published_fleet_keys or observed_machines != expected_machines:
        return False, "Machine resolutions do not preserve every engine's own ceilings."
    fleet_identities = sorted(
        (str(fleet.get("technology")), str(fleet.get("engine")))
        if isinstance(fleet, dict) else ("invalid", "invalid")
        for fleet in fleets
    )
    if fleet_identities != sorted(published_fleet_keys):
        return False, "Fleet resolutions do not cover exactly the published technology/engine fleets."
    for fleet in fleets:
        key = (fleet.get("technology"), fleet.get("engine"))
        expected = EXPECTED_FLEETS.get(key)
        if expected is None:
            return False, f"The {key} fleet is not an expected technology/engine fleet."
        dominant_printer = expected["printers"][0]["id"]
        if (
            fleet.get("status") != "resolved" or fleet.get("reason") is not None
            or fleet.get("printers") != expected["printers"]
            or fleet.get("minimum_dimensions_inclusive_mm") != MINIMUM_DIMENSIONS
            or fleet.get("largest_passing_dimensions_inclusive_mm")
            != LARGEST_PASSING_DIMENSIONS[(key[1], dominant_printer)]
            or fleet.get("excluded_printers") != []
        ):
            return False, f"The {key} fleet ceiling is not its dominant machine's envelope."
    return True, (
        "Each published technology/engine fleet's ceiling is its own dominant machine's "
        "inclusive envelope; engines are never merged across technology."
    )


def cube_stl() -> bytes:
    """Return a valid outward-normal 10 mm cube for optional digest parity."""
    points = (
        (0, 0, 0), (10, 0, 0), (0, 10, 0), (10, 10, 0),
        (0, 0, 10), (10, 0, 10), (0, 10, 10), (10, 10, 10),
    )
    faces = (
        ((0, 0, -1), (0, 2, 3), (0, 3, 1)),
        ((0, 0, 1), (4, 5, 7), (4, 7, 6)),
        ((0, -1, 0), (0, 1, 5), (0, 5, 4)),
        ((1, 0, 0), (1, 3, 7), (1, 7, 5)),
        ((0, 1, 0), (3, 2, 6), (3, 6, 7)),
        ((-1, 0, 0), (2, 0, 4), (2, 4, 6)),
    )
    lines = ["solid j3b_catalogue_cube"]
    for normal, first, second in faces:
        for triangle in (first, second):
            lines.extend([
                f"facet normal {normal[0]} {normal[1]} {normal[2]}", "outer loop",
                *(f"vertex {points[index][0]} {points[index][1]} {points[index][2]}"
                  for index in triangle),
                "endloop", "endfacet",
            ])
    lines.append("endsolid j3b_catalogue_cube")
    return ("\n".join(lines) + "\n").encode("ascii")


def verify_slice_parity(base_url: str, body: dict) -> Check:
    key = resolve_slice_service_api_key(PROJECT_ROOT)
    if not key:
        return Check(
            "optional Prusa slice digest parity", "/prusa/slice", "NOT_RUN", False,
            "SLICE_SERVICE_API_KEY runner input is unavailable.",
        )
    expected = next((
        profile for profile in body.get("profiles", [])
        if isinstance(profile, dict) and profile.get("engine") == "prusa"
        and isinstance(profile.get("printer"), dict)
        and profile["printer"].get("id") == "P1S"
        and profile.get("layer_height_mm") == 0.2
    ), None)
    if expected is None:
        return Check(
            "optional Prusa slice digest parity", "/prusa/slice", "NOT_RUN", False,
            "Matching catalogue entry is unavailable.",
        )
    with tempfile.TemporaryDirectory(prefix="j3b-profile-catalogue-slice-") as temp_dir:
        fixture = Path(temp_dir) / "cube.stl"
        fixture.write_bytes(cube_stl())
        status, response, _ = curl_multipart_slice(
            base_url=base_url, endpoint="/prusa/slice", file_path=fixture,
            layer_height=0.2, material="PLA", slice_service_api_key=key,
            extra_fields={
                "printerProfile": "FDM_0.2mm.ini", "sizeUnit": "mm",
                "keepProportions": "true", "scalePercent": "100",
                "rotationX": "0", "rotationY": "0", "rotationZ": "0",
                "orientationMode": "preserve",
            },
        )
    observed = response.get("profiles", {}).get("effective_profile_sha256") \
        if isinstance(response, dict) else None
    success = (
        status == 200 and isinstance(response, dict) and response.get("success") is True
        and response.get("slicer_engine") == "prusa"
        and response.get("profiles", {}).get("prusa_profile") == "FDM_0.2mm.ini"
        and observed == expected.get("effective_profile_sha256")
    )
    return Check(
        "optional Prusa slice digest parity", "/prusa/slice", status, success,
        "Live slice digest equals the matching v2 catalogue entry.",
    )


def run_checks(base_url: str, verify_slice: bool) -> tuple[list[Check], str]:
    checks: list[Check] = []
    health_status, health_body = curl_json(
        method="GET", base_url=base_url, endpoint="/health",
    )
    checks.append(Check(
        "public health preflight", "/health", health_status,
        health_status == 200 and isinstance(health_body, dict)
        and health_body.get("status") == "OK", "Expected HTTP 200 and status OK.",
    ))
    status, body, headers = curl_json_response(
        method="GET", base_url=base_url, endpoint=CATALOGUE_ENDPOINT,
    )
    checks.append(Check(
        "public catalogue is available without credentials", CATALOGUE_ENDPOINT,
        status, status == 200 and isinstance(body, dict),
        "Expected unauthenticated HTTP 200 JSON.",
    ))
    shape_ok, observation = validate_catalogue_shape(body)
    checks.append(Check(
        "catalogue v2 generic entry schema", CATALOGUE_ENDPOINT, status,
        shape_ok, observation,
    ))
    digest_ok, observation = validate_catalogue_digest(body)
    digest = body.get("catalogue_sha256") if isinstance(body, dict) else None
    etag = headers.get("etag")
    checks.append(Check(
        "strong ETag and canonical catalogue digest", CATALOGUE_ENDPOINT, status,
        digest_ok and isinstance(digest, str) and etag == f'"{digest}"', observation,
    ))
    conditional_status, conditional_body, conditional_headers = curl_json_response(
        method="GET", base_url=base_url, endpoint=CATALOGUE_ENDPOINT,
        request_headers={"If-None-Match": etag or '"missing-etag"'},
    )
    checks.append(Check(
        "conditional GET returns no body for the current ETag", CATALOGUE_ENDPOINT,
        conditional_status, isinstance(etag, str) and conditional_status == 304
        and conditional_body is None and conditional_headers.get("etag") == etag,
        "Expected HTTP 304, empty body, and unchanged ETag.",
    ))
    current_ok, observation = validate_current_v2_managed_rows(body)
    checks.append(Check(
        "managed rows publish exact per-engine selectors, declared and inclusive ceilings",
        CATALOGUE_ENDPOINT, status, current_ok, observation,
    ))
    generation_ok, observation = validate_current_generation(body)
    checks.append(Check(
        "current generation is the 88-row set with the bambu, orca and prusa engines "
        "(FDM and SLA)",
        CATALOGUE_ENDPOINT, status, generation_ok, observation,
    ))
    bambu_ok, observation = validate_measured_bambu_envelopes(body)
    checks.append(Check(
        "bambu rows publish the measured P1S and H2D inclusive envelopes",
        CATALOGUE_ENDPOINT, status, bambu_ok, observation,
    ))
    resolutions_ok, observation = validate_published_resolutions(body)
    checks.append(Check(
        "machine and fleet ceilings match independent engine-scoped derivation",
        CATALOGUE_ENDPOINT, status, resolutions_ok, observation,
    ))
    current_resolutions_ok, observation = validate_current_v2_resolutions(body)
    checks.append(Check(
        "each technology/engine fleet's ceiling is its own dominant machine (bambu FDM H2D, "
        "orca/prusa FDM H2D-QUOTE, prusa SLA SATURN4U)",
        CATALOGUE_ENDPOINT, status, current_resolutions_ok, observation,
    ))
    if verify_slice and isinstance(body, dict):
        checks.append(verify_slice_parity(base_url, body))
        slice_state = "RUN"
    else:
        slice_state = "NOT_RUN"
    return checks, slice_state


def write_report(base_url: str, checks: list[Check], slice_state: str) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(check.success for check in checks)
    lines = [
        "# Profile Catalogue Integration Test Report", "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Total required/selected checks: **{len(checks)}**",
        f"Passed: **{passed}**", f"Failed: **{len(checks) - passed}**",
        f"Optional live slice digest parity: **{slice_state}**", "",
        "## Evidence boundary", "",
        "This runner validates the live v2 HTTP catalogue, its declared profile dimensions, "
        "authoritative inclusive largest-passing ceilings, technology/engine-scoped "
        "derivation, and the current 88-row generation: 82 FDM rows (prusa, orca "
        "PLA/PETG/ABS/TPU, and Bambu Studio P1S/H2D with the measured envelopes) plus 6 "
        "Elegoo Saturn 4 Ultra SLA quoting rows on prusa (SATURN4U, 2 layer heights x 3 "
        "resins, provisional admission ceiling). "
        "Exact-image/native measurement and deployment state require separate evidence. "
        "The optional slice parity check runs only when explicitly requested.", "",
        "No base URL, hostname, IP address, credential, response body, or temporary path "
        "is retained in this report.", "",
        "| # | Check | Endpoint | Status | Result | Observation |",
        "|---:|:------|:---------|:------:|:------:|:------------|",
    ]
    for index, check in enumerate(checks, 1):
        lines.append(
            f"| {index} | {check.name} | `{check.endpoint}` | `{check.status}` | "
            f"{'PASS' if check.success else 'FAIL'} | {check.observation} |"
        )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-prusa-slice-parity", action="store_true",
        help="Run one valid synthetic Prusa slice and compare its profile digest.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = resolve_base_url(PROJECT_ROOT)
    checks, slice_state = run_checks(base_url, args.verify_prusa_slice_parity)
    write_report(base_url, checks, slice_state)
    failures = [check for check in checks if not check.success]
    print(f"[PROFILE CATALOGUE TEST] Completed. total={len(checks)} failed={len(failures)}")
    print(f"[PROFILE CATALOGUE TEST] Report: {REPORT_PATH}")
    for check in failures:
        print(
            f"[PROFILE CATALOGUE TEST] FAIL {check.endpoint} "
            f"status={check.status}: {check.observation}"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
