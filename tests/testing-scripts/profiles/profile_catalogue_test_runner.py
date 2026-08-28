"""Focused HTTP integration checks for the public profile catalogue."""

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
from urllib.parse import urlsplit

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "profile_catalogue_test_result.md"

from common.env_utils import resolve_base_url, resolve_slice_service_api_key
from common.http_utils import curl_json, curl_json_response, curl_multipart_slice

CATALOGUE_ENDPOINT = "/profiles"
EXPECTED_SCHEMA = "r3d-profile-catalogue-v1"
EXPECTED_EFFECTIVE_PROFILE_SCHEMA = "r3d-effective-slice-profile-v2"
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
PROFILE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
ENGINE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
SLICE_ENDPOINT_PATTERN = re.compile(r"^/[a-z][a-z0-9-]{0,31}/slice$")
ROLE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
PROFILE_BASENAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SELECTOR_PARAMETER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
PRINTER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
EXPECTED_P1S = {"x": 256, "y": 256, "z": 250}
EXPECTED_H2D = {"x": 350, "y": 320, "z": 325}
FALLBACK_ONLY_SLA_ENVELOPE = {"x": 120, "y": 120, "z": 150}
FORBIDDEN_MANUAL_FLEET_KEYS = {"fleet_max", "fleet_maximum", "fleetMaximum"}
TOP_LEVEL_FIELDS = {
    "schema", "catalogue_sha256", "semantics", "profiles",
    "machine_resolutions", "fleet_resolutions",
}
SEMANTICS_FIELDS = {
    "authority", "enforcement", "availability", "freshness",
    "fleet_derivation", "scope",
}
PROFILE_ENTRY_FIELDS = {
    "id", "engine", "technology", "layer_height_mm", "material",
    "material_scope", "printer", "slice_selector", "profile_components",
    "effective_profile_sha256", "effective_profile_identity_schema",
    "engine_version", "build_volume_limits_mm", "filament_diameter_mm",
    "filament_density_g_cm3",
}
MACHINE_RESOLUTION_FIELDS = {
    "technology", "printer", "engines", "status", "reason",
    "resolved_build_volume_limits_mm",
}
FLEET_RESOLUTION_FIELDS = {
    "technology", "status", "reason", "maximum", "excluded_printers",
}
RESOLUTION_ENVELOPE_FIELDS = {"min", "max"}
EXPECTED_CURRENT_PRESETS = frozenset(
    [
        ("prusa", "P1S", layer_height, None)
        for layer_height in (0.1, 0.2, 0.3)
    ]
    + [
        ("orca", printer_id, layer_height, material)
        for printer_id in ("P1S", "H2D")
        for layer_height in (0.1, 0.2, 0.3)
        for material in ("PETG", "PLA")
    ]
)


@dataclass(frozen=True)
class Check:
    name: str
    endpoint: str
    status: int | str
    success: bool
    observation: str


class CatalogueDerivationError(ValueError):
    """The profile rows cannot be resolved without hiding inconsistent data."""


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def contains_forbidden_fleet_key(value: object) -> bool:
    if isinstance(value, dict):
        if FORBIDDEN_MANUAL_FLEET_KEYS.intersection(value):
            return True
        return any(contains_forbidden_fleet_key(child) for child in value.values())
    if isinstance(value, list):
        return any(contains_forbidden_fleet_key(child) for child in value)
    return False


def report_target_class(base_url: str) -> str:
    """Classify the target without persisting its hostname or IP address."""
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


def is_axis_map(value: object, *, allow_zero: bool = False) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"x", "y", "z"}
        and all(
            isinstance(value[axis], (int, float))
            and not isinstance(value[axis], bool)
            and math.isfinite(value[axis])
            and (value[axis] >= 0 if allow_zero else value[axis] > 0)
            for axis in ("x", "y", "z")
        )
    )


def profile_volume(profile: object) -> dict[str, int | float] | None:
    if not isinstance(profile, dict):
        return None
    limits = profile.get("build_volume_limits_mm")
    maximum = limits.get("max") if isinstance(limits, dict) else None
    return maximum if is_axis_map(maximum) else None


def is_printable_ascii(value: object, *, maximum_length: int) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= maximum_length
        and all(0x20 <= ord(character) <= 0x7E for character in value)
    )


def profile_envelope(profile: object) -> dict[str, dict[str, int | float]] | None:
    if not isinstance(profile, dict):
        return None
    limits = profile.get("build_volume_limits_mm")
    minimum = limits.get("min") if isinstance(limits, dict) else None
    maximum = limits.get("max") if isinstance(limits, dict) else None
    if not is_axis_map(minimum, allow_zero=True) or not is_axis_map(maximum):
        return None
    if any(minimum[axis] >= maximum[axis] for axis in ("x", "y", "z")):
        return None
    return {
        "min": {axis: minimum[axis] for axis in ("x", "y", "z")},
        "max": {axis: maximum[axis] for axis in ("x", "y", "z")},
    }


def is_printer_identity(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"id", "name"}
        and isinstance(value.get("id"), str)
        and PRINTER_ID_PATTERN.fullmatch(value["id"]) is not None
        and is_printable_ascii(value.get("name"), maximum_length=128)
    )


def envelope_contains(
    candidate: dict[str, dict[str, int | float]],
    other: dict[str, dict[str, int | float]],
) -> bool:
    return all(
        candidate["min"][axis] <= other["min"][axis]
        and candidate["max"][axis] >= other["max"][axis]
        for axis in ("x", "y", "z")
    )


def derive_catalogue_resolutions(
    profiles: object,
) -> tuple[list[dict], list[dict]]:
    """Derive technology-scoped machine and fleet state without hiding conflicts."""
    if not isinstance(profiles, list):
        raise CatalogueDerivationError("profiles_not_array")

    profile_ids: set[str] = set()
    machines: dict[tuple[str, str], dict] = {}
    for profile in profiles:
        if not isinstance(profile, dict):
            raise CatalogueDerivationError("profile_not_object")
        profile_id = profile.get("id")
        if (
            not isinstance(profile_id, str)
            or PROFILE_ID_PATTERN.fullmatch(profile_id) is None
        ):
            raise CatalogueDerivationError("profile_id_invalid")
        if profile_id in profile_ids:
            raise CatalogueDerivationError(f"duplicate_profile_id:{profile_id}")
        profile_ids.add(profile_id)
        printer = profile.get("printer")
        engine = profile.get("engine")
        technology = profile.get("technology")
        envelope = profile_envelope(profile)
        if (
            not is_printer_identity(printer)
            or not isinstance(engine, str)
            or not ENGINE_ID_PATTERN.fullmatch(engine)
            or technology not in {"FDM", "SLA"}
            or envelope is None
        ):
            raise CatalogueDerivationError("profile_resolution_input_invalid")

        printer_id = printer["id"]
        machine_key = (technology, printer_id)
        machine = machines.setdefault(machine_key, {
            "technology": technology,
            "printer": {"id": printer_id, "name": printer["name"]},
            "engine_envelopes": {},
        })
        if machine["printer"] != printer:
            raise CatalogueDerivationError(
                f"printer_identity_conflict:{printer_id}"
            )
        existing = machine["engine_envelopes"].get(engine)
        if existing is not None and existing != envelope:
            # Preset drift within one engine is never a publishable machine conflict:
            # catalogue startup must fail instead of picking any preset envelope.
            raise CatalogueDerivationError(
                f"intra_engine_profile_conflict:{technology}:{printer_id}:{engine}"
            )
        machine["engine_envelopes"][engine] = envelope

    machine_resolutions: list[dict] = []
    for machine_key in sorted(machines):
        machine = machines[machine_key]
        engines = sorted(machine["engine_envelopes"])
        envelopes = [machine["engine_envelopes"][engine] for engine in engines]
        has_cross_engine_conflict = any(
            envelope != envelopes[0] for envelope in envelopes[1:]
        )
        machine_resolutions.append({
            "technology": machine["technology"],
            "printer": machine["printer"],
            "engines": engines,
            "status": "excluded" if has_cross_engine_conflict else "resolved",
            "reason": "cross_engine_conflict" if has_cross_engine_conflict else None,
            "resolved_build_volume_limits_mm": (
                None if has_cross_engine_conflict else envelopes[0]
            ),
        })

    fleet_resolutions: list[dict] = []
    technologies = sorted({item["technology"] for item in machine_resolutions})
    for technology in technologies:
        technology_machines = [
            item for item in machine_resolutions
            if item["technology"] == technology
        ]
        resolved = [
            item for item in technology_machines if item["status"] == "resolved"
        ]
        excluded_printers = [
            {
                "printer": item["printer"],
                "reason": "cross_engine_conflict",
            }
            for item in technology_machines
            if item["status"] == "excluded"
        ]
        maximum = None
        fleet_status = "unresolved"
        fleet_reason = "no_resolved_machine"
        if resolved:
            dominant = [
                candidate
                for candidate in resolved
                if all(
                    envelope_contains(
                        candidate["resolved_build_volume_limits_mm"],
                        other["resolved_build_volume_limits_mm"],
                    )
                    for other in resolved
                )
            ]
            if dominant:
                fleet_status = "resolved"
                fleet_reason = None
                maximum = {
                    "printers": [item["printer"] for item in dominant],
                    "build_volume_limits_mm": dominant[0][
                        "resolved_build_volume_limits_mm"
                    ],
                }
            else:
                fleet_reason = "no_dominant_machine"
        fleet_resolutions.append({
            "technology": technology,
            "status": fleet_status,
            "reason": fleet_reason,
            "maximum": maximum,
            "excluded_printers": excluded_printers,
        })

    return machine_resolutions, fleet_resolutions


def validate_profile_entry_schema(profile: object) -> tuple[bool, str]:
    """Validate one technology-agnostic v1 entry without imposing today's fleet."""
    if not isinstance(profile, dict) or set(profile) != PROFILE_ENTRY_FIELDS:
        return False, "At least one profile does not have the exact v1 entry shape."

    engine = profile.get("engine")
    layer_height = profile.get("layer_height_mm")
    material = profile.get("material")
    printer = profile.get("printer")
    selector = profile.get("slice_selector")
    components = profile.get("profile_components")
    limits = profile.get("build_volume_limits_mm")
    if (
        not isinstance(profile.get("id"), str)
        or not PROFILE_ID_PATTERN.fullmatch(profile["id"])
        or not isinstance(engine, str)
        or not ENGINE_ID_PATTERN.fullmatch(engine)
        or profile.get("technology") not in {"FDM", "SLA"}
        or not isinstance(layer_height, (int, float))
        or isinstance(layer_height, bool)
        or not math.isfinite(layer_height)
        or layer_height <= 0
        or (
            material is not None
            and not is_printable_ascii(material, maximum_length=64)
        )
        or profile.get("material_scope") not in {"exact", "request-independent"}
    ):
        return False, "At least one profile has invalid generic identity metadata."
    if (
        not is_printer_identity(printer)
    ):
        return False, "At least one profile has an invalid generic printer identity."

    parameters = selector.get("parameters") if isinstance(selector, dict) else None
    if (
        not isinstance(selector, dict)
        or set(selector) != {"endpoint", "parameters"}
        or not isinstance(selector.get("endpoint"), str)
        or not SLICE_ENDPOINT_PATTERN.fullmatch(selector["endpoint"])
        or selector["endpoint"] != f"/{engine}/slice"
        or not isinstance(parameters, list)
        or not 1 <= len(parameters) <= 16
    ):
        return False, "At least one generic slice selector is invalid or non-deterministic."
    parameter_names: set[str] = set()
    for parameter in parameters:
        if (
            not isinstance(parameter, dict)
            or set(parameter) != {"name", "value"}
            or not isinstance(parameter.get("name"), str)
            or not SELECTOR_PARAMETER_PATTERN.fullmatch(parameter["name"])
            or parameter["name"] in parameter_names
            or not isinstance(parameter.get("value"), str)
            or not PROFILE_BASENAME_PATTERN.fullmatch(parameter["value"])
        ):
            return False, "At least one selector parameter is duplicate, unbounded, or path-bearing."
        parameter_names.add(parameter["name"])

    if not isinstance(components, list) or not 1 <= len(components) <= 16:
        return False, "At least one generic profile-component list is missing or unbounded."
    component_identities: set[tuple[str, str, str | None]] = set()
    linked_parameters: list[dict[str, str]] = []
    for component in components:
        selector_parameter = component.get("selector_parameter") \
            if isinstance(component, dict) else None
        if (
            not isinstance(component, dict)
            or set(component) != {"role", "basename", "selector_parameter"}
            or not isinstance(component.get("role"), str)
            or not ROLE_ID_PATTERN.fullmatch(component["role"])
            or not isinstance(component.get("basename"), str)
            or not PROFILE_BASENAME_PATTERN.fullmatch(component["basename"])
            or (
                selector_parameter is not None
                and (
                    not isinstance(selector_parameter, str)
                    or not SELECTOR_PARAMETER_PATTERN.fullmatch(selector_parameter)
                )
            )
        ):
            return False, "At least one generic profile component is invalid or path-bearing."
        identity = (component["role"], component["basename"], selector_parameter)
        if identity in component_identities:
            return False, "At least one ordered profile-component list contains a duplicate."
        component_identities.add(identity)
        if selector_parameter is not None:
            linked_parameters.append({
                "name": selector_parameter,
                "value": component["basename"],
            })
    if linked_parameters != parameters:
        return False, "Selector parameters do not exactly match the ordered profile-component chain."

    digest_value = profile.get("effective_profile_sha256")
    engine_version = profile.get("engine_version")
    if (
        not isinstance(digest_value, str)
        or not SHA256_PATTERN.fullmatch(digest_value)
        or profile.get("effective_profile_identity_schema")
        != EXPECTED_EFFECTIVE_PROFILE_SCHEMA
        or not is_printable_ascii(engine_version, maximum_length=128)
    ):
        return False, "At least one effective-profile identity is invalid."
    if (
        not isinstance(limits, dict)
        or set(limits) != {"min", "max", "source_profile", "max_source_kind"}
        or not is_axis_map(limits.get("min"), allow_zero=True)
        or not is_axis_map(limits.get("max"))
        or any(
            limits["min"][axis] >= limits["max"][axis]
            for axis in ("x", "y", "z")
        )
        or not isinstance(limits.get("source_profile"), str)
        or not PROFILE_BASENAME_PATTERN.fullmatch(limits["source_profile"])
        or limits.get("max_source_kind") != "profile-explicit"
    ):
        return False, "At least one build-volume envelope is not profile-explicit or path-free."
    if not all(
        value is None or (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value > 0
        )
        for value in (
            profile.get("filament_diameter_mm"),
            profile.get("filament_density_g_cm3"),
        )
    ):
        return False, "At least one optional filament measurement is invalid."
    return True, "Generic v1 profile entry is valid."


def is_resolution_envelope(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == RESOLUTION_ENVELOPE_FIELDS
        and is_axis_map(value.get("min"), allow_zero=True)
        and is_axis_map(value.get("max"))
        and all(
            value["min"][axis] < value["max"][axis]
            for axis in ("x", "y", "z")
        )
    )


def validate_machine_resolutions_schema(value: object) -> tuple[bool, str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 512:
        return False, "machine_resolutions is not a bounded non-empty JSON array."
    machine_keys: list[tuple[str, str]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != MACHINE_RESOLUTION_FIELDS:
            return False, "At least one machine resolution has a non-exact shape."
        printer = item.get("printer")
        engines = item.get("engines")
        if (
            item.get("technology") not in {"FDM", "SLA"}
            or not is_printer_identity(printer)
            or not isinstance(engines, list)
            or not 1 <= len(engines) <= 16
            or any(
                not isinstance(engine, str)
                or not ENGINE_ID_PATTERN.fullmatch(engine)
                for engine in engines
            )
            or engines != sorted(set(engines))
        ):
            return False, "At least one machine resolution identity is invalid."
        machine_keys.append((item["technology"], printer["id"]))

        if item.get("status") == "resolved":
            if item.get("reason") is not None or not is_resolution_envelope(
                item.get("resolved_build_volume_limits_mm")
            ):
                return False, "A resolved machine has an invalid reason or envelope."
        elif item.get("status") == "excluded":
            if (
                item.get("reason") != "cross_engine_conflict"
                or item.get("resolved_build_volume_limits_mm") is not None
            ):
                return False, "An excluded machine does not expose the loud conflict state."
        else:
            return False, "A machine resolution status is invalid."
    if machine_keys != sorted(set(machine_keys)):
        return False, "Machine resolutions are duplicate or not technology/printer sorted."
    return True, "Machine resolution shapes are exact and deterministically ordered."


def validate_fleet_resolutions_schema(value: object) -> tuple[bool, str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 2:
        return False, "fleet_resolutions is not a bounded non-empty JSON array."
    technologies: list[str] = []
    for fleet in value:
        if not isinstance(fleet, dict) or set(fleet) != FLEET_RESOLUTION_FIELDS:
            return False, "At least one fleet resolution has a non-exact v1 shape."
        technology = fleet.get("technology")
        if technology not in {"FDM", "SLA"}:
            return False, "At least one fleet resolution technology is invalid."
        technologies.append(technology)
        excluded = fleet.get("excluded_printers")
        if not isinstance(excluded, list) or len(excluded) > 256:
            return False, "Fleet exclusions are not a bounded JSON array."
        excluded_ids: list[str] = []
        for item in excluded:
            if (
                not isinstance(item, dict)
                or set(item) != {"printer", "reason"}
                or not is_printer_identity(item.get("printer"))
                or item.get("reason") != "cross_engine_conflict"
            ):
                return False, "At least one fleet exclusion is invalid or silent."
            excluded_ids.append(item["printer"]["id"])
        if excluded_ids != sorted(set(excluded_ids)):
            return False, "Fleet exclusions are duplicate or not printer-ID sorted."

        status = fleet.get("status")
        reason = fleet.get("reason")
        maximum = fleet.get("maximum")
        if status == "resolved":
            if reason is not None or not isinstance(maximum, dict) or set(maximum) != {
                "printers", "build_volume_limits_mm",
            }:
                return False, "Resolved fleet state has an invalid reason or maximum shape."
            printers = maximum.get("printers")
            if (
                not isinstance(printers, list)
                or not 1 <= len(printers) <= 256
                or any(not is_printer_identity(printer) for printer in printers)
                or [printer["id"] for printer in printers]
                != sorted({printer["id"] for printer in printers})
                or not is_resolution_envelope(maximum.get("build_volume_limits_mm"))
            ):
                return False, "Resolved fleet maximum is invalid or non-deterministic."
        elif status == "unresolved":
            if (
                reason not in {"no_resolved_machine", "no_dominant_machine"}
                or maximum is not None
            ):
                return False, "Unresolved fleet state has an invalid reason or non-null maximum."
        else:
            return False, "Fleet resolution status is invalid."
    if technologies != sorted(set(technologies)):
        return False, "Fleet resolutions are duplicate or not technology sorted."
    return True, "Fleet resolution shapes are exact and technology-scoped."


def validate_published_resolutions(body: object) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "Response body is unavailable."
    machine_ok, machine_observation = validate_machine_resolutions_schema(
        body.get("machine_resolutions")
    )
    if not machine_ok:
        return False, machine_observation
    fleet_ok, fleet_observation = validate_fleet_resolutions_schema(
        body.get("fleet_resolutions")
    )
    if not fleet_ok:
        return False, fleet_observation
    try:
        expected_machines, expected_fleets = derive_catalogue_resolutions(
            body.get("profiles")
        )
    except CatalogueDerivationError as error:
        return False, f"Profile rows are not safely derivable: {error}."
    if body.get("machine_resolutions") != expected_machines:
        return False, "Published machine resolutions do not exactly match profile rows."
    if body.get("fleet_resolutions") != expected_fleets:
        return False, "Published fleet resolutions do not exactly match resolved machines."
    return True, (
        "Published machine and fleet resolutions exactly match independent derivation; "
        "conflicting machines remain explicit exclusions."
    )


def validate_catalogue_shape(body: object) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "Response body is not a JSON object."
    if set(body) != TOP_LEVEL_FIELDS:
        return False, "Top-level v1 field set is not exact."
    digest = body.get("catalogue_sha256")
    profiles = body.get("profiles")
    if body.get("schema") != EXPECTED_SCHEMA or not isinstance(digest, str):
        return False, "Schema or catalogue digest is invalid."
    semantics = body.get("semantics")
    if (
        not SHA256_PATTERN.fullmatch(digest)
        or not isinstance(semantics, dict)
        or set(semantics) != SEMANTICS_FIELDS
        or semantics.get("authority") != "informational"
        or any(
            not isinstance(semantics.get(field), str)
            or not 1 <= len(semantics[field]) <= 512
            for field in ("enforcement", "availability", "freshness")
        )
        or any(
            not isinstance(semantics.get(field), str)
            or not 1 <= len(semantics[field]) <= 1024
            for field in ("fleet_derivation", "scope")
        )
    ):
        return False, "Catalogue metadata is invalid."
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 4096:
        return False, "Profiles is not a bounded non-empty JSON array."

    ids: set[str] = set()
    for profile in profiles:
        valid, observation = validate_profile_entry_schema(profile)
        if not valid:
            return False, observation
        profile_id = profile["id"]
        if profile_id in ids:
            return False, "Profile IDs are missing or not unique."
        ids.add(profile_id)
    resolutions_ok, resolutions_observation = validate_published_resolutions(body)
    if not resolutions_ok:
        return False, resolutions_observation
    if contains_forbidden_fleet_key(body):
        return False, "A forbidden manually maintained fleet-maximum field is present."
    return True, (
        "Generic v1 schema, unique profile IDs, and exact derived resolutions are valid."
    )


def validate_catalogue_digest(body: object) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "Response body is unavailable."
    content = {
        key: value
        for key, value in body.items()
        if key != "catalogue_sha256"
    }
    observed = hashlib.sha256(canonical_json_bytes(content)).hexdigest()
    expected = body.get("catalogue_sha256")
    return observed == expected, "Body content hashes to catalogue_sha256."


def validate_printer_envelopes(body: object) -> tuple[bool, str]:
    profiles = body.get("profiles") if isinstance(body, dict) else None
    if not isinstance(profiles, list):
        return False, "Profiles are unavailable."
    p1s = [
        item for item in profiles
        if isinstance(item, dict)
        and isinstance(item.get("printer"), dict)
        and item["printer"].get("id") == "P1S"
    ]
    engine_set = {item.get("engine") for item in p1s}
    valid = (
        engine_set == {"prusa", "orca"}
        and bool(p1s)
        and all(profile_volume(item) == EXPECTED_P1S for item in p1s)
    )
    return valid, "P1S resolves to 256 x 256 x 250 mm for Prusa and Orca entries."


def validate_current_v1_fdm_boundary(body: object) -> tuple[bool, str]:
    """Validate today's closed FDM product set separately from the generic schema."""
    profiles = body.get("profiles") if isinstance(body, dict) else None
    if not isinstance(profiles, list) or len(profiles) != 15:
        return False, "Profiles are unavailable or not the current closed set of 15."
    observed_presets: set[tuple[object, object, object, object]] = set()
    for profile in profiles:
        printer = profile.get("printer") if isinstance(profile, dict) else None
        limits = profile.get("build_volume_limits_mm") if isinstance(profile, dict) else None
        if (
            not isinstance(printer, dict)
            or profile.get("technology") != "FDM"
            or profile_volume(profile) == FALLBACK_ONLY_SLA_ENVELOPE
            or not isinstance(limits, dict)
            or limits.get("max_source_kind") != "profile-explicit"
        ):
            return False, "The current v1 set contains a non-FDM or non-machine-bound row."
        observed_presets.add((
            profile.get("engine"), printer.get("id"),
            profile.get("layer_height_mm"), profile.get("material"),
        ))
    if observed_presets != EXPECTED_CURRENT_PRESETS:
        return False, "The current engine, printer, layer, and material set is incomplete."
    return True, (
        "Exactly 15 current Prusa/Orca FDM presets are present; "
        "no fallback-only SLA envelope is exposed."
    )


def cube_stl() -> bytes:
    triangles = (
        ((0, 0, 0), (10, 10, 0), (10, 0, 0)),
        ((0, 0, 0), (0, 10, 0), (10, 10, 0)),
        ((0, 0, 10), (10, 0, 10), (10, 10, 10)),
        ((0, 0, 10), (10, 10, 10), (0, 10, 10)),
        ((0, 0, 0), (10, 0, 0), (10, 0, 10)),
        ((0, 0, 0), (10, 0, 10), (0, 0, 10)),
        ((10, 0, 0), (10, 10, 0), (10, 10, 10)),
        ((10, 0, 0), (10, 10, 10), (10, 0, 10)),
        ((10, 10, 0), (0, 10, 0), (0, 10, 10)),
        ((10, 10, 0), (0, 10, 10), (10, 10, 10)),
        ((0, 10, 0), (0, 0, 0), (0, 0, 10)),
        ((0, 10, 0), (0, 0, 10), (0, 10, 10)),
    )
    lines = ["solid j2_catalogue_cube"]
    for first, second, third in triangles:
        lines.extend([
            "facet normal 0 0 0",
            "outer loop",
            f"vertex {first[0]} {first[1]} {first[2]}",
            f"vertex {second[0]} {second[1]} {second[2]}",
            f"vertex {third[0]} {third[1]} {third[2]}",
            "endloop",
            "endfacet",
        ])
    lines.append("endsolid j2_catalogue_cube")
    return ("\n".join(lines) + "\n").encode("ascii")


def verify_slice_parity(base_url: str, body: dict) -> Check:
    key = resolve_slice_service_api_key(PROJECT_ROOT)
    if not key:
        return Check(
            "optional Prusa slice digest parity",
            "/prusa/slice",
            "NOT_RUN",
            False,
            "SLICE_SERVICE_API_KEY runner input is unavailable.",
        )
    expected = next((
        profile for profile in body.get("profiles", [])
        if isinstance(profile, dict)
        and profile.get("engine") == "prusa"
        and profile.get("printer", {}).get("id") == "P1S"
        and profile.get("layer_height_mm") == 0.2
    ), None)
    if expected is None:
        return Check(
            "optional Prusa slice digest parity",
            "/prusa/slice",
            "NOT_RUN",
            False,
            "Matching catalogue entry is unavailable.",
        )

    with tempfile.TemporaryDirectory(prefix="j2-profile-catalogue-slice-") as temp_dir:
        fixture = Path(temp_dir) / "cube.stl"
        fixture.write_bytes(cube_stl())
        status, response, _duration = curl_multipart_slice(
            base_url=base_url,
            endpoint="/prusa/slice",
            file_path=fixture,
            layer_height=0.2,
            material="PLA",
            slice_service_api_key=key,
            extra_fields={
                "printerProfile": "FDM_0.2mm.ini",
                "sizeUnit": "mm",
                "keepProportions": "true",
                "scalePercent": "100",
                "rotationX": "0",
                "rotationY": "0",
                "rotationZ": "0",
            },
        )
    observed = response.get("profiles", {}).get("effective_profile_sha256") \
        if isinstance(response, dict) else None
    success = (
        status == 200
        and isinstance(response, dict)
        and response.get("success") is True
        and response.get("slicer_engine") == "prusa"
        and response.get("profiles", {}).get("prusa_profile") == "FDM_0.2mm.ini"
        and observed == expected.get("effective_profile_sha256")
    )
    return Check(
        "optional Prusa slice digest parity",
        "/prusa/slice",
        status,
        success,
        "Live slice digest equals the matching catalogue entry.",
    )


def run_checks(base_url: str, verify_slice: bool) -> tuple[list[Check], str]:
    checks: list[Check] = []
    health_status, health_body = curl_json(
        method="GET", base_url=base_url, endpoint="/health"
    )
    health_ok = (
        health_status == 200
        and isinstance(health_body, dict)
        and health_body.get("status") == "OK"
    )
    checks.append(Check(
        "public health preflight", "/health", health_status, health_ok,
        "Expected HTTP 200 and status OK.",
    ))

    status, body, headers = curl_json_response(
        method="GET", base_url=base_url, endpoint=CATALOGUE_ENDPOINT
    )
    checks.append(Check(
        "public catalogue is available without credentials",
        CATALOGUE_ENDPOINT,
        status,
        status == 200 and isinstance(body, dict),
        "Expected unauthenticated HTTP 200 JSON.",
    ))

    shape_ok, shape_observation = validate_catalogue_shape(body)
    checks.append(Check(
        "catalogue v1 generic entry schema",
        CATALOGUE_ENDPOINT,
        status,
        shape_ok,
        shape_observation,
    ))

    digest_ok, digest_observation = validate_catalogue_digest(body)
    digest = body.get("catalogue_sha256") if isinstance(body, dict) else None
    etag = headers.get("etag")
    checks.append(Check(
        "strong ETag and canonical catalogue digest",
        CATALOGUE_ENDPOINT,
        status,
        digest_ok and isinstance(digest, str) and etag == f'"{digest}"',
        digest_observation,
    ))

    conditional_status, conditional_body, conditional_headers = curl_json_response(
        method="GET",
        base_url=base_url,
        endpoint=CATALOGUE_ENDPOINT,
        request_headers={"If-None-Match": etag or '"missing-etag"'},
    )
    checks.append(Check(
        "conditional GET returns no body for the current ETag",
        CATALOGUE_ENDPOINT,
        conditional_status,
        (
            isinstance(etag, str)
            and conditional_status == 304
            and conditional_body is None
            and conditional_headers.get("etag") == etag
        ),
        "Expected HTTP 304, empty body, and unchanged ETag.",
    ))

    envelopes_ok, envelopes_observation = validate_printer_envelopes(body)
    checks.append(Check(
        "P1S envelope is resolved per engine",
        CATALOGUE_ENDPOINT,
        status,
        envelopes_ok,
        envelopes_observation,
    ))

    fdm_boundary_ok, fdm_boundary_observation = validate_current_v1_fdm_boundary(body)
    checks.append(Check(
        "current v1 managed set is exactly 15 machine-bound FDM presets",
        CATALOGUE_ENDPOINT,
        status,
        fdm_boundary_ok,
        fdm_boundary_observation,
    ))

    resolutions_ok, resolutions_observation = validate_published_resolutions(body)
    checks.append(Check(
        "machine and fleet resolutions match independent derivation",
        CATALOGUE_ENDPOINT,
        status,
        resolutions_ok,
        resolutions_observation,
    ))

    fleet_resolutions = body.get("fleet_resolutions") if isinstance(body, dict) else None
    fleet_resolution = next((
        item for item in fleet_resolutions
        if isinstance(item, dict) and item.get("technology") == "FDM"
    ), None) if isinstance(fleet_resolutions, list) else None
    fleet_maximum = fleet_resolution.get("maximum") \
        if isinstance(fleet_resolution, dict) else None
    fleet_ok = (
        resolutions_ok
        and len(fleet_resolutions) == 1
        and fleet_resolution.get("technology") == "FDM"
        and fleet_resolution.get("status") == "resolved"
        and fleet_resolution.get("reason") is None
        and fleet_resolution.get("excluded_printers") == []
        and isinstance(fleet_maximum, dict)
        and fleet_maximum.get("printers") == [{"id": "H2D", "name": "Bambu Lab H2D"}]
        and fleet_maximum.get("build_volume_limits_mm", {}).get("max") == EXPECTED_H2D
    )
    checks.append(Check(
        "fleet maximum is the machine-derived H2D envelope",
        CATALOGUE_ENDPOINT,
        status,
        fleet_ok,
        "Published H2D at 350 x 320 x 325 mm from resolved machines; no manual max field.",
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
        "# Profile Catalogue Integration Test Report",
        "",
        f"Generated at (UTC): **{datetime.now(timezone.utc).isoformat()}**",
        f"Target class: **{report_target_class(base_url)}**",
        f"Total required/selected checks: **{len(checks)}**",
        f"Passed: **{passed}**",
        f"Failed: **{len(checks) - passed}**",
        f"Optional live slice digest parity: **{slice_state}**",
        "",
        "## Evidence boundary",
        "",
        "This runner validates the live HTTP catalogue exposed by the selected base URL. "
        "Exact-image/native-binary identity and deployment state require separate evidence. "
        "The optional slice parity check runs only when explicitly requested.",
        "",
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
        "--verify-prusa-slice-parity",
        action="store_true",
        help="Run one synthetic Prusa slice and compare its effective profile digest.",
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
