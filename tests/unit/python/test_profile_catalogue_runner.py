from __future__ import annotations

import copy
import hashlib
import importlib.util
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = (
    ROOT / "tests" / "testing-scripts" / "profiles"
    / "profile_catalogue_test_runner.py"
)


def load_runner():
    spec = importlib.util.spec_from_file_location("profile_catalogue_test_runner", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    import sys
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


RUNNER = load_runner()


class ProfileCatalogueFixtures:
    SEMANTICS = {
        "authority": "informational",
        "enforcement": "Slice endpoints remain authoritative.",
        "availability": "Slicing remains available independently.",
        "freshness": "Digest identifies this generation.",
        "build_volume_dimensions": (
            "declared_build_volume_dimensions_mm is not an admission limit; "
            "largest_passing_dimensions_inclusive_mm accepts the exact boundary value."
        ),
        "fleet_derivation": "Machine and fleet resolutions are engine-scoped.",
        "scope": "Machine-bound server-owned profiles only.",
    }

    @staticmethod
    def _name(printer_id: str) -> str:
        return (
            "Bambu Lab P1S" if printer_id == "P1S"
            else "H2D-sized quote (P1S physics)"
        )

    @classmethod
    def profile(
        cls,
        *,
        engine: str = "prusa",
        printer_id: str = "P1S",
        technology: str = "FDM",
        layer_height: float = 0.2,
        material: str | None = None,
        declared: dict | None = None,
        largest_passing: dict | None = None,
    ) -> dict:
        declared = copy.deepcopy(
            declared or RUNNER.DECLARED_DIMENSIONS.get(
                printer_id, {"x": 20, "y": 20, "z": 20},
            )
        )
        largest_passing = copy.deepcopy(
            largest_passing or RUNNER.LARGEST_PASSING_DIMENSIONS.get(
                (engine, printer_id), declared,
            )
        )
        if engine == "prusa":
            basename = (
                f"FDM_{layer_height}mm.ini" if printer_id == "P1S"
                else f"FDM_P1S_H2D_SIZE_QUOTING_{layer_height}mm.ini"
            )
            parameters = [{"name": "printerProfile", "value": basename}]
            components = [{
                "role": "combined",
                "basename": basename,
                "selector_parameter": "printerProfile",
            }]
        else:
            machine = (
                "Bambu_P1S_0.4_nozzle.json" if printer_id == "P1S"
                else "Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json"
            )
            process = f"FDM_{layer_height}mm.json"
            parameters = [
                {"name": "printerProfile", "value": machine},
                {"name": "processProfile", "value": process},
            ]
            components = [
                {
                    "role": "machine", "basename": machine,
                    "selector_parameter": "printerProfile",
                },
                {
                    "role": "process", "basename": process,
                    "selector_parameter": "processProfile",
                },
                {
                    "role": "filament", "basename": "Generic_PLA.json",
                    "selector_parameter": None,
                },
            ]
            basename = machine
        material_label = material or "none"
        return {
            "id": (
                f"{engine}:{technology}:{printer_id}:{layer_height}:{material_label}"
            ),
            "engine": engine,
            "technology": technology,
            "layer_height_mm": layer_height,
            "material": material,
            "material_scope": "exact" if material is not None else "request-independent",
            "printer": {"id": printer_id, "name": cls._name(printer_id)},
            "slice_selector": {
                "endpoint": f"/{engine}/slice",
                "parameters": parameters,
            },
            "profile_components": components,
            "effective_profile_sha256": "a" * 64,
            "effective_profile_identity_schema": RUNNER.EXPECTED_EFFECTIVE_PROFILE_SCHEMA,
            "engine_version": "fixture-engine 1.0",
            "build_volume_limits_mm": {
                "minimum_dimensions_inclusive_mm": copy.deepcopy(
                    RUNNER.MINIMUM_DIMENSIONS
                ),
                "declared_build_volume_dimensions_mm": declared,
                "largest_passing_dimensions_inclusive_mm": largest_passing,
                "source_profile": basename,
                "declared_source_kind": "profile-explicit",
            },
            "filament_diameter_mm": 1.75 if material is not None else None,
            "filament_density_g_cm3": 1.24 if material is not None else None,
        }

    @classmethod
    def current_profiles(cls) -> list[dict]:
        profiles = [
            cls.profile(
                engine="prusa", printer_id=printer_id, layer_height=layer,
            )
            for printer_id in ("P1S", "H2D-QUOTE")
            for layer in (0.1, 0.2, 0.3)
        ]
        profiles.extend(
            cls.profile(
                engine="orca", printer_id=printer_id,
                layer_height=layer, material=material,
            )
            for printer_id in ("P1S", "H2D-QUOTE")
            for layer in (0.1, 0.2, 0.3)
            for material in ("PETG", "PLA")
        )
        return profiles

    @classmethod
    def body(cls, profiles: list[dict]) -> dict:
        machines, fleets = RUNNER.derive_catalogue_resolutions(profiles)
        content = {
            "schema": RUNNER.EXPECTED_SCHEMA,
            "semantics": copy.deepcopy(cls.SEMANTICS),
            "profiles": profiles,
            "machine_resolutions": machines,
            "fleet_resolutions": fleets,
        }
        return {
            "schema": content["schema"],
            "catalogue_sha256": hashlib.sha256(
                RUNNER.canonical_json_bytes(content)
            ).hexdigest(),
            "semantics": content["semantics"],
            "profiles": content["profiles"],
            "machine_resolutions": content["machine_resolutions"],
            "fleet_resolutions": content["fleet_resolutions"],
        }


class ProfileCatalogueReportPrivacyTests(unittest.TestCase):
    def test_target_class_never_repeats_external_host_or_ip(self):
        self.assertEqual(
            RUNNER.report_target_class("https://private.example.invalid:8443"),
            "external-redacted",
        )
        self.assertEqual(
            RUNNER.report_target_class("https://203.0.113.44"),
            "external-redacted",
        )
        self.assertEqual(
            RUNNER.report_target_class("http://127.0.0.1:3000"),
            "local-loopback",
        )

    def test_markdown_report_redacts_runtime_base_url(self):
        target = "https://customer.private.example.invalid:9443"
        checks = [RUNNER.Check("v2 schema", "/profiles", 200, True, "valid")]
        with tempfile.TemporaryDirectory() as temporary_directory:
            report = Path(temporary_directory) / "report.md"
            with mock.patch.object(RUNNER, "REPORT_PATH", report):
                RUNNER.write_report(target, checks, "NOT_RUN")
            text = report.read_text(encoding="utf-8")
        self.assertNotIn(target, text)
        self.assertNotIn("customer.private.example.invalid", text)
        self.assertIn("Target class: **external-redacted**", text)


class ProfileCatalogueV2Tests(ProfileCatalogueFixtures, unittest.TestCase):
    def test_generic_v2_schema_accepts_future_sla_engine(self):
        profile = self.profile(
            engine="future-msla", printer_id="schema-fixture", technology="SLA",
            layer_height=0.05, declared={"x": 20, "y": 21, "z": 22},
            largest_passing={"x": 19.9, "y": 20.9, "z": 21.9},
        )
        profile["printer"]["name"] = "Synthetic SLA schema fixture"
        profile["slice_selector"]["parameters"] = [
            {"name": "machinePreset", "value": "schema.machine"},
            {"name": "resinPreset", "value": "schema.resin"},
        ]
        profile["profile_components"] = [
            {
                "role": "machine", "basename": "schema.machine",
                "selector_parameter": "machinePreset",
            },
            {
                "role": "material", "basename": "schema.resin",
                "selector_parameter": "resinPreset",
            },
        ]
        profile["build_volume_limits_mm"]["source_profile"] = "schema.machine"
        body = self.body([profile])

        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])
        self.assertEqual(body["machine_resolutions"], [{
            "technology": "SLA",
            "printer": {
                "id": "schema-fixture", "name": "Synthetic SLA schema fixture",
            },
            "engine": "future-msla",
            "status": "resolved", "reason": None,
            "minimum_dimensions_inclusive_mm": {"x": 1, "y": 1, "z": 1},
            "largest_passing_dimensions_inclusive_mm": {
                "x": 19.9, "y": 20.9, "z": 21.9,
            },
        }])

    def test_cross_engine_differences_are_preserved_not_collapsed(self):
        profiles = [
            self.profile(engine="prusa", printer_id="P1S"),
            self.profile(engine="orca", printer_id="P1S", material="PLA"),
        ]
        machines, fleets = RUNNER.derive_catalogue_resolutions(profiles)

        self.assertEqual(len(machines), 2)
        self.assertEqual(
            {
                machine["engine"]:
                machine["largest_passing_dimensions_inclusive_mm"]
                for machine in machines
            },
            {
                "prusa": {"x": 256, "y": 256, "z": 249.9},
                "orca": {"x": 253.9, "y": 253.9, "z": 249.9},
            },
        )
        self.assertEqual([fleet["engine"] for fleet in fleets], ["orca", "prusa"])

    def test_same_engine_preset_drift_fails_closed(self):
        profiles = [
            self.profile(engine="orca", material="PLA", layer_height=0.1),
            self.profile(engine="orca", material="PETG", layer_height=0.2),
        ]
        profiles[1]["build_volume_limits_mm"][
            "largest_passing_dimensions_inclusive_mm"
        ]["x"] -= 0.1
        with self.assertRaisesRegex(
            RUNNER.CatalogueDerivationError,
            r"^intra_engine_profile_conflict:FDM:orca:P1S$",
        ):
            RUNNER.derive_catalogue_resolutions(profiles)

    def test_duplicate_profile_ids_fail_before_publication(self):
        profiles = [self.profile(engine="prusa"), self.profile(engine="orca")]
        profiles[1]["id"] = profiles[0]["id"]
        with self.assertRaisesRegex(
            RUNNER.CatalogueDerivationError, r"^duplicate_profile_id:",
        ):
            RUNNER.derive_catalogue_resolutions(profiles)

    def test_entry_schema_rejects_legacy_max_and_ambiguous_dimensions(self):
        profile = self.profile()
        mutations = {
            "legacy max": lambda item: item["build_volume_limits_mm"].update(
                max={"x": 256, "y": 256, "z": 250}
            ),
            "missing availability limit": lambda item: item[
                "build_volume_limits_mm"
            ].pop("largest_passing_dimensions_inclusive_mm"),
            "fallback provenance": lambda item: item[
                "build_volume_limits_mm"
            ].update(declared_source_kind="fallback"),
            "passing over declared": lambda item: item[
                "build_volume_limits_mm"
            ]["largest_passing_dimensions_inclusive_mm"].update(z=250.1),
            "path-bearing source": lambda item: item[
                "build_volume_limits_mm"
            ].update(source_profile="private/profile.ini"),
            "legacy selector": lambda item: item.update(
                slice_selector={"endpoint": "/prusa/slice", "printerProfile": "x.ini"}
            ),
            "wrong digest schema": lambda item: item.update(
                effective_profile_identity_schema="r3d-effective-slice-profile-v1"
            ),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                candidate = copy.deepcopy(profile)
                mutate(candidate)
                self.assertFalse(RUNNER.validate_profile_entry_schema(candidate)[0])

    def test_current_set_is_exactly_18_and_selects_quote_profiles_on_both_engines(self):
        body = self.body(self.current_profiles())
        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])
        self.assertEqual(
            RUNNER.validate_current_v2_fdm_boundary(body),
            (
                True,
                "Exactly 18 managed FDM rows publish separate declared and inclusive "
                "ceilings; H2D-sized quote selectors exist on both engines.",
            ),
        )
        serialized = str(body)
        self.assertNotIn("Bambu_H2D_0.4_nozzle.json", serialized)
        self.assertIn("FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini", serialized)
        self.assertIn("Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json", serialized)

    def test_current_machine_and_fleet_resolutions_are_engine_scoped(self):
        body = self.body(self.current_profiles())
        self.assertTrue(RUNNER.validate_current_v2_resolutions(body)[0])
        self.assertEqual(len(body["machine_resolutions"]), 4)
        self.assertEqual(
            [(item["technology"], item["engine"], item["printer"]["id"])
             for item in body["machine_resolutions"]],
            [
                ("FDM", "orca", "H2D-QUOTE"),
                ("FDM", "orca", "P1S"),
                ("FDM", "prusa", "H2D-QUOTE"),
                ("FDM", "prusa", "P1S"),
            ],
        )
        self.assertEqual(
            {
                item["engine"]: item["largest_passing_dimensions_inclusive_mm"]
                for item in body["fleet_resolutions"]
            },
            {
                "orca": {"x": 347.9, "y": 317.9, "z": 324.9},
                "prusa": {"x": 350, "y": 320, "z": 324.9},
            },
        )

    def test_non_dominating_same_engine_machines_publish_unresolved_fleet(self):
        profiles = [
            self.profile(
                printer_id="wide", declared={"x": 300, "y": 200, "z": 200},
                largest_passing={"x": 300, "y": 200, "z": 200},
            ),
            self.profile(
                printer_id="tall", declared={"x": 200, "y": 200, "z": 300},
                largest_passing={"x": 200, "y": 200, "z": 300},
            ),
        ]
        profiles[0]["printer"]["name"] = "Wide fixture"
        profiles[1]["printer"]["name"] = "Tall fixture"
        _, fleets = RUNNER.derive_catalogue_resolutions(profiles)
        self.assertEqual(fleets, [{
            "technology": "FDM", "engine": "prusa",
            "status": "unresolved", "reason": "no_dominant_machine",
            "printers": [], "minimum_dimensions_inclusive_mm": None,
            "largest_passing_dimensions_inclusive_mm": None,
            "excluded_printers": [],
        }])

    def test_digest_covers_profiles_machines_and_engine_fleets(self):
        body = self.body(self.current_profiles())
        self.assertEqual(
            RUNNER.validate_catalogue_digest(body),
            (True, "Body content hashes to catalogue_sha256."),
        )
        for field in ("profiles", "machine_resolutions", "fleet_resolutions"):
            with self.subTest(field=field):
                candidate = copy.deepcopy(body)
                if field == "profiles":
                    candidate[field][0]["engine_version"] = "mutated"
                elif field == "machine_resolutions":
                    candidate[field][0]["largest_passing_dimensions_inclusive_mm"]["x"] -= 0.1
                else:
                    candidate[field][0]["largest_passing_dimensions_inclusive_mm"]["x"] -= 0.1
                self.assertFalse(RUNNER.validate_catalogue_digest(candidate)[0])

    def test_top_level_and_resolution_shapes_reject_legacy_maximum(self):
        body = self.body(self.current_profiles())
        candidates = []
        missing = copy.deepcopy(body)
        missing.pop("machine_resolutions")
        candidates.append(missing)
        machine_max = copy.deepcopy(body)
        machine_max["machine_resolutions"][0]["max"] = {"x": 1, "y": 1, "z": 1}
        candidates.append(machine_max)
        fleet_maximum = copy.deepcopy(body)
        fleet_maximum["fleet_resolutions"][0]["maximum"] = {}
        candidates.append(fleet_maximum)
        for candidate in candidates:
            with self.subTest(fields=sorted(candidate)):
                self.assertFalse(RUNNER.validate_catalogue_shape(candidate)[0])

    def test_optional_parity_cube_uses_nonzero_normals(self):
        text = RUNNER.cube_stl().decode("ascii")
        self.assertEqual(text.count("facet normal"), 12)
        self.assertNotIn("facet normal 0 0 0", text)
        normals = re.findall(r"facet normal ([^\n]+)", text)
        self.assertEqual(len(normals), 12)
        self.assertTrue(all(normal.strip() != "0 0 0" for normal in normals))


if __name__ == "__main__":
    unittest.main()
