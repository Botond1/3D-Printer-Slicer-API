"""Privacy and reporting contracts for the profile catalogue HTTP runner."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNNER_PATH = (
    REPOSITORY_ROOT
    / "tests"
    / "testing-scripts"
    / "profiles"
    / "profile_catalogue_test_runner.py"
)


def load_runner():
    spec = importlib.util.spec_from_file_location("profile_catalogue_test_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load profile catalogue runner.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


RUNNER = load_runner()


class ProfileCatalogueReportPrivacyTests(unittest.TestCase):
    def test_target_class_never_repeats_external_host_or_ip(self):
        self.assertEqual(RUNNER.report_target_class("http://localhost:3000"), "local-loopback")
        self.assertEqual(RUNNER.report_target_class("http://127.0.0.1:3000"), "local-loopback")
        self.assertEqual(RUNNER.report_target_class("http://[::1]:3000"), "local-loopback")
        self.assertEqual(
            RUNNER.report_target_class("https://203.0.113.77:443"),
            "external-redacted",
        )
        self.assertEqual(
            RUNNER.report_target_class("https://sensitive-host.invalid"),
            "external-redacted",
        )

    def test_markdown_report_redacts_runtime_base_url(self):
        sensitive_url = "https://203.0.113.77:443"
        with tempfile.TemporaryDirectory() as temporary_directory:
            original_results_dir = RUNNER.RESULTS_DIR
            original_report_path = RUNNER.REPORT_PATH
            try:
                RUNNER.RESULTS_DIR = Path(temporary_directory)
                RUNNER.REPORT_PATH = Path(temporary_directory) / "report.md"
                RUNNER.write_report(sensitive_url, [], "NOT_RUN")
                report = RUNNER.REPORT_PATH.read_text(encoding="utf-8")
            finally:
                RUNNER.RESULTS_DIR = original_results_dir
                RUNNER.REPORT_PATH = original_report_path

        self.assertNotIn(sensitive_url, report)
        self.assertNotIn("203.0.113.77", report)
        self.assertIn("Target class: **external-redacted**", report)


class ProfileCatalogueBoundaryTests(unittest.TestCase):
    SEMANTICS = {
        "authority": "informational",
        "enforcement": "Synthetic schema-test semantics.",
        "availability": "Synthetic schema-test semantics.",
        "freshness": "Synthetic schema-test semantics.",
        "fleet_derivation": "Synthetic schema-test semantics.",
        "scope": "Synthetic schema-test semantics.",
    }

    @staticmethod
    def _profile(
        *,
        printer_id: str = "P1S",
        engine: str = "prusa",
        technology: str = "FDM",
        layer_height: float = 0.2,
        material: str | None = None,
        maximum: dict[str, int] | None = None,
    ) -> dict:
        parameters = [{"name": "printerProfile", "value": "machine-profile.json"}]
        components = [{
            "role": "combined",
            "basename": "machine-profile.json",
            "selector_parameter": "printerProfile",
        }]
        if engine == "orca":
            parameters = [
                {"name": "printerProfile", "value": "machine-profile.json"},
                {"name": "processProfile", "value": "process-profile.json"},
            ]
            components = [
                {
                    "role": "machine",
                    "basename": "machine-profile.json",
                    "selector_parameter": "printerProfile",
                },
                {
                    "role": "process",
                    "basename": "process-profile.json",
                    "selector_parameter": "processProfile",
                },
                {
                    "role": "filament",
                    "basename": "filament-profile.json",
                    "selector_parameter": None,
                },
            ]
        selected_maximum = maximum if maximum is not None else RUNNER.EXPECTED_P1S
        return {
            "id": f"{engine}:{technology}:{printer_id}:{layer_height}:{material}",
            "engine": engine,
            "technology": technology,
            "layer_height_mm": layer_height,
            "material": material,
            "material_scope": "exact" if engine == "orca" else "request-independent",
            "printer": {"id": printer_id, "name": printer_id},
            "slice_selector": {
                "endpoint": f"/{engine}/slice",
                "parameters": parameters,
            },
            "profile_components": components,
            "effective_profile_sha256": "a" * 64,
            "effective_profile_identity_schema": RUNNER.EXPECTED_EFFECTIVE_PROFILE_SCHEMA,
            "engine_version": f"{engine}-schema-test",
            "build_volume_limits_mm": {
                "min": {"x": 1, "y": 1, "z": 1},
                "max": dict(selected_maximum),
                "source_profile": "machine-profile.json",
                "max_source_kind": "profile-explicit",
            },
            "filament_diameter_mm": None,
            "filament_density_g_cm3": None,
        }

    @classmethod
    def _current_profiles(cls) -> list[dict]:
        profiles = [
            cls._profile(layer_height=layer_height)
            for layer_height in (0.1, 0.2, 0.3)
        ]
        for printer_id, maximum in (
            ("P1S", RUNNER.EXPECTED_P1S),
            ("H2D", RUNNER.EXPECTED_H2D),
        ):
            for layer_height in (0.1, 0.2, 0.3):
                for material in ("PETG", "PLA"):
                    profiles.append(cls._profile(
                        printer_id=printer_id,
                        engine="orca",
                        layer_height=layer_height,
                        material=material,
                        maximum=maximum,
                    ))
        return profiles

    @staticmethod
    def _body(profiles: list[dict]) -> dict:
        machine_resolutions, fleet_resolutions = RUNNER.derive_catalogue_resolutions(
            profiles
        )
        content = {
            "schema": RUNNER.EXPECTED_SCHEMA,
            "semantics": copy.deepcopy(ProfileCatalogueBoundaryTests.SEMANTICS),
            "profiles": profiles,
            "machine_resolutions": machine_resolutions,
            "fleet_resolutions": fleet_resolutions,
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

    def test_generic_v1_schema_accepts_abstract_future_sla_engine_shape(self):
        synthetic = self._profile(
            printer_id="schema-fixture",
            engine="future-msla",
            technology="SLA",
            layer_height=1,
            maximum={"x": 2, "y": 3, "z": 4},
        )
        synthetic["printer"]["name"] = "Synthetic schema fixture (not a machine)"
        synthetic["slice_selector"]["parameters"] = [
            {"name": "machinePreset", "value": "schema-only.machine"},
            {"name": "resinPreset", "value": "schema-only.material"},
        ]
        synthetic["profile_components"] = [
            {
                "role": "machine",
                "basename": "schema-only.machine",
                "selector_parameter": "machinePreset",
            },
            {
                "role": "material",
                "basename": "schema-only.material",
                "selector_parameter": "resinPreset",
            },
        ]

        body = self._body([synthetic])
        self.assertEqual(
            RUNNER.validate_catalogue_shape(body),
            (
                True,
                "Generic v1 schema, unique profile IDs, and exact derived resolutions are valid.",
            ),
        )
        self.assertEqual(body["machine_resolutions"], [{
            "technology": "SLA",
            "printer": {
                "id": "schema-fixture",
                "name": "Synthetic schema fixture (not a machine)",
            },
            "engines": ["future-msla"],
            "status": "resolved",
            "reason": None,
            "resolved_build_volume_limits_mm": {
                "min": {"x": 1, "y": 1, "z": 1},
                "max": {"x": 2, "y": 3, "z": 4},
            },
        }])
        self.assertEqual(body["fleet_resolutions"], [{
            "technology": "SLA",
            "status": "resolved",
            "reason": None,
            "maximum": {
                "printers": [{
                    "id": "schema-fixture",
                    "name": "Synthetic schema fixture (not a machine)",
                }],
                "build_volume_limits_mm": {
                    "min": {"x": 1, "y": 1, "z": 1},
                    "max": {"x": 2, "y": 3, "z": 4},
                },
            },
            "excluded_printers": [],
        }])
        self.assertFalse(RUNNER.validate_current_v1_fdm_boundary(body)[0])

    def test_mixed_fdm_and_synthetic_sla_have_independent_fleet_resolutions(self):
        profiles = self._current_profiles()
        synthetic_sla = self._profile(
            printer_id="schema-sla",
            engine="future-msla",
            technology="SLA",
            layer_height=0.05,
            maximum={"x": 20, "y": 20, "z": 20},
        )
        synthetic_sla["printer"]["name"] = "Synthetic SLA schema fixture"
        body = self._body([*profiles, synthetic_sla])

        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])
        self.assertEqual(
            [(item["technology"], item["status"])
             for item in body["fleet_resolutions"]],
            [("FDM", "resolved"), ("SLA", "resolved")],
        )
        self.assertEqual(
            body["fleet_resolutions"][0]["maximum"]["printers"],
            [{"id": "H2D", "name": "H2D"}],
        )
        self.assertEqual(
            body["fleet_resolutions"][1]["maximum"]["printers"],
            [{"id": "schema-sla", "name": "Synthetic SLA schema fixture"}],
        )

        conflicting_sla = self._profile(
            printer_id="schema-sla",
            engine="future-msla-alt",
            technology="SLA",
            layer_height=0.05,
            maximum={"x": 19, "y": 20, "z": 20},
        )
        conflicting_sla["printer"]["name"] = "Synthetic SLA schema fixture"
        isolated = self._body([*profiles, synthetic_sla, conflicting_sla])
        self.assertEqual(isolated["fleet_resolutions"][0], body["fleet_resolutions"][0])
        self.assertEqual(isolated["fleet_resolutions"][1], {
            "technology": "SLA",
            "status": "unresolved",
            "reason": "no_resolved_machine",
            "maximum": None,
            "excluded_printers": [{
                "printer": {
                    "id": "schema-sla",
                    "name": "Synthetic SLA schema fixture",
                },
                "reason": "cross_engine_conflict",
            }],
        })

    def test_duplicate_profile_id_fails_derivation_before_publication(self):
        profiles = [self._profile(), self._profile(engine="orca")]
        profiles[1]["id"] = profiles[0]["id"]
        with self.assertRaisesRegex(
            RUNNER.CatalogueDerivationError,
            r"^duplicate_profile_id:",
        ):
            RUNNER.derive_catalogue_resolutions(profiles)

    def test_generic_schema_rejects_legacy_or_unbounded_identity_shapes(self):
        profile = self._profile()
        mutations = {
            "unexpected profile field": lambda item: item.update(unexpected=True),
            "unbounded engine token": lambda item: item.update(engine="Prusa"),
            "overlong engine token": lambda item: item.update(engine="a" * 33),
            "legacy selector shape": lambda item: item.update(
                slice_selector={
                    "endpoint": "/prusa/slice",
                    "printerProfile": "machine-profile.json",
                }
            ),
            "missing profile components": lambda item: item.pop("profile_components"),
            "duplicate profile component": lambda item: item.update(
                profile_components=[
                    {
                        "role": "machine",
                        "basename": "machine-profile.json",
                        "selector_parameter": "printerProfile",
                    },
                    {
                        "role": "machine",
                        "basename": "machine-profile.json",
                        "selector_parameter": "printerProfile",
                    },
                ]
            ),
            "path-bearing profile component": lambda item: item.update(
                profile_components=[
                    {
                        "role": "machine",
                        "basename": "private/machine-profile.json",
                        "selector_parameter": "printerProfile",
                    },
                ]
            ),
            "duplicate selector parameter name": lambda item: item["slice_selector"].update(
                parameters=[
                    {"name": "printerProfile", "value": "machine-profile.json"},
                    {"name": "printerProfile", "value": "other-profile.json"},
                ]
            ),
            "path-bearing selector value": lambda item: item["slice_selector"].update(
                parameters=[
                    {"name": "printerProfile", "value": "private/machine-profile.json"},
                ]
            ),
            "selector key drift": lambda item: item["profile_components"][0].update(
                selector_parameter="machineProfile"
            ),
            "selector component value mismatch": lambda item: item["slice_selector"].update(
                parameters=[
                    {"name": "printerProfile", "value": "other-profile.json"},
                ]
            ),
            "wrong identity schema": lambda item: item.update(
                effective_profile_identity_schema="r3d-effective-slice-profile-v1"
            ),
            "fallback provenance": lambda item: item["build_volume_limits_mm"].update(
                max_source_kind="fallback"
            ),
            "overlong catalogue id": lambda item: item.update(id="a" * 257),
            "path-bearing printer id": lambda item: item["printer"].update(
                id="private/machine"
            ),
            "overlong printer name": lambda item: item["printer"].update(
                name="a" * 129
            ),
            "non-printable engine version": lambda item: item.update(
                engine_version="engine\nversion"
            ),
            "path-bearing source profile": lambda item: item["build_volume_limits_mm"].update(
                source_profile="private/machine-profile.json"
            ),
            "minimum exceeds maximum": lambda item: item["build_volume_limits_mm"][
                "min"
            ].update(z=251),
            "zero filament measurement": lambda item: item.update(
                filament_diameter_mm=0
            ),
            "non-printable material": lambda item: item.update(material="PLA\nsecret"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                candidate = copy.deepcopy(profile)
                mutate(candidate)
                self.assertFalse(RUNNER.validate_profile_entry_schema(candidate)[0])

    def test_p1s_effective_height_is_250_for_both_engines(self):
        body = {
            "profiles": [
                self._profile(engine="prusa"),
                self._profile(engine="orca"),
            ],
        }

        self.assertEqual(RUNNER.EXPECTED_P1S, {"x": 256, "y": 256, "z": 250})
        self.assertEqual(
            RUNNER.validate_printer_envelopes(body),
            (True, "P1S resolves to 256 x 256 x 250 mm for Prusa and Orca entries."),
        )

        wrong_height = copy.deepcopy(body)
        wrong_height["profiles"][1]["build_volume_limits_mm"]["max"]["z"] = 256
        self.assertFalse(RUNNER.validate_printer_envelopes(wrong_height)[0])

    def test_current_business_set_is_exactly_15_fdm_rows(self):
        body = self._body(self._current_profiles())

        self.assertEqual(len(body["profiles"]), 15)
        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])
        self.assertTrue(RUNNER.validate_current_v1_fdm_boundary(body)[0])

        mutations = {
            "non-FDM current row": lambda item: item.update(technology="SLA"),
            "fallback-only SLA envelope": lambda item: item["build_volume_limits_mm"].update(
                max=dict(RUNNER.FALLBACK_ONLY_SLA_ENVELOPE)
            ),
            "non-explicit machine envelope": lambda item: item["build_volume_limits_mm"].update(
                max_source_kind="fallback"
            ),
            "changed engine-machine combination": lambda item: item.update(engine="future-fdm"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                candidate = copy.deepcopy(body)
                mutate(candidate["profiles"][0])
                self.assertFalse(RUNNER.validate_current_v1_fdm_boundary(candidate)[0])

    def test_exact_top_level_and_profile_shapes_reject_drift(self):
        body = self._body(self._current_profiles())
        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])

        candidates = []
        missing_top_level = copy.deepcopy(body)
        missing_top_level.pop("machine_resolutions")
        candidates.append(missing_top_level)
        extra_top_level = copy.deepcopy(body)
        extra_top_level["fleet_maximum"] = {}
        candidates.append(extra_top_level)
        missing_profile_field = copy.deepcopy(body)
        missing_profile_field["profiles"][0].pop("engine_version")
        candidates.append(missing_profile_field)
        extra_profile_field = copy.deepcopy(body)
        extra_profile_field["profiles"][0]["hidden_envelope"] = {}
        candidates.append(extra_profile_field)

        for candidate in candidates:
            with self.subTest(fields=sorted(candidate)):
                self.assertFalse(RUNNER.validate_catalogue_shape(candidate)[0])

    def test_digest_covers_profiles_machine_resolutions_and_fleet_resolutions(self):
        body = self._body(self._current_profiles())
        self.assertEqual(
            RUNNER.validate_catalogue_digest(body),
            (True, "Body content hashes to catalogue_sha256."),
        )

        for field in ("profiles", "machine_resolutions", "fleet_resolutions"):
            with self.subTest(field=field):
                candidate = copy.deepcopy(body)
                if field == "profiles":
                    candidate[field][0]["engine_version"] = "digest-mutation"
                elif field == "machine_resolutions":
                    candidate[field][0]["printer"]["name"] = "digest mutation"
                else:
                    candidate[field][0]["excluded_printers"] = [{
                        "printer": {"id": "mutated", "name": "digest mutation"},
                        "reason": "cross_engine_conflict",
                    }]
                self.assertFalse(RUNNER.validate_catalogue_digest(candidate)[0])

    def test_current_profiles_publish_resolved_p1s_and_machine_derived_h2d_maximum(self):
        profiles = self._current_profiles()
        body = self._body(profiles)

        self.assertEqual(len(body["profiles"]), 15)
        self.assertEqual(
            [(item["technology"], item["printer"]["id"])
             for item in body["machine_resolutions"]],
            [("FDM", "H2D"), ("FDM", "P1S")],
        )
        p1s = next(
            item for item in body["machine_resolutions"]
            if item["printer"]["id"] == "P1S"
        )
        self.assertEqual(p1s["engines"], ["orca", "prusa"])
        self.assertEqual(p1s["technology"], "FDM")
        self.assertEqual(p1s["status"], "resolved")
        self.assertIsNone(p1s["reason"])
        self.assertEqual(
            p1s["resolved_build_volume_limits_mm"]["max"],
            RUNNER.EXPECTED_P1S,
        )
        self.assertEqual(body["fleet_resolutions"], [{
            "technology": "FDM",
            "status": "resolved",
            "reason": None,
            "maximum": {
                "printers": [{"id": "H2D", "name": "H2D"}],
                "build_volume_limits_mm": {
                    "min": {"x": 1, "y": 1, "z": 1},
                    "max": RUNNER.EXPECTED_H2D,
                },
            },
            "excluded_printers": [],
        }])
        self.assertTrue(RUNNER.validate_published_resolutions(body)[0])

    def test_cross_engine_conflict_is_loud_excludes_only_p1s_and_never_picks_smaller(self):
        profiles = self._current_profiles()
        for profile in profiles:
            if profile["printer"]["id"] == "P1S" and profile["engine"] == "orca":
                profile["build_volume_limits_mm"]["max"]["x"] = 255
        body = self._body(profiles)

        # Derivation adds two machine rows but never collapses or removes a preset row.
        self.assertEqual(len(body["profiles"]), 15)
        self.assertEqual(len(body["machine_resolutions"]), 2)
        p1s = next(
            item for item in body["machine_resolutions"]
            if item["printer"]["id"] == "P1S"
        )
        self.assertEqual(p1s, {
            "technology": "FDM",
            "printer": {"id": "P1S", "name": "P1S"},
            "engines": ["orca", "prusa"],
            "status": "excluded",
            "reason": "cross_engine_conflict",
            "resolved_build_volume_limits_mm": None,
        })
        self.assertEqual(body["fleet_resolutions"], [{
            "technology": "FDM",
            "status": "resolved",
            "reason": None,
            "maximum": {
                "printers": [{"id": "H2D", "name": "H2D"}],
                "build_volume_limits_mm": {
                    "min": {"x": 1, "y": 1, "z": 1},
                    "max": RUNNER.EXPECTED_H2D,
                },
            },
            "excluded_printers": [{
                "printer": {"id": "P1S", "name": "P1S"},
                "reason": "cross_engine_conflict",
            }],
        }])
        maximum_printer_ids = {
            printer["id"]
            for printer in body["fleet_resolutions"][0]["maximum"]["printers"]
        }
        self.assertNotIn("P1S", maximum_printer_ids)
        self.assertIsNone(p1s["resolved_build_volume_limits_mm"])
        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])

    def test_intra_engine_preset_drift_fails_closed_before_publication(self):
        profiles = self._current_profiles()
        one_orca_p1s = next(
            profile for profile in profiles
            if profile["printer"]["id"] == "P1S"
            and profile["engine"] == "orca"
        )
        one_orca_p1s["build_volume_limits_mm"]["max"]["x"] = 255

        with self.assertRaisesRegex(
            RUNNER.CatalogueDerivationError,
            r"^intra_engine_profile_conflict:FDM:P1S:orca$",
        ):
            RUNNER.derive_catalogue_resolutions(profiles)

    def test_componentwise_smaller_cross_engine_resolution_is_rejected(self):
        profiles = self._current_profiles()
        for profile in profiles:
            if profile["printer"]["id"] == "P1S" and profile["engine"] == "orca":
                profile["build_volume_limits_mm"]["max"]["x"] = 255
        body = self._body(profiles)
        p1s = next(
            item for item in body["machine_resolutions"]
            if item["printer"]["id"] == "P1S"
        )

        # This shape looks conservative, but it hides the conflict and is forbidden.
        p1s.update({
            "status": "resolved",
            "reason": None,
            "resolved_build_volume_limits_mm": {
                "min": {"x": 1, "y": 1, "z": 1},
                "max": {"x": 255, "y": 256, "z": 250},
            },
        })
        self.assertTrue(RUNNER.validate_machine_resolutions_schema(
            body["machine_resolutions"]
        )[0])
        self.assertFalse(RUNNER.validate_published_resolutions(body)[0])

    def test_non_dominating_resolved_machines_publish_unresolved_fleet(self):
        profiles = [
            self._profile(printer_id="wide", maximum={"x": 300, "y": 200, "z": 200}),
            self._profile(printer_id="tall", maximum={"x": 200, "y": 200, "z": 300}),
        ]
        body = self._body(profiles)

        self.assertEqual(body["fleet_resolutions"], [{
            "technology": "FDM",
            "status": "unresolved",
            "reason": "no_dominant_machine",
            "maximum": None,
            "excluded_printers": [],
        }])
        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])

    def test_all_conflicting_machines_make_fleet_explicitly_unresolved(self):
        body = self._body([
            self._profile(engine="prusa"),
            self._profile(engine="orca", maximum={"x": 255, "y": 256, "z": 250}),
        ])

        self.assertEqual(body["machine_resolutions"][0]["status"], "excluded")
        self.assertEqual(body["fleet_resolutions"], [{
            "technology": "FDM",
            "status": "unresolved",
            "reason": "no_resolved_machine",
            "maximum": None,
            "excluded_printers": [{
                "printer": {"id": "P1S", "name": "P1S"},
                "reason": "cross_engine_conflict",
            }],
        }])
        self.assertTrue(RUNNER.validate_catalogue_shape(body)[0])


if __name__ == "__main__":
    unittest.main()
