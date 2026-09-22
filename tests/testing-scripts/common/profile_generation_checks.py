"""Strict catalogue additions and material-specific parity selection."""
import math
import re

BAMBU_FIELDS = {"measurement_generation", "engine_build_sha256", "profile_bundle_sha256"}
HASH = re.compile(r"^[a-f0-9]{64}$")


def generation_shape(profile, base_fields):
    if not isinstance(profile, dict):
        return False
    additions = BAMBU_FIELDS if profile.get("engine") == "bambu" else set()
    return set(profile) == base_fields | additions and all(
        isinstance(profile.get(key), str) and HASH.fullmatch(profile[key])
        for key in additions
    )


def v2_projection(row):
    """Catalogue v2 rows are the v3 rows without the opt-in fields:
    ``material_profiles`` and, since 3.7.0,
    ``build_volume_limits_mm.alternative_footprints_inclusive_mm``."""
    projected = {key: value for key, value in row.items() if key != "material_profiles"}
    limits = projected.get("build_volume_limits_mm")
    if isinstance(limits, dict) and "alternative_footprints_inclusive_mm" in limits:
        projected["build_volume_limits_mm"] = {
            key: value for key, value in limits.items() if key != "alternative_footprints_inclusive_mm"
        }
    return projected


def material_parity_digest(body, generic, material):
    """Never compare a material slice with a generic request-independent digest."""
    if not isinstance(body, dict) or body.get("schema") != "r3d-profile-catalogue-v3":
        return None
    rows = body.get("profiles")
    if not isinstance(rows, list):
        return None
    matches = [row for row in rows if isinstance(row, dict) and row.get("id") == generic.get("id")]
    if len(matches) != 1:
        return None
    row = matches[0]
    if v2_projection(row) != generic:
        return None
    variants = row.get("material_profiles")
    if not isinstance(variants, dict) or set(variants) != {"schema", "profiles"} or variants.get("schema") != "r3d-prusa-material-profiles-v1":
        return None
    profiles = variants.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        return None
    seen = set()
    selected = None
    for variant in profiles:
        if not isinstance(variant, dict) or set(variant) != {"material", "supports", "effective_profile_sha256", "filament_density_g_cm3"}:
            return None
        label, value, density = variant["material"], variant["effective_profile_sha256"], variant["filament_density_g_cm3"]
        if not isinstance(label, str) or label in seen or variant["supports"] is not True:
            return None
        if not isinstance(value, str) or not HASH.fullmatch(value):
            return None
        if not isinstance(density, (int, float)) or isinstance(density, bool) or not math.isfinite(density) or density <= 0:
            return None
        seen.add(label)
        if label == material:
            selected = value
    return selected
